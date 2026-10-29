begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(9);

create temp table sellertray_printer_lifecycle_fixture (
  tenant_id uuid not null,
  owner_user_id uuid not null,
  branch_id uuid,
  register_id uuid,
  printer_id uuid,
  job_id uuid,
  direct_printer_delete_rejected boolean not null default false,
  direct_job_delete_rejected boolean not null default false
) on commit drop;

insert into sellertray_printer_lifecycle_fixture(tenant_id,owner_user_id)
values(gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_user_id,'printer-lifecycle-'||substr(owner_user_id::text,1,8)||'@example.com',
  'authenticated','authenticated',now(),now()
from sellertray_printer_lifecycle_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'SellerTray Printer Lifecycle Test',
  'sellertray-printer-lifecycle-'||substr(tenant_id::text,1,8),'PLT','active'
from sellertray_printer_lifecycle_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from sellertray_printer_lifecycle_fixture);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner'
from sellertray_printer_lifecycle_fixture;

update sellertray_printer_lifecycle_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

update sellertray_printer_lifecycle_fixture f
set register_id=r.id
from public.sellertray_registers r
where r.tenant_id=f.tenant_id and r.branch_id=f.branch_id and r.is_default=true;

update sellertray_printer_lifecycle_fixture
set printer_id=(public.save_sellertray_printer(
  tenant_id,null,branch_id,register_id,'Lifecycle Printer','BT-LIFECYCLE-001',58,true,true,owner_user_id
)->>'printerId')::uuid;

select extensions.ok(
  (select printer_id is not null from sellertray_printer_lifecycle_fixture),
  'printer exists before lifecycle cleanup'
);

update sellertray_printer_lifecycle_fixture
set job_id=(public.request_sellertray_print_job(
  tenant_id,printer_id,'test',null,'LIFECYCLE-TEST-001',owner_user_id
)->>'jobId')::uuid;

select public.transition_sellertray_print_job(
  tenant_id,job_id,'printing',null,null,owner_user_id
)
from sellertray_printer_lifecycle_fixture;
select public.transition_sellertray_print_job(
  tenant_id,job_id,'printed',null,null,owner_user_id
)
from sellertray_printer_lifecycle_fixture;

select extensions.ok(
  exists(
    select 1 from public.sellertray_print_jobs j
    where j.id=(select job_id from sellertray_printer_lifecycle_fixture)
      and j.status='printed'
  ),
  'completed print history exists before lifecycle cleanup'
);

select extensions.ok(
  exists(
    select 1 from public.sellertray_printer_events e
    where e.printer_id=(select printer_id from sellertray_printer_lifecycle_fixture)
      and e.event_type='registered'
  ),
  'printer configuration history exists before lifecycle cleanup'
);

do $$
begin
  begin
    delete from public.sellertray_print_jobs
    where id=(select job_id from sellertray_printer_lifecycle_fixture);
  exception when sqlstate '55000' then
    update sellertray_printer_lifecycle_fixture set direct_job_delete_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select direct_job_delete_rejected from sellertray_printer_lifecycle_fixture),
  'completed print history cannot be deleted directly while the business exists'
);

do $$
begin
  begin
    delete from public.sellertray_printers
    where id=(select printer_id from sellertray_printer_lifecycle_fixture);
  exception when sqlstate '55000' then
    update sellertray_printer_lifecycle_fixture set direct_printer_delete_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select direct_printer_delete_rejected from sellertray_printer_lifecycle_fixture),
  'printer configuration cannot be deleted directly while the business exists'
);

delete from public.tenants
where id=(select tenant_id from sellertray_printer_lifecycle_fixture);

select extensions.ok(
  not exists(
    select 1 from public.tenants t
    where t.id=(select tenant_id from sellertray_printer_lifecycle_fixture)
  ),
  'governed parent business deletion is not blocked by printer history'
);

select extensions.is(
  (
    select count(*)::integer from public.sellertray_printers p
    where p.tenant_id=(select tenant_id from sellertray_printer_lifecycle_fixture)
  ),
  0,'printer records follow parent business deletion'
);

select extensions.is(
  (
    select count(*)::integer from public.sellertray_print_jobs j
    where j.tenant_id=(select tenant_id from sellertray_printer_lifecycle_fixture)
  ),
  0,'print job history follows parent business deletion'
);

select extensions.is(
  (
    select count(*)::integer from public.sellertray_printer_events e
    where e.tenant_id=(select tenant_id from sellertray_printer_lifecycle_fixture)
  ),
  0,'printer configuration events follow parent business deletion'
);

select * from extensions.finish();
rollback;