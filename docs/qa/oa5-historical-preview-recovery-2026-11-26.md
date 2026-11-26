# OA5 Method B — 26 November original protected Preview custody recovery

**Scope:** Read-only evidence for the two historical Vercel projects. No alias, deployment, branch, DNS, security, provider, Supabase, Production, Tandar or APK modification.

## Previously frozen five deployment records versus live Vercel API

Original immutable identities are in `docs/qa/oa5-historical-vercel-preview-custody-2026-11-09.json`. **Do not revise that historical snapshot to match a later provider state.**

| Surface | Original deployment ID | Current deployment lookup | Recorded Git commit identity |
| --- | --- | --- | --- |
| Merchant | `dpl_Cfh7oAt9nHQkdUZtbXShj7jfhMfw` | **READY** | `3f0df8f16455572cd0d1c079a3ac2327cc5bcd88` |
| Merchant | `dpl_Gh9s6Rm2dJibEKuBDDcm7jZ3bGmz` | **404 not found** | `bbee34e999971b5c87e7274428ee655e4ff36d4d` |
| Admin | `dpl_5UfqxbGpPuQqGkSu1rU4bpCFrQWZ` | **READY** | `7ba66274068ee75a2341a9adcccde338b1545f90` |
| Admin | `dpl_H1suGYapnAjZR9rAKBq8WLtHu5Uo` | **READY** | `3f0df8f16455572cd0d1c079a3ac2327cc5bcd88` |
| Admin | `dpl_J9nL3wiNKyXcJEoVjbb65kUw4JnA` | **404 not found** | `3c6e338ef7743c270023e791034c321294c70e6f` |

On 26 Nov, the original Vercel `get_deployment` operation returned 404 for those two IDs, **including lookups by the two original alias hostnames**. The immutable **three READY** deployment IDs retained original source SHA, branch metadata and one original alias each.

### Crucial additional finding: the original two aliases still exist

The connected Vercel `list_aliases` and `get_alias` operations independently confirmed:

| Missing deployment ID | Existing original Preview alias |
| --- | --- |
| `dpl_Gh9s6Rm2dJibEKuBDDcm7jZ3bGmz` | `sellertray-merchant-git-codex-agree-9d372f-olayemigods-projects.vercel.app` |
| `dpl_J9nL3wiNKyXcJEoVjbb65kUw4JnA` | `sellertray-admin-git-codex-agreemen-36877c-olayemigods-projects.vercel.app` |

Each alias still points at its **exact originally frozen deployment ID**, and `sha256(utf8(deployment_id + LF + lowercase_hostname))` **matches the immutable original alias fingerprint** in `docs/qa/oa5-original-preview-alias-fingerprints-2026-11-09.json`.

**This is preserved ALIAS metadata, not a live deployed browser asset.** It does not make either missing deployment READY, prove authenticated reviewer access or guarantee recoverability. Do not treat an alias 200/404, an old user screenshot, branch-specific environment setting or a historical `READY` snapshot as current compiled JS custody.

### Original Git source is preserved separately

GitHub's connected API resolved both exact missing Preview source commits successfully:
- Merchant source `bbee34e999971b5c87e7274428ee655e4ff36d4d`, immutable Git tree `7eeb98691e6a57781e102364ad811d7f85bd9b1f`;
- Admin source `3c6e338ef7743c270023e791034c321294c70e6f`, immutable Git tree `a09468b1e021da7abc9717e1e6a5384232e93c8d`.

These Git trees preserve original **source**, not the compiled Vercel assets, the original deployment artifact, browser approval or authenticated reviewer sessions. Restoring/creating a deployment from Git is **not** silently equivalent to preserving the original deployment identity.

### Required operator recovery action — *before Test reconstruction*

Vercel's [official DEPLOYMENT_DELETED recovery guidance](https://vercel.com/docs/errors/deployment_deleted) says deleted deployments can be restored during the applicable recovery period through the Vercel project's **Settings → Security → Recently Deleted Deployments** area. Recovery availability is time-sensitive; see the [16 Oct 2026 recovery-window changelog](https://vercel.com/changelog/deleted-deployments-are-permanently-removed-sooner).

1. On the **existing Merchant project** `sellertray-merchant`, locate original deployment `dpl_Gh9s6Rm2dJibEKuBDDcm7jZ3bGmz` under **Settings → Security → Recently Deleted Deployments**.
2. On the **existing Admin project** `sellertray-admin`, locate original `dpl_J9nL3wiNKyXcJEoVjbb65kUw4JnA` at the equivalent location.
3. **If present**, ask for scoped owner approval for restoration of these **two original IDs only**. Never modify Production domains, Vercel Standard Authentication, reviewer identities, environment variables or Preview aliases, and do not create replacement Preview builds.
4. After separately approved restoration, re-query **all five** original deployment IDs and original alias fingerprints, prove READY/source SHA/branch unchanged, review original compiled client backend identity and authorized reviewer access. **Only then** can the five-Preview custody gate be marked complete.
5. **If absent/permanently lost**, preserve current four evidence classes (historical Vercel snapshot, alias fingerprints, Git trees, November 9 reviewer/browser screenshots) and request an explicit **owner decision to substitute archival custody for unrecoverable original compiled artifacts**. That is a product-governance exception, not an automatic software fix; update affected skill/preflight requirements if approved.

**No reversible restoration of a Vercel deleted deployment is available via the connected Vercel tool functions.** Vercel's UI recovery must be performed by the owner/authorized operator. No attempt was made to bypass Standard Authentication.

## Test and Production separation still intact

Both current Vercel projects retain Standard SSO protection on production-deployment URLs and all previews; their Production custom domains `app.sellertray.com` / `admin.sellertray.com` remain on the correct projects. On 26 Nov, read-only `filter_project_envs(decrypt:false)` confirmed encrypted generic Preview Supabase URL/key entries, three original Admin and two original Merchant branch-specific Preview bindings, and separate Production variable records. **Values were not decrypted**, so this is configuration **presence** only, not proof of backend target. No Test custom domains have been attached.

**Method B status: NO-GO** until the original artifact disposition and other independent provider/CLI/Auth gates pass, followed by a **new explicitly approved Test-only destructive reconstruction operation**. Production `eujxswjspolugrzlsjnn`, Tandar and all live merchants remain outside scope.
