-- OA5 hosted retirement candidate: ROLLBACK ONLY.
-- NOT AUTHORIZED TO RUN ON HOSTED TEST. Never use on Production or Tandar.
-- The external operator must independently verify endpoint, fresh archive,
-- provider containment, maintenance exclusivity and separate authorization.
-- This script cannot commit. Historical ledger rows are NOT removed here.
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
DO $oa5$
BEGIN
 IF current_user <> 'postgres' OR current_database()<>'postgres'
 OR (SELECT count(*) FROM auth.users)<>5
 OR (SELECT count(*) FROM auth.sessions)<>7
 OR (SELECT count(*) FROM public.tenants)<>3
 OR (SELECT count(*) FROM supabase_migrations.schema_migrations)<>54
 OR (SELECT encode(sha256(convert_to(jsonb_agg(to_jsonb(m) ORDER BY version)::text,'UTF8')),'hex')
     FROM supabase_migrations.schema_migrations m)
     IS DISTINCT FROM '6c47ed928eaebf1ceb63a19611840c1ce65d5d542df0d13b7dcd2517ad14e031'
 OR (SELECT count(*) FROM cron.job)<>4
 OR EXISTS(SELECT 1 FROM cron.job WHERE active)
 OR EXISTS(SELECT 1 FROM cron.job_run_details WHERE end_time IS NULL)
 OR EXISTS(SELECT 1 FROM net.http_request_queue)
 OR EXISTS(SELECT 1 FROM sellertray_private.runtime_config)
 THEN RAISE EXCEPTION 'OA5 historical baseline mismatch'; END IF;
END $oa5$;
CREATE TEMP TABLE oa5_closure ON COMMIT DROP AS
WITH RECURSIVE app AS (
 SELECT oid FROM pg_namespace WHERE nspname IN ('public','sellertray_private')
), roots(classid,objid) AS (
 SELECT 'pg_class'::regclass::oid,oid FROM pg_class WHERE relnamespace IN (SELECT oid FROM app) AND relkind IN ('r','p')
 UNION SELECT 'pg_proc'::regclass::oid,oid FROM pg_proc WHERE pronamespace IN (SELECT oid FROM app)
), closure(classid,objid) AS (
 SELECT classid,objid FROM roots
 UNION
 SELECT d.classid,d.objid FROM pg_depend d JOIN closure c ON d.refclassid=c.classid AND d.refobjid=c.objid
), described AS (
 SELECT c.*,i.type,i.schema,i.identity,
 CASE
 WHEN i.schema IN ('public','sellertray_private') THEN 'application'
 WHEN i.schema='pg_toast' AND i.type IN ('index','toast table') THEN 'toast'
 WHEN c.classid='pg_attrdef'::regclass AND EXISTS(
 SELECT 1 FROM pg_attrdef a JOIN pg_class r ON r.oid=a.adrelid WHERE a.oid=c.objid AND r.relnamespace IN (SELECT oid FROM app)) THEN 'application_default'
 WHEN c.classid='pg_policy'::regclass AND EXISTS(
 SELECT 1 FROM pg_policy p JOIN pg_class r ON r.oid=p.polrelid WHERE p.oid=c.objid AND r.relnamespace IN (SELECT oid FROM app)) THEN 'application_policy'
 WHEN c.classid='pg_trigger'::regclass AND EXISTS(
 SELECT 1 FROM pg_trigger t JOIN pg_class r ON r.oid=t.tgrelid WHERE t.oid=c.objid AND r.relnamespace IN (SELECT oid FROM app)) THEN 'application_trigger'
 WHEN c.classid='pg_trigger'::regclass AND EXISTS(
 SELECT 1 FROM pg_trigger t JOIN pg_constraint k ON k.oid=t.tgconstraint JOIN pg_class ch ON ch.oid=k.conrelid JOIN pg_class pr ON pr.oid=t.tgrelid JOIN pg_namespace n ON n.oid=pr.relnamespace
 WHERE t.oid=c.objid AND t.tgisinternal AND k.contype='f' AND ch.relnamespace IN(SELECT oid FROM app) AND n.nspname='auth') THEN 'auth_fk_internal_trigger'
 WHEN c.classid='pg_policy'::regclass AND EXISTS(
 SELECT 1 FROM pg_policy p JOIN pg_class r ON r.oid=p.polrelid JOIN pg_namespace n ON n.oid=r.relnamespace
 WHERE p.oid=c.objid AND n.nspname='storage' AND r.relname='objects' AND p.polname IN ('SellerTray catalogue image upload','SellerTray catalogue image update','SellerTray catalogue image delete')) THEN 'reviewed_storage_policy'
 WHEN c.classid='pg_publication_rel'::regclass AND EXISTS(
 SELECT 1 FROM pg_publication_rel pr JOIN pg_publication p ON p.oid=pr.prpubid JOIN pg_class r ON r.oid=pr.prrelid
 WHERE pr.oid=c.objid AND p.pubname='supabase_realtime' AND r.relnamespace IN(SELECT oid FROM app)) THEN 'reviewed_realtime_member'
 ELSE 'unclassified' END category
 FROM closure c CROSS JOIN LATERAL pg_identify_object(c.classid,c.objid,0) i
)
SELECT classid,objid,type,schema,identity,category FROM described;

