# API Contract

## Payment Webhook

`POST /webhooks/razorpay/payment-credited`

Headers:

- `x-razorpay-signature`: HMAC SHA256 hex of raw payload

Behavior:

- Verifies signature
- Inserts essential payment details into D1 with idempotency
- Publishes MQTT event to `voicebox/{deviceId}/payment-events`

## Announcement Audio

`GET /announcements/:eventId/tts?amountPaise=15000&currency=INR`

Returns:

- `audio/wav` bytes with spoken payment amount

## Voice Command Upload

`POST /voice/commands`

Headers:

- `x-device-token`
- optional `x-device-id`
- `content-type: audio/wav` (or other `audio/*`)

Body:

- raw audio bytes

Returns JSON:

```json
{
  "commandId": "uuid",
  "transcript": "today total sales",
  "intentId": 1,
  "responseText": "Today's total is 150.00 rupees.",
  "ttsUrl": "https://.../voice/commands/{commandId}/tts"
}
```

## Voice Command TTS Fetch

`GET /voice/commands/:commandId/tts`

Headers:

- `x-device-token`

Returns:

- `audio/wav`

## Intent Mapping

- `0`: unknown
- `1`: today total sales
- `2`: last payment amount

## D1 Tables

- `payment_events`
- `voice_commands`
- `intent_executions`
- `devices`
