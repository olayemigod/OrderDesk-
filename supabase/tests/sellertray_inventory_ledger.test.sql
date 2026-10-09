begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(23);

create temp table sellertray_inventory_fixture (
  tenant_id uuid not null,
  product_id uuid not null,
  branch_id uuid,
  location_id uuid,
  opening_id uuid,
  opening_retry_id uuid,
  sale_id uuid,
  reversal_id uuid,
  different_idempotency_facts_rejected boolean not null default false,
  invalid_conversion_rejected boolean not null default false,
  invalid_location_rejected boolean not null default false,
  update_rejected boolean not null default false,
  delete_rejected boolean not null default false,
  second_reversal_rejected boolean not null default false
) on commit drop;

insert into sellertray_inventory_fixture(tenant_id, product_id)
values (gen_random_uuid(), gen_random_uuid());

insert into public.tenants(id, name, slug, merchant_code, subscription_status)
select
  tenant_id,
  'SellerTray Inventory Ledger Test',
  'sellertray-inventory-' || substr(tenant_id::text, 1, 8),
  'INV',
  'active'
from sellertray_inventory_fixture;

update public.tenant_subscriptions
set status = 'active', trial_ends_at = null, grace_ends_at = null
where tenant_id = (select tenant_id from sellertray_inventory_fixture);

update sellertray_inventory_fixture f
set branch_id = b.id
from public.branches b
where b.tenant_id = f.tenant_id
  and b.is_default = true;

update sellertray_inventory_fixture f
set location_id = sl.id
from public.stock_locations sl
where sl.tenant_id = f.tenant_id
  and sl.branch_id = f.branch_id
  and sl.is_default = true;

insert into public.catalog_items(
  id, tenant_id, name, sku, price_ngn, is_active, stock_uom, allow_fractional_stock
)
select
  product_id, tenant_id, 'Inventory Test Drink', 'INV-DRINK', 100, true, 'Bottle', false
from sellertray_inventory_fixture;

insert into public.catalog_item_uoms(
  tenant_id, catalog_item_id, uom_name, conversion_factor,
  selling_price, allow_fractional, is_default_selling
)
select tenant_id, product_id, 'Pack', 12, 1050, false, false
from sellertray_inventory_fixture;

select extensions.ok(
  (select location_id is not null from sellertray_inventory_fixture),
  'a branch receives a default stock location'
);

select extensions.is(
  (
    select count(*)::integer
    from public.stock_locations sl
    where sl.tenant_id = (select tenant_id from sellertray_inventory_fixture)
      and sl.branch_id = (select branch_id from sellertray_inventory_fixture)
      and sl.is_default = true
  ),
  1,
  'a branch has exactly one default stock location'
);

select extensions.ok(
  not has_table_privilege('authenticated', 'public.inventory_movements', 'INSERT'),
  'authenticated clients cannot insert inventory ledger rows directly'
);

select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.record_sellertray_inventory_movement(uuid,uuid,uuid,uuid,text,numeric,text,numeric,numeric,text,text,text,timestamptz,uuid,text,jsonb,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot call the privileged inventory posting command'
);

select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.record_sellertray_inventory_movement(uuid,uuid,uuid,uuid,text,numeric,text,numeric,numeric,text,text,text,timestamptz,uuid,text,jsonb,uuid)',
    'EXECUTE'
  ),
  'service role can call the governed inventory posting command'
);

update sellertray_inventory_fixture
set opening_id = public.record_sellertray_inventory_movement(
  tenant_id,
  branch_id,
  location_id,
  product_id,
  'opening',
  24,
  'Pack',
  2,
  12,
  'opening_stock',
  'OPEN-001',
  'opening:OPEN-001',
  now(),
  null,
  'Opening count',
  '{}'::jsonb,
  null
);

select extensions.ok(
  (select opening_id is not null from sellertray_inventory_fixture),
  'opening stock posts an immutable movement'
);

select extensions.is(
  (
    select im.stock_uom
    from public.inventory_movements im
    where im.id = (select opening_id from sellertray_inventory_fixture)
  ),
  'Bottle',
  'movement always snapshots the product Stock UOM'
);

