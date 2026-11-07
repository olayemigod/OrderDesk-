# SellerTray OA5 Test project — archive and rebuild operator handover

**Verified:** 04/11/2026 (dd/mm/yyyy); read-only baseline refreshed 06/11/2026. **Mode:** read-only due diligence only.
**Approval state:** **BLOCKED**. This document is NOT a backup, a reset approval, a staging attestation or permission to deploy.
**Source dependency:** Build 47 PR #214 (candidate `7433447b7ac84931ba320a2155207af3ff9427e0`), based on environment PR #209. Follow `ENVIRONMENTS_RESOURCES.md` and `oa5-existing-test-project-reuse-assessment-2026-11-04.md`.

## Project separation and fixed protections

- **Production:** `eujxswjspolugrzlsjnn` — all actual merchants including Tandar; never run staging tests, reset, reprovision or replace mobile configuration here.
- **Candidate reusable standalone Test project:** `iukgsukdoowvnhlfmpml` — SellerTray Agreement Package Test, `ACTIVE_HEALTHY`, region `eu-west-1`, Postgres 17.
- This is an independent *project*, **not** a child Supabase branch of Production. Do not claim or set `parent_project_ref` for it.
- Neither the old `qa` APK nor its EAS profile is isolated: both point to Production and use package `ng.processedge.sellertray`. Only an attested `qa-staging` build may use independent package `ng.processedge.sellertray.qa`, nonproduction publishable key and Firebase registration.
- The Test project still has 54 historical, agreement-specific migration ledger entries (latest `20261104214453`) and cannot be treated as canonical migration parity. **Never spoof migration versions or do a bulk production `supabase db push`.**

## Repeatable pre-archive read-only baseline

The following were rechecked through the connected Supabase read-only interfaces, with no personal records exported:

| Evidence category | Current count |
| --- | ---: |
| Public tables / functions | 132 / 479 |
| Applied migrations | 54 |
| Synthetic/test-labelled Businesses / Branches | 3 / 3 |
| Auth users / sessions | 5 / 5 |
| Historical Platform Admin audit events | 14 |
| Commercial orders | 5 |
| Agreement packages / Order Form confirmations | 5 / 5 |
| Storage buckets / objects | 3 / 0 |
| Deployed Agreement Test Edge functions | 5 |

Current Edge slugs: `master-agreements`, `platform-admin`, `commercial-agreements`, `agreement-pdf-runtime-probe`, `platform-admin-settlement`. These are not sufficient for OA5 operational/device/installer acceptance.

The counts above are **inventory metadata, not a recoverable archive**. They do not prove that all records are disposable or that email/auth/provider destinations are inert. Do not commit names, email addresses, OAuth/session tokens, database credentials or the backup itself to Git.

## Archive and recovery actions — operator-owned, NOT executed

