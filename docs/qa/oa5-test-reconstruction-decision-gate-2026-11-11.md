# OA5 Test reconstruction decision gate — historical migration-ledger conflict

**Status: HARD NO-GO for in-place Test migration replay or destructive hosted Test action.**  
**Evidence date:** 11 November 2026.  
**Target:** Existing Test Supabase project `iukgsukdoowvnhlfmpml` only. Production `eujxswjspolugrzlsjnn`, Production domains, Tandar and other live merchants are strictly excluded.  
**Candidate:** Draft PR #228, `fix/oa5-test-rebuild-candidate-20261107`. The exact SHA for any later rehearsal or release must be freshly pinned; the current draft head itself is not authorization to deploy.

## 1. Final observed read-only migration comparison

Owner-operated SHA-256-verified private Test migration ledger and canonical source file scan reported:

| Category | Count | Meaning |
| --- | ---: | --- |
| Canonical SQL migration files with valid unique versioned names | **457** | Source **structure PASS**, not schema/replay proof |
| Historical Supabase Test ledger entries | **54** | Standalone Agreement Package Test history |
| Version + migration name exact matches | **2** | **No name collisions** among the two common versions; SQL-content/schema parity still unverified |
| Test versions not represented by canonical source filenames | **52** | Historical Test-only snapshot/import/correction lineage |
| Canonical files not recorded in Test ledger | **455** | Not necessarily 455 missing SQL features |
| Canonical unapplied files **older** than current Test ledger high-water mark | **452** | **Forward-only execution hazard** |
| Canonical unapplied files **newer** than current Test ledger high-water mark | **3** | Must still be classified/reviewed before use |

The original Test applied-ledger high-water mark is `20261104214453`. A **separate, authenticated, read-only Supabase Test migration list** on 11 November again returned **54 unique applied versions** with the same high-water mark. This recheck confirms the host's ledger count/high-water mark, **not** an independent hosted read of the operator's private 54-record JSON bytes. The private source comparison remains the owner's bounded evidence.

Three blocking failure codes are **correct**: `HISTORICAL_APPLIED_VERSION_NOT_IN_SOURCE`, `FORWARD_ONLY_MIGRATION_ORDER_HAZARD`, `CURRENT_SOURCE_NOT_YET_APPLIED_TO_TEST`. `local_naming_and_uniqueness_passed:true` and `local_applied_ledger_reconciliation_passed:false` are compatible, not contradictory. The CLI exit code is intentionally nonzero when the historical ledger diverges.

## 2. Decision: do not patch, invent, or spoof migration history

**Prohibited without a separate governed reconstruction plan:** in-place `supabase db push`; `supabase migration repair` to mark hundreds of unexecuted source files as applied; replaying all 457 files into the existing historic Test schema; manually editing `supabase_migrations.schema_migrations`; guessing what 18 special `sellertray_schema_batch_*` migrations contain; assuming the two matching name/version tuples mean identical SQL bodies; or deleting/pausing Test managed resources to make a migration command run.

**Permitted now:** source-only/CI analysis and disposable-local database rehearsals with proven local isolation. Local disposable PostgreSQL is not another persistent hosted environment. Reusing the already documented independent 07 November encrypted recovery archive and actual local disposable restore evidence is preferred to demanding an unnecessary second capture. A new rehearsal must compare the **exact approved subset and ordered migration chain** against a clean disposable database and established Test archive data, not reconstruct Production or live merchant rows.

**Preferred reconstruction candidate to evaluate, not yet authorize:** an explicit, test-only clean canonical baseline from the chosen reviewed source checkpoint, followed by a separately reviewed OA5-only additive migration slice, preservation of standalone historical Agreement evidence, a deterministic transition to synthetic Test merchants and reviewed Test-only Edge-function deployments. The clean-baseline method and historical archive preservation must be proven **locally first**. Do not silently include interleaved C2 migrations simply because their filenames fall between desired OA5 files. C2 runtime remains behind OA5 controlled acceptance.

## 3. Rehearsal and acceptance sequence

