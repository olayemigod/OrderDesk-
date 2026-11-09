# OA5 Test Edge Functions — sanitized source and hosted inventory, 09/11/2026

**Status: NO-GO for hosted Test acceptance and reset. This is read-only custody, not a deployment, callback activation or authorization.**

The reviewed OA5 source tree at commit `ed5023e577cb1f6d25c1fabbc1a519f7f2c563ba` contains exactly **50** deployable `supabase/functions/<slug>/index.ts` entries in the Git tree `eecf916c79e0e0da9d1ac09f180f9ab829ce9183` (excluding shared helper modules). The independent Supabase Test project `iukgsukdoowvnhlfmpml`, inspected with its read-only Edge-function inventory action, has only five ACTIVE functions. Four slugs occur in the source, **46 canonical functions are not yet hosted**, and the historical Agreement-only `agreement-pdf-runtime-probe` exists on Test but not in the current canonical source. Preserve that historical probe and its archived evidence; do not manually delete it to make the check pass. Version numbers and JWT metadata alone **do not** prove that the deployed bundle came from the reviewed Git commit.

The sanitized `oa5-test-edge-function-custody-2026-11-09.json` stores only Test project identity, function slugs, versions, status, `verify_jwt` flags, the reviewed source roster/tree SHA, and capture time; **no** provider keys, HTTP request bodies, bearer tokens, URLs, credentials, user records or function source bundles.

## Offline inventory verifier

```sh
node scripts/qa/oa5-test-edge-inventory.mjs --baseline docs/qa/oa5-test-edge-function-custody-2026-11-09.json
```

This immutable baseline check verifies exact Git-source tree identity plus the historical 4/50 + 1 census. **Passing the baseline check does not mean Test is ready.** It intentionally returns NO-GO evidence. To check a *new* separately sourced, recent, reviewed **Test-only** function metadata snapshot after authorized deployment:

```sh
node scripts/qa/oa5-test-edge-inventory.mjs --inventory /secure/local/test-edge-functions-sanitized.json
```

The `--inventory` mode requires the snapshot to be less than ten minutes old and to contain exactly the current reviewed source roster, all ACTIVE, no extra historical probe or other unreviewed functions, and the same Git source-tree SHA. A missing or contradictory record fails closed. Use the historical JSON file's schema as the input contract; capture the actual Test project identity separately through the connected provider. The evidence file itself is operator-provided and not cryptographically authentic: review provenance independently. Do not treat a green roster as proof that the hosted **bundle** is from this exact source, that a particular endpoint has the correct JWT/CORS/HMAC rules, or that credentials and callbacks are sandboxed.

## Controlled deployment prerequisites (not authorized by this check)

1. Preserve five historical Vercel Preview dependencies, signed-out/reviewer access and both canonical publicly reachable Production domains. Do not bind Test custom hosts until protected.
2. Independently approve the archived Test backup, recoverability, exact project reset mechanism and reversible four-job cron pause. Both `cron.job_run_details` **all-age** unfinished runs and `net.http_request_queue` must be zero in a fresh Test-only snapshot. Current schedules remain active.
3. Reset/rebuild only Test after explicit permission. Replay canonical migrations in reviewed order, retain evidence of previous Agreement artifacts, and validate schema, permissions, grant/RLS and fixture isolation.
4. Deploy an **explicitly approved, source-locked Test-only allowlist in phases**. Do not blindly deploy all 50 function names to a publicly reachable backend: payment/webhook/WhatsApp/notification functions require independently reviewed sandbox secrets, destinations and provider ingress before enablement. Preserve Test-only Auth/Firebase and webhook routing isolation; Production Meta, PSP and Tandar are never deployment targets.
5. Re-list actual Test deployments, inspect hosted source/version evidence and independently verify function-level JWT/CORS/HMAC, tenant/branch isolation, synthetic event/retry idempotency and absence of Production destinations. Only after these tests can the separate staging attestation field `qa_edge_functions_deployed_and_verified` be considered for approval.

**Cross-surface:** Shared operational RPC/Edge authority will eventually be consumed by Mobile POS, Merchant Web, Admin Web, WhatsApp/AI and reporting. This batch changes only QA inventory tooling and documentation; no API schema, UI, commerce rule, notification recipient, offline or settlement behavior changes.

**NO hosted change:** No database reset, cron pause, Edge deployment/invocation, Vercel preview, Test DNS binding, Meta/Paystack/Flutterwave callback, APK, Production/Tandar modification or paid resource.