1. **Freeze the external dependency map.** Capture the five historical agreement-specific Vercel Preview bindings documented in `oa5-existing-test-project-reuse-assessment-2026-11-04.md`, including exact deployment/source SHA, preview URL, credential/callback owner and whether the artifact must remain accessible. Verify auth redirect settings, templates, Edge secrets, provider callbacks, scheduled jobs, push and email sinks. Keep the existing previews available until their replacement/proof is signed off.
2. **Take a secure full logical database backup** of the *Test project only*, using the officially documented **Supabase CLI database dump workflow** rather than assuming one raw `pg_dump -Fc` is sufficient. The CLI applies Supabase-specific managed-schema/role filters; a raw `pg_dump` may capture internal roles and later fail during restore. With a verified Test-only session-pooler connection supplied privately by the operator and a secured destination *outside source control*, export separate `roles.sql`, `schema.sql` and `data.sql` files using `supabase db dump --role-only`, standard `supabase db dump` and `supabase db dump --data-only --use-copy`. Also separately dump the `supabase_migrations` schema and data to `history_schema.sql` and `history_data.sql`; historical agreement migration evidence must not be discarded. Check whether customised `auth`/`storage` schemas require additional diffs and preservation. Do not echo connection URIs, turn on shell tracing, upload SQL to CI or GitHub, or publish backup checksums together with identifying private data. Official procedure: https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore.
3. **Preserve non-DB resources:** Supabase deployed Edge source/version hashes, Auth configuration, URL/callback allowlists, storage bucket metadata, any objects and policy references (currently zero objects), test-only provider integrations and references to PR176/OA5 agreement proof. `pg_dump` alone does not back up the entire hosted service.
4. **Validate recoverability** by listing the archive contents and performing a restore rehearsal into a *local disposable isolated database*, not Production and not the standing Test project. Compare schema/table/function and critical agreement-proof row counts; record checksum, encrypted archive location, retention owner, restore result, UTC test timestamp and deletion/retention policy. Do not store the backup, credentials or actual customer data in GitHub.
5. **Document preview/auth remediation** for all five historical Vercel Preview branches, including login redirects, environment variables, Git branch tracking, default Preview variables pointing to Production and preserved PR149/PR158 visual proofs. A new preview must be deliberately approved and use independent Test bindings; no build should silently inherit a Production backend.
6. **Request explicit destructive reset/rebuild approval** specifying project ref `iukgsukdoowvnhlfmpml`, accepted archive/recovery evidence, expected user/session/ledger loss and the clean canonical migration/reseed plan. Until that approval is recorded, do not reset/rebuild, remove Auth sessions, delete tenant data or replace Edge functions.
7. **After approval only**, perform the reviewed clean rebuild and deploy the accepted OA5 Build 47 SQL/Edge package in order; verify function/RLS/grant parity, Test-only Auth keys/Firebase and sandbox message/payment endpoints. Turn the checked-in `oa5-staging-backend-attestation.json` to approved only with actual hosted evidence and an independent security review of the gate change. Populate *synthetic* test merchants using the reviewed fixture plan, never Production data.
**Test Auth callback acceptance:** After controlled staging rebuild, configure and verify the Test project's Auth redirect allowlist for **`sellertray-qa://auth-confirm`** (new-account email confirmation) and **`sellertray-qa://reset-password`** (password recovery). Build 47 derives these from the resolved isolated QA application scheme, while the Production app retains `sellertray://` and its existing legacy `orderdesk://` handling. Confirm both email link return paths on an installed `ng.processedge.sellertray.qa` APK, and verify that Test callbacks do not open the Production app or cross project boundaries. Never add the QA scheme to Production Auth configuration merely to make QA work, and never allow the QA app to consume Production session tokens. Auth URL allowlist/redirect verification is a hosted acceptance gate, not something source CI can certify.

8. **Acceptance then release:** perform Merchant/Admin preview baseline and physical Android 58/80mm printer, installer AAL2/branch, first-purchase/activation, POS/UOM/stock-cost and offline replay tests; keep OA5C and C2 cutover distinct. Generate only the milestone-authorised staging QA APK and later the separately approved Production Build 47.

## Operator archive checksums (offline; not reset approval)

After the separate Test-only SQL dumps and **actual** disposable-local restore rehearsal, the operator must retain an `archive-evidence.json` in the protected, encrypted archive directory, **not in GitHub**. It must record:

- `schema_version: 1`, `project_ref: "iukgsukdoowvnhlfmpml"`, `backup_completed_utc` and `restore_completed_utc` in UTC ISO form;
- `files` mapping exactly `roles.sql`, `schema.sql`, `data.sql`, `history_schema.sql`, `history_data.sql` to their actual `sha256` and byte sizes;
- `restore_target: "local_disposable"`, `restore_verified: true`, `secrets_committed_to_git: false` and `restore_counts` documenting the actual restored `auth_users`, `businesses`, `branches`, `commercial_orders`, `agreement_packages`, `order_form_confirmations`, `migration_rows` counts.

The read-only baseline counts at 04/11/2026 are **5, 3, 3, 5, 5, 5, 54** respectively. If the historical Test project changes, stop and refresh/review this baseline rather than falsifying the manifest.

The operator may check file integrity **locally** (never upload raw SQL to CI):

```bash
node scripts/qa/oa5-test-backup-manifest.mjs --check /path/to/secure-external-archive
```

