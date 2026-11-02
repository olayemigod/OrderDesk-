---
name: sellertray-c2-current-state-inventory
description: "C2-0/C2-1 current-state authority inventory and old-to-new migration map for SellerTray Commercial V2."
metadata:
  author: ProcessEdge Solutions Limited
  product: SellerTray
  version: "0.1.2"
  status: governing-extension
  baseline_commit: "d8024c215850e0e9a3a0ce1496d1d0dd5d7cd150"
  inventory_date: "2026-11-02"
---

# SellerTray C2 Current-State Inventory and Migration Map

## 1. Purpose and boundary

This document is the governed output of **C2-0 Governance Reset + C2-1 Capability and Commercial Inventory**.

It is based on repository baseline `d8024c215850e0e9a3a0ce1496d1d0dd5d7cd150`, current migrations/server/client implementation, and read-only inspection of the live SellerTray schema on 2026-11-02.

It authorises **no C2 schema, runtime cutover or production commercial mutation**. The legacy runtime remains intentionally active until C2-10 migration/parity evidence and controlled cutover.

Target architecture:

> **Business -> Branch -> Branch Subscription -> Plan Profile Version -> Resolved Entitlements -> SellerTray surfaces**

Effective operational authority is conceptually:

> **Branch Plan Entitlement ∩ User Permission ∩ Branch Scope ∩ Business/transaction state ∩ Available quota/limit**

The shared entitlement resolver must intersect with, not replace, authorization, Branch scope, transaction rules, payment/UOM/inventory correctness or quantitative usage checks.

The exact Branch-scope and command-family companion inventory is in `C2_CURRENT_STATE_INVENTORY_APPENDIX.md`.

## 2. C2-0 decisions locked

1. **Branch owns subscription authority.** Each Branch owns Plan Profile Version, billing cycle, lifecycle, entitlement period and renewal anniversary.
2. **Business subscription state becomes aggregate only.** There is no authoritative single Business plan/expiry after cutover.
3. **Plan names are data.** Starter, Growth and Scale may be editable seeds later; code must not branch on their names.
4. **Plan and price are separate authorities.** Plan Profile Version describes features/capabilities/limits; commercial masters determine price, tax and payment obligations.
5. **Branch activation is independent.** A pending/new/failed Branch cannot block another qualified Branch.
6. **Branch count is not a plan limit under current policy.** Each Branch carries its own commercial obligation. Do not introduce included-Branch allowances, extra-Branch add-ons or Branch-count quotas unless a later explicit product decision changes this rule.
7. **No automatic co-termination or proration.** Independent Branch anniversaries remain independent unless a later explicit policy approves co-term behavior.
8. **Legal authority is Universal Master Agreement + Merchant Order Form.** Current required Master is accepted once per Business/version; each governed commercial commitment gets immutable Order Form evidence. An unchanged Master is not repeatedly accepted for another Branch, renewal or plan change.
9. **Merchant Web manages commercial self-service.** Mobile shows Branch plan/status/limits and hands detailed billing to Merchant Web securely.
10. **WhatsApp sells; AI assists.** Both consume shared entitlement facts and never create subscription/commercial truth.
11. **Legacy retirement is late.** `tenant_subscriptions` remains compatibility runtime until C2-10 proves the new authority.

## 3. Current subscription/runtime authority

### 3.1 `subscription_plans`

Production currently uses legacy plan code `business` (`SellerTray Business`). The table is not a Commercial V2 Plan Profile authority:

- billing interval is legacy monthly;
- trial semantics are embedded;
- usage pricing fields sit directly on the plan;
- current usage event is `AI_ORDER_ACTIVITY`;
- there is no versioned feature/capability/limit grant model.

Treat `subscription_plans` as legacy compatibility/migration evidence, not the destination.

### 3.2 `tenant_subscriptions`

`tenant_subscriptions` remains the operational compatibility authority:

- primary key is `tenant_id`, therefore one subscription row per Business;
- states include `trial`, `active`, `past_due`, `grace`, `suspended`, `cancelled`;
- trial/current-period/grace timing is Business-wide;
- `orderdesk_subscription_can_write(tenant_id)` derives Business-wide write access from this row plus C1 entitlement-period state;
- `get_orderdesk_subscription_access(tenant_id)` exposes that Business-wide state to clients.

