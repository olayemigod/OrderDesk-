# OA5 Test pg_cron quiescence — fail-closed operator evidence (09/11/2026)

**State: NO-GO for Test reset. This is a read-only inventory and offline validation procedure, not a command to pause jobs or reset Supabase.** Project identity: standalone Test `iukgsukdoowvnhlfmpml`. Production `eujxswjspolugrzlsjnn` and Tandar are excluded.

## Read-only Test baseline and stop condition

The project still has four **active** scheduled jobs with no observed unfinished executions when inspected on 09/11/2026. Source/command fingerprints were calculated on Test with `extensions.digest(command::bytea,'sha256')`, without reading job command payloads into CI. The expected set is fixed in `scripts/qa/oa5-test-cron-maintenance-gate.mjs`: daily usage settlement, minutely WhatsApp notification retry, minutely merchant push retry, minutely agreement package retry. If job ID/name/schedule/command differs, stop and re-audit. The current live snapshot fails the guard because all four jobs are **active**.

Do not assume inactive pending provider tables imply no side effects. Test notification worker definitions may call `net.http_post`; no online recipient/destination safety is proven by this preflight.

## Capture an operator-owned snapshot (read-only SQL only)

Connect *only* to the verified standalone Test project and confirm its project reference independently. Run this single SELECT from the protected Test SQL editor; it does not write data:

```sql
SELECT jsonb_build_object(
  'schema_version', 2,
  'project_ref', 'iukgsukdoowvnhlfmpml',
  'captured_at_utc', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'all_jobs_count', (SELECT count(*)::integer FROM cron.job),
  'pending_pg_net_http_requests', (SELECT count(*)::integer FROM net.http_request_queue),
  'jobs', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'jobid', j.jobid, 'jobname', j.jobname,
      'schedule', j.schedule, 'active', j.active,
      'command_sha256', encode(extensions.digest(j.command::bytea, 'sha256'), 'hex'),
      'unfinished_runs', (
        SELECT count(*)::integer FROM cron.job_run_details AS d
        WHERE d.jobid = j.jobid AND
          (d.status IN ('running','starting') OR d.end_time IS NULL)
      )
    ) ORDER BY j.jobid), '[]'::jsonb)
    FROM cron.job AS j
  )
) AS snapshot;
```

Save the resulting **single JSON object** as a protected local file outside Git and CI. Never copy SQL credentials, endpoint tokens, complete job command text or private recipient data into Git. If the snapshot output differs from the expected shape, do not coerce values to make the gate pass.

Run locally:

```bash
node scripts/qa/oa5-test-cron-maintenance-gate.mjs --check /secure/local/test-cron-snapshot.json
```

The checker refuses a wrong project, snapshots older than ten minutes, unknown/missing/duplicated jobs, mismatched job IDs/schedules/SHA256 fingerprints, any active job, **any unfinished execution regardless of age**, unknown job execution count, and **any pending or unverified pg_net HTTP queue depth**. Snapshots now require schema version 2; a legacy cron-only snapshot cannot assert outbound quiescence. The checker is **offline**: it never changes a cron schedule, makes an HTTP call or manipulates database rows.

## Maintenance-window sequence requiring separate approval

1. First complete the encrypted recovery archive and independent local restore proof, all five historical Vercel preview dependencies, Test-specific Auth/Firebase/provider destination review, callback ingress block and an approved exact Test-only destructive reset plan. Vercel custom-domain protection is not established; do not bind Test domains prematurely.
2. With explicit operator permission and an independently reviewed runbook, stop Test ingress and **reversibly pause the exact four Test jobs** through the installed `cron.alter_job` capability. This document does not provide an executable mutating SQL command, and it does not authorise any pause.
3. Re-run the read-only snapshot query **after** the pause, verify it is recent and the offline cron + queued pg_net guard passes, then separately inspect already-dispatched/in-flight network requests, external destinations, SMTP/Meta/PSP callbacks and Auth session state. A job can finish after it has been disabled; a single snapshot cannot prove complete external quiescence.
4. Obtain independent signed-off Test reset/restore authorization and an exact safe hosted cleanup plan. A green cron guard **is never reset approval**. Do not run a generic remote `supabase db reset`, `supabase db push`, unschedule jobs or modify Production.
5. Recreate only canonical reviewed Test jobs after clean hosted deployment and provider isolation acceptance; do not re-enable old schedules by default. Retain immutable evidence and repeat the read-only census.