This checker is strictly offline: it confirms the named files' checksums and presence of an operator-asserted restore comparison, but **cannot independently prove that a restore happened**. A reviewer must still inspect the actual restore log, recovery target, archive encryption, retention ownership, five historical Preview dependencies, callback/channel isolation and explicit reset approval before attesting staging. No backup or approval can be inferred from the script passing.

## Evidence sign-off (all unresolved at this checkpoint)

| Required proof | State | Evidence location / responsible reviewer |
| --- | --- | --- |
| Full encrypted Test backup and retention owner | NOT PROVIDED | Protected operator storage, not Git |
| Successful restore rehearsal | NOT PROVIDED | Disposable DB report and checksum |
| Historical agreement/PR proof retention | NOT PROVIDED | Agreement/QA operator |
| Five Vercel preview dependencies and auth callbacks reconciled | NOT PROVIDED | Vercel project operator |
| Explicit approval to reset/rebuild `iukgsukdoowvnhlfmpml` | **GRANTED 06/11/2026, conditional on independently verified recoverable archive and reviewed rebuild plan** | Product owner/release authority |
| Canonical clean migration/replay and safety attestation | NOT EXECUTED | DB/release reviewer |
| Independent Test Firebase/auth/provider sinks | NOT VERIFIED | QA/release operator |
| Build 47 exact-source QA APK + real hardware acceptance | NOT EXECUTED | Device QA |
| Controlled Production rollout/rollback sign-off | NOT GRANTED | Production release owner |

## Read-only review outcome

Reuse of the Agreement Test project remains the preferred **cost-conscious** design, with **no new paid Supabase project or branch required at this stage**. It is blocked on archival and independent archive/restore verification, not on missing app source code. Existing merchants remain on Production. There has been **no** data export, destructive operation, paid resource creation, deployment, APK build or tenant mutation during this assessment.


## 06/11/2026 owner decision and baseline refresh

The owner authorised archiving the existing Agreement Package Test evidence and rebuilding this **same Test project** as the persistent isolated Test/Staging environment. This is conditional on verifiable encrypted Test-only backup, successful disposable restore, preservation of the five historical preview dependencies and a reviewed rebuild sequence. It does not authorise any Production change, uncontrolled bulk migration, new paid Supabase resource or QA notification to real contacts. No destructive operation may proceed until the archive gate is independently attested.

The Test migration ledger advanced from 52 to **54** entries because the two PR219 security migrations were recorded; read-only verification on 06/11/2026 confirms 5 Auth users, 3 Businesses, 3 Branches, 5 commercial orders, 5 Agreement Packages, 5 Order Form confirmations, 5 Auth sessions and 14 Admin audit events. The offline archive checker and its synthetic tests now require 54 migration records, not the stale 52.

## 07/11/2026 recovery and hosted-readiness reconciliation

This section supersedes only the **as-of-04/11** evidence status above. It does
not erase the older audit trail, expand the 06/11 conditional owner approval, or
authorise a destructive Test rebuild. The same two-environment resource policy
and all production/live-merchant protections remain in force.

### Evidence now completed

- **Encrypted Test-only recovery archive:** 49 packaged files; encrypted
  `sellertray-test-recovery-package-oa5-20261107.tar.gz.gpg` size
  **2,908,531 bytes**, SHA-256
  `38b28dd9f8ef4ed35b69f85b1f97fa2f52829512f11ab1961de0a55056238616`.
  Five Supabase CLI-style SQL exports, their per-file checksums, separately
  captured migration history and a disposable, offline PostgreSQL 17 restore
  were independently verified. Archive bytes and credentials stay outside Git.
- **OneDrive-synced archive:** operator's Windows PowerShell `Get-FileHash`
  returned `ONEDRIVE_BACKUP_CHECKSUM=PASS` for the correctly named OA5 file;
  the earlier 2,184,506-byte package without `-oa5-` is a different archive
  and should not be deleted or substituted. A separately, freshly downloaded
  cloud-object checksum was not performed. The encrypted backup/restore gate
  therefore passes locally and on the synced OneDrive copy; cloud independent
  download proof remains distinct.
