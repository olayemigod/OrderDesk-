---
name: sellertray-commercial-v2
description: "Normative Commercial V2 extension governing Branch-owned subscriptions, configurable Plan Profiles, entitlements, limits, commercial masters, agreement versioning and cross-surface subscription lifecycle."
metadata:
  author: ProcessEdge Solutions Limited
  product: SellerTray
  version: "0.1.1"
  status: governing-extension
---

# SellerTray Commercial V2 Governance

## Status and precedence

This file is a **normative extension** of `.agents/skills/sellertray-project-implementation/SKILL.md`, `COMMERCIAL.md`, `COMMERCIAL_C1.md`, `COMMERCIAL_FLEXIBILITY.md`, `ONBOARDING_ACTIVATION.md`, `ADMIN_CAPABILITIES.md`, `ADMIN_NAVIGATION.md`, `CROSS_SURFACE.md` and `INTELLIGENT_IMPLEMENTATION.md`.

It records later explicit product decisions approved on 2026-10-25 and 2026-10-30 and therefore controls where older commercial/onboarding wording conflicts.

The governing architecture remains:

> Mobile performs. Web manages. WhatsApp sells. AI assists. Admin operates the platform. Shared core governs business truth.

Commercial V2 must evolve the existing SellerTray commercial/subscription authority. It must not create a competing subscription engine, client-owned entitlement truth or plan-name branching in application code.

# 1. Branch owns the subscription

The long-term SellerTray subscription subject is **Branch**, not Business.

Rules:

1. A Business may own multiple Branches.
2. Each Branch may independently subscribe to a different SellerTray Plan Profile and billing cycle.
3. One Branch being unpaid, unready, suspended or expired must not automatically block another independently qualified Branch.
4. Business-level subscription status is a derived aggregate/read model, not the canonical subscription fact.
5. Branch count is not a Plan Profile limitation under the current approved policy. Every Branch remains governed through its own setup/commercial obligation.
6. Existing Business-level `tenant_subscriptions`/trial compatibility semantics remain legacy only until the governed C2 migration/cutover defined in `OA5_C2_SEQUENCE.md`.

Conceptually:

> Business -> Branch -> Branch Subscription -> Plan Profile Version -> Resolved Entitlements

# 2. Independent Branch activation

The older first-purchase rule requiring all Branch setup obligations in one Business purchase to be ready before any first activation is superseded for the Commercial V2 target architecture.

For each Branch, activation eligibility is derived from that Branch's governed facts:

> Branch commercial subscription line + required current agreement acceptance + qualifying confirmed settlement + that Branch's setup readiness -> Branch entitlement reconciliation -> Branch active

A Business may therefore show a mixed state such as:

- Ikeja — Growth — Active;
- Yaba — Starter — Active;
- Lekki — Scale — Setup scheduled.

The Business summary may show `2 Active · 1 Waiting for setup`, but it must not create another Business-wide activation switch.

# 3. Plans are configurable profiles, never hard-coded product branches

SellerTray must not encode runtime behavior such as:

- `if plan === 'Starter'`;
- `if plan === 'Growth'`;
- `if plan === 'Scale'`;
- fixed feature arrays in Mobile/Web clients;
- plan-specific permission logic duplicated across channels.

A subscription plan is a versioned **commercial entitlement profile** composed from governed data.

Each Plan Profile Version may define, as applicable:

- merchant-facing name and description;
- stable plan identity/code;
- lifecycle state: draft, published/active, retired/archived;
- effective-from/effective-until;
- allowed billing cycles;
- feature access;
- capability access;
- quantitative limits/quotas;
- applicable add-ons;
- installment eligibility/policy references;
- merchant-facing feature summary and sort/display metadata;
- version/replacement lineage;
- actor, approval/reason and immutable history.

Published versions must be immutable. A material change creates a new Plan Profile Version rather than rewriting the contract under historical subscribers.

# 4. Canonical feature, capability and limit catalogue

Commercial V2 must introduce one canonical governed catalogue that can be consumed by both Plan Profiles and role/permission profiling.

## 4.1 Feature catalogue

A feature is a product area or merchant-facing capability family, for example:

- Mobile POS;
- Merchant Web;
- WhatsApp Commerce;
- AI Assistant;
- Inventory;
- Purchasing;
- Customers;
- Receivables;
- Expenses;
- Suppliers;
- Reports;
- Advanced Analytics;
- Offline Operations;
- Bluetooth Printing;
- Barcode;
- Integrations;
- API/Webhooks.

