# OA5 — hosted Test + Vercel boundary: 10 November 2026 read-only census

**Status:** Read-only observation, **not** a rebuild preflight PASS, hosted Test acceptance, provider isolation sign-off or authorization for a cron pause/reset.  
**Project:** Existing dedicated Agreement Package Test, `iukgsukdoowvnhlfmpml`; Production project `eujxswjspolugrzlsjnn` was not queried or changed in this census.  
**Method:** Connected Supabase project/migration/Edge metadata reads, aggregate-only SQL `SELECT` against the **Test project**, and Vercel `get_project` reads for the two existing frontend projects. No provider callbacks, Auth changes, SQL DML/DDL, migration, Edge deployment, new Vercel Preview, app build, paid branch or merchant action.

## Observed Test project facts

| Area | Read-only observed result | Governance meaning |
| --- | ---: | --- |
| Project health | `ACTIVE_HEALTHY` | Metadata status only; not lifecycle readiness |
| Applied Test migrations | 54 | Matches the previously archived Test count; **not** proof that the current repository migration history is fully replayed |
| Public tables | 132 | Matches archived Test baseline |
| Public functions | 479 | Matches archived Test baseline |
| Auth users | 5 | Matches archive |
| Auth sessions | **6** | Archive has **5**; the exact one-session difference was previously reviewed for potential loss during an **independently approved** Test rebuild; **none deleted or invalidated** |
| Auth identities | 1 | Matches managed-state baseline |
| Auth refresh tokens | 21 | Matches managed-state baseline |
| Auth MFA factors / challenges | 1 / 8 | Matches managed-state baseline |
| Storage buckets | 3 total: 1 public, 2 private | Matches managed-state baseline |
| Storage objects | 0 | Matches baseline; not a complete Storage recovery/retention guarantee |
| Storage policies | 3 | Matches baseline |
| Multipart uploads / parts | 0 / 0 | Matches baseline |
| Public foreign keys referencing Auth users | 64 | Matches managed-state baseline |
| FK action partition | 30 restrict/no-action, 8 cascade, 26 set-null | Matches baseline; Auth teardown still **not approved** |
| Deployed Test Edge Functions | 5, all ACTIVE with JWT verification enabled | Metadata inventory only; **not** bundle/JWT/egress acceptance |
| `pg_cron` scheduled jobs | **4, all ACTIVE** | **Not quiescent**; a Test rebuild is blocked until a separately authorized, reversible Test-only maintenance action and fresh run/queue proof |
| Pending `pg_net` HTTP requests | 0 | Point-in-time queue count, not proof of external provider isolation |
| Retained `pg_net` responses | 0 | Point-in-time observation |
| Private runtime-config rows | 0 | Point-in-time count; does not prove external callbacks are disabled or safe |

**Important:** Queries inspected only aggregate counts and infrastructure metadata, not identities, stored SQL command text, secrets, access tokens, payloads, customer records or external endpoint destinations. The **54 applied migrations** do not license a hosted reset or imply schema parity against the current repository.

## Vercel protection and historical evidence

Read-only `get_project` calls on existing `sellertray-merchant` and `sellertray-admin` confirm **both** still use Standard Vercel Authentication with `ssoProtection.enabled=true`, `deploymentType=prod_deployment_urls_and_all_previews`. Canonical Production domains `app.sellertray.com` and `admin.sellertray.com` remain attached to their respective projects; the two proposed Test custom domains were not listed in the filtered project domain inventory. The project metadata **does not** prove those Test domains will be protected after binding or establish production release readiness.

Preserve the previously **owner-verified 09 November 2026** browser results (signed-out original Merchant/Admin Preview challenge, owner signed-in access, public Production custom domains), rather than asking the owner to repeat this accepted smoke without a specific reason. **All-five historical reviewer continuity** and full runtime/loaded-chunk proof remain narrower gaps.

Original five Preview local custody is separately documented at `docs/qa/oa5-historical-preview-local-custody-pass-2026-11-10.md`: 5/5 captured application trees, 38/38 SHA-256 checked local files, bounded compiled Test-backend check, with three **unattested** external Vercel Toolbar references.

## Reconciliation / remaining conditions (no mutation)

