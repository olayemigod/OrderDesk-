# SellerTray

SellerTray is a focused mobile SaaS for merchants who sell through WhatsApp.

Customers remain on WhatsApp. Merchants use the SellerTray mobile app to review, correct and progress structured orders created from customer conversations. The MVP deliberately excludes ERP, POS, accounting, inventory valuation and general CRM scope.

> Historical repository, database and RPC identifiers may still contain `orderdesk`. Those are internal compatibility identifiers; the production product identity is SellerTray.

## MVP flow

1. A customer sends an order through WhatsApp.
2. SellerTray validates and stores the inbound message idempotently.
3. The parser structures the request and matches wording against the merchant catalogue.
4. Recognised products inherit merchant-controlled prices; SellerTray does not invent prices.
5. Ambiguous or incomplete orders enter merchant review.
6. The merchant corrects items, quantity or price and accepts or rejects the order.
7. Accepted orders progress through `processing -> ready -> completed`.
8. Configured customer status notifications are queued for WhatsApp delivery.

## Current product state

The core SaaS and code-side production hardening are complete on the governed MVP branch:

- Auth, password recovery and self-service workspace provisioning.
- Tenant/RLS isolation and Owner / Manager / Staff permissions.
- Catalogue, aliases and deterministic pricing.
- Review-first order inbox and governed workflow.
- WhatsApp ingestion and outbound notification foundations.
- Business insights.
- Trial/subscription lifecycle and Paystack adapter.
- ProcessEdge SaaS operations console.
- Structured Edge Function observability and request-size hardening.
- Business-data export and governed account deletion.
- SellerTray production identity, deep-link compatibility and Android EAS profiles.
- Release/rollback runbook and automated repository release preflight.

## Production identity

- App name: **SellerTray**
- Version: **1.0.0**
- Android package: `ng.processedge.sellertray`
- Canonical scheme: `sellertray://`
- Temporary beta compatibility scheme: `orderdesk://`
- Preview Android artifact: APK
- Google Play artifact: AAB

## Run locally

From `apps/mobile`:

```bash
npm install
npm run typecheck
npm run preflight
npx expo start --web --port 3000 -c
```

The mobile client may contain only public client configuration such as the Supabase project URL and publishable key. Service-role keys, AI credentials, Meta/WhatsApp credentials, Paystack secrets and worker tokens must remain server-side.

## Main repository areas

- `apps/mobile` — Expo / React Native merchant app.
- `supabase/migrations` — governed database migrations.
- `supabase/functions` — WhatsApp, parser, provisioning, team, billing, admin and lifecycle server functions.
- `docs/saas_rollout_status.md` — authoritative implementation/release state.
- `docs/release_runbook.md` — Android release, native smoke and rollback contract.
- `docs/data_lifecycle.md` — export, deletion, retention and recovery contract.

## Release acceptance still required

Code completion is not the same as production acceptance. Remaining gates are external:

- Supabase Auth native redirects and leaked-password protection.
- SellerTray launcher/adaptive icon and splash branding.
- Legal approval/publication of SellerTray Privacy Policy and Terms.
- Production Auth/SMTP email delivery.
- Signed preview APK plus physical-device smoke.
- Production AAB.
- Meta WhatsApp production inbound/outbound acceptance.
- Live AI parser acceptance.
- Outbound WhatsApp worker acceptance.
- Approved SellerTray commercial price and Paystack test billing acceptance.

PR #1 remains draft until the relevant gates above pass.
