# OA5 Method B — preserve existing managed Auth sessions, verify provenance (13 Nov 2026)

**Test only:** `iukgsukdoowvnhlfmpml`. **Production:** `eujxswjspolugrzlsjnn` explicitly excluded. **State:** read-only aggregate observation and source-only guard; hosted Test reconstruction remains **NO-GO** without operation-specific destructive approval.

## Why we must distinguish new sessions from data loss

Method B **retains** the original five historical Supabase Auth users, their managed session/MFA state and the original historical Preview artifacts. Its goal is to retire *historical user-created application database objects* and build a clean canonical schema, then prove those old users have **zero inherited permission** to new business data. It does **not** require deleting every historical session. Treating a session created after the archive as a mandatory deletion would silently turn Method B back into the more destructive Method A.

The protected **7 November archive** captured **5 Auth session records**. The earlier 9/11 historic Test census showed **6**. The 13 November read-only hosted Test census now shows **7 sessions, 22 refresh-token rows and the same five Auth users**. The new session records have creation days 9 and 12 November. The prior conditional allowance regarding one post-archive session **does not authorize two session deletions or general managed Auth cleanup**.

A targeted **read-only SQL aggregate** at `2026-11-13T07:03:23Z` independently confirmed:

| Current Test measurement | Count |
| --- | ---: |
| Historical managed Auth users / all managed Auth users | 5 / 5 |
| Sessions before 08 Nov 2026 00:00 UTC / after | 5 / 2 |
| Post-cutoff sessions attached to historical users / unknown users | 2 / 0 |
| Post-cutoff sessions attached to currently privileged historic Platform Admins | 2 |
| Post-cutoff sessions attached to historical Business members | 2 |
| Orphan sessions | 0 |
| Total Auth sessions / refresh-token rows | 7 / 22 |
| Active pg_cron jobs / pending pg_net HTTP requests | 0 / 0 |

**Interpretation:** This explains the extra session **count**, not the identity of individual archived sessions or whether privileged historical accounts remain usable via browser/JWT. It does not mean their membership/admin grants are safe after canonical replay. The precise 08-Nov UTC boundary groups all sessions that could be in the dated 07-Nov archive; it is not a claim about the archive's exact capture clock time or row-level contents.

## Safe repeatable private snapshot (read-only)

The following query emits **only counts and three SHA-256 identity-set fingerprints**, not any actual UUIDs, email, JWTs, session/refresh-token strings, provider URLs, merchant names or SQL business rows. Save the single `snapshot` JSON object under access-controlled operator custody, **never in GitHub or public CI logs**. It becomes stale in ten minutes.

Verify that the connected Supabase project is independently confirmed as `iukgsukdoowvnhlfmpml`, and issue **only** this SELECT:

```sql
with params as (
  select '2026-11-08T00:00:00Z'::timestamptz as cutoff
), historical_users as (
  select u.id from auth.users u cross join params p
  where u.created_at<p.cutoff
), classified_sessions as (
  select s.id,s.user_id,s.created_at,
    (s.created_at>=p.cutoff) as post_cutoff,
    (h.id is not null) as historic_user
  from auth.sessions s cross join params p
  left join historical_users h on h.id=s.user_id
), fingerprint_sets as (
  select
    encode(sha256(convert_to(coalesce((
      select string_agg(id::text,',' order by id::text) from historical_users
    ),''),'UTF8')),'hex') as historical_user_set_sha256,
    encode(sha256(convert_to(coalesce((
      select string_agg(id::text,',' order by id::text) from classified_sessions
      where not post_cutoff
    ),''),'UTF8')),'hex') as pre_cutoff_session_set_sha256,
    encode(sha256(convert_to(coalesce((
      select string_agg(id::text,',' order by id::text) from classified_sessions
    ),''),'UTF8')),'hex') as all_session_set_sha256
)
select jsonb_build_object(
  'schema_version',1,
  'project_ref','iukgsukdoowvnhlfmpml',
  'purpose','method-b-retained-auth-session-provenance',
  'captured_at_utc',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'archive_day_end_utc','2026-11-08T00:00:00Z',
  'counts',jsonb_build_object(
    'auth_user_count',(select count(*)::int from auth.users),
    'historical_user_count',(select count(*)::int from historical_users),
    'total_sessions',(select count(*)::int from classified_sessions),
    'pre_cutoff_sessions',(select count(*)::int from classified_sessions where not post_cutoff),
    'post_cutoff_sessions',(select count(*)::int from classified_sessions where post_cutoff),
    'post_cutoff_historical_user_sessions',(select count(*)::int from classified_sessions where post_cutoff and historic_user),
    'post_cutoff_unrecognized_user_sessions',(select count(*)::int from classified_sessions where post_cutoff and not historic_user),
    'post_cutoff_admin_sessions',(select count(*)::int from classified_sessions s
       where s.post_cutoff and exists(select 1 from public.platform_admins p where p.user_id=s.user_id)),
    'post_cutoff_member_sessions',(select count(*)::int from classified_sessions s
       where s.post_cutoff and exists(select 1 from public.tenant_members m where m.user_id=s.user_id)),
    'refresh_tokens',(select count(*)::int from auth.refresh_tokens),
    'orphan_sessions',(select count(*)::int from classified_sessions s where not exists
       (select 1 from auth.users u where u.id=s.user_id)),
    'tenant_memberships',(select count(*)::int from public.tenant_members),
    'platform_admin_assignments',(select count(*)::int from public.platform_admins),
    'historical_migration_versions',(select count(*)::int from supabase_migrations.schema_migrations),
    'historical_agreement_packages',(select count(*)::int from public.sellertray_agreement_packages),
    'active_jobs',(select count(*)::int from cron.job where active),
    'queued_http',(select count(*)::int from net.http_request_queue)
  ),
  'identity_fingerprints',(select to_jsonb(f) from fingerprint_sets f)
) as snapshot;
```

On the **exact reviewed source checkout**, validate the private JSON:

```sh
node scripts/qa/oa5-method-b-retained-auth-session-census.mjs --check /secure/private/oa5-method-b-retained-auth.json
```

The checker refuses unexpected accounts, extra or missing sessions, changed privilege counts, missing/invalid fingerprint values, wrong Test project, changed cutoff, nonzero active jobs/queued work and stale evidence. It deliberately exposes **no digest values** in its stdout. A snapshot passing this guard confirms **only the observed historical Test session topology at that moment**. It never grants provider, reset or Auth deletion permission.

## Method B path forward — do not promote this observation to permission

1. Independently review original archive Auth IDs/session IDs under private custody against the historical user and pre-cutoff session set digests; a count of five alone is not row-level parity proof. Review the **two** retained privileged post-archive session records without revoking them.
2. Continue quarantining Test-only Meta/Paystack/Flutterwave/SMTP/FCM/AI delivery and incoming callbacks, preserving Production and Tandar. Preserve all five original protected Vercel Previews and their reviewer access.
3. Get exact v3 CLI remote-target/object/seed/roles/grants side-effect review and a named separately approved **Test-only** execution/abort record. No auto-confirm, generic `db push`, migration repair or managed Auth SQL deletion.
4. **After separately approved reconstruction**, run real historical-user **read and write denial** checks, admin RPC and old JWT/session checks, compare the five-user fingerprint, then test newly provisioned synthetic merchant positive controls and restore a safe Test-only provider path only upon separate acceptance.

The existing archived-count, managed-state and historical-authority guards intentionally still fail closed when seven sessions are compared with old five-/six-session baselines. Do **not** simply change those historical baselines or use an older one-session-loss exception to waive this new finding. The new retained-session helper records the **correct Method B non-deletion strategy** in parallel; future operator evidence can reconcile custody explicitly, not manufacture archival parity. **No hosted change performed in this workstream.**
