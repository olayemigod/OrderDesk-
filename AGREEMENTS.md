# SellerTray Agreement Architecture

## Approved model

SellerTray commercial contracting uses three distinct, immutable layers:

> Master Agreement -> Order Form -> Agreement Package Manifest

The layers are related, but they are not interchangeable evidence.

### Master Agreement

The Master Agreement contains the reusable legal terms for the SellerTray service. It is a globally published, versioned document. A Business accepts the exact current Master Agreement version once. A later purchase under the same Master version must reuse that acceptance; it must not create another Master acceptance.

Publishing a materially changed Master Agreement creates a new immutable version. A Business must accept the new current version before confirming an Order Form governed by it. Historical versions and acceptances remain unchanged.

### Order Form

An Order Form is the immutable, Business-specific commercial schedule for exactly one governed commercial order. It snapshots the order, plan, billing cycle, Branch setup lines, price/tax facts, installment obligation and schedule, and the rendered purchase-specific content.

Every Order Form must be confirmed, even when the Business has already accepted the applicable Master Agreement. Confirmation is evidence that the authorised representative approved that exact purchase; it is not a second acceptance of unchanged general terms.

An Order Form is never edited in place. A correction creates a replacement Order Form with an explicit supersession link. The original form and any confirmation remain historical evidence.

### Agreement Package Manifest

The Agreement Package is deterministic evidence that binds:

- the exact Business and commercial order;
- the exact Master Agreement version and SHA-256 content hash;
- the exact Order Form and SHA-256 content hash; and
- the manifest schema version.

The server constructs a canonical JSON manifest and computes its SHA-256 fingerprint. The same Master/Order Form inputs must produce the same manifest and fingerprint. A retry reuses the existing package row; it never creates competing evidence for identical facts.

The package manifest and fingerprint are immutable. They prove the documents that formed the purchase package without rewriting either source document.

## Merchant action semantics

The active consolidated command performs these operations atomically and idempotently:

1. resolve the current Master Agreement;
2. verify that the selected Order Form is current and exact;
3. create or reuse the deterministic Agreement Package manifest;
4. create a Master acceptance only when this Business has not accepted that exact Master version; and
5. confirm the exact Order Form against that package.

Merchant Web presents **Accept & Continue** when step 4 is required. When the current Master is already accepted, it presents **Confirm Purchase**. Both actions confirm the exact Order Form.

Master acceptance, Order Form confirmation, setup readiness, payment confirmation and entitlement remain separate authorities. Neither acceptance nor confirmation proves payment or directly releases entitlement.

## Authority and idempotency

The existing commercial signing authority applies: the Business Owner is authorised; a Manager requires the explicit Owner-delegated `can_accept_commercial_agreements` capability; Cashiers cannot contract.

The browser supplies a stable command UUID for retry. Reusing a command UUID with the same facts returns the same evidence. Reusing it with different facts fails closed. Concurrent attempts are constrained so one Business has at most one acceptance for a Master version and one confirmation for an Order Form.

## Compatibility

All pre-existing rows in `sellertray_commercial_agreement_template_versions`, `sellertray_commercial_agreements`, and `sellertray_commercial_agreement_acceptances` remain unchanged. They continue to be readable as legacy agreement evidence and continue to satisfy the legacy C1B acceptance predicate for their existing installment orders.

New purchases use Master acceptance, immutable Order Form confirmation and package-manifest evidence. The C1B prerequisite accepts either the new package-confirmation path or the preserved legacy acceptance path; it does not rewrite or backfill historical records.
