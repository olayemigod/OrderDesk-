# OrderDesk

OrderDesk is a deliberately small SaaS for merchants who sell through WhatsApp.

Customers remain on WhatsApp. Merchants use the OrderDesk mobile app to review, correct and progress structured orders created from incoming WhatsApp messages.

OrderDesk is intentionally **not** an ERP, POS, inventory suite, accounting package or CRM.

## Product flow

1. A customer sends an order on WhatsApp.
2. OrderDesk validates and ingests the Meta webhook.
3. The message is parsed into structured order lines.
4. Parsed wording is matched against the merchant's catalogue names and aliases.
5. Recognized products inherit the merchant's saved selling price; OrderDesk never invents a price.
6. The merchant sees why the order needs review, corrects any unresolved lines and accepts it.
7. The merchant progresses the order through `accepted -> processing -> ready -> completed`.

## Repository layout

- `apps/mobile` — Expo / React Native merchant client, including Expo Web acceptance support.
- `supabase/schema.sql` — foundation schema for a fresh dedicated OrderDesk Supabase project.
- `supabase/migrations` — incremental SaaS, permissions, catalogue and parser-provenance migrations.
- `supabase/functions/whatsapp-webhook` — WhatsApp Cloud API webhook ingestion Edge Function.
- `supabase/functions/provision-business` — authenticated self-service initial business provisioning.
- `docs/architecture.md` — product and technical architecture boundary.
- `docs/live_activation.md` — live activation, acceptance evidence and remaining release-readiness checks.

## Merchant client

The client supports:

- Public email/password signup, sign-in and password recovery.
- Self-service creation of the merchant's first OrderDesk business.
- Tenant-scoped Home, Orders and Business views.
- Multi-business switching without data mixing.
- Realtime order and line-item refresh.
- Business profile editing for Owners/Managers.
- Lightweight catalogue/pricing with aliases.
- WhatsApp message context, parser confidence and review reasons.
- Catalogue-match provenance including original customer wording.
- Merchant correction of `draft` / `needs_review` line items.
- Add, edit and remove order lines.
- Quantity and selling-price correction.
- Acceptance gating until at least one priced line exists.
- Order progression through the supported workflow.

### Run on PC for acceptance

From `apps/mobile`:

```bash
npm install
npx expo start --web --port 3000 -c
```

Then open `http://localhost:3000`.

### Mobile environment

Copy `.env.example` to `.env` and configure the dedicated OrderDesk Supabase project values:

```env
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

Only the publishable client key belongs in the mobile application. Never place the Supabase secret/service key in the client.

## Backend security and integrity

Security and integrity controls include:

- Row Level Security on all exposed application tables.
- Tenant-membership policies.
- Anonymous application-table access revoked.
- Same-tenant composite foreign keys.
- Generated line totals.
- Foreign-key covering indexes.
- Server-side order status transition guard.
- Server-side rejection of empty or unpriced order acceptance.
- Server-only inbound order creation.
- Server-controlled parser and catalogue-match provenance.
- Merchant order updates limited to status/timestamp.
- Merchant order-item changes limited to name, quantity and selling price.
- Realtime publication for orders and order items.

## WhatsApp ingestion

The Edge Function supports:

- Meta GET verification challenge.
- `X-Hub-Signature-256` HMAC validation before payload processing.
- Tenant resolution by WhatsApp phone-number ID.
- Customer upsert.
- Idempotent inbound-message storage by provider message ID.
- Structured `needs_review` order creation.
- Catalogue-backed product matching and pricing.
- Parser source/version and explicit review-reason recording.
- Optional external AI parser integration.
- Conservative fallback parsing when no AI parser is configured or available.

Server secrets such as Meta app secrets, webhook verification tokens, AI provider credentials and Supabase server credentials must remain in Supabase/Edge Function secret storage and must never be committed to this repository or exposed in the merchant client.

## Current checkpoint

OD-02 and OD-03 live merchant workflow acceptance are complete. S1-S3 SaaS context, self-service provisioning and catalogue matching are implemented. S4A parser/match provenance is deployed and Mobile CI #68 passed.

The next bounded slice is S4B: connect a production AI parser using catalogue context while retaining the deterministic matcher/pricer and safe fallback.

See `docs/live_activation.md` for current acceptance evidence and release-readiness gaps.
