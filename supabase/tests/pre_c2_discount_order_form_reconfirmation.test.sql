begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

select extensions.ok(
  exists (
    select 1 from pg_trigger
    where tgrelid='public.sellertray_commercial_adjustments'::regclass
      and tgname='reissue_sellertray_order_forms_after_discount'
      and not tgisinternal and tgenabled='O'
  ),
  'each new discount triggers purchase-specific Order Form replacement'
);
select extensions.ok(
  not has_function_privilege(
    'authenticated','public.reissue_sellertray_order_forms_after_discount()','EXECUTE'
  ),
  'direct merchant invocation of privileged Order Form replacement is denied'
);
select extensions.ok(
  position('build_sellertray_commercial_agreement_snapshot' in
    lower(pg_get_functiondef('public.reissue_sellertray_order_forms_after_discount()'::regprocedure))) > 0
  and position('supersedes_order_form_id' in
    lower(pg_get_functiondef('public.reissue_sellertray_order_forms_after_discount()'::regprocedure))) > 0,
  'replacement snapshots current settlement terms and preserves supersession history'
);
select extensions.ok(
  position('create_sellertray_agreement_package' in
    lower(pg_get_functiondef('public.reissue_sellertray_order_forms_after_discount()'::regprocedure))) > 0
  and position('sellertray_order_form_issued' in
    lower(pg_get_functiondef('public.reissue_sellertray_order_forms_after_discount()'::regprocedure))) > 0,
  'replacement package creation and Admin issuance audit are part of one transaction'
);

create temp table discount_order_form_fixture(
  actor_user_id uuid not null,
  tenant_id uuid not null,
  order_id uuid not null,
  price_version_id uuid,
  template_id uuid,
  original_form_id uuid,
  first_command_id uuid not null,
  second_command_id uuid not null
) on commit drop;

insert into discount_order_form_fixture(
  actor_user_id,tenant_id,order_id,first_command_id,second_command_id
) values(
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()
);

insert into auth.users(id,email,aud,role,created_at,updated_at)
select actor_user_id,'order-form-discount-'||left(actor_user_id::text,8)||'@example.com',
  'authenticated','authenticated',now(),now()
from discount_order_form_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'Order Form Discount Fixture',
  'discount-of-'||left(tenant_id::text,8),'DFA','trial'
from discount_order_form_fixture;

with p as (
  insert into public.sellertray_commercial_price_versions(
    price_kind,plan_code,billing_cycle,currency,gross_amount,
    effective_from,change_reason,created_by_user_id,approved_by_user_id,approved_at
  )
  select 'branch_setup',null,null,'NGN',1000,
    now()-interval '1 hour','Order Form discount legal-snapshot regression',
    actor_user_id,actor_user_id,now()
  from discount_order_form_fixture
  returning id
)
update discount_order_form_fixture set price_version_id=(select id from p);

insert into public.sellertray_commercial_orders(
  id,tenant_id,order_reference,currency,total_gross_amount,created_by_user_id
)
select order_id,tenant_id,'DFA-'||left(order_id::text,8),'NGN',1000,actor_user_id
from discount_order_form_fixture;

insert into public.sellertray_commercial_order_price_snapshots(
  tenant_id,commercial_order_id,line_no,line_type,source_price_version_id,
  branch_id,description_snapshot
)
select f.tenant_id,f.order_id,1,'branch_setup',f.price_version_id,b.id,
  'Business Branch setup'
from discount_order_form_fixture f
join public.branches b on b.tenant_id=f.tenant_id and b.is_default=true;

set constraints all immediate;

with t as (
  insert into public.sellertray_commercial_agreement_template_versions(
    agreement_family,version_code,title,content_body,content_sha256,
    effective_from,published_by_user_id,publication_scope,
    production_authorized_at,production_authorized_by_user_id,
    production_authorization_reason
  )
  select 'subscription_order','discount-test-'||left(tenant_id::text,8),
    'Discount Order Form','SellerTray governed discount test Order Form',
    repeat('0',64),now()-interval '1 minute',actor_user_id,
    'production',now()-interval '30 seconds',actor_user_id,
    'Temporary pgTAP Order Form authority'
  from discount_order_form_fixture
  returning id
)
update discount_order_form_fixture set template_id=(select id from t);

with f as (
  insert into public.sellertray_commercial_order_forms(
    tenant_id,commercial_order_id,installment_obligation_id,
    order_form_template_version_id,template_version_code,template_content_sha256,
    order_form_reference,rendered_content,commercial_snapshot,
    commercial_snapshot_sha256,content_sha256,issued_by_user_id
  )
  select tenant_id,order_id,null,template_id,
    'pending',repeat('0',64),
    'DFA-ORIGINAL-'||left(order_id::text,8),
    'pending','{}'::jsonb,repeat('0',64),repeat('0',64),actor_user_id
  from discount_order_form_fixture
  returning id
)
update discount_order_form_fixture set original_form_id=(select id from f);

