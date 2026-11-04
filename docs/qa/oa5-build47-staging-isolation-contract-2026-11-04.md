# OA5 Pre-C2 staging isolation and Build 47 hardware-acceptance contract

**Checkpoint:** 04/11/2026. **State:** staging not provisioned; no permission to mutate production or claim device acceptance.

## Why staging is a release gate

The approved Build 47 APK at commit `b2b0a8636604272080746ff952ee2dcd1cf57585` targets the **current production OrderDesk Supabase project** `eujxswjspolugrzlsjnn`. Its Android compile and clean-schema Database CI have passed, but its live target is **not equipped with the 03–04/11/2026 OA5 installer migrations**. The production migration ledger last verified at `20261102100606`. An APK can compile without those server functions. DO NOT execute new installer/Branch acceptance using live merchant data.

The existing project `iukgsukdoowvnhlfmpml` is a **candidate for controlled reuse** as permanent SellerTray Test/Staging, not an accepted OA5 target today. Its agreement-specific migration history is divergent. Preserve existing proof and dependencies; do not reset or repurpose it without a specifically approved archival/rebuild operation. See [the reuse assessment](oa5-existing-test-project-reuse-assessment-2026-11-04.md).

## Pending migration ordering hazard

The exact Build 47 clean-history Database CI replay of 04/11/2026 applies **33 source migrations beyond the currently deployed production ledger** `20261102100606`: **17 C2 foundation migrations** dated 02/11/2026 and **16 OA5/pre-C2 migrations**, including the two approved discount repairs `20261102101000` and `20261102102000` positioned before C2. The newer OA5 installer migrations follow on 03–04/11/2026. GitHub CI applies both sequentially and passes, but that does **not** authorize a production combined deployment. The C2 foundations may be additive, but their approval and production effects must be reviewed separately; the user has not approved C2 runtime cutover. Do not invoke a generic production `supabase db push` while this overlap remains unresolved.

The read-only local check `SELLERTRAY_PRODUCTION_LAST_APPLIED_MIGRATION=<fresh ledger version> node scripts/qa/oa5-migration-boundary.mjs` intentionally exits nonzero when unapproved C2/unclassified migrations are newer than the production ledger. It does not make deployment decisions, write SQL, or infer that skipping interleaved migrations would be safe. Preserve clean-history ordering and obtain explicit OA5/C2 boundary approval before any production migration plan.

## Safe provisioning contract

- **Preferred candidate: reuse the existing independent Agreement Package Test project** (`iukgsukdoowvnhlfmpml`) as permanent Test/Staging **only after** protected agreement-proof archival, external dependency inventory, an explicitly approved clean rebuild from canonical migrations, isolated test credentials, and full acceptance verification. Its existing 52-migration test-only ledger cannot be treated as production parity. The current fail-closed staging guard must continue to reject this project until a later reviewed verification/attestation change. Keeping an active permanent Test project can still incur ordinary Supabase usage charges.
- **Fallback when safe reuse is not demonstrated:** create a separate preview/staging branch from the production project, without production row copy or payment credentials. The quoted branch compute rate was USD 0.01344/hour at this checkpoint, about USD 0.32256/day or USD 9.6768/30 days of continuous uptime, before other usage. **No billable branch without explicit cost approval.**
- Record the independent staging project ref and environment type. If a Supabase branch is used, additionally record and verify its branch UUID and `parent_project_ref=eujxswjspolugrzlsjnn`. The standalone Agreement Test project is **not** a Supabase branch and has no parent branch UUID. Obtain its own *publishable* key; do not put a secret/service-role key in Android, web or tracked files. Protect Admin, Auth, preview callbacks and test emails.
- Apply and validate the forward-only source migrations, in ledger order, from the selected exact candidate; verify runtime function signatures, RLS/grants and new installer tables as well as ledger. A passing ephemeral pgTAP suite is necessary but is not proof the hosted branch has been deployed.
- Deploy current candidate Edge functions consumed by the flow (at minimum `platform-setup-installer`, `printer`, and the setup scheduling/admin/merchant functions that call their authority). Do not copy production payment, messaging or WhatsApp webhooks, service secrets, real customer data or merchant credentials.
- Configure synthetic Businesses, purchased setup obligations, Branches, internal Setup Installer, AAL2, assignment/revocation, printable hardware and a designated receiver using controlled sandbox accounts. All payment/provider keys must be sandbox, with no real transactions.
- Set `SELLERTRAY_OA5_STAGING_SUPABASE_URL` and `SELLERTRAY_OA5_STAGING_PUBLISHABLE_KEY` **only in the protected QA build environment**. Run `node scripts/qa/oa5-staging-isolation.mjs --target-only` for target validation; this explicitly **does not** approve the existing APK.
- Rebind a separately identifiable QA build to this environment. Before anyone tests activation, run `node scripts/qa/oa5-staging-isolation.mjs` against the exact build configuration and prove that the APK SHA and embedded endpoint correspond to the same candidate. Never treat an APK built for production as a staging binary.
- Test physical Android on 58mm/80mm Bluetooth printers, retry and failed-print state, immutable successful print-job provenance, Merchant/ProcessEdge separate roles, appointment expiration/revocation, Branch isolation, setup-completion signature and activation reconciliation. Verify receipt customer-contact safety and optional phone.
- Only after full QA and approved operational change control, plan a **separate production rollout**; do not merge a staging branch into production as a substitute for reviewed PR/migration sequencing. Legacy Business/trial compatibility remains authoritative until a later C2 cutover.

