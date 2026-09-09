# OrderDesk

OrderDesk is a deliberately small SaaS for merchants who sell through WhatsApp.

Customers remain on WhatsApp. Merchants use the OrderDesk mobile app to review, correct and progress structured orders created from incoming WhatsApp messages.

OrderDesk is intentionally **not** an ERP, POS, inventory suite, accounting package or CRM.

## MVP product boundary

OrderDesk handles one narrow operational problem:

1. A customer sends an order on WhatsApp.
2. OrderDesk receives and validates the webhook.
3. The message is converted into a structured `needs_review` order.
4. The merchant reviews the parsed lines, corrects item names/quantities and sets selling prices when needed.
5. An order can only be accepted when it contains at least one fully priced line item.
6. The merchant progresses the order through `accepted -> processing -> ready -> completed`.

## Repository layout

- `apps/mobile` — Expo / React Native merchant client, including Expo Web acceptance support.
- `supabase/schema.sql` — source schema for a fresh dedicated OrderDesk Supabase project.
- `supabase/migrations` — incremental database migrations applied after the foundation schema.
- `supabase/functions/whatsapp-webhook` — WhatsApp Cloud API webhook ingestion Edge Function.
- `docs/architecture.md` — product and technical architecture boundary.
- `docs/live_activation.md` — live activation, acceptance evidence and remaining release-readiness checks.

## Merchant client

The client supports:

- Supabase email/password authentication.
- Password recovery for native/mobile and PC web acceptance.
- Tenant-scoped live order inbox through RLS.
- Realtime order and line-item refresh.
- WhatsApp message context and parser confidence.
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

## Live backend

The MVP schema provides tenant-scoped tables for:

- tenants and merchant memberships
- customers
- catalog items
- inbound messages
- orders
- order items

Security and integrity controls include:

- Row Level Security on all exposed application tables.
- Tenant-membership policies.
- Anonymous application-table access revoked.
- Same-tenant composite foreign keys.
- Generated line totals.
- Foreign-key covering indexes.
- Server-side order status transition guard.
- Server-side rejection of empty or unpriced order acceptance.
- Realtime publication for orders and order items.

## WhatsApp webhook

The Edge Function supports:

- Meta GET verification challenge.
- `X-Hub-Signature-256` HMAC validation before payload processing.
- Tenant resolution by WhatsApp phone-number ID.
- Customer upsert.
- Idempotent inbound-message storage by provider message ID.
- Structured `needs_review` order creation.
- Optional provider-neutral AI parser integration.
- Conservative fallback parsing when no AI parser is configured.

Server secrets such as Meta app secrets, webhook verification tokens and Supabase server credentials must remain in Supabase/Edge Function secret storage and must never be committed to this repository or exposed in the merchant client.

## Current acceptance status

The live backend and merchant workflow have passed the first E2E acceptance path using an isolated Meta sample tenant and the PC web client:

`Meta webhook -> needs_review -> accepted -> processing -> ready -> completed`

OD-03 adds merchant order-line correction and server-side status hardening. See `docs/live_activation.md` for the current acceptance checkpoint and release-readiness gaps.