select extensions.is(
  (select (o.commercial_snapshot#>>'{settlementTerms,netAmountDue}')::numeric
   from public.sellertray_commercial_order_forms o
   join discount_order_form_fixture f on o.id=f.original_form_id),
  1000::numeric,
  'initial immutable Order Form snapshots undiscounted payable amount'
);

select public.record_sellertray_commercial_discount_internal(
  f.tenant_id,f.order_id,f.first_command_id,'percentage',10,
  'Approved Order Form discount regression','{}'::jsonb,f.actor_user_id
)
from discount_order_form_fixture f;

select extensions.is(
  (select count(*)::integer
   from public.sellertray_commercial_order_forms o
   join discount_order_form_fixture f on o.commercial_order_id=f.order_id),
  2,
  'percentage adjustment atomically creates one new Order Form'
);
select extensions.is(
  (select (o.commercial_snapshot#>>'{settlementTerms,netAmountDue}')::numeric
   from public.sellertray_commercial_order_forms o
   join discount_order_form_fixture f on o.id=f.original_form_id),
  1000::numeric,
  'superseded original Order Form terms remain unchanged'
);
select extensions.is(
  (select (o.commercial_snapshot#>>'{settlementTerms,netAmountDue}')::numeric
   from public.sellertray_commercial_order_forms o
   join discount_order_form_fixture f on o.supersedes_order_form_id=f.original_form_id),
  900::numeric,
  'replacement Order Form captures authoritative post-discount net amount'
);
select extensions.ok(
  exists(
    select 1 from public.sellertray_commercial_order_forms o
    join discount_order_form_fixture f on o.supersedes_order_form_id=f.original_form_id
    where not exists(
      select 1 from public.sellertray_order_form_confirmations c
      where c.tenant_id=o.tenant_id and c.order_form_id=o.id
    )
  ),
  'replacement is unconfirmed and requires fresh Merchant review before checkout'
);
select extensions.is(
  (select count(*)::integer from public.platform_admin_audit a
   join discount_order_form_fixture f on a.tenant_id=f.tenant_id
   where a.action='sellertray_order_form_issued'
     and a.detail->>'discountCommandId'=f.first_command_id::text),
  1,
  'discount-triggered replacement records linked Admin audit evidence'
);

-- Exact replay must not insert another adjustment and therefore must not
-- create another Order Form or re-confirm a historical one.
select public.record_sellertray_commercial_discount_internal(
  f.tenant_id,f.order_id,f.first_command_id,'percentage',10,
  'Approved Order Form discount regression','{}'::jsonb,f.actor_user_id
)
from discount_order_form_fixture f;
select extensions.is(
  (select count(*)::integer
   from public.sellertray_commercial_order_forms o
   join discount_order_form_fixture f on o.commercial_order_id=f.order_id),
  2,
  'idempotent adjustment retry does not duplicate replacement Order Forms'
);

-- A later fixed adjustment creates a second replacement in the same chain.
select public.record_sellertray_commercial_discount_internal(
  f.tenant_id,f.order_id,f.second_command_id,'fixed_amount',50,
  'Second Order Form discount regression','{}'::jsonb,f.actor_user_id
)
from discount_order_form_fixture f;
select extensions.is(
  (select count(*)::integer
   from public.sellertray_commercial_order_forms o
   join discount_order_form_fixture f on o.commercial_order_id=f.order_id),
  3,
  'later fixed discount adds another immutable replacement'
);
select extensions.is(
  (select count(*)::integer
   from public.sellertray_commercial_order_forms o
   join discount_order_form_fixture f on o.commercial_order_id=f.order_id
   where not exists (
     select 1 from public.sellertray_commercial_order_forms r
     where r.tenant_id=o.tenant_id and r.supersedes_order_form_id=o.id
   )),
  1,
  'exactly one current Order Form remains after sequential discounts'
);
select extensions.is(
  (select (o.commercial_snapshot#>>'{settlementTerms,netAmountDue}')::numeric
   from public.sellertray_commercial_order_forms o
   join discount_order_form_fixture f on o.commercial_order_id=f.order_id
   where not exists(
     select 1 from public.sellertray_commercial_order_forms r
     where r.tenant_id=o.tenant_id and r.supersedes_order_form_id=o.id
   )),
  850::numeric,
  'current Order Form captures both approved discounts without rewriting old forms'
);

select * from extensions.finish();
rollback;
