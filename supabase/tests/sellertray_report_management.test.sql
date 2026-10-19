begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(14);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='get_sellertray_report_management'
      and p.prosecdef=true
      and p.provolatile='s'
  ),
  'Management Report Center read model exists as stable security definer'
);

select extensions.ok(
  has_function_privilege('authenticated','public.get_sellertray_report_management(uuid,date,date,uuid,text,text)','EXECUTE')
  and has_function_privilege('service_role','public.get_sellertray_report_management(uuid,date,date,uuid,text,text)','EXECUTE')
  and not has_function_privilege('anon','public.get_sellertray_report_management(uuid,date,date,uuid,text,text)','EXECUTE'),
  'Management Report Center is executable by authenticated/server sessions but not anonymous users'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_sellertray_report_management'
      and lower(pg_get_functiondef(p.oid)) like '%auth.uid%'
      and lower(pg_get_functiondef(p.oid)) like '%owner%manager%'
      and lower(pg_get_functiondef(p.oid)) like '%can_view_reports%'
  ),
  'Management Report Center requires authenticated Owner or Manager report authority'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_sellertray_report_management'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_user_can_read_report_branch%'
  ),
  'Management Report Center preserves report Branch visibility authority'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_sellertray_report_management'
      and lower(pg_get_functiondef(p.oid)) like '%p_date_from%'
      and lower(pg_get_functiondef(p.oid)) like '%p_date_to%'
      and lower(pg_get_functiondef(p.oid)) like '%at time zone v_timezone%'
  ),
  'Management Report Center uses exact business-timezone date ranges'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_sellertray_report_management'
      and lower(pg_get_functiondef(p.oid)) like '%status=''completed''%'
      and lower(pg_get_functiondef(p.oid)) like '%deleted_at is null%'
  ),
  'Sales performance excludes drafts/deleted orders and uses completed sales'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_sellertray_report_management'
      and lower(pg_get_functiondef(p.oid)) like '%p_branch_id%'
      and lower(pg_get_functiondef(p.oid)) like '%p_source%'
      and lower(pg_get_functiondef(p.oid)) like '%p_payment_method%'
  ),
  'Management Report Center exposes governed Branch, source and payment-method filters'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_sellertray_report_management'
      and lower(pg_get_functiondef(p.oid)) like '%branchperformance%'
      and lower(pg_get_functiondef(p.oid)) like '%salestrend%'
      and lower(pg_get_functiondef(p.oid)) like '%channels%'
      and lower(pg_get_functiondef(p.oid)) like '%paymentmethods%'
  ),
  'Management Report Center returns stable core performance breakdowns'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_sellertray_report_management'
      and lower(pg_get_functiondef(p.oid)) like '%topcustomers%'
      and lower(pg_get_functiondef(p.oid)) like '%topproducts%'
      and lower(pg_get_functiondef(p.oid)) like '%categoryperformance%'
      and lower(pg_get_functiondef(p.oid)) like '%staffperformance%'
  ),
  'Management Report Center returns customer, product, category and staff analysis'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_sellertray_report_management'
      and lower(pg_get_functiondef(p.oid)) like '%stock_quantity%'
      and lower(pg_get_functiondef(p.oid)) like '%stockuom%'
  ),
  'Product ranking uses Stock-UOM quantity rather than mixed selling UOM quantities'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_sellertray_report_management'
      and lower(pg_get_functiondef(p.oid)) like '%verificationrequired%'
      and lower(pg_get_functiondef(p.oid)) like '%paymentissues%'
      and lower(pg_get_functiondef(p.oid)) like '%awaitingfulfillment%'
  ),
  'Management dashboard reports governed payment and fulfilment attention items'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_sellertray_report_management'
      and lower(pg_get_functiondef(p.oid)) like '%openshifts%'
      and lower(pg_get_functiondef(p.oid)) like '%cashvariancebranches%'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_cash_shifts%'
  ),
  'Management dashboard reports governed cashier attention items'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_sellertray_report_management'
      and lower(pg_get_functiondef(p.oid)) like '%get_sellertray_branch_stock_as_of%'
      and lower(pg_get_functiondef(p.oid)) like '%lowstockitems%'
      and lower(pg_get_functiondef(p.oid)) like '%outofstockitems%'
      and lower(pg_get_functiondef(p.oid)) like '%opentransfers%'
  ),
  'Management dashboard reuses governed stock ledger reads for inventory attention'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_sellertray_report_management'
      and lower(pg_get_functiondef(p.oid)) not like '%update public.%'
      and lower(pg_get_functiondef(p.oid)) not like '%insert into public.%'
      and lower(pg_get_functiondef(p.oid)) not like '%delete from public.%'
  ),
  'Management Report Center is read-only and does not mutate commercial facts'
);

select * from extensions.finish();
rollback;