1. **Pin source and scope:** record the precise Test candidate SHA, approved OA5 migration range, categorization of all migrations in that range (OA5/Pre-C2/C2/unclassified), exact command order and dependency graph. Prove any skipping/reordering is semantically safe; do not default to the whole 457-file set.
2. **Custody/recovery:** independently read the archived backup manifest, five SQL archive SHA hashes, OneDrive encrypted archive and dated disposable PostgreSQL 17 restore counts; preserve 54 historical Test ledger entries and Agreement proof, including known +1 post-archive Test Auth session loss scope. A prior archive checksum PASS is not itself a complete managed Auth/Storage restore plan.
3. **Disposable-local rehearsal only:** restore into a non-hosted local scratch database or create a clean scratch canonical schema as appropriate, validate ordered source migrations, and inspect effective schema, RLS, grants, all SECURITY DEFINER callable surfaces, audit/tenant/Branch boundaries, UOM/stock valuation and payment retry safety. The local rehearsal may write only to its explicitly disposable local test database; never to Test, Production, or a paid hosted branch.
4. **Preserve historical evidence:** map old Agreement Package snapshots/records to retained read-only archive artifacts, with no unsafe re-import into new authoritative tenant truth; identify any exact approved clean-room fixture or synthetic merchant regeneration required.
5. **Provider and ingress isolation:** verify Test-only Meta app/phone/secret/webhook, sandbox payment credentials and callbacks, SMTP safe recipients, Firebase QA sender, AI and notification egress, Test Auth redirects and protected domains. No provider callback or user-facing notification can go to Production/Tandar.
6. **Authorized maintenance only after fresh preflight:** identify four exact active Test `pg_cron` jobs and request **separate explicit approval** for reversible Test-only pause. After approval, verify all `active=false`, zero unfinished runs at any age, zero queued pg_net HTTP requests and controlled external providers, with a new snapshot younger than ten minutes. The archive-to-live census must account for exactly the known +1 Test Auth session (not generic data loss).
7. **Exact cleanup operation and recovery:** separately document/test the exact Test-only hosted cleanup semantics for public schema, migration ledger, managed Auth/Storage, Edge, secrets and cron, including which states remain intentionally untouched. A generic `db reset` is not presumed a full managed-project wipe. Name the rollback operator and preserved recovery artifacts.
8. **User-specific execution approval:** present the exact identified project, blast radius, source SHA, irreversible Test-only data loss, stop/recovery steps, maintenance duration and cost. No destructive operation follows merely from this document or from a green source CI.
9. **Phased hosted acceptance only after authorization:** migration authority and RLS/permissions first; Test-only Edge and secrets second; protected Merchant/Admin QA routes and QA Firebase/APK third; synthetic merchants/invoice/payment/stock/offline/WhatsApp provider-safe flow fourth; cron resume and ingress only after destination checks. Retain audit and rollback evidence.
10. **Sequence:** OA5 notifications/reporting + controlled real merchant proof precede C2 Commercial V2 production cutover. Do not claim OA5C or C2 complete from Test synthetic QA alone.

## 4. Current gate ledger

| Gate | State |
| --- | --- |
| Historical 5 Vercel Preview application capture (38 local files, independent SHA check) | **PASS within declared scope** |
| Vercel provider historical deployment ID/alias metadata | **PASS (metadata)** |
| Canonical SQL source filename integrity | **PASS (457 source files)** |
| Historic Test migration ledger parity | **BLOCKED (52 historic-only; 452 retroactive canonical)** |
| Content parity of two matching version/name tuples | **NOT ATTESTED** |
| Exact OA5 migration slice and local clean-room rehearsal | **NOT ACCEPTED** |
| External provider routes, SMTP and callback isolation | **NOT ACCEPTED** |
| Backup/managed recovery completeness and fresh census | **NOT ACCEPTED** |
| Reversible four-cron maintenance | **NOT AUTHORIZED; four remain ACTIVE** |
| Test reconstruction | **NO-GO** |
| Production C2 runtime cutover | **NO-GO** |

## 5. Cross-surface impact

This is a QA/release and data-safety decision; it does not mutate shared commerce, Product/UOM, inventory, payments, merchants, Branch permissions, WhatsApp, AI, reporting, Mobile or offline client logic. Merchant Web/Admin Web historical source custody was assessed without deployment. Any future Test rebuild must reverify cross-surface transactions, permissions, stock ledger, payment idempotency, receipts, reporting and offline sync after the shared core is restored and seeded. **No new APK, Vercel Preview, migration, provider call or hosted write is authorized here.**

## Post-canonical historical Auth boundary (source-only preparation, 11 November)

An additional offline after-replay guard is now defined: preserve the pre-change **five-identity SHA-256 cohort fingerprint** and compare it against read-only Test SQL after an independently authorised reconstruction. The after-replay snapshot must show no original account inheriting merchant membership, Branch access, capabilities, Platform Admin, installer role/appointment, or invitation reservations; it must also show all canonical migrations and independently introduced synthetic QA identities. This guard is NOT executable against the current historical Test schema; several required installer tables belong to the new canonical replay. It does not authorize hosted reset, exclude existing historical Preview reviewer access, or prove historical account JWT/RLS/Edge behavior. These remain separate stop gates. See `docs/qa/oa5-test-post-canonical-auth-quarantine-2026-11-11.md`.

## 11 November 2026 — accelerated release approval, kept separate from OA5/C2

The owner approved **urgent Production defect corrections independently of C2** and selected **retained-Auth Method B** for final Test reconstruction verification. This updates the previously undecided method choice, **not** the existing Test destruction NO-GO. The prospective hosted rebuild still needs exact CLI/managed-service scope, independent provider/Preview evidence, protected restore, four-cron pause approval, fresh quiescence and separately scoped execution signoff. The Production defect lane must use separately checked **currently deployed** web and database sources and version-aware forward-only changes; it must never replay all 457 Test-source migrations into the 392-version live Production ledger or alter Tandar. See `docs/qa/oa5-test-rebuild-method-b-retained-auth-2026-11-11.md` and governance PR #223.
