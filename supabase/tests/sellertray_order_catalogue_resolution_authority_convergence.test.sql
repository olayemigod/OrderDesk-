begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(22);

select extensions.ok(
  has_function_privilege('authenticated','public.sellertray_list_order_item_catalogue_candidates(uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.sellertray_list_order_item_catalogue_candidates(uuid,uuid)','EXECUTE'),
  'catalogue candidate review is authenticated-only'
);
select extensions.ok(
  position('sellertray_user_can_manage_order_operation' in pg_get_functiondef('public.sellertray_list_order_item_catalogue_candidates(uuid,uuid)'::regprocedure))>0,
  'catalogue candidate reads use shared order and Branch authority'
);

select extensions.ok(
  has_function_privilege('authenticated','public.sellertray_add_catalogue_order_item(uuid,uuid,uuid,numeric)','EXECUTE')
  and not has_function_privilege('anon','public.sellertray_add_catalogue_order_item(uuid,uuid,uuid,numeric)','EXECUTE'),
  'catalogue item add command is authenticated-only'
);
select extensions.ok(
  position('sellertray_user_can_manage_order_operation' in pg_get_functiondef('public.sellertray_add_catalogue_order_item(uuid,uuid,uuid,numeric)'::regprocedure))>0,
  'catalogue item add requires shared order and Branch authority'
);
select extensions.ok(
  position('orderdesk_subscription_can_write' in pg_get_functiondef('public.sellertray_add_catalogue_order_item(uuid,uuid,uuid,numeric)'::regprocedure))>0,
  'catalogue item add requires writable subscription'
);
select extensions.ok(
  position('selected_uom' in pg_get_functiondef('public.sellertray_add_catalogue_order_item(uuid,uuid,uuid,numeric)'::regprocedure))>0
  and position('stock_uom' in pg_get_functiondef('public.sellertray_add_catalogue_order_item(uuid,uuid,uuid,numeric)'::regprocedure))>0,
  'catalogue item add snapshots the product stock UOM explicitly'
);

select extensions.ok(
  has_function_privilege('authenticated','public.sellertray_keep_order_item_one_off(uuid,uuid,numeric,text)','EXECUTE')
  and not has_function_privilege('anon','public.sellertray_keep_order_item_one_off(uuid,uuid,numeric,text)','EXECUTE'),
  'one-off order line resolution is authenticated-only'
);
select extensions.ok(
  position('sellertray_user_can_manage_order_operation' in pg_get_functiondef('public.sellertray_keep_order_item_one_off(uuid,uuid,numeric,text)'::regprocedure))>0
  and position('orderdesk_subscription_can_write' in pg_get_functiondef('public.sellertray_keep_order_item_one_off(uuid,uuid,numeric,text)'::regprocedure))>0,
  'one-off resolution requires order authority and writable subscription'
);
select extensions.ok(
  position('selected_uom = ''Each''' in pg_get_functiondef('public.sellertray_keep_order_item_one_off(uuid,uuid,numeric,text)'::regprocedure))>0
  or position('selected_uom=''Each''' in replace(pg_get_functiondef('public.sellertray_keep_order_item_one_off(uuid,uuid,numeric,text)'::regprocedure),' ',''))>0,
  'one-off resolution resets catalogue-specific UOM state'
);
select extensions.ok(
  position('conversion_factor = 1' in pg_get_functiondef('public.sellertray_keep_order_item_one_off(uuid,uuid,numeric,text)'::regprocedure))>0
  or position('conversion_factor=1' in replace(pg_get_functiondef('public.sellertray_keep_order_item_one_off(uuid,uuid,numeric,text)'::regprocedure),' ',''))>0,
  'one-off resolution resets conversion factor to one'
);

