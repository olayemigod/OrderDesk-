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


## 11 November continuation — executable clean-schema legacy-Auth quarantine regression

Added `supabase/tests/oa5_historical_auth_quarantine_on_canonical.test.sql` to the existing disposable-local Database CI (no separate manual 457-file replay). It creates two synthetic Auth identities and a synthetic merchant, Branch, customer and manual order within a rolled-back pgTAP transaction. Tests deliberately run under the `authenticated` PostgreSQL role (not the `postgres` RLS bypass role) with two different JWT sub values.

The approved merchant owner must be able to read their own synthetic commerce records. The other identity represents a pre-existing managed Auth account retained after a schema reset **without** any new `tenant_members` link; its RLS views of the merchant, Branch, customer and order and its current-user Branch access/read helpers must all deny. Reverting JWT sub to the owner must restore the authorized order read. This is an **actual clean-schema behavioral test**, not evidence that already-hosted historical users are quarantined. It does not test real Test Auth sessions/JWT revocation or prevent an administrator from later re-granting a historical user membership.

Before any hosted Test reconstruction acceptance, perform a **separate read-only historical identity-to-canonical membership census** and a provider/URL/Domain/Auth redirect review against the live Test project, with no historical user login or real-message test until ingress and recipient isolation pass. Managed Auth remains retained pending separate approval; old Previews remain preserved. Neither this regression nor the private transition-record guard authorizes reset, cron freeze, Auth deletion, C2 cutover or Production change.

## Follow-up: observed historical Test Auth grant lineage

The historical Test now has a count-only, read-only Supabase census dated **2026-11-11 19:51:31 UTC**. It confirms **5 Auth users / 6 sessions, 3 tenant membership rows belonging to 3 Auth identities, 3 Platform Admin rows belonging to 3 Auth identities, 0 Branch-user access records, 0 member/admin capability grants, 3 Businesses, 3 Branches, 5 Agreement Packages and 54 historical migration rows**. This is *current historical Test authority*, **not** post-rebuild Auth quarantine.

The new offline guard `scripts/qa/oa5-test-historical-auth-lineage.mjs` checks a newly captured protected count-only snapshot (no UUIDs, email addresses or credentials) against these frozen evidence counts and refuses unrelated project IDs, unknown fields and stale snapshots. It is a **pre-rebuild drift guard**. Its review is an independent required input to the combined Test rebuild preflight. It does **not** verify that any old Auth identity has lost historic or newly created merchant access. The disposable canonical regression verifies only a synthetic orphan actor. Actual post-rebuild old-actor membership and administrator links require a separate controlled, identity-cohort-aware check and fresh hosted Auth/Storage/callback safety review before synthetic QA acceptance.

**Additional live Test-only identity-overlap census (read-only, count-only):** all five historical Auth identities have at least one historical business-membership or platform-admin row; **one** has both. The baseline checker therefore now guards the distinct total **5** and overlap **1**, not just the two independent sets of three. This establishes historical authority exposure needing explicit post-rebuild identity-cohort checks; it is not a sign of a Production security issue or evidence of any current cross-business policy failure. No identity/UUID/email or customer record was returned.
