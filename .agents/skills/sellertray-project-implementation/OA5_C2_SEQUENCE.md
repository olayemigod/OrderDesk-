---
name: sellertray-oa5-c2-sequence
description: "Normative implementation and acceptance sequence from OA4 closure through OA5 lifecycle proof into the Commercial V2 C2 cutover."
metadata:
  author: ProcessEdge Solutions Limited
  product: SellerTray
  version: "0.1.0"
  status: governing-extension
---

# SellerTray OA4 -> OA5 -> C2 Sequence Governance

## Status and precedence

This file is a normative sequencing extension of `SKILL.md`, `COMMERCIAL.md`, `COMMERCIAL_C1.md`, `COMMERCIAL_V2.md`, `ONBOARDING_ACTIVATION.md`, `CROSS_SURFACE.md`, `INTELLIGENT_IMPLEMENTATION.md`, `ADMIN_CAPABILITIES.md` and `ADMIN_NAVIGATION.md`.

It records the later approved execution order for the remaining SellerTray onboarding/commercial work. Where an older document implies C2 begins immediately after OA4 code lands, this file controls.

The required sequence is:

> **OA4 acceptance/closure -> OA5 lifecycle notifications/reporting + controlled production-test Business proof -> C2 Commercial V2 cutover/legacy runtime retirement -> later commercial/operations maturity -> launch acceptance**

Do not skip OA5 evidence merely because static CI is green.

# 1. OA4 closure boundary

OA4 remains the setup-completion/readiness/reconciliation implementation boundary already established before Commercial V2.

OA4 must prove, for the current compatibility architecture:

- governed setup appointment progression;
- structured setup/equipment completion evidence;
- fail-closed required completion evidence;
- Branch setup readiness derived from completion authority;
- no direct generic activation shortcut;
- entitlement reconciliation/recovery remains idempotent;
- Merchant/Admin/Mobile observe consistent lifecycle state;
- sale-document/printing behavior already converged in the same release candidate remains regression-safe.

Because the target C2 architecture now makes subscription and activation Branch-owned, OA4 acceptance should use a **controlled single-Branch lifecycle** rather than spend release evidence proving the older all-initial-Branches blocking behavior that C2 will replace.

OA4 is not permission to mutate the current compatibility schema into an unreviewed partial Branch-subscription engine.

# 2. OA5 purpose

OA5 is the required pre-C2 operational proof layer.

It proves that the governed onboarding/commercial lifecycle is observable, reportable, recoverable and suitable for one controlled real-merchant acceptance before the legacy runtime authority is retired.

OA5 is divided into three bounded slices.

# 3. OA5A — Lifecycle notifications

Implement governed notification events for material onboarding/commercial changes where the underlying event authority exists.

At minimum assess and implement applicable notifications for:

- commercial order created/ready for action;
- discount/adjustment applied where merchant-facing notification is appropriate;
- confirmed payment received;
- balance/outstanding requiring action;
- required legal agreement/version awaiting acceptance;
- agreement accepted;
- setup appointment scheduled;
- setup appointment rescheduled/cancelled where applicable;
- setup completed;
- Branch readiness reached;
- activation/reconciliation succeeded;
- activation/reconciliation failed or requires ProcessEdge/merchant attention;
- subscription/entitlement expiry or renewal attention when governed timing exists.

Requirements:

1. Notifications derive from shared authority/events; clients must not invent state transitions.
2. Mobile notification bell uses actual governed unread-notification state, not operational queue counts.
3. Merchant Web and Mobile may present different UX while referring to the same event truth.
4. Admin may have operational alerts/work queues for ProcessEdge actions without becoming merchant notification truth.
5. Retry/idempotency must not duplicate notifications for one business event.
6. WhatsApp delivery, where approved, is an outbound channel for governed notification intent, not a separate lifecycle authority.

# 4. OA5B — Onboarding and commercial reporting

OA5 must provide governed reporting/read models sufficient to understand onboarding progress and bottlenecks before C2 cutover.

The reporting model should be Branch-aware even while the compatibility runtime row is still Business-scoped.

