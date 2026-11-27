#!/usr/bin/env bash
# Local-only Method B replay. The original encrypted archive remains the recovery source.
# This intentionally changes ONLY the existing disposable, network-none restore.
# It does not modify the historical migration ledger or certify hosted readiness.
set -euo pipefail
umask 077
[[ "${1:-}" == "--execute-disposable-local" && $# == 1 ]] || { echo "Local rehearsal requires --execute-disposable-local"; exit 2; }
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
LOG=$(mktemp -d "$HOME/oa5-method-b-local.XXXXXX")
echo "Private local logs: $LOG"
db(){ docker exec -i "$C" psql -X -h /run/postgresql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
trap 'echo "BLOCKED: local rehearsal stopped. Do not retry on a partially rebuilt database. Inspect private logs: $LOG" >&2' ERR
[[ "$(db -Atc "select (select count(*) from auth.users)||'|'||(select count(*) from auth.sessions)||'|'||(select count(*) from public.tenants)||'|'||(select count(*) from supabase_migrations.schema_migrations)")" == '5|5|3|54' ]]
# Fingerprint all ordinary Auth tables, without returning any row content.
auth_snapshot(){
 db -At <<'SQL'
SELECT format('SELECT %L, count(*), md5(coalesce(string_agg(to_jsonb(t)::text, E''\\n'' ORDER BY to_jsonb(t)::text),'''')) FROM %I.%I t;',c.relname,n.nspname,c.relname)
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='auth' AND c.relkind='r' ORDER BY c.relname
\gexec
SQL
}
auth_snapshot > "$LOG/auth-before.private"
db -Atc "select id from storage.buckets order by id" > "$LOG/buckets-before.private"
db -Atc "select count(*) from storage.objects" > "$LOG/storage-before.private"
db -Atc "select extname,extversion from pg_extension order by extname" > "$LOG/extensions-before.private"
# Disable local cron launcher before replay. Fail closed if the extension is
# preloaded but the installed version does not expose this control.
cron_setting=$(db -Atc "select coalesce(current_setting('cron.launch_active_jobs',true),'unavailable')")
if [[ "$cron_setting" != unavailable ]]; then
 db -c "alter system set cron.launch_active_jobs = off" > "$LOG/cron-disable.log"
 db -c "select pg_reload_conf()" >> "$LOG/cron-disable.log"
 sleep 2
 [[ "$(db -Atc "show cron.launch_active_jobs")" == off ]]
else
 [[ "$(db -Atc "show shared_preload_libraries")" != *pg_cron* ]]
fi
db -c "select cron.alter_job(jobid,active=>false) from cron.job where active" > "$LOG/cron-pause.log"
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
 IF EXISTS(SELECT 1 FROM dropped d WHERE NOT (
 coalesce(d.schema_name,'') IN ('public','sellertray_private')
 OR (d.schema_name='pg_toast' AND d.object_type IN ('index','toast table'))
 OR (d.schema_name='auth' AND d.classid='pg_trigger'::regclass AND d.objid IN (SELECT oid FROM allowed_auth_triggers))
 OR (d.schema_name='storage' AND d.classid='pg_policy'::regclass AND d.objid IN (SELECT oid FROM allowed_storage_policies))
 OR (d.schema_name IS NULL AND d.classid='pg_publication_rel'::regclass AND d.objid IN (SELECT oid FROM allowed_publication_members))
 ) IS TRUE) THEN RAISE EXCEPTION 'Unexpected cross-boundary cascade'; END IF;
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
db -c "select cron.alter_job(jobid,active=>false) from cron.job where active" > "$LOG/cron-post.log"
auth_snapshot > "$LOG/auth-after-replay.private"
cmp "$LOG/auth-before.private" "$LOG/auth-after-replay.private"
db -Atc "select id from storage.buckets order by id" > "$LOG/buckets-after.private"
[[ -z "$(comm -23 "$LOG/buckets-before.private" "$LOG/buckets-after.private")" ]]
[[ "$(db -Atc "select count(*) from storage.objects")" == "$(cat "$LOG/storage-before.private")" ]]
db -Atc "select extname,extversion from pg_extension order by extname" > "$LOG/extensions-after.private"
[[ -z "$(comm -23 "$LOG/extensions-before.private" "$LOG/extensions-after.private")" ]]
db -c "select (select count(*) from auth.users) as retained_users,(select count(*) from auth.sessions) as retained_sessions,(select count(*) from public.tenants) as merchants,(select count(*) from public.tenant_members) as memberships,(select count(*) from cron.job where active) as active_jobs,(select count(*) from supabase_migrations.schema_migrations) as historical_ledger_rows"
[[ "$(db -Atc "select (select count(*) from public.tenants)||'|'||(select count(*) from public.tenant_members)||'|'||(select count(*) from cron.job where active)||'|'||(select count(*) from supabase_migrations.schema_migrations)")" == '0|0|0|54' ]]
echo "LOCAL_REPLAY=PASS (461 files; historical ledger intentionally retained; hosted readiness NOT proven)"
