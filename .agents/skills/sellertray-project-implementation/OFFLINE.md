---
name: sellertray-offline-governance
description: "Normative offline extension for SellerTray POS selling, payments, sync, conflict handling, idempotency and payment verification while the SellerTray app/backend is unavailable."
metadata:
  author: ProcessEdge Solutions Limited
  product: SellerTray
  version: "0.1.2"
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

A SellerTray device being unable to reach the SellerTray backend **does not mean a governed payment method is unavailable**. A bank, card terminal, payment provider or other approved verification path may still be reachable or may provide independent confirmation evidence.

Therefore:

- do not hide or disable an otherwise valid cached Branch payment method merely because SellerTray data sync is offline;
- do not force every offline POS sale to Cash;
- do not infer that a non-cash payment is confirmed merely because the cashier selected it;
- preserve the distinction between payment selection, payment evidence, payment verification and final SellerTray settlement.

# 2. Offline POS payment parity rule

Offline POS must expose the same governed payment choices and merchant payment policy that were last supplied and cached for the active Business/Branch, constrained only where a method cannot be captured or replayed safely offline.

This means the offline checkout surface must support, when enabled by the cached governed configuration:

- Cash;
- configured Branch Bank transfer methods;
- configured Card/terminal methods;
- split payment allocations;
- partial payment;
- Pay later.

The target behavior is:

1. The cashier selects only cached governed Branch payment methods; SellerTray must not invent a payment method while offline.
2. SellerTray records the sale and payment plan locally with immutable retry identity, allocation amounts, payment-method snapshots, operator identity, business time and any required non-cash evidence.
3. Cash remains a cashier-confirmed physical settlement method.
4. Bank transfer remains unverified unless the shared governed verification or authorised manual-confirmation path confirms it. A transfer reference alone is evidence, not settlement authority.
5. Card/terminal payment may capture the independently issued terminal/provider reference while offline. Confirmation on replay must still follow the merchant's configured non-cash confirmation authority; recording a reference does not by itself bypass that authority.
6. Split, partial and Pay later behavior must use the same merchant POS policy used online. Client code must not independently grant those capabilities.
7. If an approved payment-verification channel is reachable independently of the SellerTray data backend, SellerTray may use that governed verification path. Client code must not embed provider secrets or invent a second payment authority.
8. If authoritative verification cannot be completed immediately, the relevant non-cash allocation remains explicitly pending/unverified. The sale must not be silently presented as fully paid.
9. On reconnection, replay goes through the same governed payment authority used online, preserving the original Business, Branch, order, amounts, methods, references/evidence, operator, business time and idempotency identity.
10. A reference/allocation that has already settled must not create a second `order_payments` effect on replay.
11. Non-cash settlement must never increase expected physical drawer cash.
12. Conflict outcomes must be visible and reviewable rather than silently converted to Cash, another payment method, or discarded.

# 3. Manual non-cash confirmation

Merchant-governed manual non-cash confirmation remains distinct from provider verification.

Where merchant policy explicitly permits an authorised cashier/manager to confirm a Bank or Card/terminal payment manually:

- preserve the configured capability and Branch boundary;
- record accountable operator, amount, method, reference/evidence and business time where evidence exists;
- keep the command idempotent;
- do not treat ordinary offline availability as permission to bypass the configured confirmation authority;
- replay the same commercial fact without duplicating settlement when SellerTray reconnects.

If the merchant does not permit manual confirmation and no authoritative provider verification is available, the offline non-cash allocation remains pending.

# 4. Cached payment-method and policy requirements

Offline payment may use only payment methods and POS policy previously supplied by the governed SellerTray payment configuration for that Business/Branch.

The cached snapshot should preserve, as applicable:

- payment-method identity;
- method type;
- Branch assignment/context;
- display label;
- Business bank/account destination where applicable;
- provider/gateway or terminal identity where applicable;
- confirmation mode/policy needed by the client;
- split-payment permission;
- partial-payment permission;
- Pay-later permission;
- cache/configuration revision or equivalent stale-data guard.

Do not let a client invent a bank account, card/terminal method, provider, method type, Branch assignment or payment-policy capability while offline.

# 5. Offline sale/payment replay invariants

Offline replay must preserve:

