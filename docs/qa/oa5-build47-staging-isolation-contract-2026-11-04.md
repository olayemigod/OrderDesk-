# OA5 Pre-C2 staging isolation and Build 47 hardware-acceptance contract

**Checkpoint:** 04/11/2026. **State:** staging not provisioned; no permission to mutate production or claim device acceptance.

## Why staging is a release gate

The approved Build 47 APK at commit `b2b0a8636604272080746ff952ee2dcd1cf57585` targets the **current production OrderDesk Supabase project** `eujxswjspolugrzlsjnn`. Its Android compile and clean-schema Database CI have passed, but its live target is **not equipped with the 03–04/11/2026 OA5 installer migrations**. The production migration ledger last verified at `20261102100606`. An APK can compile without those server functions. DO NOT execute new installer/Branch acceptance using live merchant data.

The existing project `iukgsukdoowvnhlfmpml` is an unrelated Agreement Package Test database with only a partial migration history; do not reset or repurpose it without a deliberate decision.

## Safe provisioning contract

- Create a dedicated **preview/staging Supabase branch** from the actual production project, with no production row copy or payment credentials. This requires billing approval: the quoted **branch compute rate was USD 0.01344/hour** at this checkpoint, about USD 0.32256/day or USD 9.6768/30 days of continuous uptime, before other usage charges. **No branch created without explicit cost approval.**
- Record the resulting independent project ref and obtain its own *publishable* key; do not place a secret/service-role key in Android, web or tracked files. Protect admin access, authentication settings and test emails.
- Apply and validate the forward-only source migrations, in ledger order, from the selected exact candidate; verify runtime function signatures, RLS/grants and new installer tables as well as ledger. A passing ephemeral pgTAP suite is necessary but is not proof the hosted branch has been deployed.
- Deploy current candidate Edge functions consumed by the flow (at minimum `platform-setup-installer`, `printer`, and the setup scheduling/admin/merchant functions that call their authority). Do not copy production payment, messaging or WhatsApp webhooks, service secrets, real customer data or merchant credentials.
- Configure synthetic Businesses, purchased setup obligations, Branches, internal Setup Installer, AAL2, assignment/revocation, printable hardware and a designated receiver using controlled sandbox accounts. All payment/provider keys must be sandbox, with no real transactions.
- Set `SELLERTRAY_OA5_STAGING_SUPABASE_URL` and `SELLERTRAY_OA5_STAGING_PUBLISHABLE_KEY` **only in the protected QA build environment**. Run `node scripts/qa/oa5-staging-isolation.mjs --target-only` for target validation; this explicitly **does not** approve the existing APK.
- Rebind a separately identifiable QA build to this environment. Before anyone tests activation, run `node scripts/qa/oa5-staging-isolation.mjs` against the exact build configuration and prove that the APK SHA and embedded endpoint correspond to the same candidate. Never treat an APK built for production as a staging binary.
- Test physical Android on 58mm/80mm Bluetooth printers, retry and failed-print state, immutable successful print-job provenance, Merchant/ProcessEdge separate roles, appointment expiration/revocation, Branch isolation, setup-completion signature and activation reconciliation. Verify receipt customer-contact safety and optional phone.
- Only after full QA and approved operational change control, plan a **separate production rollout**; do not merge a staging branch into production as a substitute for reviewed PR/migration sequencing. Legacy Business/trial compatibility remains authoritative until a later C2 cutover.

## Operator command safety

`node --test scripts/qa/oa5-staging-isolation.test.mjs` tests the boundary entirely offline.

`node scripts/qa/oa5-staging-isolation.mjs` validates that the **QA source configuration** points to the approved isolated staging URL and key. It never calls Supabase, mutates databases, starts payment collection or publishes an APK. The current production-bound Build 47 source is deliberately expected to **fail** this acceptance check until a staged build variant is prepared.

`node scripts/qa/oa5-staging-isolation.mjs --target-only` checks only a proposed isolated Supabase endpoint and publishable key. A passing result means **staging target accepted for further preparation, not a working or installed build**.

## Evidence required for closeout

Record exact GitHub PR/SHA, staging branch project ID, migration ledger range and function deployment identities, test user/Branch/appointment references, AAL1 denial and AAL2 allow, real Bluetooth 58/80mm test-print IDs, immutable handover completion, activation/entitlement state, Vercel Admin/Merchant exact-SHA screenshots and the human approval date in **dd/mm/yyyy**. No test is green by inference.

**Cross-surface:** Shared core migrations, Auth/RLS, Admin identity, Mobile installer and merchant printer, Merchant Web setup configuration, immutable audit, and reporting are in scope. No direct WhatsApp, AI or offline queue behavior is altered by this staging-only contract; regression acceptance must still confirm no production channel interaction. **Visual baseline:** Not visually verified—no authenticated exact-SHA preview was available at this checkpoint.
