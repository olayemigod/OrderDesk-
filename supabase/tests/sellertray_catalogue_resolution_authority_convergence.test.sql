begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(18);

select extensions.ok(
  to_regprocedure('public.sellertray_add_catalogue_order_item(uuid,uuid,uuid,numeric)') is not null,
  'catalogue add command exists'
);
select extensions.ok(
  position('sellertray_user_can_manage_order_operation' in pg_get_functiondef('public.sellertray_add_catalogue_order_item(uuid,uuid,uuid,numeric)'::regprocedure)) > 0
  and position('orderdesk_subscription_can_write' in pg_get_functiondef('public.sellertray_add_catalogue_order_item(uuid,uuid,uuid,numeric)'::regprocedure)) > 0,
  'catalogue add requires shared order authority and writable subscription'
);
select extensions.ok(
  position('sellertray.audit_actor_user_id' in pg_get_functiondef('public.sellertray_add_catalogue_order_item(uuid,uuid,uuid,numeric)'::regprocedure)) > 0,
  'catalogue add preserves governed audit actor context'
);

select extensions.ok(
  to_regprocedure('public.sellertray_keep_order_item_one_off(uuid,uuid,numeric,text)') is not null,
  'one-off resolution command exists'
);
select extensions.ok(
  position('sellertray_user_can_manage_order_operation' in pg_get_functiondef('public.sellertray_keep_order_item_one_off(uuid,uuid,numeric,text)'::regprocedure)) > 0
  and position('orderdesk_subscription_can_write' in pg_get_functiondef('public.sellertray_keep_order_item_one_off(uuid,uuid,numeric,text)'::regprocedure)) > 0,
  'one-off resolution requires shared order authority and writable subscription'
);
select extensions.ok(
  position('owner' in pg_get_functiondef('public.sellertray_keep_order_item_one_off(uuid,uuid,numeric,text)'::regprocedure)) > 0
  and position('manager' in pg_get_functiondef('public.sellertray_keep_order_item_one_off(uuid,uuid,numeric,text)'::regprocedure)) > 0,
  'one-off selling-price approval preserves the existing management restriction'
);

select extensions.ok(
  to_regprocedure('public.sellertray_match_order_item_to_catalogue(uuid,uuid,uuid,boolean)') is not null,
  'catalogue match command exists'
);
select extensions.ok(
  position('sellertray_user_can_manage_order_operation' in pg_get_functiondef('public.sellertray_match_order_item_to_catalogue(uuid,uuid,uuid,boolean)'::regprocedure)) > 0
  and position('orderdesk_subscription_can_write' in pg_get_functiondef('public.sellertray_match_order_item_to_catalogue(uuid,uuid,uuid,boolean)'::regprocedure)) > 0,
  'catalogue match requires shared order authority and writable subscription'
);
select extensions.ok(
  position('sellertray_user_can_manage_products' in pg_get_functiondef('public.sellertray_match_order_item_to_catalogue(uuid,uuid,uuid,boolean)'::regprocedure)) > 0,
  'alias learning is gated by shared product authority'
);

select extensions.ok(
  to_regprocedure('public.sellertray_create_catalogue_from_order_item(uuid,uuid,text,numeric,text,text,boolean)') is not null,
  'create-from-order catalogue command exists'
);
select extensions.ok(
  position('sellertray_user_can_manage_order_operation' in pg_get_functiondef('public.sellertray_create_catalogue_from_order_item(uuid,uuid,text,numeric,text,text,boolean)'::regprocedure)) > 0
  and position('sellertray_user_can_manage_products' in pg_get_functiondef('public.sellertray_create_catalogue_from_order_item(uuid,uuid,text,numeric,text,text,boolean)'::regprocedure)) > 0
  and position('orderdesk_subscription_can_write' in pg_get_functiondef('public.sellertray_create_catalogue_from_order_item(uuid,uuid,text,numeric,text,text,boolean)'::regprocedure)) > 0,
  'create-from-order requires shared order, product and subscription authority'
);
select extensions.ok(
  position('save_sellertray_catalogue_item' in pg_get_functiondef('public.sellertray_create_catalogue_from_order_item(uuid,uuid,text,numeric,text,text,boolean)'::regprocedure)) > 0,
  'create-from-order reuses the governed catalogue command instead of direct product creation'
);
select extensions.ok(
  position('insert into public.catalog_items' in lower(pg_get_functiondef('public.sellertray_create_catalogue_from_order_item(uuid,uuid,text,numeric,text,text,boolean)'::regprocedure))) = 0,
  'create-from-order no longer bypasses product command authority with direct catalogue insertion'
);

select extensions.ok(
  to_regprocedure('public.sellertray_list_order_item_catalogue_candidates(uuid,uuid)') is not null,
  'catalogue candidate reader exists'
);
select extensions.ok(
  position('sellertray_user_can_manage_order_operation' in pg_get_functiondef('public.sellertray_list_order_item_catalogue_candidates(uuid,uuid)'::regprocedure)) > 0,
  'catalogue candidate reader is Branch-scoped through shared order authority'
);

select extensions.ok(
  has_function_privilege('authenticated','public.sellertray_add_catalogue_order_item(uuid,uuid,uuid,numeric)','EXECUTE')
  and has_function_privilege('authenticated','public.sellertray_keep_order_item_one_off(uuid,uuid,numeric,text)','EXECUTE')
  and has_function_privilege('authenticated','public.sellertray_match_order_item_to_catalogue(uuid,uuid,uuid,boolean)','EXECUTE')
  and has_function_privilege('authenticated','public.sellertray_create_catalogue_from_order_item(uuid,uuid,text,numeric,text,text,boolean)','EXECUTE')
  and has_function_privilege('authenticated','public.sellertray_list_order_item_catalogue_candidates(uuid,uuid)','EXECUTE'),
  'signed-in clients retain the established catalogue-resolution RPC surface'
);
select extensions.ok(
  not has_function_privilege('anon','public.sellertray_add_catalogue_order_item(uuid,uuid,uuid,numeric)','EXECUTE')
  and not has_function_privilege('anon','public.sellertray_keep_order_item_one_off(uuid,uuid,numeric,text)','EXECUTE')
  and not has_function_privilege('anon','public.sellertray_match_order_item_to_catalogue(uuid,uuid,uuid,boolean)','EXECUTE')
  and not has_function_privilege('anon','public.sellertray_create_catalogue_from_order_item(uuid,uuid,text,numeric,text,text,boolean)','EXECUTE')
  and not has_function_privilege('anon','public.sellertray_list_order_item_catalogue_candidates(uuid,uuid)','EXECUTE'),
  'anonymous callers cannot execute catalogue-resolution RPCs'
);
select extensions.ok(
  exists(
    select 1
    from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname='catalog_items'
      and t.tgname='sync_sellertray_stock_uom_row'
      and not t.tgisinternal
  ),
  'governed catalogue creation retains automatic stock-UOM initialization'
);

select * from extensions.finish();
rollback;
