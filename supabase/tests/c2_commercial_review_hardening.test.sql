begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(8);

select extensions.ok(
  position('for update' in lower(pg_get_functiondef(
    'public.publish_sellertray_plan_profile_version_admin(uuid,timestamptz,text,uuid)'::regprocedure
  ))) > 0
  and position('for update' in lower(pg_get_functiondef(
    'public.publish_sellertray_plan_profile_version_admin(uuid,timestamptz,text,uuid)'::regprocedure
  ))) < position('requires governed entitlement content' in lower(pg_get_functiondef(
    'public.publish_sellertray_plan_profile_version_admin(uuid,timestamptz,text,uuid)'::regprocedure
  ))),
  'Plan Profile publication locks the parent before entitlement validation'
);

select extensions.ok(
  position('for update' in lower(pg_get_functiondef(
    'public.publish_sellertray_addon_version_admin(uuid,timestamptz,text,uuid)'::regprocedure
  ))) > 0
  and position('for update' in lower(pg_get_functiondef(
    'public.publish_sellertray_addon_version_admin(uuid,timestamptz,text,uuid)'::regprocedure
  ))) < position('requires governed entitlement content' in lower(pg_get_functiondef(
    'public.publish_sellertray_addon_version_admin(uuid,timestamptz,text,uuid)'::regprocedure
  ))),
  'Add-on publication locks the parent before entitlement validation'
);

select extensions.ok(
  position('pg_advisory_xact_lock' in pg_get_functiondef(
    'public.control_sellertray_commercial_v2_price_version_admin(uuid,text,text,uuid,uuid)'::regprocedure
  )) > 0
  and position('pg_advisory_xact_lock' in pg_get_functiondef(
    'public.control_sellertray_commercial_v2_price_version_admin(uuid,text,text,uuid,uuid)'::regprocedure
  )) < position('v_state:=' in pg_get_functiondef(
    'public.control_sellertray_commercial_v2_price_version_admin(uuid,text,text,uuid,uuid)'::regprocedure
  ))
  and position('sellertray-price-lifecycle-v1' in pg_get_functiondef(
    'public.control_sellertray_commercial_v2_price_version_admin(uuid,text,text,uuid,uuid)'::regprocedure
  )) > 0,
  'C2 price lifecycle serializes before state validation and shares the legacy Branch-setup lock identity'
);

select extensions.ok(
  position('resolve_sellertray_commercial_price_version(' in pg_get_functiondef(
    'public.sellertray_commercial_standard_price_is_governed(uuid,timestamptz)'::regprocedure
  )) > 0
  and position('resolve_sellertray_commercial_v2_price_version(' in pg_get_functiondef(
    'public.sellertray_commercial_standard_price_is_governed(uuid,timestamptz)'::regprocedure
  )) > 0
  and position('sellertray_commercial_price_version_state' in pg_get_functiondef(
    'public.sellertray_commercial_standard_price_is_governed(uuid,timestamptz)'::regprocedure
  )) > 0,
  'Override source validation converges legacy and C2 standard resolvers with lifecycle state'
);

select extensions.ok(
  position('v_standard.charge_type_code' in pg_get_functiondef(
    'public.publish_sellertray_merchant_branch_setup_price_override_admin(uuid,text,numeric,timestamptz,timestamptz,text,uuid)'::regprocedure
  )) > 0
  and position('v_standard.commercial_tax_profile_version_id' in pg_get_functiondef(
    'public.publish_sellertray_merchant_branch_setup_price_override_admin(uuid,text,numeric,timestamptz,timestamptz,text,uuid)'::regprocedure
  )) > 0,
  'Legacy Branch-setup override publisher copies Commercial V2 source bindings'
);

create temp table c2_commercial_review_fixture (
  admin_user_id uuid not null,
  tenant_id uuid not null,
  c2_setup_source_id uuid,
  legacy_override_id uuid,
  paused_source_id uuid,
  superseded_old_source_id uuid,
  superseded_new_source_id uuid,
  paused_source_rejected boolean not null default false,
  superseded_source_rejected boolean not null default false
) on commit drop;

