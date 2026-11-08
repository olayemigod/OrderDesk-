# OA5 — proposed non-production Meta and Paystack callback acceptance plan

**Date:** 08/11/2026. **Status:** REVIEW PROPOSAL, not permission to create
provider resources, deploy an Edge Function, or send messages/payments.

## Current verified provider baselines

The owner-supplied OA5 provider audit found the live Meta application
`SellerTray` targeting Production `eujxswjspolugrzlsjnn` at
`/functions/v1/whatsapp-webhook`, with `messages` subscription.
Paystack live webhook targets the Production platform `paystack-webhook`;
Paystack Test callback and webhook are empty. The inspected Flutterwave
account has empty Test and live webhook fields. Test project
`iukgsukdoowvnhlfmpml` has no WhatsApp or payment callback Edge Functions
deployed and no current provider connection/payment/notification activity.
These findings establish current-state isolation, NOT a future callback
delivery test or approval to reuse live credentials.

## Proposed Meta QA architecture — requires explicit approval

1. Register a **separate non-production Meta app** controlled by ProcessEdge,
   with its own App ID, development/test permissions, webhook verification
   token and app secret. Preserve the existing live/published Meta SellerTray
   app and subscriptions unchanged.
2. Use a **dedicated test WhatsApp Business phone number or officially
   provisioned test number** and approved synthetic recipient allowlist.
   Never register, remove, repoint or reuse a live merchant number
   (including Tandar) for QA.
3. Configure the test Meta app callback **only after the controlled OA5
   rebuild and hosted Test Edge Function deployment**:
   `https://iukgsukdoowvnhlfmpml.supabase.co/functions/v1/whatsapp-webhook`.
   Verify GET token challenge, POST HMAC-SHA256, event time/retry/idempotency
   and tenant/phone/branch routing; reject unmapped or unconsented IDs.
4. Store **distinct Test-only** Meta app secret, verify token and credentials
   in protected Supabase Test environment controls, never in Git or shared
   source/CI variables. Retain credentials in the Production project
   unchanged. Keep Test worker runtime-configured outbound destinations
   disabled until a reviewed synthetic-only delivery test is authorised.
5. Seed only governed synthetic Test merchants/branches/customers in the
   **same shared SellerTray commerce core**, and prove rejected cross-tenant
   and Production phone-number IDs, replay suppression, status recording,
   safe fallback and no actual customer messages. Verify and document
   provider-side subscriptions and endpoint before enabling a test callback.

**Meta decisions still pending:** authorised Meta Test app ownership, test
number provisioning and any provider restrictions/costs; mock-only acceptance
versus a real provider sandbox end-to-end event; Test callback deployment and
external sink/quiescence sign-off. Do **not** point the current live Meta app
at Test merely to exercise OA5.

## Platform Paystack webhook mode hardening

Source guard: `supabase/functions/paystack-webhook/environment-guard.mjs`
requires the canonical Supabase backend URL to match the configured
`PAYSTACK_SECRET_KEY` prefix (Production -> `sk_live_`, independent Test
-> `sk_test_`). Unknown projects, wrong secrets and mismatched explicit
`data.domain` values fail closed **before any billing database access**,
and `charge.success` requires an explicit matching `data.domain`.
Older subscription/invoice events may omit this field; those remain guarded
by the project+key match and signature verification. No exception allows
live signed callbacks to be processed by the Test backend.

Source checks are not hosted security acceptance. Maintain existing
raw-body HMAC signature verification, idempotency, immutable checkout
references and reconciliation semantics. Verify real provider payload shape
in a future synthetic Test callback before turning on any Test webhook.
Do not place live keys in Test or set Test provider callback URLs until
the hosted rebuild, Test-only key authority and exact-source acceptance
are complete. Production deployments require separate verification and
release authorisation.

## Controlled callback acceptance evidence (not executed)

| Test | Evidence required |
| --- | --- |
| Meta Test subscription | Separate Meta Test App ID, test phone ID, callback target Test only |
| Meta inbound HMAC | Correct signature accepted; tampered/replayed/missing refused |
| Meta tenant mapping | Test synthetic mapped number accepted; unknown/Production IDs ignored |
| Meta outbound | Synthetic-only recipient; no Production customer/merchant delivery |
| Paystack platform sandbox | `sk_test_`, Test project ref, signed `data.domain=test` applied once |
| Paystack cross-mode | Signed `data.domain=live` rejected before any DB write in Test |
| Paystack invoice legacy | Missing `data.domain` accepted only for signed non-charge event under matched environment |
| Flutterwave | Test-only secret/verification without changing the unrelated live account |
| Auth + web | QA-native redirects and protected Merchant/Admin Test domains verified |
| Rollback | Test-only worker pause, archived restore evidence, approved exact reset mechanism |

