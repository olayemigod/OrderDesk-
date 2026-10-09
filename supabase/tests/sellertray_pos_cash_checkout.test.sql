begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(17);

create temp table sellertray_pos_cash_fixture (
  tenant_id uuid not null,
  actor_user_id uuid not null,
  product_id uuid not null,
  branch_id uuid,
  location_id uuid,
  pack_uom_id uuid,
  order_id uuid,
  second_order_id uuid,
  completion jsonb,
  replay jsonb,
  insufficient_stock_rejected boolean not null default false
) on commit drop;

insert into sellertray_pos_cash_fixture(tenant_id, actor_user_id, product_id)
values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select
  actor_user_id,
  'pos-owner-' || substr(actor_user_id::text,1,8) || '@example.com',
  'authenticated',
  'authenticated',
  now(),
  now()
from sellertray_pos_cash_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select
  tenant_id,
  'SellerTray POS Cash Test',
  'sellertray-pos-cash-' || substr(tenant_id::text,1,8),
  'PCT',
  'active'
from sellertray_pos_cash_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from sellertray_pos_cash_fixture);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,actor_user_id,'owner'
from sellertray_pos_cash_fixture;

update sellertray_pos_cash_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id
  and b.is_default=true;

update sellertray_pos_cash_fixture f
set location_id=sl.id
from public.stock_locations sl
where sl.tenant_id=f.tenant_id
  and sl.branch_id=f.branch_id
  and sl.is_default=true;

insert into public.catalog_items(
  id,tenant_id,name,sku,price_ngn,is_active,stock_uom,allow_fractional_stock
)
select product_id,tenant_id,'POS Cash Drink','POS-CASH-DRINK',100,true,'Bottle',false
from sellertray_pos_cash_fixture;

with inserted_uom as (
  insert into public.catalog_item_uoms(
    tenant_id,catalog_item_id,uom_name,conversion_factor,
    selling_price,allow_fractional,is_default_selling
  )
  select tenant_id,product_id,'Pack',12,1050,false,false
  from sellertray_pos_cash_fixture
  returning id
)
update sellertray_pos_cash_fixture
set pack_uom_id=(select id from inserted_uom);

select public.record_sellertray_inventory_movement(
  tenant_id,
  branch_id,
  location_id,
  product_id,
  'opening',
  36,
  'Bottle',
  36,
  1,
  'opening_stock',
  'POS-CASH-OPENING',
  'opening:POS-CASH-OPENING',
  now(),
  actor_user_id,
  'Opening stock for POS cash checkout test',
  '{}'::jsonb,
  null
)
from sellertray_pos_cash_fixture;

update sellertray_pos_cash_fixture
set order_id=public.create_sellertray_pos_order_atomic(
  tenant_id,
  branch_id,
  null,
  null,
  'Counter cash sale',
  jsonb_build_array(jsonb_build_object(
    'catalog_item_id',product_id,
    'uom_id',pack_uom_id,
    'quantity',2
  ))
);

set local request.jwt.claim.role = 'service_role';

update sellertray_pos_cash_fixture
set completion=public.complete_sellertray_pos_cash_sale(
  tenant_id,
  order_id,
  actor_user_id
);

select extensions.is(
  (select completion->>'status' from sellertray_pos_cash_fixture),
  'completed',
  'cash checkout completes the POS order'
);

select extensions.is(
  (select o.payment_status from public.orders o where o.id=(select order_id from sellertray_pos_cash_fixture)),
  'paid',
  'cash checkout projects the order to paid'
);

select extensions.is(
  (select o.fulfillment_status from public.orders o where o.id=(select order_id from sellertray_pos_cash_fixture)),
  'collected',
  'counter checkout records customer pickup as collected'
);

select extensions.is(
  (
    select p.method_type
    from public.order_payments p
    where p.order_id=(select order_id from sellertray_pos_cash_fixture)
      and p.status='confirmed'
  ),
  'cash',
  'counter value is recorded through the shared payment core as cash'
);

select extensions.is(
  (
    select p.provider
    from public.order_payments p
    where p.order_id=(select order_id from sellertray_pos_cash_fixture)
      and p.status='confirmed'
  ),
  'pos_cash',
  'cash payment records POS provenance'
);