At minimum support, where facts exist:

- Business;
- Branch;
- selected commercial plan/order snapshot;
- commercial order date;
- agreement required/current/accepted state;
- settlement state;
- amount paid/outstanding;
- setup appointment state/date;
- setup completion state;
- Branch readiness state;
- activation/reconciliation state;
- current blocker/next action;
- timestamps for stage progression;
- ProcessEdge actors for privileged interventions;
- time-in-stage/funnel metrics where server-derived safely.

Admin reporting should distinguish merchant onboarding funnel/operations from ProcessEdge Revenue Dashboard accounting semantics.

Do not reconstruct commercial or onboarding truth in browser code when a governed server read model can provide it.

# 5. OA5C — Controlled production-test Business lifecycle proof

Before C2 retires the legacy runtime model, one explicitly designated **disposable production-test SellerTray Business** must complete the genuine governed production lifecycle. Disposability applies only to the Business used for controlled acceptance; it never permits synthetic payment, fabricated agreement/setup/readiness evidence, direct entitlement mutation, or a manually edited subscription period.

Use a controlled **single-Branch** lifecycle for this proof unless a later explicit decision changes the acceptance design.

Required proof sequence:

> current universal Master Agreement acceptance -> governed plan/purchase -> exact purchase-specific Order Form and Agreement Package confirmation -> qualifying genuine confirmed settlement -> governed setup appointment -> structured setup completion -> Branch readiness -> entitlement reconciliation -> operational activation

Verify at minimum:

- commercial prices/tax came from governed authority;
- the current universal Master Agreement was accepted by the authorised merchant identity before the first purchase;
- the exact current Order Form and deterministic Agreement Package fingerprint were confirmed for the exact commercial order;
- adjustment/direct-payment behavior, if used, preserved immutable evidence and at least one qualifying genuine payment fact exists;
- setup completion has genuine required evidence;
- readiness is derived, not manually invented;
- reconciliation is retry-idempotent;
- current compatibility runtime effect matches the governed entitlement event;
- Merchant Web, Mobile and Admin report the same outcome;
- notification/reporting evidence exists for the lifecycle;
- audit actor/reason/evidence exists for privileged Admin actions;
- no duplicate entitlement/payment/setup effects occur on retry.

The canonical automated proof entrypoint is `platform_admin_verify_oa5c_production_test_business_proof(actor_user_id, tenant_id, commercial_order_id)`. The older `platform_admin_verify_oa5c_real_merchant_proof(...)` remains compatibility evidence and is not sufficient for OA5C acceptance because it predates the exact Order Form/Agreement Package confirmation gate.

C2 may begin only after this proof is accepted or the user explicitly changes the gate.

# 6. C2 purpose

C2 retains its original strategic purpose from `COMMERCIAL_C1.md`: deliberately retire the legacy trial-oriented Business subscription runtime after compatibility is proven.

The later approved Commercial V2 architecture now defines **what C2 cuts over to**:

> Branch-owned subscriptions + versioned configurable Plan Profiles + canonical feature/capability/limit catalogue + shared Branch entitlement resolver + governed commercial masters.

Therefore C2 is not a separate second project after Commercial V2. **Commercial V2 is the target C2 architecture.**

# 7. C2-0 — Governance reset

Before schema/application implementation:

- record Branch as subscription owner;
- record Business subscription status as aggregate only;
- supersede all-initial-Branches blocking activation for the target architecture;
- prohibit hard-coded plan behavior;
- establish Plan Profiles as versioned feature/capability/limit profiles;
- establish agreement-version acceptance rather than repeated acceptance of unchanged general legal terms;
- establish Merchant Web self-service and Mobile secure handoff;
- establish commercial master requirements for tax, pricing classes, installment structures and ProcessEdge commercial payment methods;
- establish professional Admin Commercial UX requirements.

`COMMERCIAL_V2.md` is the normative contract for these decisions.

# 8. C2-1 — Capability and commercial master inventory

Before adding new schema, inventory the current implementation across migrations, RPCs/commands, clients and tests.

