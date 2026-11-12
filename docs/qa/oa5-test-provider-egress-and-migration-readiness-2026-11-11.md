# SellerTray OA5 — external egress and canonical migration readiness, 11 November 2026

**Decision:** Continue **read-only** isolation proof. Do **not** pause jobs, reset/clean Test, deploy Edge functions, create QA previews, build an APK, send callbacks or touch Production/Tandar.

**Identity and environment:** All hosted reads below were targeted exclusively at the existing Agreement Test Supabase project `iukgsukdoowvnhlfmpml`. The current governing architecture still has two persistent environments, and the legacy Business/trial runtime remains Production authority until OA5 controlled acceptance and C2 authorization.

## 1. Test Edge function metadata and bundled-source inspection

Using read-only connected Supabase operations, inspected the metadata and accessible bundled source files for all **five** current Test Edge functions:

| Function | Version | JWT verification | Frozen metadata identity |
| --- | ---: | --- | --- |
| `master-agreements` | 6 | Enabled | **MATCH** |
| `commercial-agreements` | 4 | Enabled | **MATCH** |
| `agreement-pdf-runtime-probe` | 5 | Enabled | **MATCH** |
| `platform-admin` | 5 | Enabled | **MATCH** |
| `platform-admin-settlement` | 4 | Enabled | **MATCH** |

The provider-reported **version, ACTIVE status, verify_jwt setting, and published bundle SHA-256** for each one matched `scripts/qa/oa5-test-edge-bundle-drift.mjs` (**5/5 metadata PASS**). The fetched bundled source files contained **no literal Production Supabase project reference**. The checked code used environment-variable configuration; the `platform-admin` and `platform-admin-settlement` bundles include `fetch` calls. This is **NOT** proof that the configured runtime secrets, provider endpoints, or dynamically constructed URLs point to sandbox services. No function was invoked, redeployed, or asked to send a payment/message.

The earlier read-only PostgreSQL worker census still shows **two** `SECURITY DEFINER` notification/push dispatchers which can enqueue `net.http_post`, with matching `prosrc` hashes and zero private runtime URL rows at that observation. **All four cron jobs remain active** and may schedule work after a point-in-time empty queue; Test is **not quiescent**.

### Provider isolation decision matrix (unverified means NO-GO)

| Provider boundary | What can be asserted now | Missing mandatory hosted evidence |
| --- | --- | --- |
| Meta / WhatsApp | Dedicated Test app/phone identifiers are documented in governance; read-only SQL outbound dispatchers lack configured private URLs | Confirm ownership, dedicated Test signing secret/token, webhook route, recipient isolation and no Production callback fan-out |
| Paystack | No payment was initiated; no frozen 5-function bundle contained a literal Production project ref | Test keys and callback/replay destination scoped solely to Test, duplicate-safe sandbox verification |
| Flutterwave | No payment was initiated | Disabled or strictly sandbox-only Test configuration and callbacks |
| Email / SMTP | No message was sent | Verified Test-only sender/sink, safe recipient allowlist, activation/invitation URL and Auth redirect policy |
| Firebase / FCM | Existing separate Test Firebase app identity previously documented; no push was sent | Test-only push sender/service account, QA device isolation, no Production tokens |
| AI/notifications | Source and SQL metadata assessed; no worker invoked | Environment secrets, egress destinations, worker timeout/retry sinks and provider-side delivery containment |
| Test Auth/Storage | Aggregate counts match managed-state baseline; exactly one reviewed post-archive Auth session difference persists | Scope of session loss, Storage and Auth recovery, live redirect/domain protection after approved QA binding |

Do **not** label any of these providers as verified merely because a secret is present, `verify_jwt` is enabled, or no literal endpoint appears in a source file.

## 2. Existing Test migration history — historical snapshot, not current canonical parity

Connected read-only Supabase migration listing returned **54 unique applied versions**, from `20261026234514` through `20261104214453`. Of these, **18 are historical `sellertray_schema_batch_...` versions** and 36 have other names. This is the previous Agreement Test reconstruction history. These metadata facts do not prove that the canonical repository `supabase/migrations/*.sql` sequence is already present, nor that replaying just the newer files would be safe. A forward-only migration ledger can silently skip a later-added migration with a timestamp older than its current maximum.

