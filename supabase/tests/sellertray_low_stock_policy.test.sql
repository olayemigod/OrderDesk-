begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(17);

create temp table sellertray_low_stock_fixture (
  tenant_id uuid not null,
  owner_user_id uuid not null,
  manager_user_id uuid not null,
  staff_user_id uuid not null,
  product_id uuid not null,
  zero_product_id uuid not null,
  branch_id uuid,
  branch_two_id uuid,
  location_id uuid,
  staff_policy_rejected boolean not null default false,
  fractional_rejected boolean not null default false,
  target_rejected boolean not null default false,
  branch_read_rejected boolean not null default false,
  event_update_rejected boolean not null default false
) on commit drop;

insert into sellertray_low_stock_fixture(
  tenant_id,owner_user_id,manager_user_id,staff_user_id,product_id,zero_product_id
)
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_user_id,'low-owner-'||substr(owner_user_id::text,1,8)||'@example.com',
  'authenticated','authenticated',now(),now()
from sellertray_low_stock_fixture
union all
select manager_user_id,'low-manager-'||substr(manager_user_id::text,1,8)||'@example.com',
  'authenticated','authenticated',now(),now()
from sellertray_low_stock_fixture
union all
select staff_user_id,'low-staff-'||substr(staff_user_id::text,1,8)||'@example.com',
  'authenticated','authenticated',now(),now()
from sellertray_low_stock_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'SellerTray Low Stock Test',
  'sellertray-low-stock-'||substr(tenant_id::text,1,8),'LST','active'
from sellertray_low_stock_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from sellertray_low_stock_fixture);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner' from sellertray_low_stock_fixture
union all
select tenant_id,manager_user_id,'manager' from sellertray_low_stock_fixture
union all
select tenant_id,staff_user_id,'staff' from sellertray_low_stock_fixture;

update sellertray_low_stock_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

insert into public.branches(tenant_id,code,name,is_default,is_active)
select tenant_id,'LOW2','Low Stock Branch Two',false,true
from sellertray_low_stock_fixture;

update sellertray_low_stock_fixture f
set branch_two_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.code='LOW2';

update sellertray_low_stock_fixture f
set location_id=sl.id
from public.stock_locations sl
where sl.tenant_id=f.tenant_id and sl.branch_id=f.branch_id and sl.is_default=true;

insert into public.branch_user_access(tenant_id,branch_id,user_id,can_operate)
select tenant_id,branch_id,staff_user_id,true
from sellertray_low_stock_fixture;

insert into public.catalog_items(
  id,tenant_id,name,sku,price_ngn,is_active,stock_uom,allow_fractional_stock
)
select product_id,tenant_id,'Low Stock Drink','LOW-DRINK',100,true,'Bottle',false
from sellertray_low_stock_fixture
union all
select zero_product_id,tenant_id,'Never Stocked Item','LOW-ZERO',50,true,'Each',false
from sellertray_low_stock_fixture;

select public.record_sellertray_inventory_movement(
  tenant_id,branch_id,location_id,product_id,
  'opening',10,'Bottle',10,1,
  'opening_stock','LOW-OPEN','opening:LOW-OPEN',
  now(),owner_user_id,'Opening low-stock test quantity','{}'::jsonb,null
)
from sellertray_low_stock_fixture;

select extensions.ok(
  not has_function_privilege(
    'authenticated','public.set_sellertray_low_stock_policy(uuid,uuid,uuid,numeric,numeric,uuid)','EXECUTE'
  )
  and has_function_privilege(
    'authenticated','public.get_sellertray_low_stock(uuid,uuid)','EXECUTE'
  ),
  'low stock policy mutation remains server-only while branch alerts are readable'
);

select extensions.is(
  public.set_sellertray_low_stock_policy(
    (select tenant_id from sellertray_low_stock_fixture),
    (select branch_id from sellertray_low_stock_fixture),
    (select product_id from sellertray_low_stock_fixture),
    12,24,
    (select owner_user_id from sellertray_low_stock_fixture)
  )->>'changed',
  'true','Owner can configure a branch-specific low stock threshold'
);

select set_config(
  'request.jwt.claim.sub',
  (select staff_user_id::text from sellertray_low_stock_fixture),
  true
);
select set_config('request.jwt.claim.role','authenticated',true);

select extensions.ok(
  exists(
    select 1 from public.get_sellertray_low_stock(
      (select tenant_id from sellertray_low_stock_fixture),
      (select branch_id from sellertray_low_stock_fixture)
    ) l
    where l.catalog_item_id=(select product_id from sellertray_low_stock_fixture)
      and l.quantity_on_hand=10
      and l.stock_uom='Bottle'
      and l.low_stock_threshold=12
      and l.reorder_target=24
      and l.suggested_reorder_quantity=14
      and l.is_out_of_stock=false
  ),
  'low stock alert is calculated from ledger quantity and branch policy in Stock UOM'
);

select extensions.ok(
  exists(
    select 1 from public.get_sellertray_low_stock(
      (select tenant_id from sellertray_low_stock_fixture),
      (select branch_id from sellertray_low_stock_fixture)
    ) l
    where l.catalog_item_id=(select zero_product_id from sellertray_low_stock_fixture)
      and l.quantity_on_hand=0
      and l.low_stock_threshold=0
      and l.is_out_of_stock=true
  ),
  'products without an explicit policy retain the default out-of-stock threshold of zero'
);

