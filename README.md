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
5. Merchant reviews it in the mobile inbox.
6. Merchant accepts/rejects and progresses the order to processing, ready and completed.

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
npm install
npm run typecheck
npm start
```

The first screen uses fixtures so the merchant workflow can be iterated independently of cloud setup. The next implementation slice replaces the fixture repository with authenticated Supabase data and realtime refresh.

## Backend

`supabase/schema.sql` defines the initial tenant, membership, customer, catalogue, message, order and order-item model with Row Level Security for merchant-facing access.

The WhatsApp Edge Function implements:

- Meta GET verification challenge
- `X-Hub-Signature-256` HMAC verification before JSON parsing
- tenant resolution by WhatsApp phone number ID
- customer upsert
- provider-message idempotency
- structured draft order creation
- provider-neutral AI parser adapter with conservative fallback parsing

No live Supabase project is modified by this branch yet.

## Stack

- Mobile: Expo + React Native + TypeScript
- Backend: Supabase Postgres, Auth, Realtime and Edge Functions
- WhatsApp: Meta WhatsApp Cloud API
- AI: provider-neutral structured order parser
