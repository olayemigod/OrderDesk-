---
name: sellertray-commercial-governance
description: "Normative commercial extension for SellerTray subscriptions, setup, billing, installments, agreements, guarantees, promotions, referrals, Admin Web commercial operations, Merchant Web billing and product editions."
metadata:
  author: ProcessEdge Solutions Limited
  product: SellerTray
  version: "0.1.0"
  status: governing-extension
---

# SellerTray Commercial Governance

## Status and precedence

This file is a **normative extension** of `.agents/skills/sellertray-project-implementation/SKILL.md`.

Read and follow it for any SellerTray work involving:

- onboarding or first purchase;
- subscriptions, renewals or entitlements;
- setup fees or Branch activation;
- Merchant Web billing;
- Admin Web commercial operations;
- installment plans or payment schedules;
- agreements, terms, acceptance evidence or commercial documents;
- money-back guarantees, refunds or supplied equipment;
- plans, prices, VAT/tax presentation or price overrides;
- promotions or merchant-specific commercial terms;
- referral/reward programmes;
- SellerTray editions such as SellerTray Mobile and SellerTray POS.

A later explicit user decision overrides this extension. When commercial policy changes materially, update this file in the same workstream.

Do not create separate commercial truth in Mobile, Merchant Web, Admin Web, WhatsApp or AI. All surfaces must use the same governed commercial, payment, entitlement, agreement and audit core.

# 1. Commercial product model

SellerTray has **no free trial**.

Getting started requires merchant setup, so activation follows the approved commercial onboarding and setup process rather than a trial period.

Every new merchant receives a **one-month money-back guarantee measured from the merchant activation date**, subject to the approved guarantee terms and the condition of supplied equipment.

Do not expose or introduce merchant-facing flows such as:

- Start Trial;
- Extend Trial;
- Trial expires;
- Convert Trial.

Existing implementation that still uses trial-oriented fields or commands is legacy compatibility and must be migrated deliberately rather than extended as the long-term commercial model.

Commercial lifecycle language should converge on concepts such as:

- pending setup;
- pending activation;
- guarantee in progress;
- active;
- installment due;
- past due;
- suspended;
- cancelled;
- refunded;
- expired.

# 2. First purchase and Branch setup

A merchant's first SellerTray purchase combines:

1. the selected SellerTray subscription; and
2. setup for every Branch being activated in that purchase.

Subscription and applicable setup charges are paid as one governed commercial purchase even though they remain distinct line items for audit, tax, refund and reporting purposes.

Every Branch requires setup. Branch count is therefore **not a subscription-plan limitation**.

Do not implement plan logic that restricts merchants primarily by number of Branches unless a later explicit product decision changes this rule.

Each Branch setup includes one Bluetooth receipt printer at no separately advertised charge to the merchant. The supplied device must still be recorded for provisioning, handover, guarantee and return-condition purposes.

A Branch may exist in preparation before selling activation, but it must not silently become operational merely because a Branch record was created. Commercial/setup readiness and operational activation must remain governed states.

# 3. Subscription cycles and annual saving

SellerTray supports:

- monthly subscription; and
- yearly subscription.

The yearly subscription provides **12 months of service for the price of 10 monthly subscription periods**, equivalent to two months of subscription savings.

Do not implement yearly billing as an arbitrary percentage discount if that would make it diverge from the approved 10-for-12 commercial rule.

Prices are configurable commercial data, not hard-coded application constants.

Suggested launch plan names, feature packaging and price points remain proposals until explicitly approved. Agents may not silently convert suggested pricing into immutable product truth.

# 4. SellerTray editions

SellerTray editions and subscription plans are separate concepts.

Approved editions/directions are:

1. **SellerTray Mobile** — the current mobile operational application.
2. **SellerTray POS** — a planned POS-screen-optimised edition/surface.

SellerTray POS must not become a separate commerce engine. It must use the same governed merchant, Branch, staff, product, UOM, pricing, stock ledger, customer, order, payment, shift, receipt, permission and reporting core as SellerTray Mobile and Merchant Web.

Pricing or entitlement treatment for SellerTray POS is **not yet frozen**. Do not assume it is included, excluded, an add-on or a separate paid edition until explicitly approved.

The commercial foundation should be capable of representing edition/capability entitlements without forcing an early pricing decision.

