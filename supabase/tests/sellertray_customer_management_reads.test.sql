begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(15);

select extensions.ok(
  (
    select p.prosecdef and p.provolatile='s'
    from pg_proc p
    where p.oid=to_regprocedure('public.get_sellertray_customer_management_list(uuid,text,integer,integer)')
  )
  and (
    select p.prosecdef and p.provolatile='s'
    from pg_proc p
    where p.oid=to_regprocedure('public.get_sellertray_customer_management_detail(uuid,uuid,integer)')
  ),
  'Customer management reads are stable SECURITY DEFINER functions'
);

select extensions.ok(
  has_function_privilege('authenticated','public.get_sellertray_customer_management_list(uuid,text,integer,integer)','EXECUTE')
  and has_function_privilege('authenticated','public.get_sellertray_customer_management_detail(uuid,uuid,integer)','EXECUTE')
  and not has_function_privilege('anon','public.get_sellertray_customer_management_list(uuid,text,integer,integer)','EXECUTE')
  and not has_function_privilege('anon','public.get_sellertray_customer_management_detail(uuid,uuid,integer)','EXECUTE'),
  'Customer management reads are authenticated-only'
);

create temp table sellertray_customer_management_fixture (
  tenant_id uuid not null,
  other_tenant_id uuid not null,
  owner_user_id uuid not null,
  manager_user_id uuid not null,
  staff_user_id uuid not null,
  branch_id uuid,
  customer_id uuid not null,
  whatsapp_customer_id uuid not null,
  walk_in_customer_id uuid not null,
  other_customer_id uuid not null,
  list_result jsonb,
  search_result jsonb,
  page_result jsonb,
  detail_result jsonb
) on commit drop;