Production currently contains active, cancelled and trial `business` subscriptions. Historical rows are evidence to migrate; they do not prove historical Branch ownership that never existed.

### 3.3 C1 compatibility bridge

C1 already contains stronger immutable commercial evidence around the legacy runtime:

- governed commercial orders;
- immutable price snapshots;
- installment obligations/contracts/payments;
- setup/readiness/scheduling evidence;
- Master Agreement + Merchant Order Form evidence;
- entitlement events.

Current reconciliation appends governed entitlement evidence and then projects the result back into `tenant_subscriptions` so the old runtime continues granting access.

C2 must replace that projection only after Branch Subscription authority and shared entitlement resolution are proven. Do not leave two permanent subscription engines.

## 4. Merchant roles, capabilities and Branch scope

### 4.1 Role naming compatibility

The governing SellerTray merchant-facing roles are:

- **Owner**;
- **Manager**;
- **Cashier**.

The current internal/database compatibility value `staff` represents the merchant-facing **Cashier** role. It is **not a separate fourth merchant role**.

Production `tenant_members.role` currently permits `owner`, `manager`, `staff`; that is compatible with the governing role model so long as user-facing surfaces label the operational role Cashier and server behavior continues to treat `staff` as its compatibility value.

C2 must not create a new `cashier` database authority merely for naming consistency unless a later explicit migration decision requires it.

### 4.2 Current merchant capability codes

Current `sellertray_user_has_capability(...)` recognizes:

- `can_receive_stock`
- `can_adjust_stock`
- `can_count_stock`
- `can_apply_stock_count`
- `can_transfer_stock`
- `can_open_shift`
- `can_record_cash_movement`
- `can_record_expense`
- `can_correct_cash_movement`
- `can_close_shift`
- `can_review_shift`
- `can_print_receipt`
- `can_manage_devices`
- `can_manage_orders`
- `can_manage_products`
- `can_manage_purchasing`
- `can_manage_payments`
- `can_view_reports`
- `can_refund_sale`
- `can_accept_commercial_agreements`

Current role behavior is role/capability driven:

- Owner receives the current named merchant capabilities.
- Manager receives the current set except commercial-agreement acceptance unless explicitly granted.
- internal `staff` / merchant-facing Cashier receives the bounded operational default subset around shifts/cash/expense/printing.
- per-member capability overrides can alter allowed/denied behavior.

Plan entitlement must never replace this authorization model. A plan may permit returns while a particular Cashier remains unauthorized to return.

### 4.3 Branch scope

Branch authorization is already a separate server authority. Owner/Manager can operate active Business Branches. Internal `staff`/Cashier is either explicitly scoped through `branch_user_access` or, when no explicit Branch-access rows exist, falls back to the default Branch. Business-wide report scope differs from Cashier Branch report scope.

C2 must preserve this separation: **Plan entitlement is not Branch assignment**.

See `C2_CURRENT_STATE_INVENTORY_APPENDIX.md` for exact helper functions and compatibility semantics.

## 5. ProcessEdge/Admin capabilities

Current server/Admin privileged capability codes include:

- `admin.agreements.publish`
- `admin.agreements.recover`
- `admin.audit.export`
- `admin.audit.read`
- `admin.branch_setup.manage`
- `admin.installments.manage`
- `admin.merchant_ownership.transfer`
- `admin.merchants.retire`
- `admin.order_forms.issue`
- `admin.order_forms.publish`
- `admin.payments.reconcile`
- `admin.pricing.manage`

These are ProcessEdge operational/security authorities, not merchant Plan Profile entitlements. Preserve scope/AAL2/audit requirements for sensitive mutations.

## 6. Real product capability inventory

This inventory is input to C2-2 classification; “packageable candidate” does not mean a capability is already approved for a specific plan.

### Commerce/POS

Current behavior includes manual/WhatsApp-derived orders, POS selling, UOM-aware lines, customers, governed discounts/price effects, multi-method payment allocation, partial payment/outstanding receivables, receivable collection, fulfilment, returns/refunds, receipts/documents/printing and payment verification/reconciliation.

Possible commercial candidates include advanced discounts, Pay Later/partial-payment policy, returns, receivable management and advanced payment integrations.

Never package away transaction arithmetic, UOM normalization, stock integrity, payment state correctness, idempotency, audit evidence or tenant/Branch isolation.

### Inventory/purchasing

