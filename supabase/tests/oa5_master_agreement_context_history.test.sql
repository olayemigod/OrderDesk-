begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

create temp table oa5_master_context_fixture (
  admin_id uuid default gen_random_uuid(),
  owner_a_id uuid default gen_random_uuid(),
  owner_b_id uuid default gen_random_uuid(),
  tenant_a_id uuid default gen_random_uuid(),
  tenant_b_id uuid default gen_random_uuid(),
  version_1_id uuid,
  version_2_id uuid,
  quarantine_version_id uuid
) on commit drop;
insert into oa5_master_context_fixture default values;

insert into auth.users(id,email,aud,role,created_at,updated_at)
select admin_id,'oa5-m-admin-'||substr(admin_id::text,1,8)||'@example.com',
'authenticated','authenticated',now(),now() from oa5_master_context_fixture
union all
select owner_a_id,'oa5-m-a-'||substr(owner_a_id::text,1,8)||'@example.com',
'authenticated','authenticated',now(),now() from oa5_master_context_fixture
union all
select owner_b_id,'oa5-m-b-'||substr(owner_b_id::text,1,8)||'@example.com',
'authenticated','authenticated',now(),now() from oa5_master_context_fixture;

insert into public.platform_admins(user_id,role)
select admin_id,'admin' from oa5_master_context_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_a_id,'OA5 Master Acceptance A','oa5-master-a-'||substr(tenant_a_id::text,1,8),'OAA','trial'
from oa5_master_context_fixture
union all
select tenant_b_id,'OA5 Master Acceptance B','oa5-master-b-'||substr(tenant_b_id::text,1,8),'OAB','trial'
from oa5_master_context_fixture;

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_a_id,owner_a_id,'owner' from oa5_master_context_fixture
union all
select tenant_b_id,owner_b_id,'owner' from oa5_master_context_fixture;

update oa5_master_context_fixture f
set version_1_id=public.publish_sellertray_master_agreement_admin(
  'oa5-context-v1-'||substr(f.admin_id::text,1,8),
  'SellerTray Master Agreement','Master agreement version one.',
  now()-interval '2 minutes','Acceptance context test v1',f.admin_id
);

select public.accept_sellertray_master_agreement(
  f.tenant_a_id,f.version_1_id,'Owner A',
  jsonb_build_object('channel','merchant_web','authority_confirmed',true),
  gen_random_uuid(),f.owner_a_id
) from oa5_master_context_fixture f;

update oa5_master_context_fixture f
set version_2_id=public.publish_sellertray_master_agreement_admin(
  'oa5-context-v2-'||substr(f.admin_id::text,1,8),
  'SellerTray Master Agreement','Master agreement version two.',
  now()-interval '1 second','Acceptance context test v2',f.admin_id
);

select public.accept_sellertray_master_agreement(
  f.tenant_b_id,f.version_2_id,'Owner B',
  jsonb_build_object('channel','merchant_web','authority_confirmed',true),
  gen_random_uuid(),f.owner_b_id
) from oa5_master_context_fixture f;

select extensions.ok(
  (public.get_sellertray_master_agreement_admin(f.admin_id,f.tenant_a_id)->'acceptedVersionIds') @>
     jsonb_build_array(f.version_1_id)
  and not (public.get_sellertray_master_agreement_admin(f.admin_id,f.tenant_a_id)->'acceptedVersionIds') @>
     jsonb_build_array(f.version_2_id),
  'Business A accepted history includes v1 only, not published/unaccepted v2'
) from oa5_master_context_fixture f;

select extensions.ok(
  (public.get_sellertray_master_agreement_admin(f.admin_id,f.tenant_b_id)->'acceptedVersionIds') @>
     jsonb_build_array(f.version_2_id)
  and not (public.get_sellertray_master_agreement_admin(f.admin_id,f.tenant_b_id)->'acceptedVersionIds') @>
     jsonb_build_array(f.version_1_id),
  'Business B accepted history includes v2 only, not Business A acceptance'
) from oa5_master_context_fixture f;

select extensions.is(
  jsonb_array_length(public.get_sellertray_master_agreement_admin(f.admin_id,f.tenant_a_id)->'acceptedVersionIds'),
  1,'exact Merchant accepted history has no duplicates or unrelated versions'
) from oa5_master_context_fixture f;

select extensions.ok(
  (public.get_sellertray_master_agreement_admin(f.admin_id,f.tenant_a_id)->'tenantState'->>'acceptanceRequired')::boolean,
  'unaccepted current v2 remains separately presented as pending for Business A'
) from oa5_master_context_fixture f;

select extensions.ok(
  jsonb_array_length(public.get_sellertray_master_agreement_admin(f.admin_id,f.tenant_a_id)->'versions')>=2
  and jsonb_array_length(public.get_sellertray_master_agreement_admin(f.admin_id,f.tenant_b_id)->'versions')>=2,
  'universal published version history remains intact for authorised platform governance'
) from oa5_master_context_fixture f;

select extensions.is(
  public.get_sellertray_master_agreement_admin(f.admin_id,null)->'acceptedVersionIds',
  '[]'::jsonb,
  'platform-wide publication context does not borrow a selected Business acceptance'
) from oa5_master_context_fixture f;

-- The immutable global publication history may contain quarantined QA
-- versions. They must never become the current *required* legal version,
-- affect merchant acceptance, or prevent an already accepted Business
-- from qualifying for service delivery.
update oa5_master_context_fixture f
set quarantine_version_id=public.publish_sellertray_master_agreement_admin(
  'oa5-context-qa-'||substr(f.admin_id::text,1,8),
  'NON-PRODUCTION QA Master',
  'Quarantined QA content cannot become the required Merchant Master.',
  now(),'QA-only quarantine resolution regression',f.admin_id
);

insert into public.sellertray_master_agreement_version_quarantines(
  agreement_version_id,reason,quarantined_by_user_id
)
select quarantine_version_id,'Non-production QA version excluded from merchant requirement',admin_id
from oa5_master_context_fixture;

select extensions.is(
  public.resolve_sellertray_master_agreement_version_id(now()),
  f.version_2_id,
  'Quarantined newer QA version is excluded from the current Master resolver'
) from oa5_master_context_fixture f;

select extensions.ok(
  (public.get_sellertray_master_agreement_state(f.tenant_b_id,now())->>'accepted')::boolean
  and not (public.get_sellertray_master_agreement_state(f.tenant_b_id,now())->>'acceptanceRequired')::boolean,
  'Already accepted current Master v2 remains valid for service delivery after QA quarantine'
) from oa5_master_context_fixture f;

select extensions.ok(
  (public.get_sellertray_master_agreement_state(f.tenant_a_id,now())->'currentVersion'->>'id')::uuid=f.version_2_id
  and (public.get_sellertray_master_agreement_state(f.tenant_a_id,now())->>'acceptanceRequired')::boolean,
  'Business A still awaits v2, not the quarantined QA version'
) from oa5_master_context_fixture f;

select extensions.ok(
  exists(
    select 1 from jsonb_array_elements(public.get_sellertray_master_agreement_admin(f.admin_id,f.tenant_a_id)->'versions') v
    where v->>'id'=f.quarantine_version_id::text
      and (v->>'quarantined')::boolean
  )
  and not (public.get_sellertray_master_agreement_admin(f.admin_id,f.tenant_a_id)->'acceptedVersionIds')
    @>jsonb_build_array(f.quarantine_version_id),
  'Quarantined QA version remains identifiable in platform history, never merchant accepted history'
) from oa5_master_context_fixture f;

select * from extensions.finish();
rollback;
