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
  tenant_id uuid,
  order_id uuid,
  obligation_id uuid,
  template_id uuid,
  agreement_id uuid
);
insert into commercial_portfolio_fixture(actor_id,tenant_id,order_id,obligation_id,template_id,agreement_id)
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role)
select actor_id,'commercial-portfolio-'||actor_id||'@example.com','authenticated','authenticated'
from commercial_portfolio_fixture;
insert into public.platform_admins(user_id,role)
select actor_id,'support' from commercial_portfolio_fixture;
insert into public.tenants(id,name,slug,merchant_code,subscription_status,whatsapp_connection_status)
select tenant_id,'Commercial Portfolio Fixture','commercial-portfolio-'||left(tenant_id::text,8),'CPF','active','connected'
from commercial_portfolio_fixture;

insert into public.sellertray_commercial_orders(
  id,tenant_id,order_reference,currency,total_gross_amount,ordered_at,created_by_user_id,created_at
)
select order_id,tenant_id,'CPF-'||left(order_id::text,8),'NGN',100000,now(),actor_id,now()
from commercial_portfolio_fixture;

insert into public.sellertray_commercial_installment_obligations(
  id,tenant_id,commercial_order_id,structure_code,currency,obligated_amount,created_by_user_id,created_at
)
select obligation_id,tenant_id,order_id,'two_installment_70_30','NGN',100000,actor_id,now()
from commercial_portfolio_fixture;

insert into public.sellertray_commercial_installment_schedule(
  tenant_id,installment_obligation_id,sequence_no,percentage,amount_due,due_at,created_at
)
select tenant_id,obligation_id,1,70,70000,null,now() from commercial_portfolio_fixture
union all
select tenant_id,obligation_id,2,30,30000,null,now() from commercial_portfolio_fixture;

insert into public.sellertray_commercial_agreement_template_versions(
  id,agreement_family,version_code,title,content_body,content_sha256,effective_from,published_by_user_id,published_at,created_at
)
select template_id,'subscription_order','cpf-v1','Commercial Portfolio Agreement','Fixture agreement body',repeat('0',64),now(),actor_id,now(),now()
from commercial_portfolio_fixture;

insert into public.sellertray_commercial_agreements(
  id,tenant_id,commercial_order_id,installment_obligation_id,template_version_id,
  agreement_family,template_version_code,template_content_sha256,agreement_reference,
  rendered_content,content_sha256,commercial_snapshot,supersedes_agreement_id,
  issued_by_user_id,issued_at,created_at
)
select agreement_id,tenant_id,order_id,null,template_id,
  'subscription_order','cpf-v1',repeat('0',64),'CPF-AGR-'||left(agreement_id::text,8),
  'Commercial Portfolio rendered agreement',repeat('0',64),'{}'::jsonb,null,
  actor_id,now(),now()
from commercial_portfolio_fixture;

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