Current behavior includes product/catalogue management, stock receive, adjustment, count/apply-count, transfer, low-stock reporting and purchasing/receiving with Branch attribution.

Possible candidates include advanced inventory/purchasing/reporting/automation. Stock ledger, UOM, Branch attribution and replay correctness remain invariants.

### Cash/payments/receivables

Current behavior includes shifts, cash movements, expenses/corrections, merchant customer-payment methods, Branch payment-method assignment, Paystack/Flutterwave/bank/terminal/cash operational paths where configured, and outstanding-balance collection.

Merchant customer tender configuration is not ProcessEdge commercial subscription-payment configuration.

### Team/Branch management

Current behavior includes membership, role/capability administration, Branch assignment, Branch creation/management and Business/Branch context selection.

Possible commercial candidates include staff-seat limits and approved advanced team/permission features. **Branch count/extra Branch allowances are explicitly excluded from plan-limit/add-on design under current Commercial V2 policy; each Branch instead carries its own commercial obligation.** Authentication/authorization/isolation are never plan switches.

### WhatsApp

Current behavior includes connection/consent, credentials, Branch routing, catalogue mapping/sync support, webhook handling, customer resolution, WhatsApp order creation and payment/customer notification flows.

WhatsApp selling/channel access is a valid Feature/add-on candidate. WhatsApp must consume Branch entitlement but never create Branch Subscription truth.

### AI

Merchant AI is authenticated, Owner/Manager-only today, read-only, server-context governed, rate-limited and telemetry-backed. It cannot execute sales, stock, payment, purchasing, staff, WhatsApp, printer or settings mutations.

AI access/usage may be commercialized; operational abuse rate limits are not the same as merchant plan limits. AI may explain entitlement facts but not create them.

### Reports/exports

Merchant report-center/insight surfaces and Admin audit/commercial/onboarding portfolios already exist with role/capability/Branch-scope intersections.

Report families, advanced analytics and export limits are candidates. Historical audit/compliance evidence must remain available to authorized authorities regardless of merchant package.

### Printing/devices

Receipt/document printing and device/printer management exist. Advanced device/integration limits may be candidates, while basic transaction evidence remains accessible.

## 7. Feature vs Capability vs Limit

C2-2 must preserve these distinct concepts:

- **Feature** — module/product availability such as WhatsApp selling, AI insights, advanced reports or integrations.
- **Capability** — an action a plan may permit but which still requires actor authorization, such as return, stock transfer or advanced discounting.
- **Limit** — a quantitative threshold such as staff seats, AI usage, WhatsApp volume or export count.

Under current Commercial V2 policy, **Branch count is not a Plan Profile Limit**. Additional Branches create their own Branch subscription/commercial obligation instead of consuming an included-Branch allowance.

A Feature is not a user permission. A Capability is not automatically granted to every user. A Limit does not replace transaction validation.

## 8. Usage/quota authority

There is no canonical general C2 limit registry today.

Current usage infrastructure is specialized/legacy:

- `usage_events` records tenant-level events;
- `usage_settlements` and items settle current usage;
- legacy default event is `AI_ORDER_ACTIVITY`;
- legacy plan stores usage pricing fields;
- AI has a per-minute operational rate limit that is abuse protection, not plan quota.

C2-2 must introduce canonical Limit definitions and authoritative usage bindings instead of treating one legacy event as a universal quota design.

## 9. Pricing and commercial masters

### Price authority

C1 already provides valuable immutable/effective-dated pricing via `sellertray_commercial_price_versions`, lifecycle controls, standard/merchant-override scopes, tax snapshots, effective windows and immutable order price snapshots.

Current `price_kind` supports `subscription` and `branch_setup`. Current subscription pricing remains plan-code/Business-oriented; Admin UI still defaults to `business`, publishes monthly pricing and derives annual pricing from the current policy.

C2-3 should preserve versioning/evidence while generalizing charge classes and binding recurring subscription prices to explicit Plan Profile Version/cycle/effective policy.

### Setup pricing

Branch setup is already a separate one-time Branch-attributed charge. Preserve that separation from recurring Branch subscription charges.

### Merchant overrides

C1 has effective-dated Business-specific overrides. C2-3 must explicitly define whether future recurring overrides bind at Business, Branch, Plan Profile/cycle or another governed subject. Historical accepted snapshots remain immutable.

## 10. Installment authority

