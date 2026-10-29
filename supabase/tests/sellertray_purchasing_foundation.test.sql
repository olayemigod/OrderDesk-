begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(23);

select extensions.ok(
  to_regclass('public.sellertray_suppliers') is not null
  and to_regclass('public.sellertray_purchase_orders') is not null
  and to_regclass('public.sellertray_purchase_order_items') is not null
  and to_regclass('public.sellertray_purchase_receipts') is not null
  and to_regclass('public.sellertray_purchase_receipt_items') is not null,
  'supplier, purchase order and receipt tables exist'
);

select extensions.ok(
  not has_table_privilege('authenticated','public.sellertray_suppliers','INSERT')
  and not has_table_privilege('authenticated','public.sellertray_suppliers','UPDATE')
  and not has_table_privilege('authenticated','public.sellertray_suppliers','DELETE'),
  'authenticated clients cannot write suppliers directly'
);

select extensions.ok(
  not has_table_privilege('authenticated','public.sellertray_purchase_orders','INSERT')
  and not has_table_privilege('authenticated','public.sellertray_purchase_orders','UPDATE')
  and not has_table_privilege('authenticated','public.sellertray_purchase_orders','DELETE'),
  'authenticated clients cannot write purchase orders directly'
);

select extensions.ok(
  not has_table_privilege('authenticated','public.sellertray_purchase_receipts','INSERT')
  and not has_table_privilege('authenticated','public.sellertray_purchase_receipts','UPDATE')
  and not has_table_privilege('authenticated','public.sellertray_purchase_receipts','DELETE'),
  'authenticated clients cannot write purchase receipts directly'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
        'save_sellertray_supplier',
        'get_sellertray_suppliers',
        'save_sellertray_purchase_order',
        'place_sellertray_purchase_order',
        'cancel_sellertray_purchase_order',
        'get_sellertray_purchase_orders',
        'get_sellertray_purchase_order_detail',
        'receive_sellertray_purchase_order'
      )
  ),
  8,
  'purchasing command and read functions exist'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
        'save_sellertray_supplier',
        'get_sellertray_suppliers',
        'save_sellertray_purchase_order',
        'place_sellertray_purchase_order',
        'cancel_sellertray_purchase_order',
        'get_sellertray_purchase_orders',
        'get_sellertray_purchase_order_detail',
        'receive_sellertray_purchase_order'
      )
      and p.prosecdef=true
  ),
  8,
  'purchasing command and read functions are security definer functions'
);

select extensions.ok(
  has_function_privilege('authenticated','public.save_sellertray_supplier(uuid,uuid,text,text,text,text,text,text,boolean)','EXECUTE')
  and has_function_privilege('authenticated','public.save_sellertray_purchase_order(uuid,uuid,uuid,uuid,text,date,text,jsonb)','EXECUTE')
  and has_function_privilege('authenticated','public.place_sellertray_purchase_order(uuid,uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.cancel_sellertray_purchase_order(uuid,uuid,text)','EXECUTE')
  and has_function_privilege('authenticated','public.receive_sellertray_purchase_order(uuid,uuid,text,text,jsonb)','EXECUTE'),
  'authenticated clients can call governed purchasing mutations'
);

