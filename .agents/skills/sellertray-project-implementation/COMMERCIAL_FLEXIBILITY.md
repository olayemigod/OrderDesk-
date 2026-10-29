---
name: sellertray-commercial-flexibility
description: "Normative extension governing configurable SellerTray installment availability, schedule templates, commercial policy overrides and safe enable/disable behavior."
metadata:
  author: ProcessEdge Solutions Limited
  product: SellerTray
  version: "0.1.0"
  status: governing-extension
---

# SellerTray Commercial Flexibility Governance

## Status and precedence

This file is a normative extension of `SKILL.md`, `COMMERCIAL.md`, `COMMERCIAL_C1.md`, `ONBOARDING_ACTIVATION.md`, `ADMIN_CAPABILITIES.md`, `CROSS_SURFACE.md` and `INTELLIGENT_IMPLEMENTATION.md`.

It records the later explicit product decision of 2026-10-23 that SellerTray commercial behavior must remain smart and configurable rather than encoding one stereotyped installment model as permanent product truth.

Where an older rule says installments are always available for a fixed purchase type, are available only for annual purchases, or that only 70:30 and 60:20:20 may exist, this later extension controls.

The core rule is:

> Installment availability, eligibility and schedule structure are governed commercial configuration. They may be enabled or disabled safely at any time without rewriting accepted agreements, confirmed payments or historical commercial facts.

Commercial flexibility does not permit browser-owned arithmetic, unaudited overrides or destructive history changes. Configuration changes must still preserve one shared commercial, payment, agreement, entitlement and audit authority.

# 1. Installments are configurable policy, not hard-coded product truth

SellerTray must not permanently encode `annual = installments` or any equivalent client/server assumption.

The commercial authority must be capable of representing installment policy at appropriate governed scopes, including as needed:

- platform/default policy;
- plan or billing-cycle eligibility;
- merchant-specific commercial override;
- commercial-order snapshot;
- approved schedule template;
- explicitly governed custom schedule where authorised.

A narrower scope may override a broader default only through an authorised, auditable commercial rule. The effective policy used for a commercial order must be snapshotted so later configuration changes do not rewrite historical terms.

Monthly subscriptions must not automatically receive installments merely because configurability exists. Instead, monthly eligibility is controlled by the same governed policy and remains disabled unless explicitly enabled by authorised commercial configuration.

# 2. Enable and disable behavior

Authorised ProcessEdge commercial administration must be able to enable or disable installment availability without a code deployment.

The controlling Admin capability is `admin.installments.manage` or an explicitly approved narrower successor. The mutation requires verified ProcessEdge identity, MFA/AAL2, applicable scope, reason and immutable audit.

Disabling installments has lifecycle-aware semantics:

1. **New commercial offers/orders** — installment options stop being offered immediately within the effective policy scope.
2. **Draft or unaccepted installment orders** — the shared commercial authority may reconfigure them to the currently allowed payment structure. Any stale checkout based on the previous installment amount must be superseded/retired before further collection.
3. **Generated but unaccepted agreements** — regenerate/replace the draft agreement when the effective schedule changes; do not present stale terms for acceptance.
4. **Accepted active installment agreements** — a general configuration toggle does not erase, collapse or rewrite the merchant's accepted obligation. The existing schedule remains authoritative until it is settled or deliberately replaced through a governed amendment/replacement process.
5. **Merchant/order-specific removal after acceptance** — if ProcessEdge and the merchant intentionally replace installments with another payment structure, create an audited amendment/replacement schedule and obtain re-acceptance where the material commercial terms require it. Confirmed payments remain historical facts and are allocated into the replacement settlement authority according to governed rules.
6. **Fully settled historical schedules** — remain unchanged and reportable regardless of the current installment setting.

Turning installments off must never delete schedule lines, fake a full payment, directly activate entitlement, change an accepted agreement in place or rewrite provider/direct-payment history.

# 3. Schedule structures are data-driven

The earlier 70:30 and 60:20:20 structures remain approved presets/default templates, not the only structures the product architecture may support.

The shared commercial model must be capable of representing a governed schedule with, as applicable:

- schedule/template identity and version;
- enabled/disabled status;
- eligible plan/billing cycle/scope;
- installment count;
- percentage and/or fixed allocation rules;
- deterministic rounding rule;
- schedule-line sequence;
- amount per line derived server-side from the authoritative commercial amount;
- due-date or due-offset policy when approved;
- qualifying settlement rule for provisional entitlement;
- provisional entitlement treatment where applicable;
- full-settlement rule;
- grace/past-due/suspension policy when approved;
- effective-from/effective-until timestamps;
- actor, reason and audit metadata.

Every active schedule must reconcile exactly to the authoritative amount it governs after valid adjustments. The server owns allocation and rounding. Clients must never repair a remainder by inventing or silently changing a line amount.

# 4. Smart customization boundary

"Customizable" means governed data and policy, not arbitrary mutation.

Admin Web may provide management controls for:

- installment feature enable/disable;
- eligible plans/billing cycles;
- approved schedule templates;
- merchant/order-specific authorised overrides;
- effective dates;
- review of merchants already on active installment contracts.

Merchant Web consumes only the installment options currently allowed for that merchant/order and shows the exact server-derived schedule before agreement/payment.

Mobile may show onboarding/billing status and attention but must not construct installment options, percentages or balances locally.

WhatsApp and AI may explain the current governed option/state but cannot enable, disable, create or change installment authority.

Offline clients may cache installment state for display but cannot author commercial-policy changes.

# 5. Relationship to adjustments, direct payments and gateway checkout

OA2 commercial intervention must calculate settlement against the exact active order schedule, whether that schedule came from a preset or another governed template.

Approved adjustments, confirmed direct payments and confirmed gateway payments remain separate immutable facts.

The canonical arithmetic remains conceptually:

> gross amount - approved adjustments - confirmed payments = outstanding amount

For an installment order, the shared authority allocates the adjusted payable and confirmed payments across the governed schedule deterministically.

If an adjustment, direct payment, schedule replacement or installment-disable action changes the current gateway payable, every pending checkout whose amount/schedule is no longer authoritative must become terminal/superseded. A delayed provider webhook must not revive a superseded checkout into current settlement authority.

A 100% approved adjustment may reduce payable to zero without fabricating a payment event.

# 6. Agreement and entitlement invariants

Agreement acceptance, payment confirmation, installment configuration, Branch setup readiness and entitlement are distinct facts.

Changing installment configuration does not directly change entitlement.

For accepted commercial terms:

- accepted agreement content remains immutable;
- a material schedule change uses amendment/replacement;
- the replacement preserves linkage to the superseded agreement/schedule;
- payment history remains immutable;
- reconciliation remains the only path that releases/suspends/restores governed entitlement according to the applicable commercial policy.

`reconcile_sellertray_installment_activation` or its later canonical replacement remains the shared reconciliation authority; Admin UI must not bypass it with a generic Activate action.

# 7. Reporting and audit

Commercial reporting must be able to distinguish at minimum:

- installment enabled/disabled policy state;
- effective policy scope/version;
- schedule template/structure used on each order;
- original gross amount;
- adjustments;
- gateway payments;
- direct payments;
- outstanding amount;
- schedule replacement/amendment history;
- merchants still governed by an older accepted schedule after a policy disable;
- actor/reason for enable/disable or merchant-specific override.

Do not rewrite historical reporting to match today's configuration.

# 8. OA2 implementation consequence

OA2 must not deepen the existing fixed-structure assumption.

Before OA2 is complete:

1. settlement arithmetic must consume the schedule authority rather than hard-code 70:30/60:20:20 branches in client code;
2. stale-checkout protection must work after payment, adjustment or schedule-policy change;
3. named capability enforcement must include `admin.installments.manage` for installment-policy mutation;
4. accepted agreements must be replaced rather than rewritten when the schedule materially changes;
5. the OA1/onboarding read model must expose authoritative installment availability/status without making it a Mobile-owned policy;
6. Admin and Merchant Web must read the same effective installment policy/schedule;
7. production migration must preserve existing accepted/active installment schedules as historical contractual truth.

# 9. QA gate

Any implementation of configurable installments must verify the relevant subset of:

1. installments can be disabled for new orders without deployment;
2. installments can be re-enabled according to governed effective policy;
3. monthly or another cycle does not become eligible unless explicitly configured;
4. 70:30 and 60:20:20 remain valid presets;
5. a different approved schedule can be represented without client code changes;
6. schedule allocations reconcile exactly after deterministic rounding;
7. draft/unaccepted order schedule changes supersede stale checkout attempts;
8. a delayed webhook cannot confirm a superseded checkout as current settlement;
9. disabling installments globally does not mutate an existing accepted agreement;
10. merchant-specific replacement of an accepted schedule preserves the original and requires the governed amendment/re-acceptance path where applicable;
11. confirmed prior payments remain allocated/history-preserved through a replacement schedule;
12. `admin.installments.manage` plus AAL2/scope/audit is enforced server-side;
13. Platform Support cannot mutate installment policy by default;
14. Mobile, Merchant Web and Admin Web show one consistent authoritative state;
15. reports preserve historical schedule/policy facts after configuration changes;
16. entitlement reconciliation remains idempotent and is not bypassed by enable/disable actions.

# 10. Anti-patterns

Do not:

- hard-code installments as permanently on;
- require a code release merely to turn installments off;
- encode annual-only eligibility as an irreversible schema assumption;
- treat 70:30 and 60:20:20 as the only schedule shapes the domain can represent;
- let Admin browser code edit schedule-line amounts directly;
- silently collapse an accepted installment contract into one balance because a global toggle changed;
- delete historical schedules when a template is disabled;
- fabricate payments to close a disabled schedule;
- let a disabled/superseded checkout later become payment authority;
- let customization create a second commercial truth outside the shared core.
