begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(22);

-- Transaction-scoped authorization regression. No test merchant records persist.
create temp table report_scope_fixture(
  tenant_id uuid default gen_random_uuid(),
  owner_id uuid default gen_random_uuid(),
  manager_id uuid default gen_random_uuid(),
  staff_id uuid default gen_random_uuid(),
  outsider_id uuid default gen_random_uuid(),
  customer_id uuid default gen_random_uuid(),
  branch_id uuid,
  other_branch_id uuid,
  order_id uuid default gen_random_uuid()
) on commit drop;
insert into report_scope_fixture default values;

insert into auth.users(id,email,aud,role)
select owner_id,'report-owner-'||owner_id||'@example.com','authenticated','authenticated' from report_scope_fixture
union all select manager_id,'report-manager-'||manager_id||'@example.com','authenticated','authenticated' from report_scope_fixture
union all select staff_id,'report-staff-'||staff_id||'@example.com','authenticated','authenticated' from report_scope_fixture
union all select outsider_id,'report-outsider-'||outsider_id||'@example.com','authenticated','authenticated' from report_scope_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'Reporting scope test','report-scope-'||tenant_id,'RST','active'
from report_scope_fixture;
-- Test-only tenant must have a writable subscription under CI's strict guard.
update public.tenant_subscriptions
set status='active', trial_ends_at=null, grace_ends_at=null
where tenant_id=(select tenant_id from report_scope_fixture);
update report_scope_fixture f
set branch_id=b.id from public.branches b
where b.tenant_id=f.tenant_id and b.is_default;

with b as (
  insert into public.branches(tenant_id,code,name,is_default,is_active)
  select tenant_id,'OTHER','Other test Branch',false,true
  from report_scope_fixture
  returning id
)
update report_scope_fixture set other_branch_id=(select id from b);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_id,'owner' from report_scope_fixture
union all select tenant_id,manager_id,'manager' from report_scope_fixture
union all select tenant_id,staff_id,'staff' from report_scope_fixture;

insert into public.customers(id,tenant_id,wa_id)
select customer_id,tenant_id,'qa-reports:'||customer_id from report_scope_fixture;
insert into public.orders(id,tenant_id,customer_id,branch_id,public_order_id)
select order_id,tenant_id,customer_id,branch_id,'ST/QA/'||replace(order_id::text,'-','')
from report_scope_fixture;

-- Guard against recurrence: in SECURITY DEFINER, current_user is the owner,
-- not the JWT actor. It can never exempt client requests from Branch checks.
select extensions.ok(
  p.prosrc !~* 'current_user[[:space:]]*<>[[:space:]]*''postgres''',
  p.proname||' has no owner-identity exemption'
)
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in ('get_sellertray_branch_stock_as_of',
                    'get_sellertray_branch_stock_valuation',
                    'get_sellertray_order_profitability')
order by p.proname;

select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub',(select outsider_id::text from report_scope_fixture),true);

select extensions.throws_ok(
  format('select * from public.get_sellertray_branch_stock_as_of(%L::uuid,%L::uuid,now())',tenant_id,branch_id),
  '42501','You do not have access to this Branch',
  'outsider cannot read another Business historical stock'
) from report_scope_fixture;
select extensions.throws_ok(
  format('select * from public.get_sellertray_branch_stock_valuation(%L::uuid,%L::uuid,now())',tenant_id,branch_id),
  '42501','You do not have permission to view inventory valuation for this Branch',
  'outsider cannot read another Business stock valuation'
) from report_scope_fixture;
select extensions.throws_ok(
  format('select public.get_sellertray_order_profitability(%L::uuid,%L::uuid)',tenant_id,order_id),
  '42501','You do not have permission to view profitability for this sale',
  'outsider cannot read another Business sale profitability'
) from report_scope_fixture;

select set_config('request.jwt.claim.sub',(select owner_id::text from report_scope_fixture),true);
select extensions.lives_ok(
  format('select * from public.get_sellertray_branch_stock_as_of(%L::uuid,%L::uuid,now())',tenant_id,branch_id),
  'Owner retains governed Branch stock read'
) from report_scope_fixture;
select extensions.lives_ok(
  format('select * from public.get_sellertray_branch_stock_valuation(%L::uuid,%L::uuid,now())',tenant_id,branch_id),
  'Owner retains governed Branch valuation read'
) from report_scope_fixture;
select extensions.lives_ok(
  format('select public.get_sellertray_order_profitability(%L::uuid,%L::uuid)',tenant_id,order_id),
  'Owner retains governed profitability read'
) from report_scope_fixture;

