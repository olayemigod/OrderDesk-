begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(2);

create temp table agreement_no_master_fixture(
  owner_user_id uuid not null,
  tenant_id uuid not null
) on commit drop;
insert into agreement_no_master_fixture values(gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_user_id,'no-master-'||substr(owner_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from agreement_no_master_fixture;
insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'No Master Agreement Business','no-master-'||substr(tenant_id::text,1,8),'NM1','trial'
from agreement_no_master_fixture;
insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner' from agreement_no_master_fixture;

select extensions.is(
  public.resolve_sellertray_master_agreement_version_id(now()),
  null::uuid,
  'agreement-package migrations do not seed or invent a Master Agreement version'
);

select extensions.is(
  public.get_sellertray_agreement_package_center(f.tenant_id,f.owner_user_id)->'masterAgreement',
  'null'::jsonb,
  'merchant package center returns a clean null Master Agreement when nothing is published'
) from agreement_no_master_fixture f;

select * from extensions.finish();
rollback;
