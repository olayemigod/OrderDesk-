begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(18);

select extensions.ok(
  to_regclass('public.order_item_catalogue_candidates') is not null,
  'unmatched order item candidate table exists'
);

select extensions.ok(
  (select relrowsecurity from pg_class where oid='public.order_item_catalogue_candidates'::regclass),
  'unmatched order item candidates keep RLS enabled'
);

select extensions.ok(
  not has_table_privilege('authenticated','public.order_item_catalogue_candidates','SELECT'),
  'raw candidate rows are not directly exposed to merchant clients'
);

select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.sellertray_list_order_item_catalogue_candidates(uuid,uuid)',
    'EXECUTE'
  ),
  'tenant members can read candidates through governed RPC'
);

select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.sellertray_match_order_item_to_catalogue(uuid,uuid,uuid,boolean)',
    'EXECUTE'
  ),
  'tenant members can match an unmatched item to catalogue'
);

select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.sellertray_create_catalogue_from_order_item(uuid,uuid,text,numeric,text,text,boolean)',
    'EXECUTE'
  ),
  'catalogue-create resolution is available through governed RPC'
);

select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.sellertray_keep_order_item_one_off(uuid,uuid,numeric,text)',
    'EXECUTE'
  ),
  'one-off resolution is available through governed RPC'
);

select extensions.ok(
  position('merchant_match' in pg_get_constraintdef((
    select oid from pg_constraint
    where conrelid='public.order_items'::regclass
      and conname='order_items_match_source_check'
  ))) > 0,
  'order item match source supports merchant resolution'
);

select extensions.ok(
  position('one_off' in pg_get_constraintdef((
    select oid from pg_constraint
    where conrelid='public.order_items'::regclass
      and conname='order_items_match_source_check'
  ))) > 0,
  'order item match source supports intentional one-off items'
);

select extensions.ok(
  exists(
    select 1 from pg_trigger
    where tgrelid='public.order_items'::regclass
      and tgname='queue_sellertray_order_item_catalogue_candidate'
      and not tgisinternal
  ),
  'unmatched order items automatically create catalogue candidates'
);

select extensions.ok(
  exists(
    select 1 from pg_trigger
    where tgrelid='public.order_items'::regclass
      and tgname='refresh_sellertray_order_review_reasons'
      and not tgisinternal
  ),
  'order review reasons refresh after item resolution'
);

select extensions.ok(
  exists(
    select 1 from pg_indexes
    where schemaname='public'
      and tablename='order_item_catalogue_candidates'
      and indexname='order_item_catalogue_candidates_order_idx'
  ),
  'candidate order/status index exists'
);

select extensions.ok(
  exists(
    select 1 from pg_indexes
    where schemaname='public'
      and tablename='order_item_catalogue_candidates'
      and indexname='order_item_catalogue_candidates_customer_idx'
  ),
  'candidate customer index exists'
);

select extensions.ok(
  position('Resolve unmatched catalogue items' in pg_get_functiondef(
    'public.guard_order_status_transition()'::regprocedure
  )) > 0,
  'server acceptance guard blocks unresolved catalogue items'
);

select extensions.ok(
  position('order_item_matched_to_catalogue' in pg_get_functiondef(
    'public.sellertray_match_order_item_to_catalogue(uuid,uuid,uuid,boolean)'::regprocedure
  )) > 0,
  'existing-product resolution is written to commercial action ledger'
);

select extensions.ok(
  position('catalogue_item_created_from_order' in pg_get_functiondef(
    'public.sellertray_create_catalogue_from_order_item(uuid,uuid,text,numeric,text,text,boolean)'::regprocedure
  )) > 0,
  'create-product resolution is written to commercial action ledger'
);

select extensions.ok(
  position('order_item_kept_one_off' in pg_get_functiondef(
    'public.sellertray_keep_order_item_one_off(uuid,uuid,numeric,text)'::regprocedure
  )) > 0,
  'one-off resolution is written to commercial action ledger'
);

create temp table phase1_catalogue_candidate_fixture (
  tenant_id uuid not null,
  customer_id uuid not null,
  order_id uuid
) on commit drop;

insert into phase1_catalogue_candidate_fixture(tenant_id,customer_id)
values(gen_random_uuid(),gen_random_uuid());

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,
       'Candidate Trigger Test',
       'candidate-trigger-'||substr(tenant_id::text,1,8),
       'CAT',
       'active'
from phase1_catalogue_candidate_fixture;

insert into public.customers(id,tenant_id,wa_id,display_name,phone)
select customer_id,tenant_id,
       'manual:+2348000000098',
       'Candidate Test Customer',
       '+2348000000098'
from phase1_catalogue_candidate_fixture;

with inserted as (
  insert into public.orders(
    tenant_id,customer_id,status,source,customer_note,
    parser_source,review_reasons,currency,total_amount
  )
  select tenant_id,customer_id,'needs_review','manual',
         'candidate trigger fixture','manual','{}'::text[],'NGN',null
  from phase1_catalogue_candidate_fixture
  returning id
)
update phase1_catalogue_candidate_fixture f
set order_id=i.id
from inserted i;

insert into public.order_items(
  tenant_id,order_id,item_name,original_item_name,
  quantity,unit_price,match_source,match_confidence
)
select tenant_id,order_id,
       'Unknown Battery','rechargeable batteries',
       1,null,'unmatched',0.4
from phase1_catalogue_candidate_fixture;

select extensions.ok(
  exists(
    select 1
    from public.order_item_catalogue_candidates c
    join phase1_catalogue_candidate_fixture f
      on f.tenant_id=c.tenant_id
     and f.order_id=c.order_id
    where c.customer_wording='rechargeable batteries'
      and c.status='pending'
  ),
  'new unmatched order items enter the catalogue candidate workflow'
);

select * from extensions.finish();
rollback;
