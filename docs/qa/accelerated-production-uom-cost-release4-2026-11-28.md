# Release 4 — reconcile existing UOM pricing and cost-aware adjustments (source only)

## Accepted baseline and custody
Accepted Merchant Web source: `9f584bf818ab279ed909dc82daeba1bf01bb6035` (PR #252); accepted private Build48: `3989d303eecc2933b77384f8ff1093cde9036b11`. Preserve both. Source candidate only. Build version unchanged pending separate approval. No public Android rollout, Vercel preview, Production/Test DB writes, Edge deployment, WhatsApp/Meta changes, OA5/C2 cutover or Tandar test writes.

## Provenance and migration sequence
Reuse PR #213 head `4f6d94488d13fec18a1bd834d88cb7a03d9e6971` via integrated PR #214 head `5d1228a018de76ca2ec5e550c04450c1e5ee23e7`. Apply scoped prior hunks onto the accepted baseline, not the old entire files or branch. Mobile Inventory already had additive/subtractive guidance and projected balance; retain the accepted text including supplier/transfer exclusions. Preserve accepted Build48/Release2/3 UX, customer identity, performance, reporting, and SDK58 lockfile. New branch Vercel exclusions on both projects; existing exact-SHA manually gated Android workflow unchanged.

| Original canonical file version on PR214 / Method B | Forward source version in Release 4 | Exact prior blob |
| --- | --- | --- |
| 20261104202000 | 20261128123000 | 3c312f1c05960e1cd60faa105f484db83f580e10 |
| 20261104234000 | 20261128123100 | 49d8efe4294737d762613290c6dd7cc257a6d322 |

Both SQL bodies are exact prior blobs; these are forward aliases for the same logical changes, not additional features. Never replay both names on one database. PR #249 pinned 461-migration Test reconstruction source remains unchanged; reconcile logical version mapping explicitly before any future integration, preserving its original names or an independently tested forward-only no-duplicate bridge. No generic db push or migration history repair. Hosted managed migration API can assign different actual ledger versions; record name/version and exact body mapping after any explicitly authorized release.

## Read-only live baseline (28 November)
396 migration rows, latest 20261127180458. Neither logical migration nor either new RPC is present. Two active alternate UOMs in one Business lack explicit price while base price exists. Live actor-aware service-only POS wrappers retain subscription and Branch checks; they call the older internal overloads. Inspected live inner atomic/idempotent and barcode function bodies against prior UOM SQL; intended changes are the price resolution expressions only. Live draft editor matches one old price-filter and both replacement anchors. Existing historical cost function body matches the new actor-aware authority except the actor identity source; wrapper must retain authenticated session-derived actor and current ACL. Before hosted execution recheck current full function definitions, ACL/owners, prerequisites and schema drift, and capture rollback evidence. No business-row DML in the intended migration application; no historical cost inference or stock rewrite.

## Cross-surface release gates
- Shared core: SQL price fallback only on NULL, explicit zero, Stock UOM price precedence, decimal precision; preserved price/UOM snapshots, actor wrapper ACL, draft edit, barcode and expected offline price/conversion checks. Atomic cost evidence for positive corrections; no-cost path remains explicitly unvalued; negative adjustments use existing valuation; same-command and merchant-reference retries; authorization, Branch/Business isolation, append-only evidence.
- Mobile: catalogue, base price editor and cart labels; authorized cost entry and projected balance, no forced new balance. Retain Build48 fixes and offline outbox/replay. Old clients remain compatible; no APK dispatch. Verify narrow and expanded windows, large text, dark/light and barcode/hold/resume.
- Merchant Web: configured versus effective prices, cost-evidence history and adjustment UI; stock count remains separate. Profitability remains based on ledger/COGS completeness; test weighted average, known versus incomplete cost, sales, returns, transfers and evidence replay.
- Admin: no merchant transaction or commercial authority changes, only candidate branch exclusion; no Admin build or deployment.
- WhatsApp/AI: inspect applicable pricing consumers and shared authority before release. Owner deferred live WhatsApp connection testing; no gate waiver, no provider credential changes. Source regression and later authorized end-to-end testing required. AI must not infer or write inventory cost.
- Payments/printing/reporting: preserve existing financial snapshots, receipts, payment idempotency and report scope; validate affected downstream historical cost and pricing behavior.
- Offline: test explicit and calculated prices, stale price conflicts, exact replay, no duplicated sale/stock/payment, and no offline stock-cost privilege expansion.

Run exact-head Database replay/pgTAP, Mobile source/unit/preflight, native and offline CI, Merchant Web CI and relevant Edge typecheck/review. Verify exact deployed inventory-operation version and compatibility before seeking approval. Separate authorization for the two forward SQL migrations, then the one inventory-operation Edge Function, followed by approved Merchant Web deployment and one later private Android acceptance build. All tests and live functional acceptance remain pending at source candidate creation.
