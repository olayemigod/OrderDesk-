# SellerTray OA5 — historical Vercel Preview custody and protected Test-domain gate

**Captured:** 08/11/2026. **Scope:** provider read-only evidence + release proposal.
**Approval:** NO-GO. This is **not** permission to deploy, bind QA domains,
change authentication policies, reset the Test database, or reconfigure DNS.

## Five preserved historical agreement/visual deployments

The **exact deployment IDs** from the 07/11/2026 handover were re-read
directly from Vercel. All five still reported `READY`, and Vercel
returned the following Git commit and branch metadata. Deployment URLs
were inspected, but are deliberately not copied into this committed
document to avoid advertising potentially unprotected historic previews.

| Surface | Historical branch | Deployment ID | Git commit SHA | State |
| --- | --- | --- | --- | --- |
| Merchant | `codex/agreement-package-oa5c-convergence` | `dpl_Cfh7oAt9nHQkdUZtbXShj7jfhMfw` | `3f0df8f16455572cd0d1c079a3ac2327cc5bcd88` | READY |
| Merchant | `codex/agreement-package-architecture` | `dpl_Gh9s6Rm2dJibEKuBDDcm7jZ3bGmz` | `bbee34e999971b5c87e7274428ee655e4ff36d4d` | READY |
| Admin | `fix/admin-visual-baseline-oa5-convergence-20261031` | `dpl_5UfqxbGpPuQqGkSu1rU4bpCFrQWZ` | `7ba66274068ee75a2341a9adcccde338b1545f90` | READY |
| Admin | `codex/agreement-package-oa5c-convergence` | `dpl_H1suGYapnAjZR9rAKBq8WLtHu5Uo` | `3f0df8f16455572cd0d1c079a3ac2327cc5bcd88` | READY |
| Admin | `codex/agreement-package-architecture` | `dpl_J9nL3wiNKyXcJEoVjbb65kUw4JnA` | `3c6e338ef7743c270023e791034c321294c70e6f` | READY |

**Limit of proof:** Vercel deployment record `READY` proves existence
and metadata, not current page reachability, durable screenshot storage,
historic reviewer access, or that the **compiled browser JS** uses Test
rather than Production Supabase. The deployed source-file-tree API
returned `404 file tree not found` on a historical Git deployment; no
compiled endpoint evidence was extracted. Do **not** reuse an old
deployment as Test evidence or retire it solely because its source
commit is known.

## Observed access posture — current, not approved

- Merchant Vercel project `sellertray-merchant`: Vercel Authentication
  **off**; password protection **off**.
- Admin Vercel project `sellertray-admin`: Vercel Authentication
  **on** with `all_except_custom_domains`; QA custom-domain coverage
  **not verified** (custom domains may bypass that scope).
- Approved Test names:
  `test.sellertray.com` and `test-admin.sellertray.com`.
  Neither is bound to its Vercel project. Both have Cloudflare
  **DNS-only** CNAME records pointing at `cname.vercel-dns.com`.
- Connected Cloudflare Access applications API returned
  `access.api.error.not_enabled`; no active Access perimeter exists.
  DNS-only CNAMEs bypass Cloudflare Access.
- Live Production domain names are
  `app.sellertray.com` and `admin.sellertray.com`.
  They must remain accessible to actual merchants and administrators.

## Preferred low-resource protection evaluation

Use the **existing** Vercel projects without new paid projects or
additional QA builds. Vercel currently documents **Standard Protection**
(Vercel Authentication, free on all plans): protects preview/non-production
domains while keeping Production domains public. A branch-bound custom
domain may be considered a Preview domain, **but that must be proven
with an incognito request after configuration**. Do not assume legacy API
`all_except_custom_domains` covers branch-bound custom hostnames.

**Ordered operator procedure requiring separate security approval:**

1. Verify all five original historical Preview deployments remain
   reviewable to each explicitly authorised agreement/visual reviewer;
   archive screenshots, source SHAs, exact URLs and any dependent callback
   proof in protected evidence storage. No public URL list in Git.
2. Check Vercel project members/reviewer authorization and exact current
   `Settings → Security → Deployment Protection` scopes. Assess whether
   enabling Merchant Preview protection will disrupt external historical
   reviewers. Record an explicit reviewer-access continuity plan first.
3. After approval, set **only** the evaluated Preview/Standard Vercel
   Authentication scopes for both existing projects; **never** select
   `All Deployments` on public Production projects. Do not alter
   Production custom domains or auto-deploy settings.
4. Verify on preserved Preview URLs in a genuinely signed-out browser:
   the protected Preview URL challenges the visitor, the approved Vercel
   team reviewer can access it, and the **public Production custom
   domain remains publicly reachable**. If one check fails, restore the
   prior protection scope and STOP.
