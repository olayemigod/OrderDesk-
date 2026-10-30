# SellerTray Agreement Governance

Status: **Normative extension of `SKILL.md` for SellerTray legal agreement publication, merchant acceptance, Order Forms, agreement evidence and service-delivery gating.**

This file records the latest explicit SellerTray agreement decision and controls wherever older agreement, commercial, onboarding, C1/C1A, Merchant Web or repository wording conflicts.

## Governing legal/commercial model

SellerTray maintains two separate governed instruments:

1. **Universal Master Agreement** — the continuing legal framework between ProcessEdge Solutions Limited and a SellerTray Business.
2. **Merchant Order Form** — the purchase-specific commercial instrument for an initial purchase or later governed commercial commitment/change.

These instruments must remain separate in authority, persistence, acceptance/confirmation evidence and lifecycle.

> **Accept the Master Agreement once per Business/current required version. Confirm an Order Form for each governed commercial commitment that requires merchant confirmation.**

Do not require a merchant to re-accept an unchanged Master Agreement merely because the merchant buys again, changes plan, adds a Branch, renews on materially changed commercial terms, buys equipment, or enters another separately governed commercial commitment.

Do not treat Order Form confirmation as Master Agreement acceptance. Do not treat Master Agreement acceptance as Order Form confirmation or payment.

## Approved lifecycle

For a new Business, the approved first-purchase lifecycle is:

> **Business/Branch preparation -> review current Master Agreement PDF -> accept current Master Agreement -> select plan/create first purchase -> generate purchase-specific Order Form -> review Order Form PDF -> confirm purchase/Order Form -> payment/settlement -> setup/readiness -> entitlement reconciliation/activation.**

For a later commercial change under an unchanged Master Agreement:

> **Select/change commercial commitment -> generate a new Order Form -> review the new Order Form PDF -> confirm the new Order Form -> settle any resulting obligation -> reconcile entitlements.**

Examples include, where governed confirmation is required:

- initial subscription purchase;
- plan upgrade;
- plan downgrade where commercial acknowledgement is required;
- Branch subscription/addition;
- equipment purchase;
- separately priced add-on;
- renewal with materially changed commercial terms;
- another governed purchase that creates new merchant-specific commercial obligations.

A later purchase must create or resolve its own Order Form. It must not mutate a historical Order Form in place.

## Universal Master Agreement contract

1. There is one platform-wide SellerTray Master Agreement content/version in force at a time, subject to effective-date/version governance.
2. The same exact published Master version applies to every merchant. Do not create merchant-specific Master Agreement wording in the normal SellerTray contract path.
3. Merchant-specific facts such as plan, price, Branch, equipment, discounts, installment schedule, renewal particulars and commercial order identity belong in the Order Form/commercial record, not in Master Agreement version identity.
4. A Business accepts a required Master Agreement version once.
5. Acceptance remains valid for that immutable version until a newer required version becomes effective and requires re-acceptance.
6. Acceptance of version N never counts as acceptance of version N+1 when N+1 requires re-acceptance.
7. Acceptance for one Business never counts for another Business.
8. Publishing a new Master version must not rewrite historical Master acceptance or historical Order Forms.
9. Already-earned entitlement periods are not silently deleted or shortened merely because a new Master version is published.
10. If no required Master version is published, the governed first-purchase/service-delivery boundary fails closed.

## Master Agreement presentation and acceptance UX

The approved Merchant Web presentation is **PDF-first**, not a long inline legal-text page.

The Merchant Web Master Agreement screen should show a concise professional summary containing at minimum:

- agreement title;
- version;
- effective date;
- acceptance status;
- accepted-by/accepted-at evidence when already accepted;
- a clear **Review Master Agreement** action.

When acceptance is required:

