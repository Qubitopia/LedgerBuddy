# Cloudflare Workers OpenAPI 3.1

This is a Cloudflare Worker with OpenAPI 3.1 using [chanfana](https://github.com/cloudflare/chanfana) and [Hono](https://github.com/honojs/hono).

This is an example project made to be used as a quick start into building OpenAPI compliant Workers that generates the
`openapi.json` schema automatically from code and validates the incoming request to the defined parameters or request body.

## Get started

1. Sign up for [Cloudflare Workers](https://workers.dev). The free tier is more than enough for most use cases.
2. Clone this project and install dependencies with `npm install`
3. Run `wrangler login` to login to your Cloudflare account in wrangler
4. Run `wrangler deploy` to publish the API to Cloudflare Workers

## Project structure

1. Your main router is defined in `src/index.ts`.
2. Each endpoint has its own file in `src/endpoints/`.
3. For more information read the [chanfana documentation](https://chanfana.pages.dev/) and [Hono documentation](https://hono.dev/docs).

## Development

1. Run `wrangler dev` to start a local instance of the API.
2. Open `http://localhost:8787/` in your browser to see the Swagger interface where you can try the endpoints.
3. Changes made in the `src/` folder will automatically trigger the server to reload, you only need to refresh the Swagger interface.

## Razorpay QR webhook to D1 + MQTT

This project includes a webhook endpoint at `/api/webhooks/razorpay`.

What it does:

1. Verifies Razorpay webhook signature using `x-razorpay-signature` and `RAZORPAY_WEBHOOK_SECRET`.
2. Processes only `qr_code.credited` events.
3. Stores essential payment details in D1 table `razorpay_qr_credits`.
4. Publishes a message to MQTT, for example: `250 rupees received on Ledger Buddy`.

### 1) Create and bind D1 database

```bash
npx wrangler d1 create ledger-buddy
```

Copy the returned `database_id` into `wrangler.jsonc` under `d1_databases[0].database_id`.

### 2) Run migration

```bash
npx wrangler d1 execute ledger-buddy --local --file=./migrations/0001_create_razorpay_qr_credits.sql
npx wrangler d1 execute ledger-buddy --remote --file=./migrations/0001_create_razorpay_qr_credits.sql
```

### 3) Configure secrets and MQTT vars

```bash
npx wrangler secret put RAZORPAY_WEBHOOK_SECRET
npx wrangler secret put MQTT_PASSWORD
```

Set non-secret vars in `wrangler.jsonc` (or as secrets if preferred):

- `MQTT_BROKER`
- `MQTT_USERNAME`
- `MQTT_PORT` (optional, default `8883`)
- `MQTT_TOPIC` (optional)

### 4) Configure Razorpay webhook

Point Razorpay webhook URL to:

```text
https://<your-worker-domain>/api/webhooks/razorpay
```

Ensure the same webhook secret is used in Razorpay and Worker (`RAZORPAY_WEBHOOK_SECRET`).