Produce a reconciled catalogue of:

- current merchant roles;
- current named capabilities and implicit role behaviors;
- current Branch scope rules;
- Mobile operational actions;
- Merchant Web management actions;
- WhatsApp actions;
- AI actions;
- report/export actions;
- existing usage meters/quotas;
- existing subscription/plan tables;
- C1 commercial order/price/agreement/installment/entitlement authorities;
- setup/readiness/activation authorities;
- current tax masters/settings;
- current payment-method masters/settings;
- current offline cached policies.

The catalogue becomes the basis for the canonical feature/capability/limit registry. Do not seed a disconnected speculative list.

# 9. C2-2 — Plan Profile and entitlement catalogue foundation

Implement versioned shared authority for:

- feature catalogue;
- capability catalogue;
- limit definitions;
- Plan Profiles;
- Plan Profile Versions;
- feature grants;
- capability grants;
- limit values;
- add-on entitlement definitions;
- version status/effective dates/history.

Seed editable Starter, Growth and Scale profiles only after mapping the real catalogue.

Plan profile management remains unavailable as a completed merchant-facing capability until server enforcement/resolution is connected.

# 10. C2-3 — Commercial configuration masters

Converge commercial configuration around governed masters:

- commercial charge types;
- effective-dated subscription pricing;
- effective-dated Branch setup pricing;
- add-on/additional staff or other approved price classes;
- SellerTray Commercial Tax Master;
- Installment Structure Master;
- ProcessEdge Commercial Payment Method Master;
- discount/adjustment type authority;
- merchant-specific recurring price/entitlement override authority.

Existing C1 history remains immutable and compatible during transition.

# 11. C2-4 — Branch subscription authority

Introduce the canonical Branch subscription lifecycle.

It must represent at minimum:

- tenant/Business;
- Branch;
- Plan Profile Version;
- billing cycle;
- lifecycle status;
- commercial-order/line linkage;
- activation timestamp;
- entitlement period;
- setup requirement/readiness linkage;
- settlement qualification linkage;
- applicable agreement-version requirement/acceptance linkage;
- guarantee dates/status where applicable;
- cancellation/suspension/expiry state;
- provenance/migration source where legacy compatibility is involved.

Do not immediately delete or stop serving the legacy runtime until migration/read/write parity is verified.

# 12. C2-5 — Shared Branch entitlement resolver

Implement one server/domain resolver that computes effective Branch entitlement from:

- active Branch subscription/Plan Profile Version;
- plan feature/capability grants;
- add-ons/overrides;
- quantitative limits and authoritative usage;
- Branch/scope state;
- lifecycle state;
- current entitlement period;
- preparation/read-only/suspended conditions.

User authorization remains separate and intersects with the resolved plan entitlement.

The resolver is the shared authority for Mobile, Merchant Web, WhatsApp, AI, reporting and offline preparation/replay.

# 13. C2-6 — Branch-aware commercial orders and settlement

Replace the compatibility assumption of one Business-level subscription line with Branch-bound subscription subjects.

Support one commercial order containing multiple Branch subscription lines with different plans/cycles when commercially valid.

Converge settlement UX/authority for:

- overview/balance;
- confirmed payments;
- percentage/fixed discounts;
- installment policy/template;
- reconciliation/history;
- governed ProcessEdge payment-method selection.

All arithmetic remains server authoritative.

# 14. C2-7 — Agreement V2

Implement version-managed legal agreements:

- editable draft content;
- preview;
- immutable publish version;
- content hash/integrity evidence;
- effective/applicability policy;
- acceptance ledger by required version;
- historical version review;
- replacement/supersession.

Do not require repeat acceptance of the same unchanged general agreement for every commercial order.

Keep transactional commercial schedules/setup acknowledgements as immutable evidence separate from general legal acceptance.

# 15. C2-8 — Branch onboarding/activation convergence

Rewrite onboarding/reconciliation projections and commands around Branch subscription authority.

Each Branch activates independently when its own required prerequisites are satisfied.

A pending Branch must not block an independently qualified Branch.

