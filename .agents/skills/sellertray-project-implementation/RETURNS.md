# SellerTray Return, Receivable and Refund Governance

This file is a normative extension of `.agents/skills/sellertray-project-implementation/SKILL.md` for every task touching sale returns, returned merchandise, receivables, customer balances, payment refunds, refund methods, cash drawers, return history, return reporting, or return-related offline/retry behaviour.

A later explicit SellerTray product decision established the following rule and it overrides older implementations or wording that assume every merchandise return creates an equal cash refund.

## Governing settlement rule

> Returned merchandise reduces the customer receivable first. SellerTray pays money back only for the portion of returned value that exceeds the remaining receivable and is supported by money previously collected.

For one governed return command, using the authoritative sale/return/payment state immediately before the command:

- `return_value` = the authoritative tax/discount-aware commercial value of the approved returned quantities;
- `outstanding_before` = the authoritative remaining receivable before this return;
- `receivable_reduction = min(return_value, outstanding_before)`;
- `refund_due = max(return_value - receivable_reduction, 0)`;
- any monetary payout must additionally be capped by the authoritative net confirmed money collected for the sale after prior refunds.

Never create a second stored receivable truth merely to implement this rule. Use the governed sale, payment, prior-return and prior-refund authorities and expose derived read models where needed.

## Commercial reversal versus monetary payout

A return has two distinct effects and they must not be conflated:

1. **Commercial reversal** — records returned lines/quantities/value, restores only the approved stock quantity using the historical UOM and valuation snapshots, reduces the collectible amount where a receivable still exists, and preserves the original sale/payment history.
2. **Monetary payout** — exists only when `refund_due > 0`. It is separate immutable payment-refund evidence and must never be created for the receivable-reduction-only portion.

Therefore:

- a fully unpaid sale may be returned with receivable reduction and no `payment_refunds` row;
- a partially paid sale may be returned with receivable reduction only when the return value does not exceed the outstanding balance;
- when a partial return exceeds the outstanding balance, reduce the outstanding balance first and refund only the excess supported by confirmed prior collections;
- a fully paid sale may produce a payout for the governed return value, subject to confirmed-net-paid and prior-refund limits;
- multiple partial returns must remain quantity-safe, value-safe and idempotent across both commercial reversal and payout effects.

## Refund method and drawer rules

When `refund_due > 0`, the refund method is explicitly selected as **Cash** or **Bank**.

- **Cash refund** creates governed cash-refund evidence and reduces the expected cash of the completing operator's open Branch/register shift. It must fail closed if the required open drawer, currency, Branch authority or sufficient expected cash is absent.
- **Bank refund** creates governed non-cash refund evidence and must not create a cash-shift refund row or change expected drawer cash. Bank refund evidence must remain attributable to the original sale/return and the completing operator.
- Do not silently infer Cash merely because the original sale used Cash. The refund method is a payout choice for the actual amount being returned to the customer.
- If `refund_due = 0`, there is no refund-method choice because there is no monetary payout.

## Permissions

Return preparation and monetary-refund completion are separate permission boundaries.

- A Cashier/Staff user may inspect returnable quantities and prepare/select a return, including selecting a proposed Cash or Bank payout method when a payout would be due.
- A Cashier/Staff user must not complete a monetary payout.
- Only the merchant **Owner** or **Manager** may complete a return command that creates a monetary refund payout.
- A return that creates no payout may be completed only through the governed return permission/capability and Branch rules; do not grant monetary-refund authority merely because a user may prepare a return.
- Legacy delegated `can_refund_sale` behaviour must not be used to let Staff complete a monetary payout after this doctrine is active.

Server/domain authority must enforce these rules. Client-side disabled buttons are not a security boundary.

## Cross-surface contract

**Mobile performs:** Mobile is the operational return surface. It must show returned value, receivable reduction and monetary refund separately. When payout is due, it shows Cash/Bank selection. Staff may prepare/select but the UI must clearly block payout completion and indicate Manager/Owner authority is required.

**Web manages:** Merchant Web reviews immutable return history and financial effects. Return detail must distinguish returned merchandise value, receivable reduction, monetary refund amount and refund method. Receivables must reflect the post-return collectible balance without browser-side reconstruction.

**WhatsApp sells:** WhatsApp order/payment truth must remain compatible with the same shared return/payment authorities. Do not create a WhatsApp-specific refund ledger.

**AI assists:** AI may explain or surface return/refund state but must consume governed read models and must not calculate an alternative financial truth.

## Historical, reporting and audit rules

- Preserve original sale, invoice/receipt and payment history.
- Preserve immutable returned-line snapshots, historical UOM/conversion snapshots, tax/discount allocation and valuation basis.
- Return history/reporting must expose commercial return value independently from receivable reduction and actual payout.
- Payment/refund reporting must count only actual monetary payouts as refunds; receivable reduction without cash/bank payout is not money refunded.
- Cash-shift reporting must include only actual Cash payouts.
- All high-risk return/refund completion actions must preserve actor, Branch, retry identity, reason and immutable audit evidence.

## Idempotency and concurrency

The return command is one governed atomic commercial operation. Retry of the same command identity must resolve to the original commercial return and, when applicable, the original refund evidence without duplicating stock, receivable, cash, bank, payment or audit effects.

Lock/revalidate the authoritative order/payment/return state at apply time so concurrent collections, returns or refunds cannot over-reduce a receivable or over-refund confirmed money.

## Required validation

At minimum, regression coverage for this boundary must include:

1. fully unpaid sale -> receivable reduction only, no monetary refund;
2. partially paid sale with return value <= outstanding -> receivable reduction only;
3. partially paid sale with return value > outstanding -> receivable reduction first, refund only the excess;
4. fully paid sale -> governed payout subject to net-paid cap;
5. multiple partial returns and exact final-line rounding;
6. idempotent replay with no duplicate stock/receivable/refund effect;
7. Cash payout changes the correct drawer and fails closed on missing/insufficient drawer;
8. Bank payout does not change drawer cash;
9. Staff/Cashier cannot complete payout; Owner/Manager can;
10. Branch and tenant isolation;
11. tax-inclusive/discounted partial-return value uses the existing authoritative projection;
12. return/receivable/payment/cash-shift/reporting reads distinguish commercial value, receivable reduction and actual payout;
13. inventory valuation and stock-ledger return rules remain compliant with `VALUATION.md`.