insert into sellertray_customer_management_fixture(
  tenant_id,other_tenant_id,owner_user_id,manager_user_id,staff_user_id,
  customer_id,whatsapp_customer_id,walk_in_customer_id,other_customer_id
) values(
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()
);

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_user_id,'customer-read-owner-'||substr(owner_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_customer_management_fixture
union all
select manager_user_id,'customer-read-manager-'||substr(manager_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_customer_management_fixture
union all
select staff_user_id,'customer-read-staff-'||substr(staff_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_customer_management_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'SellerTray Customer Read Test','sellertray-customer-read-'||substr(tenant_id::text,1,8),'CRT','active'
from sellertray_customer_management_fixture
union all
select other_tenant_id,'SellerTray Other Customer Read Test','sellertray-other-customer-read-'||substr(other_tenant_id::text,1,8),'CRO','active'
from sellertray_customer_management_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id in (
  select tenant_id from sellertray_customer_management_fixture
  union all
  select other_tenant_id from sellertray_customer_management_fixture
);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner' from sellertray_customer_management_fixture
union all
select tenant_id,manager_user_id,'manager' from sellertray_customer_management_fixture
union all
select tenant_id,staff_user_id,'staff' from sellertray_customer_management_fixture;

update sellertray_customer_management_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

insert into public.customers(id,tenant_id,wa_id,display_name,phone,email,created_at,updated_at)
select customer_id,tenant_id,'manual:+2348010000001','Ada Customer','+2348010000001','ada@example.com',now()-interval '10 days',now()
from sellertray_customer_management_fixture
union all
select whatsapp_customer_id,tenant_id,'2348010000002','Bola WhatsApp','+2348010000002','bola@example.com',now()-interval '9 days',now()
from sellertray_customer_management_fixture
union all
select walk_in_customer_id,tenant_id,'pos:walk-in','Walk-in Customer',null,null,now()-interval '8 days',now()
from sellertray_customer_management_fixture
union all
select other_customer_id,other_tenant_id,'manual:+2348010000099','Other Business Customer','+2348010000099',null,now()-interval '7 days',now()
from sellertray_customer_management_fixture;

insert into public.orders(
  tenant_id,customer_id,branch_id,public_order_id,status,source,total_amount,amount_paid,payment_status,created_at
)
select tenant_id,customer_id,branch_id,'CUS/100001','completed','pos',1000,800,'unpaid',now()-interval '6 days'
from sellertray_customer_management_fixture
union all
select tenant_id,customer_id,branch_id,'CUS/100002','completed','pos',500,500,'paid',now()-interval '5 days'
from sellertray_customer_management_fixture
union all
select tenant_id,customer_id,branch_id,'CUS/100003','draft','pos',999,0,'unpaid',now()-interval '4 days'
from sellertray_customer_management_fixture
union all
select tenant_id,customer_id,branch_id,'CUS/100004','ready','manual',600,100,'unpaid',now()-interval '3 days'
from sellertray_customer_management_fixture;

insert into public.orders(
  tenant_id,customer_id,branch_id,public_order_id,status,source,total_amount,amount_paid,payment_status,
  created_at,deleted_at,deleted_by_user_id,deletion_reason,deletion_command_hash
)
select tenant_id,customer_id,branch_id,'CUS/100005','draft','pos',900,0,'unpaid',
  now()-interval '2 days',now()-interval '1 day',owner_user_id,'Duplicate draft','0123456789abcdef0123456789abcdef'
from sellertray_customer_management_fixture;

select set_config('request.jwt.claim.sub',(select owner_user_id::text from sellertray_customer_management_fixture),true);
select set_config('request.jwt.claim.role','authenticated',true);

update sellertray_customer_management_fixture
set list_result=public.get_sellertray_customer_management_list(tenant_id,null,50,0),
    search_result=public.get_sellertray_customer_management_list(tenant_id,'Ada',50,0),
    page_result=public.get_sellertray_customer_management_list(tenant_id,null,1,0),
    detail_result=public.get_sellertray_customer_management_detail(tenant_id,customer_id,100);

select extensions.is(
  ((select list_result->>'totalCount' from sellertray_customer_management_fixture))::integer,
  2,
  'Customer directory is tenant-scoped and excludes the pseudo Walk-in Customer'
);

select extensions.is(
  jsonb_array_length((select list_result->'items' from sellertray_customer_management_fixture)),
  2,
  'Customer directory returns only the real customers in this Business'
);

select extensions.is(
  ((select search_result->>'totalCount' from sellertray_customer_management_fixture))::integer,
  1,
  'Customer directory search is governed server-side'
);

select extensions.ok(
  ((select page_result->>'totalCount' from sellertray_customer_management_fixture))::integer=2
  and jsonb_array_length((select page_result->'items' from sellertray_customer_management_fixture))=1,
  'Customer directory returns total count independently from page size'
);

select extensions.is(
  ((select detail_result#>>'{summary,completedOrderCount}' from sellertray_customer_management_fixture))::integer,
  2,
  'Customer summary counts only completed sales'
);

select extensions.is(
  ((select detail_result#>>'{summary,totalSales}' from sellertray_customer_management_fixture))::numeric,
  1500::numeric,
  'Customer summary calculates completed sales value server-side'
);

select extensions.is(
  ((select detail_result#>>'{summary,collected}' from sellertray_customer_management_fixture))::numeric,
  1300::numeric,
  'Customer summary calculates collected value from completed sales'
);

select extensions.is(
  ((select detail_result#>>'{summary,outstanding}' from sellertray_customer_management_fixture))::numeric,
  700::numeric,
  'Customer summary calculates outstanding from accepted commercial lifecycle states'
);

select extensions.is(
  jsonb_array_length((select detail_result->'orders' from sellertray_customer_management_fixture)),
  4,
  'Customer order history excludes soft-deleted drafts without hiding active drafts'
);

select extensions.ok(
  not exists(
    select 1
    from sellertray_customer_management_fixture f,
         jsonb_array_elements(f.detail_result->'orders') o
    where o->>'publicOrderId'='CUS/100005'
  ),
  'Soft-deleted draft is absent from Customer history'
);

select extensions.ok(
  (public.get_sellertray_customer_management_detail(
    (select tenant_id from sellertray_customer_management_fixture),
    (select whatsapp_customer_id from sellertray_customer_management_fixture),
    100
  )#>>'{customer,whatsappLinked}')::boolean,
  'Customer detail exposes WhatsApp linkage without exposing wa_id'
);

select set_config('request.jwt.claim.sub',(select manager_user_id::text from sellertray_customer_management_fixture),true);
select extensions.is(
  (public.get_sellertray_customer_management_list(
    (select tenant_id from sellertray_customer_management_fixture),null,50,0
  )->>'totalCount')::integer,
  2,
  'Manager can use governed Customer management reads'
);

select set_config('request.jwt.claim.sub',(select staff_user_id::text from sellertray_customer_management_fixture),true);
select extensions.throws_ok(
  format(
    'select public.get_sellertray_customer_management_list(%L::uuid,null,50,0)',
    (select tenant_id::text from sellertray_customer_management_fixture)
  ),
  '42501',
  'Owner or Manager access is required to manage customers',
  'Cashier/Staff cannot read the management Customer directory'
);

select set_config('request.jwt.claim.sub',(select owner_user_id::text from sellertray_customer_management_fixture),true);
select extensions.throws_ok(
  format(
    'select public.get_sellertray_customer_management_detail(%L::uuid,%L::uuid,100)',
    (select tenant_id::text from sellertray_customer_management_fixture),
    (select other_customer_id::text from sellertray_customer_management_fixture)
  ),
  'P0002',
  'Customer not found',
  'Customer detail fails closed across Business boundaries'
);

select * from extensions.finish();
rollback;
