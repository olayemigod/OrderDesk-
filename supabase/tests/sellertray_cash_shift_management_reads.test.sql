begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(28);

select extensions.ok(
  (select p.prosecdef and p.provolatile='s' from pg_proc p where p.oid=to_regprocedure('public.get_sellertray_cash_shift_management_list(uuid,uuid,uuid,text,text,date,date,integer,integer)'))
  and (select p.prosecdef and p.provolatile='s' from pg_proc p where p.oid=to_regprocedure('public.get_sellertray_cash_shift_management_detail(uuid,uuid)')),
  'Cash management reads are stable SECURITY DEFINER functions'
);
select extensions.ok(
  has_function_privilege('authenticated','public.get_sellertray_cash_shift_management_list(uuid,uuid,uuid,text,text,date,date,integer,integer)','EXECUTE')
  and has_function_privilege('authenticated','public.get_sellertray_cash_shift_management_detail(uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.get_sellertray_cash_shift_management_list(uuid,uuid,uuid,text,text,date,date,integer,integer)','EXECUTE')
  and not has_function_privilege('anon','public.get_sellertray_cash_shift_management_detail(uuid,uuid)','EXECUTE'),
  'Cash management reads are authenticated-only'
);
select extensions.ok(
  has_function_privilege('service_role','public.correct_sellertray_shift_cash_movement(uuid,uuid,uuid,text,text,text,text,numeric,text,text,text,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.correct_sellertray_shift_cash_movement(uuid,uuid,uuid,text,text,text,text,numeric,text,text,text,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.correct_sellertray_shift_cash_movement(uuid,uuid,uuid,text,text,text,text,numeric,text,text,text,uuid)','EXECUTE'),
  'Cash correction command remains service-role only'
);
select extensions.ok(
  exists(select 1 from pg_trigger where tgrelid='public.sellertray_shift_cash_movements'::regclass and tgname='guard_sellertray_cash_movement_history' and not tgisinternal)
  and exists(select 1 from pg_trigger where tgrelid='public.sellertray_shift_cash_movement_corrections'::regclass and tgname='prevent_sellertray_cash_correction_mutation' and not tgisinternal),
  'Cash movement and correction audit history are protected by immutable triggers'
);
select extensions.ok(
  position('sellertray_user_can_read_branch' in pg_get_functiondef('public.get_sellertray_cash_shift_management_list(uuid,uuid,uuid,text,text,date,date,integer,integer)'::regprocedure))>0
  and position('sellertray_cash_shift_totals' in pg_get_functiondef('public.get_sellertray_cash_shift_management_list(uuid,uuid,uuid,text,text,date,date,integer,integer)'::regprocedure))>0
  and position('limit v_limit offset v_offset' in lower(pg_get_functiondef('public.get_sellertray_cash_shift_management_list(uuid,uuid,uuid,text,text,date,date,integer,integer)'::regprocedure)))>0,
  'Cash management list uses governed Branch authority, effective totals and server pagination'
);
select extensions.ok(
  position('sellertray_user_can_read_branch' in pg_get_functiondef('public.get_sellertray_cash_shift_management_detail(uuid,uuid)'::regprocedure))>0
  and position('get_sellertray_shift_payment_summary' in pg_get_functiondef('public.get_sellertray_cash_shift_management_detail(uuid,uuid)'::regprocedure))>0
  and position('sellertray_shift_cash_movement_corrections' in pg_get_functiondef('public.get_sellertray_cash_shift_management_detail(uuid,uuid)'::regprocedure))>0,
  'Cash management detail reuses governed payment summary and correction history'
);
select extensions.ok(
  position('can_correct_cash_movement' in pg_get_functiondef('public.correct_sellertray_shift_cash_movement(uuid,uuid,uuid,text,text,text,text,numeric,text,text,text,uuid)'::regprocedure))>0
  and position('sellertray.cash_correction' in pg_get_functiondef('public.correct_sellertray_shift_cash_movement(uuid,uuid,uuid,text,text,text,text,numeric,text,text,text,uuid)'::regprocedure))>0,
  'Cash correction command preserves capability authority and controlled supersession'
);