- **Observed live/archived drift:** exactly one extra Test Auth session. The previously recorded owner approval covers only discarding **that session** if and when a separate, exact Test-only rebuild is authorized. It is **not** an approval for deleting users, sessions now, or Auth resets generally.
- **Not quiescent:** all four Test cron jobs remain active. Zero queued `pg_net` requests at this instant does **not** mean scheduled jobs cannot queue work later.
- **Managed counts match**, but `oa5-test-managed-boundary.mjs` requires a freshly captured, exact count-formatted private snapshot; this dated narrative cannot be submitted as a 10-minute-window pre-reset snapshot.
- **Provider egress** remains unverified: Meta Test app/phone ownership; Paystack Test keys/callback/replay; Flutterwave sandbox/disabled state; SMTP safe sink; Test Firebase/FCM; AI/notification workers; Auth callback/redirect and Storage policy review.
- **Restore/migration** remains unverified: encrypted Test backup usable in a disposable restore, exact migration ordering/runtime parity and fresh Test census immediately before any maintenance window.
- **Browser gate** remains open for missing original reviewer/loaded-runtime evidence and future authenticated Test custom-domain binding. Do not incur a new Vercel Preview merely for repetitive screenshots.

## Gate status and next safe milestone

| Scope | Status |
| --- | --- |
| Historical original-five Preview local application artifact custody | **PASS** (limited content/metadata scope) |
| Existing Vercel Merchant/Admin Standard Authentication metadata | **PASS** (project metadata; no hosted QA-domain claims) |
| Test public/managed baseline counts | **MATCH observed baseline** (except specifically reviewed +1 Auth session) |
| All four Test jobs quiescent / outbound provider routes safe | **BLOCKED** (cron active; provider proof incomplete) |
| Exact current canonical migration parity, backup/restore proof | **OPEN** |
| Controlled OA5 Test rebuild | **NO-GO** — new explicit authorization required after full preflight |
| C2 Production cutover | **NO-GO** — OA5 staged/controlled lifecycle acceptance incomplete |

**Next bounded action:** finish the read-only provider egress and external account ownership/sandbox review against exact Test-only credentials without revealing private secrets. Then reconcile the Test backup/restore and migration sequence. Only after every external and data-loss boundary is reviewed may the user be presented an exact, reversible four-job maintenance and isolated Test rebuild approval request. Keep Tandar and Production untouched.

## Cross-surface impact

No application or shared commerce behavior changed: this is infrastructure evidence gathering. Merchant/Admin Web protections were **read-only rechecked**; Mobile, WhatsApp, payments, AI, inventory, reports and offline/sync runtime logic were **not modified**. Existing code still governs all commercial and merchant activity. No migration, build, deployment or provider mutation was needed.


## Additional exact cron and worker-egress SQL fingerprints (same read-only review)

The four active jobs' **job ID, job name, schedule, and SHA-256 of their SQL command text** all match the frozen values in \`scripts/qa/oa5-test-cron-maintenance-gate.mjs\`. All-age \`cron.job_run_details\` shows **0 unfinished runs** for each of jobs 1–4. These observations reduce uncertainty about *which* jobs would require the authorized reversible maintenance action, but **do not** establish the mandatory \`active:false\` maintenance condition: **all four are still \`active:true\`**. The 10-minute freshness window is not prolonged by this historical documentation.

The two private notification/push dispatch functions were inspected by metadata-only SQL (no SQL source text, URL, API token or destination values returned). Both are \`SECURITY DEFINER\`, both call \`net.http_post\`, neither contains the Production Supabase project ref, and the SHA-256 of their **\`pg_proc.prosrc\` body** matches the two expected fingerprints in \`scripts/qa/oa5-test-worker-egress.mjs\`. This is significant: hashing the formatted \`pg_get_functiondef\` output yields **different** digests, so the frozen fingerprints must be compared to **\`prosrc\`**, not the formatted definition.

The complete count-only worker egress surface also matched its archived expectations at observation time: \`runtime_config_total_rows=0\`, \`usage_events_rows=0\`, \`agreement_processing_rows=0\`, \`pending_pg_net_requests=0\`, \`retained_pgnet_responses=0\`, \`public_function_count=479\`, \`private_function_count=8\`, \`public_direct_http_functions=0\`, \`private_direct_http_functions=2\`, \`public_literal_endpoint_functions=3\`, \`private_literal_endpoint_functions=0\`. Neither of the two worker functions has a literal external endpoint in its source, and the private config table holds zero configured destination rows. No code or DB state changed.

**Interpretation:** current counts and source fingerprints match the Test worker egress **point-in-time source metadata baseline**, but the external provider route/sandbox check is **not** signed off and the cron pause prerequisite is **definitely not satisfied**. This is not a permission to invoke the workers, pause them, empty their queues, or start Test maintenance. Before any contemplated rebuild, repeat fresh Test-only snapshots and independently review authorized callback ownership, worker egress, and the reversible four-job plan.