Feature records must have stable identity, status and classification. The catalogue may contain planned/internal/deprecated features without making them purchasable or visible to merchants.

## 4.2 Capability catalogue

Capabilities represent governed actions rather than only broad screens. Examples include:

- `sales.create`;
- `sales.discount`;
- `sales.partial_payment`;
- `sales.pay_later`;
- `sales.void`;
- `sales.return`;
- `sales.refund`;
- `receivables.collect`;
- `inventory.view`;
- `inventory.adjust`;
- `inventory.transfer`;
- `inventory.count`;
- `products.create`;
- `products.edit`;
- `customers.create`;
- `expenses.create`;
- `expenses.approve`;
- `cash_shift.open`;
- `cash_shift.close`;
- `suppliers.manage`;
- `staff.manage`;
- `roles.manage`;
- `reports.view`;
- `reports.export`;
- `whatsapp.sell`;
- `ai.assistant`;
- `integrations.webhooks`;
- `integrations.api`.

The exact catalogue must be derived by inventorying current SellerTray capabilities and commands. Do not seed speculative capability names that are not mapped to real or deliberately planned product behavior.

## 4.3 Limit catalogue

Limits are first-class governed definitions, not arbitrary numeric columns embedded in one plan table.

A limit definition must be able to describe:

- stable key;
- merchant-facing label;
- category;
- unit;
- scope, including Branch/Business/user/device where applicable;
- reset period: daily, monthly, billing-cycle, annual, lifetime or concurrent/current-count;
- enforcement mode: hard-block, warn, governed overage or soft-limit;
- whether unlimited is permitted;
- whether add-ons/overrides may increase it;
- usage source/read authority;
- historical/audit behavior.

`Unlimited` must be represented explicitly and not by a magic very-large number.

# 5. Plan entitlement and user permission are separate dimensions

Plan Profiles answer:

> What has this Branch paid to have available?

Merchant role/capability profiles answer:

> What may this user do within the Business/Branch scope?

Effective operational authority is conceptually:

> Branch plan entitlement ∩ user role/capability ∩ Branch/scope authority ∩ business-state rule ∩ available quota/limit

Rules:

1. A plan granting refunds does not give every Cashier refund authority.
2. A Manager role granting a capability cannot make that capability available when the Branch's plan does not include it.
3. Business-state rules such as payment integrity, stock correctness or settlement state remain authoritative even when both plan and role allow the general capability.
4. The server/domain authority performs final enforcement. UI hiding is only presentation.

# 6. Correctness, safety and data integrity are not premium features

SellerTray must never make correctness, security or financial integrity weaker on a lower plan.

The following are not commercial upsells when the underlying workflow exists:

- tenant/merchant isolation;
- Branch scope integrity;
- UOM correctness;
- stock-ledger integrity;
- payment idempotency;
- duplicate prevention;
- payment versus fulfilment truth;
- invoice/receipt correctness;
- receivable integrity;
- return/refund correctness;
- audit of financial/commercial changes;
- offline replay safety;
- secure authentication and permission enforcement.

Plans may package advanced functionality, quotas, analytics or integrations differently, but not weaken the correctness of shared core behavior.

# 7. Initial editable Plan Profile seeds

Commercial V2 should seed three merchant-facing Plan Profiles as editable configuration:

1. **Starter**
2. **Growth**
3. **Scale**

These are defaults only. They are not permanent code constants and may be renamed, repriced, retired, cloned or superseded through governed Admin configuration.

Suggested launch pricing remains editable commercial configuration:

| Plan | Suggested monthly | Suggested yearly |
| --- | ---: | ---: |
| Starter | ₦5,000 | ₦50,000 |
| Growth | ₦12,500 | ₦125,000 |
| Scale | ₦25,000 | ₦250,000 |

The yearly values preserve the currently approved 10-months-for-12-months pricing rule. These suggested prices are not immutable product truth.

## 7.1 Approved legacy `business` -> Starter C2 migration

The following migration decision was explicitly approved on 2026-10-30:

1. The existing legacy subscription identity `business` / **SellerTray Business** is the compatibility source plan to be migrated to the **Starter** Plan Profile during C2.
2. C2 must create/use the governed Starter Plan Profile Version and explicitly map eligible existing `business` subscriptions to that Starter version at **Branch** level.
3. Historical C1/OA5 records keep their original `business` identity and immutable snapshots. Do not rewrite historical commercial orders, price snapshots, entitlement events, installment policies, checkout sessions, payments or subscription history to pretend they were created as `starter`.
4. The migration mapping is semantic, not merely price-based. Before cutover, Starter's initial feature/capability/limit grants must be reconciled against the capabilities actually available under the legacy Business runtime so an existing valid subscriber does not silently lose access because of the migration.
5. New post-cutover subscriptions use the Starter Plan Profile authority rather than creating new runtime dependence on the legacy `business` identity.
6. Where a legacy Business has multiple Branches, migration to Starter still occurs through explicit governed Branch-subscription backfill. Do not create a permanent Business-wide Starter subscription.
7. The currently governed standard Business price pair of **₦5,000 monthly / ₦50,000 yearly** is the intended commercial source for initial Starter pricing, but pricing remains a separate effective-dated authority. C2 must link/publish the Starter price relationship through governed migration rather than mutating historical Business price snapshots in place.
8. The legacy `business` identity remains compatibility-only until Branch subscription migration, entitlement parity, cross-surface read/write parity and controlled C2 acceptance prove it is safe to retire from active runtime authority.

Suggested differentiators may include configurable limits for active staff, active POS devices, products/SKUs, AI actions, WhatsApp governed usage, scheduled reports, automation and API/Webhook access. The exact seeded matrix must be reviewed against the real capability catalogue before migration is committed.

Branch count remains not plan-limited unless a later explicit product decision changes that policy.

# 8. Plan versioning and subscriber treatment

Changing a published plan must not silently rewrite historical subscriber terms.

Plan evolution must support:

- draft new version;
- compare versions;
- publish with effective date;
- retire/replace version;
- explicit existing-subscriber treatment such as grandfather, migrate at renewal or governed explicit migration;
- impact preview before publication.

Impact preview should be capable of identifying merchants/Branches that would exceed a proposed new limit or lose a currently used capability.

Downgrades must preserve historical data. SellerTray must never delete staff, products, invoices, payments, reports or audit history merely because the new plan has a lower active limit.

Example: if a Branch/Business currently has 25 active staff and a new effective entitlement permits 10, the system may require deactivation before another staff account can be activated. It must not delete 15 historical users.

# 9. Commercial price book and charge-type master

Plan definition and price definition are separate authorities.

Commercial V2 must support a governed commercial charge-type/master model rather than a separate hard-coded form for every price class.

Supported governed charge classes should include at minimum:

- Subscription Pricing;
- Branch Setup Pricing;
- Add-on Product Pricing;
- Additional Staff Pricing;
- other explicitly approved commercial items.

When Admin creates a price, selecting the charge type determines the appropriate governed fields.

Examples:

**Subscription Pricing**

> Plan Profile Version -> billing cycle -> currency -> tax profile -> price -> effective date

**Branch Setup Pricing**

> setup item/profile -> currency -> tax profile -> price -> effective date

The price book must remain effective-dated/versioned and historical commercial orders must preserve immutable price/tax snapshots.

# 10. Commercial Tax Master

Admin commercial pricing must not use unrestricted tax-rate free text as the long-term authority.

Commercial V2 must provide a governed **SellerTray Commercial Tax Master** separate from merchant POS/sales tax settings.

A tax profile should support at minimum:

- stable code;
- merchant-facing/admin name;
- jurisdiction;
- rate;
- inclusive/exclusive treatment;
- applicability;
- effective dates;
- active/retired status;
- actor/reason/audit.

Price versions select a governed tax profile and commercial transactions snapshot the tax treatment that applied at purchase time.

# 11. Branch setup pricing is a first-class governed master

Branch setup pricing must have an explicit Admin management experience and historical effective-dated price versions.

Default Branch setup pricing is automatically derived into an eligible Branch commercial order. An authorised Admin may apply a governed adjustment/override without rewriting the standard setup price.

Setup pricing must remain separate from plan definition and separate from setup-readiness/equipment evidence.

# 12. Installment Structure Master

Installment schedules are data-driven commercial policy, not client constants.

The existing approved 70:30 and 60:20:20 structures become seeded governed templates, not hard-coded UI options.

An Installment Structure Master must be capable of representing:

- identity/version;
- status;
- applicable plans/billing cycles/scopes;
- installment count;
- percentage and/or fixed allocation rules;
- deterministic rounding;
- schedule-line sequence;
- due policy when approved;
- qualifying settlement/provisional entitlement rule where applicable;
- full-settlement rule;
- effective dates;
- actor/reason/audit.

The shared server authority derives actual installment amounts. Admin/Merchant clients never author canonical line amounts independently.

