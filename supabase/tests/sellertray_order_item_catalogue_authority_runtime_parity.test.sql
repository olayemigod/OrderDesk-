begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(18);

select extensions.ok(
  position('uom_name' in pg_get_functiondef('public.sync_sellertray_stock_uom_row()'::regprocedure))>0
  and position('is_stock_uom' in pg_get_functiondef('public.sync_sellertray_stock_uom_row()'::regprocedure))=0
  and position('is_active' in pg_get_functiondef('public.sync_sellertray_stock_uom_row()'::regprocedure))=0,
  'stock UOM synchronizer uses the current catalogue unit schema'
);
select extensions.ok(
  not has_function_privilege('authenticated','public.sync_sellertray_stock_uom_row()','EXECUTE')
  and not has_function_privilege('anon','public.sync_sellertray_stock_uom_row()','EXECUTE'),
  'stock UOM trigger helper is not a client command'
);

select extensions.ok(
  to_regprocedure('public.sellertray_add_catalogue_order_item(uuid,uuid,uuid,numeric)') is not null
  and to_regprocedure('public.sellertray_match_order_item_to_catalogue(uuid,uuid,uuid,boolean)') is not null
  and to_regprocedure('public.sellertray_keep_order_item_one_off(uuid,uuid,numeric,text)') is not null
  and to_regprocedure('public.sellertray_create_catalogue_from_order_item(uuid,uuid,text,numeric,text,text,boolean)') is not null
  and to_regprocedure('public.sellertray_list_order_item_catalogue_candidates(uuid,uuid)') is not null,
  'legacy catalogue-review RPC contract remains available'
);
select extensions.ok(
  has_function_privilege('authenticated','public.sellertray_add_catalogue_order_item(uuid,uuid,uuid,numeric)','EXECUTE')
  and has_function_privilege('authenticated','public.sellertray_match_order_item_to_catalogue(uuid,uuid,uuid,boolean)','EXECUTE')
  and has_function_privilege('authenticated','public.sellertray_keep_order_item_one_off(uuid,uuid,numeric,text)','EXECUTE')
  and has_function_privilege('authenticated','public.sellertray_create_catalogue_from_order_item(uuid,uuid,text,numeric,text,text,boolean)','EXECUTE')
  and has_function_privilege('authenticated','public.sellertray_list_order_item_catalogue_candidates(uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.sellertray_add_catalogue_order_item(uuid,uuid,uuid,numeric)','EXECUTE')
  and not has_function_privilege('anon','public.sellertray_match_order_item_to_catalogue(uuid,uuid,uuid,boolean)','EXECUTE')
  and not has_function_privilege('anon','public.sellertray_keep_order_item_one_off(uuid,uuid,numeric,text)','EXECUTE')
  and not has_function_privilege('anon','public.sellertray_create_catalogue_from_order_item(uuid,uuid,text,numeric,text,text,boolean)','EXECUTE')
  and not has_function_privilege('anon','public.sellertray_list_order_item_catalogue_candidates(uuid,uuid)','EXECUTE'),
  'catalogue-review RPCs remain authenticated-only'
);

select extensions.ok(
  position('sellertray_user_can_manage_order_operation' in pg_get_functiondef('public.sellertray_add_catalogue_order_item(uuid,uuid,uuid,numeric)'::regprocedure))>0
  and position('orderdesk_subscription_can_write' in pg_get_functiondef('public.sellertray_add_catalogue_order_item(uuid,uuid,uuid,numeric)'::regprocedure))>0,
  'catalogue add requires shared order and subscription authority'
);
select extensions.ok(
  position('selected_uom' in pg_get_functiondef('public.sellertray_add_catalogue_order_item(uuid,uuid,uuid,numeric)'::regprocedure))>0
  and position('stock_uom' in pg_get_functiondef('public.sellertray_add_catalogue_order_item(uuid,uuid,uuid,numeric)'::regprocedure))>0
  and position('conversion_factor' in pg_get_functiondef('public.sellertray_add_catalogue_order_item(uuid,uuid,uuid,numeric)'::regprocedure))>0,
  'catalogue add snapshots the product Stock UOM explicitly'
);
select extensions.ok(
  position('sellertray.audit_actor_user_id' in pg_get_functiondef('public.sellertray_add_catalogue_order_item(uuid,uuid,uuid,numeric)'::regprocedure))>0,
  'catalogue add preserves governed audit actor context'
);