DO $oa5$
BEGIN
 IF (SELECT count(*) FROM oa5_closure)<>5294
 OR EXISTS(SELECT 1 FROM oa5_closure WHERE category='unclassified')
 OR (SELECT encode(sha256(convert_to(jsonb_agg(jsonb_build_array(classid,objid,type,schema,identity,category) ORDER BY classid,objid)::text,'UTF8')),'hex') FROM oa5_closure)
    IS DISTINCT FROM '631cd465d6a1c574e45fee420d3c1839a3c902e3fc53c955c08d66502edf97aa'
 OR EXISTS(SELECT 1 FROM oa5_closure x JOIN pg_depend d ON d.classid=x.classid AND d.objid=x.objid WHERE d.deptype='e')
 OR EXISTS(SELECT 1 FROM oa5_closure x JOIN pg_depend d ON d.classid=x.classid AND d.objid=x.objid WHERE d.deptype='i' AND NOT EXISTS(SELECT 1 FROM oa5_closure c WHERE c.classid=d.refclassid AND c.objid=d.refobjid))
 THEN RAISE EXCEPTION 'OA5 catalog closure drift'; END IF;
END $oa5$;
-- Managed data fingerprints computed in the database; no sensitive rows returned.
CREATE TEMP TABLE oa5_managed_before(schema_name text,table_name text,digest text) ON COMMIT DROP;
CREATE TEMP TABLE oa5_managed_after(LIKE oa5_managed_before) ON COMMIT DROP;
-- Snapshot external catalog identities from the principal affected classes.
CREATE TEMP TABLE oa5_catalog_before ON COMMIT DROP AS
 SELECT classid,objid FROM (
 SELECT 'pg_class'::regclass::oid classid,oid objid FROM pg_class
 UNION ALL SELECT 'pg_proc'::regclass::oid,oid FROM pg_proc
 UNION ALL SELECT 'pg_type'::regclass::oid,oid FROM pg_type
 UNION ALL SELECT 'pg_constraint'::regclass::oid,oid FROM pg_constraint
 UNION ALL SELECT 'pg_trigger'::regclass::oid,oid FROM pg_trigger
 UNION ALL SELECT 'pg_policy'::regclass::oid,oid FROM pg_policy
 UNION ALL SELECT 'pg_attrdef'::regclass::oid,oid FROM pg_attrdef
 UNION ALL SELECT 'pg_publication_rel'::regclass::oid,oid FROM pg_publication_rel
 UNION ALL SELECT 'pg_publication'::regclass::oid,oid FROM pg_publication
 UNION ALL SELECT 'pg_extension'::regclass::oid,oid FROM pg_extension
 UNION ALL SELECT 'pg_event_trigger'::regclass::oid,oid FROM pg_event_trigger
 UNION ALL SELECT 'pg_namespace'::regclass::oid,oid FROM pg_namespace
 ) all_objects
 WHERE NOT EXISTS(SELECT 1 FROM oa5_closure c WHERE c.classid=all_objects.classid AND c.objid=all_objects.objid);