select extensions.ok(
  not has_function_privilege('anon','public.save_sellertray_supplier(uuid,uuid,text,text,text,text,text,text,boolean)','EXECUTE')
  and not has_function_privilege('anon','public.save_sellertray_purchase_order(uuid,uuid,uuid,uuid,text,date,text,jsonb)','EXECUTE')
  and not has_function_privilege('anon','public.receive_sellertray_purchase_order(uuid,uuid,text,text,jsonb)','EXECUTE'),
  'anonymous clients cannot call purchasing mutations'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='save_sellertray_supplier'
      and lower(pg_get_functiondef(p.oid)) like '%owner%manager%'
      and lower(pg_get_functiondef(p.oid)) like '%orderdesk_subscription_can_write%'
      and lower(pg_get_functiondef(p.oid)) like '%open purchase orders%'
  ),
  'supplier changes are management-only, subscription-aware and protect open purchases'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='save_sellertray_purchase_order'
      and lower(pg_get_functiondef(p.oid)) like '%only a draft purchase order can be edited%'
      and lower(pg_get_functiondef(p.oid)) like '%catalog_item_uoms%'
      and lower(pg_get_functiondef(p.oid)) like '%conversion_factor%'
      and lower(pg_get_functiondef(p.oid)) like '%ordered_stock_quantity%'
  ),
  'purchase drafts snapshot governed UOM conversion and stock quantity'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='save_sellertray_purchase_order'
      and lower(pg_get_functiondef(p.oid)) like '%allow_fractional%'
      and lower(pg_get_functiondef(p.oid)) like '%does not allow fractional quantity%'
  ),
  'purchase draft enforces UOM fractional policy'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='place_sellertray_purchase_order'
      and lower(pg_get_functiondef(p.oid)) like '%status=''ordered''%'
      and lower(pg_get_functiondef(p.oid)) like '%idempotentreplay%'
  ),
  'placing a purchase order is governed and retry-safe'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='cancel_sellertray_purchase_order'
      and lower(pg_get_functiondef(p.oid)) like '%received stock cannot be cancelled%'
      and lower(pg_get_functiondef(p.oid)) like '%purchase order with receipts cannot be cancelled%'
  ),
  'purchase cancellation cannot erase received-stock history'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='receive_sellertray_purchase_order'
      and lower(pg_get_functiondef(p.oid)) like '%can_receive_stock%'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_user_can_operate_branch%'
      and lower(pg_get_functiondef(p.oid)) like '%orderdesk_subscription_can_write%'
  ),
  'purchase receiving requires Branch access, stock-receive capability and writable subscription'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='receive_sellertray_purchase_order'
      and lower(pg_get_functiondef(p.oid)) like '%apply_sellertray_inventory_operation%'
      and lower(pg_get_functiondef(p.oid)) like '%''receive''%'
  ),
  'purchase receiving reuses the governed shared inventory operation'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='receive_sellertray_purchase_order'
      and lower(pg_get_functiondef(p.oid)) like '%changed after this purchase was placed%'
      and lower(pg_get_functiondef(p.oid)) like '%v_current_factor<>v_item.conversion_factor%'
  ),
  'receiving fails closed when UOM conversion drifts after placement'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='receive_sellertray_purchase_order'
      and lower(pg_get_functiondef(p.oid)) like '%receipt reference is already used%'
      and lower(pg_get_functiondef(p.oid)) like '%idempotentreplay%'
  ),
  'purchase receipt references are duplicate-safe and retry-aware'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='receive_sellertray_purchase_order'
      and lower(pg_get_functiondef(p.oid)) like '%exceeds the remaining ordered quantity%'
      and lower(pg_get_functiondef(p.oid)) like '%partially_received%'
      and lower(pg_get_functiondef(p.oid)) like '%''received''%'
  ),
  'purchase receipts enforce remaining quantity and partial/complete lifecycle'
);

select extensions.ok(
  exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid=c.conrelid
    join pg_namespace n on n.oid=t.relnamespace
    where n.nspname='public' and t.relname='sellertray_purchase_order_items'
      and c.conname='sellertray_purchase_order_items_catalog_same_tenant'
      and c.condeferrable=true
  ),
  'purchase product history uses deferred integrity so tenant deletion can complete without enabling ordinary product deletion'
);

select extensions.ok(
  exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid=c.conrelid
    join pg_namespace n on n.oid=t.relnamespace
    where n.nspname='public' and t.relname='sellertray_purchase_receipt_items'
      and c.conname='sellertray_purchase_receipt_items_movement_same_tenant'
      and c.condeferrable=true
  ),
  'receipt-to-inventory movement history uses deferred same-tenant integrity'
);

select extensions.ok(
  exists (
    select 1 from pg_indexes
    where schemaname='public' and tablename='sellertray_purchase_receipts'
      and indexname='sellertray_purchase_receipts_reference_unique'
  ),
  'purchase receipt business references are uniquely indexed per business'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_sellertray_purchase_orders'
      and lower(pg_get_functiondef(p.oid)) like '%can_receive_stock%'
      and lower(pg_get_functiondef(p.oid)) like '%ordered%partially_received%'
  ),
  'Staff purchase visibility is limited to receivable purchases when stock-receive capability exists'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_sellertray_purchase_order_detail'
      and lower(pg_get_functiondef(p.oid)) like '%remainingquantity%'
      and lower(pg_get_functiondef(p.oid)) like '%receipts%'
  ),
  'purchase detail exposes remaining quantities and receipt history through a governed read model'
);

select * from extensions.finish();
rollback;
