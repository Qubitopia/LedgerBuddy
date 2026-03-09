<<<<<<< Updated upstream
# LedgerBuddy
=======
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
5. Apply migrations: `npx wrangler d1 migrations apply ledger_buddy_d1 --local` use --remote for cloud.
6. Start local worker: `wrangler dev`
>>>>>>> Stashed changes
