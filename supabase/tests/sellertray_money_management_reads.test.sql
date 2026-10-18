begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(26);

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
select extensions.ok(
  position('sellertray_user_can_read_report_branch' in pg_get_functiondef('public.get_sellertray_payment_management_list(uuid,uuid,text,text,text,date,date,integer,integer)'::regprocedure))>0
  and position('p_method_type' in pg_get_functiondef('public.get_sellertray_payment_management_list(uuid,uuid,text,text,text,date,date,integer,integer)'::regprocedure))>0
  and position('p_date_from' in pg_get_functiondef('public.get_sellertray_payment_management_list(uuid,uuid,text,text,text,date,date,integer,integer)'::regprocedure))>0
  and position('wa_id' in pg_get_functiondef('public.get_sellertray_payment_management_list(uuid,uuid,text,text,text,date,date,integer,integer)'::regprocedure))=0,
  'Payment management enforces report Branch authority and does not expose raw WhatsApp identity'
);
select extensions.ok(
  position('returned_amount' in pg_get_functiondef('public.get_sellertray_receivables_management_list(uuid,uuid,text,date,date,integer,integer)'::regprocedure))>0
  and position('limit v_limit offset v_offset' in lower(pg_get_functiondef('public.get_sellertray_receivables_management_list(uuid,uuid,text,date,date,integer,integer)'::regprocedure)))>0,
  'Receivables use return-adjusted truth with server pagination'
);
select extensions.ok(
  position('can_manage_payments' in pg_get_functiondef('public.get_sellertray_payment_methods_management(uuid)'::regprocedure))>0
  and position('sellertray_branch_payment_methods' in pg_get_functiondef('public.get_sellertray_payment_methods_management(uuid)'::regprocedure))>0
  and position('secret' in lower(pg_get_functiondef('public.get_sellertray_payment_methods_management(uuid)'::regprocedure)))=0,
  'Payment-method management is capability-governed and does not expose gateway secrets'
);
select extensions.ok(
  position('returned_amount' in pg_get_functiondef('public.collect_sellertray_customer_receivable(uuid,uuid,uuid,numeric,uuid)'::regprocedure))>0
  and position('sellertray_record_pos_payment_allocation' in pg_get_functiondef('public.collect_sellertray_customer_receivable(uuid,uuid,uuid,numeric,uuid)'::regprocedure))>0,
  'Receivable collection keeps canonical allocation authority while using return-adjusted balance truth'
);

