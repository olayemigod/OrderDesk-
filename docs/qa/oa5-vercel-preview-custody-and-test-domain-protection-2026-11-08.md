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
