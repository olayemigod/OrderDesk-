---
name: sellertray-c2-current-state-inventory
description: "C2-0/C2-1 current-state authority inventory and old-to-new migration map for SellerTray Commercial V2."
metadata:
  author: ProcessEdge Solutions Limited
  product: SellerTray
  version: "0.1.0"
  status: governing-extension
  baseline_commit: "d8024c215850e0e9a3a0ce1496d1d0dd5d7cd150"
  inventory_date: "2026-11-02"
---

# SellerTray C2 Current-State Inventory and Migration Map

## 1. Purpose and stage boundary

This document is the governed output of **C2-0 Governance Reset + C2-1 Capability and Commercial Inventory**.

It records what SellerTray actually supports before Commercial V2 schema work begins and maps current authorities to the approved Branch-owned destination.

This inventory is based on:

- repository baseline `d8024c215850e0e9a3a0ce1496d1d0dd5d7cd150`;
- current repository migrations, server/RPC authorities and cross-surface clients;
- read-only inspection of the live SellerTray production schema on 2026-11-02.

**No C2 schema, entitlement-runtime cutover or production commercial mutation is authorised by this document.** The legacy runtime remains intentionally active until C2-10 parity and controlled cutover.

The target remains:

> **Business -> Branch -> Branch Subscription -> Plan Profile Version -> Resolved Entitlements -> SellerTray surfaces**

Business-level subscription state becomes an aggregate/read model only.

Effective operational authority is conceptually:

> **Branch Plan Entitlement ∩ User Permission ∩ Branch Scope ∩ Business/transaction state ∩ Available quota/limit**

The entitlement resolver must not replace user authorization, Branch scoping, transaction-state validation or quantitative usage checks. It intersects with them.

## 2. C2-0 governance decisions now locked

1. **Branch is the subscription owner.** Each Branch owns its own plan version, billing cycle, lifecycle, entitlement period and renewal anniversary.
2. **Business subscription state is aggregate only.** There is no authoritative single Business plan or expiry after C2 cutover.
3. **Plan names are configuration.** Starter, Growth and Scale may be seeded later, but code must not branch on those names.
4. **Plan and price are separate authorities.** A Plan Profile Version describes features/capabilities/limits; effective-dated commercial masters determine price, tax and payment obligations.
5. **Branch activation is independent.** A pending/new/failed Branch cannot block another Branch whose own prerequisites are satisfied.
6. **No automatic co-termination or proration.** Independent Branch anniversaries remain independent unless a later explicit co-term policy is approved.
7. **Universal Master Agreement + Merchant Order Form is the legal model.** The current required Master version is accepted once per Business; each governed commercial commitment gets its own immutable Order Form confirmation. An unchanged Master is not repeatedly accepted for another Branch, renewal or plan change.
8. **Merchant Web manages commercial self-service.** Mobile exposes status/limits and performs secure handoff for complex billing flows.
9. **WhatsApp sells; AI assists.** They consume shared entitlement facts and must never create subscription/commercial authority.
10. **Legacy retirement is late.** `tenant_subscriptions` remains compatibility authority until C2-10 proves migration/read-write parity and the production cutover.

## 3. Current subscription/runtime authority

### 3.1 `subscription_plans`

Production currently contains the legacy `business` plan (`SellerTray Business`). The legacy table is not capable of representing Commercial V2 Plan Profiles:

- billing interval is constrained to `month`;
- trial semantics remain part of the plan/runtime model;
- usage fields are attached directly to the plan;
- the current usage event is `AI_ORDER_ACTIVITY`;
- there is no versioned feature/capability/limit grant model.

This table is therefore **legacy plan compatibility**, not the C2 Plan Profile authority.

### 3.2 `tenant_subscriptions`

`tenant_subscriptions` remains the operational compatibility authority today.

Key facts:

- primary key is `tenant_id`, therefore exactly one subscription row per Business;
- current status vocabulary is `trial`, `active`, `past_due`, `grace`, `suspended`, `cancelled`;
- the row owns trial/current-period/grace timing at Business level;
- `orderdesk_subscription_can_write(tenant_id)` derives write access from this Business-wide row plus C1 entitlement-period state;
- `get_orderdesk_subscription_access(tenant_id)` exposes the Business-wide subscription state to clients.