**Execution status:** no Meta app/number, payment setup, webhook test,
secrets, QA APK, Vercel preview, Edge deployment, Test reset or Production
change was performed as part of this source-only plan.

## 08/11/2026 — discovered historical QA phone ID in Production

A **read-only** check of both Supabase projects discovered that the
owner-claimed Meta test Phone Number ID `1271836092686870` is **not**
mapped in Test but **is** a historical `tenants.whatsapp_phone_number_id`
mapping in Production. Its Production tenant is retired, marked
`not_connected`, has a disconnected connection row and **no** stored
WhatsApp connection credentials. Production nevertheless contains **117
historical webhook receipts** for that identifier, all from 16–17/09/2026.
There were zero receipts within seven days of inspection.

The legal consent helper `sellertray_whatsapp_consent_active` still
returned `true` on the retired tenant because it checks valid unrevoked
policy acceptance rather than operational active-state. The pre-fix
inbound webhook code looked up tenants by phone ID, then relied on this
legal-consent helper, without excluding retired or disconnected tenants.
A correctly signed callback could therefore have passed the
**routing gate** for an obsolete mapping; no current callback or
unauthorized delivery was observed or triggered.

**Forward-only source correction:** `routing-boundary.mjs` now
requires `retired_at=is.null` and
`whatsapp_connection_status=eq.connected` at the tenant lookup
boundary, before consent is checked. No historical legal consent or
Production tenant row has been deleted or changed. Run the associated
pure Node tests and full WhatsApp regression suite before any deployment;
source changes do not prove hosted acceptance. Track follow-up in
[issue #231](https://github.com/olayemigod/OrderDesk-/issues/231).

**Meta QA stop gate:** separate QA App ID `1429945732160146` was
verified in Development mode, and the screenshot sequence shows claimed
test number `+1 (555) 676-6065` with Phone Number ID
`1271836092686870` and Meta-labeled Messaging account ID
`1082801377578061`. Because this Phone Number ID appears in
Production history, do not assume exclusive QA app affiliation from
separately cropped screens. Independently verify Meta app->phone
relationship and QA app secret separation before creating any hosted
callback or mapping. Do not generate access tokens, use live Meta
credentials, or send messages under OA5 at this stage.

**CI/release update (08/11/2026):** GitHub Actions runner-start/log issue #230 recovered and was closed, without a proven historical root cause. At exact head `c4f697ba32df828f0e5e5c806fdd247d94a89e4b`, Database CI, OA5 Staging Isolation and Environment Resource Governance passed, as did the Mobile verify job. **Mobile dependency audit remains FAIL** on the expired Expo CLI/Zod exception (#229). The WhatsApp retired/disconnected tenant lookup correction is source-only and tracked in #231 until hosted regression. No Test reset, webhook deployment or Production cutover is authorized.

## 08/11/2026 — forward-only Test Meta webhook app/number guard

Draft PR #228 now contains a bounded Test-only Meta webhook preflight
and callback routing guard. When `SUPABASE_URL` identifies standalone Test
`iukgsukdoowvnhlfmpml`, the function requires the approved **public**
app ID `1429945732160146` via `META_TEST_APP_ID` and approved public
phone ID `1271836092686870` via `META_TEST_PHONE_NUMBER_ID`. A missing or
different setting blocks even GET subscription verification (HTTP 503).
A signed POST with absent/mixed/different phone metadata is rejected
before writing receipt/audit data to Test (HTTP 409). HMAC and the
separate active-connected-tenant+legal-consent gates still apply.
Existing Production/local WhatsApp webhook behavior is not changed.

A separate Meta **QA app secret** and **QA verification token** remain
required in Test's protected Edge secrets. Never use the existing
Production secret or subscribe the live Meta app to the Test endpoint.
The current separately supplied screenshots are insufficient for one
independent screen proving Test App ID/phone ownership; no hosted
verification, test-number registration, delivery or WABA association is
claimed. No new Test Edge function has been deployed.

Focused Node source/logic checks and full exact-head GitHub CI must
pass before this source change can be considered tested. OA5 staging
attestation and provider activation remain **NO-GO**.
