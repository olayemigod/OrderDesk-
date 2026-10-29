begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(6);

create temp table sellertray_print_job_authority_fixture (
  tenant_id uuid not null,
  owner_user_id uuid not null,
  requester_user_id uuid not null,
  other_staff_user_id uuid not null,
  branch_id uuid,
  register_id uuid,
  printer_id uuid,
  job_id uuid,
  cross_operator_rejected boolean not null default false
) on commit drop;

insert into sellertray_print_job_authority_fixture(
  tenant_id,owner_user_id,requester_user_id,other_staff_user_id
)
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_user_id,'print-authority-owner-'||substr(owner_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_print_job_authority_fixture
union all
select requester_user_id,'print-authority-requester-'||substr(requester_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_print_job_authority_fixture
union all
select other_staff_user_id,'print-authority-other-'||substr(other_staff_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_print_job_authority_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status,business_email,business_phone)
select tenant_id,'SellerTray Print Authority Test','sellertray-print-authority-'||substr(tenant_id::text,1,8),'PRA','active','print-authority@example.com','08000000000'
from sellertray_print_job_authority_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from sellertray_print_job_authority_fixture);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner' from sellertray_print_job_authority_fixture
union all
select tenant_id,requester_user_id,'staff' from sellertray_print_job_authority_fixture
union all
select tenant_id,other_staff_user_id,'staff' from sellertray_print_job_authority_fixture;

update sellertray_print_job_authority_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

insert into public.branch_user_access(tenant_id,branch_id,user_id,can_operate)
select tenant_id,branch_id,requester_user_id,true
from sellertray_print_job_authority_fixture
union all
select tenant_id,branch_id,other_staff_user_id,true
from sellertray_print_job_authority_fixture;

update sellertray_print_job_authority_fixture f
set register_id=r.id
from public.sellertray_registers r
where r.tenant_id=f.tenant_id and r.branch_id=f.branch_id and r.is_default=true;

update sellertray_print_job_authority_fixture
set printer_id=(public.save_sellertray_printer(
  tenant_id,null,branch_id,register_id,
  'Authority Test Printer','BT-AUTHORITY-01',58,true,true,owner_user_id
)->>'printerId')::uuid;

update sellertray_print_job_authority_fixture
set job_id=(public.request_sellertray_print_job(
  tenant_id,printer_id,'test',null,'PRINT-AUTHORITY-001',requester_user_id
)->>'jobId')::uuid;

select extensions.ok(
  public.sellertray_user_can_operate_branch(
    (select tenant_id from sellertray_print_job_authority_fixture),
    (select branch_id from sellertray_print_job_authority_fixture),
    (select other_staff_user_id from sellertray_print_job_authority_fixture)
  ),
  'Other Staff has active operating access to the same Branch'
);

select extensions.ok(
  public.sellertray_user_has_capability(
    (select tenant_id from sellertray_print_job_authority_fixture),
    (select other_staff_user_id from sellertray_print_job_authority_fixture),
    'can_print_receipt'
  ),
  'Other Staff has receipt-printing capability'
);

do $$
begin
  begin
    perform public.transition_sellertray_print_job(
      (select tenant_id from sellertray_print_job_authority_fixture),
      (select job_id from sellertray_print_job_authority_fixture),
      'printing',null,null,
      (select other_staff_user_id from sellertray_print_job_authority_fixture)
    );
  exception when sqlstate '42501' then
    update sellertray_print_job_authority_fixture set cross_operator_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select cross_operator_rejected from sellertray_print_job_authority_fixture),
  'A different authorized Staff user cannot mutate another operator''s print attempt'
);

select extensions.is(
  (
    select j.status
    from public.sellertray_print_jobs j
    where j.id=(select job_id from sellertray_print_job_authority_fixture)
  ),
  'requested',
  'Rejected cross-operator mutation leaves the print attempt unchanged'
);

select extensions.is(
  (
    select public.transition_sellertray_print_job(
      tenant_id,job_id,'printing',null,null,requester_user_id
    )->>'status'
    from sellertray_print_job_authority_fixture
  ),
  'printing',
  'The requesting operator can record hardware printing start'
);

select extensions.is(
  (
    select public.transition_sellertray_print_job(
      tenant_id,job_id,'printed',null,null,requester_user_id
    )->>'status'
    from sellertray_print_job_authority_fixture
  ),
  'printed',
  'The requesting operator can record hardware completion'
);

select * from extensions.finish();
rollback;