## Side-by-side Android QA application — source prepared, build blocked

The current **legacy** `qa` profile and Android Build 47 have package `ng.processedge.sellertray` and production Supabase routing. They are **not valid for Test/Staging** and could replace an existing production installation on the same phone.

A separately gated `qa-staging` profile and `apps/mobile/app.config.js` now reserve Android application ID `ng.processedge.sellertray.qa`, on-device name **SellerTray QA**, scheme `sellertray-qa`, and no claim on the production `https://app.sellertray.com` invitation deep-link host. The default production app config remains unchanged. The protected staging Android build must receive `SELLERTRAY_APP_VARIANT=qa-staging`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `SELLERTRAY_QA_GOOGLE_SERVICES_FILE` at build time; the latter must identify an independently registered Firebase Android app for `ng.processedge.sellertray.qa`. Do not check Firebase credentials, service secrets or test recipients into the repository.

The variant deliberately rejects the live project and the **unrebuilt** Agreement Package Test project; it must not be bypassed with arbitrary settings. The existing staging guard additionally requires a distinct QA Android package in its full acceptance mode. `--target-only` verifies neither QA source binding nor Android app identity. Source configuration and offline tests are **not** evidence of a generated/installed QA APK.

**Build closeout gate:** configure protected staging secrets and a QA Firebase Android app after the test backend is clean and attested; run `npx expo config --type public` for the explicit variant; inspect the generated native Android applicationId and the **actual signed APK package** using Android build tooling (`aapt dump badging` or `apkanalyzer manifest application-id`), verify distinct on-device installation, auth redirect, push delivery isolation, USB/Bluetooth receipt printing and exact embedded Supabase endpoint. The test APK must never overwrite the production SellerTray app. Without physical QA build and backend acceptance, Mobile testing remains blocked.

The declarative fixtures in `docs/qa/oa5-test-merchant-fixtures.json` cover three synthetic Businesses and five Branch scenarios. Validate them with `node scripts/qa/oa5-test-merchant-fixtures.mjs --check`. This command **does not** create merchants; create them only after staged infrastructure is approved using governed signup, commercial, branch, catalogue, stock, payment and installer flows.

## Operator command safety

`node --test scripts/qa/oa5-staging-isolation.test.mjs` tests the boundary entirely offline.

`node scripts/qa/oa5-staging-isolation.mjs` validates that the **QA source configuration** points to the approved isolated staging URL and key. It never calls Supabase, mutates databases, starts payment collection or publishes an APK. The current production-bound Build 47 source is deliberately expected to **fail** this acceptance check until a staged build variant is prepared.

`node scripts/qa/oa5-staging-isolation.mjs --target-only` checks only a proposed isolated Supabase endpoint and publishable key. The existing agreement-test ref remains specifically blocked until its archive, approved clean rebuild and reviewed attestation are complete; this is intentional. A passing result means **staging target accepted for further preparation, not a working or installed build**.

## Dedicated QA merchant acceptance

**User decision 04/11/2026:** OA5 hardware/installation and future C2 Mobile testing must use dedicated **synthetic test merchants** in the independently verified Test/Staging backend, never Tandar Oil Solutions or another live merchant. Test fixture groups must cover first-merchant activation, two independent Branches, Owner/Manager/Cashier permission denial, separate appointed ProcessEdge Installer, POS/stock/UOM/receivables, printer/register/receipt-copy, sandbox commercial settlement, idempotent retries, failed payments, and optional customer phone. Use test-only email/WhatsApp/webhook/notification sinks; no live money or message delivery. Existing production-bound Android Build 47 cannot be used as the staging client; a new separately identified QA APK with proven non-production endpoint is required. Preserve Tandar's installed production app/merchant data and the legacy Business/trial runtime until later approved release gates.

## Evidence required for closeout

Record exact GitHub PR/SHA, independent staging project ref (and branch ID only if applicable), migration ledger range and function deployment identities, test user/Branch/appointment references, AAL1 denial and AAL2 allow, real Bluetooth 58/80mm test-print IDs, immutable handover completion, activation/entitlement state, Vercel Admin/Merchant exact-SHA screenshots and the human approval date in **dd/mm/yyyy**. No test is green by inference.

**Cross-surface:** Shared core migrations, Auth/RLS, Admin identity, Mobile installer and merchant printer, Merchant Web setup configuration, immutable audit, and reporting are in scope. No direct WhatsApp, AI or offline queue behavior is altered by this staging-only contract; regression acceptance must still confirm no production channel interaction. **Visual baseline:** Not visually verified—no authenticated exact-SHA preview was available at this checkpoint.
