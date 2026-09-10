# SellerTray Usage Billing Contract

## Frozen commercial shape

SellerTray billing is intentionally simple:

- a low monthly base subscription;
- a flat charge per successful AI-assisted order activity;
- optional paid channel add-ons only when additional channels are introduced;
- transparent payment-processing charges where applicable;
- **No percentage-of-sales or GMV fee.**

The current billable event code is `AI_ORDER_ACTIVITY`.

## What counts as AI-assisted usage

One usage event is recorded only when the external AI parser successfully returns a valid structured order and SellerTray creates the WhatsApp order.

The following are not billable AI usage:

- deterministic fallback parsing;
- manual order entry;
- duplicate/retried Meta webhook delivery;
- an external parser response that fails schema validation;
- trial activity;
- activity recorded before a commercial usage rate is active;
- activity that cannot be tied safely to a valid paid billing period.

Usage events snapshot their unit price, ISO currency and paid-period boundaries at event time. A later price or plan-currency change must never retroactively reprice or recurrency an earlier event. Settlement preparation rejects future/open periods and mixed-currency period data.

## Collection model

The monthly base fee remains a fixed Paystack subscription plan.

Variable AI usage is settled separately using Paystack's reusable payment authorization from the merchant's successful base-plan payment. This avoids changing the fixed subscription amount every month.

SellerTray uses this sequence:

1. Merchant completes base-plan Paystack checkout.
2. Paystack `charge.success` activates the base subscription.
3. If Paystack supplies a reusable authorization and the billing encryption key is configured, SellerTray encrypts the authorization with AES-GCM and stores it in the server-only `billing_payment_authorizations` table.
4. Paid-period AI activity records `usage_unit_price`, `billing_period_start` and `billing_period_end`.
5. Supabase Cron runs `prepare_due_orderdesk_usage_settlements()` daily at 01:15 UTC and prepares one idempotent `usage_settlements` record for each newly closed priced period. Manual preparation remains safe and idempotent.
6. The usage-settlement worker may submit the variable amount through Paystack's charge-authorization endpoint only when `USAGE_BILLING_LIVE=true`.
7. The Paystack webhook reconciles `charge.success` only when the provider reference, expected amount and currency match the prepared settlement exactly.
8. A non-debiting `reconcile` action can call Paystack Verify Transaction by the existing provider reference; successful verified amount/currency marks the settlement paid, while failed/abandoned/reversed states are recorded without issuing another debit.
9. The settlement becomes `paid`; ambiguous or failed attempts are never automatically recharged.

## Fail-closed controls

- `USAGE_BILLING_LIVE` is opt-in. Anything other than the exact string `true` disables money movement.
- `subscription_plans.usage_charging_enabled` is a second independent database interlock and defaults to `false`; both gates must be enabled before a debit can reach Paystack.
- `USAGE_SETTLEMENT_TOKEN` is required for settlement-worker access.
- `BILLING_AUTH_ENCRYPTION_KEY` must be a server-only base64-encoded 32-byte key.
- `PAYSTACK_SECRET_KEY` remains server-only.
- Reusable authorization codes are AES-GCM encrypted before database storage.
- Merchant clients have no SELECT/INSERT/UPDATE/DELETE grants on payment authorizations, settlements or settlement-item mappings.
- ProcessEdge Admin receives only safe readiness/amount/failure indicators, never the authorization ciphertext.
- Business data export includes usage events and safe settlement history but excludes reusable charge credentials.
- Failed or uncertain charge attempts are not automatically retried. ProcessEdge must first use provider-reference reconciliation and confirm the Paystack transaction state before considering any later debit attempt.
- Self-service account deletion is blocked while any priced AI usage remains unsettled; a paid settlement clears the block.
- Automatic Cron work prepares database settlement records only. It never calls Paystack and never moves money.

## Activation checklist

Keep live charging disabled until all items below are complete:

1. Approve the monthly SellerTray base price.
2. Approve the flat `AI_ORDER_ACTIVITY` price.
3. Create/confirm the Paystack monthly plan and configure its plan reference.
4. Configure `PAYSTACK_SECRET_KEY`.
5. Generate and configure a strong random 32-byte `BILLING_AUTH_ENCRYPTION_KEY` encoded as base64.
6. Generate and configure a strong random `USAGE_SETTLEMENT_TOKEN`.
7. Keep `USAGE_BILLING_LIVE` disabled and keep `subscription_plans.usage_charging_enabled = false`.
8. In Paystack test mode, complete one base subscription checkout and confirm a reusable authorization is captured.
9. Confirm one active-period external-AI order creates exactly one priced usage event with exact billing-period bounds.
10. Confirm the active `sellertray-prepare-usage-settlements` Cron job prepares the closed period once; manually prepare it again and prove the existing settlement is returned rather than duplicated.
11. Confirm account deletion is blocked before settlement and allowed by the usage-billing guard after the settlement is paid.
12. Submit one test usage charge and verify the Paystack webhook marks the exact settlement paid.
13. Simulate or inspect an unresolved/failed settlement and use the non-debiting `reconcile` action to verify Paystack by reference before any retry.
14. Verify future/open periods and amount/currency mismatch are rejected.
15. Verify ProcessEdge Admin shows authorization readiness, outstanding amount and failures without exposing charge credentials.
16. Only then set `USAGE_BILLING_LIVE=true` for production.

## Current rollout state

The database schema, secure authorization capture path, idempotent closed-period settlement preparation, usage currency snapshotting, daily preparation Cron, unsettled-usage deletion guard, fail-closed settlement worker, provider-reference reconciliation, webhook reconciliation, merchant usage visibility, business export coverage and ProcessEdge operational indicators are implemented.

Commercial prices remain unset and no live reusable authorization or usage settlement exists yet. Therefore SellerTray cannot currently debit AI usage.
