begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(14);

select extensions.ok(
  exists (
    select 1 from information_schema.columns
    where table_schema='public'
      and table_name='sellertray_shift_cash_movements'
      and column_name='command_id_hash'
      and data_type='text'
  ),
  'cash movement ledger stores retry command hashes'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint c
    where c.conrelid='public.sellertray_shift_cash_movements'::regclass
      and c.conname='sellertray_shift_cash_movements_command_hash_check'
      and pg_get_constraintdef(c.oid) like '%[0-9a-f]{32}%'
  ),
  'cash movement command hash format is constrained'
);

select extensions.ok(
  exists (
    select 1 from pg_indexes
    where schemaname='public'
      and tablename='sellertray_shift_cash_movements'
      and indexname='sellertray_shift_cash_movements_command_unique'
      and lower(indexdef) like '%unique%'
      and lower(indexdef) like '%tenant_id%'
      and lower(indexdef) like '%command_id_hash%'
  ),
  'cash movement command hash is tenant-scoped and unique'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='record_sellertray_shift_cash_movement'
  ),
  2,
  'cash movement runtime exposes explicit-command and compatibility overloads'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='record_sellertray_shift_cash_movement'
      and p.prosecdef=true
  ),
  2,
  'cash movement runtime overloads are security definer functions'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='record_sellertray_shift_cash_movement'
      and coalesce(p.proconfig,'{}'::text[]) @> array['search_path=""']::text[]
  ),
  2,
  'cash movement runtime overloads pin an empty search path'
);

select extensions.ok(
  has_function_privilege('service_role','public.record_sellertray_shift_cash_movement(uuid,uuid,text,numeric,text,text,text,text,uuid)','EXECUTE')
  and has_function_privilege('service_role','public.record_sellertray_shift_cash_movement(uuid,uuid,text,numeric,text,text,text,uuid)','EXECUTE'),
  'service role can execute cash movement runtime overloads'
);

select extensions.ok(
  not has_function_privilege('anon','public.record_sellertray_shift_cash_movement(uuid,uuid,text,numeric,text,text,text,text,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.record_sellertray_shift_cash_movement(uuid,uuid,text,numeric,text,text,text,text,uuid)','EXECUTE')
  and not has_function_privilege('public','public.record_sellertray_shift_cash_movement(uuid,uuid,text,numeric,text,text,text,text,uuid)','EXECUTE'),
  'explicit cash movement command is not directly client executable'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='record_sellertray_shift_cash_movement'
      and pg_get_function_identity_arguments(p.oid) like '%p_command_id text%'
      and lower(pg_get_functiondef(p.oid)) like '%orderdesk_subscription_can_write%'
  ),
  'cash movement command enforces writable subscription authority'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='record_sellertray_shift_cash_movement'
      and pg_get_function_identity_arguments(p.oid) like '%p_command_id text%'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_user_can_operate_branch%'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_user_has_capability%'
      and lower(pg_get_functiondef(p.oid)) like '%staff can record cash activity only in their own open shift%'
  ),
  'cash movement command preserves branch, capability and staff-shift authority'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='record_sellertray_shift_cash_movement'
      and pg_get_function_identity_arguments(p.oid) like '%p_command_id text%'
      and regexp_replace(lower(pg_get_functiondef(p.oid)), '\s+', '', 'g') like '%md5(p_tenant_id::text||''|''||v_command_id)%'
      and lower(pg_get_functiondef(p.oid)) like '%command_id_hash=v_command_hash%'
      and lower(pg_get_functiondef(p.oid)) like '%idempotentreplay%'
  ),
  'cash movement retry identity is tenant-scoped and replay aware'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='record_sellertray_shift_cash_movement'
      and pg_get_function_identity_arguments(p.oid) like '%p_command_id text%'
      and lower(pg_get_functiondef(p.oid)) like '%reference is already used for different facts%'
      and lower(pg_get_functiondef(p.oid)) like '%lower(btrim(m.reference))=lower(v_reference)%'
  ),
  'merchant-facing cash reference remains a separate duplicate boundary'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='record_sellertray_shift_cash_movement'
      and pg_get_function_identity_arguments(p.oid) like '%p_command_id text%'
      and lower(pg_get_functiondef(p.oid)) like '%cannot take expected drawer cash below zero%'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_cash_shift_totals%'
  ),
  'cash out and expense commands protect expected drawer cash'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='record_sellertray_shift_cash_movement'
      and pg_get_function_identity_arguments(p.oid) not like '%p_command_id text%'
      and lower(pg_get_functiondef(p.oid)) like '%internal:%'
      and lower(pg_get_functiondef(p.oid)) like '%pg_catalog.md5%'
  ),
  'compatibility overload delegates with deterministic internal retry identity'
);

select * from extensions.finish();
rollback;
