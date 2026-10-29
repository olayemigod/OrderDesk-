---
name: sellertray-onboarding-activation
description: "Normative SellerTray onboarding, first-purchase, setup scheduling, manual commercial intervention and activation lifecycle across Mobile, Merchant Web and Admin Web."
metadata:
  author: ProcessEdge Solutions Limited
  product: SellerTray
  version: "0.1.0"
  status: governing-extension
---

# SellerTray Onboarding & Activation Governance

## Status and precedence

This file is a **normative extension** of `.agents/skills/sellertray-project-implementation/SKILL.md`, `COMMERCIAL.md`, `COMMERCIAL_C1.md`, `CROSS_SURFACE.md` and `ADMIN_CAPABILITIES.md`.

Read and follow it for any task involving:

- merchant registration or first Business creation;
- first SellerTray commercial purchase;
- app-to-web onboarding handoff;
- setup-slot availability or appointment scheduling;
- ProcessEdge setup teams, service areas, equipment handover or Branch readiness;
- first activation;
- direct/off-gateway SellerTray subscription payments;
- Admin approval of direct payments;
- merchant-specific first-purchase discounts or commercial adjustments;
- gateway payment after an Admin discount or direct payment;
- onboarding/activation status, reporting, reminders or recovery.

This file records later explicit product decisions and therefore controls where older commercial-sequence wording conflicts.

In particular, the earlier C1B wording that requires the qualifying payment to be **provider-confirmed** is broadened by this later decision: a qualifying payment may be confirmed either by the existing verified gateway/provider path or by the governed ProcessEdge Admin direct-payment confirmation path defined here. A direct payment must never be represented as a synthetic gateway event.

The governing architecture remains:

> Mobile performs. Web manages. WhatsApp sells. AI assists. All surfaces use one shared commercial, payment, setup, appointment, entitlement and audit truth.

# 1. Product outcome

SellerTray onboarding must be one continuous, unambiguous lifecycle from registration to operational activation.

A merchant must always be able to answer:

1. **Where am I now?**
2. **What is blocking activation?**
3. **What exactly do I need to do next?**

Do not implement separate registration, billing, appointment and activation processes that require the merchant to re-enter the same Business facts or guess the next step.

The governed lifecycle is conceptually:

> Account -> Business/Branches -> Commercial order -> Agreement where required -> Payment/settlement -> Setup appointment(s) -> Setup completion/readiness -> Entitlement reconciliation -> Active

The actual persisted states may be more granular, but every surface must derive them from shared authority rather than inventing client-local onboarding state.

# 2. Registration and Business preparation

SellerTray Mobile is the primary entry surface for registration and initial Business preparation.

The merchant may:

- create/sign in to the SellerTray account;
- complete required user-level legal acceptance/verification;
- create the Business profile;
- create the Branch or Branches intended for first activation;
- provide setup location/contact facts required for scheduling;
- prepare other explicitly safe onboarding data before activation.

Creating a Business or Branch does **not** activate selling entitlement.

The initial setup/activation workspace must make the remaining lifecycle visible rather than sending an unactivated merchant into unrestricted live POS merely because a Business record exists.

# 3. Secure Mobile -> Merchant Web handoff

Detailed first-purchase billing remains web-first.

Mobile may present a prominent merchant-facing action such as **Continue setup** or **Choose plan & pay** that opens Merchant Web through a governed, short-lived, Business-bound handoff.

Requirements:

1. Do not ask the merchant to register a second account.
2. Do not ask the merchant to re-enter Business/Branch facts already held by shared authority.
3. Do not put plan prices, discounts, tax arithmetic, installment amounts or entitlement calculations in Mobile link-building code.
4. The web handoff must resolve the authenticated user and intended Business server-side and fail closed if the user lacks authority.
5. Cashiers must not gain subscription-purchase authority through the handoff.

# 4. Commercial order and first purchase

Merchant Web owns the merchant-facing first-purchase workflow.

It must consume governed commercial authority for:

- selected SellerTray plan;
- monthly/yearly cycle;
- yearly 10-for-12 rule;
- subscription line(s);
- Branch setup line(s);
- VAT/tax presentation;
- authorised promotion or merchant-specific adjustment;
- installment structure where eligible;
- agreement requirements;
- amount already confirmed paid;
- current outstanding amount.

Clients must not calculate the authoritative payable amount independently.

The commercial order must preserve gross/list-price facts and adjustment/payment facts separately so ProcessEdge can always distinguish what was priced, what was discounted, what was paid and what remains due.

# 5. Authoritative commercial arithmetic

For a governed commercial order, preserve at minimum the following concepts:

- `gross_amount` — immutable/list-price commercial value before merchant-specific adjustment;
- `adjustment_total` — approved discounts/credits applied to this order;
- `net_amount_due` — gross amount less valid adjustments, never below zero;
- `confirmed_payment_total` — sum of confirmed gateway and confirmed direct/manual payment allocations applied to the order;
- `outstanding_amount` — net amount due less confirmed payment total, subject to explicit overpayment handling.

The payment prerequisite is satisfied when the governed order/schedule requires no further confirmed payment under the applicable commercial structure.

Do not create a fake payment merely because a 100% authorised discount reduces the current order amount to zero.

Do not silently convert overpayment into merchant credit, refund, wallet value or future subscription extension. If a proposed adjustment would reduce `net_amount_due` below already confirmed payments, fail closed until an explicit governed refund/credit policy resolves the excess.

# 6. Admin commercial intervention during onboarding

SellerTray Admin Web may intervene in the first-purchase/payment stage without bypassing the shared commercial authority.

Approved intervention classes are:

1. **Apply merchant-specific order adjustment/discount**.
2. **Record and confirm a direct/off-gateway payment** received by ProcessEdge, such as a merchant paying directly into an approved ProcessEdge bank account.

These actions change the governed commercial order/payment ledger. They do **not** directly activate a subscription, edit an entitlement expiry date or mark setup complete.

## 6.1 Merchant-specific onboarding discount

An authorised ProcessEdge user may apply a discount/adjustment to the merchant's current onboarding commercial order.

The adjustment must preserve:

- original gross/list-price amount;
- adjustment type, such as fixed amount or percentage where supported;
- adjustment value;
- affected order/eligible line scope;
- resulting net amount;
- tax/VAT treatment recalculated by shared authority where applicable;
- ProcessEdge actor;
- reason;
- timestamp;
- immutable audit/history.

The default onboarding discount is **one-time for the current commercial order**. It must not silently change the merchant's future recurring plan price.

A lasting negotiated recurring price is a separate governed merchant-specific price override under `COMMERCIAL.md` and must be explicitly identified as such.

Do not stack arbitrary discounts/promotions. Existing promotion/override rules continue to apply.

If an adjustment changes an amount already snapshotted into an accepted commercial agreement, do not edit the accepted agreement. Issue the governed amendment/replacement required by `COMMERCIAL.md`/`COMMERCIAL_C1.md` before downstream activation can rely on the changed commercial terms.

For eligible installment purchases, any discount applied before agreement/payment qualification must cause installment obligations to be derived again server-side from the authoritative adjusted commercial amount while preserving the approved 70:30 or 60:20:20 structure. Clients must not manually edit installment line amounts.

## 6.2 Direct/off-gateway payment

A merchant may pay ProcessEdge directly outside the gateway, for example by bank transfer to an approved ProcessEdge account.

An authorised Admin may record/confirm that payment only through a governed Admin commercial command.

The direct-payment fact must preserve at minimum:

- Business/merchant identity;
- commercial order and, where applicable, installment/schedule-line allocation;
- amount and currency;
- method/source, such as direct bank transfer;
- merchant-supplied/reference value where available;
- ProcessEdge receiving account/bank identity where governed;
- effective/payment date-time;
- verification/confirmation status;
- confirming ProcessEdge actor;
- reason/notes appropriate to the action;
- evidence metadata/attachment where supported or required by policy;
- idempotent command identity;
- immutable audit/history.

