# OrderDesk SaaS Rollout Status

This document records the governed rollout state for OrderDesk. OrderDesk remains a focused WhatsApp-order SaaS: customers stay on WhatsApp; merchants use the mobile app. ERP, POS, accounting, inventory valuation and general CRM are outside the MVP contract.

## Implemented and gated

### S1 — SaaS business context and shell — PASS
- Tenant/business isolation and persisted active-business context.
- Home / Orders / Business mobile shell.
- Owner/Manager business profile editing; Staff read-only.
- Platform-controlled onboarding, subscription and WhatsApp state.

### S2 — signup and self-service provisioning — PASS
- Email/password signup, confirmation and password recovery.
- New merchant can create one initial business without manual SQL.
- Creator becomes Owner and receives a trial subscription.
- Provisioning is behind a JWT-protected Edge Function; elevated DB transaction is service-role-only.

### S3 — catalogue and deterministic pricing — PASS
- Product name, selling price, SKU, category, aliases, active state and image-URL placeholder.
- Owner/Manager catalogue writes.
- WhatsApp wording resolves against merchant catalogue names/aliases.
- Recognized products inherit merchant price; OrderDesk never invents selling prices.

### S4A — parser provenance — PASS
- Parser source/version and review reasons on orders.
- Original wording, match source and confidence on order lines.
- Provenance is server-controlled and merchant UI explains review causes.

### S5 — merchant operating experience — PASS
- Review-first inbox, workflow filters and search.
- Merchant correction/pricing before acceptance.
- Action pending/success/error feedback and duplicate-tap suppression.
- Reasoned rejection/cancellation with server enforcement.
- Server-recorded immutable status history.

### S6 — outbound notification foundation and merchant controls — PASS FOUNDATION
- Deterministic Received / Accepted / Ready / Rejected / Cancelled notification events.
- Durable outbound queue with retries, worker claiming and stale-lease recovery.
- WhatsApp 24-hour-window routing and `template_required` state.
- Owner/Manager notification switches; Staff read-only.
- Delivery state visible to merchants without exposing provider credentials.
- Production sending remains activation-pending while Meta verification/credentials are incomplete.

### S7 — team and permissions — PASS
- Owner / Manager / Staff role model.
- Pending email invitations before signup and automatic claim after sign-in.
- Owner protection; Managers may manage Staff only.
- Direct merchant writes to membership/invitation tables are denied.
- Team mutations respect subscription access.

### S8 — business intelligence — PASS
- Server-side tenant-timezone-aware Today, 7-day, previous-period, 30-day and top-item metrics.
- Owner/Manager business performance view; Staff operational view.
- Realtime refresh on order/item changes.

### S9A — subscription lifecycle and enforcement — PASS
- Provider-neutral `OrderDesk Business` plan contract.
- 14-day trial default.
- Active / Past due / Grace / Suspended / Cancelled lifecycle.
- Expired/suspended businesses retain read access while operational writes fail server-side.
- WhatsApp ingestion stores the signed inbound message for audit/idempotency and skips new order creation for read-only tenants without causing Meta retry storms.
- Every new tenant automatically receives a subscription row.

### S9B — Paystack billing adapter — IMPLEMENTED, ACTIVATION PENDING
- Owner-only JWT-protected checkout endpoint.
- HMAC-SHA512 Paystack webhook and idempotent provider-event ledger.
- Matching OrderDesk checkout reference required before `charge.success` can activate a tenant.
- Recurring subscription/payment-success/failure/non-renewal/disable reconciliation.
- Billing remains deliberately inactive until an approved monthly price, Paystack plan reference and server secret are configured.
- Current `checkout_ready = false`; no billing event has charged or activated a tenant.

### S10A — ProcessEdge SaaS operations console — PASS AUTOMATED / VISUAL SMOKE PENDING
- Separate `platform_admins` role space; merchant Owner/Manager roles do not confer platform access.
- ProcessEdge admin overview for tenant health, subscription state, WhatsApp state, order activity, notification exceptions and team size.
- Controlled subscription, trial-extension, WhatsApp-state and internal-support-note actions.
- Suspension/cancellation requires explicit confirmation in UI.
- Immutable platform-admin audit trail and audit viewer.
- Direct authenticated access to admin tables/RPCs is denied; JWT-protected `platform-admin` Edge Function fronts service-role RPCs.
- Admin-only accounts can enter SaaS Operations without owning a merchant workspace.
- Self-cleaning live DB smoke proved overview, mutation and audit retrieval; test tenant removed afterward.
- Mobile CI #144 passed on the final S10A mobile head.

## Activation-pending services

These are implemented but must not be described as production-accepted yet:

1. **Meta production WhatsApp** — business/app verification and one real production inbound/outbound E2E are still required.
2. **AI parser** — configure server-only `OPENAI_API_KEY` and `ORDER_PARSER_TOKEN`, then run live AI acceptance. Do not put secrets in the mobile app, repository or chat.
3. **Outbound WhatsApp worker** — configure server-only worker/Meta credentials after Meta production approval and acceptance-test delivery.
4. **Paystack billing** — approve commercial monthly price, create/configure Paystack plan reference and server secret, then run test-mode checkout/webhook acceptance before live mode.
5. **Production email** — configure production SMTP/Auth email delivery.

## S11 — production hardening — NEXT

The hardening gate must cover at minimum:
- Error/health observability for webhook, parser, notification, billing and admin functions.
- Security/RLS regression checks and platform-admin boundary checks.
- Data backup/recovery verification and retention policy.
- Rate/abuse controls on public and authenticated server boundaries.
- Production Auth URL/deep-link configuration and leaked-password protection where available.
- Privacy policy, Terms of Service and account/data deletion/export operating contract.
- Signed Android production build configuration and native smoke test.
- Release/versioning and rollback runbook.

## Commercial launch gate

OrderDesk is ready for a paid pilot only when S11 passes and the relevant external services are activation-accepted. PR #1 remains draft until the production E2E/release gate is explicitly approved.
