begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

-- Fresh pre-C2 Business: the compatibility trial has already ended, but
-- non-transactional preparation is still required to complete setup.
create temp table oa5_device_fixture (
  tenant_id uuid not null default gen_random_uuid(),
  owner_user_id uuid not null default gen_random_uuid(),
  outsider_user_id uuid not null default gen_random_uuid(),
  branch_id uuid,
  register_id uuid,
  printer_id uuid,
  job_id uuid,
  outsider_register_rejected boolean not null default false,
  outsider_printer_rejected boolean not null default false,
  suspended_register_rejected boolean not null default false,
  suspended_printer_rejected boolean not null default false,
  retired_register_rejected boolean not null default false
) on commit drop;
insert into oa5_device_fixture default values;

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_user_id,'oa5-device-owner-'||substr(owner_user_id::text,1,8)||'@example.com',
'authenticated','authenticated',now(),now() from oa5_device_fixture
union all
select outsider_user_id,'oa5-device-outsider-'||substr(outsider_user_id::text,1,8)||'@example.com',
'authenticated','authenticated',now(),now() from oa5_device_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'OA5 Pre-Activation Device Test',
'oa5-device-'||substr(tenant_id::text,1,8),'OAD','trial'
from oa5_device_fixture;

update public.tenant_subscriptions s
set status='trial',
    trial_ends_at=now()-interval '2 days',
    current_period_start=null,
    current_period_end=null,
    grace_ends_at=null
from oa5_device_fixture f
where s.tenant_id=f.tenant_id;

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner' from oa5_device_fixture;

update oa5_device_fixture f set branch_id=b.id
from public.branches b where b.tenant_id=f.tenant_id and b.is_default=true;

select set_config('request.jwt.claim.sub',owner_user_id::text,true)
from oa5_device_fixture;

select extensions.ok(
  public.sellertray_business_is_preparing(tenant_id)
  and not public.orderdesk_subscription_can_write(tenant_id),
  'an expired trial compatibility row permits preparation but not operational writes'
) from oa5_device_fixture;

update oa5_device_fixture
set register_id=(public.save_sellertray_register(
  tenant_id,null,branch_id,'PREP02','Preparation register',false,true
)->>'registerId')::uuid;

select extensions.ok(
  (select register_id is not null from oa5_device_fixture),
  'preactivation Owner may create a Branch register'
);

update oa5_device_fixture
set printer_id=(public.save_sellertray_printer(
  tenant_id,null,branch_id,register_id,'Prep Printer','BT-PREPARE-001',58,true,true,owner_user_id
)->>'printerId')::uuid;

select extensions.ok(
  (select printer_id is not null from oa5_device_fixture),
  'preactivation Owner may configure a Bluetooth printer on their register'
);

select public.save_sellertray_printer_receipt_settings(
  tenant_id,printer_id,
  '[{"type":"customer","label":"Customer Copy","sortOrder":1}]'::jsonb,
  'Thanks for visiting'
) from oa5_device_fixture;

select extensions.ok(
  exists(select 1 from public.sellertray_printers p, oa5_device_fixture f
    where p.id=f.printer_id and p.tenant_id=f.tenant_id
      and p.merchant_receipt_footer='Thanks for visiting'),
  'receipt copy configuration is available before activation'
);

update oa5_device_fixture
set job_id=(public.request_sellertray_print_job(
  tenant_id,printer_id,'test',null,'OA5-PREACTIVATION-PRINT',owner_user_id
)->>'jobId')::uuid;

select public.transition_sellertray_print_job(
  tenant_id,job_id,'printing',null,null,owner_user_id
) from oa5_device_fixture;
select public.transition_sellertray_print_job(
  tenant_id,job_id,'printed',null,null,owner_user_id
) from oa5_device_fixture;

select extensions.ok(
  exists(select 1 from public.sellertray_print_jobs j, oa5_device_fixture f
    where j.tenant_id=f.tenant_id and j.id=f.job_id
      and j.job_type='test' and j.status='printed'),
  'native device test print can complete before operational entitlement'
);

select extensions.ok(
  not public.orderdesk_subscription_can_write(tenant_id),
  'preactivation register and printer preparation do not grant selling access'
) from oa5_device_fixture;

select set_config('request.jwt.claim.sub',outsider_user_id::text,true)
from oa5_device_fixture;

do $$
begin
  begin
    perform public.save_sellertray_register(
      f.tenant_id,null,f.branch_id,'CROSS','Outsider register',false,true
    ) from oa5_device_fixture f;
  exception when sqlstate '42501' then
    update oa5_device_fixture set outsider_register_rejected=true;
  end;
  begin
    perform public.save_sellertray_printer(
      f.tenant_id,null,f.branch_id,f.register_id,
      'Outsider printer','BT-OUTSIDER',58,false,true,f.outsider_user_id
    ) from oa5_device_fixture f;
  exception when sqlstate '42501' then
    update oa5_device_fixture set outsider_printer_rejected=true;
  end;
end $$;

select extensions.ok(
  (select outsider_register_rejected and outsider_printer_rejected from oa5_device_fixture),
  'nonmember cannot manage preactivation registers or printers'
);

select set_config('request.jwt.claim.sub',owner_user_id::text,true)
from oa5_device_fixture;
update public.tenant_subscriptions s set status='suspended'
from oa5_device_fixture f where s.tenant_id=f.tenant_id;

do $$
begin
  begin
    perform public.save_sellertray_register(
      f.tenant_id,null,f.branch_id,'SUSP','Suspended register',false,true
    ) from oa5_device_fixture f;
  exception when sqlstate '42501' then
    update oa5_device_fixture set suspended_register_rejected=true;
  end;
  begin
    perform public.save_sellertray_printer(
      f.tenant_id,null,f.branch_id,f.register_id,
      'Suspended printer','BT-SUSPENDED',58,false,true,f.owner_user_id
    ) from oa5_device_fixture f;
  exception when sqlstate '42501' then
    update oa5_device_fixture set suspended_printer_rejected=true;
  end;
end $$;

select extensions.ok(
  (select suspended_register_rejected and suspended_printer_rejected from oa5_device_fixture),
  'suspended Business is not treated as a preparing Business'
);

update public.tenant_subscriptions s
set status='trial',current_period_start=null,current_period_end=null
from oa5_device_fixture f where s.tenant_id=f.tenant_id;
update public.tenants t
set retired_at=now()
from oa5_device_fixture f where t.id=f.tenant_id;

do $$
begin
  begin
    perform public.save_sellertray_register(
      f.tenant_id,null,f.branch_id,'RETIRED','Retired register',false,true
    ) from oa5_device_fixture f;
  exception when sqlstate '42501' then
    update oa5_device_fixture set retired_register_rejected=true;
  end;
end $$;

select extensions.ok(
  (select retired_register_rejected from oa5_device_fixture),
  'retired Business cannot use preparation exemption even with trial compatibility'
);

select * from extensions.finish();
rollback;
