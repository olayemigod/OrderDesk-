# SellerTray Commercial Paystack Production Readiness

Status: operational runbook
Owner: ProcessEdge Solutions Limited
Scope: SellerTray merchant-to-ProcessEdge commercial billing
Last reconciled: 2026-10-28

## Purpose

This runbook governs the production configuration required for SellerTray to collect SellerTray subscription, setup, equipment, add-on and installment payments from merchants through Paystack.

It does **not** govern a merchant's own customer-payment credentials. Merchant customer-payment methods remain under the separate SellerTray payment-settings/runtime authority.

## Governing architecture

SellerTray commercial payment uses the existing shared commercial core:

1. governed Commercial Order;
2. immutable Order Form / Agreement Package confirmation;
3. governed installment/payment obligation;
4. Merchant Web Billing Center `Pay SellerTray` action;
5. `billing-checkout` Edge Function initializes Paystack checkout;
6. merchant completes the Paystack-hosted checkout;
7. `paystack-webhook` validates the signed provider event;
8. the exact amount, currency, checkout reference and installment identity are verified;
9. `confirm_sellertray_installment_payment_from_checkout` records the immutable payment confirmation;
10. `reconcile_sellertray_installment_entitlement` reconciles the existing commercial/entitlement authority idempotently.

Do not create a parallel billing ledger, browser-calculated settlement or direct entitlement mutation.

## Platform secret boundary

ProcessEdge/SellerTray platform Paystack credentials are **server infrastructure secrets**. They must not be stored in Merchant Web, Mobile, browser local storage, source control, a normal database settings row or a merchant payment-method record.

The current commercial checkout expects these production Edge Function secrets in the LIVE SellerTray Supabase project:

### Required

- `PAYSTACK_SECRET_KEY`
  - production collection must use the ProcessEdge/SellerTray Paystack **live secret key**;
  - expected live prefix: `sk_live_`;
  - used only by server-side Edge Functions to initialize transactions and verify webhook signatures.

### Strongly required for production billing continuity

- `BILLING_AUTH_ENCRYPTION_KEY`
  - base64 encoding of exactly 32 random bytes;
  - used to AES-GCM encrypt reusable Paystack authorization codes captured after successful payment;
  - never expose or log the raw key;
  - rotation requires a governed key-version/migration plan because stored reusable authorizations record an encryption key version.

### Supabase-provided server variables

Do not manually copy these into Admin UI:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` / hosted Supabase secret-key equivalents

Supabase supplies the project runtime variables to deployed Edge Functions.

### Separate merchant-payment secret

`SELLERTRAY_PAYMENT_ENCRYPTION_KEY` belongs to the merchant operational gateway credential path (`payment-settings`). It is **not** the ProcessEdge/SellerTray commercial billing Paystack secret and must not be substituted for `PAYSTACK_SECRET_KEY`.

## Where to configure production secrets

Configure platform payment secrets in **LIVE Supabase project → Edge Function Secrets** (project ref `eujxswjspolugrzlsjnn`) or through an equivalent restricted Supabase CLI/secret-management workflow.

Do not paste live payment secrets into ChatGPT, GitHub issues, source files or the SellerTray browser UI.

After a Supabase production secret is saved, deployed Edge Functions read the new value without requiring a function redeployment.

## Paystack production account prerequisites

Before using `sk_live_...`, confirm the Paystack business account that will receive SellerTray funds is production-enabled and belongs to the approved ProcessEdge/SellerTray collection entity.

Confirm in Paystack:

- Business/KYC activation is complete for live payments.
- The correct settlement bank account is configured.
- Live API keys are available.
- Live transaction channels required by ProcessEdge are enabled.
- The live webhook endpoint is configured.
- The live callback URL is configured.

## LIVE Paystack URLs

### Webhook

Configure the Paystack **live webhook URL** as:

`https://eujxswjspolugrzlsjnn.supabase.co/functions/v1/paystack-webhook`

The function is intentionally callable without SellerTray JWT authentication because Paystack is the caller. Trust is established by validating the `x-paystack-signature` HMAC with the server-only `PAYSTACK_SECRET_KEY`.

Never weaken or remove the webhook signature check.

### Callback

Current Merchant Web production domain:

`https://sellertray-merchant.vercel.app/`

Until Merchant Web navigation is fully URL-backed, use that root as the Paystack live callback URL. The webhook—not the browser redirect—is the authoritative payment-confirmation path. After the Billing Center receives its stable `/billing` URL and SPA fallback is verified in production, the callback can move to:

`https://sellertray-merchant.vercel.app/billing`

Do not treat arrival at a callback URL as proof of payment.

## Merchant Web requirement

Merchant Web must expose the existing `SellerTrayBillingManagement` component as a first-class **Billing Center** page identity named `billing`.

The existing component already:

- reads the authoritative `commercial-billing` center projection;
- distinguishes SellerTray/ProcessEdge billing from customer receivables;
- uses server-resolved outstanding and next-payable amounts;
- lets only the governed payer role initiate checkout;
- calls `billing-checkout` with the exact installment schedule;
- creates/reuses an idempotent command ID in session storage;
- redirects only to the server-returned Paystack authorization URL;
- does not expose the Paystack secret.

## Production readiness checks before first payment

All must be true:

1. SellerTray Master Agreement v0.9 is the current non-quarantined production Master.
2. The merchant has a genuine governed Commercial Order.
3. The merchant has confirmed the exact Order Form / Agreement Package under the current Master.
4. A governed payable installment/payment schedule exists.
5. Merchant Web Billing Center is reachable by the authorised Owner/Manager.
6. `commercial-billing` is deployed and authenticated.
7. `billing-checkout` is deployed and authenticated.
8. `paystack-webhook` is deployed and performs signature validation.
9. `PAYSTACK_SECRET_KEY` is configured in LIVE and is the intended live key.
10. `BILLING_AUTH_ENCRYPTION_KEY` is configured and decodes to exactly 32 bytes.
11. Paystack live webhook points to the LIVE SellerTray webhook URL above.
12. Paystack live callback points to the approved Merchant Web production URL.
13. The Paystack account settlement bank details are correct.
14. No test/sandbox key is mixed with the production webhook/account.
15. No synthetic payment or direct database settlement is used for OA5C proof.

## OA5C first genuine payment proof

For the designated controlled real merchant:

1. Open Merchant Web Billing Center as the Business Owner.
2. Verify the displayed Commercial Order reference, total, confirmed payments, outstanding amount and next payable amount.
3. Select **Pay SellerTray**.
4. Confirm a `billing_checkout_sessions` record is created with `checkout_kind = installment`, the correct Business, installment schedule, currency, amount and unique reference.
5. Complete a genuine Paystack live payment.
6. Confirm Paystack emits `charge.success` to the LIVE webhook.
7. Confirm the webhook verifies the signature and matches the exact checkout reference.
8. Confirm provider amount and currency exactly match the governed checkout amount/currency.
9. Confirm `sellertray_commercial_installment_payment_confirmations` records the immutable confirmation.
10. Confirm the `billing_checkout_sessions` state becomes paid through the governed confirmation path.
11. Confirm `billing_provider_events` contains the processed provider event and replay is idempotent.
12. Confirm the authoritative Commercial Order settlement/balance now reflects the confirmed payment.
13. Confirm entitlement reconciliation ran from the payment confirmation without direct entitlement mutation.
14. Refresh Billing Center and verify gateway payment history and outstanding amount reconcile to Admin commercial settlement.
15. Preserve evidence required by `docs/oa5c-controlled-real-merchant-proof.md`.

## Failure handling

- Missing `PAYSTACK_SECRET_KEY`: `billing-checkout` must fail closed; do not bypass with a fabricated settlement.
- Invalid provider response: keep the checkout retryable and preserve the command/reference history.
- Webhook signature failure: reject the event.
- Amount/currency mismatch: reject the payment confirmation and do not deliver entitlement value.
- Reconciliation failure after payment confirmation: return failure so Paystack can retry; the confirmation/reconciliation path is designed to be idempotent.
- Merchant closes the browser before callback: rely on the signed webhook, not the redirect.
- Real bank transfer/manual external payment: use only the existing governed Admin direct-payment confirmation path with genuine reference/evidence; never use it to simulate a Paystack success.

## Secret rotation

For Paystack secret rotation:

1. create/activate the replacement key in Paystack;
2. update `PAYSTACK_SECRET_KEY` in LIVE Supabase Edge Function Secrets through an authorised infrastructure operator;
3. verify checkout initialization with a controlled transaction;
4. verify webhook signatures continue to validate;
5. revoke/deactivate the old key only after the overlap/verification window is complete;
6. record the operational change in ProcessEdge deployment/change evidence.

Do not rotate `BILLING_AUTH_ENCRYPTION_KEY` casually. Existing encrypted reusable authorization records depend on the encryption-key version and require an explicit migration/re-encryption design before rotation.

## Admin Center presentation rule

SellerTray Admin may expose **redacted payment infrastructure readiness** (for example: Paystack configured/not configured, live/test/unknown mode, webhook endpoint, billing-authorization encryption readiness and last verified state). It must not display the raw live secret after configuration.

A browser form that simply stores `PAYSTACK_SECRET_KEY` in the application database is prohibited. If ProcessEdge later wants Admin to rotate infrastructure secrets directly, implement that only through a dedicated privileged secret-management service with AAL2, least privilege, no read-back, immutable audit and a backend secret-store integration. Do not turn Admin Web into the secret store.