create temp table cash_mgmt_fixture(
  tenant_id uuid not null,
  other_tenant_id uuid not null,
  owner_id uuid not null,
  manager_id uuid not null,
  staff_id uuid not null,
  branch_id uuid,
  branch_two_id uuid,
  foreign_branch_id uuid,
  register_id uuid,
  register_two_id uuid,
  open_shift_id uuid not null,
  closed_shift_id uuid not null,
  reviewed_shift_id uuid not null,
  movement_id uuid not null,
  correction_result jsonb,
  list_result jsonb,
  detail_result jsonb,
  movement_mutation_rejected boolean not null default false,
  correction_mutation_rejected boolean not null default false
) on commit drop;

insert into cash_mgmt_fixture(
  tenant_id,other_tenant_id,owner_id,manager_id,staff_id,
  open_shift_id,closed_shift_id,reviewed_shift_id,movement_id
) values(
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()
);

insert into auth.users(id,email,aud,role,raw_user_meta_data,created_at,updated_at)
select owner_id,'cash-owner-'||substr(owner_id::text,1,8)||'@example.com','authenticated','authenticated',jsonb_build_object('full_name','Owner Cash'),now(),now() from cash_mgmt_fixture
union all select manager_id,'cash-manager-'||substr(manager_id::text,1,8)||'@example.com','authenticated','authenticated',jsonb_build_object('full_name','Manager Cash'),now(),now() from cash_mgmt_fixture
union all select staff_id,'cash-staff-'||substr(staff_id::text,1,8)||'@example.com','authenticated','authenticated',jsonb_build_object('full_name','Cashier Ada'),now(),now() from cash_mgmt_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status,timezone)
select tenant_id,'Cash Management Test','cash-management-'||substr(tenant_id::text,1,8),'CMT','active','Africa/Lagos' from cash_mgmt_fixture
union all select other_tenant_id,'Cash Foreign Test','cash-foreign-'||substr(other_tenant_id::text,1,8),'CMX','active','Africa/Lagos' from cash_mgmt_fixture;
update public.tenant_subscriptions set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id in (select tenant_id from cash_mgmt_fixture union all select other_tenant_id from cash_mgmt_fixture);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_id,'owner' from cash_mgmt_fixture
union all select tenant_id,manager_id,'manager' from cash_mgmt_fixture
union all select tenant_id,staff_id,'staff' from cash_mgmt_fixture;

update cash_mgmt_fixture f set branch_id=b.id
from public.branches b where b.tenant_id=f.tenant_id and b.is_default=true;
update cash_mgmt_fixture f set foreign_branch_id=b.id
from public.branches b where b.tenant_id=f.other_tenant_id and b.is_default=true;
insert into public.branches(tenant_id,code,name,is_default,is_active)
select tenant_id,'CASH2','Cash Branch Two',false,true from cash_mgmt_fixture;
update cash_mgmt_fixture f set branch_two_id=b.id
from public.branches b where b.tenant_id=f.tenant_id and b.code='CASH2';
update cash_mgmt_fixture f set register_id=r.id
from public.sellertray_registers r where r.tenant_id=f.tenant_id and r.branch_id=f.branch_id and r.is_default=true;
update cash_mgmt_fixture f set register_two_id=r.id
from public.sellertray_registers r where r.tenant_id=f.tenant_id and r.branch_id=f.branch_two_id and r.is_default=true;

insert into public.sellertray_cash_shifts(
  id,tenant_id,branch_id,register_id,status,currency,opening_cash,opened_by_user_id,opened_at
)
select open_shift_id,tenant_id,branch_id,register_id,'open','NGN',1000,owner_id,'2026-10-10 09:00+00'::timestamptz
from cash_mgmt_fixture;

insert into public.sellertray_cash_shifts(
  id,tenant_id,branch_id,register_id,status,currency,opening_cash,opened_by_user_id,opened_at,
  expected_cash,declared_cash,variance,close_note,closed_by_user_id,closed_at
)
select closed_shift_id,tenant_id,branch_two_id,register_two_id,'closed','NGN',500,manager_id,'2026-10-09 09:00+00'::timestamptz,
  550,560,10,'Ten naira over',manager_id,'2026-10-09 17:00+00'::timestamptz
from cash_mgmt_fixture;