**New source-only safety utility:** `scripts/qa/oa5-test-migration-order-census.mjs` and focused synthetic regression tests. The utility scans the operator's **local** canonical SQL migration directory for 14-digit version syntax, invalid filenames, and duplicated source versions. If provided a private, Test-only applied-ledger snapshot with exactly `schema_version`, `project_ref`, and `migrations:[{version,name}]`, it reports only counts of overlapping, missing, pending and **retroactive unapplied** versions. It never reads SQL bodies, prints migration names, contacts Supabase, changes ledger rows, executes SQL, or grants direct migration/rebuild authorization.

**Operator source-only census:**

~~~powershell
git -C "$Source" pull --ff-only
$MigrationScan = Join-Path $Source "scripts\qa\oa5-test-migration-order-census.mjs"
$MigrationDir = Join-Path $Source "supabase\migrations"
node "$MigrationScan" --scan "$MigrationDir"
~~~

Output from this local source scan is **not** proof of hosted migration parity. The applied Test ledger was read via connected Supabase; do not copy project secrets, data rows or environment credentials into a public repository or CI. A private applied-ledger comparison can be performed in a separately controlled operator workflow, but its snapshot must never be committed to Git.

## 3. Restore/protection conditions

The original five Preview compiled-application custody remains **PASS within its defined 38-file local Test-backend and SHA-256 scope**. Previously accepted 09 November Vercel owner browser checks and current Merchant/Admin Standard Vercel Authentication metadata are preserved. Separate full historical reviewer/browser-runtime and future Test custom-domain checks remain open.

The Test backup's existing encrypted copy/checksum observations and aggregate archived schema/data counts are **not** a substitute for the `oa5-test-backup-manifest.mjs` requirement of an independently verified disposable-local restore and exact restore counts. The original archive has 5 Auth sessions and current Test still has 6; the user approved only the precise +1 Test-only session loss **conditional on a separately authorized rebuild**, not its deletion now.

**Nonnegotiable stop line:** until provider callback/sink containment, restore, exact migration ordering, Auth/Storage, cron quiescence and the exact preflight evidence all pass, the OA5 hosted Test reset is **NO-GO**. C2 remains behind OA5 controlled lifecycle acceptance. All production customer activity and Tandar remain on the existing Production backend.

## 4. QA and cross-surface impact

This continuation adds a **read-only local migration inventory tool and documentation**, not a new business rule. QA synthetic tests cover duplicate/invalid version names, forward-only retroactive timing hazard, Test snapshot record validation and no source/SQL/path disclosure; the OA5 Isolation workflow runs them. No shared-commerce schema, migration, payment, Merchant Web, Admin Web, Mobile, WhatsApp, AI, reporting, printing, POS, inventory, offline/sync or production runtime behavior changed. There is no new preview/APK/billing requirement. All provider-side behavior and entire app runtime remain subject to later hosted acceptance.

## 11 November 2026 — canonical source migration filenames verified locally by owner

Owner executed `node "$MigrationScan" --scan "$MigrationDir"` against the exact checked-out QA candidate source and returned:

- **457** canonical SQL migration files detected.
- **Local naming and version uniqueness PASS**; no invalid filenames, duplicate versions, or unsafe directory entries reported by this scan.
- **Applied ledger comparison NOT RUN** in this invocation (all overlap/missing/retroactive fields `null`).
- Restore, hosted ledger parity, direct replay and destructive authorization all **false**.

The current connected read-only Test migration provider inventory independently lists **54** applied historical migration versions, 18 from the special standalone Test `sellertray_schema_batch_*` import sequence and 36 named Test history changes. **Do not assume 457 - 54 = 403 pending canonical migrations.** Some historical Test versions may have no matching canonical source file; some canonical files may be retroactive relative to the latest Test migration; a full version-level reconciliation is required before selecting a replay strategy.

A private, dated JSON ledger snapshot generated from this read-only Supabase list is being delivered directly to the owner **outside Git**, to run the source utility's optional third argument. This file contains only the 54 migration version/name pairs, Test project identifier, and snapshot schema; it contains **no database password, URL, user identities, JWTs or migration SQL**. Do not put this private snapshot in Git, public issue comments or Vercel preview artifacts. The filename of that private artifact is intentionally not an input to CI.

