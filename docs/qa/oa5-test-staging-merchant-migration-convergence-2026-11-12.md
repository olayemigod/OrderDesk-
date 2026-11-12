# OA5 Test staging migration convergence — source-only review
Date: 2026-11-12. Status: DRAFT; no hosted execution. Parent: PR #228 at ce8cef42f5edf9c9f11dad3227f64af1967a0efa.

## Why
A direct comparison of current exact Git trees found QA reconstruction PR #228 has **457** canonical migration files, but the Production-compatible Merchant Web PR #239 contains **4 migration files absent from QA**. Two are pre-C2 merchant discount/order-form reconfirmation gates (20261102103000 and 20261102104000, **historically ordered before later OA5/C2 candidate migrations**). Two are the already verified Merchant Web Customer History detail Branch projection (20261109230000) and the set-based Profitability Report (20261112050000). Those 4 are **currently unapplied in live Production**. This branch adds the 4 exact immutable blob contents to make one **461-file** candidate that must pass a fresh clean local replay before Test Method B can treat it as a possible superseding source. Two fresh discount and two report pgTAP suites are copied exactly.

Source #228 also contains **18** migrations absent from Web PR #239; those include the OA5 installer setup, optional customer phone, shared UOM pricing/cost-aware inventory and audit restorations. This source-only integration **does not** remove them and does not silently backport them into Production. The OA5 and discounted pre-C2 source flows must remain separate from C2's later retirement of the legacy runtime.

## Controlled reconciliation
- Preserve original SHA-256 source content for all 457 existing QA migrations; add only the four exact previously reviewed SQL blobs and four matching pgTAP files. No renames, skips, version repair or ledger spoofing.
- Update only source review counters `MIGRATIONS` and `SOURCE_MIGRATIONS` to 461; old historical 457-file archive/recovery evidence remains immutable and should not be relabelled as a new archive. New evidence must be gathered for the expanded source.
- Source migration inventory is now 461; old 54-version hosted Test migration ledger is **not** compatible, and a Test remote `db push` remains forbidden. The two 02 Nov timestamped migrations are **retroactive relative to the already-applied Production ledger**, so **do not** include them in an automatic Production migration batch. Their eventual Production deployment would require a separate ordered-forward-only strategy and explicit side-effect review of the commercial reconfirmation trigger.
- Parent QA Test source has the safe **Test-only Meta webhook denylist** and shared active/non-retired WhatsApp routing guard; neither is deployed. Maintain this safety distinction from Production.
- This stacked branch does not yet port the full Merchant Web UX or SDK58 Mobile app. Web PR #239 and Android PR #241 remain separate candidates until Test backend passes complete acceptance.

## Release blockers
- Exact-head local clean replay and all pgTAP suites including re-confirmation, returns/COGS, Branch permission and Customer History;
- Method B managed-Auth session/token drift (archive 5, currently 7; current privileged session);
- 4 active Test cron jobs and external provider ingress/egress containment, historical 5 Preview custody, CLI v3 exact Test object/delete scope, backup and rollback;
- separate explicit permissions to pause jobs and execute hosted Test reconstruction; no Production or C2 cutover, Vercel Preview, APK, Meta/PSP email delivery.

This change is **source-only**, makes no hosted Test/Production modification, and retains Tandar operations. All non-authorizing `source_inventory_sha256` operator records must be regenerated and independently re-reviewed for this source SHA.
