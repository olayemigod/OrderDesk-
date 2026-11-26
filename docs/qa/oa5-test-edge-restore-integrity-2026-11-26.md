# SellerTray OA5 — Test Edge bundle digest parity after restoration

**Date:** 26 Nov 2026. **Only Test project:** `iukgsukdoowvnhlfmpml`. **Production:** `eujxswjspolugrzlsjnn` never queried or changed. **Boundary:** read-only provider metadata plus source-only tests. **No Edge invoke, deploy, SQL mutation, database reconstruction, webhook, provider change, APK or Production/Tandar operation.**

## Key finding: the five original Edge bundle digests are unchanged

After the owner-approved **restore_project** call and the project's return to **ACTIVE_HEALTHY**, the connected Supabase provider was queried via `list_edge_functions` for the five historical standalone Agreement Test functions. Compare *the actual provider `ezbr_sha256` field* against the immutable 9-Nov custody snapshot in `docs/qa/oa5-test-edge-bundle-custody-2026-11-09.json` and `scripts/qa/oa5-test-edge-bundle-drift.mjs`.

| Historical function | 9-Nov frozen version | Current API version | SHA-256 bundle parity | Provider last-updated UTC | Status and JWT |
| --- | ---: | ---: | --- | --- | --- |
| `agreement-pdf-runtime-probe` | 5 | 6 | **MATCH** | 2026-10-29 06:14:16 | ACTIVE / verify true |
| `commercial-agreements` | 4 | 5 | **MATCH** | 2026-10-27 14:09:32 | ACTIVE / verify true |
| `master-agreements` | 6 | 7 | **MATCH** | 2026-10-27 21:32:56 | ACTIVE / verify true |
| `platform-admin` | 5 | 6 | **MATCH** | 2026-11-01 20:38:14 | ACTIVE / verify true |
| `platform-admin-settlement` | 4 | 5 | **MATCH** | 2026-11-01 21:20:24 | ACTIVE / verify true |

All five provider-reported last-update timestamps **predate the 9-Nov baseline custody and 26-Nov restoration**, and their bundle digests **match exactly**. Although the current API reports uniform version counters **one higher** than the older custody snapshot, there is **no evidence of a new Edge source bundle deployment from this comparison**. The cause of this counter difference is **not proven**. Do **not** describe it as a deployment caused by restoration or overwrite the frozen 9-Nov version history to force equality.

**Practical disposition:** historic Edge **binary bundle identity** is conserved, subject to immutable provider hash metadata. Historic strict version-metadata equality is **not** established; the original strict check remains intact and will reject version drift. The separate offline guard `scripts/qa/oa5-test-edge-restore-parity.mjs` accepts only the exact reviewed Test project, five original function names, every original digest, ACTIVE and `verify_jwt=true`, **exactly +1 reported version on all five**, and unchanged last-updated dates before 13 November. It does not infer source-level provenance, real endpoint behaviour or provider egress containment.

## Read-only snapshot capture / private testing

The original live metadata comes from the connected Test-only `list_edge_functions` endpoint. The sanitized operator snapshot contains exactly:

```json
{
  "schema_version": 1,
  "project_ref": "iukgsukdoowvnhlfmpml",
  "purpose": "oa5-post-restore-test-edge-digest-parity",
  "observed_at_utc": "<current UTC YYYY-MM-DDTHH:MM:SSZ>",
  "functions": [
    {
      "slug": "<one original historical function slug>",
      "status": "ACTIVE",
      "version": 6,
      "verify_jwt": true,
      "bundle_sha256": "<provider ezbr_sha256>",
      "updated_at_ms": 1793254456856
    }
  ]
}
```

The example shows only the shape of one record; actual private snapshot must contain **all five**. Do not include invocation payloads, function source, tokens, project credentials, user emails, provider URLs or other fields.

```sh
node scripts/qa/oa5-test-edge-restore-parity.mjs --check /secure/private/oa5-test-edge-restored-metadata.json
```

Read-only verification is at a measured instant; evidence is stale after ten minutes for maintenance preflight. Failures cannot be waived by normalizing versions by guess, skipping a function or dropping JWT verification.

## What remains blocked independently

- Provider-console no-egress and callback ownership (Meta/WhatsApp, payment gateways, SMTP/Auth, Firebase, AI).
- Historical Vercel reviewer access and custody of **two** original deploy IDs that currently returned 404, plus actual compiled JS endpoint mapping.
- Archive individual Auth ID/session parity, historical privileged JWT/old-account denial after future replay, exact CLI v3 Test-only object/role/seed effects.
- Separately scoped owner approval before any destructive Test user-created-object reconstruction.

**Conclusion:** five Edge function bundle digests **PASS**, strict old version metadata remains a **documented uniform +1 discrepancy**, and overall Method B hosted reconstruction remains **NO-GO**. Production and Tandar are untouched.
