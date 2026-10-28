# OA5C Agreement Production Reconciliation — v0.9 Decision Addendum

Status: **Governing addendum to `docs/agreement-production-reconciliation-runbook.md`**  
Decision date: **2026-10-28**

This addendum records a later explicit ProcessEdge decision and therefore controls where the existing production-reconciliation runbook says that the v0.9 lineage cannot be the first production Master Agreement or that a new production version code is mandatory before publication.

## 1. Initial production Master Agreement

The initial production universal Master Agreement may be published as:

- **Version code:** `v0.9`
- **Agreement:** SellerTray Master Services and Subscription Agreement
- **Contracting entity:** ProcessEdge Solutions Limited
- **Product/service:** SellerTray

A different production version code is **not** an OA5C prerequisite.

## 2. Retained review source versus merchant-facing v0.9 artifact

The existing v0.9 counsel-review source remains immutable drafting/audit evidence.

For the first production publication, ProcessEdge may prepare the merchant-facing v0.9 artifact by removing review-document presentation matter that is not part of the substantive bargain, including:

- `External Legal Review Draft` status text;
- `NOT FOR MERCHANT ACCEPTANCE` labels;
- counsel-review-only headers/footers;
- the internal counsel issue register; and
- the internal production-gate checklist.

This does not require a new version code before first production publication because there is no valid production v0.9 acceptance history to rewrite.

Do not use this rule to silently alter substantive v0.9 commercial/legal terms.

## 3. Revised production publication gate

The production Master publication gate is now satisfied when all of the following are true:

1. the exact merchant-facing v0.9 artifact/text intended for publication is identified;
2. it preserves the approved v0.9 substantive terms unless ProcessEdge expressly changes them;
3. it contains no review-only presentation label that tells a merchant the document is not for acceptance;
4. ProcessEdge explicitly approves that exact v0.9 production artifact/text;
5. the production Admin actor has governed `admin.agreements.publish` authority and required AAL2/MFA;
6. exact content/source hash, version code, title, effective time and publication reason are captured immutably;
7. current LIVE project identity is reconfirmed before mutation; and
8. publication and subsequent acceptance are verified through the existing universal Master authority.

The gate no longer requires creation of `v1.0`, `v0.10` or another code merely because v0.9 originated as a review copy.

## 4. Later versions require no agreement-engine code change

After production v0.9 exists, Admin may publish a later immutable Master version through the existing governed Agreements publication workflow.

The runtime must remain generic with respect to legal version code/content. A later legal version does not require a code change solely because:

- the version number changed;
- the agreement text changed;
- the effective date changed; or
- a newer required version needs merchant acceptance/re-acceptance.

A code change is required only if ProcessEdge changes the **agreement architecture or product behavior**, not merely the governed legal configuration.

## 5. LIVE reconciliation sequence impact

The technical migration sequence in the main runbook is unchanged:

1. preserve/capture LIVE evidence;
2. deploy missing document authority;
3. deploy zero-touch orchestration;
4. deploy durable self-healing;
5. deploy forward package-aware activation convergence;
6. deploy the approved `master-agreements` function;
7. verify the reconciled authority;
8. publish the approved v0.9 production Master through governed Admin authority;
9. obtain genuine controlled merchant acceptance and continue OA5C lifecycle proof.

Do not publish a QA Master, do not reuse the quarantined QA publication, and do not manufacture merchant acceptance.

## 6. OA5C blocker after this decision

The legal/version blocker is no longer **“reconcile v0.9 into a newly numbered production agreement.”**

The remaining bounded blocker is:

> **prepare/approve the merchant-facing v0.9 production artifact, reconcile/deploy the missing LIVE agreement authority safely, publish v0.9 through governed Admin, then obtain genuine controlled real-merchant lifecycle evidence.**

C2 remains blocked until OA5C is accepted or a later explicit ProcessEdge decision changes that gate.