# 13. ProcessEdge Commercial Payment Method Master

SellerTray Admin commercial collection must not rely on unrestricted payment-method free text.

Commercial V2 must define a governed **ProcessEdge Commercial Payment Method Master**, separate from merchant POS payment methods.

Examples may include approved ProcessEdge collection channels such as direct bank transfer, cash, card/POS or another explicitly configured method.

The master may govern:

- stable identity;
- merchant-facing/admin label;
- method class;
- receiving account/reference requirements;
- evidence requirements;
- active/retired status;
- effective dates where relevant;
- actor/reason/audit.

Direct/off-gateway payment confirmation continues to preserve immutable payment evidence and must not fabricate provider events.

# 14. Discount and adjustment governance

The Admin discount experience must become a real discount workflow.

At minimum support:

- **Percentage** discount;
- **Fixed value** discount.

A governed discount must preserve:

- commercial order/eligible scope;
- discount type;
- entered percentage/value;
- server-derived monetary adjustment;
- resulting net amount;
- tax treatment/recalculation;
- reason/evidence;
- actor/timestamp;
- immutable history.

The server calculates authoritative arithmetic. The browser may preview but must not become financial truth.

A one-time order discount must not silently change future recurring plan price. Merchant-specific recurring price is a separate governed override.

# 15. Branch-aware commercial orders

A commercial order may include multiple Branch subscription subjects, and each subscription line must bind to its exact Branch and Plan Profile Version.

Example:

- Ikeja -> Growth yearly;
- Lekki -> Starter monthly;
- Yaba -> Scale yearly.

The shared authority derives the applicable subscription price, Branch setup charge, tax and eligible adjustments for each line.

The existing C1 assumption of exactly one Business-level subscription line with no `branch_id` is a compatibility constraint to be replaced in C2, not extended as the target model.

# 16. Merchant self-service subscription lifecycle

Merchant Web is the full self-service subscription management surface for authorised merchant users.

It should support, subject to governed policy:

- view Branch subscription state;
- choose a Branch;
- compare/select eligible Plan Profiles;
- select billing cycle;
- review server-derived setup/subscription/tax pricing;
- create/continue the governed commercial order;
- accept required current agreement versions;
- pay/settle;
- schedule setup where required;
- renew;
- change plan;
- inspect current usage/limits;
- inspect invoices/orders/payment history.

Mobile may show Branch plan/status/expiry/usage attention and provide actions such as **Choose plan**, **Manage subscription** or **Renew** that securely hand off to Merchant Web. Mobile must not duplicate the full commercial administration flow or construct prices locally.

Cashiers do not gain subscription-purchase authority merely because Mobile exposes subscription status.

# 17. Renewal, extension and plan change

These are distinct governed actions.

## Renewal

Renewal continues a Branch subscription for another governed term through a commercial order/settlement/reconciliation path. Do not directly edit `active_until`.

## Extension

An exceptional Admin-granted extension must be an explicit audited entitlement/commercial event with reason, actor and effective term. It must not be a silent expiry-date edit.

## Plan change

Upgrade/downgrade targets one Branch subscription.

Initial Commercial V2 should prefer plan changes at the next governed term boundary unless an explicit proration/refund/credit policy has been approved. Do not invent mid-cycle proration arithmetic.

# 18. Agreement V2: accept by published version, not every order

A merchant must not be required to accept the same unchanged legal agreement for every subscription purchase, renewal, setup order or upgrade.

Legal agreement acceptance is **version-based**.

Rules:

1. Agreement content is managed in Admin through an editable draft/text-editor experience.
2. Publishing creates an immutable agreement version/content hash.
3. Each affected Business/merchant accepts each required published version once through authorised acceptance authority.
4. Re-acceptance is required when a newer required version is published and applies to that merchant, not merely because another commercial order was created.
5. Published/accepted historical versions remain immutable.
6. Editing a published agreement creates a new draft/version; it never edits accepted content in place.
7. Merchant-specific commercial orders retain immutable commercial snapshots without forcing duplicate acceptance of unchanged general legal terms.

Commercial/legal records should distinguish true versioned legal agreements from transactional evidence.

True legal agreement families include, as applicable:

- Terms of Service;
- Privacy & Data Terms;
- Money-Back Guarantee Terms;
- other explicitly approved legal documents.

Transactional evidence includes, as applicable:

- Commercial Order / Commercial Schedule;
- installment schedule snapshot;
- Branch Setup & Equipment Acknowledgement.

