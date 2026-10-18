begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(28);

select extensions.ok(
  (select p.prosecdef and p.provolatile='s' from pg_proc p where p.oid=to_regprocedure('public.get_sellertray_payment_management_list(uuid,uuid,text,text,text,date,date,integer,integer)'))
  and (select p.prosecdef and p.provolatile='s' from pg_proc p where p.oid=to_regprocedure('public.get_sellertray_receivables_management_list(uuid,uuid,text,date,date,integer,integer)'))
  and (select p.prosecdef and p.provolatile='s' from pg_proc p where p.oid=to_regprocedure('public.get_sellertray_payment_methods_management(uuid)')),
  'Money management reads are stable SECURITY DEFINER functions'
);

select extensions.ok(
  has_function_privilege('authenticated','public.get_sellertray_payment_management_list(uuid,uuid,text,text,text,date,date,integer,integer)','EXECUTE')
  and has_function_privilege('authenticated','public.get_sellertray_receivables_management_list(uuid,uuid,text,date,date,integer,integer)','EXECUTE')
  and has_function_privilege('authenticated','public.get_sellertray_payment_methods_management(uuid)','EXECUTE')
  and not has_function_privilege('anon','public.get_sellertray_payment_management_list(uuid,uuid,text,text,text,date,date,integer,integer)','EXECUTE')
  and not has_function_privilege('anon','public.get_sellertray_receivables_management_list(uuid,uuid,text,date,date,integer,integer)','EXECUTE')
  and not has_function_privilege('anon','public.get_sellertray_payment_methods_management(uuid)','EXECUTE'),
  'Money management reads are authenticated-only'
);

create temp table sellertray_money_management_fixture (
  tenant_id uuid not null,
  other_tenant_id uuid not null,
  owner_user_id uuid not null,
  manager_user_id uuid not null,
  staff_user_id uuid not null,
  branch_id uuid,
  branch_two_id uuid,
  foreign_branch_id uuid,
  customer_one_id uuid not null,
  customer_two_id uuid not null,
  payment_order_one_id uuid,
  payment_order_two_id uuid,
  receivable_order_one_id uuid,
  receivable_order_two_id uuid,
  bank_method_id uuid not null,
  card_method_id uuid not null,
  payment_result jsonb,
  payment_page jsonb,
  receivable_result jsonb,
  receivable_page jsonb,
  method_result jsonb
) on commit drop;

