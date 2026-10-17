# SellerTray Inventory Valuation and Historical COGS Addendum

This file is a normative extension of `SKILL.md` for every SellerTray task that touches inventory valuation, stock history, purchasing cost, COGS, profitability, inventory reports, transfers, returns, or offline/backdated stock events. It does not replace the governing skill; all existing SellerTray rules remain in force.

## Governing valuation model

1. The immutable `inventory_movements` ledger remains the quantity source of truth. Valuation is a derived, rebuildable layer and must never rewrite posted stock movements.
2. SellerTray uses **moving weighted-average cost** by governed stock position: Business + Branch + Stock Location + Product, with quantities expressed in Stock UOM.
3. Replay is deterministic. Order stock history by `business_at`, then immutable recording/order tie-breakers (`created_at`, then movement ID) so the same history always produces the same quantity and cost state.
4. Operational/offline stock commands preserve their authoritative `business_at`; delayed sync must not rewrite when the business event happened. As-of reads use business time, not sync time.
5. Governed Purchase Receiving is the primary authoritative cost source. Receipt lines snapshot purchase-UOM unit cost, conversion factor, derived Stock-UOM unit cost, and business currency so later Product/UOM edits cannot reinterpret posted cost history.
6. Positive stock without governed cost evidence—such as legacy opening stock or a positive manual correction with no approved cost source—remains explicitly `unvalued`. Do not infer cost from selling price, current average cost, or a later purchase.
7. Where valued and unvalued quantities coexist, outflows consume the known/unvalued composition proportionally. Known COGS may be reported, but `cogsComplete` is false until the applicable sold quantity has authoritative cost coverage.
8. A sale records historical COGS from the valuation state at that sale's business time. Never calculate historical COGS from today's average cost.
9. Stock Transfer dispatch carries the exact valued/unvalued composition and known value out of the source position. Transfer receipt restores that same composition/value at destination; transfers must not create or destroy inventory value.
10. Sale Return restores the original sale's historical valued/unvalued composition and COGS basis in proportion to the approved returned Stock-UOM quantity. Do not revalue a return using the current average cost.
11. Correcting reversals reverse the source movement's valuation effect; they do not invent a replacement cost basis.
12. Backdated governed movements require deterministic valuation replay of later movements for the affected Business/Product so historical as-of balances and COGS converge to one result.
13. Single-currency valuation uses the Business currency. Do not silently perform FX valuation without an explicitly approved exchange-rate model.
14. Quantity integrity and value integrity are separate. SellerTray may know stock quantity while cost is partial or unknown; the system must expose that state rather than treating unknown cost as zero.

## Historical cost-basis evidence

1. Merchant Web may resolve a legitimate historical valuation gap by attaching **verified historical cost evidence** to an existing eligible positive inbound movement. This is a valuation correction only; it must not add, remove, date-shift, or rewrite stock quantity.
2. Historical cost evidence is allowed only for positive `opening`, `adjustment`, `count_reconciliation`, or legacy `purchase_receipt` movements that do not already have an authoritative governed Purchase Receiving cost snapshot.
3. `transfer_in`, `sale_return`, `reversal`, sales and other outflows must never receive an independent cost basis. Their value comes from their governed source history.
4. Cost is entered in **Stock UOM** and Business currency from real evidence such as an invoice, opening-stock schedule or count record. Selling price, today's average cost and later purchase price are never acceptable inferred substitutes.
5. Evidence is append-only and audited with source movement, Business/Branch/Location/Product snapshots, Stock-UOM unit cost, currency, reference, reason, actor, command identity and recording time.
6. Corrections append a new evidence record that explicitly supersedes the current evidence head. Previous evidence is preserved; in-place update/delete is not a correction mechanism.
7. Commands are idempotent. Reusing a command identity for the same facts returns the original evidence; reusing it for different facts fails closed.
8. Recording or correcting historical evidence rebuilds valuation for the affected Business/Product from the original movement's `business_at`. Later COGS, transfers, returns and as-of profitability therefore converge to the corrected historical basis.
9. Historical cost-basis management requires Branch historical read access plus both governed `can_adjust_stock` and `can_manage_purchasing` capabilities and a writable subscription. This keeps the workflow management-oriented without creating a separate client-side authority model.
10. Authenticated clients may use only governed read/command RPCs. They must not read or mutate the internal evidence table directly or reproduce evidence-head/replay logic in the browser.

## Governed reads and reporting

1. Current stock quantity continues to come from the shared quantity ledger. Historical stock reads must support an explicit `as_of` business time.
2. Inventory valuation reads must expose at least: quantity on hand, valued quantity, unvalued quantity, known inventory value, valuation status, last movement, and average unit cost only when the relevant on-hand quantity is fully valued.
3. `Known inventory value` is not the same as total inventory value while unvalued quantity remains. Merchant-facing UI must say so clearly.
4. Profitability uses net sale revenue and governed historical COGS. Gross profit/margin is authoritative only when COGS is complete; otherwise return/show incomplete status and leave authoritative gross profit/margin unset rather than estimating.
5. Valuation/profitability reads remain permission- and Branch-aware. Clients must not read internal derived valuation tables directly or recreate cost logic in browser/mobile code.
6. Merchant Web owns the richer inventory valuation, cost-evidence reconciliation and profitability reporting experience. Mobile may expose concise governed operational summaries but must not create a separate cost model or historical-cost editor.
7. WhatsApp and AI may consume governed valuation/read services where authorised, but neither may infer or write inventory cost independently.

## Required valuation QA

For valuation-related changes, verify at minimum:

- two or more purchase costs produce the expected moving weighted average;
- as-of quantity and valuation follow `business_at` deterministically;
- legacy/unsupported positive stock stays unvalued rather than receiving invented cost;
- sale COGS is complete for fully valued stock and explicitly incomplete for mixed/unvalued stock;
- transfer out/in preserves exact known value and valued/unvalued composition;
- partial returns restore historical sale cost basis;
- receipt cost snapshots cannot be silently rewritten;
- retries do not duplicate quantity or valuation effects;
- Branch and report permissions still fail closed;
- reports never present known partial value as complete total value or incomplete COGS as authoritative gross profit;
- historical cost evidence never changes quantity history and only targets eligible positive inbound movements;
- authoritative Purchase Receiving cost cannot be manually overridden by historical evidence;
- historical evidence corrections append/supersede rather than rewrite prior evidence;
- same-command retries remain idempotent and conflicting reuse fails closed;
- adding/correcting historical evidence replays downstream COGS and as-of valuation from the source movement's business time.