select extensions.is(
  (
    select im.quantity_delta
    from public.inventory_movements im
    where im.id = (select opening_id from sellertray_inventory_fixture)
  ),
  24::numeric,
  'two Packs at conversion 12 normalize to twenty-four Bottles'
);

select extensions.is(
  (
    select s.quantity_on_hand
    from public.get_sellertray_branch_stock(
      (select tenant_id from sellertray_inventory_fixture),
      (select branch_id from sellertray_inventory_fixture)
    ) s
    where s.catalog_item_id = (select product_id from sellertray_inventory_fixture)
  ),
  24::numeric,
  'branch stock is derived from ledger movements in Stock UOM'
);

update sellertray_inventory_fixture
set opening_retry_id = public.record_sellertray_inventory_movement(
  tenant_id,
  branch_id,
  location_id,
  product_id,
  'opening',
  24,
  'Pack',
  2,
  12,
  'opening_stock',
  'OPEN-001',
  'opening:OPEN-001',
  now(),
  null,
  'Opening count retry',
  '{}'::jsonb,
  null
);

select extensions.is(
  (select opening_retry_id from sellertray_inventory_fixture),
  (select opening_id from sellertray_inventory_fixture),
  'retrying the same idempotent movement returns the original movement id'
);

select extensions.is(
  (
    select count(*)::integer
    from public.inventory_movements im
    where im.tenant_id = (select tenant_id from sellertray_inventory_fixture)
      and im.idempotency_key = 'opening:OPEN-001'
  ),
  1,
  'idempotent retry does not duplicate inventory effect'
);

do $$
begin
  begin
    perform public.record_sellertray_inventory_movement(
      (select tenant_id from sellertray_inventory_fixture),
      (select branch_id from sellertray_inventory_fixture),
      (select location_id from sellertray_inventory_fixture),
      (select product_id from sellertray_inventory_fixture),
      'opening',
      12,
      'Pack',
      1,
      12,
      'opening_stock',
      'OPEN-001',
      'opening:OPEN-001',
      now(),
      null,
      null,
      '{}'::jsonb,
      null
    );
  exception when others then
    update sellertray_inventory_fixture set different_idempotency_facts_rejected = true;
  end;
end
$$;

select extensions.ok(
  (select different_idempotency_facts_rejected from sellertray_inventory_fixture),
  'reusing an idempotency key for different stock facts is rejected'
);

update sellertray_inventory_fixture
set sale_id = public.record_sellertray_inventory_movement(
  tenant_id,
  branch_id,
  location_id,
  product_id,
  'sale',
  -2,
  'Bottle',
  2,
  1,
  'order',
  'ORDER-001',
  'sale:ORDER-001:LINE-001',
  now(),
  null,
  null,
  '{}'::jsonb,
  null
);

select extensions.ok(
  (select sale_id is not null from sellertray_inventory_fixture),
  'sale movement reduces stock using the shared ledger'
);

select extensions.is(
  (
    select s.quantity_on_hand
    from public.get_sellertray_branch_stock(
      (select tenant_id from sellertray_inventory_fixture),
      (select branch_id from sellertray_inventory_fixture)
    ) s
    where s.catalog_item_id = (select product_id from sellertray_inventory_fixture)
  ),
  22::numeric,
  'sale deduction changes branch on-hand quantity exactly once'
);

do $$
begin
  begin
    perform public.record_sellertray_inventory_movement(
      (select tenant_id from sellertray_inventory_fixture),
      (select branch_id from sellertray_inventory_fixture),
      (select location_id from sellertray_inventory_fixture),
      (select product_id from sellertray_inventory_fixture),
      'purchase_receipt',
      20,
      'Pack',
      2,
      10,
      'purchase_receipt',
      'PR-INVALID',
      'receipt:PR-INVALID',
      now(),
      null,
      null,
      '{}'::jsonb,
      null
    );
  exception when others then
    update sellertray_inventory_fixture set invalid_conversion_rejected = true;
  end;
end
$$;

select extensions.ok(
  (select invalid_conversion_rejected from sellertray_inventory_fixture),
  'inventory posting rejects a conversion that differs from configured UOM'
);

