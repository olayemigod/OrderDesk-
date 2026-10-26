---
name: sellertray-commercial-c1-boundary
description: "Normative C1 boundary for the additive SellerTray commercial-core foundation and its transition from the legacy trial subscription authority."
metadata:
  author: ProcessEdge Solutions Limited
  product: SellerTray
  version: "0.1.9"
  status: governing-extension
---

# SellerTray C1 Commercial-Core Boundary

This file is a normative C1-specific extension of `COMMERCIAL.md` and `.agents/skills/sellertray-project-implementation/SKILL.md`.

It records the later approved implementation decision for the C1/C1A/C1B/C2 boundary. Where the older implementation-sequence wording in `COMMERCIAL.md` is broader, this file controls the C1 boundary until the sequence is folded back into that document.

## C1 is additive

C1 establishes governed commercial records without changing existing runtime subscription behaviour during the C1 foundation/C1A stages. The later C1B reconciliation exception is defined explicitly below and is the only approved pre-C2 path that may update the compatibility runtime row after all governed activation prerequisites are satisfied.

The legacy runtime authority remains `public.tenant_subscriptions` during C1. The existing `public.subscription_plans` identity is the compatibility bridge for C1 plan pricing; C1 must not introduce a second subscription table or a competing runtime entitlement source.

C1 may add:

- effective-dated, immutable commercial price versions linked to the existing plan identity;
- commercial orders with immutable price/tax snapshots, including subscription and Branch-setup lines;
- installment payment-obligation and schedule records for the approved 70:30 and 60:20:20 structures;
- append-only, retry-idempotent entitlement-event records that do **not** themselves mutate legacy runtime access;
- RLS, least-privilege grants and integrity/audit contracts required by those records.

C1 must not:

- migrate, remove, extend or reinterpret the legacy trial runtime authority outside the explicitly governed C1B reconciliation path below;
- make entitlement active because an installment obligation or schedule exists;
- treat a payment obligation as payment confirmation;
- treat a payment record as agreement acceptance;
- treat agreement acceptance as payment confirmation;
- let an entitlement event directly or implicitly update `tenant_subscriptions` during the C1 foundation/C1A stages; C1B reconciliation may update the compatibility row only under its later contract below;
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

The later approved active contracting architecture is **Master Agreement -> Order Form -> Agreement Package Manifest**:

- the versioned Master Agreement contains reusable service terms and is accepted once per Business per exact Master version;
- every governed commercial order has its own immutable Order Form and exact confirmation evidence;
- the server creates or reuses a deterministic immutable package manifest whose SHA-256 fingerprint binds the exact Master version/hash and Order Form/hash;
- a second purchase under an unchanged Master Agreement reuses the earlier Master acceptance and records only the new Order Form confirmation;
- Merchant Web presents **Accept & Continue** only when the current Master still requires acceptance, otherwise **Confirm Purchase**;
- the consolidated server command must preserve one retry command identity, create/reuse the package, accept the Master only when required, and confirm the exact Order Form;
- all earlier commercial agreement/template/acceptance rows remain unchanged as legacy evidence and continue through an explicit compatibility predicate rather than destructive backfill.

Master acceptance, Order Form confirmation, payment confirmation, setup readiness and entitlement remain separate authorities. Neither the package command nor either contractual evidence record may directly mutate runtime entitlement.

When an agreement is superseded, the earlier immutable agreement and acceptance remain historical evidence, but downstream commercial activation must fail closed until the replacement agreement is accepted where acceptance is required.

## C1B — Installment activation and entitlement release

The installment obligation/schedule **data foundation** is already established in C1. C1B, after C1A, adds governed payment qualification, provisional entitlement, full-settlement entitlement release, due/past-due lifecycle and retry-safe runtime effects.

C1B must consume the C1 schedule facts and C1A acceptance facts rather than recreating either truth.

### C1B implementation contract

C1B continues to use the existing SellerTray billing-provider authority. It must not introduce a separate payment engine or a second provider webhook truth.

