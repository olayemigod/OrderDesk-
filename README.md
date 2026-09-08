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
supabase/schema.sql                  tenant-safe Postgres/RLS schema
supabase/functions/whatsapp-webhook/ Meta WhatsApp webhook ingestion
docs/architecture.md                product and technical boundaries
```

## Mobile app

Current baseline: Expo SDK 57 / React Native 0.86.

```bash
cd apps/mobile
cp .env.example .env
# configure the dedicated OrderDesk Supabase URL + publishable key
npm install
npm run typecheck
npm start
```

The mobile app now uses authenticated Supabase data rather than fixtures. A merchant must have an Auth user plus a matching `tenant_members` row. Row Level Security limits reads and mutations to that merchant's tenant memberships.

Order changes and order-item changes are subscribed through Supabase Realtime Postgres Changes. The source schema adds both tables to the `supabase_realtime` publication when that publication exists.

## Backend

`supabase/schema.sql` defines tenant, membership, customer, catalogue, message, order and order-item models with Row Level Security and same-tenant composite foreign keys.

The WhatsApp Edge Function implements:

- Meta GET verification challenge
- `X-Hub-Signature-256` HMAC verification before JSON parsing
- tenant resolution by WhatsApp phone number ID
- customer upsert
- provider-message idempotency
- structured draft order creation
- provider-neutral AI parser adapter with conservative fallback parsing

## Required server secrets

The webhook requires server-side secrets and they must never be shipped in the mobile app:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `META_WEBHOOK_VERIFY_TOKEN`
- `META_APP_SECRET`
- optional `ORDER_PARSER_URL`
- optional `ORDER_PARSER_TOKEN`

## Live environment status

No live Supabase project is modified by this branch yet. The next deployment checkpoint is a dedicated OrderDesk Supabase project, schema/advisor verification, webhook deployment, first merchant provisioning, Meta webhook mapping and an end-to-end WhatsApp-to-mobile acceptance test.

## Stack

- Mobile: Expo + React Native + TypeScript
- Backend: Supabase Postgres, Auth, Realtime and Edge Functions
- WhatsApp: Meta WhatsApp Cloud API
- AI: provider-neutral structured order parser
