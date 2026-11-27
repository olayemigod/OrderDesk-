-- Read-only dependency closure for Method B retirement review. No SQL writes.
-- pg_depend traversal is a catalog approximation, not a DROP simulation.
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
), summary AS (
 SELECT category,type,coalesce(schema,'(none)') schema,count(*) AS count FROM described GROUP BY 1,2,3
)
SELECT (SELECT count(*) FROM roots) root_count,
 (SELECT count(*) FROM described) closure_count,
 (SELECT count(*) FROM described WHERE category='unclassified') unclassified_count,
 (SELECT count(*) FROM described x JOIN pg_depend d ON d.classid=x.classid AND d.objid=x.objid WHERE d.deptype='e') extension_membership_count,
 (SELECT count(*) FROM described x JOIN pg_depend d ON d.classid=x.classid AND d.objid=x.objid WHERE d.deptype='i' AND NOT EXISTS(SELECT 1 FROM closure c WHERE c.classid=d.refclassid AND c.objid=d.refobjid)) internal_owner_outside_closure,
 (SELECT jsonb_agg(to_jsonb(s) ORDER BY category,type,schema) FROM summary s) counts,
 encode(sha256(convert_to((SELECT jsonb_agg(jsonb_build_array(classid,objid,type,schema,identity,category) ORDER BY classid,objid)::text FROM described),'UTF8')),'hex') AS live_catalog_fingerprint,
 false AS destructive_execution_authorized;
