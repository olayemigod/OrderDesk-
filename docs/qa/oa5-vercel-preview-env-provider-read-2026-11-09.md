# SellerTray OA5 — Vercel historical Preview build-time environment custody (09/11/2026)

**Direct provider read, no mutation.** Team `team_71eDTmWQyCnVCLtYJRjocZid`; existing Merchant `sellertray-merchant` and Admin `sellertray-admin` projects. This is a deliberately **sanitized** record: the Vercel API was queried in read-only mode for environment-variable metadata and for **only** the public frontend `VITE_SUPABASE_URL` and frontend `VITE_SUPABASE_PUBLISHABLE_KEY` values. No actual URLs, keys, provider secrets, credentials, user data or historical Preview aliases are committed. Public backend values were classified by exact Supabase project ref; publishable keys were checked for equality/shape **without retaining or reporting their contents**.

**Scope distinction:** This proves current Vercel **provider environment configuration** and documented historical branch-override timestamps. It does **not** prove the historically built JavaScript uses those exact values, that the original five compiled assets were actually retrieved, that Auth/SMTP/Meta/PSP/FCM callbacks are safe, or that reviewer access has been preserved. These last acceptance gates remain OPEN.

## Direct Vercel provider observations

| Vercel surface | Variable scope | `VITE_SUPABASE_URL` project | Publishable key | Last updated at (UTC) |
|---|---|---|---|---|
| Merchant | default Preview | standalone **Test** `iukgsukdoowvnhlfmpml` | distinct from Production | 07/11/2026 20:16:44 |
| Merchant | `codex/agreement-package-oa5c-convergence` Preview override | **Test** | same as Test default | 27/10/2026 11:45:08 |
| Merchant | `codex/agreement-package-architecture` Preview override | **Test** | same as Test default | 26/10/2026 23:53:15 |
| Merchant | Production | live **Production** `eujxswjspolugrzlsjnn` | distinct from Test | 07/11/2026 20:16:41 |
| Admin | default Preview | **Test** | distinct from Production | 07/11/2026 20:17:08 |
| Admin | `fix/admin-visual-baseline-oa5-convergence-20261031` Preview override | **Test** | same as Test default | 01/11/2026 20:38:31 |
| Admin | `codex/agreement-package-oa5c-convergence` Preview override | **Test** | same as Test default | 27/10/2026 11:45:00 |
| Admin | `codex/agreement-package-architecture` Preview override | **Test** | same as Test default | 26/10/2026 23:53:13 |
| Admin | Production | **Production** | distinct from Test | 07/11/2026 20:17:05 |

All nine URL scopes were observed as valid HTTPS Supabase project URLs with the expected 20-character project reference. Each `VITE_SUPABASE_PUBLISHABLE_KEY` value matched the public `sb_publishable_` format. The Test publishable key was **the same for both Merchant/Admin projects and all historical Test Preview overrides**, and was **different from the Production publishable key**, which was also the same between Merchant/Admin Production. These are direct equality checks of the provider-returned values, **not** inferences from variable comments or names.

The generic Preview defaults were configured **on 07/11/2026, later than all five historic deployments**. Therefore they cannot alone establish the original historic build bindings. The historical branch-specific overrides existed before the relevant original deployment timestamps and were still unchanged when inspected on 09/11/2026.

## Historical deployment/source alignment

| Original deployment | Surface | Git branch | Deployment created (UTC) | Branch-specific Test override last updated (UTC) | Elapsed |
|---|---|---|---|---|---|
| `dpl_Cfh7oAt9nHQkdUZtbXShj7jfhMfw` | Merchant | `codex/agreement-package-oa5c-convergence` | 30/10 05:11:05 | 27/10 11:45:08 | ~65h 26m |
| `dpl_Gh9s6Rm2dJibEKuBDDcm7jZ3bGmz` | Merchant | `codex/agreement-package-architecture` | 27/10 01:31:34 | 26/10 23:53:15 | ~1h 38m |
| `dpl_5UfqxbGpPuQqGkSu1rU4bpCFrQWZ` | Admin | `fix/admin-visual-baseline-oa5-convergence-20261031` | 01/11 21:21:09 | 01/11 20:38:31 | ~42m 38s |
| `dpl_H1suGYapnAjZR9rAKBq8WLtHu5Uo` | Admin | `codex/agreement-package-oa5c-convergence` | 30/10 05:11:05 | 27/10 11:45:00 | ~65h 26m |
| `dpl_J9nL3wiNKyXcJEoVjbb65kUw4JnA` | Admin | `codex/agreement-package-architecture` | 26/10 23:53:39 | 26/10 23:53:13 | **~27 seconds** |

