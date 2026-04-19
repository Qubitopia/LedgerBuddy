import { OpenAPIRoute, Str } from "chanfana";
import { connect } from "cloudflare:sockets";
import { z } from "zod";

import type { AppContext } from "../types";

const encoder = new TextEncoder();

type MqttConnAck = {
	returnCode: number;
	sessionPresent: boolean;
};

function encodeUtf8String(value: string): Uint8Array {
	const bytes = encoder.encode(value);
	const output = new Uint8Array(2 + bytes.length);
	output[0] = (bytes.length >> 8) & 0xff;
	output[1] = bytes.length & 0xff;
	output.set(bytes, 2);
	return output;
}

function encodeRemainingLength(length: number): Uint8Array {
	const encoded: number[] = [];
	let value = length;
	do {
		let digit = value % 128;
		value = Math.floor(value / 128);
		if (value > 0) {
			digit = digit | 0x80;
		}
		encoded.push(digit);
	} while (value > 0);

	return Uint8Array.from(encoded);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
	const total = parts.reduce((sum, part) => sum + part.length, 0);
	const result = new Uint8Array(total);
	let offset = 0;

	for (const part of parts) {
		result.set(part, offset);
		offset += part.length;
	}

	return result;
}

function buildConnectPacket(clientId: string, username: string, password: string): Uint8Array {
	const variableHeader = Uint8Array.from([
		0x00,
		0x04,
		0x4d,
		0x51,
		0x54,
		0x54,
		0x04,
		0xc2,
		0x00,
		0x3c,
	]);

	const payload = concatBytes([
		encodeUtf8String(clientId),
		encodeUtf8String(username),
		encodeUtf8String(password),
	]);

	const remaining = encodeRemainingLength(variableHeader.length + payload.length);
	const fixedHeader = Uint8Array.from([0x10]);

	return concatBytes([fixedHeader, remaining, variableHeader, payload]);
}

function buildPublishPacket(topic: string, message: string): Uint8Array {
	const topicBytes = encodeUtf8String(topic);
	const payload = encoder.encode(message);

	const packetId = Uint8Array.from([0x00, 0x01]);

	const remaining = encodeRemainingLength(
		topicBytes.length + packetId.length + payload.length
	);

	const fixedHeader = Uint8Array.from([0x32]);

	return concatBytes([fixedHeader, remaining, topicBytes, packetId, payload]);
}

async function readConnAck(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<MqttConnAck> {
	const chunks: Uint8Array[] = [];
	let totalLength = 0;

	while (totalLength < 4) {
		const { value, done } = await reader.read();
		if (done || !value) {
			break;
		}
		chunks.push(value);
		totalLength += value.length;
	}

	if (totalLength < 4) {
		throw new Error("MQTT broker did not return a complete CONNACK packet");
	}

	const data = concatBytes(chunks);
	if (data[0] !== 0x20 || data[1] !== 0x02) {
		throw new Error("Invalid CONNACK packet from MQTT broker");
	}

	return {
		sessionPresent: (data[2] & 0x01) === 0x01,
		returnCode: data[3],
	};
}

export type MqttConfig = {
	broker: string;
	port: number;
	topic: string;
	username: string;
	password: string;
};

export function getMqttConfig(c: AppContext): MqttConfig {
	const broker = c.env.MQTT_BROKER;
	const username = c.env.MQTT_USERNAME;
	const password = c.env.MQTT_PASSWORD;
	const topic = c.env.MQTT_TOPIC;
	const port = Number(c.env.MQTT_PORT);

	if (!broker || !username || !password) {
		throw new Error("Missing MQTT environment variables: MQTT_BROKER, MQTT_USERNAME, MQTT_PASSWORD");
	}

	if (!Number.isFinite(port) || port <= 0 || port > 65535) {
		throw new Error("Invalid MQTT_PORT environment variable");
	}

	return { broker, username, password, topic, port };
}

export async function publishToMqtt(message: string, config: MqttConfig): Promise<void> {
	const socket = connect(
		{ hostname: config.broker, port: config.port },
		{ secureTransport: "on", allowHalfOpen: false },
	);

	const writer = socket.writable.getWriter();
	const reader = socket.readable.getReader() as ReadableStreamDefaultReader<Uint8Array>;
	const clientId = `ledger-buddy-${crypto.randomUUID().slice(0, 12)}`;

	try {
		await socket.opened;

		await writer.write(buildConnectPacket(clientId, config.username, config.password));
		const connAck = await readConnAck(reader);
		if (connAck.returnCode !== 0) {
			throw new Error(`MQTT connection refused with return code ${connAck.returnCode}`);
		}

		await writer.write(buildPublishPacket(config.topic, message));
		await writer.write(Uint8Array.from([0xe0, 0x00]));
	} finally {
		reader.releaseLock();
		writer.releaseLock();
		await socket.close();
	}
}

export class MqttPublish extends OpenAPIRoute {
	schema = {
		tags: ["MQTT"],
		summary: "Publish a message to HiveMQ",
		request: {
			body: {
				content: {
					"application/json": {
						schema: z.object({
							message: Str({
								description: "Message to publish to HiveMQ",
								example: "hello from worker",
							}),
						}),
					},
				},
			},
		},
		responses: {
			"200": {
				description: "Message published successfully",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							topic: z.string(),
							message: z.string(),
						}),
					},
				},
			},
			"502": {
				description: "Failed to publish to MQTT broker",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							error: z.string(),
						}),
					},
				},
			},
		},
	};

	async handle(c: AppContext) {
		const data = await this.getValidatedData<typeof this.schema>();
		const message = data.body.message;

		try {
			const config = getMqttConfig(c);
			await publishToMqtt(message, config);
			return {
				success: true,
				topic: config.topic,
				message,
			};
		} catch (error) {
			const detail = error instanceof Error ? error.message : "unknown MQTT publish error";
			return Response.json(
				{
					success: false,
					error: detail,
				},
				{ status: 502 },
			);
		}
	}
}