1. **Review Master Agreement** opens the exact governed Master Agreement PDF in a responsive **in-page modal preview**. Do not rely on a new browser tab/window as the primary review interaction.
2. The preview is full-screen or otherwise comfortably readable on narrow/mobile web and modal-sized on larger screens.
3. The authoritative acceptance action remains disabled until the exact current PDF preview has loaded successfully in the modal.
4. Loading the modal shell alone is not sufficient review evidence; the governed PDF itself must reach the preview load event before the session is marked reviewed.
5. SellerTray binds acceptance evidence to the current Master Agreement version/content hash and the exact reviewed PDF hash/evidence.
6. The merchant provides the authorised representative legal name and confirms authority.
7. The affirmative button is **Accept & Continue**.
8. This action accepts only the current Master Agreement. It must not confirm a purchase, plan or Order Form.
9. The long `content_body` may remain available to the system for indexing, audit, accessibility, search, version integrity and PDF fallback generation, but it is not the primary Merchant Web reading surface.

If ProcessEdge published a reviewed source PDF for the Master version, Merchant Web should present that exact reviewed PDF. If a historical/text-published version has no stored source PDF, SellerTray may generate a deterministic professional PDF from the immutable published content and bind acceptance to that generated document hash.

## Master Agreement acceptance authority

Master Agreement acceptance is Business-scoped and version-scoped.

Required evidence includes at minimum:

- Business/tenant ID;
- Master Agreement version ID/code;
- immutable Master content hash;
- reviewed Master PDF hash/evidence;
- accepting authenticated user;
- accepted legal name;
- merchant role/authority at acceptance time;
- acceptance method/channel;
- idempotency command ID;
- server acceptance timestamp;
- appropriate request evidence.

Authority rules:

1. Business Owner may accept.
2. A Manager may accept only when the existing explicit commercial-agreement capability authorises that Manager.
3. Staff/Cashier cannot accept.
4. One Business/version has at most one authoritative Master Agreement acceptance record.
5. Exact command replay must be duplicate-safe.
6. Acceptance history remains immutable after later role/staff changes.

## Merchant Order Form contract

The Merchant Order Form is a separate merchant-specific commercial instrument.

Each governed commercial commitment that requires merchant confirmation must have its own immutable Order Form identity and commercial snapshot.

An Order Form should preserve, as applicable:

- Business identity;
- commercial order/reference;
- plan/profile and applicable version;
- Branch scope;
- price lines;
- discounts/approved adjustments;
- tax/VAT presentation;
- installment/payment schedule where applicable;
- equipment/add-ons where applicable;
- effective/start/renewal particulars;
- Order Form template/version;
- rendered Order Form content;
- commercial snapshot hash;
- Order Form content hash;
- issued timestamp;
- supersession/replacement relationship where applicable.

Rules:

1. Initial purchase creates a purchase-specific Order Form.
2. A later plan change or other separately governed commercial commitment creates a new Order Form where confirmation is required.
3. Never overwrite a historical confirmed Order Form to represent later terms.
4. A replacement/amendment Order Form must preserve the superseded instrument for history/audit.
5. The Order Form references or operates under the accepted Master Agreement; it does not create a new universal Master Agreement version.
6. Confirming a new Order Form under an unchanged Master Agreement must not create another Master acceptance.

## Order Form review and confirmation UX

Order Form confirmation is distinct from Master Agreement acceptance.

The purchase/change flow should present:

- concise commercial summary;
- purchase/Order Form reference;
- plan and price details;
- governed Order Form PDF review action;
- authorised representative details where required;
- a final **Confirm Purchase** or **Confirm Order Form** action.

The final action must not be labelled **Accept & Continue** when the Master Agreement is already accepted.

The Order Form confirmation button remains disabled until the exact governed Order Form/review PDF has been opened and the merchant completes the required authority/confirmation controls.

Order Form confirmation evidence must bind to the exact Order Form/commercial snapshot/package fingerprint or equivalent immutable evidence used by the implementation.

## Agreement Package PDF

SellerTray may generate an Agreement Package PDF for convenience, audit, download or execution evidence. Packaging documents together does **not** merge their legal authorities.

A package may contain:

- a cover page;
- the governing Master Agreement for reference;
- the purchase-specific Order Form;
- integrity/fingerprint evidence;
- an electronic execution certificate after confirmation.

However:

1. Master Agreement acceptance remains its own Business/version fact.
2. Order Form confirmation remains its own purchase-specific fact.
3. An unchanged Master Agreement included in a later package is reference material and is not re-accepted by confirming the new Order Form.
4. The package UI must not imply that the merchant is accepting the Master Agreement twice.
5. Where clearer UX is achieved by presenting a Master-only PDF first and an Order-Form-focused PDF later, prefer that separation.