Transactional documents remain immutable evidence but are not automatically a fresh legal-agreement acceptance requirement on every purchase.

Initial agreement content may be populated as **Draft** for ProcessEdge review. Do not publish invented legal wording as approved production terms without ProcessEdge approval.

# 19. Admin Commercial UX V2

SellerTray Admin must present as a professional operating portal, not stacked forms on oversized catch-all pages.

The existing `ADMIN_NAVIGATION.md` principle remains controlling:

> One Admin page represents one primary administrative job.

Commercial V2 refines the Admin experience as follows.

## Plans & Pricing / Commercial Configuration

The user-facing navigation may retain **Plans & Pricing**, but the destination should provide coherent tabs/workspaces for:

- Plans;
- Features & Capabilities;
- Limits;
- Pricing;
- Taxes;
- Add-ons;
- Installment Structures;
- Commercial Payment Methods.

The page must not expose one long vertical stack of unrelated configuration forms.

## Payments & Settlement

Use one destination with alternate views of the same commercial settlement work object:

- Overview;
- Payments;
- Discounts;
- Installment Policy;
- History & Reconciliation.

The current technical phrase **Publish scoped override** must not be primary user-facing language. Use merchant/admin language such as **Apply installment policy override** and clearly state whether scope is platform, plan, merchant or commercial order.

## Agreements

Provide:

- Agreement Library;
- editable Draft editor;
- Preview;
- Publish Version;
- version history;
- acceptance coverage/status;
- immutable accepted-version review.

## General Admin page-format contract

Commercial/Admin pages must use shared professional primitives:

- clear PageHeader and context;
- bounded readable content width;
- responsive grid/card hierarchy;
- tabs for alternate views of one work object;
- data tables for collections/history;
- drawers/modals for bounded actions where appropriate;
- consistent spacing/typography;
- meaningful status badges;
- clear primary/secondary actions;
- responsive narrow-screen drawer behavior;
- empty/loading/error states;
- no duplicated Merchant selector when shell merchant context already applies.

# 20. Admin capabilities for Commercial V2

`ADMIN_CAPABILITIES.md` remains the authority model.

Commercial V2 implementation should introduce or map narrowly scoped capabilities as required, for example:

- plan/profile configuration;
- entitlement catalogue configuration;
- price/tax/add-on management;
- installment structure management;
- ProcessEdge commercial payment method management;
- agreement draft/publish authority;
- payment reconciliation;
- discount/adjustment authority;
- Branch setup/readiness authority;
- Branch entitlement reconciliation/recovery.

Exact identifiers must be reconciled with the current capability schema before implementation. Do not add browser-only capability names without server enforcement.

All privileged mutations require verified ProcessEdge identity, AAL2/MFA, applicable scope, reason/evidence where required and immutable audit.

# 21. Shared entitlement resolver

Commercial V2 must provide one server/domain resolver for Branch subscription entitlement.

Conceptually the result should expose:

- Branch subscription identity/status;
- Plan Profile identity/version;
- active feature grants;
- active capability grants;
- quantitative limits;
- current usage where authoritative;
- add-on/override effects;
- effective entitlement period;
- preparation/read-only/active/suspended state;
- reasons/blockers where unavailable.

All channels consume this shared authority:

- Admin Web configures/reviews;
- Merchant Web manages/explains;
- Mobile enforces operational availability;
- WhatsApp uses the same Branch entitlement for selling/channel behavior;
- AI reads the same allowed capability/state;
- reporting groups by the same plan/version/Branch facts;
- offline uses a bounded/versioned entitlement snapshot for allowed degraded behavior and revalidates on replay.

# 22. Add-ons and merchant-specific entitlement overrides

The architecture should support:

> Base Plan Profile + governed add-ons + audited merchant/Branch-specific override

Examples may include additional staff capacity, AI quota, API access or another explicitly approved commercial add-on.

Overrides must preserve:

- subject/scope;
- changed entitlement/limit/price;
- reason;
- authorised actor;
- approval where required;
- effective start/end;
- immutable audit/history.

No hidden permanent table edit is an acceptable override mechanism.

# 23. Compatibility and migration discipline

Commercial V2 is a deliberate migration, not a destructive rewrite.

Migration must preserve:

- existing commercial orders;
- price/tax snapshots;
- confirmed payments;
- installment schedules/history;
- agreement versions/acceptances;
- setup appointments/evidence/readiness;
- entitlement event history;
- legacy active access until ownership is safely mapped;
- audit history.

Do not rewrite historical Business-level records to pretend they were always Branch subscriptions.

