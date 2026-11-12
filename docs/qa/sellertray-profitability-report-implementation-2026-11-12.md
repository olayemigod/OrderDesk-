# Accelerated release: aggregate profitability implementation audit and acceptance

**12 November 2026 — source-only candidate. Not hosted, not merged, not Production-ready.**

## Existing work reused

Mobile Orders hideable search/status/payment/channel/date filters, merchant Web Orders controlled server search, and clickable Customer order history already exist on draft PR **#238** (head `b413345c830369b2bb031f21495eaea05bd9ab81`); no replacement implementation was created. Web history still depends on `20261109230000_customer_history_order_branch_scope.sql`, which was absent from the last read-only Production migration-ledger check. The single-sale `get_sellertray_order_profitability(uuid,uuid)` SQL authority already exists in Production and covers tax-posted net revenue, completed returns and immutable valuation entries; it is not a consolidated report.

## Only missing Item 4 capability developed here

This stacked branch implements **Merchant Web Report Center → Profitability** backed by a new **set-based, read-only SQL RPC** `get_sellertray_profitability_report(uuid,date,date,uuid,text)`. It aggregates the existing completed sales / returns / inventory movement / historical COGS ledger without N+1 browser calls or independent cost prices, preserving the existing single-sale RPC and WhatsApp commerce truth.

- Optional exact Business-local date range, Branch and sales channel. Uses the same date, completed-order and soft-delete scope as the existing management report; queries only readable Branches and requires Owner/Manager plus `can_view_reports`. Anonymous, non-member and Staff denied.
- Net revenue uses posted-tax sale subtotal minus **completed return subtotals**, or legacy sale totals less returned totals. Does not treat collected tax as revenue. Period is the cohort of completed sales *created* in the selected window, with completed returns *as of now* (not a return-activity-by-date report).
- COGS uses the existing `sellertray_inventory_valuation_entries` joined to sale/return/reversal `inventory_movements`. Missing sale movements, null/missing/incomplete valuation rows, and completed returns without corresponding return-cost movements make a sale cost-incomplete. **Never infer missing cost or publish full gross profit/margin while any selected sale is incomplete.**
- Returns known COGS with a **partial-cost** warning when applicable. Profit and margin are `null` until all selected sales are cost-complete; Branch rows make the same distinction. This is gross profit, **not net earnings after operating expenses**. Stock, UOM, checkout, WhatsApp and payment commands are unchanged.
- Rejects mixed currencies, invalid dates, unsupported channels and inaccessible Branches rather than silently aggregating incomparable data.

## Release sequence and gates

1. Run exact-head Database CI: canonical 457+ migrations (including the new file), pgTAP fixture tests (role/capability, absent-cost withholding, Branch/date/channel, draft exclusion, no anonymous reads), and regression against current historical single-sale profitability/tax/scope tests.
2. Run exact-head Merchant Web typecheck, preflight, build; verify narrow-screen tab layout and no stale cross-Business profitability state.
3. Reconcile **existing PR #238** with the approved production-compatible release lane. Existing Orders/Customer changes are preserved. In isolated Test, apply the customer-history Branch response migration **before** deploying its matching Web drilldown; apply this Profitability RPC **before** deploying its Web tab.
4. Synthetic QA compare period/Branch totals against completed posted sales and the single-sale profitability RPC for completely valued orders; cover missing sale and return cost, tax, returns after period, UOM historical snapshots, multi-Branch roles, and data-volume/performance. The absence of authoritative historical COGS **must display incomplete**, not zero profit.
5. Separately approve a production-compatible, forward-only/version-aware migration package and exact Merchant Web release. Do not replay all C2/OA5 migrations against the 392-version historical Production ledger; never test on Tandar. No Vercel Preview, EAS APK, Test reset, Production SQL or provider actions were performed in this source slice.

Existing PR #238 includes source-level 4/4 Orders-filter and 5/5 saved-sale tests from prior local runs, **not proven exact-head CI/device QA**. Do not represent those as accepted release outcomes.
