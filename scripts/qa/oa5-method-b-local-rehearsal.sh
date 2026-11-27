#!/usr/bin/env bash
# Local-only Method B replay. The original encrypted archive remains the recovery source.
# This intentionally changes ONLY the existing disposable, network-none restore.
# It does not modify the historical migration ledger or certify hosted readiness.
set -Eeuo pipefail
umask 077
MODE="${1:-}"
case "$MODE" in
 --execute-disposable-local) [[ $# == 1 ]] ;;
 --resume-first-fk-failure) [[ $# == 2 ]] ;;
 *) echo "Expected --execute-disposable-local or --resume-first-fk-failure <private prior log directory>"; exit 2 ;;
esac
C=sellertray-oa5-restore-20261107
cd "$(git rev-parse --show-toplevel)"
[[ "$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$C")" == none ]]
[[ "$(docker inspect -f '{{.State.Running}}' "$C")" == true ]]
[[ -z "$(docker port "$C")" ]]
node --input-type=module <<'JS'
import {inventoryOa5SourceMigrationScope} from './scripts/qa/oa5-migration-scope-inventory.mjs';
const r=inventoryOa5SourceMigrationScope('supabase/migrations');
if(!r.structural_source_check_passed||r.source_migrations_scanned!==461||
 r.source_inventory_sha256!=='d91f7762448aa0b1d4fc44093700e6bc48e20a6177c09bb8735ea01c98efa42c') throw Error('Unexpected migration corpus');
console.log('Canonical source: 461 files, fingerprint PASS');
JS
if [[ "$MODE" == --resume-first-fk-failure ]]; then
 LOG=$(realpath -- "$2")
 [[ "$LOG" == "$HOME"/oa5-method-b-local.* && -d "$LOG" ]]
 [[ -f "$LOG/auth-before.private" && -f "$LOG/auth-after-retirement.private" ]]
 cmp "$LOG/auth-before.private" "$LOG/auth-after-retirement.private"
 [[ "$(cat "$LOG/replay-progress.log")" == "1 20260909080000_initial_core_schema_baseline.sql" ]]
 grep -Fxq 'psql:<stdin>:23: ERROR:  permission denied for table users' "$LOG/20260909080000_initial_core_schema_baseline.sql.log"
else
 LOG=$(mktemp -d "$HOME/oa5-method-b-local.XXXXXX")
fi
echo "Private local logs: $LOG"
db(){ docker exec -i "$C" psql -X -h /run/postgresql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
trap 'echo "BLOCKED: local rehearsal stopped. Do not retry on a partially rebuilt database. Inspect private logs: $LOG" >&2' ERR

# Fingerprint all ordinary Auth tables, without returning any row content.
auth_snapshot(){
 db -At <<'SQL'
SELECT format('SELECT %L, count(*), md5(coalesce(string_agg(to_jsonb(t)::text, E''\\n'' ORDER BY to_jsonb(t)::text),'''')) FROM %I.%I t;',c.relname,n.nspname,c.relname)
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='auth' AND c.relkind='r' ORDER BY c.relname
\gexec
SQL
}
if [[ "$MODE" == --execute-disposable-local ]]; then
[[ "$(db -Atc "select (select count(*) from auth.users)||'|'||(select count(*) from auth.sessions)||'|'||(select count(*) from public.tenants)||'|'||(select count(*) from supabase_migrations.schema_migrations)")" == '5|5|3|54' ]]
auth_snapshot > "$LOG/auth-before.private"
db -Atc "select id from storage.buckets order by id" | LC_ALL=C sort > "$LOG/buckets-before.private"
db -Atc "select count(*) from storage.objects" > "$LOG/storage-before.private"
db -Atc "select extname,extversion from pg_extension order by extname" | LC_ALL=C sort > "$LOG/extensions-before.private"
else
 auth_snapshot > "$LOG/auth-resume.private"
 cmp "$LOG/auth-before.private" "$LOG/auth-resume.private"
fi
# Disable local cron launcher before replay. Fail closed if the extension is
# preloaded but the installed version does not expose this control.
cron_setting=$(db -Atc "select coalesce(current_setting('cron.launch_active_jobs',true),'unavailable')")
# The Supabase postgres role is not necessarily permitted to ALTER SYSTEM.
# Use the local container's administrative role for scheduler control and the verified local ACL repair,
# never for migration replay. No password, remote connection or role membership grant.
db_admin(){
 [[ "$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$C")" == none ]]
 docker exec -i -u postgres "$C" psql -X -h /run/postgresql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 "$@"
}
if [[ "$cron_setting" != unavailable ]]; then
 if [[ "$cron_setting" != off ]]; then
  [[ "$(db_admin -Atc "select rolsuper and inet_server_addr() is null from pg_roles where rolname=current_user")" == t ]]
  db_admin -c "alter system set cron.launch_active_jobs = off" > "$LOG/cron-disable.log"
  db_admin -c "select pg_reload_conf()" >> "$LOG/cron-disable.log"
  for attempt in {1..10}; do
   [[ "$(db -Atc "show cron.launch_active_jobs")" == off ]] && break
   sleep 1
  done
 fi
 [[ "$(db -Atc "show cron.launch_active_jobs")" == off ]]
else
 [[ "$(db -Atc "show shared_preload_libraries")" != *pg_cron* ]]
fi
db_admin -c "select cron.alter_job(jobid,active=>false) from cron.job where active" > "$LOG/cron-pause.log"
[[ "$(db_admin -Atc "select count(*) from cron.job where active")" == 0 ]]
echo "Local scheduler disabled: PASS"
# The first attempt established that the restored local ACL omits REFERENCES
# on auth.users. Hosted Test read-only census confirmed postgres has an
# explicit table REFERENCES grant. Restore only this local missing privilege,
# not superuser status or wider access. Do not make any hosted ACL changes.
if [[ "$(db -Atc "select has_table_privilege(current_user,'auth.users','REFERENCES')")" != t ]]; then
 db_admin -c "grant references on table auth.users to postgres" > "$LOG/local-auth-references.log"
fi
[[ "$(db -Atc "select has_column_privilege(current_user,'auth.users','id','REFERENCES')")" == t ]]
if [[ "$MODE" == --resume-first-fk-failure ]]; then
 # Only the empty tenants table from the first two statements can remain.
 # Reject all unexpected application objects and never CASCADE on resumption.
 db <<'SQL'
BEGIN;
DO $$
BEGIN
 IF (SELECT count(*) FROM auth.users) <> 5
 OR (SELECT count(*) FROM auth.sessions) <> 5
 OR (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 54
 OR (SELECT count(*) FROM public.tenants) <> 0
 OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname IN ('public','sellertray_private'))
 OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname IN ('public','sellertray_private')
            AND c.relkind IN ('r','p','v','m','S','f')
            AND NOT (n.nspname='public' AND c.relname='tenants' AND c.relkind='r'))
 THEN RAISE EXCEPTION 'Unexpected partial baseline; refusing resumption'; END IF;
END $$;
DROP TABLE public.tenants RESTRICT;
COMMIT;
SQL
 mv "$LOG/replay-progress.log" "$LOG/first-attempt-progress.log"
 mv "$LOG/20260909080000_initial_core_schema_baseline.sql.log" "$LOG/first-attempt-migration-1.log"
 echo "Known partial migration removed; local Auth REFERENCES privilege reconciled: PASS"
else
# Repeat the proven local retirement inside a transaction, with a strict
# allowlist for cross-schema cascades. No managed Auth rows or ledger writes.
db > "$LOG/retirement.log" 2>&1 <<'SQL'
BEGIN;
CREATE TEMP TABLE allowed_auth_triggers AS
SELECT t.oid FROM pg_trigger t
JOIN pg_class r ON r.oid=t.tgrelid
JOIN pg_namespace n ON n.oid=r.relnamespace
JOIN pg_constraint c ON c.oid=t.tgconstraint
JOIN pg_class child ON child.oid=c.conrelid
JOIN pg_namespace cn ON cn.oid=child.relnamespace
WHERE n.nspname='auth' AND t.tgisinternal AND c.contype='f'
AND cn.nspname IN ('public','sellertray_private');
CREATE TEMP TABLE allowed_publication_members AS
SELECT pr.oid FROM pg_publication_rel pr
JOIN pg_class c ON c.oid=pr.prrelid JOIN pg_namespace n ON n.oid=c.relnamespace
JOIN pg_publication p ON p.oid=pr.prpubid
WHERE n.nspname IN ('public','sellertray_private') AND p.pubname='supabase_realtime';
CREATE TEMP TABLE allowed_storage_policies AS
SELECT p.oid FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='storage' AND c.relname='objects' AND p.polname IN
('SellerTray catalogue image upload','SellerTray catalogue image update','SellerTray catalogue image delete');
CREATE TEMP TABLE dropped(classid oid,objid oid,object_type text,schema_name text);
CREATE SCHEMA oa5_local_probe;
CREATE FUNCTION oa5_local_probe.capture_drops() RETURNS event_trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO pg_temp.dropped SELECT classid,objid,object_type,schema_name FROM pg_event_trigger_dropped_objects();
END $$;
CREATE EVENT TRIGGER oa5_local_drop_probe ON sql_drop EXECUTE FUNCTION oa5_local_probe.capture_drops();
DO $$
DECLARE targets text;
BEGIN
 IF EXISTS(SELECT 1 FROM pg_depend d JOIN pg_class c ON d.classid='pg_class'::regclass AND d.objid=c.oid
 JOIN pg_namespace n ON n.oid=c.relnamespace WHERE d.deptype='e' AND n.nspname IN ('public','sellertray_private'))
 OR EXISTS(SELECT 1 FROM pg_depend d JOIN pg_proc p ON d.classid='pg_proc'::regclass AND d.objid=p.oid
 JOIN pg_namespace n ON n.oid=p.pronamespace WHERE d.deptype='e' AND n.nspname IN ('public','sellertray_private'))
 THEN RAISE EXCEPTION 'Unexpected extension-owned application object'; END IF;
 SELECT string_agg(format('%I.%I',n.nspname,c.relname),', ') INTO targets
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','sellertray_private') AND c.relkind IN ('r','p');
 EXECUTE 'DROP TABLE '||targets||' CASCADE';
 SELECT string_agg(format('%I.%I(%s)',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),', ') INTO targets
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','sellertray_private');
 IF targets IS NOT NULL THEN EXECUTE 'DROP ROUTINE '||targets||' CASCADE'; END IF;
 IF EXISTS(SELECT 1 FROM dropped d WHERE (
 coalesce(d.schema_name,'') IN ('public','sellertray_private')
 OR (d.schema_name='pg_toast' AND d.object_type IN ('index','toast table'))
 OR (d.schema_name='auth' AND d.classid='pg_trigger'::regclass AND d.objid IN (SELECT oid FROM allowed_auth_triggers))
 OR (d.schema_name='storage' AND d.classid='pg_policy'::regclass AND d.objid IN (SELECT oid FROM allowed_storage_policies))
 OR (d.schema_name IS NULL AND d.classid='pg_publication_rel'::regclass AND d.objid IN (SELECT oid FROM allowed_publication_members))
 ) IS NOT TRUE) THEN RAISE EXCEPTION 'Unexpected cross-boundary cascade'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','sellertray_private') AND c.relkind IN ('r','p','v','m','S','f'))
 OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','sellertray_private'))
 THEN RAISE EXCEPTION 'Application objects remain'; END IF;
END $$;
SELECT schema_name,object_type,count(*) FROM dropped GROUP BY 1,2 ORDER BY 1,2;
DROP EVENT TRIGGER oa5_local_drop_probe;
DROP SCHEMA oa5_local_probe CASCADE;
COMMIT;
SQL
auth_snapshot > "$LOG/auth-after-retirement.private"
cmp "$LOG/auth-before.private" "$LOG/auth-after-retirement.private"
echo "Selective retirement and managed Auth row preservation: PASS"
fi
# Files contain their own transaction boundaries. Run each in order, stop
# at first error, and retain a private log. No fabricated ledger entries.
export LC_ALL=C
i=0
for f in supabase/migrations/*.sql; do
 [[ "$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$C")" == none ]]
 i=$((i+1))
 printf '%s %s\n' "$i" "${f##*/}" >> "$LOG/replay-progress.log"
 if ! db -f - < "$f" > "$LOG/${f##*/}.log" 2>&1; then
  echo "Migration failed: $i ${f##*/} (private log in $LOG)"
  exit 1
 fi
 if (( i % 50 == 0 )); then echo "Replayed $i/461"; fi
done
[[ "$i" == 461 ]]
db_admin -c "select cron.alter_job(jobid,active=>false) from cron.job where active" > "$LOG/cron-post.log"
[[ "$(db_admin -Atc "select count(*) from cron.job where active")" == 0 ]]
auth_snapshot > "$LOG/auth-after-replay.private"
cmp "$LOG/auth-before.private" "$LOG/auth-after-replay.private"
db -Atc "select id from storage.buckets order by id" | LC_ALL=C sort > "$LOG/buckets-after.private"
[[ -z "$(comm -23 "$LOG/buckets-before.private" "$LOG/buckets-after.private")" ]]
[[ "$(db -Atc "select count(*) from storage.objects")" == "$(cat "$LOG/storage-before.private")" ]]
db -Atc "select extname,extversion from pg_extension order by extname" | LC_ALL=C sort > "$LOG/extensions-after.private"
[[ -z "$(comm -23 "$LOG/extensions-before.private" "$LOG/extensions-after.private")" ]]
db -c "select (select count(*) from auth.users) as retained_users,(select count(*) from auth.sessions) as retained_sessions,(select count(*) from public.tenants) as merchants,(select count(*) from public.tenant_members) as memberships,(select count(*) from cron.job where active) as active_jobs,(select count(*) from supabase_migrations.schema_migrations) as historical_ledger_rows"
[[ "$(db -Atc "select (select count(*) from public.tenants)||'|'||(select count(*) from public.tenant_members)||'|'||(select count(*) from cron.job where active)||'|'||(select count(*) from supabase_migrations.schema_migrations)")" == '0|0|0|54' ]]
echo "LOCAL_REPLAY=PASS (461 files; historical ledger intentionally retained; hosted readiness NOT proven)"