## Current approved legal version

The current ProcessEdge-approved successor is **SellerTray Master Services and Subscription Agreement v1.0**. This version supersedes v0.9 only after v1.0 is published through the governed Admin publication authority and becomes effective.

ProcessEdge explicitly approved v1.0 on 30 October 2026 to align the operative legal wording with the already-approved separated Master Agreement and Merchant Order Form authority. Do not represent this as external counsel approval.

**v0.9 remains immutable historical legal evidence.** Do not edit, replace, delete, backfill or re-label the published v0.9 content, reviewed PDF, acceptance records, Order Forms or package evidence. Existing v0.9 acceptance never counts as acceptance of v1.0.

The v1.0 legal content is the approved v0.9 content and incorporated Schedules unchanged except for these two explicitly approved replacements:

### Master Agreement §2.2 — approved v1.0 replacement

> **First Purchase.** For a Business entering its first governed purchase, SellerTray presents the current required Master Agreement and incorporated Schedules for review and acceptance before the first governed commercial purchase is created. After the Business accepts that Master Agreement version and selects its commercial plan, SellerTray generates the applicable Merchant Order Form as a separate purchase-specific commercial instrument. The Merchant reviews and confirms that exact Order Form separately. Master Agreement acceptance does not confirm an Order Form, and Order Form confirmation does not constitute Master Agreement acceptance. Payment or settlement does not itself constitute acceptance or confirmation of either instrument.

### Schedule 9 §14 — approved v1.0 replacement

> **Agreement Package and Separate Confirmation.** For the first purchase, the Order Form is generated after the Business has reviewed and accepted the then-current required Master Agreement and selected its commercial plan. The Order Form may be associated with the same governed Agreement Package for evidence and retrieval, but its authority remains separate. The Merchant must review and confirm the exact Order Form through the governed Order Form confirmation action. That confirmation does not create or repeat Master Agreement acceptance.

Preserve every other approved v0.9 legal position in v1.0, including the approved 30-calendar-day Money-Back Guarantee and the previously approved eligibility/return/refund conditions, unless ProcessEdge explicitly approves another change.

Published Master content is immutable. Any material legal change after v1.0 creates another governed version rather than rewriting accepted v1.0 history.

## First-purchase and service-delivery gates

The Master Agreement participates in two independent governed boundaries:

1. **Initial first-purchase entry:** after required Business/Branch preparation and before first plan selection/purchase creation, the current required Master Agreement must be published and accepted.
2. **Service delivery/entitlement:** before a new governed entitlement/activation effect is released, SellerTray independently reconciles current Master acceptance, commercial confirmation/settlement and setup/readiness prerequisites.

Master acceptance is not payment. Payment is not Master acceptance. Order Form confirmation is not payment.

An already-created governed commercial/payment obligation must retain its independent truth; do not fabricate, erase or rewrite payment facts because agreement state changes.

## New Master version while a Business already has Order Forms

Historical Order Forms must never block a required new Master-version acceptance.

When a new required Master version becomes effective:

1. Merchant Web must surface the Master Agreement review/acceptance flow independently of historical Order Forms.
2. The merchant reviews the new Master PDF and accepts that version once.
3. Existing historical Order Form confirmations remain intact.
4. SellerTray must not require a historical purchase to be re-confirmed solely because the Master version changed.
5. A subsequent new commercial commitment receives its own new Order Form under the then-current accepted Master version.

## Admin Web

ProcessEdge Admin may:

- review current/historical Master Agreement versions;
- publish a new immutable Master version;
- publish a reviewed Master PDF;
- review Business acceptance status/history;
- inspect Order Forms and their confirmation evidence;
- inspect package/document integrity evidence;
- reconcile approved Order Form/package generation where authorised.

ProcessEdge Admin must not:

- create merchant-specific variants of the universal Master Agreement merely to hold commercial particulars;
- edit a published Master version in place;
- mark merchant acceptance by direct database write;
- silently rewrite confirmed Order Forms.

## Legacy agreement evidence

Legacy `sellertray_commercial_agreements` and `sellertray_commercial_agreement_acceptances` remain historical evidence from the older order-bound design.

