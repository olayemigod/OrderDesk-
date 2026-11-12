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

## 08/11/2026 — approved QA domains and historical hosted isolation snapshot (superseded where noted)

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

## 08/11/2026 — Meta QA webhook source boundary (review only, not deployment)

The two-production-environment resource model requires the existing
Production Meta webhook to remain uninterrupted. Draft PR #228 adds a
**Test-project-only** inbound callback configuration check for project
`iukgsukdoowvnhlfmpml`: the Test function will fail closed unless
`META_TEST_APP_ID=1429945732160146` and
`META_TEST_PHONE_NUMBER_ID=1271836092686870` are configured on **Test
only**. Every signed Test inbound callback must contain only the approved
Phone Number ID; all other events are rejected **before webhook receipt
persistence or message/commerce processing**. The usual HMAC verification,
tenant retirement/connection and legal-consent checks continue. The
Production project and local developer route retain their existing
behavior.

These QA resource IDs are **public provider identifiers, not tokens or
secrets**. The Test project must use its own `META_APP_SECRET` and
`META_WEBHOOK_VERIFY_TOKEN`; neither is recorded in Git. Meta App ID,
phone-number ownership and credential separation remain subject to
provider-side screenshot/hosted acceptance. Do not configure external
callbacks or test traffic until the controlled Test rebuild, provider
authorization and hosted guards are independently accepted. A source CI
PASS alone is **not** an approved staging attestation.


## 09/11/2026 — owner-approved Standard Vercel Authentication is now active

This later explicit user-approved security configuration **supersedes the 08/11
statement that Merchant Preview protection was disabled and Admin scope was
`all_except_custom_domains`**. The user authorized a narrow protection-only
change to the two **existing** Vercel projects; no Vercel Pro subscription,
build, new Preview, DNS binding or application deployment was authorized.

The project API now confirms both `sellertray-merchant` and
`sellertray-admin` with `ssoProtection.enabled=true` and
`ssoProtection.deploymentType="prod_deployment_urls_and_all_previews"`.
Their existing verified Production custom domains
`app.sellertray.com` and `admin.sellertray.com` remain attached. The
user personally verified, using Incognito/signed-out browsing, that both
preserved historical Merchant and Admin Preview URLs redirect to Vercel
Authentication; after signing in as the Vercel Owner, **both original
Preview pages opened**. The user confirmed that both canonical Production
domains open publicly without Vercel login. All five historical Agreement
Preview deployments remain `READY` with their original Git SHAs and aliases.

These observations **do not** establish any unrelated external reviewer
grant, the original historical Preview's compiled Supabase endpoint identity,
the exact anonymous four-GET status/redirect script, or protection of the
yet-unbound Test custom domains. Specifically, `test.sellertray.com` and
`test-admin.sellertray.com` remain **unattached** and must be independently
tested for access protection *after* their separately authorized Test-only
binding. Do not loosen production access or use `all` deployment protection
in place of the confirmed Standard scope.

The OA5 backend attestation remains `state:blocked` and
`qa_preview_access_protection_preflight_verified:false`. The successful
owner-access checks alone do **not** authorize a Test reset, cron pause,
Edge Function deployment, sandbox provider callback, new preview, QA APK or
C2 production runtime cutover. The existing Production/Tandar core retains
its current authority. See the exact provider evidence and owner browser
acceptance notes on draft PR #228.

A later Test-only archive-census review also identified one new Auth session
(archive 5 versus hosted Test 6). On 09/11/2026, the owner explicitly approved
discarding **exactly that one additional post-archive Test Auth session** only
during a future, separately authorised controlled rebuild of Test project
`iukgsukdoowvnhlfmpml`. This approval does not delete or revoke the session
now, pause cron, reset Test, change providers, deploy code, touch Production or
Tandar, or waive any other archive-to-live difference.

The approval remains fail-closed at execution time. After a fresh Test-only
count snapshot, the protected private review record must still identify the
exact 5-to-6 session scope and satisfy the short-lived after-capture review
window enforced by `scripts/qa/oa5-test-live-census.mjs`. Every other governed
count must match the verified archive, and the separate provider-isolation,
four-job pause, Auth/Storage cleanup, rollback and operation-specific
destructive-authorisation gates remain mandatory. No private session identity,
token or review record belongs in Git.

## 12/11/2026 — Test Meta phone collision found in Production (later authoritative safety finding)

A read-only **Production** SQL census on `eujxswjspolugrzlsjnn` identified the previously proposed Test Meta Phone Number ID `1271836092686870` in **one** historical `public.tenant_whatsapp_connections` row **and one** `public.tenants.whatsapp_phone_number_id` legacy Business mapping. The connection row says `disconnected` but has no `disconnected_at`; webhook subscription status is `unknown`, and its credential mode is `platform_system_user`. No private credentials are attached to that connection at this checkpoint. This evidence does **not** establish current Meta Console ownership/callback release and does not authorize editing Production mappings.

**Safety consequence:** the Test-only `whatsapp-webhook/test-environment-guard.mjs` must **reject every Test webhook verification and inbound event** until a distinctly owned, independently provider-verified Test Meta phone with **no Production historical/live mapping** is approved and pinned to a reviewed source allowlist. The previously proposed QA ID is **not approved for use** solely because it was shown in a Test configuration screenshot. A Test environment variable, a disconnected status flag, or an empty Test webhook queue may not override the no-cross-environment-phone rule. The webhook on Production and local development retains its existing behavior.

**Operational gate:** independently confirm Meta App ownership, phone registration, callback subscription and HMAC credentials and obtain a newly isolated Test phone identity (or an independently verified release-and-remapping plan), then update the Test allowlist and security tests under a separate reviewed source change. Never detach a Production phone, rotate Production credentials or modify Tandar as a shortcut. This collision finding supersedes the provisional 08/11 Test phone-identity presumption without changing the approved two-environment policy, Test Firebase identity, DNS, Auth or payment-provider decisions.
