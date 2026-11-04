# SellerTray OA5 Test project — archive and rebuild operator handover

**Verified:** 04/11/2026 (dd/mm/yyyy). **Mode:** read-only due diligence only.
**Approval state:** **BLOCKED**. This document is NOT a backup, a reset approval, a staging attestation or permission to deploy.
**Source dependency:** Build 47 PR #214 (candidate `7433447b7ac84931ba320a2155207af3ff9427e0`), based on environment PR #209. Follow `ENVIRONMENTS_RESOURCES.md` and `oa5-existing-test-project-reuse-assessment-2026-11-04.md`.

## Project separation and fixed protections

- **Production:** `eujxswjspolugrzlsjnn` — all actual merchants including Tandar; never run staging tests, reset, reprovision or replace mobile configuration here.
- **Candidate reusable standalone Test project:** `iukgsukdoowvnhlfmpml` — SellerTray Agreement Package Test, `ACTIVE_HEALTHY`, region `eu-west-1`, Postgres 17.
- This is an independent *project*, **not** a child Supabase branch of Production. Do not claim or set `parent_project_ref` for it.
- Neither the old `qa` APK nor its EAS profile is isolated: both point to Production and use package `ng.processedge.sellertray`. Only an attested `qa-staging` build may use independent package `ng.processedge.sellertray.qa`, nonproduction publishable key and Firebase registration.
- The Test project still has 52 historical, agreement-specific migration ledger entries (latest `20261101203725`) and cannot be treated as canonical migration parity. **Never spoof migration versions or do a bulk production `supabase db push`.**

## Repeatable pre-archive read-only baseline

The following were rechecked through the connected Supabase read-only interfaces, with no personal records exported:

| Evidence category | Current count |
| --- | ---: |
| Public tables / functions | 132 / 479 |
| Applied migrations | 52 |
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
2. **Take a secure full logical database backup** of the *Test project only*, including `auth`, `public`, storage metadata, schema, functions and history. Use authorised database access and an encrypted, access-controlled retention destination *outside source control*. A representative local command, once credentials and secure storage are arranged, is `pg_dump --format=custom --no-owner --no-acl --file=<protected-archive-path> <test-project-connection>`. Do not put connection URIs into CLI logs or PR comments. Evaluate managed backup/PITR availability separately; never assume it exists.
3. **Preserve non-DB resources:** Supabase deployed Edge source/version hashes, Auth configuration, URL/callback allowlists, storage bucket metadata, any objects and policy references (currently zero objects), test-only provider integrations and references to PR176/OA5 agreement proof. `pg_dump` alone does not back up the entire hosted service.
4. **Validate recoverability** by listing the archive contents and performing a restore rehearsal into a *local disposable isolated database*, not Production and not the standing Test project. Compare schema/table/function and critical agreement-proof row counts; record checksum, encrypted archive location, retention owner, restore result, UTC test timestamp and deletion/retention policy. Do not store the backup, credentials or actual customer data in GitHub.
5. **Document preview/auth remediation** for all five historical Vercel Preview branches, including login redirects, environment variables, Git branch tracking, default Preview variables pointing to Production and preserved PR149/PR158 visual proofs. A new preview must be deliberately approved and use independent Test bindings; no build should silently inherit a Production backend.
6. **Request explicit destructive reset/rebuild approval** specifying project ref `iukgsukdoowvnhlfmpml`, accepted archive/recovery evidence, expected user/session/ledger loss and the clean canonical migration/reseed plan. Until that approval is recorded, do not reset/rebuild, remove Auth sessions, delete tenant data or replace Edge functions.
7. **After approval only**, perform the reviewed clean rebuild and deploy the accepted OA5 Build 47 SQL/Edge package in order; verify function/RLS/grant parity, Test-only Auth keys/Firebase and sandbox message/payment endpoints. Turn the checked-in `oa5-staging-backend-attestation.json` to approved only with actual hosted evidence and an independent security review of the gate change. Populate *synthetic* test merchants using the reviewed fixture plan, never Production data.
8. **Acceptance then release:** perform Merchant/Admin preview baseline and physical Android 58/80mm printer, installer AAL2/branch, first-purchase/activation, POS/UOM/stock-cost and offline replay tests; keep OA5C and C2 cutover distinct. Generate only the milestone-authorised staging QA APK and later the separately approved Production Build 47.

## Evidence sign-off (all unresolved at this checkpoint)

| Required proof | State | Evidence location / responsible reviewer |
| --- | --- | --- |
| Full encrypted Test backup and retention owner | NOT PROVIDED | Protected operator storage, not Git |
| Successful restore rehearsal | NOT PROVIDED | Disposable DB report and checksum |
| Historical agreement/PR proof retention | NOT PROVIDED | Agreement/QA operator |
| Five Vercel preview dependencies and auth callbacks reconciled | NOT PROVIDED | Vercel project operator |
| Explicit approval to reset/rebuild `iukgsukdoowvnhlfmpml` | **NOT GRANTED** | Product owner/release authority |
| Canonical clean migration/replay and safety attestation | NOT EXECUTED | DB/release reviewer |
| Independent Test Firebase/auth/provider sinks | NOT VERIFIED | QA/release operator |
| Build 47 exact-source QA APK + real hardware acceptance | NOT EXECUTED | Device QA |
| Controlled Production rollout/rollback sign-off | NOT GRANTED | Production release owner |

## Read-only review outcome

Reuse of the Agreement Test project remains the preferred **cost-conscious** design, with **no new paid Supabase project or branch required at this stage**. It is blocked on archival and explicit destructive-change approval, not on missing app source code. Existing merchants remain on Production. There has been **no** data export, destructive operation, paid resource creation, deployment, APK build or tenant mutation during this assessment.
