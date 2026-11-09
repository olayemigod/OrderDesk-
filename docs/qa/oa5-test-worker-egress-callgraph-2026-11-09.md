# OA5 standalone Test — indirect pg_net worker egress and cron call graph

**Read-only provider database inspection:** 09/11/2026, standalone Test project iukgsukdoowvnhlfmpml only. **Decision:** partial outbound-worker risk characterization, NOT provider-sink isolation acceptance, NOT permission to pause cron or reset Test. Production and Tandar were neither read nor changed.

## What the previous cron-command census could not show

The four active pg_cron job commands invoke PostgreSQL functions. None contains a literal HTTP URL or the Production Supabase project ID; **this alone does NOT mean the jobs cannot dispatch HTTP**. Read-only catalog inspection of the exact functions and sanitized routine definitions establishes the following:

| Active Test job | Actual SQL target | External-effects boundary |
| --- | --- | --- |
| 1: prepare usage settlements | public.prepare_due_orderdesk_usage_settlements | Reads usage_events and delegates to prepare_orderdesk_usage_settlement. No direct HTTP/pg_net in inspected outer function; settlement can create database effects. |
| 2: WhatsApp notification retry | sellertray_private.kick_whatsapp_notification_worker | **SECURITY DEFINER**; reads runtime_config key notification_worker_url, returns if missing; otherwise inserts invocation nonce and calls net.http_post to the configured URL. |
| 3: Merchant push retry | sellertray_private.kick_merchant_push_worker | **SECURITY DEFINER**; reads runtime_config key merchant_push_worker_url, returns if missing; otherwise inserts invocation nonce and calls net.http_post to the configured URL. |
| 4: Agreement package retry | public.process_sellertray_agreement_package_retries | Reads sellertray_agreement_package_processing and delegates to ensure_sellertray_agreement_package_managed; may alter database state. No direct HTTP/pg_net in the inspected outer function. |

Both worker functions are currently single-overload, SECURITY DEFINER and **not directly executable by the authenticated role** per metadata checks; these properties do not establish that no other privileged code path can invoke them. This is a *limited call-graph inspection*, not complete recursive SQL/runtime tracing.

### Current Test-only point-in-time values

The SQL inspection on 09/11/2026 at approximately **22:28:40 UTC** returned the following count-only signals:

| Measured signal | Value |
| --- | ---: |
| private runtime_config rows (all keys) | **0** |
| configured notification_worker_url rows | **0** |
| configured merchant_push_worker_url rows | **0** |
| usage_events rows | **0** |
| agreement package processing rows | **0** |
| pending net.http_request_queue entries | **0** |
| active pg_cron jobs | **4** |

**Consequence:** In the current snapshot, the two private worker functions return before net.http_post because neither runtime URL is configured. The settlement/Agreement jobs have zero rows in their primary work tables, but they remain scheduled. The four jobs were **not paused**. The absence of these URLs/queue items cannot prove no request was dispatched previously, that another database function cannot send HTTP, or that Meta/Paystack/Flutterwave/email/FCM/AI external accounts are Test-only.

### Safe operator read-only snapshot

Independently select **only** the standalone Test project and run the following SELECT. It yields function identities, SQL metadata booleans and aggregate counts, **never** the actual worker URLs, credentials, recipient addresses or runtime_config values. Keep the complete JSON result in a private operator-only file, NOT Git/CI.