The approved compatibility mapping for the current legacy `business` subscription identity is **Starter**, subject to the explicit Branch-level migration and parity rules in section 7.1. This mapping does not authorise in-place rewriting of historical `business` records.

Where one historical subscription covered multiple Branches, migration must use an explicit governed compatibility mapping/backfill policy and retain the original historical source linkage.

C2 must prove the new Branch authority before old trial/Business runtime semantics are retired.

# 24. Cross-surface implementation contract

Commercial V2 is one cross-surface business batch even when delivered in reviewable PR slices.

## Shared Core

Owns Plan Profiles, catalogue, limits, price/tax/installment/payment-method masters, Branch subscription authority, entitlement resolver, agreement versions, orders/settlement and migration.

## Admin Web

Owns platform commercial configuration, professional management UX, agreement editing/publishing, settlement/reconciliation and Branch subscription review/recovery.

## Merchant Web

Owns Branch subscription self-service, plan selection, usage/limit explanation, commercial order/payment, legal acceptance and renewal/change-plan management.

## Mobile

Owns Branch-specific operational status, preparation/active gating, entitlement-aware actions and secure web handoff for full subscription management.

## WhatsApp

Uses the same Branch entitlement. It cannot create an independent subscription, price, agreement acceptance or activation fact.

## AI

May explain current plan, entitlement, usage and next action from governed authority. It cannot invent entitlement or mutate commercial state without an explicitly approved command boundary.

## Reporting/Audit

Must support Branch subscription mix, Plan Profile version, renewal/expiry, plan changes, limits/usage, discounts, settlement, agreement-version acceptance, privileged Admin changes and migration evidence.

## Offline/Sync

May cache bounded entitlement/payment-method/configuration state needed for approved offline operations. Offline cannot author plan/profile/pricing/tax/installment/agreement publication or Branch activation truth. Replay revalidates current server authority and remains idempotent.

# 25. Commercial V2 QA matrix

Before Commercial V2 can be called complete, verify at minimum:

1. one Business can run different Plan Profiles on different Branches;
2. one Branch's blocker does not disable an independently qualified Branch;
3. Plan Profiles can be created/versioned without code deployment;
4. feature/capability/limit changes are data-driven;
5. no client contains plan-name branching for runtime authority;
6. plan entitlement and user role/capability intersect correctly;
7. lower plans preserve correctness/security invariants;
8. limits enforce correct units/reset periods and explicit unlimited semantics;
9. downgrade preserves historical data;
10. plan publication does not rewrite current historical subscriber terms silently;
11. price/tax/setup/add-on masters are effective-dated and snapshotted;
12. percentage and fixed discounts calculate server-side correctly;
13. payment method is selected from governed ProcessEdge commercial method authority;
14. installment templates are configurable and 70:30/60:20:20 are only seeded presets;
15. merchant can initiate eligible Branch subscription purchase/renewal from Merchant Web;
16. Mobile handoff preserves identity/Business/Branch context without calculating price;
17. renewal/extension/change-plan are separate governed actions;
18. unchanged legal agreement version is not repeatedly accepted for every order;
19. a new required agreement version requires new acceptance and preserves old evidence;
20. Branch setup/readiness and activation reconcile idempotently;
21. Merchant Web, Mobile, Admin Web, WhatsApp and AI expose one consistent entitlement state;
22. reporting/audit preserve plan/version/Branch history;
23. offline replay cannot duplicate entitlement/payment/stock effects;
24. legacy Business/trial authority is retired only after controlled migration acceptance;
25. legacy `business` subscribers are mapped to Starter through governed Branch-level migration while historical `business` evidence remains immutable.

# 26. Anti-patterns

Do not:

- hard-code plan names to product behavior;
- maintain separate feature lists in Mobile, Merchant Web, Admin or WhatsApp;
- use one Business-wide plan as long-term truth after C2;
- let one Branch block an independently qualified Branch;
- make Branch count a plan limit without a later explicit decision;
- embed mutable price directly into Plan Profile definition as the only pricing authority;
- keep tax/payment method/installment structure as unrestricted free text;
- edit published plan/agreement history in place;
- delete data to satisfy a lower limit;
- let a role grant a capability that the Branch plan has not purchased;
- let a plan grant a sensitive user action to every role automatically;
- expose Admin commercial mutations without AAL2/capability/scope/audit;
- call a compatibility migration complete merely because new tables exist;
- create a fourth active C2 Plan Profile named Business merely to preserve the legacy `business` code after migration.