select extensions.is(
  public.set_sellertray_low_stock_policy(
    (select tenant_id from sellertray_low_stock_fixture),
    (select branch_id from sellertray_low_stock_fixture),
    (select product_id from sellertray_low_stock_fixture),
    12,24,
    (select owner_user_id from sellertray_low_stock_fixture)
  )->>'changed',
  'false','repeating the same policy does not fabricate a change'
);

select extensions.is(
  (
    select count(*)::integer from public.branch_inventory_policy_events e
    where e.tenant_id=(select tenant_id from sellertray_low_stock_fixture)
      and e.branch_id=(select branch_id from sellertray_low_stock_fixture)
      and e.catalog_item_id=(select product_id from sellertray_low_stock_fixture)
  ),
  1,'no-op policy replay does not duplicate audit history'
);

do $$
begin
  begin
    perform public.set_sellertray_low_stock_policy(
      (select tenant_id from sellertray_low_stock_fixture),
      (select branch_id from sellertray_low_stock_fixture),
      (select product_id from sellertray_low_stock_fixture),
      15,30,
      (select staff_user_id from sellertray_low_stock_fixture)
    );
  exception when sqlstate '42501' then
    update sellertray_low_stock_fixture set staff_policy_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select staff_policy_rejected from sellertray_low_stock_fixture),
  'Staff cannot change low stock management policy'
);

select extensions.is(
  public.set_sellertray_low_stock_policy(
    (select tenant_id from sellertray_low_stock_fixture),
    (select branch_id from sellertray_low_stock_fixture),
    (select product_id from sellertray_low_stock_fixture),
    15,30,
    (select manager_user_id from sellertray_low_stock_fixture)
  )->>'changed',
  'true','Manager can update low stock management policy'
);

select extensions.is(
  (
    select count(*)::integer from public.branch_inventory_policy_events e
    where e.tenant_id=(select tenant_id from sellertray_low_stock_fixture)
      and e.branch_id=(select branch_id from sellertray_low_stock_fixture)
      and e.catalog_item_id=(select product_id from sellertray_low_stock_fixture)
  ),
  2,'effective policy changes retain before/after audit history'
);

do $$
begin
  begin
    perform public.set_sellertray_low_stock_policy(
      (select tenant_id from sellertray_low_stock_fixture),
      (select branch_id from sellertray_low_stock_fixture),
      (select product_id from sellertray_low_stock_fixture),
      0.5,2,
      (select owner_user_id from sellertray_low_stock_fixture)
    );
  exception when sqlstate '23514' then
    update sellertray_low_stock_fixture set fractional_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select fractional_rejected from sellertray_low_stock_fixture),
  'non-fractional Stock UOM rejects fractional threshold policy'
);

do $$
begin
  begin
    perform public.set_sellertray_low_stock_policy(
      (select tenant_id from sellertray_low_stock_fixture),
      (select branch_id from sellertray_low_stock_fixture),
      (select product_id from sellertray_low_stock_fixture),
      20,10,
      (select owner_user_id from sellertray_low_stock_fixture)
    );
  exception when sqlstate '22023' then
    update sellertray_low_stock_fixture set target_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select target_rejected from sellertray_low_stock_fixture),
  'reorder target cannot be below the low stock threshold'
);

select extensions.is(
  (
    select coalesce(sum(im.quantity_delta),0)::numeric
    from public.inventory_movements im
    where im.tenant_id=(select tenant_id from sellertray_low_stock_fixture)
      and im.branch_id=(select branch_id from sellertray_low_stock_fixture)
      and im.catalog_item_id=(select product_id from sellertray_low_stock_fixture)
  ),
  10::numeric,'changing low stock policy never changes the stock ledger'
);

do $$
begin
  begin
    perform * from public.get_sellertray_low_stock(
      (select tenant_id from sellertray_low_stock_fixture),
      (select branch_two_id from sellertray_low_stock_fixture)
    );
  exception when sqlstate '42501' then
    update sellertray_low_stock_fixture set branch_read_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select branch_read_rejected from sellertray_low_stock_fixture),
  'low stock read scope fails closed for an inaccessible branch'
);

do $$
begin
  begin
    update public.branch_inventory_policy_events
    set new_low_stock_threshold=999
    where tenant_id=(select tenant_id from sellertray_low_stock_fixture)
      and catalog_item_id=(select product_id from sellertray_low_stock_fixture);
  exception when sqlstate '55000' then
    update sellertray_low_stock_fixture set event_update_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select event_update_rejected from sellertray_low_stock_fixture),
  'low stock policy audit history is immutable'
);

select extensions.ok(
  exists(
    select 1 from public.branch_inventory_policy_events e
    where e.tenant_id=(select tenant_id from sellertray_low_stock_fixture)
      and e.catalog_item_id=(select product_id from sellertray_low_stock_fixture)
      and e.previous_low_stock_threshold=12
      and e.new_low_stock_threshold=15
      and e.previous_reorder_target=24
      and e.new_reorder_target=30
      and e.actor_user_id=(select manager_user_id from sellertray_low_stock_fixture)
  ),
  'policy audit preserves accountable before and after values'
);

delete from public.tenants
where id=(select tenant_id from sellertray_low_stock_fixture);

select extensions.is(
  (
    select count(*)::integer from public.branch_inventory_policies p
    where p.tenant_id=(select tenant_id from sellertray_low_stock_fixture)
  ),
  0,'governed Tenant deletion removes branch inventory policies'
);

select extensions.is(
  (
    select count(*)::integer from public.branch_inventory_policy_events e
    where e.tenant_id=(select tenant_id from sellertray_low_stock_fixture)
  ),
  0,'governed Tenant deletion removes dependent policy audit history'
);

select * from extensions.finish();
rollback;