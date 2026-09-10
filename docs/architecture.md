# SellerTray MVP Architecture

## Product boundary

SellerTray turns conversational WhatsApp buying requests into an organised merchant order workflow without forcing customers into another app.

Customers stay on WhatsApp. Merchants operate from the SellerTray mobile application.

SellerTray is intentionally not an ERP, POS, accounting package, inventory-valuation system or general CRM. Additional sales channels are future paid modules rather than bundled MVP scope.

Historical repository/database/RPC names containing `orderdesk` are internal compatibility identifiers. The production identity is SellerTray.

## Runtime components

- **SellerTray mobile app** — Expo / React Native merchant client.
- **Supabase Auth** — merchant identity and sessions.
- **Postgres + RLS** — tenant-scoped operational data and integrity rules.
- **WhatsApp webhook Edge Function** — public Meta webhook protected by HMAC signature.
- **Order parser Edge Function** — private shared-token AI parser with deterministic fallback.
- **Notification worker Edge Function** — token-gated outbound WhatsApp queue worker.
- **Provisioning / Team / Billing / Platform Admin / Account Lifecycle functions** — JWT-protected server boundaries.
- **Paystack webhook** — provider-signed billing reconciliation endpoint.
- **ProcessEdge web resources** — public account-deletion resource and SellerTray legal pages.

## Core order flow

1. Customer sends a WhatsApp message to the merchant.
2. Meta sends the signed webhook to SellerTray.
3. SellerTray verifies the Meta signature and resolves the merchant tenant by phone-number ID.
4. The provider message is stored idempotently.
5. Customer identity is upserted inside that tenant.
6. The parser extracts product wording and quantities. External AI is optional; conservative fallback remains available.
7. Catalogue names/aliases are matched deterministically and merchant-controlled prices are applied. SellerTray does not ask AI to invent selling prices.
8. The order is stored as `needs_review` when human review is required.
9. Merchant corrects lines/quantity/pricing and accepts or rejects.
10. Accepted orders progress through `processing -> ready -> completed`; active orders may be cancelled with a reason.
11. Status transitions are recorded in immutable order history.
12. Configured customer notifications enter the outbound queue and are sent only when the WhatsApp conversation/template policy allows.

## Main data domains

- `tenants` — merchant businesses and product state.
- `tenant_members` / `tenant_invitations` — Owner, Manager and Staff access.
- `catalog_items` / aliases — merchant product names and prices.
- `customers` — tenant-scoped WhatsApp customers.
- `inbound_messages` — provider message audit/idempotency.
- `orders` / `order_items` — merchant order workflow and lines.
- `order_status_events` — immutable workflow history.
- `tenant_notification_settings` / `outbound_notifications` — notification preferences and delivery queue/history.
- `subscription_plans` / `tenant_subscriptions` — trial and subscription lifecycle.
- `billing_checkout_sessions` / provider-event ledger — billing reconciliation.
- `platform_admins` / platform audit / support notes — ProcessEdge operations boundary.

Composite tenant foreign keys and Row Level Security protect tenant isolation even if client logic is faulty.

## Trust boundaries

### Mobile client

The client receives only public client configuration: Supabase URL and publishable key. It never contains Supabase service-role keys, Meta secrets, AI keys, Paystack secrets, parser tokens or worker tokens.

UI permissions are convenience; server/database rules remain authoritative.

### Public provider endpoints

- WhatsApp webhook: Meta HMAC signature.
- Paystack webhook: Paystack signature/secret validation.
- Order parser: custom server bearer token.
- Notification worker: server worker token.

Every body-consuming server endpoint has a streamed request-size limit. All nine current Edge Functions have structured request observability and request correlation.

### Authenticated server endpoints

Provisioning, team management, billing checkout, platform administration and account lifecycle require authenticated JWTs. Elevated database functions are service-role-only where required.

## Order integrity

Normal progression:

`draft / needs_review -> accepted -> processing -> ready -> completed`

Alternative terminal states:

- review order -> `rejected`
- accepted / processing / ready -> `cancelled`

Server-side guards reject unsupported transitions and prevent acceptance of an empty or unpriced order.

## AI contract

AI may extract likely item wording, quantity and confidence. It must not be authoritative for merchant price, stock availability, discount, delivery charge or payment confirmation. Catalogue matching/pricing remains deterministic, and ambiguous output remains reviewable by the merchant.

## Subscription contract

SellerTray uses a low base subscription plus separately metered/chargeable activity as the commercial direction. The current provider-neutral subscription lifecycle supports trial, active, past-due/grace, suspended and cancelled/read-only states. Paystack activation remains gated until final commercial values and provider acceptance are approved.

## Data lifecycle

Business Owners can export the workspace dataset. Authenticated users have a governed password-confirmed deletion path. Owned tenant data and memberships are removed before Auth deletion so a stale access token has no remaining tenant authorization.

See `docs/data_lifecycle.md`.

## Production identity

- Name: SellerTray
- Version: 1.0.0
- Android package: `ng.processedge.sellertray`
- Canonical deep link: `sellertray://`
- Temporary beta compatibility: `orderdesk://`
- Android preview: APK
- Google Play artifact: AAB

## Release governance

Repository-level release invariants are enforced by `npm run preflight` in Mobile CI.

External acceptance is tracked in `docs/release_acceptance.json` and checked with `npm run release:check`. That command must remain a release hold until all required external gates have accepted evidence.