A direct payment is its own confirmed-payment authority after authorised ProcessEdge verification. It must **not**:

- fabricate a Paystack/provider reference;
- generate a fake provider webhook;
- mutate a provider checkout as though it succeeded;
- directly mutate entitlement;
- bypass agreement or setup prerequisites.

A mistaken manual confirmation must be corrected by an explicit compensating/reversal process that preserves the original record; do not destructively delete or rewrite confirmed financial history.

# 7. Gateway payment after Admin intervention

Admin intervention and gateway collection are intentionally composable.

Supported examples include:

- ₦100,000 gross order -> ₦20,000 Admin discount -> merchant pays ₦80,000 through gateway;
- ₦100,000 gross order -> ₦40,000 direct payment confirmed by Admin -> merchant pays remaining ₦60,000 through gateway;
- ₦100,000 gross order -> ₦10,000 discount + ₦30,000 direct payment -> merchant pays remaining ₦60,000 through gateway;
- authorised 100% onboarding discount -> zero current payment due, without a synthetic payment event.

Every new gateway checkout must initialise for the **current authoritative payable installment/outstanding amount**, not a stale browser total.

If a discount or confirmed direct payment changes the payable balance after a checkout session has been prepared, the stale checkout attempt must be invalidated, retired, superseded or otherwise prevented server-side from over-collecting. A later payment attempt must use a fresh governed amount/reference according to the existing checkout idempotency contract.

A verified gateway payment and a confirmed direct payment are different evidence sources but feed the same governed commercial settlement/reconciliation logic.

# 8. Payment authority and activation reconciliation

The later approved activation rule is:

> Commercial order + required agreement + required Branch setup readiness + qualifying confirmed settlement -> governed entitlement reconciliation.

`qualifying confirmed settlement` may come from:

- verified gateway/provider payment facts; and/or
- authorised confirmed direct/off-gateway payment facts; and/or
- an approved commercial adjustment that legitimately reduces the payable amount, including to zero.

This broadens older provider-only payment wording without weakening separation of authorities.

Payment confirmation, agreement acceptance, setup readiness and entitlement remain separate facts that may arrive in any order. Reconciliation is retry-idempotent and must be the only path that releases the corresponding governed entitlement/runtime effect.

Admin Web must not expose a generic shortcut whose business effect is “mark subscription active” merely because payment was manually recorded.

# 9. Setup scheduling authority

After the commercial state allows setup booking, the merchant must choose from **real governed available slots** rather than typing an arbitrary preferred date/time that ProcessEdge has not committed to.

Availability may consider:

- service area/location coverage;
- setup team/resource capacity;
- working hours;
- blocked/blackout periods;
- existing confirmed appointments;
- appointment duration or setup scope;
- applicable operational constraints.

The exact slot duration, temporary-hold period, reschedule cutoff and no-show policy are operational configuration/policy. Do not hard-code unapproved values into clients.

Conceptually the scheduling authority is:

> Branch setup obligation -> available capacity -> appointment -> completion evidence -> Branch setup readiness

The scheduler must not own a second activation flag.

# 10. Appointment booking and rescheduling

A confirmed setup appointment must be linked to the exact Business, Branch and Branch-setup obligation and preserve an immutable/auditable history of material changes.

Capture as applicable:

- Business;
- Branch;
- setup obligation/order line;
- appointment date/time and timezone;
- setup-address snapshot;
- merchant contact snapshot;
- assigned/setup team or resource when assigned;
- required setup/equipment scope;
- booking status;
- booking reference;
- created/rescheduled/cancelled actor and reason;
- timestamps.

Slot claiming must be atomic or otherwise concurrency-safe so the same finite capacity cannot be double-booked.

Merchant Web owns detailed merchant booking/rescheduling. Mobile may show the current appointment and trigger the governed web flow where appropriate. Admin Web may book/reschedule/reassign for operational support subject to the same capacity and audit rules.

# 11. Admin Web setup operations

Admin Web should provide a governed **Setup & Activation** operations area covering, as implemented:

- service areas;
- setup capacity/availability;
- setup teams/resources;
- blocked periods;
- upcoming appointments;
- assignment/reassignment;
- merchant-requested/Admin reschedules;
- cancellations/no-shows;
- setup/equipment checklist;
- Branch readiness;
- activation blockers/exceptions.

Completing an appointment does not itself invent Branch readiness. The required setup/equipment checklist/evidence must satisfy the shared setup-readiness command for the exact Branch-setup purchase line.

# 12. Setup completion and equipment

Each Branch setup completion should preserve the evidence governed by `COMMERCIAL.md`, including where applicable:

- setup completion;
- supplied Bluetooth printer/device identity;
- serial/identifier where available;
- setup/pairing/test result;
- handover condition;
- merchant representative receiving it;
- acknowledgement evidence;
- completion timestamp;
- ProcessEdge actor/team.

The appointment engine must reuse this Branch-readiness/equipment authority rather than create another setup truth.

# 13. Multi-Branch first activation

Under the currently approved first-purchase rule, all governed Branch-setup obligations included in the initial purchase must be setup-ready before first commercial activation/reconciliation proceeds.

Merchant-facing status should identify the blocking Branch explicitly rather than only showing generic `pending activation`.

Example:

- Ikeja — setup complete;
- Yaba — setup complete;
- Lekki — scheduled;
- Activation — waiting for Lekki setup.

Independent Branch-by-Branch initial activation would be a later commercial-policy change and must not be inferred by the scheduler.

# 14. Preparation mode before activation

An unactivated merchant may use an explicitly bounded **Preparation/Setup mode**.

Safe preparation may include, subject to existing permissions:

- Business/Branch profile completion;
- catalogue/product preparation;
- setup/payment status visibility;
- appointment visibility;
- help/support/onboarding guidance.

Live POS selling, cashier shifts, operational payment collection and live commerce capabilities that require active entitlement must remain server-gated until activation.

Hiding a Mobile tab is not sufficient authority.

# 15. Merchant-facing status language

Merchant-facing status must remain plain and action-oriented.

Examples:

- Complete your Business profile;
- Choose your plan & pay;
- Discount applied;
- Payment received;
- Balance due: ...;
- Choose your setup time;
- Setup scheduled for ...;
- Setup complete — activating SellerTray;
- SellerTray is ready.

Do not expose internal labels such as C1/C1B/C2, reconciliation jobs, entitlement event identifiers, provider-event fingerprints or capability codes as primary merchant language.

# 16. Admin authorization and audit

This extension does not create browser-only Admin power.

Use `ADMIN_CAPABILITIES.md` as the authority boundary.

For the current capability model:

- recording/confirming a direct payment or correcting its reconciliation requires the governed payment-reconciliation authority (currently represented by `admin.payments.reconcile` or its later narrower replacement);
- merchant-specific onboarding price/discount intervention requires the governed commercial/pricing mutation authority (currently represented by `admin.pricing.manage` for authorised commercial price overrides unless a later narrower capability is introduced);
- setup capacity/readiness mutations require the governed Branch-setup authority (currently represented by `admin.branch_setup.manage` or its later narrower replacement).

Every privileged action requires verified ProcessEdge identity, required MFA/AAL2, server-side capability enforcement, applicable merchant scope, required reason/evidence and immutable Admin audit.

Platform Support remains read/review-first and does not inherit these mutations merely because Support can view the merchant.

# 17. Agreements and changed commercial terms

Accepted commercial agreements remain immutable.

If a discount, Branch-scope change, installment recalculation or other Admin intervention materially changes facts already captured by an accepted agreement, the existing agreement stays historical evidence and the shared commercial authority must issue the appropriate replacement/amendment for re-acceptance where required.

Do not let an Admin discount silently make an already accepted legal document false.

# 18. Guarantee start

The approved one-month money-back guarantee starts from the authoritative **activation timestamp**, not:

- registration;
- Business creation;
- payment;
- direct-payment confirmation;
- appointment booking;
- setup visit start.

Admin intervention at payment stage must not shift this rule.