DO $oa5$
DECLARE r record; targets text;
BEGIN
 FOR r IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('auth','storage','cron','vault','supabase_migrations') AND c.relkind IN ('r','p')
 LOOP
 EXECUTE format('INSERT INTO pg_temp.oa5_managed_before SELECT %L,%L,encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text COLLATE "C")::text,''[]''),''UTF8'')),''hex'') FROM %I.%I t',r.nspname,r.relname,r.nspname,r.relname);
 END LOOP;
 IF (SELECT count(*) FROM oa5_managed_before)<>41 THEN RAISE EXCEPTION 'Managed table census changed'; END IF;
 -- Scope was fingerprinted above. No broad schema or managed object drop.
 SELECT string_agg(format('%I.%I',n.nspname,c.relname),', ' ORDER BY n.nspname,c.relname)
 INTO targets FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','sellertray_private') AND c.relkind IN ('r','p');
 IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','sellertray_private') AND c.relkind IN ('r','p'))<>140 THEN RAISE EXCEPTION 'Table root drift'; END IF;
 EXECUTE 'DROP TABLE '||targets||' CASCADE';
 SELECT string_agg(format('%I.%I(%s)',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),', ' ORDER BY n.nspname,p.proname,p.oid)
 INTO targets FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','sellertray_private');
 IF targets IS NOT NULL THEN EXECUTE 'DROP ROUTINE '||targets||' CASCADE'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','sellertray_private') AND c.relkind IN ('r','p','v','m','S','f'))
 OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','sellertray_private'))
 THEN RAISE EXCEPTION 'Application objects remain'; END IF;
 FOR r IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('auth','storage','cron','vault','supabase_migrations') AND c.relkind IN ('r','p')
 LOOP
 EXECUTE format('INSERT INTO pg_temp.oa5_managed_after SELECT %L,%L,encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text COLLATE "C")::text,''[]''),''UTF8'')),''hex'') FROM %I.%I t',r.nspname,r.relname,r.nspname,r.relname);
 END LOOP;
 IF EXISTS(SELECT * FROM oa5_managed_before EXCEPT SELECT * FROM oa5_managed_after)
 OR EXISTS(SELECT * FROM oa5_managed_after EXCEPT SELECT * FROM oa5_managed_before)
 OR EXISTS(SELECT 1 FROM net.http_request_queue)
 THEN RAISE EXCEPTION 'Managed data changed'; END IF;
END $oa5$;
-- Confirm none of the snapshotted outside-closure objects disappeared.
DO $oa5$
BEGIN
 IF EXISTS(SELECT classid,objid FROM oa5_catalog_before EXCEPT
 SELECT classid,objid FROM (
 SELECT 'pg_class'::regclass::oid classid,oid objid FROM pg_class
 UNION ALL SELECT 'pg_proc'::regclass::oid,oid FROM pg_proc
 UNION ALL SELECT 'pg_type'::regclass::oid,oid FROM pg_type
 UNION ALL SELECT 'pg_constraint'::regclass::oid,oid FROM pg_constraint
 UNION ALL SELECT 'pg_trigger'::regclass::oid,oid FROM pg_trigger
 UNION ALL SELECT 'pg_policy'::regclass::oid,oid FROM pg_policy
 UNION ALL SELECT 'pg_attrdef'::regclass::oid,oid FROM pg_attrdef
 UNION ALL SELECT 'pg_publication_rel'::regclass::oid,oid FROM pg_publication_rel
 UNION ALL SELECT 'pg_publication'::regclass::oid,oid FROM pg_publication
 UNION ALL SELECT 'pg_extension'::regclass::oid,oid FROM pg_extension
 UNION ALL SELECT 'pg_event_trigger'::regclass::oid,oid FROM pg_event_trigger
 UNION ALL SELECT 'pg_namespace'::regclass::oid,oid FROM pg_namespace
 ) after_objects)
 THEN RAISE EXCEPTION 'Outside-closure catalog object missing'; END IF;
END $oa5$;
ROLLBACK;
SELECT 'HOSTED_RETIREMENT_ROLLBACK_PROBE=PASS' AS result;
