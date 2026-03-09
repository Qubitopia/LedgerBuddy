import type { Context } from "hono";

declare global {
	interface Env {
		MQTT_BROKER: string;
		MQTT_USERNAME: string;
		MQTT_PASSWORD: string;
		MQTT_PORT?: string;
		MQTT_TOPIC?: string;
		DEEPGRAM_API_KEY?: string;
		GEMINI_API_KEY?: string;
		RAZORPAY_WEBHOOK_SECRET: string;
		ledger_buddy_d1: D1Database;
	}
}

export type AppContext = Context<{ Bindings: Env }>;