Reusable versioned foundations already exist:

- `sellertray_installment_schedule_templates`
- `sellertray_installment_schedule_template_lines`
- `sellertray_installment_policy_versions`
- policy-change commands
- immutable installment contract snapshots

Reuse/generalize these rather than replacing them.

Compatibility debt remains in initial purchase/UI through fixed `two_installment_70_30` and `three_installment_60_20_20` codes/labels. C2-3 must make availability/selection data-driven. Later policy changes cannot mutate accepted installment contracts.

## 11. Tax authorities

Keep two tax domains separate:

1. **Merchant operational/customer-sales tax** — `sellertray_tax_configurations` governs merchant commerce tax.
2. **ProcessEdge commercial tax** — C1 commercial price/order evidence captures tax for SellerTray subscription/setup charges.

C2-3 needs a governed SellerTray Commercial Tax Profile/Master for ProcessEdge charges. Never reuse the merchant’s customer-sales tax configuration as subscription tax authority. Historical snapshots remain immutable.

## 12. Payment-method authorities

Keep two payment domains separate:

1. **Merchant customer tender methods** — `merchant_payment_methods`, `sellertray_branch_payment_methods` and related runtime settings govern how merchants receive customer money.
2. **ProcessEdge commercial payment methods** — C1 settlement/payment evidence records how SellerTray obligations are settled, but the final configurable ProcessEdge Commercial Payment Method Master is not yet present.

C2-3 must create the ProcessEdge commercial-payment authority without contaminating merchant customer tender configuration.

## 13. Commercial-order authority

C1 `sellertray_commercial_orders` preserves governed purchase lifecycle/settlement evidence.

Current price snapshots encode:

- one `subscription` line carrying `plan_code` with `branch_id = null`;
- Branch-specific `branch_setup` lines.

Therefore current C1 can represent one Business subscription plus multiple Branch setup obligations, but not independent Branch subscriptions with different plans/cycles.

Current first-purchase behavior also assumes one Business plan, Branches as setup subjects, one governed initial subscription purchase and legacy trial/runtime semantics.

C2-6 must introduce Branch subscription subjects/lines without rewriting historical C1 orders.

## 14. Legal authority

The final legal target already exists and must be extended rather than replaced.

### Universal Master Agreement

Canonical authority includes versioned Master records/source governance and `sellertray_master_agreement_acceptances`. The current required Master is accepted once per Business/version with exact content/version evidence.

### Merchant Order Form

`sellertray_commercial_order_forms` and issue/review/confirmation paths preserve immutable purchase-specific commercial evidence. Each governed commercial commitment that requires confirmation gets its own Order Form.

### Legacy agreement history

Older `sellertray_commercial_agreements`, template versions and acceptances remain historical/audit evidence only.

### C2-7 rule

Adding a Branch, renewing or changing plan under the same required Master version must not force duplicate Master acceptance. A newly required Master version must be accepted before the next governed commitment that requires it completes.

## 15. Setup/readiness/activation authority

C1/OA3/OA4 already provide Branch-aware setup obligations/readiness, appointments/events, service-area/worker scheduling, structured completion evidence and reconciliation history.

Preserve these facts. What changes in C2-8 is the lifecycle owner: each Branch Subscription activates independently instead of ultimately projecting all access into one Business subscription row.

## 16. Cross-surface convergence map

| Surface | Current authority | C2 destination |
|---|---|---|
| Shared Core | Business-wide `tenant_subscriptions` plus C1 evidence | Branch Subscription + Plan Profile Versions + catalogues + commercial masters + shared resolver |
| Merchant Web | Business Billing Center / one-plan initial purchase; Branches mainly setup subjects | Branch-by-Branch buy/renew/change, usage/limits, Order Forms, setup, balances |
| Mobile | `get_orderdesk_subscription_access`; legacy monthly/usage assumptions; tenant/user `canWrite + validUntil` cache | Branch plan/status/limit visibility; Branch/version bounded cache; secure billing handoff |
| Admin Web | Strong pricing/agreement/settlement/setup/audit surfaces with legacy plan assumptions | Professional Plan Profiles, commercial masters, Branch Subscription review/recovery |
| WhatsApp | Branch routing + channel/order/payment behavior; no subscription ownership | Resolve Branch and consume shared entitlement before gated behavior |
| AI | Read-only governed Business analysis | Read/explain Branch plan/limit/usage facts; no commercial mutation |
| Reporting/Audit | Merchant/Admin reporting with Business-oriented subscription semantics | Branch plan mix/version/period/renewal/usage/legal/settlement/intervention reporting |
| Offline/Sync | Business-level bounded write cache + governed command replay | Branch/version entitlement snapshot; replay revalidates current server truth |

