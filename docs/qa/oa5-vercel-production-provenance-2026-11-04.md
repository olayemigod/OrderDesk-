# SellerTray — Vercel Production provenance and branch-tracking gate

**Checkpoint:** 04/11/2026. **Status:** PARTIALLY VERIFIED — exact live deployment identity is known, but the Vercel Production *tracked Git branch setting* is **not exposed** by the available connected project read. This is a pre-merge release blocker for the new opt-in preview allowlist.

## Verified project/account scope (read-only)

The Vercel team `olayemigods-projects` (Hobby) has Git-connected Merchant Web project `sellertray-merchant` (`prj_ArmFvWkLeNRLRieJLGV5YVY4nRf4`) and Admin Web project `sellertray-admin` (`prj_Dewd7IMRMjDpUCcZmBjvV6o0uxvO`), both linked to `olayemigod/OrderDesk-`.

| Surface | Production domain on latest READY Production deployment | Deployment ID | Reported Git commit | Reported commit ref |
| --- | --- | --- | --- | --- |
| Merchant | `app.sellertray.com` | `dpl_CfBFKGKgFdSUBJtceMsCZUVCBgY5` | `d8024c215850e0e9a3a0ce1496d1d0dd5d7cd150` | `fix/oa5-billing-first-purchase-runtime-authority-20261031` |
| Admin | `admin.sellertray.com` | `dpl_9KGevPnPXMZvWyQ9iozECWJ7d9jK` | `3e970369367386f63d603b180d428231b149159b` | `fix/oa5-billing-first-purchase-runtime-authority-20261031` |

These are the latest `target=production`, `READY` records reported by Vercel project deployment history at this checkpoint. Production aliases were checked against the individual deployment records. Do not equate `githubCommitRef` with the project's **currently configured production branch**: manual production deployments and promotions can originate from other branches.

The connected Vercel `get_project` and `list_projects` actions expose project identity/linked repo/deployment state, **not** the configured Production `Branch Tracking` value. The connected browser was unavailable in this execution context, so the tracked branch remains **not independently verified**. The repository `main` currently contains only bootstrap-level instructions/README and **does not contain** either `apps/admin-web/vercel.json` or `apps/merchant-web/vercel.json`; it is not proof of a safe production-release code line.

## Required production-branch readback before accepting PR #209

A ProcessEdge release operator must open, for **each** project, Vercel Dashboard → Project → Settings → Environments → Production → Branch Tracking, and capture:
1. Exact Production tracked Git branch for Merchant and Admin, team/project IDs and UTC observation timestamp.
2. Latest live deployment ID + source SHA + production domain routing, compared against the table above (or updated if newer).
3. Whether production is assigned automatically on Git changes or is manually promoted. Do not replace an intentional manual promotion/rollback policy.
4. The intended production release branch for approved OA5 work. The source `git.deploymentEnabled` allowlist currently permits `main` by convention plus surface-specific QA preview branches. **Do not merge these rules onto a live production branch until the actual tracked branch is known and the allowlist reconciled**. If tracked production is not `main`, update both Vercel source allowlists, the offline policy checker and tests using the *verified* branch and current release strategy rather than guessing.
5. Validate one controlled, reviewed exact-SHA, environment-correct deployment with alias and backend readback. Do not cause a deployment merely to learn the configured branch; checking Project Settings is non-mutating.

## Newly identified preview-to-Production backend hazard — blocked in source

At the same checkpoint, the Merchant and Admin projects each have a default `VITE_SUPABASE_URL` variable applicable to **both Production and Preview**, pointing to `eujxswjspolugrzlsjnn` (live). Five historical branch-specific Preview overrides point to the existing Agreement Test project `iukgsukdoowvnhlfmpml`. A newly allowed `qa-preview/merchant-*` or `qa-preview/admin-*` branch would **inherit the live backend by default**, even if its Vercel *deployment target* is Preview. Git branch names and the environment label are **not sufficient data isolation**.

Mitigation in PR #209:
- `apps/merchant-web` and `apps/admin-web` invoke `scripts/qa/vercel-frontend-environment.mjs` as an npm `prebuild` hook.
- Any Vercel Preview build must use its own exact surface-specific `qa-preview/` branch and an attested non-production Supabase URL + publishable key.
- The checked-in `docs/qa/oa5-staging-backend-attestation.json` is **blocked** until archive/recovery, migration replay, five Vercel preview dependencies, separate test-only identities/provider configuration and Edge function deployment are verified. A random non-production project URL alone does not constitute approval.
- A Vercel Production build must match the known live Supabase project ref; local source/test CI can still build without Vercel credentials.
- The prebuild script does not deploy, inspect secrets, invoke Supabase or mutate live resources; it fails the build if any required isolation fact is missing. The existing live deployments were not changed or redeployed.

The default Preview environment bindings should eventually be separated from Production as a **protected, explicitly approved Vercel environment configuration step**, after the test project is proven and before requesting any visual QA. There must be no QA fallback to Production if a branch override is missing.

## QA/release status

Only read-only deployment/environment metadata was retrieved; no Vercel project setting, branch tracking, deployment, alias, Supabase schema, merchant or payment was changed. Human authenticated Admin PR149/PR158 visual baseline was not browser-verified on this candidate. The OA5 source and Android gates remain separate; C2 production cutover remains blocked, and the legacy Business subscription runtime remains current production authority.
