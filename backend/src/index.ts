import { fromHono } from "chanfana";
import { Hono } from "hono";
import { HealthCheck } from "./endpoints/health";
import { MqttPublish } from "./endpoints/mqttPublish";
import { RazorpayWebhook } from "./endpoints/razorpayWebhook";
import { VoiceCommand } from "./endpoints/voiceCommand";

// Start a Hono app
const app = new Hono<{ Bindings: Env }>();

// Setup OpenAPI registry
const openapi = fromHono(app, {
	docs_url: "/",
});

// Register OpenAPI endpoints
openapi.get("/health", HealthCheck);
openapi.post("/api/mqtt/publish", MqttPublish);
openapi.post("/api/webhooks/razorpay", RazorpayWebhook);
openapi.post("/api/voice/command", VoiceCommand);

// Export the Hono app
export default app;
