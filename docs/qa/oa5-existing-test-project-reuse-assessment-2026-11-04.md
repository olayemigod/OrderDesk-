# OA5: existing Supabase Agreement Test project reuse assessment

**Assessed:** 04/11/2026. **Scope:** read-only inventory and deployment planning. **Status:** conditional reuse candidate; **NOT** an accepted OA5 staging target. No project reset, branch creation, production migration, configuration change, APK, or deployment performed.

## Decision and non-negotiable safety boundary

Prefer **two persistent SellerTray environments** rather than a third continuously running branch when the existing standalone QA project can safely be rebuilt and dedicated to Test/Staging:

- **Production (live):** Supabase `eujxswjspolugrzlsjnn` (`OrderDesk`). Real merchants, credentials, commercial obligations, payment and WhatsApp traffic. Do not mutate for QA.
- **Candidate Test/Staging:** Supabase `iukgsukdoowvnhlfmpml` (`SellerTray Agreement Package Test`). Currently only agreement-test specific, not a general staging backend. Retain its project identity *only if* the future approved rebuild path supports that without insecure migration-history repair.
- **Legacy inactive project:** `snojanrejvymalwofhys` (`olayemigod's Project`). Do not delete until external references, storage, users and any recoverable data have been checked. Database migration listing timed out while inactive.
- **Ephemeral/local CI:** continue clean-history PostgreSQL/pgTAP and source-contract checks. Do not confuse a permanent shared staging database with fresh empty-database reproducibility.

This is a proposed lower-incremental-cost release architecture, **not authorisation** to wipe or reset existing QA data. A permanent active test project can still incur ordinary Supabase project/usage charges. The quoted alternative Supabase branch compute rate in PR #209 was USD 0.01344/hour **plus** usage; no new branch should be created without separate cost approval.

## Read-only inventory evidence (04/11/2026)

| Check | Live production | Existing Agreement Test |
| --- | ---: | ---: |
| Applied migration entries | 389 | 52 |
| Latest applied migration version | `20261102100606` | `20261101203725` |
| Tables in `public` | 141 | 132 |
| Functions in `public` | 548 | 479 |
| Storage buckets | 4 | 3 |
| Auth users | 10 | 5 |
| Business Branch rows | 13 | 3 |
| Sales order rows | 51 | 0 |
| Commercial order rows | 7 | 5 |
| Agreement Package rows | 5 | 5 |
| Order Form Confirmation rows | 5 | 5 |

The test migration ledger uses `sellertray_schema_batch_001` through `..._018` plus test-specific rebuild, quarantine, master/agreement proof and compatibility fixes. It is **not** an in-order reproduction of the 389-version production migration ledger. The test schema contains `*_stale_pre_oa5c` quarantine tables and other historical proof artefacts absent from current production. It is not safe to relabel the project as production-parity, spoof the migration ledger, selectively `db push`, or assume clean migration replay from its current state.

Observed test Edge Functions: `master-agreements`, `platform-admin`, `commercial-agreements`, `agreement-pdf-runtime-probe`, and `platform-admin-settlement`. This is insufficient for complete merchant, mobile, installer, printer, and WhatsApp acceptance. The live project has a wider function set.

Vercel **URL variables** were checked without reading or reporting any publishable or server secret keys. The following branch-specific **Preview** `VITE_SUPABASE_URL` values resolve to **the existing Agreement Test project** (`iukgsukdoowvnhlfmpml`): `sellertray-merchant` branches `codex/agreement-package-architecture` and `codex/agreement-package-oa5c-convergence`; `sellertray-admin` branches `codex/agreement-package-architecture`, `codex/agreement-package-oa5c-convergence` and `fix/admin-visual-baseline-oa5-convergence-20261031`. Both apps' default Production/Preview `VITE_SUPABASE_URL` variables resolve to **live** (`eujxswjspolugrzlsjnn`). **Do not reset QA** until these five preview dependencies and any needed historic agreement/visual QA are retired, rebuilt or deliberately rebound, including auth redirect allowlists and service callbacks. Preserve all agreement-test evidence needed for PR/release audit. The default Preview binding to production is itself a future QA safety concern: a new governed QA preview must use a separate branch-scoped non-production binding and must not silently fall back to production.

## Approved test-merchant policy — 04/11/2026

Use **dedicated synthetic merchants** on the eventual verified SellerTray Test/Staging backend for all OA5/C2 Mobile acceptance. Keep live merchants (including Tandar Oil Solutions) on the current production project and production-bound installed mobile app, with no interruption or redirection. No live merchant data or credentials may be copied into the test project.