select extensions.is(
  (
    select p.amount
    from public.order_payments p
    where p.order_id=(select order_id from sellertray_pos_cash_fixture)
      and p.status='confirmed'
  ),
  2100::numeric,
  'cash payment exactly matches the UOM-priced invoice'
);

select extensions.ok(
  exists (
    select 1
    from public.order_financial_documents d
    where d.order_id=(select order_id from sellertray_pos_cash_fixture)
      and d.document_type='receipt'
      and d.status='issued'
  ),
  'confirmed POS cash value issues the shared financial receipt'
);

select extensions.is(
  (
    select s.quantity_on_hand
    from public.get_sellertray_branch_stock(
      (select tenant_id from sellertray_pos_cash_fixture),
      (select branch_id from sellertray_pos_cash_fixture)
    ) s
    where s.catalog_item_id=(select product_id from sellertray_pos_cash_fixture)
  ),
  12::numeric,
  'checkout deducts the normalized Stock UOM quantity exactly once'
);

select extensions.is(
  (
    select count(*)::integer
    from public.inventory_movements im
    where im.tenant_id=(select tenant_id from sellertray_pos_cash_fixture)
      and im.reference_type='order'
      and im.reference_id=(select order_id::text from sellertray_pos_cash_fixture)
      and im.movement_type='sale'
  ),
  1,
  'checkout creates one sale movement for the one order line'
);

update sellertray_pos_cash_fixture
set replay=public.complete_sellertray_pos_cash_sale(
  tenant_id,
  order_id,
  actor_user_id
);

select extensions.is(
  (select replay->>'paymentId' from sellertray_pos_cash_fixture),
  (select completion->>'paymentId' from sellertray_pos_cash_fixture),
  'retry returns the original confirmed cash payment'
);

select extensions.is(
  (
    select count(*)::integer
    from public.order_payments p
    where p.order_id=(select order_id from sellertray_pos_cash_fixture)
      and p.method_type='cash'
  ),
  1,
  'retry does not duplicate cash payment effects'
);

select extensions.is(
  (
    select count(*)::integer
    from public.inventory_movements im
    where im.tenant_id=(select tenant_id from sellertray_pos_cash_fixture)
      and im.reference_type='order'
      and im.reference_id=(select order_id::text from sellertray_pos_cash_fixture)
      and im.movement_type='sale'
  ),
  1,
  'retry does not duplicate stock effects'
);

update sellertray_pos_cash_fixture
set second_order_id=public.create_sellertray_pos_order_atomic(
  tenant_id,
  branch_id,
  null,
  null,
  'Insufficient stock sale',
  jsonb_build_array(jsonb_build_object(
    'catalog_item_id',product_id,
    'uom_id',pack_uom_id,
    'quantity',2
  ))
);

do $$
begin
  begin
    perform public.complete_sellertray_pos_cash_sale(
      (select tenant_id from sellertray_pos_cash_fixture),
      (select second_order_id from sellertray_pos_cash_fixture),
      (select actor_user_id from sellertray_pos_cash_fixture)
    );
  exception when others then
    update sellertray_pos_cash_fixture set insufficient_stock_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select insufficient_stock_rejected from sellertray_pos_cash_fixture),
  'checkout rejects a sale that would take branch stock below zero'
);

select extensions.is(
  (select o.status from public.orders o where o.id=(select second_order_id from sellertray_pos_cash_fixture)),
  'draft',
  'failed checkout rolls the order back to draft'
);

select extensions.is(
  (
    select count(*)::integer
    from public.order_payments p
    where p.order_id=(select second_order_id from sellertray_pos_cash_fixture)
  ),
  0,
  'failed checkout leaves no payment effect'
);

select extensions.is(
  (
    select count(*)::integer
    from public.inventory_movements im
    where im.tenant_id=(select tenant_id from sellertray_pos_cash_fixture)
      and im.reference_type='order'
      and im.reference_id=(select second_order_id::text from sellertray_pos_cash_fixture)
  ),
  0,
  'failed checkout leaves no stock effect'
);

select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.complete_sellertray_pos_cash_sale(uuid,uuid,uuid)',
    'EXECUTE'
  ) and has_function_privilege(
    'service_role',
    'public.complete_sellertray_pos_cash_sale(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'POS completion remains a server-only governed command'
);

select * from extensions.finish();
rollback;
