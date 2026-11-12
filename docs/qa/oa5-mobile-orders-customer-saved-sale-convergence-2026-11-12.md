# OA5 Test Mobile Orders, Customer History and Saved Sale convergence
Date: 2026-11-12. SOURCE-ONLY. Stack on PR #244, head 9a95dc78a8caf7280e2a143ea6eddb305a2d42f4; source PR #241 already validated Android SDK58 operations.

## Exact reviewed implementation reuse
These 13 file blobs are copied from the prior, green PR #241 source without recreating business logic. A direct QA-to-PR241 line LCS found the affected features are narrow **additions or bounded replacements**, not wholesale rewrites of newer QA installer, UOM or optional-phone capabilities.

- `OrdersWorkspace` + `orderSearchFilters`: hideable-by-default search/status/payment/channel/date filters with 30-order progressive rendering and explicit focus exemptions for customer-history deep-link. Existing POS draft editing/deletion, returns, payments and stock resolution remain unchanged.
- `useOrders`: suppress redundant overlapping realtime refreshes, avoid loading overlay when previously loaded, fence stale tenant requests.
- `ordersRepository`: add optional exact-order scoped fetch for customer-history drilldown; preserve original tenant/Branch security queries and payment/notification snapshots.
- `CustomersView` + `SettingsHub` + `MoreWorkspace` + `RedesignWorkspace`: click a customer-history order to locate the governed original Branch; deny inaccessible Branches; separate focused order from notification targeting; no raw alternative customer/order truth.
- `ResumePosDraftWorkspace` + `posDraftResume`: add controlled retry on disconnected resume, preserve original draft, deny duplicate checkout and instruct actionable remediation on removed Product/UOM.
- `SellWorkspace`: bounded product-list rendering, indexed barcode lookup, concurrent authoritative stock/tax refresh with non-blocking cache writes, retaining the same shared server checkout, stock ledger and payment approval.
- Two source regression tests copied from PR #241, run in addition to the existing QA optional-phone, setup installer, Branch/UOM, offline/idempotency and printing gates.

## Release boundaries
The canonical QA backend already has 461 ordered SQL migrations, with clean local replay and 3,082 pgTAP PASS on PR #242; hosted Test still holds 54 historic migration versions and cannot accept direct push. The new Web candidate PR #243 passed exact-head CI, and the corrected SDK58 PR #244 source passed Mobile verification/dependency audit at `9a95dc78a8caf7280e2a143ea6eddb305a2d42f4`; native compile is a distinct gate. No new APK, Vercel Preview, Test/Production SQL, provider egress, cron pause, Test reset or Tandar mutation.

The stronger OA5 Test-only Firebase `app.config.js` remains UNMODIFIED. Never use production-bound EAS `qa` profile as Test; use separately attested `qa-staging` only after Method B and provider isolation approvals. Android actual hardware acceptance, 58/80mm printing, barcode, camera, push, payment, WhatsApp, offline conflict/idempotency, saved sales and multi-Branch source reconciliation remain acceptance requirements; passing source CI is not device QA. Preserve completed source but do not automatically merge into Production or start C2.