Proposed minimum reusable fixture coverage: (a) a single-Branch merchant for first registration/agreement/payment/setup/activation, (b) a multi-Branch merchant with two independently governed Branches and Owner/Manager/Cashier permissions, (c) a suspended/unready Branch with denied operational actions, and (d) an appointed ProcessEdge Installer identity separate from every merchant Team. Seed fictional products, UOMs, stock ledger, customers (including optional phone), unpaid/partial/full sales, sandbox payment events, registers and printers. Use test-only notification sinks; never route tests to real WhatsApp numbers or customer email. Record each fixture's test purpose, relevant build SHA, exact hosted project ref and reset strategy.

Do **not** create these merchants yet: the existing Agreement Test project is not an OA5-capable general staging target until archive, explicit reset approval, clean rebuild and deployment attestation are complete.

## Controlled conversion sequence — no destructive execution authorised

1. **Dependency and retention inventory:** identify Supabase Auth users, active sessions, test-only tenant records, agreement proof rows, Edge function versions, Storage objects, preview URLs, app callbacks, branch-scoped Vercel variables, CI/environment secrets, and scheduled webhook/email/notification jobs. Identify owners and external dependencies.
2. **Protected archive and recovery check:** export a secure, access-controlled test-only database/schema + storage/artefact inventory and the minimum audit evidence needed for OA5/PR176 agreement proofs; verify a restore path without exposing credentials or importing customer data into source control. Preserve test run identifiers separately. Do not copy production users, payments, customers, Meta tokens or private files.
3. **Explicit destructive-change gate:** obtain a separate, specific approval to reset/rebuild the candidate QA database once the archive and dependency check pass. If reset cannot preserve the independent project reference reliably or the canonical migrations cannot replay, stop and evaluate a fresh independent test project or a quoted paid branch. Never rewrite migration-history rows to pretend parity.
4. **Rebuild from canonical source:** establish the precise reviewed release candidate and apply the full ordered migration set to a clean target, then seed synthetic Businesses/Branches/commercial obligations and test accounts. Observe the PR #209 production migration boundary: 17 C2 foundations and 16 OA5/pre-C2 migrations follow the deployed production ledger; an automatic combined **production** push is forbidden. A clean test rebuild is not approval of C2 cutover.
5. **Deploy only safe test infrastructure:** use separate Supabase publishable keys and server secrets; deploy current reviewed Auth/RLS/Edge contracts (especially setup installer, printer, platform admin, merchant setup), then configure sandbox-only payment providers and inert/test sinks for WhatsApp, email, webhook, storage, push and other external effects.
6. **Rebind every QA client:** explicitly target the test ref from a distinct QA build of Mobile (not the existing production-bound Build 47), protected Merchant Web Preview, and protected Admin Web Preview. Maintain production routing and secrets untouched. Verify build/source SHA, embedded API origin, auth redirects and AAL2. No environment-switch fallback to production.
7. **Pass QA and retain evidence:** canonical migration list, pgTAP, RLS/grant and function parity, clean-history replay, allowed/denied tenant/Branch scenarios, financial idempotency, printer hardware and immutable installer evidence, Merchant/Admin visual baseline, no outbound live WhatsApp/payment/customer notifications, human OA5 acceptance. Record exact SHA and build IDs.
8. **Optional legacy-project retirement:** investigate the inactive `snojanrejvymalwofhys` project only after connectivity, secrets/URLs and data-retention dependencies are proved safe; deleting it is a separately authorised irreversible operation.

## Existing PR #209 guard and QA APK are intentionally blocked

`scripts/qa/oa5-staging-isolation.mjs` currently rejects `iukgsukdoowvnhlfmpml` outright because it has the divergent agreement-test ledger. **Do not remove that fail-closed check just to make the old test URL pass.** When the independent project is demonstrably rebuilt, add a *separate reviewed code change* to allow a specifically attested standalone test project without weakening production URL/key rejection or QA APK source matching. Preserve the negative tests until the attestation changes. The existing Build 47 EAS QA profile targets the production Supabase URL and is not a staging acceptance build.

## Release state and cross-surface impact

- **OA5:** staging and real hardware/human lifecycle acceptance remain pending; this plan is not operational readiness.
- **C2:** production Branch-subscription cutover remains blocked pending OA5 acceptance or an explicit later override; legacy Business/trial compatibility stays authoritative.
- **Shared core:** read-only comparison only; no schema/permission/ledger change.
- **Mobile:** separately identified QA APK and exact target proof required; existing Build 47 unchanged.
- **Merchant Web / Admin Web:** separate preview environment binding and visual/MFA acceptance still required; current production and preview builds unchanged.
- **WhatsApp / AI / integrations:** no current mutations; sandbox-sink verification is a prerequisite to staging activation.
- **Reporting/audit:** preserve existing Agreement Package proof and immutable OA5 evidence.
- **Offline/sync:** no runtime change; retry and idempotency acceptance still required.

**Current next bounded gate:** finish preview/environment dependency inventory and evidence archival plan; obtain explicit approval before any QA reset. There is no approval or requirement yet for a paid Supabase staging branch.
