begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(12);

create temp table sellertray_operational_lifecycle_fixture (
  tenant_id uuid not null,
  owner_user_id uuid not null,
  staff_user_id uuid not null,
  product_id uuid not null,
  branch_id uuid,
  location_id uuid,
  uom_id uuid,
  order_id uuid,
  return_id uuid,
  inventory_delete_rejected boolean not null default false,
  return_delete_rejected boolean not null default false,
  capability_event_delete_rejected boolean not null default false,
  order_item_delete_rejected boolean not null default false
) on commit drop;

insert into sellertray_operational_lifecycle_fixture(
  tenant_id,owner_user_id,staff_user_id,product_id
)
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_user_id,
  'lifecycle-owner-'||substr(owner_user_id::text,1,8)||'@example.com',
  'authenticated','authenticated',now(),now()
from sellertray_operational_lifecycle_fixture
union all
select staff_user_id,
  'lifecycle-staff-'||substr(staff_user_id::text,1,8)||'@example.com',
  'authenticated','authenticated',now(),now()
from sellertray_operational_lifecycle_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'SellerTray Operational Lifecycle Test',
  'sellertray-lifecycle-'||substr(tenant_id::text,1,8),'OLC','active'
from sellertray_operational_lifecycle_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from sellertray_operational_lifecycle_fixture);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner'
from sellertray_operational_lifecycle_fixture
union all
select tenant_id,staff_user_id,'staff'
from sellertray_operational_lifecycle_fixture;

update sellertray_operational_lifecycle_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

update sellertray_operational_lifecycle_fixture f
set location_id=sl.id
from public.stock_locations sl
where sl.tenant_id=f.tenant_id
  and sl.branch_id=f.branch_id
  and sl.is_default=true;

insert into public.catalog_items(
  id,tenant_id,name,sku,price_ngn,is_active,stock_uom,allow_fractional_stock
)
select product_id,tenant_id,'Lifecycle Product','LIFE-001',100,true,'Each',false
from sellertray_operational_lifecycle_fixture;

update sellertray_operational_lifecycle_fixture f
set uom_id=u.id
from public.catalog_item_uoms u
where u.tenant_id=f.tenant_id
  and u.catalog_item_id=f.product_id
  and lower(u.uom_name)='each';

select public.record_sellertray_inventory_movement(
  tenant_id,branch_id,location_id,product_id,
  'opening',10,'Each',10,1,
  'opening_stock','LIFE-OPEN','opening:LIFE-OPEN',
  now(),owner_user_id,'Lifecycle opening stock','{}'::jsonb,null
)
from sellertray_operational_lifecycle_fixture;

update sellertray_operational_lifecycle_fixture
set order_id=public.create_sellertray_pos_order_atomic(
  tenant_id,branch_id,null,null,'Lifecycle sale',
  jsonb_build_array(jsonb_build_object(
    'catalog_item_id',product_id,'uom_id',uom_id,'quantity',1
  ))
);

set local request.jwt.claim.role = 'service_role';

select public.complete_sellertray_pos_cash_sale(
  tenant_id,order_id,owner_user_id
)
from sellertray_operational_lifecycle_fixture;

with returned as (
  select public.return_sellertray_pos_cash_sale(
    tenant_id,order_id,owner_user_id,'Lifecycle return'
  ) as result
  from sellertray_operational_lifecycle_fixture
)
update sellertray_operational_lifecycle_fixture
set return_id=(select (result->>'returnId')::uuid from returned);

select public.set_sellertray_member_capability(
  tenant_id,staff_user_id,'can_receive_stock',true,owner_user_id
)
from sellertray_operational_lifecycle_fixture;

