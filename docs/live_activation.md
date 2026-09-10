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
- `whatsapp-webhook` v5 deployed for provenance recording.
- Supabase security advisor has no new database/RLS finding; the only security warning is leaked-password protection being disabled.
- Performance advisor reports only low-volume unused-index INFO findings.
- Mobile CI #68 passed after aligning stale demo fixtures with the provenance domain.

### S4B external AI parser integration

**IMPLEMENTED — ACTIVATION PENDING SERVER SECRETS / LIVE AI ACCEPTANCE**

- Private `order-parser` Edge Function added and deployed ACTIVE as v1.
- Parser uses the OpenAI Responses API with strict JSON Schema Structured Outputs.
- Default model is `gpt-5.6-luna`, overridable through server-only `OPENAI_PARSER_MODEL`.
- Parser request is limited to customer message plus tenant catalogue names/aliases; merchant prices are deliberately excluded.
- Parser response is limited to `{ items: [{ name, quantity }], confidence }` and is validated again by OrderDesk.
- `order-parser` requires custom bearer-token authentication and fails closed when `ORDER_PARSER_TOKEN` or `OPENAI_API_KEY` is absent.
- `whatsapp-webhook` v6 is ACTIVE and derives the internal parser URL automatically unless an explicit server URL is configured.
- Webhook calls AI only when the shared server token exists; otherwise it keeps the conservative fallback parser.
- Tenant catalogue is now loaded once per inbound order and reused for AI context plus deterministic matching/pricing.
- AI/provider/network/schema failure falls back instead of failing WhatsApp ordering.
- External successful parses will be recorded as `parser_source = external`, `parser_version = external-v2-catalogue`.
- Activation and acceptance contract is documented in `docs/ai_parser_activation.md`.
- Mobile CI #72 passed on the S4B webhook integration head.

### S5A review-first merchant inbox

**PASS — CI**

- Orders screen defaults to `Needs review` instead of an undifferentiated growing list.
- Workflow filters: Needs review, In progress, Completed and All, each with counts.
- Search covers order ID, customer, phone, message and product wording.
- Order cards show received time, known order value or `Needs pricing`, parse confidence and review-check count.
- Normal Orders navigation remains review-first.
- Selecting a specific recent order from Home opens the correct workflow bucket instead of hiding the requested order.
- Status progression keeps the selected order visible as it moves review → active → completed.
- Mobile CI #75 passed on the corrected S5A head.

## Current acceptance checkpoint

Backend ingestion, merchant review/correction, order workflow, tenant isolation, catalogue pricing, parser provenance and the review-first inbox are implemented and gated.

S4B code is deployed safely but is not production-accepted until the server-only OpenAI/shared-token secrets are configured and a new live parser request is exercised. A new real production WhatsApp message is also still required to prove the production phone-number path with the current S3/S4 code. The fixed Meta dashboard sample cannot be reused for that proof because provider-message idempotency correctly rejects duplicate message IDs.

## Next bounded slice

**S5B — order action feedback and exception-focused detail polish.**

Keep the slice bounded to merchant usability: visible pending/success/error state for workflow actions, clearer terminal-state presentation, and concise exception handling without expanding into CRM/POS functionality.

## Release-readiness gaps

1. Complete Meta production/business verification and send one real production WhatsApp order.
2. Configure `OPENAI_API_KEY` and `ORDER_PARSER_TOKEN` directly in Supabase secrets and execute the S4B live AI acceptance checklist.
3. Run one native Android release smoke test.
4. Configure production SMTP for Auth emails.
5. Enable Supabase leaked-password protection if available for the selected Auth plan: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
6. Replace temporary logo URLs with direct upload when the onboarding polish slice reaches media handling.
7. Remove isolated Meta/test fixtures after production E2E and native smoke testing.

Performance advisor currently reports only unused-index INFO findings, expected at the current low data volume.