- `billing_checkout_sessions` remains the governed checkout-session authority and may distinguish legacy subscription checkout from installment checkout.
- installment checkout amount, currency, plan identity, commercial order, obligation and schedule identity must come from immutable C1 server-side facts; Merchant Web may send only the governed installment identity and retry command identity.
- installment checkout is available only for the Business's **initial annual subscription purchase**. The shared checkout boundary must prove the commercial order is the earliest unambiguous subscription order for that Business and fail closed on an earlier or equal-time competing subscription order. A legacy/non-trial Business cannot start a new initial-purchase installment merely by creating another annual commercial order. After C1B activates the original initial-purchase order, later schedule lines on that **same** order remain eligible when same-order entitlement history proves C1B runtime ownership.
- Paystack installment collection is a one-time transaction for the exact governed installment amount. It must not create or depend on a parallel Paystack subscription plan for that installment.
- the existing verified Paystack webhook is the provider-confirmation authority. A verified installment `charge.success` records an immutable payment-confirmation fact first and only then attempts entitlement reconciliation as a separate transaction.
- a reconciliation conflict or runtime-compatibility issue must never roll back or erase an already confirmed provider payment.
- an installment provider event must not be marked processed after payment confirmation until its entitlement reconciliation succeeds. If reconciliation fails after the payment fact commits, the webhook must remain retryable; the provider retry must replay the same immutable payment confirmation idempotently and retry reconciliation rather than creating another payment.
- immutable installment payment time must come from deterministic verified provider event data. C1B must not substitute the webhook-processing wall clock when provider payment time is absent or invalid.
- each installment schedule line may have at most one confirmed payment. Provider reference, provider transaction identity and verified event fingerprint must remain duplicate-safe.
- later installment checkout must fail closed until all earlier installment schedule lines are confirmed paid.
- checkout command identity must survive ordinary retries/reloads and ambiguous in-flight provider attempts. If provider initialization is explicitly recorded `failed`, that provider reference is a terminal attempt and must **not** be initialized again; Merchant Web must retire that failed command and create a new command/reference only on the Owner's next explicit payment attempt.
- before the outbound Paystack initialization request, C1B must persist a service-authority initialization-start fact/lease on the governed checkout session. A process crash, transport error, lost response or other ambiguous outcome after that point must keep the same command/reference in `preparing` state and must not be converted into `failed` merely because a replay cannot prove whether Paystack accepted the original request. Only an explicit provider failure observed for that leased attempt may retire it as `failed`; an ambiguous `preparing` attempt remains confirmable by the verified Paystack webhook if payment is later received.

C1B activation has four distinct prerequisites that may commit independently and in any order:

1. the immutable C1 commercial order/installment schedule exists;
2. the **current, non-superseded** C1A installment agreement is accepted by an authorised merchant representative;
3. every Branch-setup line in the commercial order has an immutable platform-recorded setup-readiness fact;
4. the qualifying installment payment is provider-confirmed.

A Branch record being created or active is not setup readiness. Setup readiness is a separate commercial fact tied to the exact Branch-setup purchase line. Platform Admin is the authority that records it. C1B must not invent equipment serials, handover wording, inspection results or guarantee facts that have not yet been governed separately.

If the commercial order contains no governed Branch-setup line, first activation fails closed as `pending_setup`; C1B must not silently assume setup is complete.

The approved entitlement arithmetic is fixed:

- `two_installment_70_30`: confirmed first 70% payment + current accepted agreement + required setup readiness releases exactly **2 months** of provisional entitlement;
- `three_installment_60_20_20`: confirmed first 60% payment + current accepted agreement + required setup readiness releases exactly **3 months** of provisional entitlement;
- full settlement releases the remaining entitlement so the **total subscription term is exactly 12 months from the original activation timestamp**;
- later payment dates do not move the original activation timestamp and do not create a new 12-month period;
- if a provisional entitlement already exists, later agreement replacement/reacceptance may satisfy current-agreement requirements for downstream release but must not shift the original activation timestamp.

Entitlement effects are append-only and retry-idempotent. C1B records a deterministic provisional event and, after complete settlement, a deterministic full-release event. Reconciliation retries must return the same commercial effect rather than extend the term again.

Prerequisite persistence and entitlement reconciliation remain separate. Tenant-wide reconciliation must isolate failures per installment obligation so one conflicting historical order cannot block a later valid order. Service surfaces may retry reconciliation idempotently after an authorised Merchant or Admin/Support billing read succeeds, providing recovery when an earlier acceptance/setup-triggered pass failed after the immutable prerequisite had already committed. Such recovery must not make read authorization optional, must not recreate payment/agreement/setup truth, and must report/log unresolved per-obligation failures rather than silently treating them as success.

