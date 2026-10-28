# SellerTray Agreement v0.9 Production Authority

Status: **Normative extension of `SKILL.md` and later explicit ProcessEdge decision.**

This file records the 2026-10-28 ProcessEdge decision on the initial production Master Agreement version.

## Precedence

This decision is later than, and therefore overrides, any statement in `AGREEMENTS.md`, OA5C documentation, PR descriptions, implementation comments or earlier conversations that says:

- v0.9 is not merchant-publishable merely because its retained source was prepared as a counsel-review copy;
- SellerTray must create a different production version code before first production publication; or
- materially identical v0.9 terms must be renumbered solely to move into production.

All other universal-Master, immutable-history, acceptance, Order Form, Agreement Package and publication-governance rules remain in force.

## Governing decision

> **SellerTray Master Services and Subscription Agreement v0.9 may be used as the initial production Master Agreement version.**

A new version code is not required merely because SellerTray is moving from review/pre-production into production.

The existing Admin Master Agreement publication/versioning architecture is deliberately content/version agnostic. ProcessEdge may later create a new immutable agreement version through Admin without requiring a code change solely because the legal version or text changes.

## v0.9 production preparation

1. The substantive v0.9 commercial/product terms are approved for the initial production version unless ProcessEdge expressly changes them.
2. The retained counsel-review DOCX/PDF remains drafting/audit evidence.
3. Before first valid production publication, review-document presentation markings may be removed from the merchant-facing v0.9 artifact without changing the version identity, including:
   - `External Legal Review Draft`;
   - `NOT FOR MERCHANT ACCEPTANCE`;
   - counsel-review-only headers/footers;
   - the internal counsel issue register; and
   - the internal production-gate checklist.
4. That cleanup is final preparation of the first production v0.9 artifact, not mutation of an already-published production agreement, because no valid production v0.9 publication/acceptance history yet exists.
5. Do not silently change substantive v0.9 terms under the guise of cleanup. A later material legal/commercial change after v0.9 publication requires a new immutable version.
6. External counsel approval is not a mandatory SellerTray product-governance dependency for publishing the ProcessEdge-approved v0.9 version.
7. Publication still requires the governed Admin authority, exact source/content evidence, effective time, publication reason, AAL2/MFA where required, immutable audit and the applicable production QA.

## Later versions

After v0.9 is published, Admin may create v0.10, v1.0 or another later immutable version through the existing **Agreements → Add New** publication workflow.

A later version normally changes configuration/evidence, not application code. It must not require a code release solely because:

- the version code changed;
- the legal text changed;
- the effective date changed; or
- merchants need to accept a later required version.

The existing runtime must resolve the current effective version generically.

Later publication must preserve:

- immutable v0.9 content and acceptance evidence;
- new-version content/hash/source evidence;
- effective timestamp and publication audit;
- governed re-acceptance behavior where required; and
- no retroactive rewrite of already-earned entitlement/history.

## OA5C effect

The remaining production legal-content step is now:

> **prepare the approved merchant-facing v0.9 artifact, publish v0.9 through governed production Admin authority, and then use genuine v0.9 merchant acceptance in the controlled OA5C lifecycle proof.**

Do not block OA5C on inventing a new production version code.

This decision does not relax the independent OA5C requirements for genuine settlement, setup/handover, Branch readiness, entitlement reconciliation, cross-surface parity or replay/idempotency evidence.
