begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(28);

select extensions.ok(
  has_table_privilege('authenticated','public.catalog_items','SELECT')
  and not has_table_privilege('authenticated','public.catalog_items','INSERT')
  and not has_table_privilege('authenticated','public.catalog_items','UPDATE')
  and not has_table_privilege('authenticated','public.catalog_items','DELETE'),
  'product writes are command-only for authenticated clients'
);

select extensions.ok(
  has_table_privilege('authenticated','public.catalog_item_uoms','SELECT')
  and not has_table_privilege('authenticated','public.catalog_item_uoms','INSERT')
  and not has_table_privilege('authenticated','public.catalog_item_uoms','UPDATE')
  and not has_table_privilege('authenticated','public.catalog_item_uoms','DELETE'),
  'UOM writes are command-only for authenticated clients'
);

select extensions.is(
  (
    select count(*)::integer from pg_policies
    where schemaname='public'
      and policyname in (
        'catalog_items_insert_member','catalog_items_update_member',
        'catalog_items_insert_owner_manager','catalog_items_update_owner_manager',
        'catalog_item_uoms_manage_management'
      )
  ),
  0,
  'legacy direct product and UOM mutation policies are removed'
);

select extensions.ok(
  has_table_privilege('authenticated','public.inventory_movements','SELECT')
  and not has_table_privilege('authenticated','public.inventory_movements','INSERT')
  and not has_table_privilege('authenticated','public.inventory_movements','UPDATE')
  and not has_table_privilege('authenticated','public.inventory_movements','DELETE')
  and not has_table_privilege('authenticated','public.inventory_movements','TRUNCATE'),
  'inventory ledger is read-only to authenticated clients'
);

select extensions.ok(
  exists(
    select 1 from pg_policies
    where schemaname='public' and tablename='inventory_movements'
      and policyname='inventory_movements_select_branch_member'
      and lower(coalesce(qual,'')) like '%sellertray_current_user_can_read_branch%'
  ),
  'direct inventory ledger reads use current-user Branch authority'
);

select extensions.ok(
  exists(
    select 1 from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='inventory_movements'
      and t.tgname='prevent_sellertray_inventory_movement_update' and not t.tgisinternal
  )
  and exists(
    select 1 from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='inventory_movements'
      and t.tgname='prevent_sellertray_inventory_movement_delete' and not t.tgisinternal
  ),
  'inventory ledger keeps update and delete immutability triggers'
);

select extensions.ok(
  exists(
    select 1 from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
    where n.nspname='public' and t.relname='inventory_movements'
      and c.conname='inventory_movements_location_same_branch'
  )
  and exists(
    select 1 from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
    where n.nspname='public' and t.relname='inventory_movements'
      and c.conname='inventory_movements_item_same_tenant'
  ),
  'inventory movements preserve Branch/location and tenant/product integrity'
);

select extensions.ok(
  exists(
    select 1 from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
    where n.nspname='public' and t.relname='catalog_item_uoms'
      and c.conname='catalog_item_uoms_item_same_tenant'
  ),
  'product UOM rows remain tenant-bound to their product'
);

select extensions.ok(
  not has_table_privilege('authenticated','public.sellertray_suppliers','INSERT')
  and not has_table_privilege('authenticated','public.sellertray_suppliers','UPDATE')
  and not has_table_privilege('authenticated','public.sellertray_suppliers','DELETE'),
  'supplier writes remain command-only'
);

select extensions.ok(
  not has_table_privilege('authenticated','public.sellertray_purchase_orders','INSERT')
  and not has_table_privilege('authenticated','public.sellertray_purchase_orders','UPDATE')
  and not has_table_privilege('authenticated','public.sellertray_purchase_orders','DELETE'),
  'Purchase Order writes remain command-only'
);

select extensions.ok(
  not has_table_privilege('authenticated','public.sellertray_purchase_receipts','INSERT')
  and not has_table_privilege('authenticated','public.sellertray_purchase_receipts','UPDATE')
  and not has_table_privilege('authenticated','public.sellertray_purchase_receipts','DELETE'),
  'goods receipt writes remain command-only'
);

select extensions.ok(
  exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='sellertray_purchase_receipts'
      and column_name='items_fingerprint' and is_nullable='NO'
  ),
  'goods receipts persist an immutable normalized item fingerprint'
);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='receive_sellertray_purchase_order'
      and lower(pg_get_functiondef(p.oid)) like '%items_fingerprint%'
      and lower(pg_get_functiondef(p.oid)) like '%each purchase item can appear only once%'
  ),
  'goods receipt command fingerprints facts and rejects duplicate purchase lines'
);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='receive_sellertray_purchase_order'
      and strpos(lower(pg_get_functiondef(p.oid)),'select * into v_existing_receipt')
          < strpos(lower(pg_get_functiondef(p.oid)),'if v_po.status not in')
  ),
  'goods receipt replay is resolved before terminal Purchase Order status blocks new receipts'
);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='receive_sellertray_purchase_order'
      and lower(pg_get_functiondef(p.oid)) like '%different receiving facts%'
      and lower(pg_get_functiondef(p.oid)) like '%v_existing_receipt.items_fingerprint<>v_items_fingerprint%'
  ),
  'goods receipt reference conflicts when replay facts differ'
);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='receive_sellertray_purchase_order'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_user_can_operate_branch%'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_purchase_management_role%'
      and lower(pg_get_functiondef(p.oid)) not like '%sellertray_user_has_capability%can_receive_stock%'
      and lower(pg_get_functiondef(p.oid)) like '%orderdesk_subscription_can_write%'
  ),
  'goods receipt authority requires writable subscription, Branch operation and management/procurement authority rather than a staff receive-stock capability'
);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='create_sellertray_stock_transfer'
      and regexp_replace(lower(pg_get_functiondef(p.oid)),'[[:space:]]+','','g')
          like '%v_existing.items_fingerprint<>v_fingerprint%'
      and lower(pg_get_functiondef(p.oid)) like '%already used for different facts%'
  ),
  'stock transfer creation retains normalized fact-aware idempotency'
);