`public.tenant_subscriptions` remains the runtime compatibility authority until C2. C1B may update that compatibility row only after governed reconciliation, and must fail closed rather than overwrite a populated runtime period that is not provably owned by the same C1B commercial order.

A pre-C2 trial compatibility row may still carry a legacy runtime `plan_code` that differs from the active governed plan selected for the first commercial purchase. Initial-purchase eligibility is determined by the governed trial compatibility state plus the selected active plan and immutable commercial order facts; it must not require the stale legacy plan code to equal the newly purchased plan. Before C1B reconciliation, the legacy compatibility `plan_code` must remain unchanged. Once the current agreement is accepted, required Branch setup is ready, the qualifying provider payment is confirmed, and reconciliation succeeds, C1B must set `tenant_subscriptions.plan_code` to the plan snapshotted on the governed commercial order while releasing the corresponding provisional/full entitlement. This is the approved compatibility transition, not a C2 cutover and not a second subscription truth.

Legacy active subscriptions keep their existing runtime semantics. For a runtime period that is provably backed by a C1B provisional or full entitlement event, the recorded `current_period_end` is an actual entitlement boundary: write access becomes read-only after that end time even if the compatibility row still says `active`. This prevents a 2- or 3-month provisional entitlement from becoming indefinitely active while preserving the pre-C1B legacy model until C2.

Exact installment due dates, grace duration, late-payment penalties and automated suspension timing are **not yet approved**. Therefore:

- C1B must not invent installment `due_at` values;
- known `due_at` values may be reported as scheduled/past-due facts;
- due-date enforcement remains informational until a later explicit policy decision;
- expiry of an already-granted provisional/full entitlement is still enforced because that entitlement end is an approved commercial boundary, not an invented grace rule;
- billing/agreement/recovery access must remain available while operational write access is read-only.

Merchant Web is the management surface for C1B billing state. Owners may start the next eligible installment payment. Managers may review installment status but do not inherit Owner billing authority. Checkout command identity must survive retries/reloads so the browser cannot create duplicate commercial payment intent.

### Controlled first-merchant acceptance boundary before C2

C1B production deployment alone is not evidence that the legacy runtime model is safe to retire. Before C2 begins, at least one controlled real Business lifecycle must prove the complete governed path without bypassing any authority.

For that acceptance pass, Platform Admin may operate the existing C1/C1A/C1B core through a service-authoritative Admin workflow that:

- publishes effective-dated VAT-inclusive monthly subscription pricing and derives the yearly 10-for-12 price server-side;
- publishes Branch setup pricing as a separate governed price source;
- creates exactly one initial annual installment purchase for the selected active Branches from the effective governed prices, with the approved 70:30 or 60:20:20 schedule and **no invented due dates**;
- publishes immutable versioned agreement templates and issues the Business agreement through the existing C1A issuance authority;
- requires a Platform Admin reason and writes the existing Platform Admin audit trail for each privileged commercial creation action;
- gives Platform Support read/review access only, not commercial mutation authority.

The Admin browser may select Business, Branches, approved structure and legal/template content, but it must not author price snapshots, installment amounts, tax arithmetic or canonical commercial agreement facts. Those are computed or snapshotted by the shared service/database authority.

The acceptance bridge must be retry-safe. An immutable commercial order reference is the command identity for initial-purchase creation; replay may return the same governed order only when the commercial subject is identical, and must fail closed on conflicting facts. A Business that already has a governed initial subscription order must not receive a second initial-purchase order through this bridge.

Creating the order/agreement does not activate subscription entitlement. The real acceptance sequence remains: governed commercial order/agreement → authorised Merchant agreement acceptance → governed Branch setup readiness → verified provider payment → reconciliation → provisional entitlement → later full settlement/full entitlement.

No synthetic commercial order, fake provider payment, or manual entitlement mutation is required merely to generate evidence. C2 assessment begins only after a controlled real Business completes the governed lifecycle and the compatibility/runtime effects are verified.

## C2 — retire trial semantics

C2 performs the deliberate migration/cutover from the legacy trial-oriented runtime model to the governed commercial/activation/guarantee/entitlement model. Only C2 may remove or replace the old trial semantics after data/API compatibility is proven.

Until that cutover is complete, new commercial records are additive foundations and must not silently become a parallel access-control engine.
