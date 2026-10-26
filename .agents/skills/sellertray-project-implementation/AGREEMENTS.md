# SellerTray Master Agreement Governance

Status: **Normative extension of `SKILL.md` for SellerTray legal agreement publication, merchant acceptance and service-delivery gating.**

This file records the later explicit product decision that replaces the older order-bound C1A agreement model for all current and future SellerTray behavior.

## Governing rule

> SellerTray uses one universal, platform-wide, versioned Master Agreement. A Business accepts the current required version once. Agreement acceptance is never repeated merely because another commercial order is created.

The Master Agreement is legal/governance authority. Commercial orders, pricing, installments, discounts, payments and setup obligations remain independent governed commercial facts even when they are presented to the Merchant as part of one consolidated Agreement Package and one acceptance experience.

## Consolidated Agreement Package and acceptance UX

SellerTray deliberately avoids a cumbersome experience in which a Merchant is asked to separately accept the Master Agreement, each incorporated Schedule, the Data Processing Addendum, Acceptable Use Policy, commercial terms, equipment terms and Merchant Order Form through multiple checkboxes or signing steps.

The approved Merchant experience is:

> **One Agreement Package. One review experience. One affirmative acceptance action. Multiple governed and versioned components behind it.**

Rules:

1. The consolidated package may present the universal Master Agreement, incorporated Schedules and the applicable Merchant Order Form together as one coherent contractual package.
2. The Merchant must not be forced through separate acceptance controls for every incorporated Schedule merely because the documents are independently governed or versioned internally.
3. Schedule 9 / the Merchant Order Form may contain Merchant-specific commercial facts such as Plan, price, Branches, Equipment, discounts, renewal terms and other approved purchase particulars and may be included in the consolidated acceptance presentation.
4. Including the Merchant Order Form in the consolidated presentation does **not** make the universal Master Agreement merchant-specific and does **not** require ProcessEdge to create a new copy or new version of the universal Master Agreement for that order.
5. The persistence identity and lifecycle of the universal Master Agreement, incorporated Schedules, commercial Order Form and their evidence may remain distinct even though the Merchant experiences one consolidated review/acceptance transaction.
6. A later commercial order, Branch purchase, installment schedule or renewal under an unchanged required Master Agreement version must not require the Merchant to re-accept that unchanged Master Agreement merely because new commercial facts exist. Any affirmative acceptance required for the new commercial instrument is governed separately while the existing universal Master Agreement acceptance remains valid.
7. When a new Master Agreement version requiring re-acceptance becomes effective, SellerTray may again present the required legal package and relevant commercial context in one consolidated acceptance experience.
8. Acceptance evidence must make it possible to determine exactly which universal legal version(s) and which applicable Merchant-specific commercial instrument were presented/accepted, without conflating their underlying authorities.

## Current approved legal draft baseline

The current ProcessEdge-approved drafting baseline is the **SellerTray Master Services and Subscription Agreement — Consolidated Counsel Review Copy v0.9**, including the Master Agreement and Schedules 1–9 as drafted and consolidated in the approved legal workstream.

ProcessEdge has explicitly decided to proceed with **v0.9 without waiting for external counsel review**. This is a product/commercial approval decision and must not be misrepresented as external legal advice or external counsel approval.

Rules for this baseline:

1. Preserve v0.9 as the current approved baseline unless ProcessEdge expressly approves a later version.
2. If a later external legal review produces significant changes, create and govern a new version rather than silently rewriting the accepted v0.9 text or its historical acceptance evidence.
3. Minor drafting or formatting corrections must still follow the governed publication/versioning rules once v0.9 has been published; published content is immutable.
4. The v0.9 commercial positions include the approved 30-calendar-day Money-Back Guarantee from Activation Date, no defect requirement for a qualifying suitability claim, no deduction for reasonable included usage, Qualifying Initial Purchase scope, required ProcessEdge-supplied Equipment returned in Good Condition, refund initiation within 10 Business Days after eligibility verification and required receipt/inspection, and the approved return-transport allocation.
5. Customer payment method, payment transaction value and payment transaction count are not standard SellerTray Subscription meters.
6. Planned features are not current contractual Entitlements.
7. Payment and fulfilment remain separate business facts.
8. SellerTray AI assists and does not acquire independent authority to bypass governed permissions or make unauthorised material financial commitments.
9. ProcessEdge remains the contracting legal entity; SellerTray is the product/service.

## Universal agreement contract

