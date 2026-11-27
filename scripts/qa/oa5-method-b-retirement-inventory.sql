-- Read-only Method B inventory. No drop statements or authorization.
-- Run only on nominated Test or its disposable restored copy.
WITH app AS (
 SELECT oid,nspname FROM pg_namespace WHERE nspname IN ('public','sellertray_private')
), objects AS (
 SELECT 'relation' AS kind,n.nspname AS schema,format('%I.%I',n.nspname,c.relname) AS identity,
 c.relkind::text AS subtype,pg_get_userbyid(c.relowner) AS owner,
 EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e') AS extension_owned
 FROM pg_class c JOIN app n ON n.oid=c.relnamespace WHERE c.relkind NOT IN ('i','I','t')
 UNION ALL
 SELECT 'routine',n.nspname,format('%I.%I(%s)',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),
 p.prokind::text,pg_get_userbyid(p.proowner),
 EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')
 FROM pg_proc p JOIN app n ON n.oid=p.pronamespace
 UNION ALL
 SELECT 'standalone_type',n.nspname,format('%I.%I',n.nspname,t.typname),t.typtype::text,pg_get_userbyid(t.typowner),
 EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_type'::regclass AND d.objid=t.oid AND d.deptype='e')
 FROM pg_type t JOIN app n ON n.oid=t.typnamespace WHERE t.typrelid=0 AND t.typelem=0
), refs AS (
 SELECT 'pg_class'::regclass::oid AS classid,c.oid AS objid FROM pg_class c WHERE relnamespace IN (SELECT oid FROM app)
 UNION SELECT 'pg_proc'::regclass::oid,p.oid FROM pg_proc p WHERE pronamespace IN (SELECT oid FROM app)
 UNION SELECT 'pg_type'::regclass::oid,t.oid FROM pg_type t WHERE typnamespace IN (SELECT oid FROM app)
), deps AS (
 SELECT DISTINCT d.classid,d.objid,d.objsubid,d.deptype FROM pg_depend d JOIN refs r ON r.classid=d.refclassid AND r.objid=d.refobjid
), policies AS (
 SELECT DISTINCT n.nspname AS schema,c.relname AS relation,p.polname AS policy
 FROM deps d JOIN pg_policy p ON d.classid='pg_policy'::regclass AND d.objid=p.oid
 JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.oid NOT IN (SELECT oid FROM app)
), fks AS (
 SELECT cn.nspname AS child_schema,child.relname AS child_table,pn.nspname AS parent_schema,parent.relname AS parent_table,c.conname AS constraint_name
 FROM pg_constraint c JOIN pg_class child ON child.oid=c.conrelid JOIN pg_namespace cn ON cn.oid=child.relnamespace
 JOIN pg_class parent ON parent.oid=c.confrelid JOIN pg_namespace pn ON pn.oid=parent.relnamespace
 WHERE c.contype='f' AND (cn.oid IN (SELECT oid FROM app)) <> (pn.oid IN (SELECT oid FROM app))
), triggers AS (
 SELECT rn.nspname AS relation_schema,c.relname AS relation,t.tgname AS trigger_name,pn.nspname AS routine_schema,p.proname AS routine
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace rn ON rn.oid=c.relnamespace
 JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace
 WHERE NOT t.tgisinternal AND (rn.oid IN (SELECT oid FROM app)) <> (pn.oid IN (SELECT oid FROM app))
), publications AS (
 SELECT p.pubname AS publication,n.nspname AS schema,c.relname AS relation
 FROM pg_publication_rel pr JOIN pg_publication p ON p.oid=pr.prpubid
 JOIN pg_class c ON c.oid=pr.prrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.oid IN (SELECT oid FROM app)
), inventory AS (
 SELECT jsonb_build_object(
 'objects',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY kind,schema,identity),'[]') FROM objects o),
 'external_policies',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY schema,relation,policy),'[]') FROM policies p),
 'external_fks',(SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY child_schema,child_table,constraint_name),'[]') FROM fks f),
 'external_triggers',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY relation_schema,relation,trigger_name),'[]') FROM triggers t),
 'publication_members',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY publication,schema,relation),'[]') FROM publications p),
 'dependency_classes',(SELECT jsonb_agg(to_jsonb(g) ORDER BY class_name,deptype) FROM
 (SELECT classid::regclass::text AS class_name,deptype,count(*) AS count FROM deps GROUP BY 1,2) g)
 ) AS manifest
)
SELECT encode(extensions.digest(convert_to(manifest::text,'UTF8'),'sha256'),'hex') AS inventory_sha256,
 (SELECT count(*) FROM objects) AS object_count,
 (SELECT count(*) FROM objects WHERE extension_owned) AS extension_owned_count,
 (SELECT count(*) FROM objects WHERE owner<>'postgres') AS non_postgres_owner_count,
 (SELECT count(*) FROM fks) AS cross_boundary_fk_count,
 (SELECT count(*) FROM fks WHERE parent_schema IN ('public','sellertray_private')) AS inbound_fk_count,
 manifest->'external_policies' AS external_policies,
 manifest->'external_triggers' AS external_triggers,
 manifest->'publication_members' AS publication_members,
 false AS destructive_execution_authorized
FROM inventory;
