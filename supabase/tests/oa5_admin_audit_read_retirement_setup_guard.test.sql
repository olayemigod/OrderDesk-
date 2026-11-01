begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(9);

create temp table oa5_review_fixture(
  actor uuid,
  tenant uuid
);
insert into oa5_review_fixture values(gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role)
select actor,'oa5-review-'||actor||'@example.com','authenticated','authenticated'
from oa5_review_fixture;

insert into public.platform_admins(user_id,role)
select actor,'support'
from oa5_review_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant,'OA5 Review Fixture','oa5-review-'||tenant,'O5R','active'
from oa5_review_fixture;

insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
select actor,tenant,'oa5_review_fixture','{"source":"pgtap"}'::jsonb
from oa5_review_fixture;

select extensions.lives_ok(
  format(
    'select public.platform_admin_audit_explorer(%L::uuid,p_limit=>1)',
    actor
  ),
  'existing Support audit read remains compatible when no explicit read assignment exists'
)
from oa5_review_fixture;

insert into public.platform_admin_capability_grant_versions(
  grantee_user_id,
  capability_code,
  scope_kind,
  tenant_id,
  enabled,
  effective_from,
  created_by_user_id,
  reason
)
select
  actor,
  'admin.audit.read',
  'platform',
  null,
  false,
  now()-interval '1 minute',
  actor,
  'Explicit audit read denial regression fixture'
from oa5_review_fixture;

select extensions.throws_ok(
  format(
    'select public.platform_admin_audit_explorer(%L::uuid,p_limit=>1)',
    actor
  ),
  '42501',
  'Audit read capability required',
  'explicit admin.audit.read denial fails closed server-side'
)
from oa5_review_fixture;

select extensions.ok(
  position(
    'admin.audit.read'
    in lower(
      pg_get_functiondef(
        'public.platform_admin_audit_explorer(uuid,text,text,text,text,timestamptz,timestamptz,timestamptz,uuid,integer,boolean)'::regprocedure
      )
    )
  )>0,
  'audit explorer contains the governed read capability gate'
);

select extensions.ok(
  position(
    'retired_at'
    in lower(
      pg_get_functiondef(
        'public.assert_sellertray_setup_subject(uuid,uuid,uuid)'::regprocedure
      )
    )
  )>0,
  'setup subject rejects retired Businesses'
);

select extensions.ok(
  position(
    'is_active'
    in lower(
      pg_get_functiondef(
        'public.assert_sellertray_setup_subject(uuid,uuid,uuid)'::regprocedure
      )
    )
  )=0,
  'setup subject still permits legitimate inactive preparation Branches'
);

with scheduler as (
  select lower(
    pg_get_functiondef(
      'public.platform_admin_schedule_branch_setup(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,text,uuid,text)'::regprocedure
    )
  ) as definition
)
select extensions.ok(
  position('from public.tenants t' in definition)>0
  and position('retired_at' in definition)>0
  and position('for update' in definition)>0
  and position('for update' in definition)
      < position('perform public.assert_sellertray_setup_subject' in definition),
  'setup scheduling locks the Business row and checks retirement before reserving capacity'
)
from scheduler;

with retirement as (
  select lower(
    pg_get_functiondef(
      'public.retire_sellertray_tenant_admin(uuid,uuid,text,uuid)'::regprocedure
    )
  ) as definition
)
select extensions.ok(
  position('from public.tenants t' in definition)>0
  and position('for update' in definition)>0,
  'Business retirement uses the same Business-row serialization boundary'
)
from retirement;

update public.platform_admins
set role='admin'
where user_id=(select actor from oa5_review_fixture);

select extensions.lives_ok(
  format(
    'select public.retire_sellertray_tenant_admin(%L::uuid,%L::uuid,%L,%L::uuid)',
    actor,
    tenant,
    'OA5 review fixture retirement',
    gen_random_uuid()
  ),
  'fixture Business retires through the governed Admin command'
)
from oa5_review_fixture;

select extensions.throws_ok(
  format(
    'select public.platform_admin_schedule_branch_setup(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,now()+interval ''2 days'',now()+interval ''2 days 1 hour'',null,null,%L::uuid,%L)',
    actor,
    tenant,
    gen_random_uuid(),
    gen_random_uuid(),
    gen_random_uuid(),
    gen_random_uuid(),
    gen_random_uuid(),
    'Post-retirement scheduling denial regression'
  ),
  '23514',
  'Retired Businesses cannot receive setup reservations',
  'retired Business cannot acquire a new setup reservation'
)
from oa5_review_fixture;

select * from extensions.finish();
rollback;
