# SellerTray Environment & Resource Governance

**Status:** Normative extension of SellerTray governing implementation skill.
**Approved:** 04/11/2026.
**Scope:** Every SellerTray build, preview, deployment, QA test, database, external integration and release, across Mobile, Merchant Web, Admin Web, shared core, WhatsApp/AI, and related CI.

## Purpose

Run exactly **two persistent SellerTray operational environments** unless the user explicitly approves a change:

- **Production** — the live SellerTray backend (`eujxswjspolugrzlsjnn`) and approved production Merchant Web/Admin Web/Mobile routes. Tandar Oil Solutions and all live merchants continue operating here without interruption.
- **Test/Staging** — the distinct, verified QA backend, populated only with dedicated synthetic merchants/test staff. Reusing the existing Agreement Package Test project (`iukgsukdoowvnhlfmpml`) is preferred *after* evidence archival, reviewed clean rebuild, and explicit destructive-change approval. This project is **not yet authorised as functional OA5 staging**.

Disposable local CI/test databases are permitted for reproducible migrations and pgTAP. They are not additional hosted persistent environments. Do not create another paid Supabase project/branch merely because an acceptance run needs a clean schema. Any new billable resource requires the exact quoted cost and the user's explicit approval. Never point Test clients at Production as a fallback.

## Deploy and build only at a useful acceptance boundary

### Vercel: opt-in, surface-specific previews

1. **Do not generate a Vercel preview for every commit, every PR, or every feature branch.** Git-connected Merchant Web and Admin Web use separate `vercel.json` policies. The standard production branch stays eligible for production deployment, and automatic preview creation is disabled for ordinary development/review branches by default.
2. For real authenticated UI acceptance, deliberately promote the **exact tested source SHA** to one managed branch per surface:
   - `qa-preview/merchant-<acceptance-batch>` — Merchant Web only;
   - `qa-preview/admin-<acceptance-batch>` — Admin Web only.
   The names indicate approval to spend an actual preview deployment, *not* approval to deploy to Production. Each surface's Vercel allowlist must match only its own preview namespace.
3. **Prefer reusing one existing branch preview URL per acceptance batch and surface.** Do not open another branch, deploy multiple SHAs to demonstrate the same change, or trigger a build simply to refresh a screenshot. Record exact source SHA, environment, auth persona, build and browser acceptance evidence. One pending preview per surface/batch is the default; an additional preview requires a documented regression/isolation reason.
4. Before requesting the preview, run local/offline/source contracts, typecheck, relevant unit/integration and security checks. For changes touching both Admin and Merchant UI, build one preview of each *only after* a reconciled exact-head integration candidate exists. For docs, comments, database-only migrations, payments, backend-only changes, and native Mobile-only changes, **no frontend preview** unless the modification materially changes a visible user workflow or a specific visual regression requires proof.
5. **Do not use skipped Vercel builds as the primary cost control.** They may still count toward deployment limits. Use `git.deploymentEnabled` opt-in branch policy to prevent unwanted Git deployments before the build starts; the existing path-scoped `ignoreCommand` remains a secondary defence for approved branches with no frontend changes.
6. The existing five agreement-test branch-specific Vercel preview URL bindings are historic dependencies. Preserve their audit/visual acceptance evidence before repurposing the QA backend. Defer branch cleanup or deletion until references, evidence and access are verified; retiring a preview does not mean destroying its historical PR/source proof.
7. **Production is a separate, approved release operation.** Verify the actual currently tracked Vercel production branch/project and preview credentials before activating new branch policies. Do not assume the GitHub default branch is already production-ready: this repository has an unusual bootstrap `main` history and past manual production deployments from reviewed feature SHAs. Preserve current production domains, stored credentials and rollback path; a Git branch allowlist is *not* a production migration or go-live authorisation.
8. Preview/Production configuration must never silently share Supabase project refs, secrets or auth callbacks. **At 04/11/2026 the default Preview Vercel `VITE_SUPABASE_URL` for both Merchant and Admin still resolves to the live Supabase project. No preview may deploy until `scripts/qa/vercel-frontend-environment.mjs` verifies a properly reviewed staging attestation, an exact surface-specific `qa-preview/` branch and a non-production backend/ref; the existing Agreement Test project is blocked until formally rebuilt.** Stage-only domains are allowed for verified test clients, while `https://app.sellertray.com` and `https://admin.sellertray.com` remain production-only.

### GitHub Actions, APK, migrations and Supabase

1. Keep lightweight, path-filtered static/typecheck/security/unit CI on relevant PRs and exact candidate SHAs. Do not disable vital RLS, payment, tenant/Branch, stock, commercial/settlement and compatibility tests as a cost optimisation.
2. Expensive Android **release APK builds are opt-in** for a named device/acceptance milestone, not one per Mobile PR push. Native compilation may remain path-scoped for genuinely native changes, with concurrency cancellation for superseded heads. Retain Build 46/47 provenance; do not reuse a production-bound APK for Test/Staging.
3. A QA APK must have separate `ng.processedge.sellertray.qa` Android identity, Firebase/FCM app and verified staging backend. Release APKs retain production identity and require distinct sign-off. One usable QA APK per acceptance milestone is the default; rebuild when the exact source or native/config contract materially changed.
4. Use a disposable local database for migration-order/pgTAP checks. Deploy staged migrations and Edge functions to the **existing approved Test project only at controlled checkpoints**. No production `supabase db push` or automatic all-pending migration deployment; OA5/C2 interleaving remains an explicit review gate.
5. Test merchants are synthetic. Keep SMS, WhatsApp, Meta, push, email, payment providers, webhooks, AI calls and printer transports on sandbox/mocked/test sinks where possible; no real payment or customer notification should be generated by QA.
6. Reuse test storage, synthetic merchant fixtures and existing Vercel URLs rather than creating a new account/project/bucket for each PR. Take an archive/restore proof before any destructive reset. Do not pause, delete, reset or revoke existing resources merely to save money unless approved and verified unused.
7. For each paid or rate-limited service (Vercel, Supabase, Expo/EAS/Android, email/push, WhatsApp/Meta, AI, payment providers), identify the cost/quota impact before consumption. Stop automatic retries when a quota/build-rate-limit is hit; preserve passing source CI, record the blocker and resume only for a purposeful acceptance checkpoint.

