begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

select extensions.ok(
  not has_function_privilege('anon','public.platform_admin_commercial_installment_portfolio(uuid,text,text,timestamptz,uuid,integer)','EXECUTE')
  and not has_function_privilege('authenticated','public.platform_admin_commercial_installment_portfolio(uuid,text,text,timestamptz,uuid,integer)','EXECUTE'),
  'merchant clients cannot invoke the Admin installment portfolio'
);
select extensions.ok(
  has_function_privilege('service_role','public.platform_admin_commercial_installment_portfolio(uuid,text,text,timestamptz,uuid,integer)','EXECUTE'),
  'service boundary may read installment portfolio'
);
select extensions.ok(
  not has_function_privilege('anon','public.get_sellertray_master_agreement_admin(uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.get_sellertray_master_agreement_admin(uuid,uuid)','EXECUTE')
  and has_function_privilege('service_role','public.get_sellertray_master_agreement_admin(uuid,uuid)','EXECUTE'),
  'Master Agreement Admin projection stays behind the server boundary'
);

select extensions.throws_ok(
  $$select public.platform_admin_commercial_installment_portfolio('00000000-0000-4000-8000-000000000000',null,'all',null,null,20)$$,
  '42501','Platform administrator access required','unknown installment portfolio actor denied'
);
select extensions.throws_ok(
  $$select public.get_sellertray_master_agreement_admin('00000000-0000-4000-8000-000000000000',null)$$,
  '42501','Platform administrator access required','unknown Master Agreement Admin actor denied'
);

create temp table commercial_portfolio_fixture(
  support_id uuid,
  admin_id uuid,
  tenant_id uuid,
  order_id uuid,
  obligation_id uuid,
  monthly_price_id uuid,
  annual_price_id uuid,
  version_id uuid
);
insert into commercial_portfolio_fixture(support_id,admin_id,tenant_id,order_id,obligation_id)
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role)
select support_id,'commercial-portfolio-support-'||support_id||'@example.com','authenticated','authenticated'
from commercial_portfolio_fixture
union all
select admin_id,'commercial-portfolio-admin-'||admin_id||'@example.com','authenticated','authenticated'
from commercial_portfolio_fixture;
insert into public.platform_admins(user_id,role)
select support_id,'support' from commercial_portfolio_fixture
union all
select admin_id,'admin' from commercial_portfolio_fixture;
insert into public.tenants(id,name,slug,merchant_code,subscription_status,whatsapp_connection_status)
select tenant_id,'Commercial Portfolio Fixture','commercial-portfolio-'||left(tenant_id::text,8),'CPF','active','connected'
from commercial_portfolio_fixture;

with inserted as (
  insert into public.sellertray_commercial_price_versions(
    price_kind,plan_code,billing_cycle,currency,gross_amount,effective_from,
    change_reason,created_by_user_id,approved_by_user_id,approved_at
  )
  select 'subscription','business','monthly','NGN',10000,now()-interval '2 days',
         'Commercial portfolio monthly anchor',admin_id,admin_id,now()
  from commercial_portfolio_fixture returning id
)
update commercial_portfolio_fixture set monthly_price_id=(select id from inserted);

with inserted as (
  insert into public.sellertray_commercial_price_versions(
    price_kind,plan_code,billing_cycle,currency,gross_amount,effective_from,
    change_reason,created_by_user_id,approved_by_user_id,approved_at
  )
  select 'subscription','business','yearly','NGN',100000,now()-interval '1 day',
         'Commercial portfolio annual subscription',admin_id,admin_id,now()
  from commercial_portfolio_fixture returning id
)
update commercial_portfolio_fixture set annual_price_id=(select id from inserted);

insert into public.sellertray_commercial_orders(
  id,tenant_id,order_reference,currency,total_gross_amount,ordered_at,created_by_user_id,created_at
)
select order_id,tenant_id,'CPF-'||left(order_id::text,8),'NGN',100000,now(),admin_id,now()
from commercial_portfolio_fixture;

