# SellerTray Master Agreement Governance

Status: **Normative extension of `SKILL.md` for SellerTray legal agreement publication, merchant acceptance and service-delivery gating.**

This file records the later explicit product decision that replaces the older order-bound C1A agreement model for all current and future SellerTray behavior.

## Governing rule

> SellerTray uses one universal, platform-wide, versioned Master Agreement. A Business accepts the current required version once. Agreement acceptance is never per commercial order.

The Master Agreement is legal/governance authority, not commercial-order truth. Commercial orders, pricing, installments, discounts, payments and setup obligations remain independent governed facts.

## Universal agreement contract

1. There is one SellerTray Master Agreement content/version in force platform-wide at a time.
2. The same published version and exact content applies to every merchant. Do not generate merchant-specific agreement wording, rendered copies, order-specific legal variants or Business-specific clauses in the normal SellerTray contract path.
3. A Business accepts a Master Agreement version once. Creating another commercial order, Branch purchase, installment schedule or renewal under the same required version must not require the Business to accept that unchanged version again.
4. Acceptance remains valid for that exact immutable published version until a newer required version becomes effective.
5. When a newer version becomes effective, a Business that has accepted only an older version has not accepted the new version and must accept it before the next governed service-delivery commitment that requires the current Master Agreement.
6. Publishing a new version must not rewrite or invalidate historical acceptance evidence and must not retroactively erase already-earned entitlement periods. New activation, renewal/extension or another new service-delivery commitment after the newer version is effective must use the current-version acceptance rule.
7. If no effective Master Agreement version has been published, a new service-delivery/activation commitment fails closed. Do not silently treat a QA template, legacy order agreement or user Terms/Privacy consent as the Master Agreement.

## Relationship to the commercial order process

Agreement acceptance is independent from commercial-order creation and payment.

- A merchant may create or receive a commercial order without generating a new agreement.
- A merchant may pay or progress settlement without signing an order-specific agreement.
- Installment checkout must not require a separate installment/order agreement.
- The first-subscription experience may prompt the merchant to review and accept the current Master Agreement, but the acceptance fact is Business + agreement-version authority, not order authority.
- Service delivery/activation checks the current effective Master Agreement acceptance in addition to the independent settlement/setup/entitlement prerequisites.

Do not put `commercial_order_id`, `installment_obligation_id`, Branch ID, plan, price or payment terms into the current Master Agreement acceptance identity.

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

The current required version at a point in time is the latest published Master Agreement whose `effective_from` is not later than that point in time.

Future-dated publication is permitted so ProcessEdge can prepare a new version before it becomes required.

## Merchant acceptance authority

Acceptance is Business-scoped and version-scoped.

Required evidence includes:

- Business/tenant ID;
- Master Agreement version ID/code and content-hash snapshot;
- accepting authenticated user;
- accepted legal name;
- merchant role/authority at acceptance time;
- acceptance method/channel;
- request evidence appropriate to the channel;
- idempotency command ID;
- server acceptance timestamp.

Rules:

1. Business Owner may accept.
2. A Manager may accept only when the existing explicit `can_accept_commercial_agreements` merchant capability authorises that Manager.
3. Staff/Cashier cannot accept.
4. One Business/version has at most one authoritative acceptance record.
5. Exact command replay must be duplicate-safe and must never create a second acceptance.
6. Acceptance history is immutable even when the accepting user later changes role or leaves the Business.
7. Acceptance of version N never counts as acceptance of version N+1.
8. Acceptance for one Business never counts for another Business, even when the same user owns both.

## Service-delivery and entitlement gate

The Master Agreement is checked at service-delivery boundaries, not as a payment gate.

For a new onboarding activation or another new entitlement/term commitment:

1. resolve the current effective Master Agreement version;
2. verify that the Business has immutable acceptance for that exact version;
3. independently verify the applicable commercial settlement prerequisites;
4. independently verify Branch setup/readiness prerequisites where applicable;
5. only then allow the governed entitlement/service-delivery reconciliation to create the new entitlement effect.