insert into public.sellertray_cash_shifts(
  id,tenant_id,branch_id,register_id,status,currency,opening_cash,opened_by_user_id,opened_at,
  expected_cash,declared_cash,variance,close_note,closed_by_user_id,closed_at,
  review_decision,review_note,reviewed_by_user_id,reviewed_at
)
select reviewed_shift_id,tenant_id,branch_id,register_id,'reviewed','NGN',300,staff_id,'2026-10-08 09:00+00'::timestamptz,
  300,300,0,null,staff_id,'2026-10-08 17:00+00'::timestamptz,
  'accepted','Balanced shift',manager_id,'2026-10-08 18:00+00'::timestamptz
from cash_mgmt_fixture;

insert into public.sellertray_shift_cash_movements(
  id,tenant_id,branch_id,register_id,shift_id,movement_type,amount,currency,reference,reason,expense_category,actor_user_id,created_at,command_id_hash
)
select movement_id,tenant_id,branch_id,register_id,open_shift_id,'cash_in',100,'NGN','FLOAT-MGMT-001','Additional float',null,owner_id,'2026-10-10 10:00+00'::timestamptz,md5(tenant_id::text||'|cash-mgmt-fixture')
from cash_mgmt_fixture;

select set_config('request.jwt.claim.sub',(select owner_id::text from cash_mgmt_fixture),true);
select set_config('request.jwt.claim.role','authenticated',true);
update cash_mgmt_fixture set list_result=public.get_sellertray_cash_shift_management_list(tenant_id,null,null,'all','all',null,null,50,0);

select extensions.is(((select list_result->>'totalCount' from cash_mgmt_fixture))::integer,3,'Management list returns all governed Business shifts');
select extensions.is(((select list_result->>'openCount' from cash_mgmt_fixture))::integer,1,'Management list aggregates open shifts');
select extensions.is(((select list_result->>'pendingReviewCount' from cash_mgmt_fixture))::integer,1,'Management list aggregates pending manager review');
select extensions.is(((select list_result->>'varianceCount' from cash_mgmt_fixture))::integer,1,'Management list aggregates non-zero variance shifts');
select extensions.is((public.get_sellertray_cash_shift_management_list((select tenant_id from cash_mgmt_fixture),(select branch_id from cash_mgmt_fixture),null,'all','all',null,null,50,0)->>'totalCount')::integer,2,'Branch filter is server-side');
select extensions.is((public.get_sellertray_cash_shift_management_list((select tenant_id from cash_mgmt_fixture),null,(select manager_id from cash_mgmt_fixture),'all','all',null,null,50,0)->>'totalCount')::integer,1,'Cashier filter is server-side');
select extensions.is((public.get_sellertray_cash_shift_management_list((select tenant_id from cash_mgmt_fixture),null,null,'closed','all',null,null,50,0)->>'totalCount')::integer,1,'Shift status filter is server-side');
select extensions.is((public.get_sellertray_cash_shift_management_list((select tenant_id from cash_mgmt_fixture),null,null,'all','variance',null,null,50,0)->>'totalCount')::integer,1,'Variance filter is server-side');
select extensions.is((public.get_sellertray_cash_shift_management_list((select tenant_id from cash_mgmt_fixture),null,null,'all','all','2026-10-10'::date,'2026-10-10'::date,50,0)->>'totalCount')::integer,1,'Cash shift dates use Business-local boundaries');
select extensions.ok(
  (public.get_sellertray_cash_shift_management_list((select tenant_id from cash_mgmt_fixture),null,null,'all','all',null,null,1,0)->>'totalCount')::integer=3
  and jsonb_array_length(public.get_sellertray_cash_shift_management_list((select tenant_id from cash_mgmt_fixture),null,null,'all','all',null,null,1,0)->'items')=1,
  'Cash shift pagination keeps full-result count while limiting page rows'
);
select extensions.ok(
  exists(select 1 from cash_mgmt_fixture f,jsonb_array_elements(f.list_result->'cashiers') c where c->>'userId'=f.staff_id::text and c->>'name'='Cashier Ada'),
  'Cashier options expose merchant-facing identity without raw auth metadata'
);
select extensions.throws_ok(
  format('select public.get_sellertray_cash_shift_management_list(%L::uuid,%L::uuid,null,''all'',''all'',null,null,50,0)',(select tenant_id::text from cash_mgmt_fixture),(select foreign_branch_id::text from cash_mgmt_fixture)),
  'P0002','Branch not found','Cash management fails closed for another Business Branch'
);
select extensions.throws_ok(
  format('select public.get_sellertray_cash_shift_management_list(%L::uuid,null,null,''all'',''all'',''2026-10-12''::date,''2026-10-10''::date,50,0)',(select tenant_id::text from cash_mgmt_fixture)),
  '22023','Cashier shift date range is invalid','Invalid Cash shift date range is rejected'
);

