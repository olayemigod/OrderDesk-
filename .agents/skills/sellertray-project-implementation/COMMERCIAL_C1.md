---
name: sellertray-commercial-c1-boundary
description: "Normative C1 boundary for the additive SellerTray commercial-core foundation and its transition from the legacy trial subscription authority."
metadata:
  author: ProcessEdge Solutions Limited
  product: SellerTray
  version: "0.1.2"
  status: governing-extension
---

# SellerTray C1 Commercial-Core Boundary

This file is a normative C1-specific extension of `COMMERCIAL.md` and `.agents/skills/sellertray-project-implementation/SKILL.md`.

It records the later approved implementation decision for the C1/C1A/C1B/C2 boundary. Where the older implementation-sequence wording in `COMMERCIAL.md` is broader, this file controls the C1 boundary until the sequence is folded back into that document.

## C1 is additive

C1 establishes governed commercial records without changing existing runtime subscription behaviour.

The legacy runtime authority remains `public.tenant_subscriptions` during C1. The existing `public.subscription_plans` identity is the compatibility bridge for C1 plan pricing; C1 must not introduce a second subscription table or a competing runtime entitlement source.

C1 may add:

- effective-dated, immutable commercial price versions linked to the existing plan identity;
- commercial orders with immutable price/tax snapshots, including subscription and Branch-setup lines;
- installment payment-obligation and schedule records for the approved 70:30 and 60:20:20 structures;
- append-only, retry-idempotent entitlement-event records that do **not** themselves mutate legacy runtime access;
- RLS, least-privilege grants and integrity/audit contracts required by those records.

C1 must not:

- migrate, remove, extend or reinterpret the legacy trial runtime authority;
- make entitlement active because an installment obligation or schedule exists;
- treat a payment obligation as payment confirmation;
- treat a payment record as agreement acceptance;
- treat agreement acceptance as payment confirmation;
- let an entitlement event directly or implicitly update `tenant_subscriptions` during C1;
- hard-code unapproved plan prices, installment due dates, refund rules or equipment-ownership terms.

The accounting/authority distinction is mandatory:

> Payment obligation, payment confirmation, agreement acceptance, and subscription entitlement are separate authorities.

## C1A — Agreement and acceptance

C1A follows C1 and owns versioned terms/templates, merchant-specific agreement snapshots, acceptance evidence, immutable accepted agreements and amendment/replacement history.

No installment subscription may activate before the required C1A agreement has been accepted by an authorised merchant representative and the qualifying payment has been confirmed.

### C1A implementation contract

C1A is additive and must not replace or reinterpret the existing user-level Terms/Privacy consent ledger. `public.user_legal_acceptances` remains the separate evidence that an individual user accepted SellerTray Terms/Privacy versions; it is not Business-specific commercial-contract truth and must not be reused as such.

C1A commercial agreement truth is governed through dedicated service-authority persistence:

- immutable versioned agreement templates;
- immutable Business-specific agreement snapshots linked to the governed C1 commercial order and, where applicable, its installment obligation;
- server-computed SHA-256 integrity evidence for both template content and the rendered Business agreement;
- immutable acceptance evidence linked to the exact agreement/template hashes, accepting user, accepted legal name, accepted authority, timestamp and available request evidence;
- explicit supersession/replacement links rather than mutation of an issued or accepted agreement;
- retry-safe agreement issuance keyed by governed agreement reference and retry-safe acceptance keyed by command identity.

Agreement templates and Business agreement snapshots are platform/commercial-management authority. They are not authored or mutated directly by Merchant Web or Mobile clients. The migration must not seed or invent legal wording, prices, due dates, refund terms, equipment-ownership clauses or other unapproved commercial language.

Merchant signing authority is stricter than ordinary operational Manager access:

- a Business Owner is always authorised to accept a current SellerTray commercial agreement for that Business;
- a Manager is **not** authorised by role alone and must hold the explicit `can_accept_commercial_agreements` capability;
- only the Business Owner may grant or revoke `can_accept_commercial_agreements`, and it may only be delegated to a Manager;
- Staff/Cashiers can never accept SellerTray commercial agreements;
- demoting a Manager to Staff/Cashier or removing the Manager from the Business must revoke any active `can_accept_commercial_agreements` delegation and audit that revocation;
- later re-promotion or re-addition as a Manager must **not** reactivate an earlier signing delegation; the Owner must grant it again explicitly;
- Merchant Web Team & Permissions may expose this authority only as an Owner-controlled Manager permission and must not imply that standard Manager permissions include contract signing.

Acceptance of an agreement does not confirm a payment and does not activate, extend or release subscription entitlement. C1A must not mutate `public.tenant_subscriptions` or treat acceptance as a payment fact.

`sellertray_installment_agreement_is_accepted(...)` is a governed prerequisite fact for C1B only. It may report whether the **current, non-superseded** installment agreement has immutable acceptance evidence; it must not itself perform payment qualification, entitlement activation, due-state changes or runtime access mutation.

When an agreement is superseded, the earlier immutable agreement and acceptance remain historical evidence, but downstream commercial activation must fail closed until the replacement agreement is accepted where acceptance is required.

## C1B — Installment activation and entitlement release

The installment obligation/schedule **data foundation** is already established in C1. C1B, after C1A, adds governed payment qualification, provisional entitlement, full-settlement entitlement release, due/past-due lifecycle and retry-safe runtime effects.

C1B must consume the C1 schedule facts and C1A acceptance facts rather than recreating either truth.

## C2 — retire trial semantics

C2 performs the deliberate migration/cutover from the legacy trial-oriented runtime model to the governed commercial/activation/guarantee/entitlement model. Only C2 may remove or replace the old trial semantics after data/API compatibility is proven.

Until that cutover is complete, new commercial records are additive foundations and must not silently become a parallel access-control engine.