1. There is one SellerTray Master Agreement content/version in force platform-wide at a time.
2. The same published universal Master Agreement version and exact universal content applies to every merchant. Do not generate merchant-specific Master Agreement wording or Business-specific variants in the normal SellerTray contract path. Merchant-specific commercial particulars belong in the governed Order Form/commercial instrument.
3. A Business accepts a required Master Agreement version once. Creating another commercial order, Branch purchase, installment schedule or renewal under the same required version must not require the Business to re-accept that unchanged Master Agreement.
4. Acceptance remains valid for that exact immutable published version until a newer required version becomes effective and re-acceptance is required by the governed change classification.
5. When a newer version requiring re-acceptance becomes effective, a Business that has accepted only an older version has not accepted the new version and must accept it before the next governed service-delivery commitment that requires the current Master Agreement.
6. Publishing a new version must not rewrite or invalidate historical acceptance evidence and must not retroactively erase already-earned entitlement periods.
7. If no effective Master Agreement version has been published, a new service-delivery/activation commitment fails closed. Do not silently treat a QA template, legacy order agreement or user Terms/Privacy consent as the Master Agreement.

## Relationship to the commercial order process

Master Agreement authority remains distinguishable from commercial-order truth even when the UI presents them together.

- A merchant may create or receive a commercial order without generating a new universal Master Agreement.
- Payment or settlement progression does not itself create or prove Master Agreement acceptance.
- Installment checkout must not require a separate copy/version of the universal Master Agreement.
- The first-subscription experience may present the current Master Agreement and applicable Merchant Order Form together in one consolidated acceptance experience.
- A later commercial order under an unchanged Master Agreement version may use the existing Master Agreement acceptance and separately capture any required commercial-order acceptance/evidence.
- Service delivery/activation checks the current effective Master Agreement acceptance in addition to independent settlement/setup/entitlement prerequisites.

Do not make `commercial_order_id`, `installment_obligation_id`, Branch ID, plan, price or payment terms part of the **universal Master Agreement version identity**. Those facts may be associated with the consolidated acceptance evidence through the applicable Order Form/commercial instrument without changing the universal Master Agreement itself.

## Version authority

Each published Master Agreement version is immutable and must include at minimum:

- stable version identity/code;
- title;
- exact content body;
- content hash;
- effective timestamp;
- publishing ProcessEdge actor;
- publication reason;
- publication/audit timestamp.

A later version is a new immutable record. Do not edit an already published version in place.

The current required version at a point in time is the latest published Master Agreement whose `effective_from` is not later than that point in time, subject to the governed change/re-acceptance classification.

Future-dated publication is permitted so ProcessEdge can prepare a new version before it becomes required.

## Merchant acceptance authority

Master Agreement acceptance is Business-scoped and version-scoped. Consolidated package evidence may additionally associate the applicable Merchant Order Form/commercial instrument presented in the same acceptance experience.

Required evidence includes:

- Business/tenant ID;
- Master Agreement version ID/code and content-hash snapshot;
- accepting authenticated user;
- accepted legal name;
- merchant role/authority at acceptance time;
- acceptance method/channel;
- request evidence appropriate to the channel;
- idempotency command ID;
- server acceptance timestamp;
- where applicable, the exact incorporated Schedule versions and Merchant Order Form/commercial instrument identifier/version presented in the consolidated package.

Rules:

1. Business Owner may accept.
2. A Manager may accept only when the existing explicit `can_accept_commercial_agreements` merchant capability authorises that Manager.
3. Staff/Cashier cannot accept.
4. One Business/version has at most one authoritative Master Agreement acceptance record, while separate commercial instruments retain their own governed evidence.
5. Exact command replay must be duplicate-safe and must never create duplicate acceptance effects.
6. Acceptance history is immutable even when the accepting user later changes role or leaves the Business.
7. Acceptance of version N never counts as acceptance of version N+1 when N+1 requires re-acceptance.
8. Acceptance for one Business never counts for another Business, even when the same user owns both.

## Service-delivery and entitlement gate

The Master Agreement is checked at service-delivery boundaries, not as a payment gate.

For a new onboarding activation or another new entitlement/term commitment:

1. resolve the current effective Master Agreement version;
2. verify that the Business has immutable acceptance for that exact required version;
3. independently verify the applicable commercial settlement prerequisites;
4. independently verify Branch setup/readiness prerequisites where applicable;
5. only then allow the governed entitlement/service-delivery reconciliation to create the new entitlement effect.

Already-earned active entitlement must not be deleted, shortened or rewritten merely because a newer Master Agreement version is published. A newer version requiring re-acceptance becomes the acceptance requirement for the next new governed service-delivery commitment after its effective date.

## Admin Web

The **Agreements** workspace is platform-scoped legal publication/governance. Commercial Order Forms remain governed commercial records even when their content participates in a consolidated Merchant acceptance experience.

ProcessEdge Admin may:

- review current and historical Master Agreement versions;
- publish a new immutable universal version through the governed capability;
- inspect Business acceptance status/history when a Merchant context is selected;
- audit who published and who accepted each version;
- inspect the commercial instrument associated with a consolidated acceptance where authorised.

ProcessEdge Admin must not:

- create a bespoke universal Master Agreement version for a selected merchant merely to represent commercial particulars;
- replace the universal Master Agreement for only one merchant;
- edit published content in place;
- mark acceptance on behalf of a merchant by direct database write.

Use a semantic publication capability such as `admin.agreements.publish`; read authority remains separately governed.

## Merchant Web

Merchant Web provides a simple consolidated legal/commercial acceptance experience rather than a multi-agreement checklist.

It may show:

- current effective Master Agreement version;
- exact incorporated legal content and Schedules;
- applicable Merchant Order Form/commercial particulars where part of the current transaction;
- whether this Business has accepted the current required Master Agreement version;
- accepted-by/accepted-at evidence where applicable;
- version history;
- one affirmative acceptance action when acceptance is required and the signed-in user has authority.

Do not require a Merchant to separately accept every incorporated Schedule. Do not create a new universal Master Agreement version merely because an Order Form changes.

## Legacy C1A order-bound agreements

The existing `sellertray_commercial_agreements` and `sellertray_commercial_agreement_acceptances` records are legacy historical evidence from the earlier C1A design.

They must remain immutable and readable for audit/history, but they are not current universal Master Agreement authority and must not be used as the sole proof of current Master Agreement acceptance for new SellerTray service delivery.

Current-path code must not create merchant-specific copies/versions of the universal Master Agreement. Legacy issue/accept commands should fail closed or be retired while preserving historical reads. This does not prohibit governed Merchant Order Forms or consolidated acceptance evidence under the approved model.

## Cross-surface effects

- **Shared Core:** owns version resolution, immutable Business/version Master Agreement acceptance, commercial-instrument association and service-delivery checks.
- **Merchant Web:** provides the governed consolidated review/acceptance experience.
- **Admin Web:** publishes universal legal versions, manages legal governance and reviews acceptance/commercial association; it does not create merchant-specific Master Agreement variants.
- **Mobile:** may surface acceptance-required status/deep link when relevant but must not create separate agreement truth.
- **WhatsApp:** may notify or deep-link a merchant to the governed acceptance surface; WhatsApp chat text is not acceptance truth unless a later explicitly approved authenticated signing flow is designed.
- **AI:** may explain status/terms from the governed version but cannot accept on behalf of a merchant.
- **Reporting/audit:** version publication, Business acceptance and applicable commercial association are auditable immutable facts.
- **Offline:** agreement acceptance is not an offline authoritative write; service-delivery reconciliation fails closed until the server has the required acceptance fact.

## QA gate

Verify at minimum:

1. same current universal Master Agreement version/content is returned for different Businesses;
2. Merchant-specific Order Form particulars do not mutate the universal Master Agreement content/version;
3. Business A acceptance does not satisfy Business B;
4. Owner acceptance succeeds;
5. explicitly authorised Manager acceptance succeeds;
6. Staff acceptance fails;
7. exact command replay does not duplicate acceptance effects;
8. the Merchant can review the incorporated package through one coherent acceptance experience without separate Schedule checkboxes;
9. a second commercial order under an unchanged Master Agreement version does not require re-acceptance of that unchanged Master Agreement;
10. any required new-order commercial acceptance is captured without manufacturing a new Master Agreement version;
11. payment/installment checkout is not falsely treated as Master Agreement acceptance;
12. new activation/service-delivery commitment is blocked when no current required Master Agreement version exists;
13. new activation/service-delivery commitment is blocked when the required current version is unaccepted;
14. publishing version N+1 with re-acceptance required makes N-only acceptance insufficient for the next governed service-delivery commitment after N+1 becomes effective;
15. accepting N+1 satisfies that requirement;
16. legacy order-bound agreement history is unchanged;
17. current-path APIs/UI cannot create merchant-specific variants of the universal Master Agreement;
18. publication and acceptance write immutable audit/evidence;
19. consolidated evidence can identify the exact legal version(s) and applicable Order Form/commercial instrument presented;
20. cross-tenant and capability boundaries are enforced.

## Precedence

This file records the latest explicit product decisions and therefore controls wherever older `COMMERCIAL.md`, `COMMERCIAL_C1.md`, `COMMERCIAL_V2.md`, `ONBOARDING_ACTIVATION.md`, Admin agreement wording, migrations or implementation comments conflict with:

- the universal Master Agreement authority;
- the consolidated one-review/one-acceptance Merchant UX;
- the distinction between universal legal version identity and Merchant-specific commercial facts;
- the approved v0.9 baseline and its later-version rule.
