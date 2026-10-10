begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(9);

select extensions.ok(
  to_regclass('public.sellertray_ai_brief_attempts') is not null,
  'AI Brief telemetry table exists'
);

select extensions.ok(
  not has_table_privilege('authenticated','public.sellertray_ai_brief_attempts','SELECT')
  and not has_table_privilege('authenticated','public.sellertray_ai_brief_attempts','INSERT')
  and not has_table_privilege('authenticated','public.sellertray_ai_brief_attempts','UPDATE')
  and not has_table_privilege('authenticated','public.sellertray_ai_brief_attempts','DELETE'),
  'browser/mobile sessions cannot read or mutate raw AI Brief telemetry'
);

select extensions.ok(
  has_function_privilege('authenticated','public.get_sellertray_ai_brief_usage(uuid)','EXECUTE')
  and not has_function_privilege('anon','public.get_sellertray_ai_brief_usage(uuid)','EXECUTE'),
  'AI Brief usage summary is authenticated but not anonymous'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_sellertray_ai_brief_usage'
      and lower(pg_get_functiondef(p.oid)) like '%owner%'
      and lower(pg_get_functiondef(p.oid)) like '%manager%'
  ),
  'AI Brief usage summary is management-only'
);

select extensions.ok(
  exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='sellertray_ai_brief_attempts'
      and t.tgname='prevent_sellertray_ai_brief_attempt_update'
      and not t.tgisinternal
  ),
  'AI Brief telemetry update is blocked by an immutability trigger'
);

select extensions.ok(
  exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='sellertray_ai_brief_attempts'
      and t.tgname='prevent_sellertray_ai_brief_attempt_delete'
      and not t.tgisinternal
  ),
  'AI Brief telemetry direct delete is blocked by an immutability trigger'
);

select extensions.ok(
  exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='sellertray_ai_brief_attempts'
      and column_name='context_fingerprint'
  )
  and not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='sellertray_ai_brief_attempts'
      and column_name in ('prompt','question','context','response','report_payload')
  ),
  'AI Brief telemetry keeps a context fingerprint without storing prompt/report text'
);

select extensions.ok(
  exists (
    select 1 from pg_constraint con
    join pg_class c on c.oid=con.conrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='sellertray_ai_brief_attempts'
      and con.contype='f' and con.confdeltype='c'
      and pg_get_constraintdef(con.oid) like '%tenant_id%tenants%'
  ),
  'AI Brief telemetry follows governed Tenant deletion lifecycle'
);

select extensions.ok(
  exists (
    select 1 from pg_indexes
    where schemaname='public' and tablename='sellertray_ai_brief_attempts'
      and indexname='sellertray_ai_brief_attempts_provider_budget_idx'
  ),
  'AI Brief provider-call budget has an indexed tenant/time path'
);

select * from extensions.finish();
rollback;