do $$
begin
  begin
    perform public.record_sellertray_inventory_movement(
      (select tenant_id from sellertray_inventory_fixture),
      (select branch_id from sellertray_inventory_fixture),
      gen_random_uuid(),
      (select product_id from sellertray_inventory_fixture),
      'purchase_receipt',
      12,
      'Pack',
      1,
      12,
      'purchase_receipt',
      'PR-BAD-LOCATION',
      'receipt:PR-BAD-LOCATION',
      now(),
      null,
      null,
      '{}'::jsonb,
      null
    );
  exception when others then
    update sellertray_inventory_fixture set invalid_location_rejected = true;
  end;
end
$$;

select extensions.ok(
  (select invalid_location_rejected from sellertray_inventory_fixture),
  'inventory posting rejects a stock location outside the selected branch'
);

do $$
begin
  begin
    update public.inventory_movements
    set reason = 'mutated'
    where id = (select opening_id from sellertray_inventory_fixture);
  exception when others then
    update sellertray_inventory_fixture set update_rejected = true;
  end;
end
$$;

select extensions.ok(
  (select update_rejected from sellertray_inventory_fixture),
  'posted inventory movements cannot be updated'
);

do $$
begin
  begin
    delete from public.inventory_movements
    where id = (select opening_id from sellertray_inventory_fixture);
  exception when others then
    update sellertray_inventory_fixture set delete_rejected = true;
  end;
end
$$;

select extensions.ok(
  (select delete_rejected from sellertray_inventory_fixture),
  'posted inventory movements cannot be deleted'
);

update sellertray_inventory_fixture
set reversal_id = public.record_sellertray_inventory_movement(
  tenant_id,
  branch_id,
  location_id,
  product_id,
  'reversal',
  2,
  'Bottle',
  2,
  1,
  'order_reversal',
  'ORDER-001',
  'reversal:sale:ORDER-001:LINE-001',
  now(),
  null,
  'Reverse test sale',
  '{}'::jsonb,
  sale_id
);

select extensions.ok(
  (select reversal_id is not null from sellertray_inventory_fixture),
  'an exact correcting reversal can offset a posted movement'
);

select extensions.is(
  (
    select s.quantity_on_hand
    from public.get_sellertray_branch_stock(
      (select tenant_id from sellertray_inventory_fixture),
      (select branch_id from sellertray_inventory_fixture)
    ) s
    where s.catalog_item_id = (select product_id from sellertray_inventory_fixture)
  ),
  24::numeric,
  'reversal restores the original branch stock quantity'
);

do $$
begin
  begin
    perform public.record_sellertray_inventory_movement(
      (select tenant_id from sellertray_inventory_fixture),
      (select branch_id from sellertray_inventory_fixture),
      (select location_id from sellertray_inventory_fixture),
      (select product_id from sellertray_inventory_fixture),
      'reversal',
      2,
      'Bottle',
      2,
      1,
      'order_reversal',
      'ORDER-001-SECOND',
      'reversal:sale:ORDER-001:LINE-001:second',
      now(),
      null,
      'Second reversal should fail',
      '{}'::jsonb,
      (select sale_id from sellertray_inventory_fixture)
    );
  exception when others then
    update sellertray_inventory_fixture set second_reversal_rejected = true;
  end;
end
$$;

select extensions.ok(
  (select second_reversal_rejected from sellertray_inventory_fixture),
  'a posted movement cannot be reversed twice'
);

select extensions.is(
  (
    select count(*)::integer
    from public.get_sellertray_stock_movements(
      (select tenant_id from sellertray_inventory_fixture),
      (select branch_id from sellertray_inventory_fixture),
      (select product_id from sellertray_inventory_fixture),
      100
    )
  ),
  3,
  'movement history contains opening, sale and reversal without retry duplicates'
);

select extensions.ok(
  position('branch_user_access' in pg_get_functiondef(
    'public.get_sellertray_branch_stock(uuid,uuid)'::regprocedure
  )) > 0,
  'branch stock read explicitly enforces branch access instead of returning hidden zeroes'
);

select * from extensions.finish();
rollback;
