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

select extensions.ok(
  exists(
    select 1
    from public.order_item_catalogue_candidates c
    join public.order_items oi on oi.id=c.order_item_id
    where oi.match_source='unmatched'
      and oi.catalog_item_id is null
      and c.status='pending'
  ),
  'existing unmatched order items were backfilled into candidate workflow'
);

select * from extensions.finish();
rollback;