select extensions.ok(
  not has_table_privilege('authenticated','public.stock_transfers','INSERT')
  and not has_table_privilege('authenticated','public.stock_transfers','UPDATE')
  and not has_table_privilege('authenticated','public.stock_transfers','DELETE')
  and not has_table_privilege('authenticated','public.stock_transfer_items','INSERT')
  and not has_table_privilege('authenticated','public.stock_transfer_items','UPDATE')
  and not has_table_privilege('authenticated','public.stock_transfer_items','DELETE'),
  'stock transfer state is command-only'
);

select extensions.ok(
  not has_function_privilege('authenticated','public.create_sellertray_stock_transfer(uuid,uuid,uuid,text,text,jsonb,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.dispatch_sellertray_stock_transfer(uuid,uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.receive_sellertray_stock_transfer(uuid,uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.cancel_sellertray_stock_transfer(uuid,uuid,text,uuid)','EXECUTE'),
  'stock transfer mutation helpers remain service-only'
);

select extensions.ok(
  to_regprocedure('public.apply_sellertray_inventory_operation(uuid,uuid,uuid,uuid,text,numeric,text,text,text,text,uuid)') is not null
  and to_regprocedure('public.apply_sellertray_inventory_operation(uuid,uuid,uuid,uuid,text,numeric,text,text,text,uuid)') is not null,
  'inventory operation supports explicit client command identity and the internal compatibility wrapper'
);

select extensions.ok(
  not has_function_privilege('authenticated','public.apply_sellertray_inventory_operation(uuid,uuid,uuid,uuid,text,numeric,text,text,text,text,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.apply_sellertray_inventory_operation(uuid,uuid,uuid,uuid,text,numeric,text,text,text,uuid)','EXECUTE'),
  'inventory operation mutation helpers remain service-only'
);

select extensions.ok(
  to_regclass('public.sellertray_supplier_payments') is not null
  and to_regclass('public.sellertray_supplier_payment_reversals') is not null,
  'supplier payment and reversal evidence tables exist'
);

select extensions.ok(
  not has_table_privilege('authenticated','public.sellertray_supplier_payments','SELECT')
  and not has_table_privilege('authenticated','public.sellertray_supplier_payments','INSERT')
  and not has_table_privilege('authenticated','public.sellertray_supplier_payments','UPDATE')
  and not has_table_privilege('authenticated','public.sellertray_supplier_payments','DELETE')
  and not has_table_privilege('authenticated','public.sellertray_supplier_payment_reversals','SELECT')
  and not has_table_privilege('authenticated','public.sellertray_supplier_payment_reversals','INSERT')
  and not has_table_privilege('authenticated','public.sellertray_supplier_payment_reversals','UPDATE')
  and not has_table_privilege('authenticated','public.sellertray_supplier_payment_reversals','DELETE'),
  'supplier payment evidence cannot be written or read around governed APIs'
);

select extensions.ok(
  exists(
    select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='sellertray_supplier_payments'
      and t.tgname='prevent_sellertray_supplier_payment_mutation' and not t.tgisinternal
  )
  and exists(
    select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='sellertray_supplier_payment_reversals'
      and t.tgname='prevent_sellertray_supplier_payment_reversal_mutation' and not t.tgisinternal
  ),
  'supplier payment and reversal evidence are immutable'
);

select extensions.ok(
  has_function_privilege('authenticated','public.record_sellertray_supplier_payment(uuid,uuid,text,text,numeric,timestamptz,text)','EXECUTE')
  and has_function_privilege('authenticated','public.reverse_sellertray_supplier_payment(uuid,uuid,text)','EXECUTE')
  and not has_function_privilege('anon','public.record_sellertray_supplier_payment(uuid,uuid,text,text,numeric,timestamptz,text)','EXECUTE')
  and not has_function_privilege('anon','public.reverse_sellertray_supplier_payment(uuid,uuid,text)','EXECUTE'),
  'supplier payment commands are authenticated-only governed APIs'
);

select extensions.ok(
  not has_function_privilege('authenticated','public.sellertray_purchase_paid_amount(uuid,uuid)','EXECUTE')
  and has_function_privilege('service_role','public.sellertray_purchase_paid_amount(uuid,uuid)','EXECUTE'),
  'supplier paid-amount helper remains internal'
);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='record_sellertray_supplier_payment'
      and lower(pg_get_functiondef(p.oid)) like '%p_paid_at is not null%'
      and lower(pg_get_functiondef(p.oid)) like '%paid_at is distinct from p_paid_at%'
      and lower(pg_get_functiondef(p.oid)) like '%different payment evidence%'
  ),
  'supplier payment replay rejects a reused reference with a changed explicit payment timestamp'
);

select extensions.ok(
  exists(
    select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='sellertray_purchase_orders'
      and t.tgname='guard_sellertray_purchase_cancellation_with_payment' and not t.tgisinternal
  ),
  'Purchase Order cancellation remains guarded while effective supplier payment evidence exists'
);

select * from extensions.finish();
rollback;