The production population at inventory time contained a mixture of active, cancelled and trial `business` subscriptions. Historical rows must be migrated as evidence; they are not proof that each historical Branch independently owned a subscription.

### 3.3 C1 compatibility bridge

C1 already has stronger commercial evidence around the legacy runtime:

- governed commercial orders;
- immutable price snapshots;
- installment obligations/contracts/payments;
- setup readiness/scheduling;
- Master Agreement and Order Form evidence;
- entitlement events.

The current entitlement reconciliation path appends the C1 commercial entitlement event and then projects the result back into `tenant_subscriptions` so the old runtime can continue granting access.

C2 must replace that projection **only after** Branch Subscription authority and shared entitlement resolution are proven. It must not create a second permanently competing subscription engine.

## 4. Current merchant roles and authorization

### 4.1 Governed role model

SellerTray governance recognises:

- Owner;
- Manager;
- Staff;
- Cashier.

### 4.2 Production runtime divergence

Production `tenant_members.role` currently constrains rows to:

- `owner`;
- `manager`;
- `staff`.

`cashier` is therefore a governance/runtime divergence that C2 cataloguing must not accidentally preserve as the target role model.

### 4.3 Current named merchant capabilities

The current server resolver `sellertray_user_has_capability(...)` recognises these capability codes:

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

Current implicit behavior is role-driven:

- Owner receives the current named merchant capabilities.
- Manager receives the current set except commercial-agreement acceptance unless explicitly granted.
- Staff receives a bounded default operational subset around shifts/cash/expense/printing.
- Per-member capability overrides can alter allowed/denied behavior.

C2 Plan Entitlements must **not** replace this authorization model. A plan may permit a capability category while the user role/capability authority still denies the user.

## 5. Current ProcessEdge/Admin capabilities

Current server/admin authorities include these privileged capability codes:

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

These are ProcessEdge operational authorities. They must remain distinct from merchant Plan Profile capabilities. C2 must never turn an Admin capability into a commercial package entitlement.

Sensitive Admin mutations continue to require the existing capability/scope/AAL2/audit discipline where applicable.

## 6. Actual SellerTray product capability inventory

The catalogue below is the C2-1 implementation inventory. “Packageable candidate” means C2-2 may expose the capability/feature/limit in plan configuration after product review. It is **not** an instruction to disable it on lower plans yet.

### 6.1 Commerce and POS

Current supported behavior includes:

- create/manual/WhatsApp-derived orders;
- POS selling;
- product/UOM-aware line entry;
- customer selection;
- governed discounts/price effects where implemented;
- multi-method payment allocation;
- partial payment / outstanding receivable behavior;
- receivable collection;
- order fulfilment/status transitions;
- returns/refunds through governed return authority;
- sale documents/receipts and printing;
- payment verification/reconciliation paths.

**Packageable candidates:** advanced discount authority, partial-payment/Pay Later policy, returns, receivable-management features, advanced payment integrations.

**Never package away:** transaction arithmetic correctness, UOM normalization, stock posting integrity, payment-state correctness, idempotency, audit/evidence, tenant/Branch isolation.

### 6.2 Inventory and purchasing

Current supported behavior includes:

- product/catalogue management;
- stock receive;
- stock adjustment;
- stock count and apply-count workflow;
- stock transfer;
- low-stock reporting;
- purchasing/receiving;
- Branch-scoped inventory operations.

**Packageable candidates:** advanced stock operations, purchasing depth, advanced inventory reporting/automation.

**Never package away:** stock-ledger integrity, UOM conversion/normalization, Branch attribution and replay/idempotency correctness.

### 6.3 Cash, payments and receivables

Current supported behavior includes:

- opening/closing/reviewing shifts;
- cash movement and expenses;
- correction/review controls;
- merchant customer-payment methods;
- Branch customer-payment method assignment;
- Paystack/Flutterwave/bank/terminal/cash operational payment paths where configured;
- outstanding-balance collection.

Merchant customer tender configuration is **not** the same authority as ProcessEdge commercial subscription-payment methods.

