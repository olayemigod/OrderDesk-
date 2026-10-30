begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(13);

select extensions.ok(
  to_regclass('public.sellertray_master_agreement_version_quarantines') is not null,
  'Master Agreement publication quarantine has dedicated immutable authority'
);
select extensions.ok(
  (select c.relrowsecurity
   from pg_class c
   where c.oid='public.sellertray_master_agreement_version_quarantines'::regclass),
  'Master Agreement publication quarantine is protected by RLS'
);
select extensions.ok(
  not has_table_privilege(
    'authenticated','public.sellertray_master_agreement_version_quarantines','SELECT'
  ),
  'merchant clients cannot read quarantine evidence directly'
);
select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.quarantine_sellertray_master_agreement_version_admin(uuid,text,uuid)',
    'EXECUTE'
  ),
  'merchant clients cannot quarantine Master Agreement publications'
);
select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.quarantine_sellertray_master_agreement_version_admin(uuid,text,uuid)',
    'EXECUTE'
  ),
  'verified server authority can execute the governed quarantine command'
);

create temp table master_quarantine_fixture(
  admin_user_id uuid not null,
  owner_user_id uuid not null,
  tenant_id uuid not null,
  version_1_id uuid,
  version_2_id uuid,
  acceptance_1_id uuid,
  quarantine_id uuid,
  command_id uuid not null,
  immutable_update_rejected boolean not null default false
) on commit drop;

insert into master_quarantine_fixture(
  admin_user_id,owner_user_id,tenant_id,command_id
) values (
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()
);

insert into auth.users(id,email,aud,role,created_at,updated_at)
select admin_user_id,'quarantine-admin-'||substr(admin_user_id::text,1,8)||'@example.com',
       'authenticated','authenticated',now(),now()
from master_quarantine_fixture
union all
select owner_user_id,'quarantine-owner-'||substr(owner_user_id::text,1,8)||'@example.com',
       'authenticated','authenticated',now(),now()
from master_quarantine_fixture;

insert into public.platform_admins(user_id,role)
select admin_user_id,'admin' from master_quarantine_fixture;
insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'Master Quarantine Business','master-quarantine-'||substr(tenant_id::text,1,8),
       'MQA','trial'
from master_quarantine_fixture;
insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner' from master_quarantine_fixture;

update master_quarantine_fixture f
set version_1_id=public.publish_sellertray_master_agreement_admin(
  'master-quarantine-v1-'||substr(f.admin_user_id::text,1,8),
  'SellerTray Master Agreement',
  'Valid production-style Master Agreement fixture version one.',
  now()-interval '3 minutes',
  'Publish valid quarantine baseline version',
  f.admin_user_id
);

update master_quarantine_fixture f
set acceptance_1_id=public.accept_sellertray_master_agreement(
  f.tenant_id,f.version_1_id,'Quarantine Fixture Owner',
  jsonb_build_object('channel','merchant_web','authority_confirmed',true),
  f.command_id,f.owner_user_id
);

update master_quarantine_fixture f
set version_2_id=public.publish_sellertray_master_agreement_admin(
  'master-quarantine-v2-'||substr(f.admin_user_id::text,1,8),
  'QA ONLY — Invalid production publication fixture',
  'Non-production Master Agreement fixture that must be excluded without mutation.',
  now()-interval '1 minute',
  'Publish quarantine target fixture',
  f.admin_user_id
);

select extensions.is(
  public.resolve_sellertray_master_agreement_version_id(now()),
  (select version_2_id from master_quarantine_fixture),
  'latest effective publication resolves before it is quarantined'
);

update master_quarantine_fixture f
set quarantine_id=public.quarantine_sellertray_master_agreement_version_admin(
  f.version_2_id,
  'Quarantine non-production fixture from current legal authority',
  f.admin_user_id
);

select extensions.is(
  public.resolve_sellertray_master_agreement_version_id(now()),
  (select version_1_id from master_quarantine_fixture),
  'quarantined publication is excluded and resolver falls back to prior valid version'
);
select extensions.ok(
  (select public.sellertray_master_agreement_is_accepted(f.tenant_id,now())
   from master_quarantine_fixture f),
  'existing acceptance of prior valid version becomes the current service-delivery acceptance again'
);
select extensions.is(
  (select count(*)::integer
   from jsonb_array_elements(
     public.get_sellertray_master_agreement_center(f.tenant_id,f.owner_user_id)->'versions'
   ) item
   where item->>'id'=f.version_2_id::text),
  0,
  'Merchant agreement history does not expose quarantined invalid publication'
) from master_quarantine_fixture f;
select extensions.ok(
  (select exists(
    select 1
    from jsonb_array_elements(
      public.get_sellertray_master_agreement_admin(f.admin_user_id,f.tenant_id)->'versions'
    ) item
    where item->>'id'=f.version_2_id::text
      and (item->>'quarantined')::boolean=true
      and item->>'quarantineReason'='Quarantine non-production fixture from current legal authority'
  ) from master_quarantine_fixture f),
  'Admin retains quarantined publication and correction evidence in legal history'
);
select extensions.is(
  (select public.quarantine_sellertray_master_agreement_version_admin(
    f.version_2_id,
    'Exact retry may carry the original governed correction context',
    f.admin_user_id
  ) from master_quarantine_fixture f),
  (select quarantine_id from master_quarantine_fixture),
  'quarantine command is idempotent for an already quarantined version'
);
select extensions.is(
  (select count(*)::integer
   from public.platform_admin_audit a
   join master_quarantine_fixture f on a.actor_user_id=f.admin_user_id
   where a.action='sellertray_master_agreement_version_quarantined'
     and a.detail->>'agreementVersionId'=f.version_2_id::text),
  1,
  'quarantine writes one immutable privileged-action audit record'
);

do $$
begin
  begin
    update public.sellertray_master_agreement_version_quarantines
    set reason='mutated reason'
    where id=(select quarantine_id from master_quarantine_fixture);
  exception when sqlstate '55000' then
    update master_quarantine_fixture set immutable_update_rejected=true;
  end;
end
$$;
select extensions.ok(
  (select immutable_update_rejected from master_quarantine_fixture),
  'quarantine evidence cannot be edited after creation'
);

select * from extensions.finish();
rollback;