insert into c2_commercial_review_fixture(admin_user_id,tenant_id)
values(gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select admin_user_id,
       'c2-commercial-review-'||substr(admin_user_id::text,1,8)||'@example.com',
       'authenticated','authenticated',now(),now()
from c2_commercial_review_fixture;

insert into public.platform_admins(user_id,role)
select admin_user_id,'admin'
from c2_commercial_review_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,
       'C2 Commercial Review',
       'c2-commercial-review-'||substr(tenant_id::text,1,8),
       'C2H',
       'trial'
from c2_commercial_review_fixture;

with inserted as (
  insert into public.sellertray_commercial_price_versions(
    price_kind,charge_type_code,plan_code,plan_profile_version_id,addon_version_id,billing_cycle,
    currency,gross_amount,tax_inclusive,effective_from,status,change_reason,
    created_by_user_id,approved_by_user_id,approved_at,price_scope
  )
  select 'branch_setup','branch_setup',null,null,null,null,
         'NGN',10000,true,'2026-01-01T00:00:00Z','published','C2 setup source',
         admin_user_id,admin_user_id,now(),'standard'
  from c2_commercial_review_fixture
  returning id
)
update c2_commercial_review_fixture
set c2_setup_source_id=(select id from inserted);

update c2_commercial_review_fixture f
set legacy_override_id=public.publish_sellertray_merchant_branch_setup_price_override_admin(
  f.tenant_id,
  'NGN',
  8500,
  '2026-01-15T00:00:00Z',
  null,
  'C2 setup compatibility override',
  f.admin_user_id
);

select extensions.ok(
  exists(
    select 1
    from public.sellertray_commercial_price_versions p
    join c2_commercial_review_fixture f on f.legacy_override_id=p.id
    where p.price_scope='merchant_override'
      and p.source_standard_price_version_id=f.c2_setup_source_id
      and p.charge_type_code='branch_setup'
      and p.commercial_tax_profile_version_id is null
  ),
  'Legacy Branch-setup override succeeds when its governed standard source carries C2 bindings'
);

with inserted as (
  insert into public.sellertray_commercial_price_versions(
    price_kind,charge_type_code,plan_code,plan_profile_version_id,addon_version_id,billing_cycle,
    currency,gross_amount,tax_inclusive,effective_from,status,change_reason,
    created_by_user_id,approved_by_user_id,approved_at,price_scope
  )
  select 'branch_setup','branch_setup',null,null,null,null,
         'USD',100,true,'2026-01-01T00:00:00Z','published','Paused setup source',
         admin_user_id,admin_user_id,now(),'standard'
  from c2_commercial_review_fixture
  returning id
)
update c2_commercial_review_fixture
set paused_source_id=(select id from inserted);

insert into public.sellertray_commercial_price_version_controls(
  price_version_id,control_action,command_id,controlled_by_user_id,effective_at,reason
)
select paused_source_id,'pause',gen_random_uuid(),admin_user_id,clock_timestamp(),'Pause source for override test'
from c2_commercial_review_fixture;

do $$
begin
  begin
    insert into public.sellertray_commercial_price_versions(
      price_kind,charge_type_code,plan_code,plan_profile_version_id,addon_version_id,billing_cycle,
      currency,gross_amount,tax_inclusive,effective_from,status,change_reason,
      created_by_user_id,approved_by_user_id,approved_at,
      tenant_id,price_scope,source_standard_price_version_id
    )
    select 'branch_setup','branch_setup',null,null,null,null,
           'USD',90,true,'2026-02-01T00:00:00Z','published','Invalid paused-source override',
           admin_user_id,admin_user_id,now(),tenant_id,'merchant_override',paused_source_id
    from c2_commercial_review_fixture;
  exception when sqlstate '23514' then
    update c2_commercial_review_fixture set paused_source_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select paused_source_rejected from c2_commercial_review_fixture),
  'A paused standard price cannot be used to create a fresh Business override'
);

with inserted as (
  insert into public.sellertray_commercial_price_versions(
    price_kind,charge_type_code,plan_code,plan_profile_version_id,addon_version_id,billing_cycle,
    currency,gross_amount,tax_inclusive,effective_from,status,change_reason,
    created_by_user_id,approved_by_user_id,approved_at,price_scope
  )
  select 'branch_setup','branch_setup',null,null,null,null,
         'EUR',100,true,'2026-01-01T00:00:00Z','published','Old setup source',
         admin_user_id,admin_user_id,now(),'standard'
  from c2_commercial_review_fixture
  returning id
)
update c2_commercial_review_fixture
set superseded_old_source_id=(select id from inserted);

with inserted as (
  insert into public.sellertray_commercial_price_versions(
    price_kind,charge_type_code,plan_code,plan_profile_version_id,addon_version_id,billing_cycle,
    currency,gross_amount,tax_inclusive,effective_from,status,change_reason,
    created_by_user_id,approved_by_user_id,approved_at,price_scope
  )
  select 'branch_setup','branch_setup',null,null,null,null,
         'EUR',120,true,'2026-06-01T00:00:00Z','published','Replacement setup source',
         admin_user_id,admin_user_id,now(),'standard'
  from c2_commercial_review_fixture
  returning id
)
update c2_commercial_review_fixture
set superseded_new_source_id=(select id from inserted);

do $$
begin
  begin
    insert into public.sellertray_commercial_price_versions(
      price_kind,charge_type_code,plan_code,plan_profile_version_id,addon_version_id,billing_cycle,
      currency,gross_amount,tax_inclusive,effective_from,status,change_reason,
      created_by_user_id,approved_by_user_id,approved_at,
      tenant_id,price_scope,source_standard_price_version_id
    )
    select 'branch_setup','branch_setup',null,null,null,null,
           'EUR',95,true,'2026-07-01T00:00:00Z','published','Invalid superseded-source override',
           admin_user_id,admin_user_id,now(),tenant_id,'merchant_override',superseded_old_source_id
    from c2_commercial_review_fixture;
  exception when sqlstate '23514' then
    update c2_commercial_review_fixture set superseded_source_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select superseded_source_rejected from c2_commercial_review_fixture),
  'A superseded standard price cannot be used to create a fresh Business override'
);

select * from extensions.finish();
rollback;
