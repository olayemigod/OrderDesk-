begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(25);

select extensions.ok(
  to_regclass('public.sellertray_master_agreement_versions') is not null,
  'Master Agreement versions have dedicated platform-wide authority'
);
select extensions.ok(
  to_regclass('public.sellertray_master_agreement_acceptances') is not null,
  'Master Agreement acceptances have dedicated Business/version authority'
);
select extensions.ok(
  (select c.relrowsecurity from pg_class c where c.oid='public.sellertray_master_agreement_versions'::regclass),
  'Master Agreement versions are protected by RLS'
);
select extensions.ok(
  (select c.relrowsecurity from pg_class c where c.oid='public.sellertray_master_agreement_acceptances'::regclass),
  'Master Agreement acceptances are protected by RLS'
);
select extensions.ok(
  not has_table_privilege('authenticated','public.sellertray_master_agreement_versions','SELECT'),
  'merchant clients cannot read universal agreement tables directly'
);
select extensions.ok(
  not has_table_privilege('authenticated','public.sellertray_master_agreement_acceptances','SELECT'),
  'merchant clients cannot read acceptance evidence directly'
);
select extensions.ok(
  not has_function_privilege('authenticated','public.publish_sellertray_master_agreement_admin(text,text,text,timestamptz,text,uuid)','EXECUTE'),
  'authenticated merchant clients cannot publish Master Agreement versions'
);
select extensions.ok(
  not has_function_privilege('authenticated','public.accept_sellertray_master_agreement(uuid,uuid,text,jsonb,uuid,uuid)','EXECUTE'),
  'authenticated clients cannot spoof Master Agreement accepting actors directly'
);
select extensions.ok(
  has_function_privilege('service_role','public.accept_sellertray_master_agreement(uuid,uuid,text,jsonb,uuid,uuid)','EXECUTE'),
  'verified server boundary can record Master Agreement acceptance'
);
select extensions.is(
  (select count(*)::integer from information_schema.columns
   where table_schema='public'
     and table_name='sellertray_master_agreement_acceptances'
     and column_name in ('commercial_order_id','installment_obligation_id','branch_id','plan_code','payment_id')),
  0,
  'Master Agreement acceptance identity is independent of order, installment, Branch, plan and payment'
);
select extensions.ok(
  position('sellertray_master_agreement_accepted_at' in lower(pg_get_functiondef('public.reconcile_sellertray_installment_entitlement(uuid,uuid)'::regprocedure))) > 0,
  'service-delivery reconciliation checks universal Master Agreement acceptance'
);
select extensions.ok(
  position('sellertray_commercial_agreement_acceptances' in lower(pg_get_functiondef('public.reconcile_sellertray_installment_entitlement(uuid,uuid)'::regprocedure))) = 0,
  'service-delivery reconciliation no longer consumes legacy order-bound agreement acceptance'
);
select extensions.ok(
  position('''checkouteligible'',true' in replace(lower(pg_get_functiondef('public.get_sellertray_installment_contract_checkout_policy(uuid,uuid,timestamptz)'::regprocedure)),' ','')) > 0,
  'payment checkout remains independent of Master Agreement acceptance'
);
select extensions.ok(
  position('legacy order-bound agreement acceptance is retired' in lower(pg_get_functiondef('public.accept_sellertray_commercial_agreement(uuid,uuid,text,jsonb,uuid,uuid)'::regprocedure))) > 0,
  'legacy order-bound acceptance command is retired'
);
select extensions.ok(
  position('legacy merchant/order-specific agreement issuance is retired' in lower(pg_get_functiondef('public.issue_sellertray_commercial_agreement(uuid,uuid,uuid,uuid,text,text,uuid,uuid)'::regprocedure))) > 0,
  'legacy merchant-specific agreement issuance is retired'
);

create temp table master_agreement_fixture(
  admin_user_id uuid not null,
  owner_a_id uuid not null,
  owner_b_id uuid not null,
  staff_a_id uuid not null,
  tenant_a_id uuid not null,
  tenant_b_id uuid not null,
  version_1_id uuid,
  version_2_id uuid,
  command_id uuid not null,
  acceptance_1_id uuid
) on commit drop;

insert into master_agreement_fixture(
  admin_user_id,owner_a_id,owner_b_id,staff_a_id,tenant_a_id,tenant_b_id,command_id
) values (
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()
);

insert into auth.users(id,email,aud,role,created_at,updated_at)
select admin_user_id,'master-admin-'||substr(admin_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now() from master_agreement_fixture
union all
select owner_a_id,'master-owner-a-'||substr(owner_a_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now() from master_agreement_fixture
union all
select owner_b_id,'master-owner-b-'||substr(owner_b_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now() from master_agreement_fixture
union all
select staff_a_id,'master-staff-a-'||substr(staff_a_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now() from master_agreement_fixture;

insert into public.platform_admins(user_id,role)
select admin_user_id,'admin' from master_agreement_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_a_id,'Master Agreement Business A','master-a-'||substr(tenant_a_id::text,1,8),'MAA','trial' from master_agreement_fixture
union all
select tenant_b_id,'Master Agreement Business B','master-b-'||substr(tenant_b_id::text,1,8),'MAB','trial' from master_agreement_fixture;

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_a_id,owner_a_id,'owner' from master_agreement_fixture
union all
select tenant_b_id,owner_b_id,'owner' from master_agreement_fixture
union all
select tenant_a_id,staff_a_id,'staff' from master_agreement_fixture;

update master_agreement_fixture f
set version_1_id=public.publish_sellertray_master_agreement_admin(
  'master-test-v1-'||substr(f.admin_user_id::text,1,8),
  'SellerTray Master Agreement',
  'Universal agreement test version one.',
  now()-interval '2 minutes',
  'Publish test version one',
  f.admin_user_id
);

select extensions.is(
  public.resolve_sellertray_master_agreement_version_id(now()),
  (select version_1_id from master_agreement_fixture),
  'one platform-wide current version is resolved independently of merchant'
);
select extensions.is(
  public.get_sellertray_master_agreement_state(f.tenant_a_id,now())->'currentVersion'->>'id',
  public.get_sellertray_master_agreement_state(f.tenant_b_id,now())->'currentVersion'->>'id',
  'different Businesses receive the exact same current Master Agreement version'
) from master_agreement_fixture f;

update master_agreement_fixture f
set acceptance_1_id=public.accept_sellertray_master_agreement(
  f.tenant_a_id,f.version_1_id,'Business A Owner',
  jsonb_build_object('channel','merchant_web','authority_confirmed',true),
  f.command_id,f.owner_a_id
);

select extensions.is(
  public.accept_sellertray_master_agreement(
    f.tenant_a_id,f.version_1_id,'Business A Owner',
    jsonb_build_object('channel','merchant_web','authority_confirmed',true),
    f.command_id,f.owner_a_id
  ),
  f.acceptance_1_id,
  'exact Master Agreement acceptance replay returns the committed acceptance'
) from master_agreement_fixture f;
select extensions.is(
  (select count(*)::integer from public.sellertray_master_agreement_acceptances a join master_agreement_fixture f on a.tenant_id=f.tenant_a_id and a.agreement_version_id=f.version_1_id),
  1,
  'Business/version acceptance is recorded once'
);
select extensions.ok(
  (select public.sellertray_master_agreement_is_accepted(f.tenant_a_id,now()) from master_agreement_fixture f),
  'Business A satisfies the current Master Agreement after accepting it once'
);
select extensions.ok(
  not (select public.sellertray_master_agreement_is_accepted(f.tenant_b_id,now()) from master_agreement_fixture f),
  'Business A acceptance never satisfies Business B'
);
select extensions.throws_ok(
  format(
    'select public.accept_sellertray_master_agreement(%L,%L,%L,%L::jsonb,%L,%L)',
    f.tenant_a_id,f.version_1_id,'Changed signer name',
    '{"channel":"merchant_web","authority_confirmed":true}',
    f.command_id,f.owner_a_id
  ),
  '23505',null::text,
  'same acceptance command cannot be replayed with changed signer facts'
) from master_agreement_fixture f;
select extensions.throws_ok(
  format(
    'select public.accept_sellertray_master_agreement(%L,%L,%L,%L::jsonb,%L,%L)',
    f.tenant_a_id,f.version_1_id,'Staff User',
    '{"channel":"merchant_web","authority_confirmed":true}',
    gen_random_uuid(),f.staff_a_id
  ),
  '42501',null::text,
  'Staff cannot accept the Master Agreement'
) from master_agreement_fixture f;

update master_agreement_fixture f
set version_2_id=public.publish_sellertray_master_agreement_admin(
  'master-test-v2-'||substr(f.admin_user_id::text,1,8),
  'SellerTray Master Agreement',
  'Universal agreement test version two.',
  now()-interval '1 second',
  'Publish changed test version',
  f.admin_user_id
);

select extensions.ok(
  not (select public.sellertray_master_agreement_is_accepted(f.tenant_a_id,now()) from master_agreement_fixture f),
  'publishing a newer effective version makes old-version acceptance insufficient for new service delivery'
);
select extensions.ok(
  (select count(*)=1
   from public.sellertray_master_agreement_acceptances a
   join master_agreement_fixture f
     on a.tenant_id=f.tenant_a_id
    and a.agreement_version_id=f.version_1_id),
  'new version publication preserves historical version-one acceptance evidence'
);

select * from extensions.finish();
rollback;
