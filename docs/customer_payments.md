# SellerTray Customer Payments Contract

Status: Build 7 phased payment implementation baseline.

## Scope

SellerTray customer payments are an order-adjacent financial layer. They do not replace or silently change the SellerTray order, WhatsApp, fulfilment, Merchant ID, legacy PDF order receipt, subscription billing, or release identity contracts.

The MVP payment model is full-payment only. Partial payments, split payments, refunds, chargebacks, wallet custody and percentage-of-sales / GMV fees are outside this contract.

SellerTray commercial pricing remains a low monthly base fee plus flat usage-based charges for AI-assisted order activity, with optional paid channel add-ons and **No percentage-of-sales / GMV fee**.

## Financial document identities

Order reference remains merchant-scoped:

- `NLM/000001`

SellerTray financial documents are separate immutable identities derived from that order reference:

- Invoice: `ST/NLM/INV/000001`
- Financial payment receipt: `ST/NLM/RCP/000001`

An invoice means an amount is due. It is not proof of payment.

A financial payment receipt exists only after a payment has been confirmed. It is proof of payment.

The existing completed-order PDF remains the **Legacy ORDER RECEIPT**. Its WhatsApp command, storage cache and fulfilment semantics are preserved separately from the financial payment receipt.

## State separation

Order state, payment state and fulfilment state are independent.

Payment projection:

- `unpaid`
- `pending`
- `verification_required`
- `paid`

Payment attempts:

- `initiated`
- `pending_verification`
- `confirmed`
- `failed`
- `cancelled`
- `expired`

Confirming payment must not automatically process, ready, complete, deliver or collect an order.

A paid order cannot be cancelled until an explicit refund contract exists.

Once an invoice exists, invoiced order items are financially locked for the MVP.

## Merchant payment methods

Supported merchant-owned customer methods:

- Bank transfer: multiple accounts permitted.
- Paystack: one connected merchant gateway configuration per business.
- Flutterwave: one connected merchant gateway configuration per business.
- Cash on delivery.
- Pay on pickup.

Only one enabled payment method may be the default.

Owners and Managers may maintain ordinary methods. Gateway credential changes are Owner-only. Staff can view payment configuration and can use governed order payment operations according to tenant membership.

Gateway methods fail closed until credentials are configured.

## Settlement and custody

Customer funds settle directly through the merchant's configured bank/gateway relationship.

SellerTray does not collect card details and does not act as a customer-funds wallet for this payment contract.

Gateway secrets are encrypted server-side with AES-GCM and stored only in the private gateway credential store. The mobile application never reads raw stored gateway credentials.

Required server secret:

- `SELLERTRAY_PAYMENT_ENCRYPTION_KEY`: a 32-byte AES key encoded for the Edge Function environment.

Until `SELLERTRAY_PAYMENT_ENCRYPTION_KEY` is configured, gateway credential connection and gateway runtime paths intentionally fail closed.

## Customer WhatsApp commands

After order acceptance, SellerTray can advertise payment/document commands when applicable:

- `INVOICE NLM/000001`
- `PAY NLM/000001`
- `PAY NLM/000001 BANK1`
- `PAY NLM/000001 PAYSTACK`
- `PAY NLM/000001 FLUTTERWAVE`
- `PAY NLM/000001 COD`
- `PAY NLM/000001 PICKUP`
- `PAID NLM/000001`
- `PAYMENT STATUS NLM/000001`
- `PAYMENT RECEIPT NLM/000001`

A customer `PAID` claim for bank transfer never marks the order paid. It moves the attempt to `pending_verification` and requires merchant confirmation.

The existing `receipt NLM/000001` command remains the legacy completed-order receipt path and is not repurposed.

## Provider verification

Paystack and Flutterwave hosted checkout are initialized only on the server with merchant-owned encrypted credentials.

Before SellerTray confirms value, provider verification must match:

- SellerTray payment reference.
- Exact expected amount.
- Exact expected currency.
- Successful provider status.

Webhook authentication alone is insufficient. A success webhook triggers independent provider transaction verification before payment confirmation.

Provider webhook events are recorded in a replay-resistant payment event ledger.

## Offline confirmation

Bank transfer, cash on delivery and pay on pickup can be manually confirmed only through the governed merchant payment operation.

The acting user must be a member of the same tenant. The confirmation actor and event are auditable.

The merchant UI explicitly warns that confirmation should be used only after funds have been verified.

## Reconciliation inbox

More → Customer payments contains a tenant-level payment reconciliation inbox.

It shows recent payment attempts with order/customer context and separates items needing attention from the wider recent-payment history. Operational counters include awaiting verification, open, paid and failed attempts.

Authorized tenant Staff can reconcile existing payments without gaining permission to change merchant payment-method configuration.

Offline payments are confirmed only through the audited merchant payment operation. Paystack and Flutterwave attempts are rechecked against their provider through the governed verification service. Payment reconciliation does not mutate order or fulfilment status.

## PDFs

Financial document PDFs use a separate cache from the legacy order receipt.

Invoice PDF:

- title: INVOICE
- immutable invoice reference
- order reference
- item/amount detail
- explicit wording that it is not proof of payment

Financial payment receipt PDF:

- title: PAYMENT RECEIPT
- immutable financial receipt reference
- payment method/reference when available
- amount paid
- explicit proof-of-payment wording

Financial PDF paths live below a dedicated `financial/` path and do not update the existing order receipt cache fields.

## Security boundaries

Merchant-readable payment/financial tables are SELECT-only to authenticated tenant members under RLS.

Mutating payment state, issuing financial documents, confirming offline payments, storing gateway credentials and provider verification are server-owned operations.

Provider references are slash-free and bounded. Idempotency keys prevent repeated customer actions from creating duplicate payment attempts. A unique confirmed-payment constraint prevents double confirmation for the same order.

## Current external activation gates

The implementation can be code-complete while provider acceptance remains pending. Production use requires **external activation** and acceptance evidence for the intended provider path.

Outstanding activation items can include:

1. Configure `SELLERTRAY_PAYMENT_ENCRYPTION_KEY` in the Supabase Edge Function environment.
2. Merchant connects real/test Paystack or Flutterwave credentials.
3. Configure the provider webhook URL for the corresponding SellerTray payment webhook.
4. Run provider test-mode checkout and webhook acceptance.
5. Confirm successful server-side re-verification and financial receipt issuance.
6. Confirm WhatsApp payment commands on the Meta production path.
7. Complete device QA of merchant payment verification and financial document display.

No gateway path should be represented as production-accepted until those applicable external checks pass.

## Preserved Build 7 contracts

This payment programme must preserve:

- SellerTray 1.0.0 identity and Android Build 7/versionCode 7 until the release contract changes.
- Merchant-scoped order references and Merchant ID semantics.
- Existing order state transition rules except explicit paid-order cancellation protection.
- Existing fulfilment methods and customer `RECEIVED` confirmation.
- Existing WhatsApp order ingestion and deterministic customer order lookup.
- Existing legacy PDF order receipt and receipt self-service.
- Existing subscription billing and usage-billing contracts.
- Draft PR/release acceptance gates until independently satisfied.
