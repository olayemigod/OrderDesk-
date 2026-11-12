# OA5 — clean canonical migration replay verified in disposable Database CI

**Status:** **PASS, narrowly scoped to a clean local canonical schema**, not a hosted Test reconstruction approval, archive-to-current restoration, OA5 runtime acceptance or any Production operation.  
**Evidence date:** 11 November 2026.  
**Exact passing database source SHA:** `a374ad44d6688e6696b19bfc78288e4c8d58dd44`.  
**GitHub workflow:** `Database CI`, run `43063834654`, job `130673336770`, conclusion `success`.

## What actually ran

The repository `.github/workflows/database-ci.yml` provisions the local-only `sellertray-ci` Supabase project using `supabase/setup-cli@v1` version `2.117.0`. CI starts a **database-only, disposable Supabase stack**, then calls `supabase db reset` to **replay every canonical source SQL migration on that local disposable database**. It then executes `supabase test db` (pgTAP), followed by `supabase stop --no-backup`. In the passing job, **both** “Replay all migrations” and “Run SellerTray database tests” completed `success`, as did all listed contract/security checks and stack shutdown.

The owner's independent source scan found **457** uniquely versioned canonical SQL files. The exact-head offline classification scanner also inspected **457** files and pinned the filename + SQL-content manifest SHA-256 to `6f8239cfd96108a2f70a69a2d7cf11540701f07a1c1a86449cadada11529d3c6`. A read-only GitHub comparison between the passing database source SHA and later source SHA `0b955ab696a9131573f6aad9b92b1dc7533bd01e` found **zero changes under `supabase/migrations/`** (only QA scripts, QA documentation and the OA5 Isolation workflow changed). Therefore the canonical migration corpus verified by the earlier successful local reset is unchanged by this OA5 classification work.

**Consequence:** a new paid hosted Test branch, a repeated manual 457-file clean-room replay and an extra local Postgres installation are **not prerequisites to prove the clean canonical database can be built from source**; this part already has passing actual execution evidence. Do not mislabel the source-only classifier's green check as the replay evidence; the separate **Database CI job** is the replay evidence.

## What is still NOT proved

1. **Historical standalone Test compatibility:** the currently hosted Test has **54** applied snapshot/import versions, of which **52** do not match canonical source names/versions; 452 canonical source migrations predate its current high-water mark. A clean local canonical reset is **not** proof that `supabase db push`, `supabase migration repair`, or incremental replay can safely update that existing hosted schema. These operations remain **prohibited**.
2. **Restore/migration coexistence:** the separately verified 07 November encrypted Test archive and disposable PostgreSQL restore represent the **historical Test snapshot**, not the clean 457-file source-built schema. The two results cannot be combined without a **reviewed local data-evidence preservation and clean-baseline transition plan**.
3. **OA5 versus interleaved C2:** the inclusive filename classifier shows **24 OA5 / 17 C2 / 36 unclassified** files among **77** files between the earliest OA5A and latest OA5 installer file. Source inspection of C2 Plan Profile/Branch Subscription/resolver foundations shows they claim to be additive and parallel to the legacy Business subscription runtime; other C2 files modify C1 validation/pricing contracts. Full behavioral compatibility, server entitlement, role access, and safe non-activation of C2 require explicit tests and human review. A clean canonical CI schema may contain additive C2 tables without necessarily switching runtime authority; **this must be proven, not assumed**.
4. **External provider containment:** Meta/WhatsApp, Paystack, Flutterwave, SMTP, Test Firebase/FCM, AI and worker egress are not independently accepted end-to-end. No notification/payment/provider callback may be sent to a Production merchant as part of OA5 QA.
5. **Hosted Test managed state:** Auth users/sessions, Storage, four still-ACTIVE scheduled jobs, zero-at-observation HTTP queue and 5 historical Test Edge functions are independent managed resources. A SQL-only `db reset` is not a reviewed cleanup/recovery procedure for them.
6. **OA5C/C2 proof:** synthetic clean-schema pgTAP does not replace the required controlled real-merchant governed lifecycle proof or authorize legacy runtime retirement.

## Next implementation batch

**Do not ask the operator to repeat the already successful clean all-migration Database CI test.** Build a specific **no-live-provider, disposable-local OA5 legacy-runtime compatibility acceptance** on the canonical 457-file replay: confirm that governed first-purchase/activation, installation permissions, universal Master Agreement and Order Form, pricing/discount, customer optional phone, Branch entitlement boundaries, invoice/payment idempotency, UOM/stock and notification/read models continue to use the approved shared Business/Branch authority during the pre-C2 stage. Detect and fail if any C2 new Branch Subscription authority silently becomes runtime truth. Keep existing report, WhatsApp and offline contracts in the same read-model acceptance.

Only after a complete local rehearsal and separately accepted provider-safe reconstruction plan can a precise hosted Test-only maintenance/cleanup operation be proposed for independent owner authorization. **Production, Tandar, existing domains and running workers remain untouched**.

## Cross-surface impact

This document records existing passing offline CI evidence. No domain logic, application client, product or database was changed. QA source-only scripts and tests merely classify migration names and content hashes. There is **no new APK, preview, Supabase paid branch, hosted SQL mutation, cron pause, provider callback or Production/Tandar operation**.
