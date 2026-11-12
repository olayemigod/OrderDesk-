begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(23);

-- Synthetic accounts and rows exist inside this rolled-back database CI transaction.
create temp table profitability_fixture (
  tenant_id uuid default gen_random_uuid(),
  owner_id uuid default gen_random_uuid(),
  manager_id uuid default gen_random_uuid(),
  staff_id uuid default gen_random_uuid(),
  outsider_id uuid default gen_random_uuid(),
  customer_id uuid default gen_random_uuid(),
  branch_a uuid default gen_random_uuid(),
  branch_b uuid default gen_random_uuid()
) on commit drop;
insert into profitability_fixture default values;

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_id,'profit-owner-'||owner_id||'@example.com','authenticated','authenticated',now(),now() from profitability_fixture
union all select manager_id,'profit-manager-'||manager_id||'@example.com','authenticated','authenticated',now(),now() from profitability_fixture
union all select staff_id,'profit-staff-'||staff_id||'@example.com','authenticated','authenticated',now(),now() from profitability_fixture
union all select outsider_id,'profit-outsider-'||outsider_id||'@example.com','authenticated','authenticated',now(),now() from profitability_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'Profitability QA','profit-qa-'||tenant_id,'PFQ','active' from profitability_fixture;
update public.tenant_subscriptions
  set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from profitability_fixture);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_id,'owner' from profitability_fixture
union all select tenant_id,manager_id,'manager' from profitability_fixture
union all select tenant_id,staff_id,'staff' from profitability_fixture;
insert into public.tenant_member_capabilities(tenant_id,user_id,capability,allowed,granted_by)
select tenant_id,staff_id,'can_view_reports',true,owner_id from profitability_fixture;

insert into public.branches(id,tenant_id,code,name,is_default,is_active)
select branch_a,tenant_id,'PRO-A','Profit Branch A',false,true from profitability_fixture
union all select branch_b,tenant_id,'PRO-B','Profit Branch B',false,true from profitability_fixture;
insert into public.customers(id,tenant_id,wa_id,display_name,phone)
select customer_id,tenant_id,'profit-qa:'||customer_id,'Profit Test Customer','2348999999999'
from profitability_fixture;

insert into public.orders(tenant_id,customer_id,branch_id,public_order_id,status,source,currency,total_amount,payment_status,amount_paid,fulfillment_status)
select tenant_id,customer_id,branch_a,'PFQ/A/'||substr(branch_a::text,1,8),'completed','pos','NGN',100,'paid',100,'collected' from profitability_fixture
union all
select tenant_id,customer_id,branch_b,'PFQ/B/'||substr(branch_b::text,1,8),'completed','whatsapp','NGN',220,'paid',220,'collected' from profitability_fixture;

-- Draft uses the governed default fulfilment state; it is never treated as a sale.
insert into public.orders(tenant_id,customer_id,branch_id,public_order_id,status,source,currency,total_amount,payment_status,amount_paid)
select tenant_id,customer_id,branch_a,'PFQ/D/'||substr(branch_a::text,1,8),'draft','pos','NGN',500,'unpaid',0
from profitability_fixture;

select extensions.ok(
  to_regprocedure('public.get_sellertray_profitability_report(uuid,date,date,uuid,text)') is not null,
  'Profitability Report has a governed, date/Branch/channel-aware RPC'
);
select extensions.ok(
  has_function_privilege('authenticated','public.get_sellertray_profitability_report(uuid,date,date,uuid,text)','EXECUTE')
  and has_function_privilege('service_role','public.get_sellertray_profitability_report(uuid,date,date,uuid,text)','EXECUTE')
  and not has_function_privilege('anon','public.get_sellertray_profitability_report(uuid,date,date,uuid,text)','EXECUTE'),
  'Anonymous sessions cannot execute aggregate profitability'
);
select extensions.ok(
  exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_sellertray_profitability_report'
    and p.prosecdef=true and p.provolatile='s'
    and array_to_string(p.proconfig,',') like '%search_path=%'),
  'Report uses a stable definer with locked search_path'
);
select extensions.ok(
  lower(pg_get_functiondef('public.get_sellertray_profitability_report(uuid,date,date,uuid,text)'::regprocedure))
    not like '%current_user%postgres%'
  and lower(pg_get_functiondef('public.get_sellertray_profitability_report(uuid,date,date,uuid,text)'::regprocedure))
    like '%sellertray_user_can_read_report_branch%'
  and lower(pg_get_functiondef('public.get_sellertray_profitability_report(uuid,date,date,uuid,text)'::regprocedure))
    like '%can_view_reports%',
  'No definer-owner exemption; authenticated role, capability, Branch controls are enforced'
);

select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub',(select owner_id::text from profitability_fixture),true);