select extensions.ok(
  position('sellertray_user_can_manage_order_operation' in pg_get_functiondef('public.sellertray_match_order_item_to_catalogue(uuid,uuid,uuid,boolean)'::regprocedure))>0
  and position('orderdesk_subscription_can_write' in pg_get_functiondef('public.sellertray_match_order_item_to_catalogue(uuid,uuid,uuid,boolean)'::regprocedure))>0,
  'catalogue match requires shared order and subscription authority'
);
select extensions.ok(
  position('sellertray_user_can_manage_products' in pg_get_functiondef('public.sellertray_match_order_item_to_catalogue(uuid,uuid,uuid,boolean)'::regprocedure))>0,
  'catalogue alias learning requires product-management authority'
);
select extensions.ok(
  position('selected_uom=v_stock_uom' in replace(pg_get_functiondef('public.sellertray_match_order_item_to_catalogue(uuid,uuid,uuid,boolean)'::regprocedure),' ',''))>0
  and position('conversion_factor=1' in replace(pg_get_functiondef('public.sellertray_match_order_item_to_catalogue(uuid,uuid,uuid,boolean)'::regprocedure),' ',''))>0,
  'catalogue match replaces stale line-unit context with the target Stock UOM'
);

select extensions.ok(
  position('sellertray_user_can_manage_order_operation' in pg_get_functiondef('public.sellertray_keep_order_item_one_off(uuid,uuid,numeric,text)'::regprocedure))>0
  and position('orderdesk_subscription_can_write' in pg_get_functiondef('public.sellertray_keep_order_item_one_off(uuid,uuid,numeric,text)'::regprocedure))>0,
  'one-off approval requires shared order and subscription authority'
);
select extensions.ok(
  position('v_rolenotin(''owner'',''manager'')' in replace(pg_get_functiondef('public.sellertray_keep_order_item_one_off(uuid,uuid,numeric,text)'::regprocedure),' ',''))>0,
  'one-off price approval preserves the existing Owner or Manager restriction'
);
select extensions.ok(
  position('selected_uom=''Each''' in replace(pg_get_functiondef('public.sellertray_keep_order_item_one_off(uuid,uuid,numeric,text)'::regprocedure),' ',''))>0
  and position('conversion_factor=1' in replace(pg_get_functiondef('public.sellertray_keep_order_item_one_off(uuid,uuid,numeric,text)'::regprocedure),' ',''))>0,
  'one-off resolution clears catalogue UOM state back to Each x1'
);

select extensions.ok(
  position('sellertray_user_can_manage_order_operation' in pg_get_functiondef('public.sellertray_create_catalogue_from_order_item(uuid,uuid,text,numeric,text,text,boolean)'::regprocedure))>0
  and position('sellertray_user_can_manage_products' in pg_get_functiondef('public.sellertray_create_catalogue_from_order_item(uuid,uuid,text,numeric,text,text,boolean)'::regprocedure))>0
  and position('orderdesk_subscription_can_write' in pg_get_functiondef('public.sellertray_create_catalogue_from_order_item(uuid,uuid,text,numeric,text,text,boolean)'::regprocedure))>0,
  'create-from-order requires order, product and subscription authority'
);
select extensions.ok(
  position('save_sellertray_catalogue_item' in pg_get_functiondef('public.sellertray_create_catalogue_from_order_item(uuid,uuid,text,numeric,text,text,boolean)'::regprocedure))>0
  and position('insert into public.catalog_items' in lower(pg_get_functiondef('public.sellertray_create_catalogue_from_order_item(uuid,uuid,text,numeric,text,text,boolean)'::regprocedure)))=0,
  'create-from-order reuses the governed catalogue command instead of direct product writes'
);
select extensions.ok(
  position('selected_uom=v_stock_uom' in replace(pg_get_functiondef('public.sellertray_create_catalogue_from_order_item(uuid,uuid,text,numeric,text,text,boolean)'::regprocedure),' ',''))>0
  and position('conversion_factor=1' in replace(pg_get_functiondef('public.sellertray_create_catalogue_from_order_item(uuid,uuid,text,numeric,text,text,boolean)'::regprocedure),' ',''))>0,
  'create-from-order snapshots the created product Stock UOM explicitly'
);

select extensions.ok(
  position('sellertray_user_can_manage_order_operation' in pg_get_functiondef('public.sellertray_list_order_item_catalogue_candidates(uuid,uuid)'::regprocedure))>0,
  'catalogue candidate review is Branch-scoped through shared order authority'
);

select extensions.ok(
  position('commercial_action_ledger' in pg_get_functiondef('public.sellertray_add_catalogue_order_item(uuid,uuid,uuid,numeric)'::regprocedure))>0
  and position('commercial_action_ledger' in pg_get_functiondef('public.sellertray_match_order_item_to_catalogue(uuid,uuid,uuid,boolean)'::regprocedure))>0
  and position('commercial_action_ledger' in pg_get_functiondef('public.sellertray_keep_order_item_one_off(uuid,uuid,numeric,text)'::regprocedure))>0
  and position('commercial_action_ledger' in pg_get_functiondef('public.sellertray_create_catalogue_from_order_item(uuid,uuid,text,numeric,text,text,boolean)'::regprocedure))>0,
  'all catalogue-review mutations retain commercial audit history'
);

select * from extensions.finish();
rollback;