# 5. Installment plans

Installments apply to the initial annual SellerTray commercial purchase unless a later explicit decision broadens eligibility.

Monthly subscriptions must not automatically inherit the annual installment model.

Approved installment structures are:

## Two installments — 70:30

- First installment: **70%** of the governed first-purchase total.
- Second installment: **30%**.
- After the qualifying first installment and required agreement/setup conditions are satisfied, the merchant receives **2 months of provisional subscription entitlement**.
- After full settlement, the remaining **10 months** are released.

The final entitlement is one 12-month term measured from the original activation date. Do not grant 10 additional months from the later payment date if that would extend the contract beyond the approved 12-month term.

## Three installments — 60:20:20

- First installment: **60%**.
- Second installment: **20%**.
- Third installment: **20%**.
- After the qualifying first installment and required agreement/setup conditions are satisfied, the merchant receives **3 months of provisional subscription entitlement**.
- After full settlement, the remaining **9 months** are released.

The final entitlement is one 12-month term measured from the original activation date.

## Installment invariants

1. Installment schedules must be governed server-side.
2. Agreement acceptance, payment receipt and entitlement are distinct facts.
3. A signed agreement does not prove payment.
4. A payment record does not prove agreement acceptance.
5. Entitlement changes occur only through governed, idempotent commercial commands after required contractual and payment conditions are satisfied.
6. Retry must never duplicate installment payment effects or subscription extensions.
7. Do not let client code derive remaining subscription months independently.
8. Do not let administrators directly edit an expiry date as a substitute for a governed entitlement event.
9. If required installments are not completed before provisional entitlement ends, the merchant must move through the governed past-due/suspension policy without deleting commercial history or merchant data.
10. Billing and recovery access must remain available as required so an authorised merchant can see obligations, pay and recover service.

Exact installment due dates, grace duration and late-payment policy must be explicitly approved before production enforcement. Do not invent them from the 70:30 or 60:20:20 ratios.

# 6. Money-back guarantee

There is no trial. The approved customer assurance is a **one-month money-back guarantee from activation date**.

The system must persist at minimum:

- activation timestamp/date;
- guarantee start;
- guarantee end;
- guarantee status;
- refund request state where applicable;
- supplied equipment relevant to the guarantee;
- equipment return and inspection state;
- decision, actor, reason and timestamps;
- refund transaction/reference when completed.

Admin Web must be able to monitor merchants currently inside the guarantee window and guarantee-related attention states.

Guarantee status must be date-driven from the authoritative activation date, not registration date, quotation date, payment-intent creation time or arbitrary browser calculation.

The Bluetooth printer/equipment condition requirement must be enforceable and auditable. Record supplied equipment identity where available, Branch, handover date, handover condition, return status, return condition and inspection notes.

The exact legal refund scope, damage/missing-equipment deduction wording, equipment-title treatment and any processing-cost treatment require final approved commercial/legal wording before public launch. The implementation must support those policies without rewriting historical agreements.

# 7. Plans, pricing, VAT and commercial audit

All SellerTray prices are adjustable commercial data.

User-facing prices are VAT inclusive, while the commercial record must remain auditable and capable of preserving the underlying tax treatment.

Every effective price should be versioned/effective-dated rather than destructively overwritten.

Commercial pricing records should preserve at minimum:

- plan/product or setup item;
- billing cycle where applicable;
- VAT-inclusive gross price;
- applicable tax configuration/rate snapshot or derivable audited tax breakdown;
- effective-from date/time;
- effective-until date/time where applicable;
- status;
- actor;
- reason/change note;
- created/approved timestamps.

A completed commercial order, invoice or accepted agreement must snapshot the prices and tax treatment that applied at that time. Later price or tax changes must not rewrite historical purchases.

Merchant-specific negotiated pricing must be represented as an auditable commercial override with effective dates and reason. Do not overwrite the standard plan price merely to give one merchant a different deal.

# 8. Promotions

SellerTray may run promotions:

- during a defined date/time period;
- for all merchants or eligible new merchants;
- for selected plans or billing cycles;
- for setup and/or subscription where explicitly configured;
- for a defined merchant segment/group;
- for selected merchants.

Every promotion must be governed, effective-dated, auditable and snapshotted when applied to a commercial transaction.