## 17. Exact old -> new authority map

| Current authority | Current role | C2 destination | Treatment |
|---|---|---|---|
| `subscription_plans` | Legacy plan/trial/usage config | Plan Profile + immutable Plan Profile Version + separate pricing | Preserve legacy codes as migration evidence; no plan-name runtime branching. |
| `tenant_subscriptions` | One Business-wide runtime row | Branch Subscriptions; Business aggregate only | Keep active through parallel build; migrate/cut over only in C2-10. |
| `get_orderdesk_subscription_access` | Business-wide client read | Shared Branch subscription/entitlement read model | Compatibility adapter during transition; retire stale Business semantics after cutover. |
| `orderdesk_subscription_can_write` | Business-wide write gate | Branch entitlement ∩ user permission ∩ Branch scope ∩ transaction state ∩ limits | Replace affected server checks deliberately in C2-9/C2-10, never with client-only logic. |
| `sellertray_commercial_entitlement_events` | Immutable C1 entitlement history | Branch lifecycle/entitlement event history + migration provenance | Preserve evidence; do not make a competing resolver. |
| C1 update of `tenant_subscriptions` | Projects C1 result into old runtime | Canonical Branch Subscription lifecycle mutation | Retain until cutover; stop only after no supported flow depends on it. |
| `sellertray_commercial_orders` | Governed Business purchase container | Commercial order with Branch subscription subjects | Extend subject model; do not rewrite historical orders. |
| subscription snapshot with `branch_id = null` | Business subscription line | Branch-bound subscription order line | Historical rows remain valid; new C2 commitments bind Branch. |
| Branch setup snapshot | One-time Branch setup charge | Branch setup charge class | Reuse/preserve, separate from recurring subscription. |
| commercial price versions | Subscription/setup pricing evidence | Versioned charge/pricing authority bound to explicit plan/cycle/tax subject | Reuse version lifecycle; generalize bindings. |
| Business price override | Business-specific price | Explicit governed recurring override subject | Preserve historical snapshots; define future scope explicitly. |
| installment templates/policies/contracts | Versioned installment authority | Installment Structure/Policy Master | Reuse; remove fixed branching; contracts immutable. |
| merchant operational tax | Customer-sales tax | Remains merchant tax authority | Never use as SellerTray subscription tax. |
| commercial tax snapshots | ProcessEdge charge evidence | Commercial Tax Profile/Master + immutable snapshots | Normalize master; preserve history. |
| merchant/Branch payment methods | Customer tender authority | Remains merchant payment authority | Never use as ProcessEdge commercial payment master. |
| C1 commercial payment/settlement | SellerTray obligation settlement evidence | ProcessEdge Commercial Payment Method Master + immutable settlement evidence | Add master without rewriting past payments. |
| Master Agreement versions/acceptances | Universal legal authority | Same canonical Master authority | Preserve; accept once per Business/current required version. |
| Merchant Order Forms | Purchase-specific evidence | Same authority extended to Branch subscription subjects | New immutable confirmation per governed commitment. |
| legacy commercial agreements | Pre-separation history | Historical/audit only | Never reactivate as universal agreement authority. |
| Branch setup/readiness/appointments | Branch setup authority | Branch Subscription activation prerequisite | Reuse/relink; each Branch activates independently. |
| merchant role/capability + Branch access | User authorization/scope | Separate intersecting authorization dimensions | Preserve; internal `staff` remains merchant-facing Cashier compatibility unless explicitly changed. |
| Admin capability framework | ProcessEdge privileged authorization | Same Admin security authority | Never merchant-package; preserve AAL2/scope/audit. |
| usage events/settlements | Legacy specialized usage billing | Canonical Limit/usage bindings + approved usage settlement | Migrate deliberately; one event is not a universal quota model. |
| Mobile tenant/user access cache | Bounded Business offline write flag | Bounded Branch/version entitlement snapshot | Scope/version by Branch/actor; replay revalidates. |
| WhatsApp Branch routing | Operational Branch choice | Input to shared Branch entitlement check | Keep routing separate; channel never owns subscription. |
| AI governed context | Read-only Business analysis | Read-only context with Branch entitlement/usage facts | Resolver consumption only; no mutation. |

