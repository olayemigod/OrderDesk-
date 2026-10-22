begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(12);

select extensions.ok(not has_function_privilege('anon','public.platform_admin_commercial_installment_portfolio(uuid,text,text,timestamptz,uuid,integer)','EXECUTE'),'anonymous callers cannot read installment portfolio');
select extensions.ok(not has_function_privilege('authenticated','public.platform_admin_commercial_installment_portfolio(uuid,text,text,timestamptz,uuid,integer)','EXECUTE'),'merchant JWT cannot choose an Admin installment actor');
select extensions.ok(has_function_privilege('service_role','public.platform_admin_commercial_installment_portfolio(uuid,text,text,timestamptz,uuid,integer)','EXECUTE'),'service boundary may read installment portfolio');
select extensions.ok(not has_function_privilege('anon','public.platform_admin_commercial_agreement_portfolio(uuid,text,text,timestamptz,uuid,integer)','EXECUTE'),'anonymous callers cannot read agreement portfolio');
select extensions.ok(not has_function_privilege('authenticated','public.platform_admin_commercial_agreement_portfolio(uuid,text,text,timestamptz,uuid,integer)','EXECUTE'),'merchant JWT cannot choose an Admin agreement actor');
select extensions.ok(has_function_privilege('service_role','public.platform_admin_commercial_agreement_portfolio(uuid,text,text,timestamptz,uuid,integer)','EXECUTE'),'service boundary may read agreement portfolio');

select extensions.throws_ok(
  $$select public.platform_admin_commercial_installment_portfolio('00000000-0000-4000-8000-000000000000',null,'all',null,null,20)$$,
  '42501','Platform administrator access required','unknown installment portfolio actor denied'
);
select extensions.throws_ok(
  $$select public.platform_admin_commercial_agreement_portfolio('00000000-0000-4000-8000-000000000000',null,'all',null,null,20)$$,
  '42501','Platform administrator access required','unknown agreement portfolio actor denied'
);

create temp table commercial_portfolio_fixture(
  actor_id uuid,
  admin_id uuid,
  tenant_id uuid,
  order_id uuid,
  obligation_id uuid,
  monthly_price_id uuid,
  annual_price_id uuid,
  template_id uuid,
  agreement_id uuid
);
insert into commercial_portfolio_fixture(actor_id,admin_id,tenant_id,order_id,obligation_id)
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role)
select actor_id,'commercial-portfolio-support-'||actor_id||'@example.com','authenticated','authenticated'
from commercial_portfolio_fixture
union all
select admin_id,'commercial-portfolio-admin-'||admin_id||'@example.com','authenticated','authenticated'
from commercial_portfolio_fixture;
insert into public.platform_admins(user_id,role)
select actor_id,'support' from commercial_portfolio_fixture
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
  from commercial_portfolio_fixture
  returning id
)
update commercial_portfolio_fixture set monthly_price_id=(select id from inserted);

with inserted as (
  insert into public.sellertray_commercial_price_versions(
    price_kind,plan_code,billing_cycle,currency,gross_amount,effective_from,
    change_reason,created_by_user_id,approved_by_user_id,approved_at
  )
  select 'subscription','business','yearly','NGN',100000,now()-interval '1 day',
         'Commercial portfolio annual subscription',admin_id,admin_id,now()
  from commercial_portfolio_fixture
  returning id
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

-- The commercial validators are intentionally deferred while the immutable
-- 70:30 obligation and both schedule lines are created as one governed fact.
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

update commercial_portfolio_fixture f
set template_id=public.publish_sellertray_commercial_agreement_template_version(
  'subscription_order','cpf-v1','Commercial Portfolio Agreement',
  'Approved commercial portfolio fixture agreement',now()-interval '1 minute',f.admin_id
);

update commercial_portfolio_fixture f
set agreement_id=public.issue_sellertray_commercial_agreement(
  f.tenant_id,f.order_id,null,f.template_id,
  'CPF-AGR-'||upper(left(f.tenant_id::text,8)),
  'Merchant-specific commercial portfolio subscription agreement',null,f.admin_id
);

select extensions.lives_ok(
  format('select public.platform_admin_commercial_installment_portfolio(%L,%L,%L,null,null,20)',actor_id,'Commercial Portfolio Fixture','all'),
  'Platform Support may read installment portfolio'
) from commercial_portfolio_fixture;
select extensions.lives_ok(
  format('select public.platform_admin_commercial_agreement_portfolio(%L,%L,%L,null,null,20)',actor_id,'Commercial Portfolio Fixture','all'),
  'Platform Support may read agreement portfolio'
) from commercial_portfolio_fixture;

select extensions.ok(
  jsonb_array_length(public.platform_admin_commercial_installment_portfolio(actor_id,'Commercial Portfolio Fixture','all',null,null,20)->'items')=1
  and public.platform_admin_commercial_installment_portfolio(actor_id,'Commercial Portfolio Fixture','all',null,null,20)->'items'->0->>'portfolioState'='awaiting_first_payment'
  and (public.platform_admin_commercial_installment_portfolio(actor_id,'Commercial Portfolio Fixture','all',null,null,20)->'items'->0->>'outstandingAmount')::numeric=100000,
  'installment portfolio reports confirmed-payment progress without invented due state'
) from commercial_portfolio_fixture;

select extensions.ok(
  jsonb_array_length(public.platform_admin_commercial_agreement_portfolio(actor_id,'Commercial Portfolio Fixture','all',null,null,20)->'items')=1
  and public.platform_admin_commercial_agreement_portfolio(actor_id,'Commercial Portfolio Fixture','all',null,null,20)->'items'->0->>'portfolioState'='awaiting_acceptance',
  'agreement portfolio exposes current acceptance state'
) from commercial_portfolio_fixture;

select * from extensions.finish();
rollback;
