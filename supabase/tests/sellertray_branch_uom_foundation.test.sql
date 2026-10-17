begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(14);

create temp table sellertray_branch_uom_fixture (
  tenant_id uuid not null,
  product_id uuid not null,
  order_id uuid,
  invalid_base_factor_rejected boolean not null default false,
  invalid_snapshot_factor_rejected boolean not null default false,
  stock_uom_change_rejected boolean not null default false
) on commit drop;

insert into sellertray_branch_uom_fixture(tenant_id, product_id)
values (gen_random_uuid(), gen_random_uuid());

insert into public.tenants(id, name, slug, merchant_code, subscription_status)
select
  tenant_id,
  'SellerTray Branch UOM Test',
  'sellertray-branch-uom-' || substr(tenant_id::text, 1, 8),
  'BUO',
  'active'
from sellertray_branch_uom_fixture;

update public.tenant_subscriptions
set status = 'active', trial_ends_at = null, grace_ends_at = null
where tenant_id = (select tenant_id from sellertray_branch_uom_fixture);

select extensions.ok(
  exists (
    select 1
    from public.branches b
    where b.tenant_id = (select tenant_id from sellertray_branch_uom_fixture)
      and b.is_default = true
      and b.is_active = true
  ),
  'new business receives an active default branch'
);

select extensions.is(
  (
    select count(*)::integer
    from public.branches b
    where b.tenant_id = (select tenant_id from sellertray_branch_uom_fixture)
      and b.is_default = true
  ),
  1,
  'business has exactly one default branch'
);

insert into public.catalog_items(id, tenant_id, name, sku, price_ngn, is_active)
select product_id, tenant_id, 'Test Beverage', 'BEV-001', 100, true
from sellertray_branch_uom_fixture;

select extensions.ok(
  exists (
    select 1
    from public.catalog_item_uoms u
    where u.tenant_id = (select tenant_id from sellertray_branch_uom_fixture)
      and u.catalog_item_id = (select product_id from sellertray_branch_uom_fixture)
      and lower(u.uom_name) = 'each'
  ),
  'new product receives its Stock UOM row'
);

select extensions.is(
  (
    select u.conversion_factor
    from public.catalog_item_uoms u
    where u.catalog_item_id = (select product_id from sellertray_branch_uom_fixture)
      and lower(u.uom_name) = 'each'
  ),
  1::numeric,
  'Stock UOM conversion factor is exactly 1'
);

insert into public.catalog_item_uoms(
  tenant_id, catalog_item_id, uom_name, conversion_factor,
  selling_price, allow_fractional, is_default_selling
)
select tenant_id, product_id, 'Pack', 12, 1050, false, false
from sellertray_branch_uom_fixture;

select extensions.is(
  (
    select u.selling_price
    from public.catalog_item_uoms u
    where u.catalog_item_id = (select product_id from sellertray_branch_uom_fixture)
      and lower(u.uom_name) = 'pack'
  ),
  1050::numeric,
  'alternate UOM keeps an independent selling price'
);

do $$
begin
  begin
    insert into public.catalog_item_uoms(
      tenant_id, catalog_item_id, uom_name, conversion_factor, selling_price
    )
    select tenant_id, product_id, 'EACH', 2, 200
    from sellertray_branch_uom_fixture;
  exception when others then
    update sellertray_branch_uom_fixture set invalid_base_factor_rejected = true;
  end;
end
$$;

select extensions.ok(
  (select invalid_base_factor_rejected from sellertray_branch_uom_fixture),
  'Stock UOM cannot be configured with a conversion factor other than 1'
);

update sellertray_branch_uom_fixture
set order_id = public.create_sellertray_manual_order_atomic(
  tenant_id,
  'Counter Customer',
  '08031234567',
  null,
  jsonb_build_array(jsonb_build_object(
    'catalog_item_id', product_id,
    'quantity', 2
  ))
);

select extensions.ok(
  (select order_id is not null from sellertray_branch_uom_fixture),
  'legacy manual order creation remains compatible with Branch and UOM foundation'
);

select extensions.ok(
  exists (
    select 1
    from public.orders o
    join public.branches b
      on b.tenant_id = o.tenant_id
     and b.id = o.branch_id
    where o.id = (select order_id from sellertray_branch_uom_fixture)
      and b.is_default = true
  ),
  'legacy order is attributed to the default branch'
);

select extensions.is(
  (
    select oi.selected_uom
    from public.order_items oi
    where oi.order_id = (select order_id from sellertray_branch_uom_fixture)
  ),
  'Each',
  'legacy order item snapshots the product Stock UOM'
);

select extensions.is(
  (
    select oi.stock_quantity
    from public.order_items oi
    where oi.order_id = (select order_id from sellertray_branch_uom_fixture)
  ),
  2::numeric,
  'legacy base-UOM quantity preserves the Stock UOM quantity'
);

update public.order_items
set selected_uom = 'Pack',
    conversion_factor = 12,
    quantity = 2
where order_id = (select order_id from sellertray_branch_uom_fixture);

select extensions.is(
  (
    select oi.stock_quantity
    from public.order_items oi
    where oi.order_id = (select order_id from sellertray_branch_uom_fixture)
  ),
  24::numeric,
  'alternate UOM snapshot normalizes transaction quantity to Stock UOM'
);

do $$
begin
  begin
    update public.order_items
    set conversion_factor = 11
    where order_id = (select order_id from sellertray_branch_uom_fixture);
  exception when others then
    update sellertray_branch_uom_fixture set invalid_snapshot_factor_rejected = true;
  end;
end
$$;

select extensions.ok(
  (select invalid_snapshot_factor_rejected from sellertray_branch_uom_fixture),
  'order item rejects a conversion factor that does not match configured UOM'
);

update public.orders
set source = 'pos'
where id = (select order_id from sellertray_branch_uom_fixture);

select extensions.is(
  (
    select o.source
    from public.orders o
    where o.id = (select order_id from sellertray_branch_uom_fixture)
  ),
  'pos',
  'shared order model accepts POS as a source channel'
);

do $$
begin
  begin
    update public.catalog_items
    set stock_uom = 'Bottle'
    where id = (select product_id from sellertray_branch_uom_fixture);
  exception when others then
    update sellertray_branch_uom_fixture set stock_uom_change_rejected = true;
  end;
end
$$;

select extensions.ok(
  (select stock_uom_change_rejected from sellertray_branch_uom_fixture),
  'Stock UOM cannot be reinterpreted after transactions exist'
);

select * from extensions.finish();
rollback;