### 6.4 Team and Branch management

Current supported behavior includes:

- merchant team membership;
- role/capability administration;
- Branch assignment/scope;
- Branch creation/management;
- Business/Branch context selection.

**Packageable candidates:** staff-seat limits, advanced role/capability features, additional Branch allowances/add-ons.

Security isolation and minimum authorization controls are not commercial features and remain mandatory on every plan.

### 6.5 WhatsApp

Current supported behavior includes:

- governed WhatsApp connection/consent;
- tenant connection credentials;
- Branch routing/selection;
- catalogue mapping/sync support;
- webhook message handling;
- customer resolution;
- order creation from WhatsApp;
- payment/customer notification flows.

**Packageable candidate:** WhatsApp selling/channel entitlement and channel-specific limits/add-ons.

WhatsApp must consume Branch entitlement before performing gated selling behavior. It must not create a Branch Subscription or commercial state.

### 6.6 AI

Current Merchant AI:

- is authenticated;
- is read-only;
- loads a governed server context;
- currently restricts insight access to Owner/Manager;
- is rate-limited;
- records provider/usage telemetry;
- cannot execute sales, stock, payment, purchasing, staff, WhatsApp, printer or settings changes.

**Packageable candidates:** AI access, usage allowance/limit, premium insight depth if later approved.

AI must consume resolved entitlement/usage facts and may explain them, but cannot create commercial authority.

### 6.7 Reports and exports

Current reporting includes merchant report-center/insight surfaces and Admin audit/commercial/onboarding portfolios. Report visibility already intersects role/capability/Branch scope in different places.

**Packageable candidates:** report families, advanced analytics, export limits/features.

Audit evidence and correctness/security logs must remain available to authorised operational/compliance authorities regardless of merchant plan packaging.

### 6.8 Printing and devices

Current behavior includes receipt/document printing and device/printer management.

**Packageable candidates:** advanced device count, premium printing/device integrations if explicitly commercialised later.

Basic transaction evidence must remain accessible even when a particular device integration is not included.

## 7. Features versus capabilities versus limits

C2-2 must keep three distinct catalogue concepts:

### Feature
A product/module availability concept, for example WhatsApp selling, AI insights, advanced reports, advanced inventory or integrations.

### Capability
An action that may be permitted by a plan but still requires user authorization, for example returns, stock transfer or advanced discounting.

### Limit
A quantitative threshold, for example Branch count, staff seats, AI usage, WhatsApp volume, export count or another metered allowance.

A Feature is not automatically a user permission. A Capability is not automatically granted to every user. A Limit does not replace transaction validation.

## 8. Current usage/quota authority

There is no canonical general C2 limit/quota registry today.

Existing usage infrastructure is legacy/specialised:

- `usage_events` records tenant-level metered events;
- `usage_settlements`/items settle legacy usage;
- the existing default event code is `AI_ORDER_ACTIVITY`;
- the current legacy plan directly stores usage pricing fields;
- Merchant AI also has an operational per-minute rate limit, which is abuse protection rather than a merchant commercial entitlement limit.

C2-2 must introduce canonical Limit definitions and authoritative usage bindings rather than reusing the legacy single event as a universal quota design.

## 9. Current pricing and commercial masters

### 9.1 Price versions

C1 already has valuable immutable/effective-dated pricing authority:

- `sellertray_commercial_price_versions`;
- price lifecycle controls;
- standard and merchant-override scopes;
- tax snapshots;
- effective windows;
- immutable commercial-order price snapshots.

Current `price_kind` is limited to:

- `subscription`;
- `branch_setup`.

Current subscription pricing is still plan-based and Business-oriented. Admin UI also currently seeds `planCode: business`, publishes monthly pricing and derives annual pricing from the monthly amount.

C2-3 should preserve the versioning/evidence model while generalising charge classes and binding subscription price to the appropriate Plan Profile Version/cycle/effective policy.

### 9.2 Setup pricing

Branch setup already has a separate one-time price class and Branch-attributed order snapshot lines. This is compatible with the C2 doctrine that setup pricing is separate from recurring Branch subscription pricing.

