# OA5 — actual source migration interleaving and migration-slice stop line

**Observation:** 11 November 2026, exact source SHA `5d5729e206c82752211b9aac230a3f2051b852b6`, read from a successful `OA5 Staging Isolation Contract` GitHub Actions job.  
**Source:** The approved repository `supabase/migrations` directory, inspected *offline in CI* by `scripts/qa/oa5-migration-scope-inventory.mjs`. No Supabase project/API/database, provider endpoint or customer data was accessed by this tool.

## Actual 457-file source inventory

| Category determined **solely by filename prefix** | Files |
| --- | ---: |
| All unique, structurally valid SQL migrations | **457** |
| Named OA5/Pre-C2 *candidate* migrations (`oa5_*`, `pre_c2_*`, one exact legacy payment guard) | **17** |
| Explicitly named C2 (`c2_*`) candidate migrations | **17** |
| Other/unclassified source migrations | **423** |

The **first named OA5 candidate** is version `20261031010000`; the **last named OA5 candidate** is version `20261104074500`. **Inside that same OA5 version interval**, the actual ordered source includes:

- **17** named OA5/Pre-C2 candidates.
- **17** C2-prefixed migrations.
- **14** other/unclassified migrations.

**All 17 C2-prefixed files are interleaved within the first-to-last named OA5 candidate window.** Exactly **31 files inside the window are not named OA5 candidates**, out of 48 files in that interval.

**Source content inventory digest:** `6f8239cfd96108a2f70a69a2d7cf11540701f07a1c1a86449cadada11529d3c6` (SHA-256 over the sorted filename and corresponding file-content SHA-256 digests; this is *not* a signed database schema proof).

The full eight focused synthetic tests passed, and the actual 457-file inventory command ran and passed under the exact same source SHA. `failure_codes:[]` means **the source-directory inspection succeeded**, not that an OA5 deployment sequence is safe. The tool explicitly outputs `full_sql_semantic_dependency_review_verified:false`, `oa5_rebuild_migration_set_approved:false`, `disposable_local_replay_verified:false`, `current_test_migration_ledger_parity_verified:false`, and **both** production migration and hosted Test reset authorization **false**.

## Consequences for reconstruction

**Important architecture discovery:** The approved OA5 requirements **cannot be implemented by applying one chronological interval of the 457 SQL files as "OA5 only".** Every C2-prefixed migration lies inside that chronological interval, as do fourteen unclassified migrations. Equally, applying only the seventeen named OA5 files would be unsafe without inspecting SQL dependencies and verifying the necessary earlier baseline and other prerequisites.

The previous, separately measured **457 canonical vs 54 historical Test applied** inventory remains in force: 2 matching version+name pairs, 52 Test-only versions, 455 source-only versions, 452 retroactive source-only versions and 3 later versions. The existing Test ledger cannot be made canonical by merely replaying the latest three or marking 452 older versions applied. The 17/17/14 breakdown above classifies **source file names**, not historical Test schema features.

The viable design has to be **reviewed** from an explicit dependency-closed canonical baseline and the exact OA5-compatible subset. Two alternatives need local analysis:

1. **Clean canonical baseline then OA5 compatibility gate:** If source/current target architecture already carries C2 schema foundations, do not pretend that a nominal OA5-only timestamp range can be deployed separately. Preserve the agreed **legacy Business/trial runtime behavior** during OA5 validation, even if later C2 schema foundations exist but are not switched on; confirm app/schema runtime compatibility and negative evidence that forbidden C2 feature activation is absent.
2. **Restricted OA5 compatibility subset:** Start from a separately demonstrated compatible baseline and select files only with a complete SQL prerequisite/dependency graph. Any requirement on an interleaved C2 or unclassified migration must be reviewed explicitly; **never silently skip** its structural implications or indirectly activate new C2 commercial authority.

Neither alternative is accepted by name categorization. The first-order next task is review of **ordered 48-file window plus required baseline dependencies**, with SQL read-only static review, traceable exact file hashes, and a **disposable local PostgreSQL rehearsal**. Preserve the existing 07 November encrypted archive, prior disposable restore evidence and the exact one-session drift decision; do not ask the owner to repeat accepted custody proof.

## Safety boundary

The following remain **NO-GO** until individually reviewed: hosted Test reconstruction, in-place `supabase db push`, bulk migration-repair/mark-applied, cron pause, external provider routes, Auth/Storage cleanup, Vercel preview activation, QA APK, or Production/C2 cutover. Test `iukgsukdoowvnhlfmpml` still has four ACTIVE scheduled jobs and unresolved provider isolation. Production `eujxswjspolugrzlsjnn`, Tandar, current Merchant/Admin sites and Mobile remain unchanged.

**Cross-surface scope:** source-only QA tooling was added, not business logic. Shared commerce, inventory/UOM, payments, branch permissions, Merchant Web, Admin Web, Mobile, WhatsApp, AI, reporting, receipts, and offline/sync are unaffected at runtime by this step. Their full governed lifecycle still requires acceptance on a safely constructed Test environment before C2 runtime cutover.
