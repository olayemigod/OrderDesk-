# OA5 Test-only rebuild — operator preflight and human authorization boundary (09/11/2026)

**Decision: NO-GO for any destructive hosted action.** No SQL reset, `cron.alter_job`, Vercel deployment, Edge deployment, callback or APK is authorized by this document. The approved 06/11/2026 **conditional** decision permits reuse of the existing Agreement Test project only after recoverable archive and reviewed operator scope. It is **not** a blanket authorization for a remote wipe.

## Already recorded — do not repeat unnecessary work

- Existing standalone **Test project**: `iukgsukdoowvnhlfmpml`. **Production** `eujxswjspolugrzlsjnn`, Tandar and all live merchants are excluded. Do not create another paid Test branch/project.
- Operator-verified OA5 encrypted recovery archive `sellertray-test-recovery-package-oa5-20261107.tar.gz.gpg`: SHA-256 `38b28dd9f8ef4ed35b69f85b1f97fa2f52829512f11ab1961de0a55056238616`, 2,908,531 bytes; OneDrive-synced checksum PASS, five secure SQL exports and disposable PostgreSQL 17 restore previously verified. A fresh independent cloud download was not recorded. Preserve archived migration/Agreement proof, not only table counts.
- 09/11/2026 owner verified signed-out Vercel login challenges for historic Merchant/Admin Preview URLs and authenticated return to both original pages; both canonical Production Merchant/Admin websites opened publicly. Two existing Vercel projects now use Standard Authentication (`prod_deployment_urls_and_all_previews`). Five historic deployments remain READY and preserved. **External reviewer continuity** (if any) and original compiled JavaScript backend identity are unverified. No Test custom domain is attached; these old Preview builds must not be repurposed as current QA clients.
- Current source in draft PR #228 has **457 unique canonical SQL migrations**, versus the historical Test ledger's 54 agreement-era entries. Do not spoof, bypass or bulk push migration versions; the exact cleanup method remains unapproved.
- Last Test-only evidence shows **four active pg_cron jobs**, **zero unfinished runs at any age**, **zero pending `pg_net` requests**. Four active jobs alone require **STOP**. Five historical Agreement-only Edge functions exist versus 50 canonical source functions; do not delete `agreement-pdf-runtime-probe` or blindly deploy all 50.
- The later Expo 58 draft PR #235 passed its source dependency audit, Kotlin and R8 tests at the previously verified source SHA; no signed QA APK/hardware acceptance exists. Do not use Production-bound legacy `qa` APK for Test.

## Exact scope that must be independently reviewed before a maintenance window

1. **Custody:** locate the encrypted archive and private five-file SQL manifest; independently inspect actual disposable restore logs and preserved Agreement/migration history. Keep secrets and data in operator-controlled storage, never GitHub/PR/CI.
2. **Historical dependencies:** keep the five Preview aliases and prior agreement proof. Capture Vercel reviewer continuity and the *compiled* Supabase backend identity for the old pages before removing old Test Auth/user data. A browser screenshot of the Merchant login panel does not prove compiled endpoint identity.
3. **Ingress and provider isolation:** independent provider-console confirmation of Meta Test app/phone ownership, separate Paystack/Flutterwave Test keys, webhook/redirect configurations, SMTP safe sender and recipients, Firebase Test, Auth Test redirect schemes, and no real merchant/Production callback destination. Explicitly block Test ingress before any data-clearing step. No production provider configuration changes.
4. **Reversible cron freeze (separate approval):** verify exact four job IDs, commands and schedules, then request authorization to pause those jobs *only in Test*, not unschedule them. Capture a new read-only schema-v2 snapshot **after** the authorized pause with `active=false`, no unfinished run **regardless of age**, no queued `pg_net`, correct project identity and age under ten minutes.
5. **Exact hosted cleanup mechanism:** document each impacted schema/managed service: public tables, `supabase_migrations` history, Auth users/sessions, Storage metadata/objects, Edge deployments, secrets, cron schedules, provider callback routes. A generic remote `supabase db reset` is **not** a full-project wipe and may leave managed state; do not choose it as the default. Specify tested cleanup operation, required elevated privileges, target identity double-check, expected irreversible Test data loss and a reviewed rollback path. This source-only package deliberately provides no destructive SQL commands or Vercel/API scripts.
6. **Rebuild order:** execute only after a separately signed Test-only execution change record. Check actual source commit; canonical migration order and pgTAP parity must be independently green. After reviewed schema rebuild, verify RLS, grants, SECURITY DEFINER access, migration ledger, branch/UOM/stock audit and payment idempotency **before** phased Edge deployments. Then add reviewed synthetic test merchants and branch/register/printer fixtures.
7. **Safe reactivation:** enable sandbox callbacks/notifications and Test worker schedules only through separately reviewed gates once exact-source deployed code, Test-only credentials and real recipient destinations are proven. Run Auth QA redirects, Merchant/Admin web protected Test domains, Bluetooth printer, notification and offline replay acceptance. Never re-enable historic schedules automatically.