### 9.3 Merchant overrides

C1 already supports Business-specific price overrides with effective windows. C2 must decide whether recurring overrides bind at Business, Branch, Plan Profile/cycle or another explicit governed subject. Existing accepted snapshots remain immutable.

## 10. Current installment authority

Newer C1/OA2 work already provides versioned installment masters:

- `sellertray_installment_schedule_templates`;
- `sellertray_installment_schedule_template_lines`;
- `sellertray_installment_policy_versions`;
- policy change commands;
- immutable installment contract snapshots.

This foundation should be **reused and generalised**, not replaced.

However, the current initial-purchase implementation still contains hard-coded compatibility assumptions for:

- `two_installment_70_30`;
- `three_installment_60_20_20`;
- fixed percentage labeling in Merchant Web.

C2-3 must make enabled structures and policy selection data-driven. A policy change must not mutate previously accepted installment contracts.

## 11. Current tax authorities

There are two distinct tax contexts that must remain separate:

1. **Merchant operational tax** — `sellertray_tax_configurations` is tenant-revisioned operational sales tax configuration used by commerce/financial-document flows.
2. **ProcessEdge commercial tax** — C1 commercial price versions carry tax snapshots for SellerTray subscription/setup purchases.

C2-3 must introduce/normalise a governed **SellerTray Commercial Tax Profile/Master** for ProcessEdge charges. It must not silently reuse a merchant's customer-sales tax setting as SellerTray subscription tax authority.

Historical order/price tax snapshots remain immutable.

## 12. Current payment-method authorities

Again, two contexts must remain separate:

1. **Merchant customer tender methods** — `merchant_payment_methods`, `sellertray_branch_payment_methods` and related runtime/payment settings govern how a merchant receives money from customers.
2. **ProcessEdge commercial payment methods** — SellerTray subscription/setup/installment settlement currently records payment evidence through C1 settlement/admin/payment paths but does not yet have the final configurable ProcessEdge Commercial Payment Method Master required by C2.

C2-3 must create/configure the ProcessEdge commercial-payment authority without contaminating merchant customer tender configuration.

## 13. Current commercial-order authority

### 13.1 `sellertray_commercial_orders`

C1 commercial orders preserve governed purchase state, settlement and lifecycle evidence.

### 13.2 Price snapshots

`sellertray_commercial_order_price_snapshots` currently distinguishes:

- one `subscription` line that carries `plan_code` and **no Branch**;
- `branch_setup` lines that carry Branch IDs.

This is a central C2-6 migration point. The current model can represent one Business subscription plus multiple Branch setup obligations, but not independent Branch subscriptions with different plans/cycles.

### 13.3 Initial purchase compatibility assumptions

The current first-purchase command/UI assumes:

- one selected plan for the Business;
- selected Branches are setup subjects, not subscription owners;
- an existing Business governed subscription order blocks another “initial” subscription purchase;
- compatibility logic remains tied to trial/current Business runtime semantics;
- fixed installment structure codes are still surfaced.

C2-6 must replace this with commercial order subjects/lines that can bind each Branch to its own Plan Profile Version and cycle.

## 14. Current legal authority

The final approved legal model already exists and is the C2 legal target.

### 14.1 Universal Master Agreement

Canonical tables/functions include:

- `sellertray_master_agreement_versions`;
- source documents/quarantine authority;
- `sellertray_master_agreement_acceptances`;
- Master Agreement acceptance/read functions.

A Business accepts the current required Master version once. The acceptance binds exact version/content evidence.

### 14.2 Merchant Order Form

`sellertray_commercial_order_forms` and related issue/review/confirmation paths preserve purchase-specific immutable commercial evidence.

Every governed commercial commitment that requires confirmation gets its own Order Form snapshot/confirmation.

### 14.3 Legacy agreement history

Older `sellertray_commercial_agreements`, template versions and acceptances remain historical evidence only. They must not become a second general-agreement authority.

### 14.4 C2-7 rule

Adding a Branch, renewing or changing plan under the same required Master version must **not** force duplicate Master acceptance. A newly required Master version must be accepted before the next governed commitment requiring it can complete.

## 15. Current setup/readiness/activation authority