-- Normal Manager reporting is allowed; an explicit capability denial must
-- supersede that default without removing ordinary Branch stock visibility.
select set_config('request.jwt.claim.sub',(select manager_id::text from report_scope_fixture),true);
select extensions.lives_ok(
  format('select * from public.get_sellertray_branch_stock_as_of(%L::uuid,%L::uuid,now())',tenant_id,branch_id),
  'Manager retains ordinary Branch stock read'
) from report_scope_fixture;
select extensions.lives_ok(
  format('select * from public.get_sellertray_branch_stock_valuation(%L::uuid,%L::uuid,now())',tenant_id,branch_id),
  'Manager can read allowed inventory valuation'
) from report_scope_fixture;
select extensions.lives_ok(
  format('select public.get_sellertray_order_profitability(%L::uuid,%L::uuid)',tenant_id,order_id),
  'Manager can read allowed sale profitability'
) from report_scope_fixture;

insert into public.tenant_member_capabilities(tenant_id,user_id,capability,allowed)
select tenant_id,manager_id,'can_view_reports',false from report_scope_fixture;
select extensions.throws_ok(
  format('select * from public.get_sellertray_branch_stock_valuation(%L::uuid,%L::uuid,now())',tenant_id,branch_id),
  '42501','You do not have permission to view inventory valuation for this Branch',
  'explicit Manager report denial blocks valuation'
) from report_scope_fixture;
select extensions.throws_ok(
  format('select public.get_sellertray_order_profitability(%L::uuid,%L::uuid)',tenant_id,order_id),
  '42501','You do not have permission to view profitability for this sale',
  'explicit Manager report denial blocks profitability'
) from report_scope_fixture;
select extensions.lives_ok(
  format('select * from public.get_sellertray_branch_stock_as_of(%L::uuid,%L::uuid,now())',tenant_id,branch_id),
  'explicit report denial does not remove Manager ordinary Branch stock read'
) from report_scope_fixture;

select set_config('request.jwt.claim.sub',(select staff_id::text from report_scope_fixture),true);
select extensions.lives_ok(
  format('select * from public.get_sellertray_branch_stock_as_of(%L::uuid,%L::uuid,now())',tenant_id,branch_id),
  'Cashier can read default Branch historical quantity'
) from report_scope_fixture;
select extensions.throws_ok(
  format('select * from public.get_sellertray_branch_stock_valuation(%L::uuid,%L::uuid,now())',tenant_id,branch_id),
  '42501','You do not have permission to view inventory valuation for this Branch',
  'Cashier without reports capability cannot read valuation'
) from report_scope_fixture;
select extensions.throws_ok(
  format('select public.get_sellertray_order_profitability(%L::uuid,%L::uuid)',tenant_id,order_id),
  '42501','You do not have permission to view profitability for this sale',
  'Cashier without reports capability cannot read profitability'
) from report_scope_fixture;
select extensions.throws_ok(
  format('select * from public.get_sellertray_branch_stock_as_of(%L::uuid,%L::uuid,now())',tenant_id,other_branch_id),
  '42501','You do not have access to this Branch',
  'default-only Cashier cannot read another Branch'
) from report_scope_fixture;

select set_config('request.jwt.claim.role','service_role',true);
select extensions.lives_ok(
  format('select * from public.get_sellertray_branch_stock_as_of(%L::uuid,%L::uuid,now())',tenant_id,branch_id),
  'service role retains historical stock read'
) from report_scope_fixture;
select extensions.lives_ok(
  format('select * from public.get_sellertray_branch_stock_valuation(%L::uuid,%L::uuid,now())',tenant_id,branch_id),
  'service role retains valuation read'
) from report_scope_fixture;
select extensions.lives_ok(
  format('select public.get_sellertray_order_profitability(%L::uuid,%L::uuid)',tenant_id,order_id),
  'service role retains profitability read'
) from report_scope_fixture;

select * from extensions.finish();
rollback;