- stable sale and payment command identity;
- deterministic allocation ordering/identity;
- original Business and Branch;
- original cashier/operator identity;
- customer identity snapshot/reference;
- Product/UOM/price/conversion snapshots and governed replay checks;
- tax configuration identity/revision where applicable;
- payment method, amount, confirmation intent and verification evidence per allocation;
- Pay-later/partial-payment intent where applicable;
- original business timestamp where the shared command supports business time;
- stock and payment idempotency;
- user-visible `pending`, `needs review`, `failed` and `synced` outcomes.

A repeated replay must never duplicate order, stock, payment, tax, receipt or shift effects.

A stale, removed, reassigned or disabled cached payment method must fail closed into review. It must never be substituted silently with Cash or another method.

# 6. Tax interaction

Offline tax does not become client authority.

A newly queued offline sale carries the governed tax configuration identity/revision needed for safe replay. The client may show a preview from the last governed tax context, but final posting remains server/domain authority.

If tax settings changed in a way that makes the queued transaction unsafe to post under its recorded commercial facts, SellerTray must fail to review rather than silently repricing or applying a new tax after the customer already paid.

# 7. Current implementation target

SellerTray caches governed Branch POS payment methods and POS policy. Offline checkout must consume those same cached methods and policy rather than presenting a reduced Cash/Bank-only payment model.

The governed replay contract is:

1. Mobile exposes only previously cached governed Branch payment methods and cached merchant payment capabilities.
2. The offline outbox stores a payment plan containing a stable checkout command identity, Pay-later intent where applicable, and each allocation's method snapshot, amount, confirmation intent, reference/evidence and capture timestamp where applicable, together with the existing Business, Branch, cashier, customer, Product/UOM/price/conversion and tax snapshots.
3. Reconnection replay uses the same generic POS payment authority used online: `pos-checkout` -> `checkout_sellertray_pos_sale`.
4. Offline Cash is replayed as confirmed Cash.
5. Offline Bank evidence is replayed without treating the transfer reference as proof of settlement; it enters governed verification unless another shared authority confirms it.
6. Offline Card/terminal evidence records the terminal/provider reference and follows the merchant's configured manual-confirmation authority on replay. If that authority is not granted, the allocation remains pending verification.
7. Split and partial allocations replay as one governed checkout command with deterministic allocation order. Pay later replays through the same command with no invented payment row.
8. Payment evidence is bound to the governed `order_payments` allocation within the shared checkout transaction and audited through the existing SellerTray payment-event authority.
9. Stock finalization remains controlled by the shared checkout/finalization authority. A pending non-cash allocation must not silently create stock movement as though fully settled.
10. Replays reuse the original checkout command and deterministic allocation identity. They must not create duplicate order, payment or stock effects.
11. A stale/removed Branch payment method, changed evidence, reused provider/reference or other authority conflict fails closed into review.
12. Legacy offline outbox records remain readable so existing Draft/Cash/Bank intents survive schema evolution.

Do not reintroduce a method-specific mobile payment truth. Future offline payment work must continue through the shared governed payment authority unless a later explicit product decision changes this architecture.

# 8. Required QA for offline payment parity

Before an offline payment-parity change is considered complete, verify at minimum:

- SellerTray backend offline while cached Branch Cash, Bank and Card/terminal methods remain selectable as configured;
- no client-invented or stale Branch payment method is silently accepted;
- Cash retains physical-drawer semantics;
- Bank and Card/terminal allocations do not create drawer effects;
- Bank reference evidence does not falsely mark payment paid;
- Card/terminal evidence is retained with the original capture time and follows configured confirmation authority;
- split allocations preserve all methods, amounts and deterministic replay identity;
- partial payment is available only when the cached/server policy permits it and retains the correct outstanding amount;
- Pay later is available only when the cached/server policy permits it and does not fabricate a payment row;
- unavailable verification leaves the relevant allocation pending rather than falsely paid;
- reconnect replay settles/posts exactly once;
- repeated replay cannot duplicate payment or stock effects;
- reused provider/reference cannot settle two different commercial facts;
- stale/removed Branch payment method follows the defined conflict/review policy;
- cashier/manager manual-confirmation authority is enforced server-side;
- tax, Product/UOM, stock, Customer and Branch replay conflicts remain fail-closed and reviewable;
- receipt/order status accurately reflects pending versus confirmed payment;
- WhatsApp/customer payment behavior is not changed merely because POS offline payment parity is added.