~~~sql
WITH workers(jobid,jobname,schema_name,func_name,runtime_config_key) AS (
 VALUES
 (2,'sellertray-whatsapp-notification-retry','sellertray_private','kick_whatsapp_notification_worker','notification_worker_url'),
 (3,'sellertray-merchant-push-retry','sellertray_private','kick_merchant_push_worker','merchant_push_worker_url')
)
SELECT jsonb_build_object(
 'schema_version',2,
 'project_ref','iukgsukdoowvnhlfmpml',
 'purpose','pre-maintenance-worker-egress-census',
 'captured_at_utc',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
 'runtime_config_total_rows',(SELECT count(*)::int FROM sellertray_private.runtime_config),
 'usage_events_rows',(SELECT count(*)::int FROM public.usage_events),
 'agreement_processing_rows',(SELECT count(*)::int FROM public.sellertray_agreement_package_processing),
 'pending_pg_net_requests',(SELECT count(*)::int FROM net.http_request_queue),
 'sql_network_surface',jsonb_build_object(
  'public_function_count',(SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'),
  'private_function_count',(SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='sellertray_private'),
  'public_direct_http_functions',(SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosrc ~* '(net[.]http_(post|get|delete|patch)|extensions[.]http|http[.]http_)'),
  'private_direct_http_functions',(SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='sellertray_private' AND p.prosrc ~* '(net[.]http_(post|get|delete|patch)|extensions[.]http|http[.]http_)'),
  'public_literal_endpoint_functions',(SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosrc ~* '(https?://|[.]supabase[.]co|[.]facebook[.]com)'),
  'private_literal_endpoint_functions',(SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='sellertray_private' AND p.prosrc ~* '(https?://|[.]supabase[.]co|[.]facebook[.]com)'),
  'retained_pgnet_responses',(SELECT count(*)::int FROM net._http_response)
 ),
 'workers',(
  SELECT jsonb_agg(jsonb_build_object(
   'jobid',w.jobid,
   'jobname',w.jobname,
   'function_identity',w.schema_name||'.'||w.func_name,
   'runtime_config_key',w.runtime_config_key,
   'actual_runtime_config_key',(SELECT (regexp_match(p.prosrc, 'where rc[.]key=''([^'']+)''', 'i'))[1] FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=w.schema_name AND p.proname=w.func_name),
   'source_sha256',(SELECT encode(extensions.digest(p.prosrc::bytea,'sha256'),'hex') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=w.schema_name AND p.proname=w.func_name),
   'function_overloads',(SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=w.schema_name AND p.proname=w.func_name),
   'security_definer',(SELECT coalesce(bool_and(p.prosecdef),false) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=w.schema_name AND p.proname=w.func_name),
   'pg_net_http_post',(SELECT coalesce(bool_or(p.prosrc ~* 'net[.]http_post'),false) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=w.schema_name AND p.proname=w.func_name),
   'source_has_production_ref',(SELECT coalesce(bool_or(p.prosrc ~ 'eujxswjspolugrzlsjnn'),false) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=w.schema_name AND p.proname=w.func_name),
   'source_has_literal_url',(SELECT coalesce(bool_or(p.prosrc ~* 'https?://'),false) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=w.schema_name AND p.proname=w.func_name),
   'configured_url_rows',(SELECT count(*)::int FROM sellertray_private.runtime_config rc WHERE rc.key=w.runtime_config_key)
  ) ORDER BY w.jobid) FROM workers w
 )
) AS snapshot;
~~~

The snapshot must include the exact 2 job IDs/function names/**observed SQL configuration lookup keys** and **source SHA-256 digests** (frozen from actual Test function source), one overload each, SECURITY DEFINER plus indirect pg_net HTTP dispatch code, zero runtime_config rows and configured URLs, zero usage/Agreement processing rows, zero pending requests, no embedded Production reference/literal URL, correct Test project/purpose and an under-ten-minute UTC timestamp. The offline check rejects any unexpected key/field, missing function, new work row, configured worker route, changed source metadata, future/stale snapshot or wrong project:

~~~sh
node scripts/qa/oa5-test-worker-egress.mjs --check /secure/private/test-worker-egress-census.json
~~~

This checker returns **worker_route_counts_quiescent** only. It always denies actual provider destination verification, historical delivery verification, cron pause, cleanup and destructive-operation authorization.

## Mandatory independent gates still open

- External provider-console binding for real Meta WABA/phone/webhooks, Paystack/Flutterwave sandbox callbacks, SMTP/activation recipients and redirects, FCM sender/devices, AI and notification workers. SQL counts do not prove their state.
- Preservation and trusted compiled HTML/JS origin of all five original Vercel Previews and historical authorized reviewers.
- Historical Agreement archival, restore, managed Auth/Storage and FK treatment, exact SQL retirement/replay/recovery method.
- A **separately approved** Test-only reversible pause of **all four** cron jobs, then a fresh post-pause all-age running and pg_net zero-queue snapshot, plus external delivery confirmation. Two jobs being currently inert is **not** permission to skip the four-job pause.
- A separately approved destructive Test-only operation after all evidence is accepted.

**This report contains no worker URL value, secret, recipient, provider token or mutation statement.** Source PR #228 remains draft; hosted QA attestation remains blocked.


## Actual Test function-source fingerprints

The two existing Test private SQL function bodies were independently hashed through a **read-only** SELECT using extensions.digest(prosrc::bytea,'sha256'). No function body or literal config value is saved in source control. This closes a blind spot: simply expecting a function name and net.http_post in the source would not detect a changed implementation that read a different URL setting.

| Function | Observed SQL function-source SHA-256 |
| --- | --- |
| sellertray_private.kick_whatsapp_notification_worker | 8e1f13dc854def4de0163809fc6a82227e1a5bf2daccba159fc66008e24d0520 |
| sellertray_private.kick_merchant_push_worker | b052a9982fcd993ff5f4e5ba3a41eacd4f27c3335e775811a08d6aa16accb56c |

Their actual parsed source lookup keys matched notification_worker_url and merchant_push_worker_url. The offline guard now requires both these digests and the **actual parsed source lookup key**, not merely the expected key copied into a snapshot. Any SQL code change must STOP the pre-maintenance review and be independently reconciled; do not silently update these digests to force a PASS. This is only a *fingerprint for two known functions*, not comprehensive code attestations of invoked SQL dependencies or all Test outbound routes.


## Full Test SQL outbound surface and retained HTTP telemetry — limited census

A separate **read-only** scan of the Test catalog (public + sellertray_private schemas) identified **479 public** and **8 private** SQL functions. It found **zero** direct SQL HTTP-call syntax references in public functions and **two** in private functions, exactly the existing WhatsApp/push workers inspected above. Three public functions contain literal URL-related syntax (mostly validations/metadata), but **none** invokes the scanned direct pg_net/HTTP routines. The private routines contain no literal HTTP URL. The current net._http_response table retains **zero** rows (successful/failed HTTP responses), and the net.http_request_queue currently contains **zero** requests.

| Bounded catalog metric | Current Test observation |
| --- | ---: |
| Public SQL functions | 479 |
| Private SQL functions | 8 |
| Direct SQL HTTP-dispatch references: public | 0 |
| Direct SQL HTTP-dispatch references: private | 2 |
| Functions mentioning literal URL/domain syntax: public | 3 |
| Functions mentioning literal URL/domain syntax: private | 0 |
| Retained pg_net HTTP responses | 0 |

**Versioned change:** the combined SELECT above now produces **worker-egress snapshot schema v2** with a strict nested sql_network_surface object. The offline gate fails closed if the SQL function-count inventory changes, any newly directly HTTP-calling routine appears, a known worker function is modified, private URL configuration appears, the pg_net response table acquires a row, or required metadata goes missing. This is a deliberate *legacy Test pre-maintenance drift* check; these exact old counts are **not** a canonical post-rebuild target.

**Important limits:** source-regex matches are *not* full SQL call-graph proof, and cannot detect dynamically constructed SQL, every indirect external action, activity in an imported extension or prior network deliveries after pg_net response retention expires. Zero retained responses **does not prove zero historical dispatch**. Four schedules are still ACTIVE and the verified private worker functions can send HTTP if a URL appears later. Real Meta, PSP, SMTP, FCM, AI and Vercel provider-side isolation remain independent, **unaccepted** gates. This snapshot neither authorizes a cron pause nor a Test reset.

Read-only run-history counts indicate that the three minutely jobs each retained **20,097** completed runs and ran **1,440 times in the last 24 hours** at the observation, with zero recorded failures/unfinished runs; the daily usage-settlement job retained 14 completed runs. These operational counters show that the schedules **continue consuming execution resources**, even while primary work tables/worker URL settings are empty. They are not evidence of failed delivery or safe to unschedule. Any reversible Test-only pause remains a separately approved, all-four-job operation.
