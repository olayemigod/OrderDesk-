begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(3);

select extensions.ok(
  position('sellertray-price-control-command|' in pg_get_functiondef(
    'public.control_sellertray_commercial_v2_price_version_admin(uuid,text,text,uuid,uuid)'::regprocedure
  )) > 0
  and position('sellertray-price-control-command|' in pg_get_functiondef(
    'public.control_sellertray_commercial_v2_price_version_admin(uuid,text,text,uuid,uuid)'::regprocedure
  )) < position('array_agg(c.price_version_id' in pg_get_functiondef(
    'public.control_sellertray_commercial_v2_price_version_admin(uuid,text,text,uuid,uuid)'::regprocedure
  ))
  and position('array_agg(c.price_version_id' in pg_get_functiondef(
    'public.control_sellertray_commercial_v2_price_version_admin(uuid,text,text,uuid,uuid)'::regprocedure
  )) < position('sellertray-price-lifecycle-v1' in pg_get_functiondef(
    'public.control_sellertray_commercial_v2_price_version_admin(uuid,text,text,uuid,uuid)'::regprocedure
  )),
  'C2 lifecycle command identity is serialized and validated before per-price state serialization'
);

create temp table c2_price_lifecycle_command_fixture (
  admin_user_id uuid not null,
  first_price_id uuid,
  second_price_id uuid,
  command_id uuid not null,
  cross_target_rejected boolean not null default false,
  retry_result jsonb
) on commit drop;

insert into c2_price_lifecycle_command_fixture(admin_user_id,command_id)
values(gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select admin_user_id,
       'c2-lifecycle-command-'||substr(admin_user_id::text,1,8)||'@example.com',
       'authenticated','authenticated',now(),now()
from c2_price_lifecycle_command_fixture;

insert into public.platform_admins(user_id,role)
select admin_user_id,'admin'
from c2_price_lifecycle_command_fixture;

with inserted as (
  insert into public.sellertray_commercial_price_versions(
    price_kind,charge_type_code,plan_code,plan_profile_version_id,addon_version_id,billing_cycle,
    currency,gross_amount,tax_inclusive,effective_from,status,change_reason,
    created_by_user_id,approved_by_user_id,approved_at,price_scope
  )
  select 'branch_setup','branch_setup',null,null,null,null,
         'CAD',100,true,'2026-01-01T00:00:00Z','published','Lifecycle command price A',
         admin_user_id,admin_user_id,now(),'standard'
  from c2_price_lifecycle_command_fixture
  returning id
)
update c2_price_lifecycle_command_fixture
set first_price_id=(select id from inserted);

with inserted as (
  insert into public.sellertray_commercial_price_versions(
    price_kind,charge_type_code,plan_code,plan_profile_version_id,addon_version_id,billing_cycle,
    currency,gross_amount,tax_inclusive,effective_from,status,change_reason,
    created_by_user_id,approved_by_user_id,approved_at,price_scope
  )
  select 'branch_setup','branch_setup',null,null,null,null,
         'AUD',100,true,'2026-01-01T00:00:00Z','published','Lifecycle command price B',
         admin_user_id,admin_user_id,now(),'standard'
  from c2_price_lifecycle_command_fixture
  returning id
)
update c2_price_lifecycle_command_fixture
set second_price_id=(select id from inserted);

select public.control_sellertray_commercial_v2_price_version_admin(
  first_price_id,'pause','Global command identity test',command_id,admin_user_id
)
from c2_price_lifecycle_command_fixture;

do $$
begin
  begin
    perform public.control_sellertray_commercial_v2_price_version_admin(
      second_price_id,'pause','Global command identity test',command_id,admin_user_id
    )
    from c2_price_lifecycle_command_fixture;
  exception when sqlstate '23505' then
    update c2_price_lifecycle_command_fixture set cross_target_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select cross_target_rejected from c2_price_lifecycle_command_fixture),
  'One lifecycle command ID cannot be reused for a different price version'
);

update c2_price_lifecycle_command_fixture f
set retry_result=public.control_sellertray_commercial_v2_price_version_admin(
  f.first_price_id,'pause','Global command identity test',f.command_id,f.admin_user_id
);

select extensions.ok(
  coalesce((select (retry_result->>'alreadyApplied')::boolean from c2_price_lifecycle_command_fixture),false),
  'An exact lifecycle command retry returns the existing result without another mutation'
);

select * from extensions.finish();
rollback;