Business dashboards aggregate Branch states; they do not own an independent Business activation state machine.

Guarantee start remains tied to authoritative Branch activation where the guarantee applies.

# 16. C2-9 — Merchant self-service and cross-surface convergence

## Merchant Web

Implement Branch plan selection/comparison, order creation, agreement acceptance, payment, setup status, renewal, plan change and usage/limit explanation.

## Mobile

Implement Branch plan/status/expiry/usage visibility, preparation/active gating and secure Merchant Web handoff for detailed commercial management.

## Admin Web

Implement professional Plan/Profile/Entitlement/Pricing/Tax/Installment/Payment-Method/Agreement management and Branch subscription review/recovery.

## WhatsApp

Consume Branch entitlement for selling/channel behavior; do not create subscription truth.

## AI

Consume governed plan/entitlement/usage state; do not invent commercial authority.

## Reporting/Audit

Expose Branch subscription mix, plan/version, renewal/expiry, usage/limit, agreement-version acceptance and privileged commercial history.

## Offline/Sync

Use bounded versioned entitlement snapshots for approved offline operations and revalidate on replay.

# 17. C2-10 — Legacy migration and cutover

Only after the new authority is proven:

1. map existing `tenant_subscriptions` and entitlement history to Branch subscription compatibility records according to an explicit migration policy;
2. preserve original commercial/activation/period evidence;
3. handle Businesses with multiple existing Branches without pretending historical Branch ownership that did not exist;
4. validate new reads against old runtime behavior for legacy merchants;
5. switch new runtime reads/writes to Branch subscription authority;
6. remove/retire trial-era merchant-facing semantics;
7. retain legacy history as audit/evidence;
8. remove obsolete compatibility mutation only when no supported flow still depends on it.

A successful migration file is not sufficient evidence. Verify live authority, row mapping, client behavior and retry safety.

# 18. C2-11 — Commercial V2 acceptance

Use at least one controlled Business with multiple Branches for final C2 acceptance.

Recommended proof set:

- Branch A -> Starter;
- Branch B -> Growth;
- Branch C -> Scale;
- mixed billing cycles where supported;
- one Branch pending setup while another is active;
- plan feature difference;
- plan capability difference;
- user role restriction within a plan that allows the feature;
- limit/quota boundary;
- upgrade/downgrade at allowed boundary;
- renewal;
- audited Admin extension if implemented;
- payment failure/recovery;
- percentage/fixed discount;
- governed payment method selection;
- installment template selection;
- new agreement version requiring re-acceptance;
- unchanged agreement not requiring duplicate acceptance;
- offline entitlement/replay behavior;
- WhatsApp entitlement behavior;
- AI entitlement explanation;
- reporting/audit convergence;
- repeated reconciliation/replay without duplicate entitlement/payment/stock effects.

Only after this acceptance should legacy Business-wide runtime semantics be considered retired.

# 19. Post-C2 remaining commercial/operations maturity

C2 does not silently erase other planned work.

After C2, continue the approved SellerTray roadmap for applicable outstanding areas such as:

- guarantee/refund operations;
- promotions and commercial incentives when approved;
- merchant commercial self-service maturity;
- Admin internal capability/RBAC completion;
- deeper commercial/onboarding/adoption reporting;
- operations-health and audit maturity;
- security/RLS review;
- physical printing/device acceptance;
- full release/production acceptance.

# 20. Stop/sequence rules

Do not:

- start C2 cutover before OA5 controlled lifecycle proof unless the user explicitly changes that gate;
- merge temporary Business-level commercial enhancements that make C2 migration harder merely to improve a screen;
- treat OA5 notifications/reporting as optional polish when they are required evidence for lifecycle observability;
- implement the Plan Profile UI before the shared catalogue/version authority exists;
- expose Branch subscription UI while runtime still authoritatively grants Business-wide access without an explicit compatibility layer;
- retire legacy runtime because CI is green without migration and controlled acceptance evidence;
- declare Commercial V2 complete while any affected surface still uses stale plan-name hard-coding or Business-wide subscription truth.