**Immediate STOP:** compiled historical endpoint proof, independent provider/sink isolation, Auth/Storage cleanup semantics, reviewed exact reset mechanism, explicit four-cron freeze approval, post-freeze fresh zero-queue snapshot and named recovery/rollback operator have not all been accepted. Neither this source tool nor a green database CI can assert those facts.

## Offline operator-evidence checker (requires private files, never commit them)

```sh
node scripts/qa/oa5-test-backup-manifest.mjs --check /secure/private/test-archive
node scripts/qa/oa5-test-cron-maintenance-gate.mjs --check /secure/private/post-pause-cron-v2.json
node scripts/qa/oa5-test-live-census.mjs --check /secure/private/post-pause-live-counts.json
node scripts/qa/oa5-test-rebuild-preflight.mjs --check /secure/private/operator-review.json /secure/private/test-archive /secure/private/post-pause-cron-v2.json /secure/private/post-pause-live-counts.json
```

The operator-review JSON shape is:

```json
{
  "schema_version": 1,
  "project_ref": "iukgsukdoowvnhlfmpml",
  "reviewed_source_sha": "THE_EXACT_40_CHARACTER_GIT_HEAD",
  "purpose": "pre-reset-human-review",
  "evidence": {
    "archive_restore_reviewed": {"reviewed": false, "evidence_ref": ""},
    "five_historical_previews_preserved": {"reviewed": false, "evidence_ref": ""},
    "historical_reviewer_continuity": {"reviewed": false, "evidence_ref": ""},
    "historical_compiled_backend_boundary": {"reviewed": false, "evidence_ref": ""},
    "production_custom_domains_public": {"reviewed": false, "evidence_ref": ""},
    "vercel_preview_auth_protection": {"reviewed": false, "evidence_ref": ""},
    "test_only_ingress_freeze_reviewed": {"reviewed": false, "evidence_ref": ""},
    "test_only_provider_callbacks_and_sinks": {"reviewed": false, "evidence_ref": ""},
    "test_auth_sessions_storage_scope": {"reviewed": false, "evidence_ref": ""},
    "reversible_four_job_pause_approved": {"reviewed": false, "evidence_ref": ""},
    "reviewed_cleanup_method_and_scope": {"reviewed": false, "evidence_ref": ""},
    "rollback_operator_and_recovery_plan": {"reviewed": false, "evidence_ref": ""},
    "exact_source_migration_order_and_parity": {"reviewed": false, "evidence_ref": ""},
    "synthetic_fixture_and_retention_plan": {"reviewed": false, "evidence_ref": ""},
    "archive_to_current_live_state_reconciled": {"reviewed": false, "evidence_ref": ""}
  }
}
```

Use only protected, non-secret **opaque evidence references** such as `private-review-0001`; no actual passwords, email addresses, URLs, personal records, key values or file paths in the record. An asserted `reviewed=true` is **not** cryptographic proof; independent human review remains mandatory. The CLI always prints that **destructive execution is NOT authorized**, even if all offline preconditions are met, and it cannot contact or mutate a hosted service.

**Cross-surface effects:** This package touches QA release governance only. After approval, the single shared commerce core must be verified through Mobile, Merchant Web, Admin Web, WhatsApp, AI, reporting and offline before declaring full acceptance. No runtime logic was modified here.