# 19. Cross-surface ownership

## Shared Core

Owns one onboarding/commercial/payment/setup/appointment/activation authority, including settlement arithmetic, booking concurrency, setup readiness and entitlement reconciliation.

## Mobile

Owns registration, Business preparation, setup/activation status, bounded preparation mode and secure handoff to Merchant Web. It does not own detailed subscription checkout.

## Merchant Web

Owns detailed first purchase, agreement flow, current balance, gateway payment and merchant appointment selection/rescheduling.

## Admin Web

Owns ProcessEdge commercial intervention, setup capacity, setup operations, direct-payment confirmation, governed merchant-specific adjustments, exceptions and audit visibility.

## WhatsApp

May communicate onboarding/setup reminders only where the governed communication/consent path allows. WhatsApp is not payment, appointment or activation authority.

## AI

May explain the governed state and next action. It must not fabricate payment confirmation, discounts, available slots, setup readiness or activation.

## Reporting/Audit

Must distinguish at minimum gross commercial value, discounts/adjustments, gateway payments, direct/manual payments, outstanding balance, booking/setup funnel, activation, reschedules/no-shows and privileged Admin intervention.

## Offline/Sync

Cached onboarding status may be displayed. Commercial adjustment, direct-payment confirmation, authoritative slot booking/rescheduling and activation require authoritative online service confirmation. Offline clients must not invent those facts.

# 20. Reporting and operational metrics

The shared reporting model should support, as authoritative data becomes available:

- registration -> Business created -> commercial order -> payment -> booking -> setup -> activation funnel;
- time between each major onboarding stage;
- setup slots/capacity utilisation;
- scheduled/completed/rescheduled/cancelled/no-show appointments;
- Branches waiting on setup;
- orders waiting on merchant action vs ProcessEdge action;
- gross commercial value;
- approved discounts/adjustments;
- gateway collections;
- direct/off-gateway collections;
- outstanding balances;
- activation blocked by agreement/payment/setup;
- Admin override/intervention audit.

Do not label merchant GMV as ProcessEdge revenue or collapse confirmed collections, commercial order value and recognised revenue into one metric.

# 21. Idempotency and historical integrity

All first-purchase, discount, direct-payment, appointment, setup and activation commands must preserve retry safety appropriate to their effects.

At minimum:

1. replaying a command identity must not duplicate discounts, payments, appointments, setup readiness or entitlement;
2. payment evidence and appointment history remain attributable to the original actor/source/time;
3. accepted agreements and confirmed financial history are not destructively rewritten;
4. corrections use governed supersession/reversal/compensating records;
5. Branch/Business isolation remains mandatory;
6. stale checkout or stale slot state must fail closed/revalidate before commitment.

# 22. QA gate

A complete implementation of this lifecycle must verify at minimum:

1. registration -> Business -> secure Merchant Web handoff without duplicate account/data entry;
2. current governed commercial price/order is server-derived;
3. Admin discount changes net due and preserves gross/adjustment audit;
4. unauthorised/Support-only user cannot apply discount or confirm payment;
5. AAL2/capability/scope checks enforce privileged Admin actions;
6. direct payment confirmation is idempotent and does not create a fake provider event;
7. partial direct payment + gateway remainder collects exactly the remaining authorised amount;
8. discount + gateway payment collects exactly the adjusted authorised amount;
9. direct payment + discount + gateway remainder reconciles correctly;
10. 100% authorised discount requires no synthetic payment;
11. stale checkout cannot over-collect after an adjustment/direct payment;
12. accepted agreement is replaced/amended rather than rewritten when changed terms require it;
13. installment arithmetic remains server-derived after valid pre-acceptance adjustment;
14. real setup slots are capacity-backed and double-booking is prevented;
15. permitted reschedule preserves history and capacity correctness;
16. setup completion records required Branch readiness/equipment evidence;
17. multi-Branch activation waits for every included Branch setup obligation under current policy;
18. payment/discount alone cannot activate before required setup/agreement;
19. setup completion alone cannot activate without qualifying commercial settlement;
20. reconciliation retry cannot duplicate entitlement;
21. Mobile remains in bounded preparation mode before activation and gains live capability only from authoritative entitlement;
22. reporting separates gross, adjustments, gateway payments, direct payments and outstanding;
23. cross-surface status is consistent across Mobile, Merchant Web and Admin Web;
24. WhatsApp/AI/offline paths cannot author authoritative commercial/setup/activation facts.