Vercel's provider read returned the same five immutable IDs, source Git SHAs and `READY` state as the existing custody record. The earliest Admin deployment's override and deployment creation are only ~27 seconds apart. That is a real timing caveat, not proof that the override was consumed by its build. Vercel currently exposes branch-specific environment variables as recorded, but the file-tree endpoint returned `404` for historical Git deployments. Do not infer compiled-artifact proof from the elapsed timestamps.

## Boundary and operator consequences

1. **Provider frontend-configuration scope: observed** for Merchant/Admin Production, default Preview and all historical Preview branch overrides; all are correctly segregated by source project and have different Test/Production publishable keys. This addresses a *subset* of `test_admin_merchant_domains_and_auth_redirects` and `historical_compiled_backend_boundary` review; neither whole category may be marked reviewed.
2. **Immutable historic compiled JS: still OPEN.** Require a protected capture of actual original HTML and JavaScript chunks, independently tied to each original Vercel ID, and the offline five-bundle inspection. A snapshot of current environment-variable settings cannot substitute for bytes that Vercel served on 26/10–01/11.
3. **Current QA Preview builds: still BLOCKED.** The checked-in staging attestation is `state:blocked`. The source-side `scripts/qa/vercel-frontend-environment.mjs` rejects non-QA branch names and an unapproved Agreement Test backend for **new** Preview builds, notwithstanding Vercel's Test-only default environment settings. Do not create Preview deployments just to see if they work; doing so would not resolve the historical-original-bundle gate.
4. **External providers: OPEN.** No Meta/Paystack/Flutterwave/SMTP/FCM/AI dashboard, actual production phone, sending route or callback was verified here. Test's four cron schedules remain active, and this is not authorization to pause them.
5. **Production untouched.** No Vercel variables, published keys, project domains, authenticated previews, database objects, scheduled jobs, third-party callbacks or production merchants were changed.

**Release disposition:** PR #228 remains **draft**; OA5 backend attestation and hosted Test clean rebuild remain **NO-GO**, pending the distinct original-bundle and provider-console acceptance evidence, staged cleanup/rollback review and operation-specific approval.


## Independent Cloudflare DNS evidence, 09/11/2026

A separate **read-only** check on the connected Cloudflare zone sellertray.com confirmed the zone is **active** on its existing **Free Website** plan. Exact-name DNS queries returned one record for each of the four approved public hostnames:

| Hostname | Record | Current DNS target | Proxied | Meaning |
|---|---|---|---|---|
| test.sellertray.com | CNAME | cname.vercel-dns.com | false (DNS only) | **DNS pre-staged, not attached to Vercel Merchant project** |
| test-admin.sellertray.com | CNAME | cname.vercel-dns.com | false (DNS only) | **DNS pre-staged, not attached to Vercel Admin project** |
| app.sellertray.com | CNAME | 086772467cd80d17.vercel-dns-017.com | false (DNS only) | Existing Production Merchant routing |
| admin.sellertray.com | CNAME | 4c389925aaffc5aa.vercel-dns-017.com | false (DNS only) | Existing Production Admin routing |

Both Test DNS record comments explicitly describe **QA branch binding pending**. Their Cloudflare DNS-only state **does not provide Cloudflare Access protection**; Vercel's pre-binding project Standard Authentication does not itself prove that a subsequently bound *custom domain* will be protected. No DNS query here verified any HTTP page, authenticated session, TLS certificate, redirect flow or deployed backend.

**Disposition:** the **Cloudflare DNS configuration pre-stage is independently observed** and requires **no new paid resource, record creation or change** at this stage. Test custom domain binding stays **forbidden** until canonical Test backend attestation, source branch / published key isolation, signed-out custom-domain protection, provider callback isolation and explicit deployment authorization. Do not point these existing DNS entries at Production, change the live CNAMEs, enable a new proxy or create a Cloudflare Access subscription merely to pass source QA. This was a GET-only inspection with no host mutation.
