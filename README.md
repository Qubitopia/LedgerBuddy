# LedgerBuddy

UPI payment voice box + voice command system.

## Workspace Layout

- `backend/` Cloudflare Worker API using Hono + Chanfana + D1
- `firmware/` ESP32 PlatformIO firmware scaffold

## Backend Quick Start

1. `cd backend`
2. `npm install`
3. Copy `.dev.vars.example` to `.dev.vars` and set secrets.
4. Create D1 and set `database_id` in `wrangler.toml`.
5. Apply migrations: `npm run d1:migrate`
6. Start local worker: `npm run dev`

## Firmware Quick Start

1. Open `firmware/` in PlatformIO.
2. Update Wi-Fi/API/MQTT values in `firmware/src/config.h`.
3. Wire hardware:
   - INMP441 to ESP32 I2S mic pins in config
   - MAX98357A to ESP32 I2S speaker pins in config
   - SD CS to `PIN_SD_CS`
   - Button to `PIN_BUTTON` (active LOW)
4. Build and flash.

## Current API Endpoints

- `POST /webhooks/razorpay/payment-credited`
- `GET /announcements/:eventId/tts?amountPaise=...&currency=INR`
- `POST /voice/commands` (device token required; accepts `audio/*` body)
- `GET /voice/commands/:commandId/tts` (device token required)
- `GET /health`
- `GET /docs` and `GET /openapi.json`

## MQTT Topic

- Publish from backend: `voicebox/{deviceId}/payment-events`

## Notes

- HiveMQ publish currently expects an HTTP publish endpoint (`HIVEMQ_PUBLISH_ENDPOINT`) with Basic Auth. If you use direct MQTT-only broker access, add a bridge or Worker-compatible MQTT publisher.
- Firmware playback and recording modules are scaffolded and ready for hardware-specific I2S tuning.