## 09/11/2026 — archived versus live Test state reconciliation

Fresh count-only Test read at 11:04 UTC returned auth_users=5, auth_sessions=6, public_tables=132,
public_functions=479, migration_rows=54, storage_buckets=3 and storage_objects=0.
The independently verified 07/11 recovery archive has five, not six, Auth sessions.
Read-only Auth session creation-day totals show one new session created 09/11 at 10:35:01 UTC.
No user identity, IP, session ID, token or customer record was inspected or copied.
Do not infer who created that session. A new session is post-archive data and must not silently disappear.

New offline-only script scripts/qa/oa5-test-live-census.mjs compares fresh Test counts with the
frozen archived counts and fails closed on any drift, unknown/Production project ref, missing or
extra fields, or evidence more than ten minutes old. The combined rebuild preflight now requires
this independent check in addition to verified archive/restore and the cron plus pg_net stop gate.
An operator must explicitly review post-archive changes and either produce and independently restore
a refreshed encrypted Test-only archive with a newly reviewed baseline, or approve the precise
post-archive Test-only loss through a reviewed control change. Never merely change expected counts
to force a green preflight. Even when the snapshot matches, no destructive execution is authorized.

Run the following read-only SELECT only from project iukgsukdoowvnhlfmpml, not Production.
Keep the returned JSON in private operator storage, not Git:

```sql
SELECT jsonb_build_object(
  'schema_version',1,'project_ref','iukgsukdoowvnhlfmpml',
  'captured_at_utc',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'counts',jsonb_build_object(
    'auth_users',(SELECT count(*)::int FROM auth.users),
    'auth_sessions',(SELECT count(*)::int FROM auth.sessions),
    'public_tables',(SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')),
    'public_functions',(SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'),
    'migration_rows',(SELECT count(*)::int FROM supabase_migrations.schema_migrations),
    'storage_buckets',(SELECT count(*)::int FROM storage.buckets),
    'storage_objects',(SELECT count(*)::int FROM storage.objects)
  )
) AS snapshot;
```

Supabase reference: https://supabase.com/docs/reference/cli/supabase-db-reset
and https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore.

## 09/11/2026 — bounded post-archive Test Auth session loss alternative

The existing encrypted Test archive is intact and independently restore-tested. A fresh archive
does not have to be the only *proposed* remedy for the extra Test Auth session, but no
session-loss permission has been given. The default census still fails on 5 archived vs
6 current sessions. A separately approved private record can permit that **one** exact
Test-only session-count difference through the offline preflight. This does not delete
the session, permit a database reset, or prove that unchanged row counts mean unchanged data.

The optional private reviewed-session-loss record must contain exactly these fields:

~~~json
{ "schema_version": 1, "project_ref": "iukgsukdoowvnhlfmpml",
  "scope": "one-post-archive-test-auth-session",
  "archive_auth_sessions": 5, "current_auth_sessions": 6,
  "approved_loss": false, "reviewed_at_utc": "2026-11-09T11:04:45Z",
  "evidence_ref": "private-review-0001" }
~~~

The example deliberately has approved_loss=false and will not pass. Only the owner
can approve that precise Test-only loss, after a fresh count-only SQL snapshot, and
the protected reviewed_at_utc must fall between capture and the present moment.
All other counts must still equal the original archive, and 7 sessions will not pass
using a six-session approval. Never copy identifiers, emails, tokens or URLs into this file.

After separate owner review, an operator may run:

~~~sh
node scripts/qa/oa5-test-live-census.mjs --check /secure/private/test-live-counts.json /secure/private/reviewed-session-loss.json
node scripts/qa/oa5-test-rebuild-preflight.mjs --check /secure/private/operator-review.json /secure/private/test-archive /secure/private/post-pause-cron-v2.json /secure/private/test-live-counts.json /secure/private/reviewed-session-loss.json
~~~

A passing operator review is only one prerequisite. The independently approved four-job
pause, outbound-callback isolation, hosted Auth/session token revocation, exact cleanup
method and specific destructive Test execution authorization remain separate STOP gates.
Production and Tandar are excluded. No hosted operations are performed by these scripts.