Supabase docs: [Cron](https://supabase.com/docs/guides/cron), [pg_cron troubleshooting](https://supabase.com/kb/troubleshooting/pgcron-debugging-guide-n1KTaz) and [copied project scheduled jobs](https://supabase.com/kb/troubleshooting/how-to-stop-pg_cron-jobs-from-running-on-a-restored-project-or-branch).

**Current status:** inventory exists, pre-reset cron guard implemented and tested locally; all four active jobs still block a maintenance window. No Test or Production SQL changes, cron pause, Supabase reset, Edge deployment, Vercel preview, EAS build, payment or WhatsApp callback performed. OA5 staging attestation remains blocked and C2 legacy-runtime retirement remains deferred.

## 09/11/2026 addendum — asynchronous outbound HTTP queue (source-only)

The official [pg_net documentation](https://supabase.com/docs/guides/database/extensions/pg_net) confirms that pending asynchronous HTTP requests remain in `net.http_request_queue` until execution; completed response history is stored separately in `net._http_response`. An active worker/cron job can enqueue network work and end before the external request is dispatched. To prevent a false 'all jobs idle' maintenance result, the Test-only inventory now includes a read-only `count(*)` of the pending network queue and the offline gate **requires exactly zero**. The SQL intentionally returns no URL, HTTP headers, bodies, credentials or response content.

The 09/11/2026 hosted **Test-only** read returned `active_jobs=4`, `unfinished_cron_runs=0`, `queued_http_requests=0`, and zero completed `net._http_response` rows in the previous 30 minutes. The live state still **fails** the gate because all four schedules are active. Zero queued work is only a point-in-time condition; it does not prove that an already-dispatched request is complete or that external webhooks, PSP, Meta, SMTP or Auth callbacks are isolated. Additional browser/provider evidence and independently approved reversible pausing and Test-only reset are mandatory.

If the `net` schema/table is absent, SQL fails closed; do **not** silently substitute zero. Refresh the snapshot after any pause or configuration change. No SQL updates, cron pause, service activation or Test reset occurred.

## 09/11/2026 addendum — remove the one-hour unfinished-execution blind spot

The initial maintenance inventory checked historical rows with `end_time IS NULL` only if started in the preceding hour. This could incorrectly report **zero** unfinished runs if a worker was abandoned or stalled more than an hour ago. The reviewed read-only SQL above now counts **every** `cron.job_run_details` row for the four expected jobs with `status IN ('running','starting') OR end_time IS NULL`, **without a time cutoff**. A paused-but-previously-started job remains a maintenance stop condition until independently investigated; do not delete history to make the gate pass.

The isolated Test-only read at 09/11/2026 found 56,579 historical cron execution rows and **zero** `end_time IS NULL` rows (including none older than one hour); `running`/`starting` statuses were also zero. This read has no effect on scheduled jobs or their pending HTTP work. Four active Test schedules still block reset, and a point-in-time inventory is not external-provider quiescence proof.


## 09/11/2026 — Test-only pre-pause fingerprint readiness (not pause authorization)

The post-pause schema-v2 snapshot earlier in this document remains mandatory **after** a separately authorized Test-only pause. A new independent **pre-pause** offline checker, scripts/qa/oa5-test-cron-freeze-candidate.mjs, allows an operator to establish that the **current active** four-job roster is exactly the reviewed one **before** requesting a pause. A passing pre-pause guard does **not** authorize that pause, prove outbound provider quiescence or substitute for post-pause evidence.

### Read-only pre-pause operator snapshot

Independently verify that the connected Supabase project is **standalone Test** iukgsukdoowvnhlfmpml and issue only this SELECT. It returns aggregate job identities, schedules, SHA-256 fingerprints and counts: no command bodies, tokens, recipient addresses or private provider configuration.

~~~sql
SELECT jsonb_build_object(
 'schema_version',1,
 'project_ref','iukgsukdoowvnhlfmpml',
 'purpose','pre-pause-readonly-candidate',
 'captured_at_utc',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
 'all_jobs_count',(SELECT count(*)::integer FROM cron.job),
 'pending_pg_net_http_requests',(SELECT count(*)::integer FROM net.http_request_queue),
 'jobs',(
  SELECT coalesce(jsonb_agg(jsonb_build_object(
   'jobid',j.jobid,'jobname',j.jobname,'schedule',j.schedule,
   'command_sha256',encode(extensions.digest(j.command::bytea,'sha256'),'hex'),
   'active',j.active,
   'unfinished_runs',(
     SELECT count(*)::integer FROM cron.job_run_details d
     WHERE d.jobid=j.jobid AND (d.status IN ('running','starting') OR d.end_time IS NULL)
   ),
   'running_runs',(
     SELECT count(*)::integer FROM cron.job_run_details d
     WHERE d.jobid=j.jobid AND d.status IN ('running','starting')
   )
  ) ORDER BY j.jobid),'[]'::jsonb) FROM cron.job j
 )
) AS snapshot;
~~~

Keep the resulting single JSON snapshot in protected operator-controlled storage outside Git/CI. Validate it offline using:

~~~sh
node scripts/qa/oa5-test-cron-freeze-candidate.mjs --check /secure/private/test-pre-pause-cron-census.json
~~~

The helper requires **exactly** the four recorded IDs, names, schedules and command hashes; all four **active** at pre-pause; zero unfinished/running executions across **all history**; zero pg_net pending requests; no unknown jobs/secret-bearing fields; correct Test project and purpose; and a snapshot under ten minutes old. Even on success, the checker returns cron_pause_authorized:false, post_pause_quiescence_verified:false and destructive_execution_authorized:false. It never makes an API, SQL or provider call.

**Direct live Test read-only observation, 09/11/2026 21:10:31 UTC:** four ACTIVE jobs, all IDs/names/schedules/command fingerprints match the frozen roster, zero unfinished or running executions, and zero queued pg_net HTTP requests. This is **only** a point-in-time pre-pause census. It does not establish absence of already dispatched requests or real-recipient isolation, and grants no authority to pause.

**Immutable order:** historical Agreement/Preview custody and externally verified Test-only provider ingress isolation, named operator and specific four-job pause approval; repeat a fresh pre-pause snapshot; execute only separately approved reversible Test-only pause; capture a new schema-v2 **POST-pause** snapshot via the earlier SQL; run the existing post-pause checker; independently confirm external provider quiescence; then seek **separate** Test rebuild approval. Any changed fingerprint, new job, active job after pause or queued HTTP requires STOP. Production/Tandar and all hosted Test resources remain unchanged in this review.
