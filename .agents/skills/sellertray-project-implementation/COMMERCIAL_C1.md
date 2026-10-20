---
name: sellertray-commercial-c1-boundary
description: "Normative C1 boundary for the additive SellerTray commercial-core foundation and its transition from the legacy trial subscription authority."
metadata:
  author: ProcessEdge Solutions Limited
  product: SellerTray
  version: "0.1.0"
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

## C1B — Installment activation and entitlement release

The installment obligation/schedule **data foundation** is already established in C1. C1B, after C1A, adds governed payment qualification, provisional entitlement, full-settlement entitlement release, due/past-due lifecycle and retry-safe runtime effects.

C1B must consume the C1 schedule facts and C1A acceptance facts rather than recreating either truth.

## C2 — retire trial semantics

C2 performs the deliberate migration/cutover from the legacy trial-oriented runtime model to the governed commercial/activation/guarantee/entitlement model. Only C2 may remove or replace the old trial semantics after data/API compatibility is proven.

Until that cutover is complete, new commercial records are additive foundations and must not silently become a parallel access-control engine.
