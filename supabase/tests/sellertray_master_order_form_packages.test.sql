begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(24);

create temp table agreement_package_fixture (
  admin_user_id uuid not null,
  owner_user_id uuid not null,
  tenant_id uuid not null,
  monthly_price_id uuid,
  annual_price_id uuid,
  master_v1_id uuid,
  master_v2_id uuid,
  order_form_template_id uuid,
  first_order_id uuid,
  second_order_id uuid,
  first_obligation_id uuid,
  second_obligation_id uuid,
  first_order_form_id uuid,
  second_order_form_id uuid,
  first_command_id uuid not null,
  second_command_id uuid not null,
  master_v2_command_id uuid not null,
  first_result jsonb,
  retry_result jsonb,
  second_result jsonb,
  master_v2_result jsonb,
  legacy_agreement_count bigint not null default 0,
  legacy_acceptance_count bigint not null default 0,
  immutable_update_rejected boolean not null default false
) on commit drop;

insert into agreement_package_fixture(
  admin_user_id,owner_user_id,tenant_id,first_command_id,second_command_id,master_v2_command_id
) values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select admin_user_id,'package-admin-'||substr(admin_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from agreement_package_fixture
union all
select owner_user_id,'package-owner-'||substr(owner_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from agreement_package_fixture;

insert into public.platform_admins(user_id,role)
select admin_user_id,'admin' from agreement_package_fixture;
insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'Agreement Package Business','package-'||substr(tenant_id::text,1,8),'PK1','trial'
from agreement_package_fixture;
insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner' from agreement_package_fixture;

with inserted as (
  insert into public.sellertray_commercial_price_versions(
    price_kind,plan_code,billing_cycle,currency,gross_amount,effective_from,
    change_reason,created_by_user_id,approved_by_user_id,approved_at
  )
  select 'subscription','business','monthly','NGN',100,now()-interval '1 day',
         'Agreement package monthly regression price',admin_user_id,admin_user_id,now()
  from agreement_package_fixture returning id
)
update agreement_package_fixture set monthly_price_id=(select id from inserted);

with inserted as (
  insert into public.sellertray_commercial_price_versions(
    price_kind,plan_code,billing_cycle,currency,gross_amount,effective_from,
    change_reason,created_by_user_id,approved_by_user_id,approved_at
  )
  select 'subscription','business','yearly','NGN',1000,now()-interval '1 day',
         'Agreement package annual regression price',admin_user_id,admin_user_id,now()
  from agreement_package_fixture returning id
)
update agreement_package_fixture set annual_price_id=(select id from inserted);

with inserted as (
  insert into public.sellertray_commercial_orders(tenant_id,order_reference,currency,total_gross_amount,ordered_at,created_by_user_id)
  select tenant_id,'PKG-FIRST-'||substr(tenant_id::text,1,8),'NGN',1000,now(),admin_user_id
  from agreement_package_fixture returning id
)
update agreement_package_fixture set first_order_id=(select id from inserted);
with inserted as (
  insert into public.sellertray_commercial_orders(tenant_id,order_reference,currency,total_gross_amount,ordered_at,created_by_user_id)
  select tenant_id,'PKG-SECOND-'||substr(tenant_id::text,1,8),'NGN',1000,now()+interval '1 second',admin_user_id
  from agreement_package_fixture returning id
)
update agreement_package_fixture set second_order_id=(select id from inserted);

insert into public.sellertray_commercial_order_price_snapshots(
  tenant_id,commercial_order_id,line_no,line_type,source_price_version_id,description_snapshot
)
select tenant_id,first_order_id,1,'subscription',annual_price_id,'Annual SellerTray subscription' from agreement_package_fixture
union all
select tenant_id,second_order_id,1,'subscription',annual_price_id,'Annual SellerTray subscription' from agreement_package_fixture;
set constraints all immediate;

set constraints all deferred;
with inserted as (
  insert into public.sellertray_commercial_installment_obligations(
    tenant_id,commercial_order_id,structure_code,currency,obligated_amount,created_by_user_id
  )
  select tenant_id,first_order_id,'two_installment_70_30','NGN',1000,admin_user_id
  from agreement_package_fixture returning id
)
update agreement_package_fixture set first_obligation_id=(select id from inserted);
with inserted as (
  insert into public.sellertray_commercial_installment_obligations(
    tenant_id,commercial_order_id,structure_code,currency,obligated_amount,created_by_user_id
  )
  select tenant_id,second_order_id,'two_installment_70_30','NGN',1000,admin_user_id
  from agreement_package_fixture returning id
)
update agreement_package_fixture set second_obligation_id=(select id from inserted);
insert into public.sellertray_commercial_installment_schedule(tenant_id,installment_obligation_id,sequence_no,percentage,amount_due)
select tenant_id,first_obligation_id,1,70,700 from agreement_package_fixture
union all select tenant_id,first_obligation_id,2,30,300 from agreement_package_fixture
union all select tenant_id,second_obligation_id,1,70,700 from agreement_package_fixture
union all select tenant_id,second_obligation_id,2,30,300 from agreement_package_fixture;
set constraints all immediate;

update agreement_package_fixture f set
  legacy_agreement_count=(select count(*) from public.sellertray_commercial_agreements a where a.tenant_id=f.tenant_id),
  legacy_acceptance_count=(select count(*) from public.sellertray_commercial_agreement_acceptances a where a.tenant_id=f.tenant_id);

update agreement_package_fixture f set master_v1_id=public.publish_sellertray_master_agreement_admin(
  'master-v1','SellerTray Master Agreement','Reusable Master Agreement terms.',
  now()-interval '2 minutes','Publish first regression Master version',f.admin_user_id
);
update agreement_package_fixture f set order_form_template_id=public.publish_sellertray_order_form_template_admin(
  'installment_agreement','order-form-v1','SellerTray Order Form','Purchase-specific Order Form terms.',
  now()-interval '2 minutes','Publish regression Order Form template',f.admin_user_id
);

update agreement_package_fixture f set first_order_form_id=public.issue_sellertray_commercial_order_form_admin(
  f.tenant_id,f.first_order_id,f.first_obligation_id,f.order_form_template_id,
  'OF-FIRST-'||substr(f.tenant_id::text,1,8),null,'Issue first governed Order Form',f.admin_user_id
);
update agreement_package_fixture f set second_order_form_id=public.issue_sellertray_commercial_order_form_admin(
  f.tenant_id,f.second_order_id,f.second_obligation_id,f.order_form_template_id,
  'OF-SECOND-'||substr(f.tenant_id::text,1,8),null,'Issue second governed Order Form',f.admin_user_id
);

select extensions.ok(
  to_regclass('public.sellertray_master_agreement_acceptances') is not null
  and to_regclass('public.sellertray_commercial_order_forms') is not null
  and to_regclass('public.sellertray_agreement_packages') is not null
  and to_regclass('public.sellertray_order_form_confirmations') is not null,
  'Master acceptance, Order Form, package and confirmation authorities exist'
);

select extensions.is(
  (select count(*)::integer from pg_class c where c.oid in (
    'public.sellertray_master_agreement_acceptances'::regclass,
    'public.sellertray_commercial_order_forms'::regclass,
    'public.sellertray_agreement_packages'::regclass,
    'public.sellertray_order_form_confirmations'::regclass
  ) and c.relrowsecurity),4,'agreement-package persistence is RLS protected'
);

select extensions.ok(
  not has_table_privilege('authenticated','public.sellertray_commercial_order_forms','SELECT')
  and not has_function_privilege('authenticated','public.confirm_sellertray_agreement_package(uuid,uuid,text,jsonb,uuid,uuid)','EXECUTE'),
  'clients cannot bypass the service-authority package boundary'
);

select extensions.ok(
  not has_function_privilege('service_role','public.accept_sellertray_commercial_agreement(uuid,uuid,text,jsonb,uuid,uuid)','EXECUTE')
  and not has_function_privilege('service_role','public.issue_sellertray_commercial_agreement_admin(uuid,uuid,uuid,uuid,text,text,uuid,text,uuid)','EXECUTE')
  and not has_function_privilege('service_role','public.publish_sellertray_commercial_agreement_template_admin(text,text,text,text,timestamptz,text,uuid)','EXECUTE')
  and not has_function_privilege('service_role','public.publish_sellertray_commercial_agreement_template_version(text,text,text,text,timestamptz,uuid)','EXECUTE'),
  'legacy C1A issuance, acceptance and generic template mutation are retired from service-role web boundaries'
);

select extensions.ok(
  not public.sellertray_installment_agreement_is_accepted(f.tenant_id,f.first_order_id,f.first_obligation_id),
  'C1B prerequisite is false before the exact first Order Form confirmation'
) from agreement_package_fixture f;

update agreement_package_fixture f set first_result=public.confirm_sellertray_agreement_package(
  f.tenant_id,f.first_order_form_id,'Merchant Owner',
  jsonb_build_object('channel','merchant_web','authority_confirmed',true),f.first_command_id,f.owner_user_id
);
update agreement_package_fixture f set retry_result=public.confirm_sellertray_agreement_package(
  f.tenant_id,f.first_order_form_id,'Merchant Owner',
  jsonb_build_object('channel','merchant_web','authority_confirmed',true),f.first_command_id,f.owner_user_id
);

select extensions.is(
  (select retry_result from agreement_package_fixture),
  (select first_result from agreement_package_fixture),
  'replaying the first consolidated command returns the same evidence'
);
select extensions.ok(
  (select (first_result->>'masterAcceptanceCreated')::boolean from agreement_package_fixture),
  'first purchase creates the required Master acceptance'
);
select extensions.is(
  (select count(*)::integer from public.sellertray_master_agreement_acceptances a join agreement_package_fixture f on f.tenant_id=a.tenant_id),
  1,'first purchase accepts the current Master exactly once'
);
select extensions.is(
  (select count(*)::integer from public.sellertray_order_form_confirmations c join agreement_package_fixture f on f.tenant_id=c.tenant_id),
  1,'first purchase confirms its exact Order Form once'
);
select extensions.ok(
  public.sellertray_installment_agreement_is_accepted(f.tenant_id,f.first_order_id,f.first_obligation_id),
  'first confirmed package satisfies the shared C1B agreement prerequisite'
) from agreement_package_fixture f;

select extensions.ok(
  not public.sellertray_installment_agreement_is_accepted(f.tenant_id,f.second_order_id,f.second_obligation_id),
  'Master acceptance from Order 1 does not satisfy Order 2 before its own Order Form confirmation'
) from agreement_package_fixture f;

update agreement_package_fixture f set second_result=public.confirm_sellertray_agreement_package(
  f.tenant_id,f.second_order_form_id,'Merchant Owner',
  jsonb_build_object('channel','merchant_web','authority_confirmed',true),f.second_command_id,f.owner_user_id
);

select extensions.ok(
  not (select (second_result->>'masterAcceptanceCreated')::boolean from agreement_package_fixture),
  'second order under the unchanged Master reuses the existing Master acceptance'
);
select extensions.is(
  (select count(*)::integer from public.sellertray_master_agreement_acceptances a join agreement_package_fixture f on f.tenant_id=a.tenant_id),
  1,'second order under the unchanged Master leaves one Master acceptance total'
);
select extensions.is(
  (select count(*)::integer from public.sellertray_order_form_confirmations c join agreement_package_fixture f on f.tenant_id=c.tenant_id),
  2,'second order records its own exact Order Form confirmation'
);
select extensions.is(
  (select count(*)::integer from public.sellertray_agreement_packages p join agreement_package_fixture f on f.tenant_id=p.tenant_id),
  2,'two exact Order Forms create two deterministic package manifests under one Master'
);
select extensions.ok(
  public.sellertray_installment_agreement_is_accepted(f.tenant_id,f.second_order_id,f.second_obligation_id),
  'Order 2 becomes C1B-eligible only after its exact Order Form confirmation'
) from agreement_package_fixture f;

select extensions.ok(
  not exists (
    select 1 from public.sellertray_agreement_packages p
    join agreement_package_fixture f on f.tenant_id=p.tenant_id
    where p.package_fingerprint<>encode(extensions.digest(convert_to(p.manifest::text,'UTF8'),'sha256'),'hex')
  ),'stored package fingerprints match canonical manifest SHA-256'
);

update agreement_package_fixture f set master_v2_id=public.publish_sellertray_master_agreement_admin(
  'master-v2','SellerTray Master Agreement','Updated reusable Master Agreement terms.',
  now()-interval '30 seconds','Publish second regression Master version',f.admin_user_id
);
select extensions.ok(
  not public.sellertray_installment_agreement_is_accepted(f.tenant_id,f.second_order_id,f.second_obligation_id),
  'a newly effective Master version requires acceptance again for current-path service delivery'
) from agreement_package_fixture f;

update agreement_package_fixture f set master_v2_result=public.confirm_sellertray_agreement_package(
  f.tenant_id,f.second_order_form_id,'Merchant Owner',
  jsonb_build_object('channel','merchant_web','authority_confirmed',true),f.master_v2_command_id,f.owner_user_id
);
select extensions.ok(
  (select (master_v2_result->>'masterAcceptanceCreated')::boolean from agreement_package_fixture),
  'confirming against a new Master version creates the new version-scoped Master acceptance'
);
select extensions.is(
  (select count(*)::integer from public.sellertray_order_form_confirmations c join agreement_package_fixture f on f.tenant_id=c.tenant_id),
  2,'Master reacceptance does not duplicate an already-confirmed Order Form confirmation'
);
select extensions.is(
  (select count(*)::integer from public.sellertray_agreement_packages p join agreement_package_fixture f on f.tenant_id=p.tenant_id),
  3,'Master reacceptance creates deterministic package evidence for the new Master + existing Order Form pair'
);

select extensions.is(
  (select count(*)::integer from public.sellertray_commercial_agreements a join agreement_package_fixture f on f.tenant_id=a.tenant_id),
  (select legacy_agreement_count::integer from agreement_package_fixture),
  'package confirmation does not rewrite or add legacy agreement records'
);
select extensions.is(
  (select count(*)::integer from public.sellertray_commercial_agreement_acceptances a join agreement_package_fixture f on f.tenant_id=a.tenant_id),
  (select legacy_acceptance_count::integer from agreement_package_fixture),
  'package confirmation leaves legacy acceptance records unchanged'
);

do $$
begin
  begin
    update public.sellertray_commercial_order_forms set rendered_content='mutated'
    where id=(select first_order_form_id from agreement_package_fixture);
  exception when sqlstate '55000' then
    update agreement_package_fixture set immutable_update_rejected=true;
  end;
end
$$;
select extensions.ok((select immutable_update_rejected from agreement_package_fixture),'issued Order Forms are immutable');

select * from extensions.finish();
rollback;