5. Once independent hosted Test backend attestation is approved, and only
   then, bind `test.sellertray.com` to a **Merchant QA-only Git branch**
   and `test-admin.sellertray.com` to a **different Admin QA-only
   branch**. Do not link either hostname to `main` or use unscoped
   aliases. Prevent accidental Vercel builds by preparing protected
   branch-specific Test env vars and source identity before creating
   the branches.
6. Verify BOTH the QA custom hostname and its corresponding generated
   `*.vercel.app` Preview URL require Vercel login, and that a genuine
   authorised QA reviewer can authenticate. Test Auth redirects, compiled
   Supabase project references, tenant isolation and the public Production
   entry points. Capture exact-source SHA and branch.
7. If branch QA custom-domain protection is not actually covered by
   Vercel Standard, STOP before exposing Test. Review a controlled
   Cloudflare Access fallback (Zero Trust account onboarding,
   QA-only proxied records, tested TLS/origin, allowlisted QA identities)
   or another independent vetted perimeter. Do not buy a new service or
   proxy Production DNS without separate approval.

**Sources:** Vercel
[Deployment Protection](https://vercel.com/docs/deployment-protection),
[Vercel Authentication standard guidance](https://blog.vercel.com/academy/optimize-your-vercel-account/deployment-protection),
[Branch Domains](https://vercel.com/blog/branch-domains);
Cloudflare [Access on proxied custom domain](https://developers.cloudflare.com/ai-search/configuration/retrieval/public-endpoint/cloudflare-access/).

## Required acceptance checklist (not completed)

- [x] Five historical deployment IDs re-read as READY; Git branches and
  source SHAs preserved as metadata.
- [ ] Five compiled JS backend references inspected and exact historic
  reviewer reachability/retention approved.
- [ ] Merchant Vercel Preview protection enabled and both legacy
  reviewer access and Production public access independently verified.
- [ ] Admin QA custom-domain access coverage established.
- [ ] QA-only Git branch names, protected env credentials and
  domain/preview binding validated before any new build.
- [ ] Unauthorized visitor blocked from **both** QA custom and Preview
  URLs; authorized Test reviewer accepted; Production unaffected.
- [ ] Supabase Test Auth and provider callbacks hosted and independently
  accepted, and OA5 backend attestation approved.

**No Test/Production database mutation, Vercel config write, Cloudflare
DNS/proxy/write, preview deployment, APK or provider callback occurred
during this read-only preservation pass.**

## 09/11/2026 — closed *source* gap for Preview protection preflight, NOT hosted activation

Review candidate draft PR #228 now includes a required `qa_preview_access_protection_preflight_verified` boolean in the shared Test staging attestation. The source-controlled value is **false**. Only an independently approved, documented **pre-binding Preview security check** may set it true. This is consumed by the common gate for Mobile QA, Merchant QA Preview and Admin QA Preview; it does not add a second business truth or turn a test screenshot into automatic hosted approval.

**Pre-binding meaning (all required before approving the flag):** preserve the five historical deployment proofs and reviewer continuity; enable only reviewed Preview-scoped protection on the existing two Vercel projects without disrupting Production; verify in a signed-out browser that existing Preview URLs challenge unauthorised visitors, that authorised historic reviewers can still view retained evidence, and that `app.sellertray.com` and `admin.sellertray.com` remain publicly reachable as intended. Record the responsible security reviewer, timestamp, project settings and rollback mechanism. Do not infer protection from branch name or SSO enabled for `all_except_custom_domains`.

**Separate post-binding stop gate:** The boolean is **not** evidence that the new `test.sellertray.com` or `test-admin.sellertray.com` custom hostnames are protected. Those URLs remain unbound. After explicit Test backend and preview approvals, deployment and hostname association, verify signed-out unauthorized rejection and authorized access at **both** QA custom hostnames and their distinct generated Preview URLs, as well as backend identity and QA Auth callbacks. Keep external provider ingress disabled and do not expose QA traffic until that subsequent independent proof is accepted. Any failed protection check requires reverting the Preview scope or leaving QA hostname routing disabled.

No Vercel protection, project, DNS or domain settings were changed by this source-only update; no preview was created. The checked-in attestation remains `blocked`. This extension adds a precondition, not release authorization.

## 09/11/2026 — repeatable sanitized historical Vercel metadata custody proof

The read-only `get_deployment`, `list_deployment_aliases`, `filter_project_envs` and `get_project_env` checks verified the **five exact archived Git deployments** in the table above are still READY. Their only aliases were generated `*.vercel.app` Preview aliases, not `app.sellertray.com`, `admin.sellertray.com`, `test.sellertray.com` or `test-admin.sellertray.com`. Every historical branch has **separate, Preview-scoped** `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` records; the URL in all five records is the independent Test project `iukgsukdoowvnhlfmpml`. No value of a publishable key, secret or historical Preview hostname is committed.

A sanitized, non-secret `docs/qa/oa5-historical-vercel-preview-custody-2026-11-09.json` captures exact deployment IDs, Git SHAs, creation timestamps, variable **identifiers** and creation/update times, alias counts and current access-protection posture. Recheck it offline with:

```bash
node scripts/qa/oa5-historical-preview-custody.mjs --check docs/qa/oa5-historical-vercel-preview-custody-2026-11-09.json
```

The checker fails closed on missing/replaced deployments, source or Branch drift, a Production custom-domain alias, Production URL bindings, mutated/late variable records or unsupported claims that browser, custom-domain protection or compiled JS were verified. It is an **immutable audit snapshot**, not live Vercel monitoring. A passing metadata check does not confirm that Vercel actually built those variable values into archived JavaScript assets. Vercel's Git deployment source tree/file-content APIs returned 404, and external direct-URL retrieval was not available to the reviewer; compiled-bundle verification and historic reviewer authentication remain outstanding.

**Current Vercel account:** Hobby, not Pro. Merchant Preview protection is OFF. Admin SSO scope `all_except_custom_domains` cannot be trusted as protection for Test custom domains. Neither QA custom hostname is currently attached. The shared staging attestation's `qa_preview_access_protection_preflight_verified` remains **false**, so the source continues to reject QA clients. No Vercel configuration, DNS, Test/Production DB, cron, provider or APK mutation occurred.

## 09/11/2026 — Read-only signed-out Preview/Production HTTP acceptance probe

The Vercel team has exactly **one Owner member** as of the 09/11 read-only connected team-member check. This does **not** establish that no historical deployment was shared through a separate access grant or bypass link, so access continuity still needs explicit reviewer confirmation before any Vercel project configuration mutation.

Vercel's documented **Standard Protection** setting is Vercel Authentication with `ssoProtection.deploymentType = "prod_deployment_urls_and_all_previews"`. It is available on the existing Hobby plan. Unlike `"all"`, it is designed to leave canonical Production custom domains public while protecting generated deployment URLs, including old review links. The current Merchant project has SSO disabled; Admin has SSO scope `all_except_custom_domains`. Neither is approved Test access protection. Enabling Standard also restricts generated Production deployment URLs, so verify no integration or external reviewer depends on a public generated URL first. Do not run a deployment to test this setting.

**Source-only executable preflight added:** `scripts/qa/oa5-vercel-anonymous-access.mjs`. After separately authorized Standard Vercel Authentication is applied, use an operator-owned shell with two approved historical Preview URLs supplied through local environment variables (values stay outside Git and CI):

```bash
SELLERTRAY_OA5_MERCHANT_HISTORICAL_PREVIEW_URL='<existing-merchant-deployment-url>' \
SELLERTRAY_OA5_ADMIN_HISTORICAL_PREVIEW_URL='<existing-admin-deployment-url>' \
node scripts/qa/oa5-vercel-anonymous-access.mjs --live
```

The opt-in script makes exactly **four anonymous GETs**, manually prevents following redirects, sends no cookies/auth headers, and never exposes supplied URL values. It requires both Preview URLs to belong to their expected Vercel project hostnames and redirect to Vercel authentication, while both canonical Production domains return HTTP 200 HTML without a redirect. The instrument is intentionally stricter than broad HTTP 2xx/3xx: a 200 login-lookalike, 401 without the expected redirect, or redirect to another domain is **not** accepted as proof. A failure is a STOP and needs operator diagnosis, not weakening the checker.

**This probe is NOT an acceptance by itself.** Independently (1) use a private browser to verify the Vercel challenge, (2) sign in as the authorized historic reviewer and verify the exact legacy deployment is viewable, (3) verify production remains accessible outside a Vercel session, (4) inspect and preserve historic compiled JS backend identity separately, and (5) complete explicit Test callback/cron/reset sign-off. Only an authorized, reviewed scope change may set `qa_preview_access_protection_preflight_verified` true. New `test.sellertray.com` and `test-admin.sellertray.com` would still require separate post-binding protected-hostname and Test backend checks. No protection settings, Vercel domains, Git branches, hosted database or API provider callbacks changed during source work.

Source: [Vercel Deployment Protection](https://vercel.com/docs/deployment-protection) and [Vercel Authentication](https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/vercel-authentication).


## 09/11/2026 — offline five historical compiled-bundle inspection (unverified origin)

The owner has already verified Standard Vercel Authentication on both existing projects, signed-out login challenges on the historic generated deployment URLs, and public reachability on canonical Production domains. A fresh read-only Vercel project/domain check reconfirmed the Standard scope on both existing projects and that test.sellertray.com / test-admin.sellertray.com remain **unattached**. No Vercel/DNS settings or deployments changed.

**Access limitation:** Vercel's deployment-files API still returns **404 File tree not found** for all five exact historic Git deployments. Metadata and branch-scoped variable records do **not** prove the backend embedded in previously compiled browser JavaScript. Do not create a replacement Preview, reconstruct an old build from Git and claim it is the historic deployed artifact, or repurpose the preserved old pages as clean QA.

**New non-destructive helper:** scripts/qa/oa5-historical-preview-bundle-inspection.mjs. Its synthetic regression tests are wired to the OA5 source workflow. It takes five privately captured historical HTML+JS trees and rejects an incorrect/missing deployment identity, SHA, surface or evidence reference; missing HTML/compiled JS; absent Test Supabase project identity; any Production project reference; any unknown Supabase endpoint; unsafe/symlinked artifact trees; and missing or secret-bearing manifest fields. It performs no HTTP/provider, browser, database, Git or deployed-site operation.

### Protected operator capture (not yet performed)

1. An authorised historical Vercel reviewer opens each original preserved deployment page through its old generated deployment URL and the existing Vercel Authentication. Record authenticated reviewer, exact original deployment ID, source SHA, timestamp and original page URL privately. Never commit URL lists, cookies, HAR, tokens, publishable-key values, browser session archives or private captures.
2. Privately capture the **served HTML and all loaded compiled JavaScript chunks**, including dynamically loaded Agreement and Admin routes, from the **original** five deployments. The operator must independently verify that these are actual original served assets, not a Vercel login HTML page, browser cache, a newly compiled source checkout or the Production custom domain. The offline tool cannot establish origin or exhaustively discover assets missing from the supplied capture.
3. Create one private JSON manifest with EXACTLY the five immutable deployment IDs/source SHAs/surfaces already documented in oa5-historical-vercel-preview-custody-2026-11-09.json, their unique relative directory names and opaque non-secret capture evidence references. Example structure for one record (the actual private manifest must have five):

~~~json
{
  "schema_version": 1,
  "scope": "historical-preview-bundle-content-only",
  "captured_at_utc": "2026-11-09T20:00:00Z",
  "deployments": [
    {
      "id": "dpl_Cfh7oAt9nHQkdUZtbXShj7jfhMfw",
      "sha": "3f0df8f16455572cd0d1c079a3ac2327cc5bcd88",
      "surface": "merchant",
      "directory": "capture_merchant_1",
      "capture_evidence_ref": "private-evidence-0001"
    }
  ]
}
~~~

4. Run this content-only tool, with private paths, on an isolated operator computer:

~~~sh
node scripts/qa/oa5-historical-preview-bundle-inspection.mjs --check /secure/private/five-bundle-manifest.json /secure/private/five-original-preview-assets
~~~

5. An offline PASS means ONLY the **supplied** text files look consistent with Test backend references and none contain an identifiable Production/unknown Supabase project. The tool ALWAYS returns historical_artifact_origin_verified:false, hosted_compiled_bundle_accepted:false and destructive_execution_authorized:false. Independent historic reviewer access, artifact provenance/completeness, running app/redirect identity and preservation must be reviewed outside the tool. A 404 source tree means **STOP** rather than automatically waiving the old bundle gate.

**Current gate remains OPEN:** no protected original bundles or five-record private manifest have been provided, so no actual archived compiled-bundle acceptance was run. No Auth/Storage, cron, SQL, provider, preview, APK, Production/Tandar or C2 change was authorized or performed. Source-only preparation needs no paid resource.

## 09/11/2026 — tighter HTML entrypoint linkage for offline artifacts

A new regression review caught a **synthetic false-positive risk** in the first offline bundle inspector: it could report content consistency when an unrelated JavaScript file contained the Test project reference even though the captured HTML never loaded that file. The source helper now also requires a captured **root `index.html`**, locally available HTML-linked JavaScript entrypoint(s), and at least one **HTML-linked entrypoint** with the expected Test backend ref. It explicitly blocks HTML-only Test text, missing/unsafe script source paths, root HTML omission, and decoy orphan JS that contains a Test ref. Production/unknown Supabase backend references anywhere in supplied compiled text still block.

The check is intentionally conservative: if a real Vite build keeps its Supabase initialization solely in a secondary imported/lazy-loaded JS module rather than a direct HTML-linked entrypoint, the tool may **fail closed** despite an otherwise safe original bundle. Do not modify the original assets, inject a Test ref, or weaken the blocker merely to obtain a PASS. Instead record the genuine module graph and expand the offline inspector with independently reviewed source-specific evidence, while retaining its separate `historical_artifact_origin_verified:false` invariant. It still cannot prove that the supplied files are actual original Vercel outputs, that all dynamic chunks have been captured, or that historical reviewers retain authorized access.

This only revises source QA and synthetic tests. It does not authorize live asset retrieval, provider callbacks, Test schema/cron/Auth/Storage mutation, paid resources, Preview/QA APK builds or Production/Tandar changes.