## Decision checklist before any build or deployment

The operator/agent records:
- **Environment:** Test or Production (never inferred from a URL alone).
- **Surface and purpose:** Shared core, Merchant Web, Admin Web, Mobile, website or another named dependency.
- **Exact source SHA:** reviewed candidate/release head, plus affected code paths.
- **Deployment value:** what needs browser, device, hosted Supabase or real equipment proof and why static/local checks are inadequate.
- **Budget:** existing artefact/URL reusable? Is another preview/build/billable branch needed? If so, explicit scope/cost approval.
- **Isolation:** exact backend ref, QA identities/keys, test-only contacts, test Firebase and payment/message sinks; no Tandar or other live merchant exposure.
- **Release gates:** tests passed and pending, visual baseline for Admin, OA5 prerequisite and C2 compatibility, rollback/audit trace.

**Fail closed** on any unknown environment, missing proof, unreviewed project identity or production/test credential mixture. A status-check failure caused solely by a deliberately skipped preview is not evidence the functional code is broken; mark the visual/browser gate pending rather than bypassing review or forcing repeated builds.

## Source enforcement and rollout rule

`apps/merchant-web/vercel.json` and `apps/admin-web/vercel.json` use the version-controlled `git.deploymentEnabled` branch allowlist, with ordinary feature branches off and explicit QA preview namespaces on. The existing ignore-build path filter stays intact. `scripts/qa/sellertray-environment-resource-policy.mjs` and its tests verify the branch and workflow safety contracts in offline CI.

**Important production safeguard:** verify the *actual* Vercel tracked production branch/project for each site **before merging or enabling an allowlist on a production-linked branch**. Do not equate a manually deployed production SHA with an automatically tracked production Git branch. The allowlist treats `main` as the conventional default and remains a **candidate configuration** until that check is closed. If the tracked production branch is different, change the explicit production allowlist only after documenting the verified branch and preserving current production. Do not silently disable live production delivery.

## OA5 / C2 status as of 04/11/2026

OA5 staging is not ready; archived agreement evidence, five preview dependencies, hosted migration replay, QA auth/Firebase, exact QA APK and merchant/hardware visual acceptance remain pending. C2 production cutover stays blocked pending OA5C acceptance; legacy Business/trial runtime is still production authority. No environment reset, deployment, production migration or paid resource creation is authorised by this governance record alone.


## 08/11/2026 — Firebase Test application isolation (approved identity)

Operator-provided Firebase Console evidence confirms a **separate** SellerTray Test Firebase project with ID `sellertray-test`, messaging sender/project number `362913608913`, and the Android app `ng.processedge.sellertray.qa` registered as `SellerTray QA` (Firebase App ID `1:362913608913:android:622042be355ff1a94b41f0`). Existing Production Firebase remains `sellertray-d4b18` with Android package `ng.processedge.sellertray`.

The staged Android config must validate **all** of the Test Firebase project ID, sender number, registered Android App ID, and Android package name against a protected Test-only `google-services.json` file. Do not commit this downloaded Test file to Git, overwrite the Production configuration, copy Production FCM/service-account keys, or claim hosted FCM delivery acceptance merely from registration screenshots. Only stage a protected Test Firebase config and dedicated FCM V1/Expo sender after the Test Supabase/backend/provider isolation gates have been independently attested. No build, push delivery or real-customer notification is authorised by this record.

## 08/11/2026 — approved QA domains and current hosted isolation status

- **Merchant Test:** `test.sellertray.com` (Cloudflare DNS-only CNAME to
  `cname.vercel-dns.com`).
- **Admin Test:** `test-admin.sellertray.com` (same DNS-only target).
- Both names are fixed Test-only identifiers. At this checkpoint neither is
  attached to the corresponding Vercel project or QA-branch deployment.
  Never attach either as an unscoped Production alias, trigger an unapproved
  Preview, or create a QA branch merely to bypass Vercel's branch requirement.
- Existing Merchant Vercel password/SSO protection is off. Existing Admin SSO
  is `all_except_custom_domains`; it does not protect the approved Test
  custom domain. Review protection that explicitly covers **both custom
  domains** before serving Test traffic; do not disrupt Production access
  controls to solve this.
- Test Supabase Auth Site URL and QA native redirects have operator screenshot
  evidence, but the Site URL remains nonoperational until the protected
  Merchant QA deployment exists. SMTP, provider callbacks, login flows and
  legacy Preview compiled endpoint binding are **not** attested.
- Firebase Test project/app identity and HTTP v1 availability were verified,
  and uploaded Test Android client JSON matched all four configured QA
  identity values. Expo QA application identifier/keystore/FCM sender are
  pending; no QA APK or live push was authorised. Maintain the existing
  `qa-staging` fail-closed attestation policy.