For MVP, do not create uncontrolled promotion stacking. Unless later explicitly approved, a transaction should use one governed applicable promotion or an explicitly selected authorised commercial override rather than combining discounts arbitrarily.

Admin Web owns promotion definition/management. Merchant Web consumes only the promotion outcome/eligibility the governed commercial core allows.

# 9. Agreements and terms

Commercial agreements are first-class records, not generated PDFs detached from business truth.

Approved document families are:

1. **SellerTray Terms of Service** — general service terms.
2. **Subscription Order / Commercial Schedule** — merchant-specific plan, setup, price and commercial snapshot.
3. **Installment Agreement** — mandatory for installment purchases before provisional entitlement can activate.
4. **Money-Back Guarantee Terms** — guarantee conditions, available separately and incorporated into the applicable commercial order/agreement.
5. **Branch Setup & Equipment Acknowledgement** — setup completion and supplied-device handover per Branch.
6. **Privacy & Data Terms** — applicable merchant data/privacy terms.

Referral Programme terms are post-MVP and must be introduced separately when the referral programme is implemented.

## Agreement generation

Merchant-specific agreements must snapshot the commercial facts relevant at generation/acceptance, including as applicable:

- provider legal identity;
- merchant/business identity;
- authorised representative;
- SellerTray plan and billing cycle;
- applicable SellerTray edition/entitlement where relevant;
- Branches included in the setup purchase;
- subscription price;
- Branch setup lines;
- VAT/tax presentation;
- promotions/discounts or negotiated price overrides;
- total governed contract amount;
- installment structure and schedule where applicable;
- provisional entitlement;
- full-term entitlement;
- activation/term dates when established;
- guarantee dates/terms;
- supplied-equipment conditions where applicable.

## Acceptance

No SellerTray installment subscription may activate without an immutable merchant-specific commercial agreement accepted by an authorised merchant representative and the qualifying first payment being confirmed.

Acceptance should capture sufficient evidence, including at minimum:

- agreement ID;
- agreement version/template version;
- immutable document/content hash or equivalent integrity evidence;
- merchant/business ID;
- accepting user ID;
- accepted legal/display name;
- accepted role/authority;
- acceptance timestamp;
- acceptance verification method;
- request/device evidence reasonably available for audit.

Owner acceptance is always valid where account authority is valid. Manager acceptance requires an explicit governed commercial/billing capability; do not infer contract-signing authority merely from ordinary management access.

Cashiers must not accept SellerTray commercial contracts.

## Immutability and amendments

An accepted agreement is immutable.

Do not edit accepted document content, prices, dates, Branch scope or payment schedule in place.

Corrections require an audited amendment, replacement agreement or other explicit governed legal/commercial process that preserves the original accepted record.

Terms/templates are versioned. Publishing a new version must not rewrite past acceptances.

Material future terms changes may require re-acceptance according to the approved policy; do not silently treat an old acceptance as acceptance of materially different terms.

# 10. Equipment acknowledgement

Each Branch setup should be able to record:

- Branch;
- setup completion;
- included Bluetooth printer/device;
- serial/identifier where available;
- handover condition;
- merchant representative receiving it;
- handover timestamp;
- acknowledgement evidence.

This acknowledgement supports setup completion, guarantee administration and later dispute resolution. It does not create a second inventory or accounting model for merchant stock.

# 11. Merchant Web billing responsibility

Merchant Web owns the merchant-facing management experience for SellerTray subscription billing.

Provide a governed **Billing & Subscription** area that can show, as supported:

- current plan;
- monthly/yearly billing cycle;
- current entitlement/active-until date;
- annual saving;
- current governed commercial price snapshot;
- Branch setup state and setup payment state;
- installment schedule, paid amount, balance and due state;
- guarantee status and remaining window;
- invoices/commercial orders;
- payment receipts/history;
- refunds;
- accepted agreements and commercial documents;
- renewal/change-plan actions where policy permits.

Merchant Web must not calculate subscription entitlement locally. It consumes governed commercial reads and commands.

Only authorised Owner/Manager users may perform SellerTray subscription/billing actions. Server-side permission enforcement is mandatory.

# 12. Mobile billing responsibility

SellerTray Mobile does not duplicate the full billing center.