- **Consolidated source candidate:** draft PR #228, based on Build 47 integration,
  combines PR #226's two forward-only Branch/inventory audit-history repairs
  and its pgTAP suite with PR #227's three recovery-manifest changes. Source
  before this documentation update is
  `01b3b8776c01c7f9cb1890e510de09085f84d888`.
  Its source contains **457 uniquely versioned SQL migrations**.
  The exact prior source HEAD passed Database CI (full disposable local
  migration replay plus database tests), Mobile CI and OA5 isolation CI.
  Any subsequent document-only commit needs independent source-diff confirmation;
  do not silently carry exact-HEAD CI attribution to a different SHA.
- **Current Test baseline, read-only recheck:** 54 historical Test migration
  entries, 132 public tables, 479 public functions, five Auth users and five
  Auth sessions. Agreement proof remains archived; the existing hosted Test
  ledger is **not** the canonical 457-migration source ledger.

### Integration and dependency stop gates

- **Historical Vercel Previews:** the following are the five known branch-scoped
  agreement/visual evidence dependencies (latest READY deployment at this
  checkpoint, as returned by the Vercel API). Preserve audit/visual evidence
  before resetting data; do not use old builds for fresh Test acceptance until
  the compiled Supabase endpoint is independently certified.

  | Surface | Historical branch | Latest READY deployment ID |
  | --- | --- | --- |
  | Merchant | `codex/agreement-package-oa5c-convergence` | `dpl_Cfh7oAt9nHQkdUZtbXShj7jfhMfw` |
  | Merchant | `codex/agreement-package-architecture` | `dpl_Gh9s6Rm2dJibEKuBDDcm7jZ3bGmz` |
  | Admin | `fix/admin-visual-baseline-oa5-convergence-20261031` | `dpl_5UfqxbGpPuQqGkSu1rU4bpCFrQWZ` |
  | Admin | `codex/agreement-package-oa5c-convergence` | `dpl_H1suGYapnAjZR9rAKBq8WLtHu5Uo` |
  | Admin | `codex/agreement-package-architecture` | `dpl_J9nL3wiNKyXcJEoVjbb65kUw4JnA` |

- **Current Test database provider state:** read-only SQL returned **zero**
  WhatsApp connections, private WhatsApp credential rows, inbound webhook
  receipts, WhatsApp catalogue settings, merchant payment methods, billing
  payment authorisations, outbound notifications, merchant notifications,
  notification-worker invocations, runtime configuration rows and order payment
  events. These zero counts **do not prove** external Meta, Paystack,
  Flutterwave, email or Auth callback registrations are disconnected.
- **Scheduled work:** four active Test cron jobs exist: Agreement Package retry,
  merchant push retry, WhatsApp notification retry (each every minute), and
  usage settlement preparation (daily). Review and safely quiesce/reconfigure
  their Test-only execution as part of the explicitly reviewed cutover.
  Zero outbound runtime configuration is only a current safeguard, not a
  permanent reset-time guarantee.
- **Auth and separate devices:** Hosted Test redirect allowlist, Test site URL,
  SMTP/safe email destination, callback owner and login/logout continuity
  need fresh operator proof. Mandatory native return routes are
  `sellertray-qa://auth-confirm` and
  `sellertray-qa://reset-password`, never a Production auth redirect.
  A separately registered QA Firebase app for
  `ng.processedge.sellertray.qa` is required before a QA APK. Existing
  `qa`/Build 47 Android is Production-bound.
- **External integrations and secrets:** Test-only Meta/payment/API/email
  secrets, callback registrations, signing/verifier configuration and controlled
  notification sinks must be inventoried by the credential owners. Never read
  secrets into Git or a PR, copy live Meta/PSP/OpenAI credentials by convenience,
  or activate real-customer messages and payments for staging. Existing Test
  has only five agreement-scoped Edge Functions; operational
  WhatsApp/payment/parser/installer/printer functions are not yet deployed.
- **Current staging attestation:** `docs/qa/oa5-staging-backend-attestation.json`
  remains `state: "blocked"`. Do not mark it `verified` from source CI,
  archive success or Vercel environment correction alone.

