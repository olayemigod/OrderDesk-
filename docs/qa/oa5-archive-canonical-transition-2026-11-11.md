# OA5 historical Test evidence -> canonical Test transition review

**Date:** 11 November 2026. **State:** source-only review guard added; no hosted transition or archive-to-canonical business-row parity attested. **Project in scope:** existing Agreement Test `iukgsukdoowvnhlfmpml`; Production `eujxswjspolugrzlsjnn` and Tandar excluded.

## What the two passing tests do and do not establish

The 457-migration disposable clean Supabase replay (202 database test files / 3,001 assertions) proves the current canonical SQL corpus can construct a **new** database. The separate 07 November encrypted historical Test archive and disposable PostgreSQL restore establish custody of the **old** Agreement Test state. **Neither passes historical business records into the canonical schema.** The 54 historic ledger rows (52 absent from canonical source, 452 backdated canonical migrations) make direct in-place `db push` or fabricated migration repair unsafe.

The selected **review candidate** is deliberately **archive-only** for legacy evidence and **synthetic-only** for future QA businesses. Old Agreement Packages, Order Form confirmations, commercial orders, Platform Admin audit events and migration history remain encrypted archive evidence rather than being silently imported as current merchant/business truth. **Managed Auth/Storage must remain hosted pending a separate supported-operation review, and historical Edge deployments plus Vercel Previews/reviewer access must remain preserved.** An SQL archive alone cannot restore Auth credentials, MFA and hosted reviewer access. This preserves the approved legacy Business subscription runtime until separate C2 acceptance. It does not change a merchant record.

## Offline operator review, no additional manual canonical replay

`scripts/qa/oa5-archive-canonical-transition.mjs` provides a fail-closed, private **disposition and custody review**, not a data-copy or schema converter. It checks:
- Original five-file restore manifest using existing archive checker; reviewed historical category counts (including 54 ledger rows, five Agreements, five Order Forms, five commercial orders, 14 admin audit events, five original Auth users/sessions, three buckets/zero objects, five deployed Edge functions, five original Previews).
- Exact current local source commit SHA and **content** fingerprint of all 457 canonical SQL migrations (reuses existing source inventory; no SQL printing).
- Privately recorded independent source CI / pre-C2 coexistence review, with distinct evidence refs for historic classes and the clean-room rehearsal.
- Mandatory zero legacy SQL imports, reused Auth identities, provider destinations or Storage objects; immutable historic migration ledger custody (never spoof/repair); synthetic-only QA fixture policy. **Dispositions differ:** SQL evidence encrypted/archive-only, managed Auth/Storage retained pending supported separate review, and historical Edge functions/Previews retained with bundle capture and reviewer continuity. No accidental removal of managed/reviewer access.

For a later protected operator review, retain a private JSON record outside Git with keys `schema_version`, `project_ref`, `purpose`, `source`, `preservation`, and `transition` matching the checker schema. Reuse the **existing** protected archive and source checkout, not a second production backup:

```bash
node scripts/qa/oa5-archive-canonical-transition.mjs --check \
  /private/transition-review.json /private/existing-unpacked-test-archive supabase/migrations
```

The private record should reference independently inspected CI results and archive/Preview/Edge custody evidence, not contain SQL rows, agreement PDFs, user names/emails, keys or endpoints. This checker does not verify actual CI logs itself; a reviewer must verify the pinned run/SHA. It does not reconstruct a live database and cannot certify managed Auth/Storage or third-party safety. A green result is **review package consistency only**.

The existing **rebuild preflight** now also requires this transition review as an independent gate. It does not relax the four-job cron pause requirement, fresh Test-only census, protected historical reviewer access, exact hosted cleanup/rollback method or external provider/SMTP/Paystack/Meta/Flutterwave/FCM/AI egress acceptance.

## Still blocked

Hosted cleanup/reset, migration-ledger rewriting, Auth deletion, Storage deletion, Edge deployment, Test cron pause, QA Vercel Preview/APK, C2 cutover and any Production/Tandar changes remain **NOT AUTHORIZED**. Before a hosted Test execution proposal, the operator must separately prove the chosen managed Auth retention-versus-decommission strategy, review source-dependency/permission/commerce parity and sandbox-provider boundaries, choose and rehearse exact cleanup semantics locally, and obtain an exact Test-only authorization. Historical archive-only retention must not be represented as migrated old business activity into new reports or subscriptions.

**Impact:** QA scripts, tests, CI gate and evidence documentation only. No production or hosted change, Android build, paid branch or preview is needed for this step.
