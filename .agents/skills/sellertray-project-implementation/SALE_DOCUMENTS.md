# SellerTray Sale Documents, Payment Receipts and Status Presentation

This file is a normative extension of `.agents/skills/sellertray-project-implementation/SKILL.md` for any task touching sale/invoice printing, payment receipts, partial payment, Pay Later, later receivable collection, payment/fulfilment status presentation, sale-history printing, or offline replay of unsettled POS sales.

A later explicit user decision recorded here controls where older receipt wording or implementation conflicts with these rules.

## Governing distinction

A **Sales Invoice** is the commercial document for the sale. A **Payment Receipt** is evidence of confirmed money received. They are not interchangeable.

The original sale document must not change identity merely because payment is later collected.

## Required behaviour

1. A completed POS sale with `Partial` or `Pay Later` terms prints/reprints as **Sales Invoice**, never as a false Payment Receipt.
2. The Sales Invoice is derived from the authoritative issued invoice plus immutable sale/order snapshots. It preserves the authoritative gross total, applicable tax and tax-display policy, Branch snapshot, Cashier/operator snapshot, customer and historical line/UOM snapshots.
3. The Sales Invoice preserves its original settlement terms (`Partial`, `Pay later`, or immediate settlement context) on reprint. A later collection must not rewrite the original invoice into a receipt or silently relabel its historical payment terms.
4. Payment status is authoritative and independent of fulfilment status. Relevant order/history/detail and print surfaces must label them explicitly as **Payment:** and **Fulfilment:** rather than presenting one ambiguous status.
5. A **Payment Receipt** may be produced only from authoritative confirmed payment evidence. `initiated`, `pending_verification`, failed, cancelled, expired, disputed/reversed or otherwise exceptional payment state must not be presented as confirmed money received.
6. A later receivable collection uses the shared governed receivable/payment-allocation authority and immutable payment identity. Each confirmed collection may be printed/reprinted as its own payment-specific receipt from authoritative payment history.
7. Multiple confirmed collections remain independently inspectable and reprintable. Reprinting a collection receipt must not replay the payment, mutate the sale, recreate the receivable, change inventory, or replace the original Sales Invoice.
8. A pending Bank collection may be shown as pending verification but must not produce a Payment Receipt until confirmation authority succeeds.
9. Overpayment remains server-blocked against the governed outstanding balance. Clients may provide earlier UX validation but must not weaken the server rule.
10. Thermal and screen monetary rendering must adapt to large totals. Commercial values must wrap, shrink, or reflow safely rather than truncate digits, overlap controls, or silently display a different amount.
11. Printing failure never rolls back or replays the commercial transaction. Print/reprint is presentation/audit activity only.

## Offline replay

Offline Partial/Pay Later uses the same shared checkout and receivable authorities as online POS.

Required regression behaviour:

1. Preserve the original deterministic checkout command identity across replay/retry.
2. Repeated replay must not create duplicate payment allocations, receivables or stock effects.
3. Replay must prove the confirmed `amountPaid` remains the expected confirmed allocation sum.
4. Replay must prove `outstandingAmount` remains the authoritative sale total less confirmed money received.
5. `Partial` and `Pay Later` terms must survive replay unchanged.
6. Pending non-cash payment remains pending verification and must not finalize payment truth prematurely.
7. A later governed collection must reduce the same outstanding balance and, once confirmed, become eligible for its own Payment Receipt without mutating the original Sales Invoice.

## QA gate

When this boundary is touched, verify at minimum:

- immediate paid POS sale;
- Partial sale;
- Pay Later sale;
- pending Bank payment/collection;
- tax-inclusive grand total and explicit tax itemisation when display is enabled;
- Branch and Cashier historical snapshots;
- overpayment rejection;
- multiple confirmed collections;
- payment-specific reprints;
- original Sales Invoice unchanged after later collection;
- large totals on compact Mobile layouts and 58 mm / 80 mm thermal output;
- offline Partial/Pay Later replay, repeated replay, retained outstanding balance and no duplicate payment/receivable effect.

Do not declare the batch complete from UI appearance alone. Verify source/domain authority, payment idempotency and print semantics together.
