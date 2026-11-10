# OA5 — capture original protected Vercel Preview assets without rebuilding

**Prepared:** 09/11/2026. **Status:** read-only operator guidance, NOT executed or accepted. No deployed Vercel setting, host, bypass rule, Auth, Supabase, cron, merchant record, APK, DNS or billing resource was changed.

## Why use authenticated Vercel CLI

The original five Vercel Git-deployment metadata records still show READY and their known commit hashes. Vercel's source file-tree endpoint gave a 404 for these Git deployments, but that API is not a reliable way to obtain the *original compiled browser HTML/JavaScript*. The current branch-specific VITE_SUPABASE_URL settings point to standalone Test; current settings are not sufficient evidence of what Vercel actually compiled and served in October/November.

Vercel's documented CLI command vercel curl can use the operator's current Vercel identity when reading protected Preview URLs. It requires **no Vercel Pro subscription, new Preview build, disabled authentication or long-lived bypass token**. Official source: https://vercel.com/docs/cli/curl. A protected browser flow may alternatively use a short-lived Trusted Sources OIDC development token, but do not print or persist that token and do not broaden Trusted Sources.

**Operator confirmation (10 November 2026):** Vercel CLI **65.14.0** is installed and authenticated as `olayemigod` in the existing `olayemigods-projects` Hobby team. Its actual `vercel curl --help` shows the `--` separator before flags forwarded to curl. The protected capture runner and manual examples now use `vercel curl <URL> -- --fail --silent --show-error ...`. No user-side deployment or external callback has been executed by these confirmations.

## Verified CLI behavior and Windows compatibility

