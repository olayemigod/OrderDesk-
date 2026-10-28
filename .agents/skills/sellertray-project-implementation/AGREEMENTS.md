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

## Scalable zero-touch operating model

SellerTray agreement handling is designed for a platform that may onboard hundreds or thousands of merchants per day. The normal merchant lifecycle must not require ProcessEdge staff to create, issue, prepare, attach or approve an Agreement Package one merchant at a time.

The governing operating principle is:

> **Configure platform legal/commercial rules once. Automatically instantiate exact merchant evidence from governed facts. Route only genuine exceptions to Admin.**

Rules:

1. ProcessEdge Admin publishes universal Master Agreement versions and governed Order Form template versions as platform configuration. This is occasional legal/commercial administration, not a per-merchant operating step.
2. When the shared commercial authority creates or materially replaces a governed commercial order, the server must automatically resolve the applicable current Order Form template, freeze the exact commercial snapshot, generate/reuse the Order Form identity/reference, and create/reuse the Agreement Package manifest/fingerprint idempotently.
3. A normal merchant purchase must **not** wait for an Admin user to select that merchant, select a template, type an Order Form reference, provide a routine issuance reason or click **Issue Order Form**.
4. Order Form references are system-generated from a governed reference sequence/identity rule. Human-entered references are reserved for controlled migrations or exceptional recovery where explicitly authorised and audited.
5. Review-document preparation is an implementation detail. The platform should generate or materialise the current review artifact automatically or lazily when the merchant reaches the review step. The Merchant should not have to understand or trigger a technical **Prepare PDF** operation.
6. Executed-copy generation is likewise automatic after valid acceptance/confirmation. The merchant-facing action is to review/accept and later view/download the signed copy; storage, hashing, rendering, retries and artifact creation remain behind the scenes.
7. Package hashes, SHA values, deterministic fingerprints, storage paths, idempotency keys and server-rendering mechanics are internal integrity/audit evidence. They must not be primary merchant-facing UX. Expose them only in authorised diagnostic/audit views where they are genuinely useful.
8. Merchant-facing language must describe the business action: **Review agreement**, **Accept & Continue**, **Confirm Purchase**, **Signed agreement**, **Download copy**. Do not expose implementation vocabulary merely because the backend uses sophisticated evidence controls.
9. The system must be event-driven/reconcilable and idempotent. If an automatic step is interrupted, retry/reconciliation must complete or safely reuse the same governed evidence without creating duplicate Order Forms, packages, acceptances, notifications or entitlement effects.
10. Admin Web should operate an **exceptions and governance** model. Normal flow is monitored through status/coverage/reporting; Admin intervention is reserved for exceptions such as no current approved Master, no applicable published Order Form template, invalid commercial configuration, generation/storage failure, supersession conflict, unauthorised merchant signer or another explicit fail-closed state.
11. Exception states must be explicit and actionable, with enough evidence for recovery. They must not silently degrade into manual per-merchant processing as the default operating procedure.
12. Merchant notifications should be action-oriented and sparse. Notify when the merchant genuinely needs to review/accept or when an exception materially blocks progression; do not narrate internal workflow steps.
13. AI is not part of the legal authority and should not be visible as the explanation for ordinary deterministic agreement operations. SellerTray should feel like a coherent product, not a sequence of exposed automation or AI orchestration steps.
14. The normal happy path must remain viable at high concurrency without a ProcessEdge staff member in the loop. Scaling merchant volume should increase infrastructure workload, not proportionally increase agreement-administration headcount.

## Rendered Agreement Package documents and electronic signing

SellerTray may present the consolidated Agreement Package as a professionally branded PDF while keeping the underlying legal and commercial authorities separate.

The approved document/signing contract is:

> **Server-rendered PDF. Exact package fingerprint. Authenticated typed signature. Immutable executed copy.**

Rules:

1. The Agreement Package PDF is a rendered evidence artifact, not a second legal/commercial source of truth. The authoritative facts remain the immutable Master Agreement version, exact Order Form, governed commercial snapshot, hashes, package manifest/fingerprint and authenticated acceptance/confirmation records.
2. Merchant Web is the primary authenticated review/signing surface. The Merchant must review the exact current package before the electronic signing action is enabled.
3. The signing command must bind the exact reviewed Agreement Package ID and package fingerprint. If the current required Master Agreement changes after review, signing fails closed and the Merchant must review the new package.
4. A first purchase or required new Master version may use **Accept & Continue**. A later purchase under an already accepted unchanged Master uses **Confirm Purchase** for the exact new Order Form without manufacturing another Master acceptance. Internal evidence may still represent an electronic signature/confirmation even when the merchant-facing label stays simple.
5. The default electronic signature evidence is the authenticated SellerTray identity, authorised merchant role/capability, typed legal name or governed profile legal-name confirmation, exact hashes/fingerprint, idempotency command, request evidence and server timestamps. A decorative signature-style rendering may appear on the executed PDF but is not itself the security authority.
6. After the required Master acceptance and Order Form confirmation exist, SellerTray automatically generates/reuses an immutable **Executed Agreement Package PDF** containing an electronic execution certificate and verification reference.
7. Review and executed PDF bytes are generated server-side and retained in private storage with immutable metadata including PDF SHA-256. Browser-generated canonical agreement PDFs are prohibited.
8. Admin may retrieve the same governed review/executed artifacts for authorised review, but Admin cannot sign, accept or manufacture merchant acceptance on the merchant's behalf.
9. Mobile may surface governed agreement-required notifications or a secure handoff to Merchant Web, but it does not become an independent signing authority. WhatsApp and AI likewise cannot accept on behalf of the Merchant.
10. Agreement review/signing is not an authoritative offline write. If the server cannot verify the exact required package and merchant authority, signing fails closed.

### Admin Add New publication path

The redesigned Admin **Agreements → Add New** view supports two governed ways to create a new universal Master Agreement version:

- **Upload reviewed PDF**; or
- **Paste reviewed legal content**.

The upload path does not bypass publication governance.

1. Upload is for a new immutable version only. A PDF must not be attached later to rewrite or embellish an already-published version.
2. The uploaded reviewed PDF is retained as private immutable source evidence and receives its own SHA-256, byte-size and page-count evidence.
3. SellerTray extracts accessible legal text server-side from a text-based PDF so the existing content-body/hash, search/accessibility and legal-version contracts remain inspectable. Scanned-image-only PDFs fail closed unless a later approved OCR/document-ingestion design is introduced.
4. The exact uploaded PDF hash is included in the Master component of newly-created Agreement Package manifests/fingerprints for that version.
5. Publication still requires the same version code, title, effective date/time, publication reason, `admin.agreements.publish` capability, AAL2/MFA transport gate and immutable ProcessEdge audit.
6. Uploaded source PDFs remain private. Merchant-specific review/executed packages are generated separately from governed package evidence; arbitrary uploaded files never become merchant acceptance truth merely because they were uploaded.
7. Publication retry must be idempotent. Reusing the same publication command for different PDF/version facts fails closed.

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
- Creating/materially replacing a current-path commercial order automatically creates/reuses its governed Order Form and Agreement Package evidence from the applicable published template and server-derived commercial snapshot; this is not a per-merchant Admin issuance task.
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
- upload the reviewed PDF for a new immutable universal version through the redesigned Add New tab;
- publish/version governed Order Form templates that the shared core applies automatically;
- inspect Business acceptance status/history when a Merchant context is selected;
- audit who published and who accepted each version;
- inspect automatically generated commercial instruments associated with consolidated acceptance where authorised;
- review agreement/package exception queues and perform explicit governed recovery where an automatic process has failed;
- retrieve the same governed Agreement Package review/executed PDFs available to the Merchant.

ProcessEdge Admin must not:

- create a bespoke universal Master Agreement version for a selected merchant merely to represent commercial particulars;
- replace the universal Master Agreement for only one merchant;
- edit published content in place;
- attach a new source PDF to rewrite an already-published version;
- mark acceptance on behalf of a merchant by direct database write;
- manually issue routine per-merchant Order Forms as the normal happy path;
- type routine Order Form references, choose routine templates per merchant or prepare routine package PDFs one merchant at a time.

Use a semantic publication capability such as `admin.agreements.publish`; read authority remains separately governed. Any manual recovery capability must be exceptional, capability-gated, reasoned, audited and idempotent.

## Merchant Web

Merchant Web provides a simple consolidated legal/commercial acceptance experience rather than a multi-agreement checklist or a technical evidence console.

It may show:

- a concise purchase/agreement summary;
- current effective Master Agreement version where useful to the merchant;
- exact incorporated legal content and Schedules through a normal **Review agreement** experience;
- applicable Merchant Order Form/commercial particulars where part of the current transaction;
- whether this Business has accepted the current required Master Agreement version;
- accepted-by/accepted-at evidence where applicable;
- version/history where useful;
- the professional branded agreement document;
- the executed/signed copy after completion;
- one affirmative acceptance action when acceptance is required and the signed-in user has authority.

The normal Merchant UI must not require or prominently expose package fingerprints, content hashes, SHA-256 values, storage mechanics, idempotency keys, package-generation terminology or other implementation evidence. Those facts remain available to authorised diagnostics/audit when needed.

Do not require a Merchant to separately accept every incorporated Schedule. Do not create a new universal Master Agreement version merely because an Order Form changes. Do not make the Merchant click a technical **Prepare Agreement PDF** action before review; the platform prepares the appropriate document under the hood.

## Legacy C1A order-bound agreements

The existing `sellertray_commercial_agreements` and `sellertray_commercial_agreement_acceptances` records are legacy historical evidence from the earlier C1A design.

They must remain immutable and readable for audit/history, but they are not current universal Master Agreement authority and must not be used as the sole proof of current Master Agreement acceptance for new SellerTray service delivery.

Current-path code must not create merchant-specific copies/versions of the universal Master Agreement. Legacy issue/accept commands should fail closed or be retired while preserving historical reads. This does not prohibit governed Merchant Order Forms or consolidated acceptance evidence under the approved model.

## Cross-surface effects

- **Shared Core:** owns version resolution, automatic Order Form/package instantiation, immutable Business/version Master Agreement acceptance, commercial-instrument association, document hashes/artifacts, reconciliation/retry and service-delivery checks.
- **Merchant Web:** provides the simple governed review/accept/confirm experience and signed-copy retrieval while hiding technical evidence mechanics from the normal UI.
- **Admin Web:** publishes universal legal versions and reusable Order Form templates, monitors coverage/exceptions and performs explicit recovery only when necessary; it does not create merchant-specific Master Agreement variants, routine per-merchant Order Forms or merchant acceptance.
- **Mobile:** surfaces the governed agreement-required lifecycle notification where applicable and may hand off to Merchant Web, but it does not render canonical agreement PDFs or create acceptance truth.
- **WhatsApp:** may notify or deep-link a merchant to the governed acceptance surface; WhatsApp chat text is not acceptance truth unless a later explicitly approved authenticated signing flow is designed.
- **AI:** may explain status/terms from the governed version but cannot accept on behalf of a merchant and must not become visible orchestration for deterministic agreement lifecycle work.
- **Reporting/audit:** version publication, automatic package lifecycle, source-document hash, Business acceptance, applicable commercial association, exception/recovery activity and rendered artifact evidence are auditable immutable facts.
- **Offline:** agreement review/acceptance is not an offline authoritative write; service-delivery reconciliation fails closed until the server has the required acceptance fact.

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
20. cross-tenant and capability boundaries are enforced;
21. Admin Add New PDF upload creates a new immutable version and cannot attach/overwrite an existing version;
22. uploaded PDF SHA-256, page count, size and publication command are immutable and audited;
23. text-based PDF extraction fails closed for invalid/scanned-only/unreasonably large documents;
24. the exact uploaded Master PDF hash participates in newly-created Agreement Package fingerprints;
25. review PDF generation is server-owned and private;
26. signing is impossible until the exact current package is reviewed and the expected package ID/fingerprint match internally;
27. executed PDF generation requires the applicable Master acceptance and Order Form confirmation evidence;
28. Admin and Merchant retrieve the same governed package artifacts without Admin acquiring merchant signing authority;
29. Mobile notification behavior remains consistent with the shared agreement lifecycle and does not create separate signing truth;
30. creating a qualifying commercial order automatically creates/reuses the exact Order Form/package without Admin intervention;
31. routine Order Form reference/template selection is automatic and deterministic from governed configuration;
32. interrupted automatic package creation is retry/reconciliation safe and duplicate-free;
33. merchant happy-path UI does not expose hashes/fingerprints/storage/idempotency mechanics;
34. review/executed document generation requires no routine per-merchant Admin action;
35. genuine automatic-processing failures enter a bounded Admin exception/recovery queue rather than silently becoming manual happy-path work;
36. high-volume concurrent merchant creation does not require proportional ProcessEdge agreement-administration actions.