### Reviewed execution sequence — STOP until outstanding gates close

1. **Evidence custody and preflight:** an independent reviewer accepts the
   encrypted archive, restore report, migration proof, historic Preview
   preservation/cutover record, Test Auth/callback inventory, QA Firebase plan,
   sandbox-only integrations, and four-cron-job quarantine plan.
2. **Exact-scope operator sign-off:** record the agreed disposable proof
   retention, expected **loss of the five existing Test Auth users/sessions**
   and agreement-specific hosted dataset, the reviewed Test-only
   cleanup/rebuild mechanism, exact reviewed source SHA, named operator,
   rollback owner and explicit execution approval. The owner approved
   same-project rebuild **conditionally on 06/11/2026**; that does not
   override the remaining STOP checks.
3. **Controlled Test-only cutover:** confirm Supabase project ref
   `iukgsukdoowvnhlfmpml` twice immediately before any write; no Production
   database connection, generic production `supabase db push`, migration
   ledger rewriting, or blind restore of historic Test rows into the new
   canonical schema. Quiesce Test workers/webhooks; execute the separately
   reviewed clean-schema migration plan in canonical order and verify actual
   hosted schema, migrations, policies, functions, grants, stock/Branch
   governance and audit-history immutability.
4. **Hosted acceptance (not yet executed):** deploy exact-source OA5-related
   Edge Functions with Test-only configuration, configure Auth links and
   external sandbox/mocked sinks, then seed only the governed synthetic
   merchant fixtures. Verify separate Owner/Staff/Installer AAL2,
   branch denials, UOM/stock-ledger/payment idempotency, installer handover,
   WhatsApp fallback/no unwanted outbound notifications, and Merchant/Admin
   exact-build identity. Keep C2 production runtime cutover out of scope.
5. **Release evidence:** approve staging attestation only after hosted
   invariants and reviewer sign-off. Create at most the purposeful
   `qa-staging` APK with package `ng.processedge.sellertray.qa` after
   isolated Firebase and embedded endpoint/commit attestation; validate
   physical 58/80mm printers, normal/failure/reprint behavior and native
   Auth callbacks. Production Build 47 needs an independent release plan.

**Current decision: NO-GO for destructive Test reset, hosted migration,
external webhook activation or QA APK.** Source/backup integrity is PASS;
historical Preview retirement, provider/callback and cron safety, exact
operator reset mechanism, and hosted acceptance remain OPEN. No Test/Production
database mutations were performed in this reconciliation.

## 07/11/2026 scheduled-job preflight — current hosted Test

Read-only `cron.job` / `cron.job_run_details` queries on the **Test ref only**
(`iukgsukdoowvnhlfmpml`) identified the four active entries below. These
are currently running normally; they must **not** be assumed inert merely
because the connected Test provider tables and runtime configuration are empty.

| Job ID | Job name | Schedule | Target function |
| --- | --- | --- | --- |
| 4 | `sellertray-agreement-package-retry` | Every minute | `public.process_sellertray_agreement_package_retries(integer)` |
| 3 | `sellertray-merchant-push-retry` | Every minute | `sellertray_private.kick_merchant_push_worker()` |
| 1 | `sellertray-prepare-usage-settlements` | Daily 01:15 (cron time zone) | `public.prepare_due_orderdesk_usage_settlements()` |
| 2 | `sellertray-whatsapp-notification-retry` | Every minute | `sellertray_private.kick_whatsapp_notification_worker()` |

At the read-only snapshot, the three per-minute jobs each reported 1,440
recorded runs in the preceding 24 hours, while the daily job reported one;
all reported zero failed runs in that window. Both notification worker
functions are `SECURITY DEFINER`, contain `net.http` references and read
`sellertray_private.runtime_config`; the latter had zero rows. The
agreement retry and usage settlement entry functions are also
`SECURITY DEFINER`. These findings describe the observed functions, **not**
proof that all transitively called routines lack external effects.

### Exact pre-reset freeze procedure (operator-reviewed, NOT executed)

