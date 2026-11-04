begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(16);

-- C2-7: exercise real publication, Branch order, governed Order Form issue,
-- separately accepted Master, confirmed package and native term registration.
-- Test changes roll back; C1/OA2 remains the runtime compatibility authority.
create temp table c2_legal_proof_fixture(
 tenant_id uuid not null,
 other_tenant_id uuid not null,
 owner_id uuid not null,
 outsider_id uuid not null,
 admin_id uuid not null,
 plan_id uuid not null,
 plan_version_id uuid not null,
 branch_id uuid,
 order_result jsonb,
 master_id uuid,
 template_id uuid,
 form_id uuid,
 master_acceptance_id uuid,
 confirmation_result jsonb,
 legacy_before jsonb,
 missing_master_denied boolean not null default false,
 unconfirmed_form_denied boolean not null default false,
 outsider_denied boolean not null default false
) on commit drop;

insert into c2_legal_proof_fixture(
 tenant_id,other_tenant_id,owner_id,outsider_id,admin_id,plan_id,plan_version_id
) values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
         gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_id,'c2-legal-owner-'||substr(owner_id::text,1,8)||'@example.com',
 'authenticated','authenticated',now(),now() from c2_legal_proof_fixture
union all
select outsider_id,'c2-legal-outsider-'||substr(outsider_id::text,1,8)||'@example.com',
 'authenticated','authenticated',now(),now() from c2_legal_proof_fixture
union all
select admin_id,'c2-legal-admin-'||substr(admin_id::text,1,8)||'@example.com',
 'authenticated','authenticated',now(),now() from c2_legal_proof_fixture;

insert into public.platform_admins(user_id,role)
select admin_id,'admin' from c2_legal_proof_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'C2 Legal Proof Business',
 'c2-legal-'||substr(tenant_id::text,1,8),'CLP','active'
from c2_legal_proof_fixture
union all
select other_tenant_id,'C2 Other Business',
 'c2-other-'||substr(other_tenant_id::text,1,8),'COT','active'
from c2_legal_proof_fixture;

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_id,'owner' from c2_legal_proof_fixture
union all
select other_tenant_id,outsider_id,'owner' from c2_legal_proof_fixture;

update c2_legal_proof_fixture f
set branch_id=(select b.id from public.branches b
  where b.tenant_id=f.tenant_id and b.is_default limit 1),
legacy_before=(select to_jsonb(s) from public.tenant_subscriptions s
  where s.tenant_id=f.tenant_id);

insert into public.sellertray_plan_profiles(id,code,default_display_name,status,created_by_user_id)
select plan_id,'c2_legal_order','C2 Legal Plan','active',admin_id from c2_legal_proof_fixture;
insert into public.sellertray_plan_profile_versions(
 id,plan_profile_id,version,status,display_name,description,merchant_summary,
 allowed_billing_cycles,effective_from,change_reason,
 created_by_user_id,published_by_user_id,published_at)
select plan_version_id,plan_id,1,'published','C2 Legal Plan v1',
 'Published Branch profile for legal registration test.','C2 Legal Plan',
 array['yearly']::text[],'2026-01-01T00:00:00Z'::timestamptz,
 'C2 legal test publication',admin_id,admin_id,now()
from c2_legal_proof_fixture;

insert into public.sellertray_commercial_price_versions(
 price_kind,charge_type_code,plan_code,plan_profile_version_id,addon_version_id,
 billing_cycle,currency,gross_amount,effective_from,status,change_reason,
 created_by_user_id,approved_by_user_id,approved_at,price_scope)
select 'subscription','branch_subscription',null,plan_version_id,null::uuid,
 'yearly','NGN',10000,'2026-01-01T00:00:00Z'::timestamptz,'published',
 'C2 legal test Branch price',admin_id,admin_id,now(),'standard'
from c2_legal_proof_fixture;