select extensions.is(
  (public.get_sellertray_profitability_report((select tenant_id from profitability_fixture))#>>'{summary,salesCount}')::integer,
  2,'Only completed sales are included; draft POS sale is excluded'
);
select extensions.is(
  (public.get_sellertray_profitability_report((select tenant_id from profitability_fixture))#>>'{summary,netRevenue}')::numeric,
  320::numeric,'Net revenue is based on the selected completed sales, not cash'
);
select extensions.is(
  (public.get_sellertray_profitability_report((select tenant_id from profitability_fixture))#>>'{summary,incompleteCostSales}')::integer,
  2,'Sales with no posted cost evidence are counted as incomplete'
);
select extensions.is(
  jsonb_typeof(public.get_sellertray_profitability_report((select tenant_id from profitability_fixture))#>'{summary,grossProfit}'),
  'null','Unknown COGS must not become invented gross profit'
);
select extensions.is(
  jsonb_typeof(public.get_sellertray_profitability_report((select tenant_id from profitability_fixture))#>'{summary,grossMarginPercent}'),
  'null','Unknown cost must withhold gross margin'
);
select extensions.is(
  (public.get_sellertray_profitability_report((select tenant_id from profitability_fixture))#>>'{summary,costComplete}')::boolean,
  false,'Partial cost evidence is disclosed at summary level'
);
select extensions.is(
  jsonb_array_length(public.get_sellertray_profitability_report((select tenant_id from profitability_fixture))->'branches'),
  2,'Owner has two scoped Branch profitability rows'
);
select extensions.is(
  (public.get_sellertray_profitability_report((select tenant_id from profitability_fixture),null,null,(select branch_a from profitability_fixture))#>>'{summary,salesCount}')::integer,
  1,'Branch filter excludes the other Branch'
);
select extensions.is(
  (public.get_sellertray_profitability_report((select tenant_id from profitability_fixture),null,null,(select branch_a from profitability_fixture))#>>'{summary,netRevenue}')::numeric,
  100::numeric,'Branch filter keeps exact authorised Branch revenue'
);
select extensions.is(
  (public.get_sellertray_profitability_report((select tenant_id from profitability_fixture),null,null,null,'whatsapp')#>>'{summary,salesCount}')::integer,
  1,'WhatsApp channel filter reuses the unified completed sale model'
);
select extensions.is(
  (public.get_sellertray_profitability_report((select tenant_id from profitability_fixture),null,null,null,'whatsapp')#>>'{summary,netRevenue}')::numeric,
  220::numeric,'WhatsApp revenue is separate only as a reporting dimension'
);
select extensions.is(
  (public.get_sellertray_profitability_report((select tenant_id from profitability_fixture),null,null,null,'manual')#>>'{summary,salesCount}')::integer,
  0,'Empty filtered result does not invent a sale'
);
select extensions.throws_ok(
  format('select public.get_sellertray_profitability_report(%L::uuid,null,null,null,%L::text)',tenant_id,'invalid'),
  '22023','Unsupported sales channel','Unsupported channel fails closed'
) from profitability_fixture;
select extensions.throws_ok(
  format('select public.get_sellertray_profitability_report(%L::uuid,current_date+1,current_date)',tenant_id),
  '22023','Choose a valid report range of up to 366 days','Invalid date range fails closed'
) from profitability_fixture;
select extensions.throws_ok(
  format('select public.get_sellertray_profitability_report(%L::uuid,null,null,%L::uuid)',tenant_id,gen_random_uuid()),
  'P0002','Branch not found','Unknown Branch is not silently included'
) from profitability_fixture;

select set_config('request.jwt.claim.sub',(select outsider_id::text from profitability_fixture),true);
select extensions.throws_ok(
  format('select public.get_sellertray_profitability_report(%L::uuid)',tenant_id),
  '42501','Merchant Web reports are available to Owners and Managers',
  'Outsider cannot read another Business profitability'
) from profitability_fixture;

select set_config('request.jwt.claim.sub',(select staff_id::text from profitability_fixture),true);
select extensions.throws_ok(
  format('select public.get_sellertray_profitability_report(%L::uuid)',tenant_id),
  '42501','Merchant Web reports are available to Owners and Managers',
  'Staff with ordinary report capability still cannot access Merchant management profitability'
) from profitability_fixture;

select set_config('request.jwt.claim.sub',(select manager_id::text from profitability_fixture),true);
select extensions.lives_ok(
  format('select public.get_sellertray_profitability_report(%L::uuid)',tenant_id),
  'Manager with report capability may read Business profitability'
) from profitability_fixture;
insert into public.tenant_member_capabilities(tenant_id,user_id,capability,allowed,granted_by)
select tenant_id,manager_id,'can_view_reports',false,owner_id from profitability_fixture;
select extensions.throws_ok(
  format('select public.get_sellertray_profitability_report(%L::uuid)',tenant_id),
  '42501','Merchant Web reports are available to Owners and Managers',
  'Explicit Manager report denial blocks profit reads'
) from profitability_fixture;

select * from extensions.finish();
rollback;