create temp table money_fixture(
  tenant_id uuid not null, other_tenant_id uuid not null,
  owner_id uuid not null, manager_id uuid not null, staff_id uuid not null,
  branch_id uuid, branch_two_id uuid, foreign_branch_id uuid,
  customer_id uuid not null, bank_method_id uuid not null, card_method_id uuid not null,
  payment_order_id uuid, receivable_order_id uuid,
  methods jsonb, payments jsonb, receivables jsonb
) on commit drop;
insert into money_fixture values(
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
  null,null,null,gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),null,null,null,null,null
);
insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_id,'money-owner-'||substr(owner_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now() from money_fixture
union all select manager_id,'money-manager-'||substr(manager_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now() from money_fixture
union all select staff_id,'money-staff-'||substr(staff_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now() from money_fixture;
insert into public.tenants(id,name,slug,merchant_code,subscription_status,timezone)
select tenant_id,'Money Management Test','money-management-'||substr(tenant_id::text,1,8),'MMR','active','Africa/Lagos' from money_fixture
union all select other_tenant_id,'Money Foreign Test','money-foreign-'||substr(other_tenant_id::text,1,8),'MMX','active','Africa/Lagos' from money_fixture;
update public.tenant_subscriptions set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id in (select tenant_id from money_fixture union all select other_tenant_id from money_fixture);
insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_id,'owner' from money_fixture
union all select tenant_id,manager_id,'manager' from money_fixture
union all select tenant_id,staff_id,'staff' from money_fixture;
update money_fixture f set branch_id=b.id from public.branches b where b.tenant_id=f.tenant_id and b.is_default=true;
update money_fixture f set foreign_branch_id=b.id from public.branches b where b.tenant_id=f.other_tenant_id and b.is_default=true;
with x as (insert into public.branches(tenant_id,code,name,is_default,is_active) select tenant_id,'MM2','Money Branch Two',false,true from money_fixture returning id)
update money_fixture set branch_two_id=(select id from x);
insert into public.customers(id,tenant_id,wa_id,display_name,phone)
select customer_id,tenant_id,'manual:+2348010000044','Ada Balance','+2348010000044' from money_fixture;
insert into public.merchant_payment_methods(id,tenant_id,method_type,display_name,is_enabled,is_default,sort_order,mode,configuration_status,bank_name,bank_account_name,bank_account_number)
select bank_method_id,tenant_id,'bank_transfer','Main Bank',true,true,10,'live','ready','Test Bank','Money Test','1000000010' from money_fixture
union all select card_method_id,tenant_id,'card_terminal','Counter Terminal',true,false,20,'live','ready',null,null,null from money_fixture;
insert into public.sellertray_branch_payment_methods(tenant_id,branch_id,payment_method_id,is_enabled)
select tenant_id,branch_id,bank_method_id,true from money_fixture
union all select tenant_id,branch_two_id,card_method_id,true from money_fixture;

with x as (
  insert into public.orders(tenant_id,branch_id,customer_id,status,source,customer_note,parser_source,review_reasons,currency,total_amount,created_at)
  select tenant_id,branch_id,customer_id,'needs_review','manual','Money payment','manual','{}'::text[],'NGN',100,'2026-10-10 09:00+00'::timestamptz from money_fixture returning id
)
update money_fixture f set payment_order_id=x.id from x;
update public.orders set status='accepted' where id=(select payment_order_id from money_fixture);
insert into public.order_payments(tenant_id,order_id,invoice_document_id,method_type,provider,status,amount,currency,provider_reference,created_at)
select f.tenant_id,f.payment_order_id,d.id,'bank_transfer','manual_bank','pending_verification',100,'NGN','MONEYREF001','2026-10-10 09:30+00'::timestamptz
from money_fixture f join public.order_financial_documents d on d.tenant_id=f.tenant_id and d.order_id=f.payment_order_id and d.document_type='invoice';

with x as (
  insert into public.orders(tenant_id,branch_id,customer_id,status,source,customer_note,parser_source,review_reasons,currency,total_amount,amount_paid,return_status,returned_amount,created_at)
  select tenant_id,branch_id,customer_id,'completed','manual','Money receivable','manual','{}'::text[],'NGN',100,30,'partial',20,'2026-10-12 09:00+00'::timestamptz from money_fixture returning id
)
update money_fixture f set receivable_order_id=x.id from x;

select set_config('request.jwt.claim.sub',(select owner_id::text from money_fixture),true);
select set_config('request.jwt.claim.role','authenticated',true);
update money_fixture set
  methods=public.get_sellertray_payment_methods_management(tenant_id),
  payments=public.get_sellertray_payment_management_list(tenant_id,null,null,'attention',null,null,null,50,0),
  receivables=public.get_sellertray_receivables_management_list(tenant_id,null,null,null,null,50,0);

select extensions.is(((select methods->>'totalCount' from money_fixture))::integer,2,'Payment methods are Business-scoped');
select extensions.ok(
  exists(select 1 from money_fixture f, jsonb_array_elements(f.methods->'items') x where x->>'id'=f.bank_method_id::text and (x->'branchIds') ? f.branch_id::text),
  'Payment-method read returns governed active Branch assignments'
);
select set_config('request.jwt.claim.sub',(select manager_id::text from money_fixture),true);
select extensions.is((public.get_sellertray_payment_methods_management((select tenant_id from money_fixture))->>'totalCount')::integer,2,'Managers can use payment-method management reads');
select set_config('request.jwt.claim.sub',(select staff_id::text from money_fixture),true);
select extensions.throws_ok(
  format('select public.get_sellertray_payment_methods_management(%L::uuid)',(select tenant_id::text from money_fixture)),
  '42501','You do not have permission to manage payment methods','Staff cannot use payment-method management reads'
);
select set_config('request.jwt.claim.sub',(select owner_id::text from money_fixture),true);

select extensions.is(((select payments->>'totalCount' from money_fixture))::integer,1,'Payment reconciliation returns the governed payment row');
select extensions.is(((select payments->>'attentionCount' from money_fixture))::integer,1,'Payment attention aggregate covers the full filtered scope');
select extensions.is((public.get_sellertray_payment_management_list((select tenant_id from money_fixture),(select branch_id from money_fixture),null,'attention',null,null,null,50,0)->>'totalCount')::integer,1,'Payment Branch filter is server-side');
select extensions.is((public.get_sellertray_payment_management_list((select tenant_id from money_fixture),null,null,'attention','bank_transfer',null,null,50,0)->>'totalCount')::integer,1,'Payment method filter is server-side');
select extensions.is((public.get_sellertray_payment_management_list((select tenant_id from money_fixture),null,'MONEYREF001','attention',null,null,null,50,0)->>'totalCount')::integer,1,'Payment search is server-side');
select extensions.is((public.get_sellertray_payment_management_list((select tenant_id from money_fixture),null,null,'attention',null,'2026-10-10'::date,'2026-10-10'::date,50,0)->>'totalCount')::integer,1,'Payment date filter uses Business-local dates');
select extensions.ok((public.get_sellertray_payment_management_list((select tenant_id from money_fixture),null,null,'attention',null,null,null,1,0)->>'totalCount')::integer=1 and jsonb_array_length(public.get_sellertray_payment_management_list((select tenant_id from money_fixture),null,null,'attention',null,null,null,1,0)->'items')=1,'Payment pagination returns stable count and page rows');
select extensions.throws_ok(
  format('select public.get_sellertray_payment_management_list(%L::uuid,%L::uuid,null,''attention'',null,null,null,50,0)',(select tenant_id::text from money_fixture),(select foreign_branch_id::text from money_fixture)),
  'P0002','Branch not found','Payment management fails closed for another Business Branch'
);
select extensions.throws_ok(
  format('select public.get_sellertray_payment_management_list(%L::uuid,null,null,''unknown'',null,null,null,50,0)',(select tenant_id::text from money_fixture)),
  '22023','Unsupported payment reconciliation view','Unsupported payment view is rejected'
);
select extensions.throws_ok(
  format('select public.get_sellertray_payment_management_list(%L::uuid,null,null,''all'',''crypto'',null,null,50,0)',(select tenant_id::text from money_fixture)),
  '22023','Unsupported payment method','Unsupported payment method is rejected'
);
select extensions.throws_ok(
  format('select public.get_sellertray_payment_management_list(%L::uuid,null,null,''all'',null,''2026-10-12''::date,''2026-10-10''::date,50,0)',(select tenant_id::text from money_fixture)),
  '22023','Payment date range is invalid','Invalid payment date range is rejected'
);

select extensions.is(((select receivables->>'totalCount' from money_fixture))::integer,1,'Receivables management returns the governed named-customer balance');
select extensions.is(((select receivables->>'outstandingAmount' from money_fixture))::numeric,50::numeric,'Receivables deduct completed returns before calculating outstanding value');
select extensions.is((public.get_sellertray_receivables_management_list((select tenant_id from money_fixture),null,'Ada Balance',null,null,50,0)->>'totalCount')::integer,1,'Receivable search is server-side');
select extensions.throws_ok(
  format('select public.get_sellertray_receivables_management_list(%L::uuid,null,null,''2026-10-14''::date,''2026-10-10''::date,50,0)',(select tenant_id::text from money_fixture)),
  '22023','Receivables date range is invalid','Invalid receivables date range is rejected'
);
select extensions.throws_ok(
  format('select public.collect_sellertray_customer_receivable(%L::uuid,%L::uuid,null,60,%L::uuid)',(select tenant_id::text from money_fixture),(select receivable_order_id::text from money_fixture),gen_random_uuid()::text),
  '23514','Payment exceeds the outstanding customer balance','Collection rejects value above the return-adjusted receivable'
);

select * from extensions.finish();
rollback;
