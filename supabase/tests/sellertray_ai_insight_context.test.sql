begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(14);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='sellertray_ai_insight_context' and p.prosecdef=true
  ),
  'AI insight context is a security-definer governed read model'
);

select extensions.ok(
  has_function_privilege('authenticated','public.sellertray_ai_insight_context(uuid,integer)','EXECUTE')
  and not has_function_privilege('anon','public.sellertray_ai_insight_context(uuid,integer)','EXECUTE'),
  'authenticated users may request AI context while anonymous users may not'
);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='sellertray_ai_insight_context'
      and lower(pg_get_functiondef(p.oid)) like '%owner%manager%'
      and lower(pg_get_functiondef(p.oid)) like '%owner or manager access is required for sellertray ai insights%'
  ),
  'AI insight context is management-only'
);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='sellertray_ai_insight_context'
      and regexp_replace(lower(pg_get_functiondef(p.oid)), '\s+', '', 'g') like '%greatest(1,least(coalesce(p_days,30),365))%'
      and regexp_replace(lower(pg_get_functiondef(p.oid)), '\s+', '', 'g') like '%make_interval(days=>v_days)%'
  ),
  'AI context period is bounded to 1 through 365 days'
);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='sellertray_ai_insight_context'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_report_center%'
      and lower(pg_get_functiondef(p.oid)) like '%report%'
  ),
  'AI context reuses the shared Report Center rather than duplicating business totals'
);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='sellertray_ai_insight_context'
      and lower(pg_get_functiondef(p.oid)) like '%stock_quantity%'
      and lower(pg_get_functiondef(p.oid)) like '%accepted%processing%ready%completed%'
      and lower(pg_get_functiondef(p.oid)) like '%limit 20%'
  ),
  'top product velocity is Stock-UOM normalized, confirmed-order scoped, and bounded'
);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='sellertray_ai_insight_context'
      and lower(pg_get_functiondef(p.oid)) like '%get_sellertray_low_stock%'
      and lower(pg_get_functiondef(p.oid)) like '%b.is_active=true%'
      and lower(pg_get_functiondef(p.oid)) like '%limit 50%'
  ),
  'AI low-stock context reuses governed Branch policy and is bounded to active Branches'
);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='sellertray_ai_insight_context'
      and lower(pg_get_functiondef(p.oid)) not like '%insert into%'
      and lower(pg_get_functiondef(p.oid)) not like '%update public.%'
      and lower(pg_get_functiondef(p.oid)) not like '%delete from%'
  ),
  'AI context function is read-only'
);

select extensions.ok(
  exists(select 1 from information_schema.tables where table_schema='public' and table_name='sellertray_ai_insight_attempts')
  and not has_table_privilege('authenticated','public.sellertray_ai_insight_attempts','SELECT')
  and not has_table_privilege('authenticated','public.sellertray_ai_insight_attempts','INSERT')
  and not has_table_privilege('anon','public.sellertray_ai_insight_attempts','SELECT'),
  'AI insight telemetry is server-only'
);

select extensions.is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema='public' and table_name='sellertray_ai_insight_attempts'
      and column_name in ('question','prompt','answer','response_text')
  ),
  0,
  'AI telemetry does not persist merchant questions or generated answers'
);

select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.record_sellertray_ai_insight_attempt(uuid,uuid,uuid,text,text,integer,integer,integer,integer,integer,integer,integer,integer,integer)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.record_sellertray_ai_insight_attempt(uuid,uuid,uuid,text,text,integer,integer,integer,integer,integer,integer,integer,integer,integer)',
    'EXECUTE'
  ),
  'AI telemetry recording is service-only'
);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='record_sellertray_ai_insight_attempt'
      and lower(pg_get_functiondef(p.oid)) like '%tenant_members%'
      and lower(pg_get_functiondef(p.oid)) like '%on conflict%request_id%do nothing%'
  ),
  'AI telemetry verifies membership and is request-id idempotent'
);

select extensions.ok(
  exists(
    select 1 from pg_constraint c
    join pg_class t on t.oid=c.conrelid
    join pg_namespace n on n.oid=t.relnamespace
    where n.nspname='public' and t.relname='sellertray_ai_insight_attempts'
      and c.contype='c' and pg_get_constraintdef(c.oid) like '%context_days%365%'
  ),
  'AI telemetry keeps the same bounded context-period contract'
);

select extensions.ok(
  exists(
    select 1 from pg_constraint c
    join pg_class t on t.oid=c.conrelid
    join pg_namespace n on n.oid=t.relnamespace
    where n.nspname='public' and t.relname='sellertray_ai_insight_attempts'
      and c.contype='c' and pg_get_constraintdef(c.oid) like '%question_length%1200%'
  ),
  'AI telemetry enforces a bounded merchant question length'
);

select * from extensions.finish();
rollback;