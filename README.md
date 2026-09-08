# OrderDesk

OrderDesk is a lightweight AI-assisted order management SaaS for small merchants who sell through WhatsApp.

## Product contract

- Customers stay on WhatsApp.
- Merchants operate from a mobile app.
- OrderDesk converts free-form customer messages into structured draft orders.
- Merchants review, accept, reject and progress orders from the app.
- The MVP is intentionally not an ERP, POS, inventory suite, CRM or accounting system.

## MVP vertical slice

1. WhatsApp message arrives.
2. Signed webhook validates and stores the event idempotently.
3. Parser converts order intent into structured line items.
4. Order is created as `needs_review`.
5. Authenticated merchant receives the order in the mobile inbox.
6. Merchant accepts/rejects and progresses it to processing, ready and completed.

## Repository structure

```text
apps/mobile/                         Expo merchant mobile app
supabase/schema.sql                  tenant-safe Postgres/RLS source schema
supabase/functions/whatsapp-webhook/ Meta WhatsApp webhook ingestion
docs/architecture.md                product and technical boundaries
```

## Mobile app

Current baseline: Expo SDK 57 / React Native 0.86.

```bash
cd apps/mobile
cp .env.example .env
npm install
npm run typecheck
npm start
```

The mobile app is wired to the dedicated OrderDesk Supabase project through the project URL and publishable key in `.env.example`. Merchant sessions are persisted, order reads are RLS-filtered, status changes are written back to Supabase, and order/order-item changes refresh through Realtime.

## Live Supabase environment

Dedicated project: `OrderDesk`

Project ref: `eujxswjspolugrzlsjnn`

The live database contains the tenant, membership, customer, catalogue, inbound-message, order and order-item model with Row Level Security. Anonymous table reads are denied. `orders` and `order_items` are enabled for Realtime Postgres Changes.

Applied migrations:

- `orderdesk_mvp_foundation`
- `add_orderdesk_fk_indexes`

Supabase security advisor is clean. Performance advisor has no missing-foreign-key-index findings; the only current notices are unused-index informational notices expected on a new empty database.

## WhatsApp webhook

The `whatsapp-webhook` Edge Function is deployed and active. It implements:

- Meta GET verification challenge
- `X-Hub-Signature-256` HMAC verification before JSON parsing
- tenant resolution by WhatsApp phone number ID
- customer upsert
- provider-message idempotency
- structured draft order creation
- provider-neutral AI parser adapter with conservative fallback parsing

The function deliberately has Supabase JWT verification disabled because Meta cannot send a Supabase JWT; webhook POST authentication is instead enforced with Meta's HMAC signature. GET verification requires the configured Meta verify token.

## Required server secrets

The webhook requires server-side secrets and they must never be shipped in the mobile app:

- `SUPABASE_URL` (injected by Supabase)
- `SUPABASE_SERVICE_ROLE_KEY` (injected by Supabase)
- `META_WEBHOOK_VERIFY_TOKEN`
- `META_APP_SECRET`
- optional `ORDER_PARSER_URL`
- optional `ORDER_PARSER_TOKEN`

The tenant must also be mapped to the Meta `whatsapp_phone_number_id` before messages can produce orders.

## Remaining live activation

- configure Meta verify token and app secret in Edge Function secrets
- create the first merchant Auth user and tenant membership
- map the merchant tenant to its WhatsApp phone number ID
- complete Meta webhook subscription
- execute the first end-to-end test: WhatsApp message -> structured draft -> merchant mobile inbox -> Accept order

## Stack

- Mobile: Expo + React Native + TypeScript
- Backend: Supabase Postgres, Auth, Realtime and Edge Functions
- WhatsApp: Meta WhatsApp Cloud API
- AI: provider-neutral structured order parser