## 18. Verified compatibility assumptions C2 must remove

These are migration targets, not isolated pre-C2 fixes:

1. `business` as the effective legacy plan identity.
2. Business-level `trial` semantics as purchase/runtime gate.
3. one-row-per-Business `tenant_subscriptions` authority.
4. legacy monthly-only subscription typing.
5. `AI_ORDER_ACTIVITY` embedded as legacy plan/usage event.
6. Mobile fallback `SellerTray Business` and monthly billing type.
7. Mobile offline authority cached at tenant/user rather than Branch/version.
8. initial purchase assumes one Business plan and Branches only as setup subjects.
9. subscription price snapshot requires no Branch.
10. Business-level guard against another governed subscription purchase.
11. fixed 70:30 and 60:20:20 initial-purchase compatibility choices.
12. Admin pricing default `planCode: business`.
13. current annual pricing derived from monthly policy instead of a future general cycle-pricing master.
14. Branch readiness ultimately projects into Business runtime rather than owning Branch Subscription lifecycle.

The internal `staff` value is **not** on this removal list merely because merchant UI calls the role Cashier. Rename/migration is unnecessary unless a later explicit decision changes the compatibility model.

## 19. Always-on platform invariants

Do not turn these into plan entitlement switches:

- tenant and Branch isolation;
- authentication/authorization;
- UOM/Stock UOM integrity;
- inventory ledger integrity;
- payment state-machine correctness;
- tax arithmetic correctness;
- command/payment idempotency;
- immutable commercial/legal evidence;
- Admin audit/AAL2 controls;
- safe offline replay validation;
- required audit history;
- server-authoritative transaction validation.

## 20. C2-2 classification input

Every candidate must be classified as one of:

- always-on platform invariant;
- Feature;
- Capability;
- Limit;
- add-on candidate;
- Admin-only operational capability;
- non-commercial role/permission/scope concept.

Current policy explicitly excludes Branch count/included-Branch allowances from Plan Profile Limits/add-ons; each Branch is its own commercial subscription subject.

Only after this classification is reviewed should editable Starter/Growth/Scale seeds be created.

## 21. Staggered multi-Branch acceptance contract

C2 must prove real independent lifecycle, not merely multiple rows:

- March: Branch A buys its plan/cycle, satisfies its own obligations and activates.
- September: same Business adds Branch B; Branch B selects its own valid plan/cycle at then-current pricing, receives its own setup/payment/Order Form obligations and activates independently.
- Branch A keeps operating while Branch B is pending.
- Branch A renews in March; Branch B renews in September.
- No automatic co-termination/proration unless later explicitly approved.

A valid steady state can therefore include:

- Ikeja — Growth / Yearly / Active / renews March;
- Lekki — Starter / Monthly / Active / renews September;
- Abuja — Scale / Setup scheduled.

Business dashboards aggregate this state but do not manufacture one Business plan/expiry.

## 22. Approved release batches

1. **Batch 1 — C2-0 + C2-1:** governance reset, inventory, exact migration map.
2. **Batch 2 — C2-2 + C2-3:** Plan Profile/catalogue + commercial masters; no runtime cutover.
3. **Batch 3 — C2-4 + C2-5:** Branch Subscription + shared resolver in parallel with legacy runtime.
4. **Batch 4 — C2-6 + C2-7:** Branch-aware purchasing/settlement + Master/Order Form convergence.
5. **Batch 5 — C2-8 + C2-9:** Branch activation + all surface convergence.
6. **Batch 6 — C2-10:** production migration, parity evidence and controlled cutover.
7. **Batch 7 — C2-11:** automated/human staggered multi-Branch acceptance, then legacy retirement.

## 23. Batch 1 exit condition

Batch 1 is ready to close when:

- this inventory and its appendix are reviewed and merged;
- `OA5_C2_SEQUENCE.md` reflects final Master + Order Form doctrine and independent Branch lifecycle;
- no Commercial V2 schema/runtime mutation is mixed into the governance PR;
- C2-2/C2-3 can derive its first catalogue/master schema from this evidence rather than assumptions.

Until then, production continues using the legacy compatibility runtime intentionally.