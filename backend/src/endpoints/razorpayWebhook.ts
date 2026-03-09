import { OpenAPIRoute } from "chanfana";
import { z } from "zod";

import { getMqttConfig, publishToMqtt } from "./mqttPublish";
import type { AppContext } from "../types";

const QR_CREDITED_EVENT = "qr_code.credited";

type RazorpayWebhookPayload = {
	id?: string;
	event?: string;
	created_at?: number;
	payload?: {
		payment?: {
			entity?: {
				id?: string;
				amount?: number;
				currency?: string;
				method?: string;
				status?: string;
				vpa?: string;
				created_at?: number;
			};
		};
		qr_code?: {
			entity?: {
				id?: string;
			};
		};
	};
};

function hexToBytes(hex: string): Uint8Array {
	if (hex.length % 2 !== 0) {
		return new Uint8Array();
	}

	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < hex.length; i += 2) {
		const chunk = Number.parseInt(hex.slice(i, i + 2), 16);
		if (Number.isNaN(chunk)) {
			return new Uint8Array();
		}
		bytes[i / 2] = chunk;
	}
	return bytes;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length || a.length === 0) {
		return false;
	}

	let diff = 0;
	for (let i = 0; i < a.length; i++) {
		diff |= a[i] ^ b[i];
	}
	return diff === 0;
}

async function createHmacSha256Hex(secret: string, body: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
	return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function formatRupees(amountPaise: number): string {
	const value = amountPaise / 100;
	if (Number.isInteger(value)) {
		return String(value);
	}
	return value.toFixed(2).replace(/\.00$/, "");
}

function buildLedgerBuddyMessage(amountPaise: number): string {
	return `${formatRupees(amountPaise)} rupees received on Ledger Buddy`;
}

export class RazorpayWebhook extends OpenAPIRoute {
	schema = {
		tags: ["Webhook"],
		summary: "Receive Razorpay QR code webhooks",
		request: {
			body: {
				content: {
					"application/json": {
						schema: z.unknown(),
					},
				},
			},
		},
		responses: {
			"200": {
				description: "Webhook processed",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							stored: z.boolean().optional(),
							published: z.boolean().optional(),
							ignored: z.boolean().optional(),
							reason: z.string().optional(),
							event: z.string().optional(),
						}),
					},
				},
			},
			"400": {
				description: "Invalid webhook request",
			},
			"401": {
				description: "Webhook signature verification failed",
			},
			"500": {
				description: "Webhook processing failed",
			},
		},
	};

	async handle(c: AppContext) {
		const signatureHeader = c.req.header("x-razorpay-signature");
		if (!signatureHeader) {
			return Response.json({ success: false, reason: "Missing x-razorpay-signature header" }, { status: 401 });
		}

		const webhookSecret = c.env.RAZORPAY_WEBHOOK_SECRET;
		if (!webhookSecret) {
			return Response.json({ success: false, reason: "Missing RAZORPAY_WEBHOOK_SECRET" }, { status: 500 });
		}

		const rawBody = await c.req.text();
		const expectedSignature = await createHmacSha256Hex(webhookSecret, rawBody);
		const expected = hexToBytes(expectedSignature);
		const provided = hexToBytes(signatureHeader.trim().toLowerCase());
		if (!timingSafeEqual(expected, provided)) {
			return Response.json({ success: false, reason: "Invalid webhook signature" }, { status: 401 });
		}

		let payload: RazorpayWebhookPayload;
		try {
			payload = JSON.parse(rawBody) as RazorpayWebhookPayload;
		} catch {
			return Response.json({ success: false, reason: "Invalid JSON payload" }, { status: 400 });
		}

		const event = payload.event;
		if (!event) {
			return Response.json({ success: false, reason: "Missing event in payload" }, { status: 400 });
		}

		if (event !== QR_CREDITED_EVENT) {
			return Response.json({ success: true, ignored: true, reason: "Event ignored", event }, { status: 200 });
		}

		const payment = payload.payload?.payment?.entity;
		const qrCode = payload.payload?.qr_code?.entity;
		const amountPaise = Number(payment?.amount ?? 0);
		if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
			return Response.json({ success: false, reason: "Invalid payment amount" }, { status: 400 });
		}

		const message = buildLedgerBuddyMessage(amountPaise);
		const eventId = payload.id ?? null;
		const paidAtUnix = Number(payment?.created_at ?? payload.created_at ?? Math.floor(Date.now() / 1000));
		const currency = payment?.currency ?? "INR";
		const method = payment?.method ?? "upi";
		const status = payment?.status ?? null;
		const paymentId = payment?.id ?? null;
		const qrCodeId = qrCode?.id ?? null;
		const vpa = payment?.vpa ?? null;

		const insert = await c.env.ledger_buddy_d1.prepare(
			`INSERT OR IGNORE INTO razorpay_qr_credits (
				event_id,
				event,
				payment_id,
				qr_code_id,
				amount_paise,
				currency,
				method,
				vpa,
				status,
				paid_at_unix,
				mqtt_message,
				payload_json,
				signature
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
			.bind(
				eventId,
				event,
				paymentId,
				qrCodeId,
				Math.trunc(amountPaise),
				currency,
				method,
				vpa,
				status,
				Math.trunc(paidAtUnix),
				message,
				rawBody,
				signatureHeader,
			)
			.run();

		const inserted = (insert.meta?.changes ?? 0) > 0;
		if (!inserted) {
			return Response.json({ success: true, stored: false, published: false, reason: "Duplicate webhook event", event });
		}

		try {
			const mqttConfig = getMqttConfig(c);
			await publishToMqtt(message, mqttConfig);
		} catch (error) {
			const detail = error instanceof Error ? error.message : "unknown MQTT publish error";
			return Response.json(
				{ success: false, stored: true, published: false, reason: `Stored payment but MQTT publish failed: ${detail}` },
				{ status: 502 },
			);
		}

		return Response.json({ success: true, stored: true, published: true, event, reason: "Stored and published" }, { status: 200 });
	}
}