select set_config('request.jwt.claim.role','service_role',true);
update c2_legal_proof_fixture f
set order_result=public.create_sellertray_c2_branch_commercial_order(
  f.tenant_id,'NGN',jsonb_build_array(jsonb_build_object(
    'branchId',f.branch_id,'planProfileVersionId',f.plan_version_id,
    'billingCycle','yearly','setupRequired',false)),
  'c2-legal-'||substr(f.tenant_id::text,1,8),
  gen_random_uuid(),'system',f.admin_id);

update c2_legal_proof_fixture f set
 master_id=public.publish_sellertray_master_agreement_admin(
  'c2-legal-'||substr(f.tenant_id::text,1,8),
  'SellerTray Master Agreement','Test Master legal content.',
  now()-interval '5 minutes','C2 legal confirmation regression',f.admin_id),
 template_id=public.publish_sellertray_order_form_template_admin(
  'subscription_order','c2-legal-'||substr(f.tenant_id::text,1,8),
  'SellerTray Merchant Order Form','Test Merchant Order Form content.',
  now()-interval '5 minutes','C2 legal confirmation regression',f.admin_id);

update c2_legal_proof_fixture f
set form_id=public.issue_sellertray_commercial_order_form_admin(
 f.tenant_id,(f.order_result->>'commercialOrderId')::uuid,null,
 f.template_id,'c2-form-'||substr(f.tenant_id::text,1,8),
 null,'C2 Branch Order Form issuance',f.admin_id);

select extensions.is(
 (select required_master_agreement_version_id
  from public.sellertray_commercial_order_forms o
  join c2_legal_proof_fixture f on o.id=f.form_id),
 (select master_id from c2_legal_proof_fixture),
 'C2 Merchant Order Form pins the published Master Agreement version');

do $test$
declare f c2_legal_proof_fixture%rowtype;
begin
 select * into strict f from c2_legal_proof_fixture;
 begin
  perform public.confirm_sellertray_agreement_package(
   f.tenant_id,f.form_id,'Business Owner',
   jsonb_build_object('authority_confirmed',true),
   gen_random_uuid(),f.owner_id);
 exception when sqlstate '23514' then
  update c2_legal_proof_fixture set missing_master_denied=true;
 end;
end $test$;
select extensions.ok((select missing_master_denied from c2_legal_proof_fixture),
 'Order Form confirmation cannot manufacture Master Agreement acceptance');

update c2_legal_proof_fixture f
set master_acceptance_id=public.accept_sellertray_master_agreement(
 f.tenant_id,f.master_id,'Business Owner',
 jsonb_build_object('authority_confirmed',true,'channel','merchant_web'),
 gen_random_uuid(),f.owner_id);

do $test$
declare f c2_legal_proof_fixture%rowtype;
begin
 select * into strict f from c2_legal_proof_fixture;
 begin
  perform public.register_sellertray_branch_subscription_term(
   f.tenant_id,f.branch_id,f.plan_version_id,'yearly',now(),
   (f.order_result->>'commercialOrderId')::uuid,
   (f.order_result->'subjects'->0->>'branchSubscriptionLineId')::uuid,
   (f.order_result->'subjects'->0->>'installmentObligationId')::uuid,
   false,f.master_id,f.form_id,null,'commercial_order',
   jsonb_build_object('test','unconfirmed-form'),gen_random_uuid(),
   'system',f.admin_id);
 exception when sqlstate '23514' then
  update c2_legal_proof_fixture set unconfirmed_form_denied=true;
 end;
end $test$;
select extensions.ok((select unconfirmed_form_denied from c2_legal_proof_fixture),
 'Even an accepted Master cannot authorize an unconfirmed Branch Order Form');

do $test$
declare f c2_legal_proof_fixture%rowtype;
begin
 select * into strict f from c2_legal_proof_fixture;
 begin
  perform public.confirm_sellertray_agreement_package(
   f.tenant_id,f.form_id,'Other Business Owner',
   jsonb_build_object('authority_confirmed',true),
   gen_random_uuid(),f.outsider_id);
 exception when sqlstate '42501' then
  update c2_legal_proof_fixture set outsider_denied=true;
 end;
