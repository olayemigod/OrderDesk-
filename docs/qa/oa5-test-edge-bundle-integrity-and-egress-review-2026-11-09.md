# OA5 — Test historical Edge bundle integrity and bounded outbound code review

**Standalone Test**: iukgsukdoowvnhlfmpml. **Excluded**: Production eujxswjspolugrzlsjnn and Tandar. **Status**: READ-ONLY inventory / NO-GO for hosted rebuild. This is not an Edge deployment, credential review or a provider-isolation attestation.

## Provider-observed bundle identity, 09/11/2026

The Supabase read-only list_edge_functions and get_edge_function APIs were called only for the five existing historical Test functions. The metadata showed all **five ACTIVE**, all **verify_jwt=true**, with the expected versions and non-secret Supabase bundle SHA-256 metadata.

| Function | Version | JWT verification | Frozen bundle hash prefix |
| --- | ---: | --- | --- |
| agreement-pdf-runtime-probe | 5 | true | 10e9119e1358 |
| commercial-agreements | 4 | true | 23a06cf3c811 |
| master-agreements | 6 | true | a5864bb52957 |
| platform-admin | 5 | true | c70bd4f0bbf5 |
| platform-admin-settlement | 4 | true | fa1004e5b91a |

Full 64-character SHA256 bundle identifiers, not application secrets, are committed in docs/qa/oa5-test-edge-bundle-custody-2026-11-09.json. Exact expected hashes are mirrored into the offline QA guard scripts/qa/oa5-test-edge-bundle-drift.mjs to reveal accidental baseline changes in review. This is a **historical metadata fingerprint**, not a guarantee that a Vercel client used it, that all imports were analyzed, or that the hosted bundle matches any particular canonical source commit.

The existing docs/qa/oa5-test-edge-function-custody-2026-11-09.json records the **slug** mismatch against 50 canonical source functions; only four of the five historical slugs belong to the canonical roster. The fifth, agreement-pdf-runtime-probe, must be preserved as historical Agreement evidence until a separately approved disposition. The new bundle SHA snapshot **adds integrity granularity**, not a new deployment plan. Never "repair" this mismatch by automatically deploying all 50 canonical functions.

### Bounded read-only code observations (no credentials/URLs copied)

The get_edge_function read returned source files and non-secret metadata. A limited text inspection, **not a complete static-analysis proof**, found:

- master-agreements and commercial-agreements: no direct fetch() call in the retrieved function source.
- agreement-pdf-runtime-probe: no direct fetch() call in the retrieved source.
- platform-admin: three direct fetch() call sites, all constructed from the SUPABASE_URL environment variable — one to a database RPC, one to Auth and one to the order-parser function route. The deployed historical Test inventory **does not contain** an order-parser function. Do not invoke it or use these functions as live QA substitutes.
- platform-admin-settlement: two direct fetch() call sites, also using SUPABASE_URL, targeting database RPC/Auth routes.

Environment **variable names** include the Supabase URL/service-role placeholders in hosted handlers and OpenAI/ORDER_PARSER_* names in the historical platform-admin handler; **no secret values, runtime URL values or real recipient addresses** are asserted or published. Source references to SUPABASE_URL do **not** prove that deployed secrets, upstream calls, imported modules, database triggers, pg_net workers, mail or provider configurations are Test-only. The four active Test cron jobs, browser callbacks and external Meta/Paystack/Flutterwave/SMTP/FCM/AI sinks remain separate independently blocked gates.

## Offline drift validation — two separate purposes

A frozen historical baseline is checked offline in CI:

~~~sh
node scripts/qa/oa5-test-edge-bundle-drift.mjs --baseline docs/qa/oa5-test-edge-bundle-custody-2026-11-09.json --offline
~~~

Before any separately approved maintenance action, the operator must obtain a *new* read-only list_edge_functions result for **Test only**, inspect the exact five slugs/version/JWT/hash metadata and assemble a private JSON file outside Git or CI with:

~~~json
{
  "schema_version": 1,
  "project_ref": "iukgsukdoowvnhlfmpml",
  "purpose": "pre-maintenance-test-edge-bundle-recheck",
  "observed_at_utc": "REPLACE_WITH_CURRENT_UTC_TO_THE_SECOND",
  "functions": [
    {
      "slug": "agreement-pdf-runtime-probe",
      "status": "ACTIVE",
      "version": 5,
      "verify_jwt": true,
      "bundle_sha256": "REPLACE_WITH_REAL_PROVIDER_HASH"
    }
  ]
}
~~~

The *real* protected operator snapshot must contain **exactly five** entries, one for each historical function, with the actual current hashes rather than placeholders; its timestamp must be **under ten minutes old**. Do not use this abbreviated one-entry illustration as valid evidence. No provider keys, private endpoints, function source, tokens or environment variables belong in the snapshot. Run:

~~~sh
node scripts/qa/oa5-test-edge-bundle-drift.mjs --check /secure/private/test-edge-bundle-recheck.json --offline
~~~

**Any unknown function, changed version, different hash, JWT setting, active status, time, schema or field:** STOP and independently review the new hosted state. Never silently update the frozen fingerprints. A PASS means only that supplied Test Edge function **metadata** matches the frozen historical provider observation. The checker always reports hosted source provenance UNVERIFIED, provider isolation UNVERIFIED, Edge deploy NOT AUTHORIZED, cron pause NOT AUTHORIZED, and destructive action NOT AUTHORIZED.

## Manual acceptance still outstanding

This metadata review is safe to perform before a maintenance decision and does not require Vercel Pro, new Supabase branches, Edge deployment, an APK or an integration callback. It cannot replace:

1. Original five Vercel compiled Preview bundles/actual reviewer continuity.
2. Meta Test WABA/phone/webhook ownership and Paystack/Flutterwave sandbox callbacks.
3. Test mail safe recipients and Auth redirects, QA Firebase/FCM devices, AI/cron/pg_net outbound sinks.
4. The explicit four-job reversible Test-only pause authorization and fresh post-pause zero-queue/running confirmation.
5. Approved managed Auth/Storage treatment, historical Agreement archive/rollback custody, exact canonical migration procedure and separate destructive execution approval.

Production and all live merchant operations remain untouched. PR #228 remains draft and OA5 hosted Test rebuild remains NO-GO.