## Precedence

This file records the latest explicit product decisions and therefore controls wherever older `COMMERCIAL.md`, `COMMERCIAL_C1.md`, `COMMERCIAL_V2.md`, `ONBOARDING_ACTIVATION.md`, Admin agreement wording, migrations or implementation comments conflict with:

- the universal Master Agreement authority;
- the consolidated one-review/one-acceptance Merchant UX;
- the scalable zero-touch agreement operating model;
- automatic server-owned Order Form/package instantiation and exception-only Admin intervention;
- professional server-rendered PDF/electronic-signing evidence kept behind simple merchant-facing actions;
- the Admin Add New reviewed-PDF publication path;
- the distinction between universal legal version identity and Merchant-specific commercial facts;
- the approved v0.9 baseline and its later-version rule.

## Production legal-content gate for the v0.9 lineage

This section records the later ProcessEdge decision on how the v0.9 drafting baseline may progress to production and controls any earlier wording in this file that could be read more broadly.

1. **v0.9 is an approved drafting baseline, not merchant-publishable text.** The retained source is expressly labelled **CONSOLIDATED COUNSEL REVIEW COPY v0.9**, **External Legal Review Draft** and **NOT FOR MERCHANT ACCEPTANCE**. It remains drafting/audit evidence and must not be uploaded or pasted verbatim as a production Master Agreement.
2. ProcessEdge's decision to proceed **without waiting for external counsel review** removes external counsel as a mandatory product-governance dependency. It does **not** waive internal legal/commercial reconciliation, final text approval, statutory compliance, versioning, production QA or the explicit publication authority required by SellerTray.
3. A merchant-facing production version must remove or resolve counsel-review-only material, including the review notice, counsel issue register, `subject to counsel review`, `final counsel-approved`, `counsel confirmation`, `counsel must validate` and equivalent placeholders or instructions.
4. Material reconciliation of those clauses creates a **new immutable production version code**. Do not silently rewrite v0.9, reuse its version identity for materially changed merchant terms, or destroy the v0.9 review copy. Historical drafting evidence remains preserved.
5. Before `admin.agreements.publish` or `admin_publish_pdf` may publish a production Master, ProcessEdge must explicitly approve the **exact final merchant-facing text/version**. Approval of the v0.9 commercial positions or the decision not to wait for external counsel is not by itself approval to publish a specific final legal document.
6. The approved commercial/product positions already recorded in this file remain the starting constraints for reconciliation. They must not be weakened merely to remove review placeholders: the 30-day Guarantee from Activation Date, qualifying initial-purchase scope, no defect requirement for an eligible suitability claim, no deduction for reasonable included usage, required ProcessEdge-supplied Equipment returned in Good Condition, refund-initiation timing and return-transport allocation remain governed decisions unless ProcessEdge expressly changes them.
7. Final drafting must preserve mandatory/non-waivable rights. Contract terms must not purport to exclude rights or liabilities that applicable law does not permit the parties to exclude, and any material limitation/indemnity/renewal term that applicable law requires to be specifically disclosed must be presented accordingly.
8. The following v0.9 review-register matters are **not authorised to be invented by an implementation agent** merely to unblock publication: liability carve-outs; indemnity scope/procedure; Equipment title/risk/warranty allocation; formal notice methods; or another material legal/commercial choice for which ProcessEdge has not made an explicit decision.
9. Other review-register matters may be reconciled from current law and approved architecture where they do not create a new commercial bargain, but they still require exact-text ProcessEdge approval before publication. This includes data-processing mechanics, statutory electronic-record language, international-transfer safeguards, security-incident obligations, current tax-law references and AI/data-protection compliance language.
10. The production legal-content gate is separate from technical readiness. Green CI, a working signing flow, a rendered PDF, a TEST acceptance, payment, setup or entitlement evidence can never turn review-draft text into approved production legal authority.
11. No QA, placeholder, counsel-review or `NOT FOR MERCHANT ACCEPTANCE` document may become the current production Master Agreement. If such content is ever published accidentally, the governed immutable quarantine/correction path must be used; do not rewrite or delete historical evidence.
12. Once ProcessEdge approves a reconciled production version, publish it through the same universal immutable Master authority described above. Later material changes create later versions and follow notice/re-acceptance governance rather than silent editing.