C1/OA3/OA4 already provides Branch-aware setup evidence:

- Branch setup obligations/readiness;
- setup appointments and events;
- service-area/worker scheduling masters;
- structured completion evidence;
- reconciliation/activation event history.

This is useful C2 input, but current activation ultimately projects into the Business-wide compatibility subscription row.

C2-8 should preserve the Branch setup/readiness evidence while making each Branch Subscription's activation independent.

## 16. Cross-surface inventory and required C2 convergence

### Shared Core

**Today:** Business-wide `tenant_subscriptions` + C1 commercial evidence around it.

**C2:** Branch Subscription + Plan Profile Versions + catalogues + commercial masters + shared resolver become canonical.

### Merchant Web

**Today:** Billing Center shows Business commercial orders and one-plan initial purchase. Branches participate mainly as setup subjects. Pricing/settlement/legal/setup management already exists.

**C2:** full Branch-by-Branch subscription management: buy, renew, change plan/cycle, usage/limits, Order Forms, setup and balances.

### Mobile

**Today:** `loadSubscriptionAccess(tenantId)` calls `get_orderdesk_subscription_access`, hardcodes legacy monthly/`AI_ORDER_ACTIVITY` response types and caches only tenant/user `canWrite + validUntil` for bounded offline access.

**C2:** show active Branch plan/status/limits; cache a bounded/versioned Branch entitlement snapshot; secure handoff to Merchant Web for complex billing; replay always revalidates server authority.

### Admin Web

**Today:** strong pricing, agreements, settlement, setup, audit and portfolio surfaces exist, but pricing still carries legacy plan assumptions and Business overrides.

**C2:** professional Plans & Pricing, Plan Profile/version management, commercial tax/payment/installment masters, Branch Subscription inspection/recovery and audit, retaining current capability/AAL2/audit controls.

### WhatsApp

**Today:** connection, Branch routing, catalogue mapping, webhook order/payment flows exist. WhatsApp does not own subscription truth.

**C2:** resolve the relevant Branch and check shared Branch entitlement before gated channel behavior. Never mutate subscription truth from WhatsApp.

### AI

**Today:** authenticated Owner/Manager read-only analysis over governed server context; no mutation authority.

**C2:** include governed Branch plan/limit/usage facts and entitlement checks/explanations. AI still cannot create commercial state.

### Reporting/Audit

**Today:** merchant reports and Admin audit/commercial/onboarding reporting exist but subscription is still Business-oriented.

**C2:** Branch plan mix, Plan Profile Version, periods, renewals, usage/limits, legal state, settlement and privileged interventions become reportable.

### Offline/Sync

**Today:** Business-level bounded write authority is cached and replayed through governed server commands.

**C2:** cache Branch/version-scoped entitlement state; fail closed when stale/expired; replay revalidates current server entitlement, user permission, Branch scope and transaction rules.

## 17. Exact old -> new authority map

