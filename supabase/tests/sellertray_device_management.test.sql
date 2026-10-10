begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(12);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='save_sellertray_register' and p.prosecdef=true
  ),
  'register management command exists and is security definer'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_sellertray_device_management_overview' and p.prosecdef=true
  ),
  'device management read model exists and is security definer'
);

select extensions.ok(
  has_function_privilege('authenticated','public.save_sellertray_register(uuid,uuid,uuid,text,text,boolean,boolean)','EXECUTE')
  and has_function_privilege('authenticated','public.get_sellertray_device_management_overview(uuid,uuid)','EXECUTE'),
  'authenticated management sessions can call device management commands'
);

select extensions.ok(
  not has_function_privilege('anon','public.save_sellertray_register(uuid,uuid,uuid,text,text,boolean,boolean)','EXECUTE')
  and not has_function_privilege('anon','public.get_sellertray_device_management_overview(uuid,uuid)','EXECUTE'),
  'anonymous users cannot call device management commands'
);

select extensions.ok(
  not has_table_privilege('authenticated','public.sellertray_registers','INSERT')
  and not has_table_privilege('authenticated','public.sellertray_registers','UPDATE')
  and not has_table_privilege('authenticated','public.sellertray_registers','DELETE'),
  'browser sessions cannot bypass governed register writes'
);

select extensions.ok(
  not has_table_privilege('authenticated','public.sellertray_printers','INSERT')
  and not has_table_privilege('authenticated','public.sellertray_printers','UPDATE')
  and not has_table_privilege('authenticated','public.sellertray_printers','DELETE'),
  'browser sessions cannot bypass governed printer writes'
);

select extensions.ok(
  not has_table_privilege('authenticated','public.sellertray_print_jobs','INSERT')
  and not has_table_privilege('authenticated','public.sellertray_print_jobs','UPDATE')
  and not has_table_privilege('authenticated','public.sellertray_print_jobs','DELETE'),
  'browser sessions cannot mutate print-job lifecycle directly'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='save_sellertray_register'
      and lower(pg_get_functiondef(p.oid)) like '%orderdesk_subscription_can_write%'
      and lower(pg_get_functiondef(p.oid)) like '%can_manage_devices%'
      and lower(pg_get_functiondef(p.oid)) like '%owner%'
      and lower(pg_get_functiondef(p.oid)) like '%manager%'
  ),
  'register writes require management role, subscription write state and device capability'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='save_sellertray_register'
      and lower(pg_get_functiondef(p.oid)) like '%default register must remain active%'
      and lower(pg_get_functiondef(p.oid)) like '%choose another default register%'
      and lower(pg_get_functiondef(p.oid)) like '%register branch cannot be changed%'
  ),
  'register command protects default, active and Branch invariants'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_sellertray_device_management_overview'
      and lower(pg_get_functiondef(p.oid)) like '%can_manage_devices%'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_user_can_operate_branch%'
  ),
  'device management read model is Branch and capability scoped'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_sellertray_device_management_overview'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_print_jobs%'
      and lower(pg_get_functiondef(p.oid)) like '%limit 50%'
      and lower(pg_get_functiondef(p.oid)) like '%failure_message%'
  ),
  'device management read model includes bounded print-job history'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_sellertray_device_management_overview'
      and lower(pg_get_functiondef(p.oid)) like '%registers%'
      and lower(pg_get_functiondef(p.oid)) like '%printers%'
      and lower(pg_get_functiondef(p.oid)) like '%recentjobs%'
  ),
  'device management read model returns registers, printers and recent jobs'
);

select * from extensions.finish();
rollback;