# 23. Anti-patterns

Do not:

- add a generic Admin `Activate` button as a substitute for reconciliation;
- mark a direct bank transfer as a fake Paystack success;
- overwrite standard plan price to give one merchant a discount;
- hide the original gross amount after a discount;
- let Admin browser code calculate the authoritative installment/checkout balance;
- let a stale checkout collect the pre-discount/pre-manual-payment amount;
- mutate an accepted agreement in place;
- treat appointment completion as automatic setup readiness without required evidence;
- create a scheduler-owned activation flag;
- permit free-text arbitrary appointments where capacity is meant to be governed;
- permit Mobile, WhatsApp or AI to invent commercial/setup/activation state;
- leave another SellerTray surface on the old lifecycle when this process is implemented.

# 24. Implementation sequencing

Unless a later explicit decision changes the order, implement this lifecycle in bounded shared-core-first slices:

### OA0 — Existing-authority reconciliation

- inventory current registration, Business creation, subscription, commercial order, agreement, payment, Branch setup, entitlement and Admin authority;
- identify legacy trial/runtime compatibility still in force;
- identify current Merchant Web/Mobile onboarding routes and gaps.

### OA1 — Onboarding read model and preparation state

- one server-derived onboarding state/blocker/next-action read model;
- Mobile setup/activation workspace;
- secure Business-bound Merchant Web handoff;
- preparation-mode capability enforcement.

### OA2 — Admin commercial intervention

- merchant-specific current-order adjustment authority;
- direct/off-gateway payment authority;
- updated settlement arithmetic/reconciliation;
- stale-checkout protection;
- Admin UI + merchant balance/status presentation;
- audit, AAL2/capability/scope and idempotency tests.

### OA3 — Scheduling foundation

- service areas/capacity/resources/blackouts;
- available-slot read model;
- concurrency-safe appointment booking/rescheduling;
- Merchant Web booking and Admin operations surface;
- Mobile appointment/status presentation.

### OA4 — Setup completion -> readiness -> activation

- setup/equipment checklist/evidence;
- exact Branch-setup obligation readiness;
- activation reconciliation trigger/recovery;
- multi-Branch blocker presentation;
- guarantee start from activation.

OA4 implementation contract:

- Completion evidence version 1 requires Branch configuration and merchant walkthrough, at least one supplied/configured Bluetooth printer with serial/device identifier, successful pairing and test receipt, handover condition, receiving representative and acknowledgement/evidence reference. Missing, malformed or failed evidence prevents both completion and readiness. The appointment event records the assigned worker, verified ProcessEdge actor and server completion time.
- Completion and exact purchase-line readiness commit together. Entitlement reconciliation uses the existing authority in an isolated exception block; a failure preserves those prerequisite facts and is audited. Recovery retries entitlement reconciliation only, never rewrites readiness, payment, agreement or runtime entitlement directly.
- Every initial-purchase Branch obligation remains required. All three surfaces consume the shared named-Branch projection. Guarantee boundaries derive from the original entitlement activation timestamp.
- Newly created Businesses receive no operational trial window. The compatibility row retains its pre-C2 representation, with an immediately ended trial window, until governed reconciliation activates it. Existing legacy rows are not backfilled or retired in OA4. A trial-compatibility Business with a governed subscription purchase cannot use its former trial window to bypass activation. This is a forward onboarding safeguard, not the C2 estate migration.

### OA5 — Notifications, reporting and acceptance

- governed email/push/eligible WhatsApp reminders;
- onboarding funnel/setup SLA/commercial intervention reporting;
- full cross-surface QA;
- controlled real-merchant acceptance without synthetic payment or manual entitlement edits.