**Follow-up operator-only read-only check:** `node "$MigrationScan" --scan "$MigrationDir" "$LedgerPrivate"`. If any `HISTORICAL_APPLIED_VERSION_NOT_IN_SOURCE` or `FORWARD_ONLY_MIGRATION_ORDER_HAZARD` code appears, **stop any direct current-Test migration replay**. Even if counts happen to match, archive/restore and full schema parity remain separate requirements. No production state or Test data was mutated by this check.


## 11 November 2026 — actual 457-source versus 54-Test-ledger reconciliation: direct replay HARD BLOCK

**Owner-operated local private ledger comparison** using \`node "$MigrationScan" --scan "$MigrationDir" "$LedgerPrivate"\` and the privately preserved SHA-256-verified 54-entry Test ledger returned:

| Measured version category | Exact count |
| --- | ---: |
| Canonical repository migration filenames | **457** |
| Historical applied Test migration versions | **54** |
| Same numeric migration version on both sides | **2** |
| Historical Test versions absent from current canonical source | **52** |
| Canonical source versions not recorded in Test ledger | **455** |
| Unapplied canonical source versions older than the Test ledger's highest version | **452** |
| Unapplied canonical source versions newer than the Test ledger's highest version | **3** (derived: 455 minus 452) |

Original CLI reported the three **blocking codes**: \`HISTORICAL_APPLIED_VERSION_NOT_IN_SOURCE\`, \`FORWARD_ONLY_MIGRATION_ORDER_HAZARD\`, and \`CURRENT_SOURCE_NOT_YET_APPLIED_TO_TEST\`. This is decisive evidence that the existing Agreement Test project has a **historical snapshot/import migration ledger**, not a canonical 457-file applied ledger. These counts represent migration-version records, **not** the number of missing tables/functions or SQL changes: snapshot batches may include logic now present in multiple canonical files. Do **NOT** attempt \`supabase db push\`, bulk migration repair/mark-as-applied, forward-only update of the existing project, or replay of all 457 source files. Neither a filename match nor a count proves equivalent SQL/schema; even the two common numeric versions require name/content comparison before being treated as comparable history.

**Diagnostic wording correction in the same draft PR:** the first version of the tool returned \`local_naming_and_uniqueness_passed:false\` merely because *historical Test ledger mismatches* shared its error accumulator. This incorrectly suggests the 457 source filenames failed structural validation. The tool and synthetic tests now distinguish \`local_naming_and_uniqueness_passed\` (the original source-only PASS), \`local_applied_ledger_reconciliation_passed\` (false), numeric-version overlap, exact version+name matches, version/name collisions, and newer-versus-retroactive unapplied source versions. CLI remains **nonzero/fail-closed** for any ledger drift. The previous 457 source-only PASS remains valid; this is a correction to the reporting taxonomy, **not** a waiver of the migration-replay block.

**Reconstruction decision boundary:** the result supports evaluating a **separately authorized and rehearsed Test-only reconstruction**, rather than attempting to repair the 54-entry ledger in place. Do not select the exact cleanup mechanism, drop/reset schema, discard managed Auth/Storage or mark migrations until the protected OA5 archive/restore, Test-only provider/ingress freeze, named four-cron reversible pause, exact target/source migration subset and interleaved C2 boundary, rollback/recovery and permission/audit evidence have been reviewed. The earlier 07 November disposable PostgreSQL restore/checksum proof is already recorded; preserve and validate its scope rather than demanding that the owner repeat identical work without a specific new reason. C2 Production authority remains blocked by OA5 controlled acceptance. Production/Tandar are excluded from the entire reconstruction decision.

**Next local read-only diagnostic after source update (optional, no new private files):**

~~~powershell
git -C "$Source" pull --ff-only
node "$MigrationScan" --scan "$MigrationDir" "$LedgerPrivate"
~~~

Expected: source naming PASS, applied-ledger reconciliation FAIL, 457/54/2/52/455/452, 3 newer source versions; the new version+name match/conflict counts will clarify the two overlapping version IDs without revealing names or SQL. A nonzero exit is **expected** and correct. It is **not** a request to keep retrying the same blocked migration operation.

