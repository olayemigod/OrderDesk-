begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

create temp table sellertray_agreement_fixture (
  admin_user_id uuid not null,
  owner_user_id uuid not null,
  manager_user_id uuid not null,
  staff_user_id uuid not null,
  tenant_id uuid not null,
  version_id uuid,
  acceptance_id uuid,
  staff_delegation_rejected boolean not null default false,
  manager_self_delegation_rejected boolean not null default false,
  merchant_publish_rejected boolean not null default false
) on commit drop;

insert into sellertray_agreement_fixture(
  admin_user_id,owner_user_id,manager_user_id,staff_user_id,tenant_id
) values (
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()
);

insert into auth.users(id,email,aud,role,created_at,updated_at)
select admin_user_id,'agreement-admin-'||substr(admin_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now() from sellertray_agreement_fixture
union all
select owner_user_id,'agreement-owner-'||substr(owner_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now() from sellertray_agreement_fixture
union all
select manager_user_id,'agreement-manager-'||substr(manager_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now() from sellertray_agreement_fixture
union all
select staff_user_id,'agreement-staff-'||substr(staff_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now() from sellertray_agreement_fixture;

insert into public.platform_admins(user_id,role)
select admin_user_id,'admin' from sellertray_agreement_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'Universal Agreement Tenant','universal-agreement-'||substr(tenant_id::text,1,8),'UAT','trial'
from sellertray_agreement_fixture;

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner' from sellertray_agreement_fixture
union all
select tenant_id,manager_user_id,'manager' from sellertray_agreement_fixture
union all
select tenant_id,staff_user_id,'staff' from sellertray_agreement_fixture;

select extensions.ok(
  to_regclass('public.sellertray_master_agreement_versions') is not null
  and to_regclass('public.sellertray_master_agreement_acceptances') is not null,
  'universal Master Agreement persistence exists'
);

select extensions.is(
  (select count(*)::integer from pg_class c where c.oid in (
    'public.sellertray_master_agreement_versions'::regclass,
    'public.sellertray_master_agreement_acceptances'::regclass
  ) and c.relrowsecurity),
  2,
  'Master Agreement persistence enables RLS'
);

select extensions.ok(
  not has_table_privilege('authenticated','public.sellertray_master_agreement_versions','SELECT')
  and not has_table_privilege('authenticated','public.sellertray_master_agreement_acceptances','INSERT')
  and not has_function_privilege('authenticated','public.accept_sellertray_master_agreement(uuid,uuid,text,jsonb,uuid,uuid)','EXECUTE'),
  'Master Agreement persistence and acceptance stay behind server authority'
);

select extensions.ok(
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='user_legal_acceptances' and column_name='terms_version')
  and exists(select 1 from information_schema.columns where table_schema='public' and table_name='user_legal_acceptances' and column_name='privacy_version')
  and not exists(select 1 from information_schema.columns where table_schema='public' and table_name='user_legal_acceptances' and column_name='tenant_id'),
  'user Terms/Privacy acceptance remains separate from Business Master Agreement acceptance'
);

select extensions.ok(
  public.sellertray_user_has_capability(
    (select tenant_id from sellertray_agreement_fixture),
    (select owner_user_id from sellertray_agreement_fixture),
    'can_accept_commercial_agreements'
  ),
  'Owner Master Agreement authority remains valid'
);

select extensions.ok(
  not public.sellertray_user_has_capability(
    (select tenant_id from sellertray_agreement_fixture),
    (select manager_user_id from sellertray_agreement_fixture),
    'can_accept_commercial_agreements'
  ),
  'Manager does not inherit signing authority by default'
);

select extensions.ok(
  not public.sellertray_user_has_capability(
    (select tenant_id from sellertray_agreement_fixture),
    (select staff_user_id from sellertray_agreement_fixture),
    'can_accept_commercial_agreements'
  ),
  'Staff/Cashier cannot hold Master Agreement signing authority'
);

do $$
begin
  begin
    perform public.set_sellertray_member_capability(
      f.tenant_id,f.staff_user_id,'can_accept_commercial_agreements',true,f.owner_user_id
    ) from sellertray_agreement_fixture f;
  exception when sqlstate '42501' then
    update sellertray_agreement_fixture set staff_delegation_rejected=true;
  end;
end
$$;
select extensions.ok((select staff_delegation_rejected from sellertray_agreement_fixture),'Owner cannot delegate signing authority to Staff/Cashier');

do $$
begin
  begin
    perform public.set_sellertray_member_capability(
      f.tenant_id,f.manager_user_id,'can_accept_commercial_agreements',true,f.manager_user_id
    ) from sellertray_agreement_fixture f;
  exception when sqlstate '42501' then
    update sellertray_agreement_fixture set manager_self_delegation_rejected=true;
  end;
end
$$;
select extensions.ok((select manager_self_delegation_rejected from sellertray_agreement_fixture),'Manager cannot self-delegate signing authority');

do $$
begin
  begin
    perform public.publish_sellertray_master_agreement_admin(
      'unauthorised-v1','SellerTray Master Agreement','Unauthorised publication',now(),
      'Merchant publication must fail',f.owner_user_id
    ) from sellertray_agreement_fixture f;
  exception when sqlstate '42501' then
    update sellertray_agreement_fixture set merchant_publish_rejected=true;
  end;
end
$$;
select extensions.ok((select merchant_publish_rejected from sellertray_agreement_fixture),'merchant users cannot publish the platform Master Agreement');

update sellertray_agreement_fixture f
set version_id=public.publish_sellertray_master_agreement_admin(
  'test-'||substr(f.tenant_id::text,1,8),
  'SellerTray Master Agreement',
  'Universal SellerTray agreement content for C1A retirement coverage',
  now()-interval '1 minute',
  'C1A retirement coverage publication',
  f.admin_user_id
);

select extensions.ok(
  exists(
    select 1 from public.sellertray_master_agreement_versions v
    join sellertray_agreement_fixture f on v.id=f.version_id
    where v.content_sha256=encode(extensions.digest(v.content_body,'sha256'),'hex')
      and char_length(v.content_sha256)=64
  ),
  'Master Agreement publication stores server-computed SHA-256 integrity evidence'
);

update sellertray_agreement_fixture f
set acceptance_id=public.accept_sellertray_master_agreement(
  f.tenant_id,f.version_id,'Test Business Owner',
  jsonb_build_object('channel','merchant_web','authority_confirmed',true),
  gen_random_uuid(),f.owner_user_id
);

select extensions.ok(
  public.sellertray_master_agreement_is_accepted(
    (select tenant_id from sellertray_agreement_fixture),now()
  ),
  'Business acceptance satisfies the current universal version'
);

select extensions.ok(
  exists(
    select 1 from public.sellertray_master_agreement_acceptances a
    join sellertray_agreement_fixture f on a.id=f.acceptance_id
    where a.tenant_id=f.tenant_id
      and a.agreement_version_id=f.version_id
      and a.accepted_by_user_id=f.owner_user_id
      and a.agreement_content_sha256=(select v.content_sha256 from public.sellertray_master_agreement_versions v where v.id=f.version_id)
  ),
  'acceptance snapshots Business, signer, version and content integrity without order identity'
);

select extensions.ok(
  not exists(select 1 from information_schema.columns where table_schema='public' and table_name='sellertray_master_agreement_acceptances' and column_name in ('commercial_order_id','installment_obligation_id','branch_id','plan_code','payment_id')),
  'Master Agreement acceptance has no order, installment, Branch, plan or payment identity'
);

select public.set_sellertray_member_capability(
  tenant_id,manager_user_id,'can_accept_commercial_agreements',true,owner_user_id
) from sellertray_agreement_fixture;
select extensions.ok(
  public.sellertray_user_has_capability(
    (select tenant_id from sellertray_agreement_fixture),
    (select manager_user_id from sellertray_agreement_fixture),
    'can_accept_commercial_agreements'
  ),
  'Owner may explicitly delegate Master Agreement acceptance to a Manager'
);
select extensions.ok(
  exists(
    select 1 from public.tenant_member_capability_events e
    join sellertray_agreement_fixture f on e.tenant_id=f.tenant_id and e.user_id=f.manager_user_id
    where e.capability='can_accept_commercial_agreements'
      and e.new_allowed=true
      and e.actor_user_id=f.owner_user_id
  ),
  'Manager signing delegation is immutably audited'
);

select extensions.throws_ok(
  $$select public.issue_sellertray_commercial_agreement(gen_random_uuid(),gen_random_uuid(),null,gen_random_uuid(),'LEGACY','Legacy',null,gen_random_uuid())$$,
  '0A000',null,
  'legacy merchant/order-specific agreement issuance is retired'
);
select extensions.throws_ok(
  $$select public.accept_sellertray_commercial_agreement(gen_random_uuid(),gen_random_uuid(),'Legacy','{}',gen_random_uuid(),gen_random_uuid())$$,
  '0A000',null,
  'legacy order-bound agreement acceptance is retired'
);

select extensions.ok(
  to_regclass('public.sellertray_commercial_agreement_template_versions') is not null
  and to_regclass('public.sellertray_commercial_agreements') is not null
  and to_regclass('public.sellertray_commercial_agreement_acceptances') is not null,
  'legacy C1A persistence remains for historical evidence'
);

select extensions.throws_ok(
  format('update public.sellertray_master_agreement_versions set title=%L where id=%L','Rewritten title',f.version_id),
  '55000',null,
  'published Master Agreement versions are immutable'
) from sellertray_agreement_fixture f;

select extensions.throws_ok(
  format('delete from public.sellertray_master_agreement_acceptances where id=%L',f.acceptance_id),
  '55000',null,
  'Master Agreement acceptance evidence is immutable'
) from sellertray_agreement_fixture f;

select * from extensions.finish();
rollback;
