begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(10);

create temp table sellertray_pos_customer_fixture (
  tenant_id uuid not null,
  other_tenant_id uuid not null,
  owner_user_id uuid not null,
  branch_id uuid,
  location_id uuid,
  product_id uuid not null,
  uom_id uuid,
  whatsapp_customer_id uuid not null,
  other_customer_id uuid not null,
  selected_order_id uuid,
  idempotent_order_id uuid,
  exact_resolved_id uuid,
  phone_resolved_id uuid,
  new_customer_id uuid,
  walk_in_one uuid,
  walk_in_two uuid,
  ambiguous_rejected boolean not null default false,
  cross_tenant_rejected boolean not null default false,
  changed_customer_rejected boolean not null default false
) on commit drop;

insert into sellertray_pos_customer_fixture(
  tenant_id,other_tenant_id,owner_user_id,product_id,whatsapp_customer_id,other_customer_id
) values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_user_id,'pos-customer-owner-'||substr(owner_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_pos_customer_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'SellerTray Customer Test','sellertray-customer-'||substr(tenant_id::text,1,8),'PCT','active'
from sellertray_pos_customer_fixture
union all
select other_tenant_id,'SellerTray Other Customer Test','sellertray-other-customer-'||substr(other_tenant_id::text,1,8),'PCO','active'
from sellertray_pos_customer_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id in (
  select tenant_id from sellertray_pos_customer_fixture
  union all
  select other_tenant_id from sellertray_pos_customer_fixture
);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner' from sellertray_pos_customer_fixture;

update sellertray_pos_customer_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

update sellertray_pos_customer_fixture f
set location_id=sl.id
from public.stock_locations sl
where sl.tenant_id=f.tenant_id and sl.branch_id=f.branch_id and sl.is_default=true;

insert into public.catalog_items(id,tenant_id,name,sku,price_ngn,is_active,stock_uom,allow_fractional_stock)
select product_id,tenant_id,'Customer Identity Product','CUS-ID-PRODUCT',250,true,'Each',false
from sellertray_pos_customer_fixture;

update sellertray_pos_customer_fixture f
set uom_id=u.id
from public.catalog_item_uoms u
where u.tenant_id=f.tenant_id and u.catalog_item_id=f.product_id and lower(u.uom_name)='each';

select public.record_sellertray_inventory_movement(
  tenant_id,branch_id,location_id,product_id,
  'opening',20,'Each',20,1,
  'opening_stock','CUS-ID-OPENING','customer-identity:opening',
  now(),owner_user_id,'Opening stock for customer identity test','{}'::jsonb,null
)
from sellertray_pos_customer_fixture;

insert into public.customers(id,tenant_id,wa_id,display_name,phone,updated_at)
select whatsapp_customer_id,tenant_id,'2348012345678','WhatsApp Customer','+2348012345678',now()
from sellertray_pos_customer_fixture;

insert into public.customers(id,tenant_id,wa_id,display_name,phone,updated_at)
select other_customer_id,other_tenant_id,'2348099999999','Other Tenant Customer','+2348099999999',now()
from sellertray_pos_customer_fixture;

update sellertray_pos_customer_fixture
set exact_resolved_id=public.resolve_sellertray_pos_customer(
  tenant_id,whatsapp_customer_id,null,null
);

select extensions.is(
  (select exact_resolved_id from sellertray_pos_customer_fixture),
  (select whatsapp_customer_id from sellertray_pos_customer_fixture),
  'Exact selected customer ID resolves to the shared WhatsApp customer'
);

update sellertray_pos_customer_fixture
set phone_resolved_id=public.resolve_sellertray_pos_customer(
  tenant_id,null,'WhatsApp Customer','+2348012345678'
);

select extensions.is(
  (select phone_resolved_id from sellertray_pos_customer_fixture),
  (select whatsapp_customer_id from sellertray_pos_customer_fixture),
  'Unique phone entry reuses the existing shared customer'
);

select extensions.is(
  (
    select count(*)::integer
    from public.customers c
    join sellertray_pos_customer_fixture f on f.tenant_id=c.tenant_id
    where c.phone='+2348012345678'
  ),
  1,
  'Customer reuse creates no duplicate manual identity'
);

update sellertray_pos_customer_fixture
set new_customer_id=public.resolve_sellertray_pos_customer(
  tenant_id,null,'Counter Customer','+2348022222222'
);

select extensions.is(
  (
    select c.wa_id
    from public.customers c
    join sellertray_pos_customer_fixture f on f.new_customer_id=c.id
  ),
  'manual:+2348022222222',
  'New customer phone creates one governed manual customer identity'
);

update sellertray_pos_customer_fixture
set walk_in_one=public.resolve_sellertray_pos_customer(tenant_id,null,null,null),
    walk_in_two=public.resolve_sellertray_pos_customer(tenant_id,null,null,null);

select extensions.is(
  (select walk_in_one from sellertray_pos_customer_fixture),
  (select walk_in_two from sellertray_pos_customer_fixture),
  'Walk-in customer identity is stable across POS sales'
);

insert into public.customers(tenant_id,wa_id,display_name,phone,updated_at)
select tenant_id,'duplicate-phone-fixture','Duplicate Phone Customer','+2348012345678',now()
from sellertray_pos_customer_fixture;

do $$
begin
  begin
    perform public.resolve_sellertray_pos_customer(
      (select tenant_id from sellertray_pos_customer_fixture),
      null,'Ambiguous Customer','+2348012345678'
    );
  exception when sqlstate '23514' then
    update sellertray_pos_customer_fixture set ambiguous_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select ambiguous_rejected from sellertray_pos_customer_fixture),
  'Ambiguous duplicate phone fails closed instead of guessing a customer'
);