insert into public.sellertray_commercial_order_price_snapshots(
  tenant_id,commercial_order_id,line_no,line_type,source_price_version_id,branch_id,description_snapshot
)
select tenant_id,order_id,1,'subscription',annual_price_id,null,'Annual SellerTray subscription'
from commercial_portfolio_fixture;
set constraints all immediate;
set constraints validate_sellertray_commercial_installment_obligation deferred;
set constraints validate_sellertray_commercial_installment_schedule_line deferred;

insert into public.sellertray_commercial_installment_obligations(
  id,tenant_id,commercial_order_id,structure_code,currency,obligated_amount,created_by_user_id,created_at
)
select obligation_id,tenant_id,order_id,'two_installment_70_30','NGN',100000,admin_id,now()
from commercial_portfolio_fixture;
insert into public.sellertray_commercial_installment_schedule(
  tenant_id,installment_obligation_id,sequence_no,percentage,amount_due,created_at
)
select tenant_id,obligation_id,1,70,70000,now() from commercial_portfolio_fixture
union all
select tenant_id,obligation_id,2,30,30000,now() from commercial_portfolio_fixture;
set constraints all immediate;

select extensions.lives_ok(
  format('select public.platform_admin_commercial_installment_portfolio(%L,%L,%L,null,null,20)',support_id,'Commercial Portfolio Fixture','all'),
  'Platform Support may read installment portfolio'
) from commercial_portfolio_fixture;
select extensions.ok(
  jsonb_array_length(public.platform_admin_commercial_installment_portfolio(support_id,'Commercial Portfolio Fixture','all',null,null,20)->'items')=1
  and public.platform_admin_commercial_installment_portfolio(support_id,'Commercial Portfolio Fixture','all',null,null,20)->'items'->0->>'portfolioState'='awaiting_first_payment'
  and (public.platform_admin_commercial_installment_portfolio(support_id,'Commercial Portfolio Fixture','all',null,null,20)->'items'->0->>'outstandingAmount')::numeric=100000,
  'installment portfolio reports payment progress independently of agreement state'
) from commercial_portfolio_fixture;

select extensions.lives_ok(
  format('select public.get_sellertray_master_agreement_admin(%L,%L)',support_id,tenant_id),
  'Platform Support may review Master Agreement publication and Business acceptance state'
) from commercial_portfolio_fixture;
select extensions.is(
  public.get_sellertray_master_agreement_admin(support_id,tenant_id)#>>'{tenantState,published}',
  'false',
  'Admin review shows no fabricated Master Agreement before publication'
) from commercial_portfolio_fixture;

update commercial_portfolio_fixture f
set version_id=public.publish_sellertray_master_agreement_admin(
  'test-'||left(f.tenant_id::text,8),
  'SellerTray Master Agreement',
  'Universal agreement for Admin portfolio coverage',
  now()-interval '1 minute',
  'Admin portfolio Master Agreement publication',
  f.admin_id
);

select extensions.ok(
  public.get_sellertray_master_agreement_admin(support_id,tenant_id)#>>'{tenantState,published}'='true'
  and public.get_sellertray_master_agreement_admin(support_id,tenant_id)#>>'{tenantState,accepted}'='false'
  and public.get_sellertray_master_agreement_admin(support_id,tenant_id)#>>'{tenantState,currentVersion,id}'=version_id::text,
  'Admin Master Agreement review exposes the one global version and selected Business acceptance state'
) from commercial_portfolio_fixture;

select extensions.ok(
  position('sellertray_commercial_agreements' in lower(pg_get_functiondef('public.get_sellertray_master_agreement_admin(uuid,uuid)'::regprocedure)))=0
  and position('commercial_order' in lower(pg_get_functiondef('public.get_sellertray_master_agreement_admin(uuid,uuid)'::regprocedure)))=0,
  'current Master Agreement Admin read has no merchant/order-specific agreement dependency'
);

select * from extensions.finish();
rollback;
