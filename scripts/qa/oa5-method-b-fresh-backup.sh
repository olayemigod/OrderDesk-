#!/usr/bin/env bash
# Read-only operator-local supplemental backup. Preserve November 7 archive.
set -Eeuo pipefail
umask 077
[[ $# == 1 && "$1" == --approved-test-backup ]] || { echo 'BLOCKED: explicit Test backup invocation required'; exit 2; }
REF=iukgsukdoowvnhlfmpml
DEST='/mnt/c/Users/Mathew Alao/OneDrive/SellerTray Backup/Test'
[[ -d "$DEST" ]] || { echo 'BLOCKED: existing encrypted backup destination missing'; exit 1; }
read -r -p 'Test dashboard session-pooler HOST (host only): ' HOST
[[ "$HOST" =~ ^aws-[0-9]+-eu-west-1\.pooler\.supabase\.com$ ]] || { echo 'BLOCKED: unexpected Test pooler hostname'; exit 1; }
unset PGHOST PGHOSTADDR PGPORT PGUSER PGDATABASE PGSERVICE PGSERVICEFILE PGPASSFILE PGOPTIONS PGSSLCERT PGSSLKEY PGPASSWORD
if [[ ! -v PGSSLROOTCERT || -z "$PGSSLROOTCERT" ]]; then export PGSSLROOTCERT=/etc/ssl/certs/ca-certificates.crt; fi
[[ -r "$PGSSLROOTCERT" ]] || { echo 'BLOCKED: trusted CA unavailable'; exit 1; }
URL="postgresql://postgres.$REF@$HOST:5432/postgres?sslmode=verify-full&connect_timeout=10"
read -r -s -p 'Existing TEST database password (not echoed): ' PGPASSWORD; echo
[[ -n "$PGPASSWORD" ]] || exit 1
export PGPASSWORD
BIN=/usr/lib/postgresql/17/bin
if [[ -x "$BIN/pg_dump" && -x "$BIN/psql" && -x "$BIN/pg_restore" ]]; then export PATH="$BIN:$PATH"; fi
for x in pg_dump pg_restore psql gpg sha256sum; do command -v "$x" >/dev/null || { echo "BLOCKED: missing $x"; exit 1; }; done
DUMP_MAJOR="$(pg_dump --version | grep -oE '[0-9]+\.[0-9]+' | head -1 | cut -d. -f1)"
[[ "$DUMP_MAJOR" -ge 17 ]] || { echo 'BLOCKED: PostgreSQL client 17+ required'; exit 1; }
WORK="$(mktemp -d "$HOME/oa5-current-test-backup.XXXXXX")"
trap 'unset PGPASSWORD' EXIT
export GPG_TTY="$(tty)"
# Count/digest only. Raw data streams directly into GPG.
CENSUS="SELECT concat_ws('|',(SELECT count(*) FROM auth.users),(SELECT count(*) FROM auth.sessions),(SELECT count(*) FROM auth.refresh_tokens),(SELECT count(*) FROM public.tenants),(SELECT count(*) FROM supabase_migrations.schema_migrations),(SELECT encode(sha256(convert_to(jsonb_agg(to_jsonb(m) ORDER BY version)::text,'UTF8')),'hex') FROM supabase_migrations.schema_migrations m),(SELECT count(*) FROM cron.job WHERE active),(SELECT count(*) FROM cron.job_run_details WHERE end_time IS NULL),(SELECT count(*) FROM net.http_request_queue),(SELECT count(*) FROM sellertray_private.runtime_config),(SELECT count(*) FROM vault.secrets),current_user,current_database());"
EXPECTED='5|7|22|3|54|6c47ed928eaebf1ceb63a19611840c1ce65d5d542df0d13b7dcd2517ad14e031|0|0|0|0|0|postgres|postgres'
before="$(psql -X -w -Atq -v ON_ERROR_STOP=1 "$URL" -c "$CENSUS")"
[[ "$before" == "$EXPECTED" ]] || { echo 'BLOCKED: current Test baseline differs; no archive created'; exit 1; }
echo 'TEST_BACKUP_BASELINE=PASS'
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="sellertray-test-current-method-b-$STAMP.dump.gpg"
# Selected application schemas, Auth, Storage and ledger. This supplemental dump
# does not recreate managed roles, extensions, external provider config or Storage bytes.
pg_dump --dbname="$URL" --no-password --format=custom \
 --schema=public --schema=sellertray_private --schema=supabase_migrations \
 --schema=auth --schema=storage --schema=cron --schema=vault \
 2>"$WORK/pg_dump.log" | gpg --symmetric --cipher-algo AES256 --output "$WORK/$FILE"
[[ -s "$WORK/$FILE" ]] || { echo 'BLOCKED: archive empty'; exit 1; }
# Read entire archive and generate SQL into /dev/null, not a database.
gpg --decrypt "$WORK/$FILE" 2>"$WORK/gpg-verify.log" | pg_restore --file=/dev/null
# Count COPY records in the actual archive, not only the live source or TOC.
# Never print the COPY content (which contains private Auth/merchant data).
gpg --decrypt "$WORK/$FILE" 2>>"$WORK/gpg-verify.log" | pg_restore --data-only --file=- | awk '
BEGIN { expected["auth.users"]=5; expected["auth.sessions"]=7; expected["auth.refresh_tokens"]=22; expected["public.tenants"]=3; expected["supabase_migrations.schema_migrations"]=54 }
active!="" {
 if ($0=="\\.") { active=""; next }
 counts[active]++; next
}
$1=="COPY" && ($2 in expected) && / FROM stdin;$/ { active=$2; seen[active]++ }
END {
 if (active!="") exit 1
 for (t in expected) if (seen[t]!=1 || counts[t]!=expected[t]) exit 1
 print "ARCHIVE_ROW_COUNTS=PASS"
}'
gpg --decrypt "$WORK/$FILE" 2>>"$WORK/gpg-verify.log" | { pg_restore --list >"$WORK/toc.txt"; cat >/dev/null; }
[[ "$(grep -Ec ' TABLE DATA (public|sellertray_private) ' "$WORK/toc.txt")" == 140 ]] || { echo 'BLOCKED: app table data entries differ'; exit 1; }
for item in 'auth users' 'auth sessions' 'auth refresh_tokens' 'supabase_migrations schema_migrations' 'storage buckets' 'storage objects'; do
 grep -Fq " TABLE DATA $item " "$WORK/toc.txt" || { echo "BLOCKED: expected archive data entry missing: $item"; exit 1; }
done
after="$(psql -X -w -Atq -v ON_ERROR_STOP=1 "$URL" -c "$CENSUS")"
[[ "$after" == "$before" ]] || { echo 'BLOCKED: Test baseline changed during backup'; exit 1; }
unset PGPASSWORD
[[ ! -e "$DEST/$FILE" ]] || { echo 'BLOCKED: backup destination already exists'; exit 1; }
cp --no-clobber "$WORK/$FILE" "$DEST/$FILE"
cmp -s "$WORK/$FILE" "$DEST/$FILE" || { echo 'BLOCKED: OneDrive copy mismatch'; exit 1; }
digest="$(sha256sum "$DEST/$FILE" | cut -d' ' -f1)"
printf 'FRESH_TEST_BACKUP=PASS\nAUTH_USERS=5\nAUTH_SESSIONS=7\nAUTH_REFRESH_TOKENS=22\nHISTORICAL_LEDGER_ROWS=54\nAPPLICATION_TABLE_DATA_ENTRIES=140\nARCHIVE=%s\nSHA256=%s\nONEDRIVE_LOCAL_COPY=PASS\n' "$FILE" "$digest"
echo 'Supplemental archive read/decryption verified; not a new full restore rehearsal. Prior archive unchanged.'
