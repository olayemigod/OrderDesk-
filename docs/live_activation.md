# OrderDesk Live Activation Checklist

Dedicated Supabase project: `OrderDesk` (`eujxswjspolugrzlsjnn`).

## Completed

### OD-01 / OD-02 foundation

- Tenant-scoped schema with RLS and same-tenant foreign-key integrity.
- Anonymous application-table access denied.
- `orders` and `order_items` enabled for Realtime.
- WhatsApp webhook deployed with Meta verification and HMAC signature validation.
- Real merchant tenant mapped to the production WhatsApp phone-number ID.
- Isolated Meta test tenant retained without altering the real mapping.
- Meta sample ingestion and duplicate-message idempotency verified.
- Merchant Auth/RLS access verified.
- Merchant workflow accepted through `needs_review -> accepted -> processing -> ready -> completed`.

### OD-03 merchant review hardening

- Server-side order-state transition guard deployed.
- Empty or unpriced orders cannot be accepted.
- Merchant review editor supports add/edit/remove/correct name/quantity/price.
- Correction test passed with `2 × rice at ₦45,000 + 3 × oil at ₦5,600 = ₦106,800` through completion.

### S1 SaaS business context

- Tenant SaaS profile/state: contact/type/logo placeholder, currency, timezone, onboarding, subscription and WhatsApp state.
- Active business context persisted on-device.
- Tenant-scoped order reads and Realtime subscriptions.
- Multi-business switching without order mixing.
- SaaS `Home / Orders / Business` navigation shell.
- Owner/Manager business-profile editing; Staff read-only.
- Subscription/onboarding/WhatsApp platform state protected from merchant edits.

### S2 self-service SaaS onboarding foundation

- Public email/password signup implemented.
- Email-confirmation-aware flow plus password recovery retained.
- Signed-in user with no workspace can provision one initial business without SQL/manual ProcessEdge intervention.
- Creator becomes Owner; Trial/onboarding state initialized automatically.
- Provisioning uses JWT-protected `provision-business` Edge Function.
- Elevated provisioning transaction is service-role-only.
- Security-advisor finding for authenticated SECURITY DEFINER execution was eliminated.

### S3 catalogue and pricing

- Merchant catalogue supports product name, selling price, SKU, category, image URL placeholder and active/inactive state.
- Product aliases/customer wording supported.
- Owner/Manager catalogue changes; Staff read-only.
- First active priced item advances onboarding to WhatsApp connection.
- WhatsApp webhook resolves parsed wording against catalogue names/aliases.
- Recognized items receive canonical product ID/name and saved selling price.
- Conservative singular/plural container normalization is supported.
- Unrecognized items remain unpriced rather than receiving an invented price.
- `whatsapp-webhook` v4 deployed for catalogue-backed ingestion.
- Mobile CI #58 and #59 passed for S3A/S3B.

### S4A parser provenance and review contract

- Orders record parser source, parser version and explicit review reasons.
- Order lines record original customer wording, catalogue match source and match confidence.
- Review reasons include no items, fallback parser, low parser confidence, unmatched catalogue item and missing price.
- Merchant UI explains why an order needs review and shows catalogue-match provenance.
- Parser and catalogue-match provenance are server-controlled.
- Authenticated merchants can update only order `status` / `updated_at`.
- Authenticated merchants can insert/update only merchant-correctable order-item fields: item name, quantity and selling price.
- Direct authenticated order creation is revoked; inbound orders are server-created.
- Existing historical records remain marked `legacy`; future manual provenance defaults to `manual` where applicable.
- `whatsapp-webhook` v5 is ACTIVE.
- Supabase security advisor has no new database/RLS finding; the only security warning is leaked-password protection being disabled.
- Performance advisor reports only low-volume unused-index INFO findings.
- Mobile CI #68 passed after aligning stale demo fixtures with the provenance domain.

## Current acceptance checkpoint

Backend ingestion, merchant review/correction, order workflow, tenant isolation, catalogue pricing and S4A provenance are implemented and gated.

A new real production WhatsApp message is still required to prove the full production-number path with the current catalogue/provenance code. The fixed Meta dashboard sample cannot be reused for that proof because provider-message idempotency correctly rejects duplicate message IDs.

## Next bounded slice

**S4B — external production AI parser integration.**

The existing webhook already has a provider-neutral parser adapter and safe fallback. S4B should:

1. Pass tenant catalogue context into the parser request.
2. Require structured `{ items, confidence }` output.
3. Keep the deterministic catalogue matcher/pricer authoritative after AI extraction.
4. Fall back safely when the external parser is unavailable or invalid.
5. Never allow the AI layer to invent merchant selling prices.

## Release-readiness gaps

1. Complete Meta production/business verification and send one real production WhatsApp order.
2. Configure and acceptance-test the production AI parser.
3. Run one native Android release smoke test.
4. Configure production SMTP for Auth emails.
5. Enable Supabase leaked-password protection if available for the selected Auth plan: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
6. Replace temporary logo URLs with direct upload when the onboarding polish slice reaches media handling.
7. Remove isolated Meta/test fixtures after production E2E and native smoke testing.

Performance advisor currently reports only unused-index INFO findings, expected at the current low data volume.