Already-earned active entitlement must not be deleted, shortened or rewritten merely because a newer Master Agreement version is published. The newer version becomes the acceptance requirement for the next new governed service-delivery commitment after its effective date.

## Admin Web

The **Agreements** workspace is platform-scoped publication/governance, not merchant-specific issuance.

ProcessEdge Admin may:

- review current and historical Master Agreement versions;
- publish a new immutable universal version through the governed capability;
- inspect Business acceptance status/history when a Merchant context is selected;
- audit who published and who accepted each version.

ProcessEdge Admin must not:

- issue a bespoke agreement to a selected merchant;
- replace an agreement for only one merchant;
- edit published content in place;
- mark acceptance on behalf of a merchant by direct database write.

Use a semantic publication capability such as `admin.agreements.publish`; read authority remains separately governed.

## Merchant Web

Merchant Web shows one Master Agreement center:

- current effective version;
- exact universal content;
- whether this Business has accepted that version;
- accepted-by/accepted-at evidence where applicable;
- version history;
- one acceptance action when the current version is pending and the signed-in user has authority.

Do not show commercial-order IDs, installment IDs, merchant-specific references or replacement-agreement controls in the current Master Agreement experience.

## Legacy C1A order-bound agreements

The existing `sellertray_commercial_agreements` and `sellertray_commercial_agreement_acceptances` records are legacy historical evidence from the earlier C1A design.

They must remain immutable and readable for audit/history, but they are not current Master Agreement authority and must not be used to require or prove acceptance for new SellerTray service delivery.

Current-path code must not create new merchant/order-specific agreement issuance or acceptance records. Legacy issue/accept commands should fail closed or be retired while preserving historical reads.

## Cross-surface effects

- **Shared Core:** owns version resolution, immutable Business/version acceptance and service-delivery checks.
- **Merchant Web:** review/accept the current universal version.
- **Admin Web:** publish global versions and review acceptance; no merchant-specific issuance.
- **Mobile:** may surface acceptance-required status/deep link when relevant but must not create separate agreement truth.
- **WhatsApp:** may notify or deep-link a merchant to the governed acceptance surface; WhatsApp chat text is not acceptance truth unless a later explicitly approved authenticated signing flow is designed.
- **AI:** may explain status/terms from the governed version but cannot accept on behalf of a merchant.
- **Reporting/audit:** version publication and Business acceptance are auditable immutable facts.
- **Offline:** agreement acceptance is not an offline authoritative write; service-delivery reconciliation fails closed until the server has the acceptance fact.

## QA gate

Verify at minimum:

1. same current Master Agreement version/content is returned for different Businesses;
2. Business A acceptance does not satisfy Business B;
3. Owner acceptance succeeds;
4. explicitly authorised Manager acceptance succeeds;
5. Staff acceptance fails;
6. exact command replay does not duplicate acceptance;
7. second commercial order under unchanged version does not require re-acceptance;
8. payment/installment checkout is not blocked by missing Master Agreement acceptance;
9. new activation/service-delivery commitment is blocked when no current version exists;
10. new activation/service-delivery commitment is blocked when current version is unaccepted;
11. publishing version N+1 makes N-only acceptance insufficient for the next service-delivery commitment after N+1 becomes effective;
12. accepting N+1 satisfies that requirement;
13. legacy order-bound agreement history is unchanged;
14. current-path APIs/UI cannot issue or accept a merchant/order-specific agreement;
15. publication and acceptance write immutable audit/evidence;
16. cross-tenant and capability boundaries are enforced.

## Precedence

This file records a later explicit product decision and therefore controls wherever older `COMMERCIAL.md`, `COMMERCIAL_C1.md`, `COMMERCIAL_V2.md`, `ONBOARDING_ACTIVATION.md`, Admin agreement wording, migrations or implementation comments describe merchant-specific/order-bound agreement issuance or require agreement acceptance as a prerequisite to payment.