1. Confirm the project ID and the current `cron.job` names/IDs again from a
   **read-only** Test connection, and compare current run counts, worker
   definitions, `runtime_config` and provider row counts with the baseline.
   Abort on any unexpected job, endpoint, secret, non-Test recipient or new
   integration.
2. Securely record schedule, job ID, owner, enabled state and source functions
   so a verified Test-only schedule can later be recreated. Never copy
   secrets, recipient identifiers or private backup contents to GitHub.
3. During the approved maintenance window, block incoming Test clients,
   external webhooks and all callback routes **before** database teardown.
   Using the independently reviewed Test-only maintenance procedure, pause
   the four jobs reversibly via the installed `cron.alter_job` capability;
   do **not** unschedule/delete the job definitions by default. Read back `cron.job` and check
   `cron.job_run_details` for in-flight execution; do not treat a successful
   disable command as proof that already-running jobs have stopped.
4. Recheck Test project identity immediately before each destructive
   operation; **never** pass the Production ref `eujxswjspolugrzlsjnn`
   to reset/migration tooling. This handover deliberately provides no
   executable destructive reset or `cron.unschedule` command; the exact
   mechanism needs independent operator review and rollback acceptance.
5. Once canonical Test schema and test-safe secrets are deployed and
   externally registered Test sinks are verified, restore only the reviewed
   Test schedules. Verify zero real-customer/provider effects,
   idempotency, and sampled job-run/audit records. Maintain an emergency
   quiesce path for the new Test workers.

**Read-only audit query** (run only when connected to the verified Test ref):

```sql
SELECT j.jobid, j.jobname, j.schedule, j.active,
       count(d.runid) FILTER (
         WHERE d.start_time >= now() - interval '24 hours'
       ) AS runs_last_24h,
       count(d.runid) FILTER (
         WHERE d.start_time >= now() - interval '24 hours'
           AND d.status = 'failed'
       ) AS failures_last_24h
FROM cron.job AS j
LEFT JOIN cron.job_run_details AS d ON d.jobid = j.jobid
GROUP BY j.jobid, j.jobname, j.schedule, j.active
ORDER BY j.jobname;
```

**Status: pre-reset cron inventory complete; actual job quiescence and
post-rebuild reactivation NOT performed.** No Test or Production job was
changed in this review.

### Hosted remote-reset semantics — additional STOP condition

The Supabase CLI reference for [`supabase db reset`](https://supabase.com/docs/reference/cli/supabase-db-reset)
states that a remote reset with `--linked` or `--db-url` runs SQL
to **drop user-created entities**. It does **not** equate to replacing the
whole hosted Supabase project. Cluster-level custom roles persist, and the
effects on managed Auth users/sessions, Storage metadata/objects, project
Secrets, Edge deployments, cron state, Auth URL allowlists and external
provider callbacks require independent verification. The historical Test
users/session/agreements must **not** be assumed cleared simply because
canonical `public` migrations replayed successfully. A source-only CI
replay proves neither hosted wipe completeness nor provider isolation.

The installed Test `pg_cron` version exposes
`cron.alter_job(job_id bigint, ..., active boolean DEFAULT NULL)`;
that supports a **reversible pause** instead of losing job definitions
through `cron.unschedule`. The read-only snapshot found exact job IDs
1, 2, 3 and 4, four active jobs, and **no unfinished runs in the
preceding hour**. Those observations are not maintenance-window evidence:
recheck immediately before approved execution and wait for all in-flight
runs to complete after pausing. Restore/recreate schedules **only**
from the reviewed canonical Test definition after the hosted rebuild.
The two outbound worker routines explicitly return before
`net.http_post` when their Test runtime-configured URL is absent;
this does not make agreement/settlement database activity inert.

**Do not run remote `supabase db reset`, `supabase db push`, custom
`DROP` scripts, `cron.alter_job` or `cron.unschedule` from this
handover.** The reviewed operator plan must identify the exact
hosted Test-only cleanup mechanism, its Auth/Storage/secret scope,
a preflight identity check for project `iukgsukdoowvnhlfmpml`,
post-reset parity probes, rollback/restore owner, protected evidence
retention and signed authorization. None of these commands was
executed during this documentation review.