| Current authority | Current role | C2 destination | Migration/cutover treatment |
|---|---|---|---|
| `subscription_plans` | Legacy Business plan/trial/usage configuration | Plan Profile + immutable Plan Profile Version + separate commercial pricing | Preserve legacy codes for migration evidence; do not make plan name/code a runtime conditional. |
| `tenant_subscriptions` | One Business-wide runtime subscription row | Branch Subscriptions; Business aggregate projection only | Keep active through parallel implementation; map in C2-10; cut runtime reads/writes only after parity proof. |
| `get_orderdesk_subscription_access` | Business-wide client subscription read | Shared Branch entitlement/subscription read model | Maintain compatibility adapter during transition, then retire stale Business semantics. |
| `orderdesk_subscription_can_write` | Business-wide write gate | Branch resolver ∩ user permission ∩ Branch scope ∩ transaction state ∩ limits | Replace affected command checks in controlled C2-9/C2-10 migration, never with client logic. |
| `sellertray_commercial_entitlement_events` | C1 immutable entitlement/reconciliation history | Branch Subscription/entitlement event history and migration provenance | Preserve event evidence; do not use as a competing permanent resolver. |
| C1 reconciliation update of `tenant_subscriptions` | Projects C1 event into old runtime | Branch Subscription lifecycle mutation under canonical command | Retain until Branch runtime cutover, then stop compatibility mutation only after no supported flow depends on it. |
| `sellertray_commercial_orders` | Governed Business commercial purchase container | Commercial order with Branch subscription subjects/lines | Reuse immutable order/evidence principles; extend subject model rather than overwrite historical orders. |
| subscription price snapshot with `branch_id = null` | One Business subscription line | Branch-bound subscription order line tied to Plan Profile Version/cycle | Historical rows remain valid; new C2 orders use Branch subscription subjects. |
| Branch setup snapshot lines | One-time Branch setup charge | Branch setup charge class | Reuse/preserve; keep separate from recurring subscription charge. |
| `sellertray_commercial_price_versions` | Effective subscription/setup pricing | Versioned charge/pricing authority bound to explicit subject/cycle/tax | Reuse versioning/lifecycle/evidence; generalise charge types and Plan Profile bindings. |
| Business merchant price override | Business-specific effective price | Explicit governed recurring override subject | Preserve historical snapshots; define Business/Branch/plan scope explicitly in C2-3. |
| installment templates/policy versions/contracts | Versioned installment authority with some legacy hard-coded entry paths | Installment Structure/Policy Master | Reuse masters; remove hard-coded structure branching; accepted contracts immutable. |
| `sellertray_tax_configurations` | Merchant operational/customer-sales tax | Merchant operational tax remains separate | Do not reuse as ProcessEdge subscription tax. |
| commercial price tax snapshot | ProcessEdge charge tax evidence | Commercial Tax Profile/Master + immutable order snapshot | Normalise master in C2-3; preserve historical snapshots. |
| merchant/Branch payment methods | Merchant customer tender authority | Merchant customer tender authority remains separate | Do not use as ProcessEdge commercial payment master. |
| C1 commercial payment/settlement evidence | SellerTray subscription/setup settlement | ProcessEdge Commercial Payment Method Master + existing immutable settlement evidence | Add governed method master without rewriting past payments. |
| Master Agreement versions/acceptances | Universal legal authority | Same canonical Master authority | Preserve; accept once per Business/current required version. |
| Commercial Order Forms | Purchase-specific immutable legal/commercial evidence | Same canonical Merchant Order Form authority, extended for Branch subscription subjects | Preserve; new immutable confirmation per governed commitment. |
| legacy commercial agreement tables | Historical pre-separation legal evidence | Historical/audit only | Never reactivate as universal legal authority. |
| Branch setup/readiness/appointment evidence | Branch-aware setup authority | Branch Subscription activation prerequisite | Reuse/relink; each Branch activates independently. |
| `tenant_member_capabilities` + role logic | User authorization | User permission dimension intersected by plan entitlement | Preserve separation; reconcile Cashier role/runtime divergence. |
| Admin capability framework | ProcessEdge privileged authorization | Same Admin security authority | Not merchant packageable; preserve AAL2/scope/audit discipline. |
| `usage_events`/settlements | Legacy specialised usage billing | Canonical limit/usage bindings + commercial usage settlement where approved | Migrate/bridge event definitions deliberately; do not assume one event fits all limits. |
| Mobile tenant/user operational-access cache | Bounded Business-level offline write flag | Bounded Branch/version entitlement snapshot | Version and scope by Branch/actor; replay revalidates server truth. |
| WhatsApp Branch routing | Selects operational Branch | Input to shared Branch entitlement check | Keep routing separate; channel never owns subscription. |
| AI governed context | Read-only Business operational analysis | Read-only governed context including Branch entitlement/usage facts | Add resolver consumption; no mutation authority. |

## 18. Hard-coded compatibility assumptions C2 must remove

These are verified migration targets, not invitations for isolated fixes before the new authority exists:

1. `business` as the effective legacy plan identity.
2. Business-level `trial` semantics as a purchase/runtime gate.
3. `tenant_subscriptions` one-row-per-Business authority.
4. legacy monthly-only plan interval typing.
5. `AI_ORDER_ACTIVITY` embedded as the legacy plan/usage event.
6. Mobile fallback `SellerTray Business` and monthly billing type.
7. Mobile offline authority cached at tenant/user rather than Branch/version.
8. first purchase assumes one Business plan with Branches as setup subjects.
9. subscription price snapshot requires `branch_id IS NULL`.
10. Business-level guard against a second governed subscription purchase.
11. initial purchase hard-coded `70:30` and `60:20:20` structure codes/labels.
12. Admin pricing form default `planCode: business`.
13. current subscription pricing policy derives annual pricing from the monthly amount; future cycle pricing must be governed data/policy rather than a client assumption.
14. Branch readiness currently ends by projecting into Business runtime rather than owning a Branch Subscription lifecycle.

## 19. Fundamental controls that are not plan-entitlement switches

The following are platform correctness/security properties and must not disappear because a plan does not list them:

- tenant isolation;
- Branch isolation/scope enforcement;
- user authentication and authorization;
- UOM integrity and Stock UOM normalization;
- inventory ledger integrity;
- payment state-machine correctness;
- tax arithmetic correctness;
- command/payment idempotency;
- immutable commercial/legal evidence;
- privileged Admin audit/AAL2 controls;
- safe offline replay validation;
- audit history required for governed actions;
- server-authoritative transaction validation.

Plan packaging may expose higher-level product features while these controls continue underneath every supported transaction.

## 20. C2-2 catalogue design inputs

C2-2 may now design the canonical catalogues from this inventory. The first design pass must explicitly classify each item as one of:

- always-on platform invariant;
- Feature;
- Capability;
- Limit;
- add-on candidate;
- Admin-only operational capability;
- non-commercial role/permission concept.

Do not seed Starter/Growth/Scale until this classification is reviewed. The seed profiles remain editable configuration, not code constants.

## 21. Multi-Branch lifecycle acceptance contract

The target must prove staggered independent lifecycle behavior, not merely multiple rows.

Required scenario:

- **March:** Branch A purchases a plan/cycle, completes its own obligations and activates.
- **September:** the same Business adds Branch B; Branch B selects its own plan/cycle at then-current pricing, receives its own setup/payment/Order Form obligations and activates independently.
- Branch A continues operating while Branch B is pending.
- Branch A renews on its March anniversary.
- Branch B renews on its September anniversary.
- No automatic co-termination or proration occurs unless a later explicit policy is approved.

Valid steady-state examples therefore include:

- Ikeja — Growth / Yearly / Active / renews March;
- Lekki — Starter / Monthly / Active / renews September;
- Abuja — Scale / Setup scheduled.

Business dashboards may aggregate this state but must not manufacture one Business plan or expiry.

## 22. C2 release-batch map

The approved bounded release sequence is:

1. **Batch 1 — C2-0 + C2-1:** governance reset, current-state inventory and exact migration map. **This document is the foundation output.**
2. **Batch 2 — C2-2 + C2-3:** Plan Profile/catalogue and commercial-master foundations; no runtime cutover.
3. **Batch 3 — C2-4 + C2-5:** Branch Subscription authority and shared entitlement resolver in parallel with legacy runtime.
4. **Batch 4 — C2-6 + C2-7:** Branch-aware purchasing/settlement plus final Master Agreement/Order Form convergence.
5. **Batch 5 — C2-8 + C2-9:** Branch activation and Merchant/Mobile/Admin/WhatsApp/AI/report/offline convergence.
6. **Batch 6 — C2-10:** production migration, dual-read/parity evidence and controlled runtime cutover.
7. **Batch 7 — C2-11:** automated/human multi-Branch acceptance, including staggered March/September lifecycle; only then retire legacy Business-wide runtime semantics.

## 23. Batch 1 exit condition

C2-0/C2-1 is ready to close when:

- this inventory is reviewed and merged;
- `OA5_C2_SEQUENCE.md` reflects the final Master Agreement + Merchant Order Form doctrine and staggered independent-Branch acceptance;
- no Commercial V2 schema/runtime mutation is mixed into the governance PR;
- the next PR can derive C2-2/C2-3 catalogues/masters from this exact map rather than assumptions.

Until then, production continues using the legacy compatibility runtime intentionally.