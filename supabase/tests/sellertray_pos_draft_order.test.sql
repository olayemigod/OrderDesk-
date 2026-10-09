begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(10);

create temp table sellertray_pos_fixture (
  tenant_id uuid not null,
  product_id uuid not null,
  branch_id uuid,
  pack_uom_id uuid,
  order_id uuid,
  bad_branch_rejected boolean not null default false,
  bad_uom_rejected boolean not null default false
) on commit drop;

insert into sellertray_pos_fixture(tenant_id, product_id)
values (gen_random_uuid(), gen_random_uuid());

insert into public.tenants(id, name, slug, merchant_code, subscription_status)
select
  tenant_id,
  'SellerTray POS Draft Test',
  'sellertray-pos-draft-' || substr(tenant_id::text, 1, 8),
  'PSD',
  'active'
from sellertray_pos_fixture;

update public.tenant_subscriptions
set status = 'active', trial_ends_at = null, grace_ends_at = null
where tenant_id = (select tenant_id from sellertray_pos_fixture);

update sellertray_pos_fixture f
set branch_id = b.id
from public.branches b
where b.tenant_id = f.tenant_id
  and b.is_default = true;

insert into public.catalog_items(id, tenant_id, name, sku, price_ngn, is_active, stock_uom, allow_fractional_stock)
select product_id, tenant_id, 'POS Test Drink', 'POS-DRINK', 100, true, 'Bottle', false
from sellertray_pos_fixture;

insert into public.catalog_item_uoms(
  tenant_id,
  catalog_item_id,
  uom_name,
  conversion_factor,
  selling_price,
  allow_fractional,
  is_default_selling
)
select tenant_id, product_id, 'Pack', 12, 1050, false, true
from sellertray_pos_fixture
returning id into temporary table sellertray_pos_pack_uom;

update sellertray_pos_fixture f
set pack_uom_id = u.id
from sellertray_pos_pack_uom u;

update sellertray_pos_fixture
set order_id = public.create_sellertray_pos_order_atomic(
  tenant_id,
  branch_id,
  null,
  null,
  'Counter sale',
  jsonb_build_array(jsonb_build_object(
    'catalog_item_id', product_id,
    'uom_id', pack_uom_id,
    'quantity', 2
  ))
);

select extensions.ok(
  (select order_id is not null from sellertray_pos_fixture),
  'POS command returns a draft order id'
);

select extensions.is(
  (select o.source from public.orders o where o.id = (select order_id from sellertray_pos_fixture)),
  'pos',
  'POS command records POS as source channel'
);

select extensions.is(
  (select o.status from public.orders o where o.id = (select order_id from sellertray_pos_fixture)),
  'draft',
  'POS command does not mark an unfinished checkout as completed'
);

select extensions.is(
  (select o.payment_status from public.orders o where o.id = (select order_id from sellertray_pos_fixture)),
  'unpaid',
  'POS draft remains unpaid'
);

select extensions.is(
  (select o.branch_id from public.orders o where o.id = (select order_id from sellertray_pos_fixture)),
  (select branch_id from sellertray_pos_fixture),
  'POS draft preserves the selected branch'
);

select extensions.is(
  (
    select c.display_name
    from public.orders o
    join public.customers c on c.id = o.customer_id and c.tenant_id = o.tenant_id
    where o.id = (select order_id from sellertray_pos_fixture)
  ),
  'Walk-in Customer',
  'customer is optional and resolves to the governed walk-in customer'
);

select extensions.is(
  (
    select oi.selected_uom
    from public.order_items oi
    where oi.order_id = (select order_id from sellertray_pos_fixture)
  ),
  'Pack',
  'POS line snapshots the selected selling UOM'
);

select extensions.is(
  (
    select oi.stock_quantity
    from public.order_items oi
    where oi.order_id = (select order_id from sellertray_pos_fixture)
  ),
  24::numeric,
  'POS line normalizes quantity into Stock UOM'
);

do $$
begin
  begin
    perform public.create_sellertray_pos_order_atomic(
      (select tenant_id from sellertray_pos_fixture),
      gen_random_uuid(),
      null,
      null,
      null,
      jsonb_build_array(jsonb_build_object(
        'catalog_item_id', (select product_id from sellertray_pos_fixture),
        'uom_id', (select pack_uom_id from sellertray_pos_fixture),
        'quantity', 1
      ))
    );
  exception when others then
    update sellertray_pos_fixture set bad_branch_rejected = true;
  end;
end
$$;

select extensions.ok(
  (select bad_branch_rejected from sellertray_pos_fixture),
  'POS command rejects a branch outside the business'
);

do $$
begin
  begin
    perform public.create_sellertray_pos_order_atomic(
      (select tenant_id from sellertray_pos_fixture),
      (select branch_id from sellertray_pos_fixture),
      null,
      null,
      null,
      jsonb_build_array(jsonb_build_object(
        'catalog_item_id', (select product_id from sellertray_pos_fixture),
        'uom_id', gen_random_uuid(),
        'quantity', 1
      ))
    );
  exception when others then
    update sellertray_pos_fixture set bad_uom_rejected = true;
  end;
end
$$;

select extensions.ok(
  (select bad_uom_rejected from sellertray_pos_fixture),
  'POS command rejects an unconfigured UOM'
);

select * from extensions.finish();
rollback;