insert into sellertray_money_management_fixture(
  tenant_id,other_tenant_id,owner_user_id,manager_user_id,staff_user_id,
  customer_one_id,customer_two_id,bank_method_id,card_method_id
) values(
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()
);

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_user_id,'money-owner-'||substr(owner_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now() from sellertray_money_management_fixture
union all
select manager_user_id,'money-manager-'||substr(manager_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now() from sellertray_money_management_fixture
union all
select staff_user_id,'money-staff-'||substr(staff_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now() from sellertray_money_management_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status,timezone)
select tenant_id,'SellerTray Money Management Test','sellertray-money-management-'||substr(tenant_id::text,1,8),'MMR','active','Africa/Lagos' from sellertray_money_management_fixture
union all
select other_tenant_id,'SellerTray Money Foreign Test','sellertray-money-foreign-'||substr(other_tenant_id::text,1,8),'MMX','active','Africa/Lagos' from sellertray_money_management_fixture;

update public.tenant_subscriptions set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id in (select tenant_id from sellertray_money_management_fixture union all select other_tenant_id from sellertray_money_management_fixture);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner' from sellertray_money_management_fixture
union all select tenant_id,manager_user_id,'manager' from sellertray_money_management_fixture
union all select tenant_id,staff_user_id,'staff' from sellertray_money_management_fixture;

update sellertray_money_management_fixture f set branch_id=b.id
from public.branches b where b.tenant_id=f.tenant_id and b.is_default=true;
update sellertray_money_management_fixture f set foreign_branch_id=b.id
from public.branches b where b.tenant_id=f.other_tenant_id and b.is_default=true;

with inserted as (
  insert into public.branches(tenant_id,code,name,is_default,is_active)
  select tenant_id,'MM2','Money Branch Two',false,true from sellertray_money_management_fixture returning id
)
update sellertray_money_management_fixture set branch_two_id=(select id from inserted);

insert into public.customers(id,tenant_id,wa_id,display_name,phone)
select customer_one_id,tenant_id,'manual:+2348010000011','Ada Receivable','+2348010000011' from sellertray_money_management_fixture
union all
select customer_two_id,tenant_id,'manual:+2348010000022','Bola Receivable','+2348010000022' from sellertray_money_management_fixture;

insert into public.merchant_payment_methods(
  id,tenant_id,method_type,display_name,is_enabled,is_default,sort_order,mode,configuration_status,
  bank_name,bank_account_name,bank_account_number,instructions
)
select bank_method_id,tenant_id,'bank_transfer','Main Bank',true,true,10,'live','ready','Test Bank','SellerTray Money','1000000010','Use transfer reference' from sellertray_money_management_fixture
union all
select card_method_id,tenant_id,'card_terminal','Front Counter Terminal',true,false,20,'live','ready',null,null,null,'Confirm terminal approval' from sellertray_money_management_fixture;

insert into public.sellertray_branch_payment_methods(tenant_id,branch_id,payment_method_id,is_enabled)
select tenant_id,branch_id,bank_method_id,true from sellertray_money_management_fixture
union all select tenant_id,branch_two_id,card_method_id,true from sellertray_money_management_fixture;

-- Create two invoiced orders for payment reconciliation.
with inserted as (
  insert into public.orders(tenant_id,branch_id,customer_id,status,source,customer_note,parser_source,review_reasons,currency,total_amount,created_at)
  select tenant_id,branch_id,customer_one_id,'needs_review','manual','Payment one','manual','{}'::text[],'NGN',100,'2026-10-10 09:00+00'::timestamptz from sellertray_money_management_fixture
  returning id
)
update sellertray_money_management_fixture f set payment_order_one_id=i.id from inserted i;
with inserted as (
  insert into public.orders(tenant_id,branch_id,customer_id,status,source,customer_note,parser_source,review_reasons,currency,total_amount,created_at)
  select tenant_id,branch_two_id,customer_two_id,'needs_review','manual','Payment two','manual','{}'::text[],'NGN',200,'2026-10-11 09:00+00'::timestamptz from sellertray_money_management_fixture
  returning id
)
update sellertray_money_management_fixture f set payment_order_two_id=i.id from inserted i;

update public.orders set status='accepted' where id in (
  select payment_order_one_id from sellertray_money_management_fixture
  union all select payment_order_two_id from sellertray_money_management_fixture
);

insert into public.order_payments(
  tenant_id,order_id,invoice_document_id,method_type,provider,status,amount,currency,provider_reference,created_at
)
select f.tenant_id,f.payment_order_one_id,d.id,'bank_transfer','manual_bank','pending_verification',100,'NGN','MONEYREF001','2026-10-10 09:30+00'::timestamptz
from sellertray_money_management_fixture f join public.order_financial_documents d on d.tenant_id=f.tenant_id and d.order_id=f.payment_order_one_id and d.document_type='invoice'
union all
select f.tenant_id,f.payment_order_two_id,d.id,'card_terminal','pos_terminal','pending_verification',200,'NGN','MONEYREF002','2026-10-11 09:30+00'::timestamptz
from sellertray_money_management_fixture f join public.order_financial_documents d on d.tenant_id=f.tenant_id and d.order_id=f.payment_order_two_id and d.document_type='invoice';

-- Receivable fixtures deliberately include a completed return projection.
with inserted as (
  insert into public.orders(tenant_id,branch_id,customer_id,status,source,customer_note,parser_source,review_reasons,currency,total_amount,amount_paid,return_status,returned_amount,created_at)
  select tenant_id,branch_id,customer_one_id,'completed','manual','Receivable one','manual','{}'::text[],'NGN',100,30,'partial',20,'2026-10-12 09:00+00'::timestamptz from sellertray_money_management_fixture
  returning id
)
update sellertray_money_management_fixture f set receivable_order_one_id=i.id from inserted i;
with inserted as (
  insert into public.orders(tenant_id,branch_id,customer_id,status,source,customer_note,parser_source,review_reasons,currency,total_amount,amount_paid,created_at)
  select tenant_id,branch_two_id,customer_two_id,'completed','manual','Receivable two','manual','{}'::text[],'NGN',200,100,'2026-10-13 09:00+00'::timestamptz from sellertray_money_management_fixture
  returning id
)
update sellertray_money_management_fixture f set receivable_order_two_id=i.id from inserted i;

select set_config('request.jwt.claim.sub',(select owner_user_id::text from sellertray_money_management_fixture),true);
select set_config('request.jwt.claim.role','authenticated',true);

update sellertray_money_management_fixture set
  payment_result=public.get_sellertray_payment_management_list(tenant_id,null,null,'attention',null,null,null,50,0),
  payment_page=public.get_sellertray_payment_management_list(tenant_id,null,null,'attention',null,null,null,1,0),
  receivable_result=public.get_sellertray_receivables_management_list(tenant_id,null,null,null,null,50,0),
  receivable_page=public.get_sellertray_receivables_management_list(tenant_id,null,null,null,null,1,0),
  method_result=public.get_sellertray_payment_methods_management(tenant_id);

select extensions.is(((select method_result->>'totalCount' from sellertray_money_management_fixture))::integer,2,'Payment method management is Business-scoped');
select extensions.ok(
  ((select method_result->'items'->0->'branchIds' from sellertray_money_management_fixture) ? (select branch_id::text from sellertray_money_management_fixture))
  or ((select method_result->'items'->1->'branchIds' from sellertray_money_management_fixture) ? (select branch_id::text from sellertray_money_management_fixture)),
  'Payment method management includes governed active Branch assignments'
);
select extensions.ok(
  position('secret' in lower(pg_get_functiondef('public.get_sellertray_payment_methods_management(uuid)'::regprocedure)))=0,
  'Payment method management read does not expose gateway secrets'
);

select extensions.is(((select payment_result->>'totalCount' from sellertray_money_management_fixture))::integer,2,'Payment reconciliation returns all governed attention rows across accessible Branches');
select extensions.is((public.get_sellertray_payment_management_list((select tenant_id from sellertray_money_management_fixture),(select branch_id from sellertray_money_management_fixture),null,'attention',null,null,null,50,0)->>'totalCount')::integer,1,'Payment Branch filtering is server-side');
select extensions.is((public.get_sellertray_payment_management_list((select tenant_id from sellertray_money_management_fixture),null,null,'attention','bank_transfer',null,null,50,0)->>'totalCount')::integer,1,'Payment method filtering is server-side');
select extensions.is((public.get_sellertray_payment_management_list((select tenant_id from sellertray_money_management_fixture),null,'MONEYREF002','attention',null,null,null,50,0)->>'totalCount')::integer,1,'Payment reference search is server-side');
select extensions.is((public.get_sellertray_payment_management_list((select tenant_id from sellertray_money_management_fixture),null,null,'attention',null,'2026-10-10'::date,'2026-10-10'::date,50,0)->>'totalCount')::integer,1,'Payment date filtering uses the Business-local date boundary');
select extensions.ok(((select payment_page->>'totalCount' from sellertray_money_management_fixture))::integer=2 and jsonb_array_length((select payment_page->'items' from sellertray_money_management_fixture))=1,'Payment paging keeps total count independent of page size');
select extensions.is(((select payment_result->>'attentionCount' from sellertray_money_management_fixture))::integer,2,'Payment attention aggregate covers the full filtered result set');
select extensions.is(((select payment_result->>'totalAmount' from sellertray_money_management_fixture))::numeric,300::numeric,'Payment value aggregate covers the full filtered result set');

select extensions.throws_ok(
  format('select public.get_sellertray_payment_management_list(%L::uuid,%L::uuid,null,''attention'',null,null,null,50,0)',(select tenant_id::text from sellertray_money_management_fixture),(select foreign_branch_id::text from sellertray_money_management_fixture)),
  'P0002','Branch not found','Payment management fails closed for another Business Branch'
);
select extensions.throws_ok(
  format('select public.get_sellertray_payment_management_list(%L::uuid,null,null,''unknown'',null,null,null,50,0)',(select tenant_id::text from sellertray_money_management_fixture)),
  '22023','Unsupported payment reconciliation view','Unsupported payment reconciliation view is rejected'
);
select extensions.throws_ok(
  format('select public.get_sellertray_payment_management_list(%L::uuid,null,null,''all'',''crypto'',null,null,50,0)',(select tenant_id::text from sellertray_money_management_fixture)),
  '22023','Unsupported payment method','Unsupported payment method is rejected'
);
select extensions.throws_ok(
  format('select public.get_sellertray_payment_management_list(%L::uuid,null,null,''all'',null,''2026-10-12''::date,''2026-10-10''::date,50,0)',(select tenant_id::text from sellertray_money_management_fixture)),
  '22023','Payment date range is invalid','Invalid payment date range is rejected'
);

select extensions.is(((select receivable_result->>'totalCount' from sellertray_money_management_fixture))::integer,2,'Receivables management is Business-scoped');
select extensions.is((public.get_sellertray_receivables_management_list((select tenant_id from sellertray_money_management_fixture),(select branch_id from sellertray_money_management_fixture),null,null,null,50,0)->>'totalCount')::integer,1,'Receivable Branch filtering is server-side');
select extensions.is(((select receivable_result->>'outstandingAmount' from sellertray_money_management_fixture))::numeric,150::numeric,'Receivable aggregate deducts completed returns before calculating outstanding value');
select extensions.is((public.get_sellertray_receivables_management_list((select tenant_id from sellertray_money_management_fixture),(select branch_id from sellertray_money_management_fixture),null,null,null,50,0)->>'outstandingAmount')::numeric,50::numeric,'Returned value reduces the collectible balance for the affected sale');
select extensions.is(((select receivable_result->>'customerCount' from sellertray_money_management_fixture))::integer,2,'Receivables aggregate counts distinct customers across the full result set');
select extensions.is((public.get_sellertray_receivables_management_list((select tenant_id from sellertray_money_management_fixture),null,'Ada Receivable',null,null,50,0)->>'totalCount')::integer,1,'Receivable customer search is server-side');
select extensions.ok(((select receivable_page->>'totalCount' from sellertray_money_management_fixture))::integer=2 and jsonb_array_length((select receivable_page->'items' from sellertray_money_management_fixture))=1,'Receivable paging keeps total count independent of page size');
select extensions.throws_ok(
  format('select public.get_sellertray_receivables_management_list(%L::uuid,null,null,''2026-10-14''::date,''2026-10-10''::date,50,0)',(select tenant_id::text from sellertray_money_management_fixture)),
  '22023','Receivables date range is invalid','Invalid receivables date range is rejected'
);

select extensions.ok(
  position('returned_amount' in pg_get_functiondef('public.collect_sellertray_customer_receivable(uuid,uuid,uuid,numeric,uuid)'::regprocedure))>0,
  'Receivable collection authority uses the same return-adjusted outstanding truth as the read model'
);
select extensions.throws_ok(
  format('select public.collect_sellertray_customer_receivable(%L::uuid,%L::uuid,null,60,%L::uuid)',
    (select tenant_id::text from sellertray_money_management_fixture),
    (select receivable_order_one_id::text from sellertray_money_management_fixture),
    gen_random_uuid()::text),
  '23514','Payment exceeds the outstanding customer balance','Receivable collection rejects value above the return-adjusted balance'
);

select set_config('request.jwt.claim.sub',(select manager_user_id::text from sellertray_money_management_fixture),true);
select extensions.is(
  (public.get_sellertray_payment_methods_management((select tenant_id from sellertray_money_management_fixture))->>'totalCount')::integer,
  2,
  'Managers can use governed payment-method management reads'
);

select set_config('request.jwt.claim.sub',(select staff_user_id::text from sellertray_money_management_fixture),true);
select extensions.throws_ok(
  format('select public.get_sellertray_payment_methods_management(%L::uuid)',(select tenant_id::text from sellertray_money_management_fixture)),
  '42501','You do not have permission to manage payment methods','Staff cannot use payment-method management reads'
);

select * from extensions.finish();
rollback;