For authorised Owner/Manager users, Mobile may show subscription state and attention items and may **trigger** the governed subscription/billing flow.

The detailed subscription purchase, installment review, agreement acceptance and billing-management workflow remains web-first unless a later explicit decision changes the surface boundary.

Mobile billing actions must use the same governed commercial commands/URLs/intents as Merchant Web and must not construct prices, discounts or entitlement locally.

Cashiers do not initiate SellerTray subscription changes.

# 13. Admin Web commercial responsibility

Admin Web is the ProcessEdge cross-tenant platform operations surface.

It supervises merchant lifecycle, SellerTray commercial configuration, support, platform communications, service health and privileged platform operations. It must not become an unrestricted superuser copy of Merchant Web or a shortcut for directly mutating merchant commercial truth.

Approved primary Admin direction:

- **Overview** — ProcessEdge business performance, governed commercial/adoption KPIs and actionable merchant attention; see the approved Business Dashboard contract in `SKILL.md`;
- **Merchants** — merchant directory and individual merchant platform/commercial workspace;
- **Billing & Commercial** — plans/pricing, subscriptions, installments, payments, promotions, guarantees and agreements;
- **Communications** — merchant notifications/campaigns;
- **Platform Operations** — governed service/AI/WhatsApp health and controlled diagnostics;
- **Audit** — privileged administrator activity;
- **Settings** — true platform-level configuration only.

Within **Billing & Commercial**, expected subareas include:

- Plans & Pricing;
- Subscriptions;
- Installments;
- Payments;
- Promotions;
- Guarantees;
- Agreements.

Within a merchant detail workspace, expected commercial areas include:

- Summary;
- Subscription & Billing;
- Branch Setup;
- Guarantee;
- WhatsApp;
- Support;
- Activity/Audit.

Admin actions affecting merchant entitlement, pricing, refund, guarantee outcome, installment state or commercial agreement must be capability-controlled, reasoned where appropriate and immutably audited.

Do not expose service-role credentials or unrestricted database mutation to Admin Web browser code.

# 14. Referral rewards — post-MVP

Merchant referral rewards are explicitly **post-MVP**.

Approved reward direction:

- an existing merchant refers a new merchant;
- the referred merchant registers/purchases/activates;
- the referred merchant must remain activated beyond the one-month money-back guarantee period and must not have been refunded/cancelled under that guarantee;
- only after that qualifying period does the referring merchant earn **one month of subscription extension**.

The reward must be an immutable, idempotent entitlement event rather than a direct expiry-date edit.

The same referred merchant must not qualify the same referral reward more than once.

Referral identity, attribution window, fraud controls, maximum rewards and detailed programme terms remain to be designed before post-MVP implementation.

# 15. Shared commercial core invariants

The commercial core should evolve the existing subscription authority rather than create a competing subscription system.

Conceptually, the shared authority needs governed representations for:

- plans and plan prices;
- edition/capability entitlements;
- merchant subscription/contract state;
- commercial orders and line snapshots;
- Branch setup obligations;
- invoices/receipts where required;
- installment schedules and schedule lines;
- payments and refunds;
- entitlement events;
- promotions;
- merchant-specific price overrides;
- agreement templates/versions;
- merchant agreements and acceptances;
- amendments/replacements;
- guarantee cases;
- supplied equipment/acknowledgements;
- commercial audit.

These names are conceptual. Inspect existing schema before choosing actual tables, RPCs or migration names.

Critical invariants:

1. Merchant isolation is mandatory.
2. Commercial price history is immutable/effective-dated.
3. Accepted agreements are immutable.
4. Payment and entitlement updates are idempotent.
5. Entitlement is derived only through governed commands/events, never browser arithmetic.
6. Installment status does not rewrite payment history.
7. Refunds do not delete original purchases/payments.
8. Guarantee outcomes preserve decision/audit history.
9. Promotion application is snapshotted on the transaction.
10. Admin overrides require reason and audit.
11. Mobile, Merchant Web and Admin Web read the same commercial truth.
12. No trial-oriented UI or authority may be added as a new long-term path.

# 16. Commercial implementation sequence

Use this sequence unless a later explicit decision changes it:

## G0 — Commercial governance

Freeze the approved no-trial, guarantee, setup, subscription, installment, agreement, pricing, promotion, Admin, Merchant Web, Mobile trigger, referral and edition rules in governing documentation.

