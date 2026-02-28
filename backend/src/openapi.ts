import type { AppContext } from "./types";
import type { Hono } from "hono";

export function setupOpenApi(app: Hono<AppContext>) {
  app.get("/openapi.json", (c) => {
    const spec = {
      openapi: "3.1.0",
      info: {
        title: c.env.APP_NAME || "LedgerBuddy API",
        version: "1.0.0",
      },
      paths: {
        "/health": {
          get: {
            summary: "Health check",
            responses: {
              "200": {
                description: "Service status",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        status: { type: "string", example: "ok" },
                        app: { type: "string" },
                      },
                      required: ["status", "app"],
                    },
                  },
                },
              },
            },
          },
        },
        "/webhooks/razorpay/payment-credited": {
          post: {
            summary: "Receive Razorpay payment credited webhook",
            parameters: [
              {
                name: "x-razorpay-signature",
                in: "header",
                required: true,
                schema: { type: "string" },
              },
            ],
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: true,
                  },
                },
              },
            },
            responses: {
              "200": {
                description: "Processed or duplicate ignored",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        status: {
                          type: "string",
                          enum: ["ok", "duplicate_ignored"],
                        },
                      },
                      required: ["status"],
                    },
                  },
                },
              },
              "401": { description: "Invalid signature" },
              "400": { description: "Invalid payload" },
            },
          },
        },
        "/announcements/{eventId}/tts": {
          get: {
            summary: "Generate announcement TTS for payment event",
            parameters: [
              {
                name: "eventId",
                in: "path",
                required: true,
                schema: { type: "string" },
              },
              {
                name: "amountPaise",
                in: "query",
                required: true,
                schema: { type: "integer", minimum: 1 },
              },
              {
                name: "currency",
                in: "query",
                required: false,
                schema: { type: "string" },
              },
            ],
            responses: {
              "200": {
                description: "WAV audio",
                content: {
                  "audio/wav": {
                    schema: { type: "string", format: "binary" },
                  },
                },
              },
              "400": { description: "Invalid or missing query params" },
            },
          },
        },
        "/voice/commands": {
          post: {
            summary: "Upload voice command audio",
            security: [{ DeviceToken: [] }],
            parameters: [
              {
                name: "x-device-id",
                in: "header",
                required: false,
                schema: { type: "string" },
              },
            ],
            requestBody: {
              required: true,
              content: {
                "audio/wav": {
                  schema: { type: "string", format: "binary" },
                },
                "application/octet-stream": {
                  schema: { type: "string", format: "binary" },
                },
                "multipart/form-data": {
                  schema: {
                    type: "object",
                    properties: {
                      audio: { type: "string", format: "binary" },
                      deviceId: { type: "string" },
                    },
                    required: ["audio"],
                  },
                },
              },
            },
            responses: {
              "200": {
                description: "Recognized command and generated response",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        commandId: { type: "string" },
                        transcript: { type: "string" },
                        intentId: { type: "number" },
                        responseText: { type: "string" },
                        ttsUrl: { type: "string" },
                      },
                      required: [
                        "commandId",
                        "transcript",
                        "intentId",
                        "responseText",
                        "ttsUrl",
                      ],
                    },
                  },
                },
              },
              "400": { description: "Missing audio file" },
              "401": { description: "Invalid device token" },
            },
          },
        },
        "/voice/commands/{commandId}/tts": {
          get: {
            summary: "Fetch synthesized response audio for a command",
            security: [{ DeviceToken: [] }],
            parameters: [
              {
                name: "commandId",
                in: "path",
                required: true,
                schema: { type: "string" },
              },
            ],
            responses: {
              "200": {
                description: "WAV audio",
                content: {
                  "audio/wav": {
                    schema: { type: "string", format: "binary" },
                  },
                },
              },
              "404": { description: "Command not found" },
              "401": { description: "Invalid device token" },
            },
          },
        },
      },
      components: {
        securitySchemes: {
          DeviceToken: {
            type: "apiKey",
            in: "header",
            name: "x-device-token",
          },
        },
      },
    };

    return c.json(spec);
  });

  app.get("/docs", (c) => {
    const html = `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>LedgerBuddy API Docs</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: '${new URL(c.req.url).origin}/openapi.json',
        dom_id: '#swagger-ui'
      });
    </script>
  </body>
</html>`;

    return c.html(html);
  });
}