select extensions.ok(
  has_function_privilege('authenticated','public.sellertray_match_order_item_to_catalogue(uuid,uuid,uuid,boolean)','EXECUTE')
  and not has_function_privilege('anon','public.sellertray_match_order_item_to_catalogue(uuid,uuid,uuid,boolean)','EXECUTE'),
  'catalogue match command is authenticated-only'
);
select extensions.ok(
  position('sellertray_user_can_manage_order_operation' in pg_get_functiondef('public.sellertray_match_order_item_to_catalogue(uuid,uuid,uuid,boolean)'::regprocedure))>0
  and position('orderdesk_subscription_can_write' in pg_get_functiondef('public.sellertray_match_order_item_to_catalogue(uuid,uuid,uuid,boolean)'::regprocedure))>0,
  'catalogue matching requires order authority and writable subscription'
);
select extensions.ok(
  position('sellertray_user_can_manage_products' in pg_get_functiondef('public.sellertray_match_order_item_to_catalogue(uuid,uuid,uuid,boolean)'::regprocedure))>0,
  'learning a catalogue alias remains behind product-management authority'
);
select extensions.ok(
  position('catalog_item_uoms' in pg_get_functiondef('public.sellertray_match_order_item_to_catalogue(uuid,uuid,uuid,boolean)'::regprocedure))>0
  and position('conversion_factor' in pg_get_functiondef('public.sellertray_match_order_item_to_catalogue(uuid,uuid,uuid,boolean)'::regprocedure))>0,
  'catalogue matching preserves a valid configured UOM when possible'
);
select extensions.ok(
  position('stock_uom' in pg_get_functiondef('public.sellertray_match_order_item_to_catalogue(uuid,uuid,uuid,boolean)'::regprocedure))>0,
  'catalogue matching falls back to the target product stock UOM'
);

select extensions.ok(
  has_function_privilege('authenticated','public.sellertray_create_catalogue_from_order_item(uuid,uuid,text,numeric,text,text,boolean)','EXECUTE')
  and not has_function_privilege('anon','public.sellertray_create_catalogue_from_order_item(uuid,uuid,text,numeric,text,text,boolean)','EXECUTE'),
  'create-product-from-order command is authenticated-only'
);
select extensions.ok(
  position('sellertray_user_can_manage_order_operation' in pg_get_functiondef('public.sellertray_create_catalogue_from_order_item(uuid,uuid,text,numeric,text,text,boolean)'::regprocedure))>0,
  'create-product-from-order requires shared order and Branch authority'
);
select extensions.ok(
  position('sellertray_user_can_manage_products' in pg_get_functiondef('public.sellertray_create_catalogue_from_order_item(uuid,uuid,text,numeric,text,text,boolean)'::regprocedure))>0,
  'create-product-from-order requires product-management authority'
);
select extensions.ok(
  position('orderdesk_subscription_can_write' in pg_get_functiondef('public.sellertray_create_catalogue_from_order_item(uuid,uuid,text,numeric,text,text,boolean)'::regprocedure))>0,
  'create-product-from-order requires writable subscription'
);
select extensions.ok(
  position('save_sellertray_catalogue_item' in pg_get_functiondef('public.sellertray_create_catalogue_from_order_item(uuid,uuid,text,numeric,text,text,boolean)'::regprocedure))>0,
  'create-product-from-order reuses the governed catalogue command instead of direct product insertion'
);
select extensions.ok(
  position('insert into public.catalog_items' in lower(pg_get_functiondef('public.sellertray_create_catalogue_from_order_item(uuid,uuid,text,numeric,text,text,boolean)'::regprocedure)))=0,
  'create-product-from-order no longer writes the product table directly'
);
select extensions.ok(
  position('selected_uom = ''Each''' in pg_get_functiondef('public.sellertray_create_catalogue_from_order_item(uuid,uuid,text,numeric,text,text,boolean)'::regprocedure))>0
  or position('selected_uom=''Each''' in replace(pg_get_functiondef('public.sellertray_create_catalogue_from_order_item(uuid,uuid,text,numeric,text,text,boolean)'::regprocedure),' ',''))>0,
  'new catalogue resolution snapshots the default stock UOM on the order line'
);

select * from extensions.finish();
rollback;