select set_config('request.jwt.claim.sub',(select staff_id::text from cash_mgmt_fixture),true);
select extensions.throws_ok(
  format('select public.get_sellertray_cash_shift_management_list(%L::uuid,null,null,''all'',''all'',null,null,50,0)',(select tenant_id::text from cash_mgmt_fixture)),
  '42501','Merchant Web cash management is available to Owners and Managers','Staff cannot use Merchant Web Cash management reads'
);
select set_config('request.jwt.claim.sub',(select manager_id::text from cash_mgmt_fixture),true);
select extensions.is((public.get_sellertray_cash_shift_management_list((select tenant_id from cash_mgmt_fixture),null,null,'all','all',null,null,50,0)->>'totalCount')::integer,3,'Managers can use Cash management reads');
select set_config('request.jwt.claim.sub',(select owner_id::text from cash_mgmt_fixture),true);

update cash_mgmt_fixture set detail_result=public.get_sellertray_cash_shift_management_detail(tenant_id,open_shift_id);
select extensions.is(((select detail_result->>'expectedCash' from cash_mgmt_fixture))::numeric,1100::numeric,'Open shift detail uses effective ledger-derived expected cash');
select extensions.is(jsonb_array_length((select detail_result->'movements' from cash_mgmt_fixture)),1,'Shift detail exposes effective cash movements');
select extensions.ok((select (detail_result->>'canCorrect')::boolean from cash_mgmt_fixture),'Open shift detail exposes governed correction authority');
select extensions.ok(not (select (detail_result->>'canReview')::boolean from cash_mgmt_fixture),'Open shift is not reviewable before close');
select extensions.is(jsonb_array_length((select detail_result->'paymentSummary' from cash_mgmt_fixture)),0,'Shift detail reuses the governed payment-method summary');

update cash_mgmt_fixture set correction_result=public.correct_sellertray_shift_cash_movement(
  tenant_id,open_shift_id,movement_id,'replace','Correct float amount','cashmgmt-correct-001','cash_in',80,'FLOAT-MGMT-002','Corrected float',null,owner_id
);
select extensions.is((select (correction_result->>'expectedCash')::numeric from cash_mgmt_fixture),1080::numeric,'Governed correction replaces effective cash value without rewriting history');
update cash_mgmt_fixture set detail_result=public.get_sellertray_cash_shift_management_detail(tenant_id,open_shift_id);
select extensions.ok(
  jsonb_array_length((select detail_result->'movements' from cash_mgmt_fixture))=1
  and jsonb_array_length((select detail_result->'corrections' from cash_mgmt_fixture))=1
  and ((select detail_result->>'expectedCash' from cash_mgmt_fixture))::numeric=1080,
  'Shift detail shows replacement movement, correction audit and corrected expected cash'
);

do $$
begin
  begin
    update public.sellertray_shift_cash_movements set amount=9999
    where id=(select movement_id from cash_mgmt_fixture);
  exception when sqlstate '55000' then
    update cash_mgmt_fixture set movement_mutation_rejected=true;
  end;
end
$$;
select extensions.ok((select movement_mutation_rejected from cash_mgmt_fixture),'Cash movement history rejects destructive mutation');

do $$
begin
  begin
    update public.sellertray_shift_cash_movement_corrections set reason='Rewrite audit'
    where original_movement_id=(select movement_id from cash_mgmt_fixture);
  exception when sqlstate '55000' then
    update cash_mgmt_fixture set correction_mutation_rejected=true;
  end;
end
$$;
select extensions.ok((select correction_mutation_rejected from cash_mgmt_fixture),'Cash correction audit history is immutable');

select extensions.is(
  (public.get_sellertray_cash_shift_management_detail((select tenant_id from cash_mgmt_fixture),(select closed_shift_id from cash_mgmt_fixture))->>'canReview')::boolean,
  true,'Closed shift detail exposes manager review authority'
);

select * from extensions.finish();
rollback;
