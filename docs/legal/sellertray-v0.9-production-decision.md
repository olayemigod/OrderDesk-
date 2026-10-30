# SellerTray Master Agreement v0.9 — Production Decision

Status: **ProcessEdge-approved product/legal-governance decision**  
Decision date: **2026-10-28**  
Applies to: **OA5C / PR #150 and later SellerTray agreement administration**

## Decision

ProcessEdge has approved **SellerTray Master Services and Subscription Agreement v0.9** for use as the initial production Master Agreement version.

A new production version code is **not required merely to move SellerTray into production**.

The existing SellerTray Admin agreement-versioning architecture already supports publication of a later immutable Master Agreement version when ProcessEdge chooses to revise the agreement. That later publication must use the existing governed **Agreements → Add New** / Master publication authority and does not require a SellerTray code change merely because the legal text or version number changes.

## Production treatment of v0.9

1. Version code **v0.9** may be the first effective production Master Agreement version.
2. The substantive commercial/product positions already approved in v0.9 remain the initial production terms unless ProcessEdge expressly changes them.
3. The retained counsel-review DOCX/PDF remains drafting/audit evidence. A merchant-facing production artifact may remove review-document presentation markings such as **External Legal Review Draft**, **NOT FOR MERCHANT ACCEPTANCE**, counsel-review cover/footer wording, the counsel issue register and the internal production-gate checklist without changing the substantive v0.9 bargain.
4. Removing those review-only presentation elements before the first valid production publication does not require a new version code because v0.9 has not yet become an immutable production publication/acceptance record.
5. Do not silently rewrite substantive liability, indemnity, equipment, guarantee, pricing, entitlement, data, renewal, dispute or other commercial/legal terms under the guise of presentation cleanup. A later material change after v0.9 publication is a new immutable version.
6. ProcessEdge approval of v0.9 is sufficient product-governance authority to prepare it for governed production publication. External counsel approval is not a mandatory SellerTray deployment dependency.
7. Publication still requires the existing technical controls: authenticated ProcessEdge Admin authority, `admin.agreements.publish`, AAL2/MFA where required, exact content/source evidence, content hash, effective timestamp, immutable audit and successful production QA.
8. Merchant acceptance remains Business/version-scoped. A Business accepts v0.9 once; a later commercial order under unchanged v0.9 does not create another Master acceptance.
9. If ProcessEdge later publishes v1.0, v0.10 or another version, Admin creates a new immutable version through the existing publication workflow. Existing v0.9 acceptance/history remains immutable.
10. Whether a later version requires merchant re-acceptance follows the governed change/re-acceptance rules; version publication itself must not rewrite historical acceptance evidence.

## Effect on OA5C

The production legal blocker is narrowed from **“create and approve a new reconciled production version”** to:

> **prepare and publish the approved v0.9 production artifact through the governed production publication path, then obtain genuine merchant acceptance as part of the controlled OA5C lifecycle proof.**

OA5C remains blocked until the production Master is actually published and the designated real merchant completes the genuine governed lifecycle. This decision does not manufacture acceptance, payment, setup/readiness or entitlement evidence.

## No-code later versioning rule

SellerTray must remain content/version agnostic. Agreement version changes are Admin-managed legal configuration, not application releases.

A later Master Agreement version must therefore normally require:

- new version code;
- exact new content or reviewed PDF;
- effective date/time;
- publication reason;
- governed Admin publication;
- appropriate merchant notice/re-acceptance where required;

but **no code change solely because a new legal version exists**.