## A1 — Admin Professional Foundation

Build the professional Admin AppShell, navigation, routing, identity, responsive behaviour and shared Admin UI primitives. Route existing communications/subscription capabilities through one Admin portal without creating a second admin site.

## C1 — Commercial Core Foundation

Inspect and evolve existing subscription schema into governed plans, effective prices, commercial orders, setup obligations, subscription contracts and entitlement events. Preserve compatibility deliberately; do not bolt a second billing model beside existing truth.

## C1A — Terms, Agreement & Acceptance Foundation

Versioned terms/templates, merchant-specific agreement snapshots, acceptance evidence, immutable accepted agreements and amendment/replacement path.

## C1B — Installment & Payment-Schedule Foundation

Implement 70:30 and 60:20:20 schedules, qualifying first-payment checks, provisional entitlement, full-settlement entitlement release, due/past-due state and retry safety.

## C2 — Retire Trial Semantics

Migrate legacy trial-oriented fields/actions/read models to activation, guarantee, entitlement and commercial lifecycle semantics. Remove merchant-facing trial actions only after data/API compatibility is safely handled.

## A2 — Admin Overview + Merchant Directory

Cross-tenant operational/commercial visibility using governed paginated/filterable reads.

## A3 — Admin Plans, Pricing, Promotions & Agreements

Manage effective pricing, VAT-inclusive commercial presentation, governed promotions, agreement templates/versions and acceptance visibility.

## A4 — Admin Merchant Commercial Workspace

Subscription/billing, Branch setup, installments, payments, entitlement, support and audited privileged actions.

## A5 — Guarantee Operations

Guarantee-window monitoring, claims, equipment return/inspection, refund decision and refund tracking.

## W1 — Merchant Web Billing Center

Merchant subscription status, Branch setup, installment schedule, billing history, agreements/documents, renewal/change-plan flow and guarantee visibility.

## M1 — Mobile Billing Trigger

Owner/Manager subscription state/attention and governed handoff to web billing.

## A6 — Communications Professionalisation

Evolve existing merchant messaging into the Admin Communications module without creating separate business truth.

## A7 — Platform Operations

Governed AI/WhatsApp/service-health operations and diagnostics.

## A8 — Audit, Security & Production QA

Privileged-action audit, permission tests, responsive Admin QA, commercial security checks and deployment validation.

## P0 — SellerTray POS Planning

Plan the POS-screen-optimised edition while preserving shared commerce authority.

## R1 — Referral Rewards (post-MVP)

Implement qualifying referral attribution and +1 month entitlement only after the referred merchant passes the one-month guarantee period without refund/cancellation.

# 17. Commercial QA gate

Any slice touching this extension must verify the relevant subset of:

- merchant isolation;
- Owner/Manager/Cashier authority boundaries;
- effective price selection and historical price preservation;
- VAT-inclusive display and audited tax snapshot;
- promotion eligibility and non-destructive history;
- merchant-specific override audit;
- first-purchase setup + subscription line integrity;
- per-Branch setup status;
- agreement version/snapshot integrity;
- acceptance authority and immutable evidence;
- rejection of activation when mandatory installment agreement/first payment is missing;
- 70:30 provisional 2-month entitlement;
- 60:20:20 provisional 3-month entitlement;
- remaining 10/9 months released only after full settlement;
- idempotent repeated payment/entitlement command;
- no direct expiry-date bypass;
- guarantee date based on activation;
- supplied-equipment acknowledgement/return state;
- refund history preservation;
- Merchant Web and Mobile reading the same billing truth;
- Admin privileged mutation audit;
- legacy trial behavior not accidentally reintroduced;
- reporting totals matching authoritative commercial records.

# 18. Legal/commercial wording boundary

Engineering governance defines the product behaviour and evidence requirements, but final public legal wording must be approved before launch.

Particularly review before public use:

- installment/default clauses;
- electronic acceptance wording;
- money-back refund scope;
- equipment condition/return/title clauses;
- VAT/tax disclosure language;
- privacy/data terms;
- limitation/liability/service terms;
- referral programme terms when implemented.

Do not encode uncertain legal wording into irreversible schema assumptions. Store versioned agreements and policy snapshots so approved wording can evolve without rewriting history.