do $$
begin
  begin
    delete from public.inventory_movements
    where id=(
      select im.id
      from public.inventory_movements im
      where im.tenant_id=(select tenant_id from sellertray_operational_lifecycle_fixture)
      order by im.created_at,im.id
      limit 1
    );
  exception when sqlstate '55000' then
    update sellertray_operational_lifecycle_fixture
    set inventory_delete_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select inventory_delete_rejected from sellertray_operational_lifecycle_fixture),
  'inventory movements remain undeletable while the Tenant exists'
);

do $$
begin
  begin
    delete from public.sale_returns
    where id=(select return_id from sellertray_operational_lifecycle_fixture);
  exception when sqlstate '55000' then
    update sellertray_operational_lifecycle_fixture
    set return_delete_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select return_delete_rejected from sellertray_operational_lifecycle_fixture),
  'sale returns remain undeletable while the Tenant exists'
);

do $$
begin
  begin
    delete from public.tenant_member_capability_events
    where tenant_id=(select tenant_id from sellertray_operational_lifecycle_fixture);
  exception when sqlstate '55000' then
    update sellertray_operational_lifecycle_fixture
    set capability_event_delete_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select capability_event_delete_rejected from sellertray_operational_lifecycle_fixture),
  'permission audit history remains undeletable while the Tenant exists'
);

do $$
begin
  begin
    delete from public.order_items
    where tenant_id=(select tenant_id from sellertray_operational_lifecycle_fixture)
      and order_id=(select order_id from sellertray_operational_lifecycle_fixture);
  exception when sqlstate '23514' then
    update sellertray_operational_lifecycle_fixture
    set order_item_delete_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select order_item_delete_rejected from sellertray_operational_lifecycle_fixture),
  'direct deletion of completed invoiced order items remains financially locked'
);

select public.archive_sellertray_financial_records(
  (select tenant_id from sellertray_operational_lifecycle_fixture)
);

select extensions.is(
  (
    select count(*)::integer
    from sellertray_private.financial_retention_records r
    where r.source_tenant_id=(select tenant_id from sellertray_operational_lifecycle_fixture)
      and r.record_kind='refund'
  ),
  1,
  'cash refund evidence is retained before governed business deletion'
);

delete from public.tenants
where id=(select tenant_id from sellertray_operational_lifecycle_fixture);

select extensions.is(
  (
    select count(*)::integer from public.tenants t
    where t.id=(select tenant_id from sellertray_operational_lifecycle_fixture)
  ),
  0,
  'governed parent Tenant deletion is not blocked by immutable operational history'
);

select extensions.is(
  (
    select count(*)::integer from public.inventory_movements im
    where im.tenant_id=(select tenant_id from sellertray_operational_lifecycle_fixture)
  ),
  0,
  'Tenant deletion removes inventory movement history'
);

select extensions.is(
  (
    select count(*)::integer from public.sale_returns sr
    where sr.tenant_id=(select tenant_id from sellertray_operational_lifecycle_fixture)
  ),
  0,
  'Tenant deletion removes sale-return aggregates'
);

select extensions.is(
  (
    select count(*)::integer from public.sale_return_items sri
    where sri.tenant_id=(select tenant_id from sellertray_operational_lifecycle_fixture)
  ),
  0,
  'Tenant deletion removes sale-return lines'
);

select extensions.is(
  (
    select count(*)::integer from public.payment_refunds pr
    where pr.tenant_id=(select tenant_id from sellertray_operational_lifecycle_fixture)
  ),
  0,
  'Tenant deletion removes operational refund rows after retention archive'
);

select extensions.is(
  (
    select count(*)::integer from public.tenant_member_capability_events e
    where e.tenant_id=(select tenant_id from sellertray_operational_lifecycle_fixture)
  ),
  0,
  'Tenant deletion removes permission audit history with the business'
);

select extensions.is(
  (
    select count(*)::integer from public.tenant_member_capabilities c
    where c.tenant_id=(select tenant_id from sellertray_operational_lifecycle_fixture)
  ),
  0,
  'Tenant deletion removes active capability overrides'
);

select * from extensions.finish();
rollback;