do $$
begin
  begin
    perform public.resolve_sellertray_pos_customer(
      (select tenant_id from sellertray_pos_customer_fixture),
      (select other_customer_id from sellertray_pos_customer_fixture),
      null,null
    );
  exception when sqlstate '23514' then
    update sellertray_pos_customer_fixture set cross_tenant_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select cross_tenant_rejected from sellertray_pos_customer_fixture),
  'Selected customer ID cannot cross business boundaries'
);

update sellertray_pos_customer_fixture
set selected_order_id=public.create_sellertray_pos_order_atomic(
  tenant_id,branch_id,whatsapp_customer_id,null,null,null,
  jsonb_build_array(jsonb_build_object('catalog_item_id',product_id,'uom_id',uom_id,'quantity',1))
);

select extensions.is(
  (
    select o.customer_id
    from public.orders o
    join sellertray_pos_customer_fixture f on f.selected_order_id=o.id
  ),
  (select whatsapp_customer_id from sellertray_pos_customer_fixture),
  'POS draft binds the exact selected shared customer'
);

update sellertray_pos_customer_fixture
set idempotent_order_id=public.create_sellertray_pos_order_idempotent(
  tenant_id,branch_id,new_customer_id,null,null,null,
  jsonb_build_array(jsonb_build_object(
    'catalog_item_id',product_id,
    'uom_id',uom_id,
    'quantity',1,
    'expected_selling_price',250,
    'expected_conversion_factor',1
  )),
  '11111111-2222-4333-8444-555555555555'::uuid
);

select extensions.is(
  public.create_sellertray_pos_order_idempotent(
    (select tenant_id from sellertray_pos_customer_fixture),
    (select branch_id from sellertray_pos_customer_fixture),
    (select new_customer_id from sellertray_pos_customer_fixture),
    null,null,null,
    jsonb_build_array(jsonb_build_object(
      'catalog_item_id',(select product_id from sellertray_pos_customer_fixture),
      'uom_id',(select uom_id from sellertray_pos_customer_fixture),
      'quantity',1,
      'expected_selling_price',250,
      'expected_conversion_factor',1
    )),
    '11111111-2222-4333-8444-555555555555'::uuid
  ),
  (select idempotent_order_id from sellertray_pos_customer_fixture),
  'Idempotent retry with the same selected customer returns the same POS draft'
);

do $$
begin
  begin
    perform public.create_sellertray_pos_order_idempotent(
      (select tenant_id from sellertray_pos_customer_fixture),
      (select branch_id from sellertray_pos_customer_fixture),
      (select whatsapp_customer_id from sellertray_pos_customer_fixture),
      null,null,null,
      jsonb_build_array(jsonb_build_object(
        'catalog_item_id',(select product_id from sellertray_pos_customer_fixture),
        'uom_id',(select uom_id from sellertray_pos_customer_fixture),
        'quantity',1,
        'expected_selling_price',250,
        'expected_conversion_factor',1
      )),
      '11111111-2222-4333-8444-555555555555'::uuid
    );
  exception when sqlstate '23505' then
    update sellertray_pos_customer_fixture set changed_customer_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select changed_customer_rejected from sellertray_pos_customer_fixture),
  'Reusing a sale reference with a different customer is rejected'
);

select * from extensions.finish();
rollback;
