import { Hono } from "hono";
import { insertPaymentEvent } from "../db/queries";
import type { AppContext } from "../types";
import { verifyHmacSha256Hex } from "../utils/crypto";
import { publishPaymentNotification } from "../services/mqtt";

export const webhooksRoute = new Hono<AppContext>();

webhooksRoute.post("/razorpay/payment-credited", async (c) => {
  const signature = c.req.header("x-razorpay-signature") || "";
  const rawBody = await c.req.text();

  const ok = await verifyHmacSha256Hex(rawBody, c.env.RAZORPAY_WEBHOOK_SECRET, signature);
  if (!ok) {
    return c.json({ error: "Invalid signature" }, 401);
  }

  const payload = JSON.parse(rawBody) as any;
  const eventId = payload.event || payload.payload?.payment?.entity?.id;
  const payment = payload.payload?.payment?.entity;
  const amountPaise = Number(payment?.amount || 0);
  const currency = String(payment?.currency || c.env.DEFAULT_CURRENCY);
  const paidAt = new Date((payment?.created_at || Math.floor(Date.now() / 1000)) * 1000).toISOString();
  const deviceId = String(payment?.notes?.deviceId || "default-device");

  if (!eventId || !amountPaise) {
    return c.json({ error: "Invalid Razorpay payload" }, 400);
  }

  const dedupeKey = `${eventId}:${payment?.id || "na"}`;

  try {
    await insertPaymentEvent(c.env.DB, {
      eventId,
      dedupeKey,
      deviceId,
      amountPaise,
      currency,
      paidAt,
      rawPayload: rawBody
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown DB error";
    if (message.includes("UNIQUE")) {
      return c.json({ status: "duplicate_ignored" }, 200);
    }
    throw error;
  }

  await publishPaymentNotification(c.env, {
    type: "payment_credited",
    eventId,
    deviceId,
    amountPaise,
    currency,
    paidAt
  });

  return c.json({ status: "ok" }, 200);
});
