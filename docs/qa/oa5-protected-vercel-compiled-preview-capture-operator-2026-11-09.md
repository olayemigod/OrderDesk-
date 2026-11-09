# OA5 — capture original protected Vercel Preview assets without rebuilding

**Prepared:** 09/11/2026. **Status:** read-only operator guidance, NOT executed or accepted. No deployed Vercel setting, host, bypass rule, Auth, Supabase, cron, merchant record, APK, DNS or billing resource was changed.

## Why use authenticated Vercel CLI

The original five Vercel Git-deployment metadata records still show READY and their known commit hashes. Vercel's source file-tree endpoint gave a 404 for these Git deployments, but that API is not a reliable way to obtain the *original compiled browser HTML/JavaScript*. The current branch-specific VITE_SUPABASE_URL settings point to standalone Test; current settings are not sufficient evidence of what Vercel actually compiled and served in October/November.

Vercel's documented CLI command vc curl can use the operator's current Vercel identity when reading protected Preview URLs. It requires **no Vercel Pro subscription, new Preview build, disabled authentication or long-lived bypass token**. Official source: https://vercel.com/docs/cli/curl. A protected browser flow may alternatively use a short-lived Trusted Sources OIDC development token, but do not print or persist that token and do not broaden Trusted Sources.

## Exact five historical deployments to capture

| Folder | Surface | Deployment ID | Git SHA |
| --- | --- | --- | --- |
| capture_0 | Merchant | dpl_Cfh7oAt9nHQkdUZtbXShj7jfhMfw | 3f0df8f16455572cd0d1c079a3ac2327cc5bcd88 |
| capture_1 | Merchant | dpl_Gh9s6Rm2dJibEKuBDDcm7jZ3bGmz | bbee34e999971b5c87e7274428ee655e4ff36d4d |
| capture_2 | Admin | dpl_5UfqxbGpPuQqGkSu1rU4bpCFrQWZ | 7ba66274068ee75a2341a9adcccde338b1545f90 |
| capture_3 | Admin | dpl_H1suGYapnAjZR9rAKBq8WLtHu5Uo | 3f0df8f16455572cd0d1c079a3ac2327cc5bcd88 |
| capture_4 | Admin | dpl_J9nL3wiNKyXcJEoVjbb65kUw4JnA | 3c6e338ef7743c270023e791034c321294c70e6f |

Obtain exact aliases privately from the original deployment entries in the Vercel project UI and establish each URL-to-deployment-ID relation. Do not publish old Preview aliases, token-bearing links or actual compiled asset bytes in the repository. Never substitute source-generated assets or a newly deployed Preview.

## Read-only Windows PowerShell steps (existing authenticated Vercel identity)

First verify identity with vc whoami. A user who lacks historical reviewer authorization must STOP; do not disable or bypass SSO to make the check pass.

~~~powershell
vc whoami
$Root = "C:\SellerTray Private OA5\historical-preview-captures"
$Origin = "https://<ORIGINAL-VERIFIED-DEPLOYMENT-ALIAS>.vercel.app"
New-Item -ItemType Directory -Force -Path "$Root\capture_0\assets" | Out-Null
vc curl "$Origin/" --fail --silent --show-error -o "$Root\capture_0\index.html"
~~~

The origin above is intentionally a placeholder. Use the *exact original alias tied to capture_0*; then repeat separately for capture_1 through capture_4 with their own original aliases. Check that saved index.html is the actual SellerTray application HTML, not a Vercel login/SSO page, redirect, error or blank placeholder. A successful response alone is not historical reviewer or deployed origin acceptance.

From each genuine index.html, enumerate the script src paths referencing compiled .js or .mjs assets. Download them from the same original deployment origin while preserving the relative file paths under the appropriate capture folder:

~~~powershell
# Replace the placeholder using the script src path actually present in the HTML.
vc curl "$Origin/assets/<REAL-HTML-ENTRYPOINT>.js" --fail --silent --show-error -o "$Root\capture_0\assets\<REAL-HTML-ENTRYPOINT>.js"
~~~

Recursively capture any *literal local* static, export-from, or dynamic-literal JavaScript imports in the downloaded chunks. Do not invent or rewrite any file containing the Test backend project string. If a chunk is missing, imports use computed paths or other nontrivial module bundling, or SSO blocks a capture, STOP and retain the raw evidence for manual reviewer analysis rather than weakening the inspector. Do not automatically fetch untrusted third-party URLs.

Record file hashes (Windows Get-FileHash -Algorithm SHA256), capture timestamps, a protected reviewer screenshot and the original Vercel ID/alias/commit relation **only in the private evidence workspace**. Maintain the original Agreement reviewer access and verify separately that a signed-out visitor is challenged while public Production custom domains remain accessible. Do not save Vercel OIDC tokens, cookies, Authorization headers or access credentials in the capture bundle or Git.

## Private manifest and offline content-only verification

Create a private manifest JSON with these exact top-level keys:
  schema_version = 1
  scope = historical-preview-bundle-content-only
  captured_at_utc = actual UTC capture time to the second
  deployments = exactly five records

Each deployment record must have exactly:
  id = original deployment ID from the table above
  sha = matching original 40-character Git SHA
  surface = merchant or admin
  directory = capture_0 through capture_4, respectively
  capture_evidence_ref = a unique opaque private evidence identifier, not an alias/URL/token

Then run the existing **offline** compiled-capture checker from the source checkout:

~~~powershell
node scripts/qa/oa5-historical-preview-bundle-inspection.mjs --check "C:\SellerTray Private OA5\historical-preview-manifest.json" "$Root"
~~~

It requires the Test Supabase ID in original HTML-reachable JavaScript and rejects Production or another backend ID, unsafe paths, missing local module chunks and an incorrect historical deployment roster. The inspection output ALWAYS reports historical_artifact_origin_verified:false, hosted_compiled_bundle_accepted:false and destructive_execution_authorized:false, even on a successful Test-content scan.

A reviewer must independently bind the captured original bytes, file hashes, URLs, deployment IDs and authorized historical reviewers before they can be accepted. The checker is content validation, **not authenticated proof of actual Vercel provenance**.

## Scope limitations and NO-GO

No fresh deployment, domain binding, Vercel Pro upgrade, new Test project, fallback to Production, cron pause or Auth deletion is authorized by these steps. The five protected original compiled Preview bundles and reviewer proof remain OPEN until an authenticated local operator actually captures and reviews them; this document does not claim that work happened. External Meta/PSP/SMTP/FCM/AI provider isolation, managed Auth/Storage treatment, source migration replay and a separate explicit destructive Test-only approval remain blocked.