Preserve them for audit/history. They are not current universal Master Agreement authority for new SellerTray service delivery.

## Cross-surface effects

- **Shared Core:** owns version resolution, Master acceptance, Order Form identity/snapshots, idempotency, agreement/payment/entitlement boundaries and audit evidence.
- **Merchant Web:** provides Master PDF review/acceptance and separate Order Form review/confirmation.
- **Admin Web:** publishes legal versions and operates authorised commercial/legal administration without impersonating merchant acceptance.
- **Mobile:** may show agreement/Order Form status and hand off to Merchant Web; it does not create separate agreement truth.
- **WhatsApp:** may notify/deep-link; chat text is not acceptance truth unless a later approved authenticated signing flow is created.
- **AI:** may explain status/terms but cannot accept or confirm on behalf of the merchant.
- **Reporting/Audit:** must distinguish Master acceptance from Order Form confirmation and payment.
- **Offline:** authoritative legal acceptance/Order Form confirmation remains server-governed unless a later explicit offline signing design is approved.

## Required QA gate

Verify at minimum:

1. different Businesses resolve the same current universal Master version/content;
2. merchant-specific commercial particulars do not mutate Master content/version;
3. Business A Master acceptance does not satisfy Business B;
4. Owner Master acceptance succeeds;
5. explicitly authorised Manager acceptance succeeds;
6. Staff/Cashier Master acceptance fails;
7. exact Master acceptance replay is duplicate-safe;
8. first purchase is blocked until current Master acceptance is valid;
9. Merchant Web presents the Master as a professional PDF-first review rather than a long inline text wall;
10. **Review Master Agreement** opens the PDF in a responsive in-page modal rather than depending on a new tab/window;
11. **Accept & Continue** remains disabled until the exact current governed PDF has successfully loaded in that modal;
12. closing the modal before the governed PDF loads does not mark the agreement reviewed;
13. acceptance evidence contains/binds the reviewed Master PDF/content integrity evidence;
14. accepting Master advances first-purchase onboarding to governed plan selection;
15. initial purchase creates its own Order Form;
16. confirming the Order Form does not create another Master acceptance when the current Master is already accepted;
17. a later plan change/other governed purchase creates a new Order Form where confirmation is required;
18. historical Order Forms remain immutable and auditable after later plan changes;
19. a new required Master version can be accepted even when historical Order Forms already exist;
20. accepting the new Master does not rewrite or re-confirm historical Order Forms;
21. Order Form confirmation uses **Confirm Purchase/Confirm Order Form**, not misleading Master-acceptance wording;
22. payment/installment truth remains independent;
23. activation/service-delivery fails closed when required current Master acceptance is missing;
24. legacy agreement history remains unchanged;
25. cross-tenant and capability boundaries are enforced;
26. generated/reviewed PDFs preserve deterministic integrity evidence;
27. exact Order Form confirmation replay remains duplicate-safe;
28. v0.9 remains immutable after v1.0 publication;
29. v0.9 acceptance does not satisfy required v1.0 acceptance;
30. v1.0 §2.2 and Schedule 9 §14 match the approved separated-authority wording exactly while all other v0.9 legal positions remain unchanged.

## Precedence

This file is the latest SellerTray agreement decision.

It supersedes older wording that required or implied:

- one combined Master + Order Form affirmative acceptance transaction;
- re-acceptance of an unchanged Master Agreement on every purchase;
- long inline Master Agreement text as the primary Merchant Web review UX;
- new-tab/window-only Master Agreement review as the primary Merchant Web interaction;
- Order Form confirmation simultaneously creating Master acceptance in the normal current path;
- treating the Master Agreement and Order Form as one persistence identity;
- treating the published v0.9 wording in Master §2.2 or Schedule 9 §14 as current authority after v1.0 becomes effective.

Where older `AGENTS.md`, `COMMERCIAL.md`, `COMMERCIAL_C1.md`, `COMMERCIAL_V2.md`, `ONBOARDING_ACTIVATION.md`, migrations, comments, UI copy, legal draft notes or tests conflict with this separation or the approved v1.0 successor decision, **this `AGREEMENTS.md` decision controls**.