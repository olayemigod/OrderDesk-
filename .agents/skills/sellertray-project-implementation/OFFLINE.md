---
name: sellertray-offline-governance
description: "Normative offline extension for SellerTray POS selling, payments, sync, conflict handling, idempotency and payment verification while the SellerTray app/backend is unavailable."
metadata:
  author: ProcessEdge Solutions Limited
  product: SellerTray
  version: "0.1.0"
  status: governing-extension
---

# SellerTray Offline Governance

## Status and precedence

This file is a **normative extension** of `.agents/skills/sellertray-project-implementation/SKILL.md`.

Read and follow it for any SellerTray task involving offline selling, POS outbox/replay, local transaction capture, cached payment methods, payment verification while SellerTray connectivity is degraded, sync, retry, conflict handling, or offline receipt behavior.

A later explicit user decision overrides this extension. When offline/payment policy changes materially, update this file in the same workstream.

Do not create a separate offline commerce, payment, inventory, tax, customer or reporting truth. Offline operation is delayed interaction with the same governed SellerTray core.

# 1. Connectivity model

SellerTray must not treat connectivity as one binary business state.

The following can differ at the same time:

1. SellerTray application/backend reachability;
2. general device/network connectivity;
3. external payment-rail/provider reachability;
4. printer/device-local availability.

A SellerTray device being unable to reach the SellerTray backend **does not mean bank payment is unavailable**. A bank/payment provider or other approved payment-verification path may still be reachable or may provide independent confirmation evidence.

Therefore:

- do not hide or disable an otherwise valid Branch-assigned bank payment method merely because SellerTray data sync is offline;
- do not force every offline POS sale to Cash;
- do not infer that a bank payment is confirmed merely because the cashier selected Bank;
- preserve the distinction between payment selection, payment evidence, payment verification and final SellerTray settlement.

# 2. Offline POS payment rule

Offline POS must support Bank payment where the governed payment method was previously cached for the active Branch and the method remains eligible under the offline payment policy.

The target behavior is:

1. The cashier may select a cached valid Bank payment method while SellerTray backend sync is unavailable.
2. SellerTray records the sale and payment attempt locally with immutable retry identity and the cached payment-method snapshot needed for safe replay.
3. If an approved payment-verification channel is reachable independently of the SellerTray data backend, SellerTray may use that governed verification path. Client code must not embed provider secrets or invent a second payment authority.
4. If authoritative verification cannot be completed immediately, the payment remains explicitly pending/unverified. The sale must not be silently presented as fully paid.
5. On reconnection, replay goes through the same governed payment authority used online, preserving the original Business, Branch, order, amount, method, provider/reference, operator, business time and idempotency identity.
6. A provider/reference that has already settled must not create a second `order_payments` effect on replay.
7. Confirmed bank payments are non-cash settlement and must never increase expected physical drawer cash.
8. Conflict outcomes must be visible and reviewable rather than being silently converted to Cash or discarded.

# 3. Manual bank confirmation

Merchant-governed manual non-cash confirmation remains distinct from provider verification.

Where merchant policy explicitly permits an authorised cashier/manager to confirm a Bank payment manually:

- preserve the configured capability and Branch boundary;
- record accountable operator, amount, method, reference/evidence and business time;
- keep the command idempotent;
- do not treat ordinary offline availability as permission to bypass the configured confirmation authority;
- replay the same commercial fact without duplicating settlement when SellerTray reconnects.

If the merchant does not permit manual confirmation and no authoritative provider verification is available, the offline Bank payment remains pending.

# 4. Cached payment-method requirements

Offline Bank payment may use only a payment method that was previously supplied by the governed SellerTray payment configuration for that Business/Branch.

The cached snapshot should preserve, as applicable:

- payment-method identity;
- method type;
- Branch assignment/context;
- display label;
- Business bank/account destination where applicable;
- provider/gateway identity;
- confirmation mode/policy needed by the client;
- cache/configuration revision or equivalent stale-data guard.

Do not let a client invent a bank account, provider, method type or Branch assignment while offline.

# 5. Offline sale/payment replay invariants

Offline replay must preserve:

- stable client/command identity;
- original Business and Branch;
- original cashier/operator identity;
- customer identity snapshot/reference;
- Product/UOM/price/conversion snapshots and governed replay checks;
- tax configuration identity/revision where applicable;
- payment method and verification evidence;
- original business timestamp where the shared command supports business time;
- stock and payment idempotency;
- user-visible `pending`, `needs review`, `failed` and `synced` outcomes.

A repeated replay must never duplicate order, stock, payment, tax, receipt or shift effects.

# 6. Tax interaction

Offline tax does not become client authority.

A newly queued offline sale carries the governed tax configuration identity/revision needed for safe replay. The client may show a preview from the last governed tax context, but final posting remains server/domain authority.

If tax settings changed in a way that makes the queued transaction unsafe to post under its recorded commercial facts, SellerTray must fail to review rather than silently repricing or applying a new tax after the customer already paid.

# 7. Current implementation status and pending correction

As of this governance version, SellerTray already caches Branch POS payment methods, including Bank Transfer, but the current offline sale-completion outbox is still limited to the older Cash/Draft completion path.

That limitation is **an implementation gap, not the approved product rule**.

Pending implementation must extend the offline POS payment/outbox/replay flow so Bank payment remains available under the rules above. Do not report "offline means Cash only" as intended SellerTray behavior.

# 8. Required QA for offline Bank payment

Before the pending correction is considered complete, verify at minimum:

- SellerTray backend offline while a cached Branch Bank method remains selectable;
- Bank method is not converted into Cash and creates no drawer effect;
- provider-verified or authorised-manual confirmation records the correct governed evidence;
- unavailable verification leaves payment pending rather than falsely paid;
- reconnect replay settles exactly once;
- repeated replay cannot duplicate payment or stock effects;
- reused provider/reference cannot settle two different commercial facts;
- stale/removed Branch payment method follows the defined conflict/review policy;
- cashier/manager manual-confirmation authority is enforced server-side;
- tax, Product/UOM, stock, Customer and Branch replay conflicts remain fail-closed and reviewable;
- receipt/order status accurately reflects pending versus confirmed Bank payment;
- WhatsApp/customer payment behavior is not changed merely because POS offline Bank support is added.
