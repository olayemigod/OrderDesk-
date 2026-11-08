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