Vercel officially supports full URL syntax for \`vercel curl\` (introduced in its 15 May 2026 CLI update) and forwards curl flags to the system curl executable. The command uses the current Vercel identity to **obtain or generate an ephemeral deployment-protection bypass token internally** when needed. The operator does not supply, print, store or commit a bypass secret. This does **not** justify disabling Vercel Authentication or changing access rights. The local CLI must be new enough to support full URL \`vercel curl\`; check \`vercel --version\` and \`vercel curl --help\` before making any requests. If unsupported, STOP; do not use \`vercel deploy\` or relink the project to work around it.

For Windows PowerShell, Node cannot directly \`execFileSync\` an npm-installed \`.cmd\` shim. The guarded capture utility now invokes \`vercel.cmd\` through \`cmd.exe\` **only** for \`whoami\` and a constrained, read-only \`curl\` request to one of the exact pinned original Vercel hosts. It rejects shell metacharacters, query strings, fragments, encoded paths, host/port overrides, redirects to unknown destinations and all other commands. On Linux/WSL it runs the \`vercel\` executable directly without a shell. This fixes a Windows execution defect in the initial capture helper. GitHub CI tests **command construction and synthetic capture only**; a real operator-authenticated Windows capture remains pending.

References: [Vercel CLI curl](https://vercel.com/docs/cli/curl), [full-URL curl syntax release](https://vercel.com/changelog/use-native-curl-syntax-with-vercel-cli), and [Node.js Windows .cmd process behavior](https://nodejs.org/api/child_process.html#spawning-bat-and-cmd-files-on-windows).

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

First verify identity with vercel whoami. A user who lacks historical reviewer authorization must STOP; do not disable or bypass SSO to make the check pass.

~~~powershell
vercel whoami
$Root = "C:\SellerTray Private OA5\historical-preview-captures"
$Origin = "https://<ORIGINAL-VERIFIED-DEPLOYMENT-ALIAS>.vercel.app"
New-Item -ItemType Directory -Force -Path "$Root\capture_0\assets" | Out-Null
vercel curl "$Origin/" -- --fail --silent --show-error --output "$Root\capture_0\index.html"
~~~

The origin above is intentionally a placeholder. Use the *exact original alias tied to capture_0*; then repeat separately for capture_1 through capture_4 with their own original aliases. Check that saved index.html is the actual SellerTray application HTML, not a Vercel login/SSO page, redirect, error or blank placeholder. A successful response alone is not historical reviewer or deployed origin acceptance.

From each genuine index.html, enumerate the script src paths referencing compiled .js or .mjs assets. Download them from the same original deployment origin while preserving the relative file paths under the appropriate capture folder:

~~~powershell
# Replace the placeholder using the script src path actually present in the HTML.
vercel curl "$Origin/assets/<REAL-HTML-ENTRYPOINT>.js" -- --fail --silent --show-error --output "$Root\capture_0\assets\<REAL-HTML-ENTRYPOINT>.js"
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


## Automated, guarded private original-asset capture (preferred over manual chunk copying)

A new **explicitly invoked, read-only** local Node utility, \`scripts/qa/oa5-protected-preview-capture.mjs\`, can collect the original compiled JavaScript modules without manually copying each import. It has no cloud credentials of its own and relies on the operator's existing authenticated \`vercel curl\` Vercel CLI identity. Its synthetic tests run in CI with a **mock request transport**, so CI never contacts a Preview deployment.

**Before attempting a capture:** obtain a private Vercel original-alias-to-deployment-ID mapping from the existing five historical deployment records, and confirm the reviewer is already authorized. The provider read-only alias inventory currently shows **exactly one project-specific .vercel.app alias for each of all five original deployments**, but this is **metadata-only**, not an actual compiled asset capture or reviewer authorization. Do not publish those hostnames in a PR.

Prepare an **untracked, protected JSON input** outside the repository. The top-level keys must be exactly \`schema_version\`, \`purpose\` and \`deployments\`. Set version \`1\` and purpose \`read-only-original-preview-capture\`. Each of **five** deployments has exactly \`id\`, \`sha\`, \`surface\`, \`origin\` and \`capture_evidence_ref\`. Use the five original IDs/Git SHAs/surfaces in the table above. \`origin\` must be the exact independently verified original HTTPS deployment alias in the expected \`sellertray-merchant-…vercel.app\` or \`sellertray-admin-…vercel.app\` format, with no path, query, fragment or credentials. Each private evidence reference must be a different opaque identifier. Do **not** substitute a Production domain, generic project root alias, Test custom domain, newly created Preview or unreviewed third-party URL.

The following single-entry skeleton documents the private record's field shape; a real manifest **must have all five** entries and actual verified original aliases, not placeholder values:

~~~json
{
  "schema_version": 1,
  "purpose": "read-only-original-preview-capture",
  "deployments": [
    {
      "id": "dpl_Cfh7oAt9nHQkdUZtbXShj7jfhMfw",
      "sha": "3f0df8f16455572cd0d1c079a3ac2327cc5bcd88",
      "surface": "merchant",
      "origin": "https://<REAL-ORIGINAL-MERCHANT-ALIAS>.vercel.app",
      "capture_evidence_ref": "private-review-unique-0001"
    }
  ]
}
~~~

In the source checkout on the operator's Windows workstation, **only with existing Vercel authentication**, run:

~~~powershell
vercel whoami
node scripts/qa/oa5-protected-preview-capture.mjs --check-plan "C:\SellerTray Private OA5\historical-preview-private-plan.json"
node scripts/qa/oa5-protected-preview-capture.mjs --capture "C:\SellerTray Private OA5\historical-preview-private-plan.json" "C:\SellerTray Private OA5\original-compilation-20261110"
~~~

The destination must be a **new, otherwise empty private folder**. The parent must exist and be access-controlled; the utility refuses to overwrite a prior capture. The utility also rejects private plan files and capture destinations **inside the SellerTray Git checkout**, preventing accidental commits of historical Preview aliases or compiled browser assets. This protection canonicalizes existing parent paths, including symbolic links and Windows directory junctions, so an outside-looking path that resolves into the checkout is also refused. It accepts only five exact immutable original IDs/SHAs and correct project-specific Vercel Preview hostnames. It reads only the original deployment root HTML and **local literal JavaScript script-src/import graph** from the same origin. It rejects external script URLs, unsafe local paths, missing files, SSO HTML masquerading as JavaScript, oversized content, Production/other Supabase backend references and malformed input. It never runs \`vc login\`, changes permissions, triggers application APIs, deploys, creates a Preview, binds a domain, or accesses Supabase.

On successful Test-only **content** inspection, the tool saves \`private-capture-manifest.json\` and \`private-capture-hashes.json\` under the private destination, plus the original HTML/JS files in \`capture_0\` through \`capture_4\`. The hash file contains file paths and SHA-256 checksums but no original alias URLs. The tool's own flags remain \`original_vercel_origin_attested:false\`, \`authorized_reviewer_verified:false\`, \`hosted_compiled_bundle_accepted:false\`, \`destructive_execution_authorized:false\`. **The operator must separately prove that the privately supplied alias actually belongs to each original deployment ID and that original authorized reviewers still have access.**

The collector is intentionally bounded: computed dynamic imports, unusual bundler preload indirections, third-party JavaScript and imported CSS/assets are not automatically fetched. If any such dependencies affect the actual app/backend identity, mark the evidence **incomplete** rather than creating a new build or weakening inspection. A new *private* capture that passes the script is only evidence of content consistency, not an accepted historical Agreement reviewer/callback or data-recovery gate. Preserve all actual bytes and screenshots privately, never in GitHub or project CI.

The **manual vercel curl commands above** remain an alternative for an expert operator who needs to investigate a block. The fully guarded tool is preferred when the original Vite modules are within the supported literal-local graph. A hostile URL, protection page, failed request or unexpected deployment identity is a STOP, not permission to bypass authentication.


### Original Vercel alias fingerprint reconciliation — source-only safeguard

The connected Vercel provider was queried again **read-only** on 09/11/2026 for the five original deployment IDs; all five still had **exactly one** project-specific Preview alias. To avoid publishing those private reviewer-facing hostname values, only SHA-256 fingerprints of \`deployment_id + newline + lowercase hostname\` were committed in [the five-original-alias provider baseline](oa5-original-preview-alias-fingerprints-2026-11-09.json).

The guarded local collector now **rejects any plausible-looking but wrong .vercel.app URL**. It hashes each supplied private plan hostname and requires it to match the previously observed **exact alias for that deployment ID**, in addition to its fixed surface, source SHA, protected origin shape and unique evidence reference. No alias or credential value is printed by the checker or stored in Git. A change to a Vercel original alias now causes a **fail-closed STOP** requiring another independent provider read and a reviewed baseline update; never silently substitute a new Preview hostname.

**Important scope:** SHA-256 equality confirms the private plan's alias was in the Vercel provider's frozen deployment-alias response; it does not by itself prove that the alias is **still** bound to the deployment at capture time, that the originally served bytes were captured, or that authorized historical reviewers retain access. The operator still has to confirm those properties using the original deployment in the Vercel UI, byte checksums and actual signed-in/signed-out browser evidence. The tool deliberately continues returning \`original_vercel_origin_attested:false\`, \`authorized_reviewer_verified:false\` and \`hosted_compiled_bundle_accepted:false\`.

Offline CI uses fake Preview hostname fixtures with **injected test-only digest policy and mocked HTTP**, never real aliases or a real Vercel authenticated request. That synthetic override is rejected if the capture is using the genuine Vercel CLI transport. Real CLI entrypoints always use the fixed five-alias fingerprint baseline.


## 10/11/2026 — first real Windows capture returned generic BLOCKED; preserve partial evidence

After the private plan returned PASS under the operator's Vercel CLI 65.14.0 Hobby account, the first real read-only capture returned the previous catch-all message: "original protected Preview capture is missing, unsafe, or content-inconsistent." **No cause can be established from that message.** Do not claim SSO failure, a missing Vercel file, wrong backend, or historical reviewer success based on it. Existing files are deliberately retained when a download fails.

**New source-only fix:** the runner now emits a fixed safe code (for example ROOT_GET_FAILED, JS_GET_FAILED, ROOT_NOT_APP_HTML, JS_IMPORT_UNSUPPORTED, or COMPILED_CONTENT_MISMATCH) and an original deployment ID if applicable. Raw CLI stderr, original URLs, authenticated cookies, access tokens and local paths remain suppressed. Regression tests cover the classification and non-disclosure. This diagnostic upgrade does not perform a new hosted request or authorize a bypass. To use it, the operator must pull the updated draft PR HEAD and, after reviewing the existing capture's partial status, use a **new** empty private output directory. Never overwrite or delete the original partial directory just to retry.

**First perform offline, read-only inspection of the existing private partial directory in PowerShell:**

~~~powershell
0..4 | ForEach-Object {
  $d = Join-Path $Output "capture_$_"
  [pscustomobject]@{
    Capture = "capture_$_"
    Exists = Test-Path -LiteralPath $d -PathType Container
    IndexHTML = Test-Path -LiteralPath (Join-Path $d "index.html") -PathType Leaf
    JSFiles = if (Test-Path -LiteralPath $d -PathType Container) {
      @(Get-ChildItem -LiteralPath $d -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object Extension -In ".js", ".mjs").Count
    } else { 0 }
  }
} | Format-Table -AutoSize
[pscustomobject]@{
  PrivateManifestPresent = Test-Path -LiteralPath (Join-Path $Output "private-capture-manifest.json")
  PrivateHashesPresent = Test-Path -LiteralPath (Join-Path $Output "private-capture-hashes.json")
}
~~~

These summary counts alone do not prove the cause, but show how far the attempted capture progressed. Do not display, upload, paste or commit downloaded HTML/JS, complete private plan, Vercel URL, token or original capture. If all five capture folders have some content but both manifests are absent, the offline compiled backend content inspection may have failed; it cannot be accepted without evaluating the protected files.

**Only if the first capture directory lacks index.html**, the operator can perform a single fresh, explicitly read-only diagnostic GET of the first original alias from the protected plan. Keep the body private and share only the shell exit code and non-sensitive file-shape metadata. Use \`vercel.cmd curl\` with its v65 \`--\` option separator; do not alter Vercel SSO or create another Preview. If the GET fails, capture and retain the full CLI output privately, but do not paste tokens/URLs in a public issue. Do not attempt a destructive Test maintenance operation while this gate is open.


## 10/11/2026 — first private capture stopped inside capture_0; offline module diagnosis

**Actual Windows operator observation:** the first read-only original-Preview capture stopped after creating **capture_0/index.html and two JavaScript files**, before any capture_1, capture_2, capture_3 or capture_4 directory. This narrows the failure to capture_0. It does **not** identify the exact failed request or whether the old runner blocked an unsupported import. It also does not prove that the first HTML or scripts are from their historical Vercel origin, nor that historical reviewer access remains valid.

**New safe offline diagnosis (source-only):** \`scripts/qa/oa5-partial-preview-diagnose.mjs\` inspects **the existing failed capture directory without any HTTP, Vercel command, writes, token reads, source printing, file name output or new artifact fetch**. It reports only: root HTML present, saved JS count, HTML script references missing/unsafe, locally imported modules already saved/missing, unsupported or remote imports, and *counts* of saved JS containing either Test or Production Supabase refs. It avoids claiming a specific failed GET if the saved graph cannot prove one. A captured module with a Production ref remains an explicit STOP for further review.

From the existing PowerShell session, where \`$Source\`, \`$Runner\` and \`$Output\` were already set:

~~~powershell
git -C "$Source" pull --ff-only
$Diagnostic = Join-Path (Split-Path -Parent "$Runner") "oa5-partial-preview-diagnose.mjs"
node "$Diagnostic" --check "$Output"
~~~

Do **not** use \`--capture\` or retry against the same \`$Output\` folder. Preserve the existing partial files, their timestamps, and any actual original-content evidence privately. Only share the fixed JSON count fields and diagnosis label; the diagnostic never prints any original hostname, filename, JS, HTML, token, raw URL, local private directory or access credentials. It always reports \`hosted_compiled_bundle_accepted:false\` and \`destructive_execution_authorized:false\`.

Interpret the label conservatively:
- \`HTML_JS_ENTRY_NOT_CAPTURED_OR_UNSAFE\`: at least one HTML-referenced script is not present or has an unsupported source URL; cannot conclude HTTP failure rather than an unsafe link.
- \`UNSUPPORTED_IMPORT_PRESENT\`: the two already saved JS files include a literal import the bounded parser cannot safely resolve. Could be an external import; **do not fetch that origin**.
- \`LOCAL_JS_IMPORT_NOT_CAPTURED\`: a literal local import refers to a not-yet-captured JS file, possibly the next failed GET; still **not proof** of HTTP status or origin.
- \`NO_OBVIOUS_UNRESOLVED_REFERENCE_IN_SAVED_FILES\`: no unsupported/missing literal import in the saved files; the cause could be a parser gap, byte-limit failure, lost network response or another unobserved boundary. Do not infer success.
- \`ROOT_HTML_ONLY\` or \`ROOT_HTML_NOT_SAVED\`: source capture stopped earlier than the two-JS state currently observed; this would require reviewing whether the operator selected the same original \`$Output\`.

**QA posture:** all five original compiled bundles remain unaccepted, no Test/Production operations were authorized or performed by this offline diagnosis, and both the Vercel original-URL credential boundary and active Test cron schedules remain unchanged.


## 10/11/2026 — capture_0 saved module graph: one unsupported import, seven unavailable files

The owner performed the **offline** diagnosis against the preserved, failed private capture directory. Verified output: capture_0/index.html present, **2 saved JavaScript files**, **one safe HTML entry**, **9 literal JS import strings parsed**, **1 already saved imported module**, **7 missing local import targets**, **1 unsupported or remote import**, **1 saved JS referencing the Test Supabase ID**, and **0 saved JS referencing the Production ID**. None of the other four original deployment capture directories was created. This is evidence of incomplete capture_0, **not** a claim that the unexpected module is necessarily from a remote URL, or that the 7 missing modules returned HTTP errors. The parser can misidentify ESM-looking syntax inside compiled/minified JS; it is not complete dynamic import analysis.

The active capture tool rejects that unsupported import; it should remain fail-closed instead of silently skipping an external dependency or weakening the Test-backend compiled check. The offline diagnostic has now been enhanced with fixed **rejected_import_shape_counts** labels: remote_http, protocol_relative, other_scheme, bare_specifier, non_js_local_target, unsafe_local_path, malformed, malformed_encoded_path, invalid_or_outside_local_path. These reveal **only category counts**, never external domains, path names, package specifiers, asset text or token/credential strings.

The operator can repeat the **offline-only** command (without fetching or overwriting anything):

~~~powershell
git -C "$Source" pull --ff-only
node "$Diagnostic" --check "$Output"
~~~

If the rejected import is bare_specifier or remote_http, inspect its significance in the private environment; **do not automatically fetch it, substitute a local package, skip it or accept the original Preview as isolated**. If it is non_js_local_target, distinguish an actual stylesheet/asset reference from an unexpected module import before changing graph policy. If it is invalid_or_outside_local_path or unsafe_local_path, STOP for a security review. Seven missing literal local JS targets remain incomplete even after the unsupported reference is classified. A new remote attempt is not authorized merely by this offline observation. Original compiled artifact origin, historical reviewer continuity and provider isolation remain independent blocked gates.


## 10/11/2026 — verify bare specifier as real compiled ESM import, without executing downloaded code

**Actual second offline operator check:** among the nine regex-detected import strings in two retained JavaScript files, exactly **one** was classified as a \`bare_specifier\`; remote_http, protocol_relative, other_scheme, invalid/outside paths and non-JavaScript import categories were all zero. Seven missing local JS files remain. The presence of a bare import **may be genuine ESM or a regex match inside compiled source text/comment**. Neither possibility proves that an original deployed browser module was broken, and no external fetch is justified by that count alone.

The offline diagnostic now optionally invokes Node's **V8 JavaScript module parser** to distinguish genuine static \`import … from 'package'\`, \`import 'package'\` and \`export … from 'package'\` dependencies from incidental regex matches in JS strings/comments. This parser is **parse-only**: it neither links nor evaluates any captured JavaScript, imports any module, or contacts a network. Using it does not accept the capture or weaken the original importer/production isolation gate.

On the owner's Windows PowerShell session, with the existing private \`$Output\` preserved:

~~~powershell
git -C "$Source" pull --ff-only
node --experimental-vm-modules "$Diagnostic" --check "$Output"
~~~

Share only the fixed boolean/count JSON fields, especially \`static_module_parser_available\`, \`static_module_files_parsed\`, \`static_module_parse_errors\`, \`proven_static_bare_imports\`, and \`rejected_import_shape_counts.bare_specifier\`. The CLI deliberately suppresses parser error detail or source text, and the parser may emit a harmless Node experimental-feature warning to stderr. **If \`proven_static_bare_imports > 0\`, STOP and assess the actual dependency's original browser-resolution mechanism privately (import map, externalized package or similar). Do not skip it, fetch an arbitrary package, create a new Preview or claim successful compiled isolation.** If the number is zero, the regex hit may be a dynamic import or incidental quoted text/comment; this still needs bounded graph validation and does **not** make the seven missing original JS files acceptable.

The V8 check is deliberately optional, so normal QA CI can run unchanged on Node without experimental VM module support. Its isolated regression tests invoke the experimental parser explicitly against **synthetic files only**; no original Preview bytes enter CI.
