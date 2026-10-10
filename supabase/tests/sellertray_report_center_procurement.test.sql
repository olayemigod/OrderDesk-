begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(14);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='sellertray_report_center' and p.prosecdef=true
  ),
  'Report Center remains a security-definer management read model'
);

select extensions.ok(
  has_function_privilege('authenticated','public.sellertray_report_center(uuid,integer)','EXECUTE')
  and not has_function_privilege('anon','public.sellertray_report_center(uuid,integer)','EXECUTE'),
  'authenticated management can execute Report Center while anonymous users cannot'
);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='sellertray_report_center'
      and lower(pg_get_functiondef(p.oid)) like '%owner%manager%'
      and lower(pg_get_functiondef(p.oid)) like '%owner or manager access is required for business reports%'
  ),
  'Report Center remains restricted to Owner and Manager roles'
);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='sellertray_report_center'
      and regexp_replace(lower(pg_get_functiondef(p.oid)), '\s+', '', 'g') like '%greatest(1,least(coalesce(p_days,30),365))%'
      and regexp_replace(lower(pg_get_functiondef(p.oid)), '\s+', '', 'g') like '%make_interval(days=>v_days)%'
  ),
  'Report Center procurement uses the shared bounded report period'
);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='sellertray_report_center'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_purchase_orders%'
      and lower(pg_get_functiondef(p.oid)) like '%procurementsummary%'
      and lower(pg_get_functiondef(p.oid)) like '%purchasevalue%'
      and lower(pg_get_functiondef(p.oid)) like '%receivedvalue%'
  ),
  'Report Center includes purchase and receiving summary metrics'
);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='sellertray_report_center'
      and lower(pg_get_functiondef(p.oid)) like '%supplierpaidvalue%'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_supplier_payments%'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_supplier_payment_reversals%'
      and lower(pg_get_functiondef(p.oid)) like '%not exists%'
  ),
  'supplier paid reporting excludes reversed payment evidence'
);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='sellertray_report_center'
      and lower(pg_get_functiondef(p.oid)) like '%supplieroutstanding%'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_purchase_paid_amount%'
      and lower(pg_get_functiondef(p.oid)) like '%ordered%partially_received%received%'
  ),
  'current supplier outstanding is derived from placed purchases and effective payments'
);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='sellertray_report_center'
      and lower(pg_get_functiondef(p.oid)) like '%purchasestatus%'
      and lower(pg_get_functiondef(p.oid)) like '%draft%'
      and lower(pg_get_functiondef(p.oid)) like '%partially_received%'
      and lower(pg_get_functiondef(p.oid)) like '%cancelled%'
  ),
  'Report Center exposes Purchase Order lifecycle distribution'
);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='sellertray_report_center'
      and lower(pg_get_functiondef(p.oid)) like '%branchprocurement%'
      and lower(pg_get_functiondef(p.oid)) like '%branchid%'
      and lower(pg_get_functiondef(p.oid)) like '%receivedpurchaseorders%'
  ),
  'Report Center compares procurement and receiving by Branch'
);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='sellertray_report_center'
      and lower(pg_get_functiondef(p.oid)) like '%get_sellertray_supplier_outstanding_summary%'
      and lower(pg_get_functiondef(p.oid)) like '%suppliername%'
      and lower(pg_get_functiondef(p.oid)) like '%outstandingamount%'
  ),
  'Report Center reuses shared supplier outstanding state rather than recalculating in the browser'
);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='sellertray_report_center'
      and regexp_replace(lower(pg_get_functiondef(p.oid)), '\s+', '', 'g') like '%po.created_at>=v_since%'
      and regexp_replace(lower(pg_get_functiondef(p.oid)), '\s+', '', 'g') like '%p.paid_at>=v_since%'
  ),
  'period procurement and supplier-payment activity are date bounded server-side'
);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='sellertray_report_center'
      and lower(pg_get_functiondef(p.oid)) like '%branchperformance%'
      and lower(pg_get_functiondef(p.oid)) like '%salestrend%'
      and lower(pg_get_functiondef(p.oid)) like '%paymentmethods%'
      and lower(pg_get_functiondef(p.oid)) like '%topcustomers%'
  ),
  'existing sales, cash, payment and customer report payload remains present'
);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='sellertray_report_center'
      and lower(pg_get_functiondef(p.oid)) like '%purchaseorders%'
      and lower(pg_get_functiondef(p.oid)) like '%receivedpurchaseorders%'
      and lower(pg_get_functiondef(p.oid)) like '%purchasecount%'
  ),
  'procurement payload retains both activity counts and supplier purchase counts'
);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='sellertray_report_center'
      and lower(pg_get_functiondef(p.oid)) not like '%insert into%'
      and lower(pg_get_functiondef(p.oid)) not like '%update public.%'
      and lower(pg_get_functiondef(p.oid)) not like '%delete from%'
  ),
  'Report Center procurement remains read-only'
);

select * from extensions.finish();
rollback;