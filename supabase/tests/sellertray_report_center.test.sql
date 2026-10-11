begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(8);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='sellertray_report_center' and p.prosecdef=true
  ),
  'Report Center read model exists and is security definer'
);

select extensions.ok(
  has_function_privilege('authenticated','public.sellertray_report_center(uuid,integer)','EXECUTE')
  and has_function_privilege('service_role','public.sellertray_report_center(uuid,integer)','EXECUTE')
  and not has_function_privilege('anon','public.sellertray_report_center(uuid,integer)','EXECUTE'),
  'Report Center is available to authenticated/server sessions but not anonymous users'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='sellertray_report_center'
      and lower(pg_get_functiondef(p.oid)) like '%owner%'
      and lower(pg_get_functiondef(p.oid)) like '%manager%'
      and lower(pg_get_functiondef(p.oid)) like '%auth.uid%'
  ),
  'Report Center enforces management membership'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='sellertray_report_center'
      and lower(pg_get_functiondef(p.oid)) like '%greatest(1%'
      and lower(pg_get_functiondef(p.oid)) like '%365%'
  ),
  'Report Center period is bounded between one and 365 days'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='sellertray_report_center'
      and lower(pg_get_functiondef(p.oid)) like '%branchperformance%'
      and lower(pg_get_functiondef(p.oid)) like '%cashvariance%'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_cash_shifts%'
  ),
  'Report Center includes Branch and cashier comparison'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='sellertray_report_center'
      and lower(pg_get_functiondef(p.oid)) like '%salestrend%'
      and lower(pg_get_functiondef(p.oid)) like '%channels%'
      and lower(pg_get_functiondef(p.oid)) like '%paymentmethods%'
  ),
  'Report Center includes sales trend, channel and payment breakdowns'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='sellertray_report_center'
      and lower(pg_get_functiondef(p.oid)) like '%topcustomers%'
      and lower(pg_get_functiondef(p.oid)) like '%limit 10%'
  ),
  'Report Center customer ranking is bounded'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='sellertray_report_center'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_report_summary%'
      and lower(pg_get_functiondef(p.oid)) like '%order_payments%'
      and lower(pg_get_functiondef(p.oid)) like '%orders%'
  ),
  'Report Center reuses shared SellerTray reporting and commercial facts'
);

select * from extensions.finish();
rollback;