end $test$;
select extensions.ok((select outsider_denied from c2_legal_proof_fixture),
 'An owner from another Business cannot confirm this Branch Order Form');

select extensions.is(
 (select count(*)::integer from public.sellertray_branch_subscriptions s
  join c2_legal_proof_fixture f on s.tenant_id=f.tenant_id),0,
 'An unconfirmed Branch purchase cannot create a pending subscription');

update c2_legal_proof_fixture f
set confirmation_result=public.confirm_sellertray_agreement_package(
 f.tenant_id,f.form_id,'Business Owner',
 jsonb_build_object('authority_confirmed',true),
 gen_random_uuid(),f.owner_id);

select extensions.is(
 (select jsonb_array_length(confirmation_result->'branchSubscriptions')
  from c2_legal_proof_fixture),1,
 'A confirmed C2 purchase registers its single Branch commitment');
select extensions.is(
 (select count(*)::integer
  from public.sellertray_branch_subscriptions s
  join c2_legal_proof_fixture f on s.tenant_id=f.tenant_id),1,
 'One native Branch Subscription term is registered');
select extensions.is(
 (select s.lifecycle_status
  from public.sellertray_branch_subscriptions s
  join c2_legal_proof_fixture f on s.tenant_id=f.tenant_id),
 'pending',
 'Confirmed legal commitment alone cannot activate Branch entitlement');
select extensions.ok(
 (select s.branch_id=f.branch_id
    and s.plan_profile_version_id=f.plan_version_id
    and s.billing_cycle='yearly'
    and s.commercial_order_id=(f.order_result->>'commercialOrderId')::uuid
    and s.order_form_id=f.form_id
    and s.required_master_agreement_version_id=f.master_id
    and s.master_agreement_acceptance_id=f.master_acceptance_id
  from public.sellertray_branch_subscriptions s
  join c2_legal_proof_fixture f on s.tenant_id=f.tenant_id),
 'Native Branch Subscription preserves exact purchased and accepted legal identities');

select extensions.is(
 (select (public.confirm_sellertray_agreement_package(
  f.tenant_id,f.form_id,'Business Owner',
  jsonb_build_object('authority_confirmed',true),
  c.command_id,f.owner_id)->>'orderFormConfirmationId')::uuid
  from c2_legal_proof_fixture f
  join public.sellertray_order_form_confirmations c on c.order_form_id=f.form_id),
 (select (confirmation_result->>'orderFormConfirmationId')::uuid
  from c2_legal_proof_fixture),
 'Exact purchase confirmation replay returns original confirmation');
select extensions.is(
 (select count(*)::integer from public.sellertray_branch_subscriptions s
  join c2_legal_proof_fixture f on s.tenant_id=f.tenant_id),1,
 'Confirmation replay does not create another Branch Subscription');
select extensions.is(
 (select count(*)::integer from public.sellertray_order_form_confirmations c
  join c2_legal_proof_fixture f on c.tenant_id=f.tenant_id),1,
 'Purchase confirmation evidence stays idempotent');
select extensions.is(
 (select count(*)::integer from public.sellertray_branch_subscription_addons a
  join c2_legal_proof_fixture f on a.tenant_id=f.tenant_id),0,
 'Legal confirmation alone does not grant add-on entitlements');
select extensions.ok(
 (select legacy_before is not distinct from
   (select to_jsonb(s) from public.tenant_subscriptions s where s.tenant_id=f.tenant_id)
  from c2_legal_proof_fixture f),
 'C2 legal registration leaves Business-wide legacy subscription unchanged');
select extensions.is(
 (select count(*)::integer from public.sellertray_branch_subscriptions s
  join c2_legal_proof_fixture f on s.tenant_id=f.other_tenant_id),0,
 'No native subscription leaks into another Business');

select * from extensions.finish();
rollback;
