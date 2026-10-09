begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(29);

create temp table sellertray_inventory_operation_fixture (
  tenant_id uuid not null,
  owner_user_id uuid not null,
  manager_user_id uuid not null,
  staff_user_id uuid not null,
  product_id uuid not null,
  branch_id uuid,
  branch_two_id uuid,
  location_id uuid,
  pack_uom_id uuid,
  receive_result jsonb,
  receive_replay jsonb,
  adjust_result jsonb,
  staff_adjust_denied boolean not null default false,
  overdraw_rejected boolean not null default false,
  cross_branch_rejected boolean not null default false,
  conflicting_retry_rejected boolean not null default false,
  fractional_rejected boolean not null default false
) on commit drop;

insert into sellertray_inventory_operation_fixture(
  tenant_id,owner_user_id,manager_user_id,staff_user_id,product_id
)
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_user_id,
  'inventory-owner-'||substr(owner_user_id::text,1,8)||'@example.com',
  'authenticated','authenticated',now(),now()
from sellertray_inventory_operation_fixture
union all
select manager_user_id,
  'inventory-manager-'||substr(manager_user_id::text,1,8)||'@example.com',
  'authenticated','authenticated',now(),now()
from sellertray_inventory_operation_fixture
union all
select staff_user_id,
  'inventory-staff-'||substr(staff_user_id::text,1,8)||'@example.com',
  'authenticated','authenticated',now(),now()
from sellertray_inventory_operation_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'SellerTray Inventory Operation Test',
  'sellertray-inventory-op-'||substr(tenant_id::text,1,8),'IOP','active'
from sellertray_inventory_operation_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from sellertray_inventory_operation_fixture);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner' from sellertray_inventory_operation_fixture
union all
select tenant_id,manager_user_id,'manager' from sellertray_inventory_operation_fixture
union all
select tenant_id,staff_user_id,'staff' from sellertray_inventory_operation_fixture;

update sellertray_inventory_operation_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

insert into public.branches(tenant_id,code,name,is_default,is_active)
select tenant_id,'SECOND','Second Branch',false,true
from sellertray_inventory_operation_fixture;

update sellertray_inventory_operation_fixture f
set branch_two_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.code='SECOND';

update sellertray_inventory_operation_fixture f
set location_id=sl.id
from public.stock_locations sl
where sl.tenant_id=f.tenant_id
  and sl.branch_id=f.branch_id
  and sl.is_default=true;

insert into public.branch_user_access(tenant_id,branch_id,user_id,can_operate)
select tenant_id,branch_id,staff_user_id,true
from sellertray_inventory_operation_fixture;

insert into public.catalog_items(
  id,tenant_id,name,sku,price_ngn,is_active,stock_uom,allow_fractional_stock
)
select product_id,tenant_id,'Inventory Operation Drink','IOP-DRINK',100,true,'Bottle',false
from sellertray_inventory_operation_fixture;

with inserted_uom as (
  insert into public.catalog_item_uoms(
    tenant_id,catalog_item_id,uom_name,conversion_factor,selling_price,
    allow_fractional,is_default_selling
  )
  select tenant_id,product_id,'Pack',12,1050,false,false
  from sellertray_inventory_operation_fixture
  returning id
)
update sellertray_inventory_operation_fixture
set pack_uom_id=(select id from inserted_uom);

select public.record_sellertray_inventory_movement(
  tenant_id,branch_id,location_id,product_id,
  'opening',24,'Bottle',24,1,
  'opening_stock','IOP-OPENING','opening:IOP-OPENING',
  now(),owner_user_id,'Opening inventory operation stock','{}'::jsonb,null
)
from sellertray_inventory_operation_fixture;

select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.apply_sellertray_inventory_operation(uuid,uuid,uuid,uuid,text,numeric,text,text,text,uuid)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.apply_sellertray_inventory_operation(uuid,uuid,uuid,uuid,text,numeric,text,text,text,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.set_sellertray_member_capability(uuid,uuid,text,boolean,uuid)',
    'EXECUTE'
  ),
  'inventory mutation and permission commands remain server-only'
);

select extensions.ok(
  public.sellertray_user_has_capability(
    (select tenant_id from sellertray_inventory_operation_fixture),
    (select owner_user_id from sellertray_inventory_operation_fixture),
    'can_receive_stock'
  ),
  'Owner has stock receiving authority by role'
);

select extensions.ok(
  public.sellertray_user_has_capability(
    (select tenant_id from sellertray_inventory_operation_fixture),
    (select manager_user_id from sellertray_inventory_operation_fixture),
    'can_adjust_stock'
  ),
  'Manager has stock adjustment authority by default'
);

select extensions.ok(
  not public.sellertray_user_has_capability(
    (select tenant_id from sellertray_inventory_operation_fixture),
    (select staff_user_id from sellertray_inventory_operation_fixture),
    'can_receive_stock'
  ),
  'Staff does not gain receiving authority from role alone'
);

select extensions.ok(
  not public.sellertray_user_has_capability(
    (select tenant_id from sellertray_inventory_operation_fixture),
    (select staff_user_id from sellertray_inventory_operation_fixture),
    'can_adjust_stock'
  ),
  'Staff does not gain adjustment authority from role alone'
);

select extensions.ok(
  public.sellertray_user_can_operate_branch(
    (select tenant_id from sellertray_inventory_operation_fixture),
    (select branch_id from sellertray_inventory_operation_fixture),
    (select staff_user_id from sellertray_inventory_operation_fixture)
  ),
  'Staff can operate the explicitly assigned branch'
);

select extensions.ok(
  not public.sellertray_user_can_operate_branch(
    (select tenant_id from sellertray_inventory_operation_fixture),
    (select branch_two_id from sellertray_inventory_operation_fixture),
    (select staff_user_id from sellertray_inventory_operation_fixture)
  ),
  'Staff cannot operate an unassigned second branch'
);

select extensions.ok(
  public.set_sellertray_member_capability(
    (select tenant_id from sellertray_inventory_operation_fixture),
    (select staff_user_id from sellertray_inventory_operation_fixture),
    'can_receive_stock',true,
    (select owner_user_id from sellertray_inventory_operation_fixture)
  ),
  'Owner can grant Staff receiving authority'
);

select extensions.ok(
  public.sellertray_user_has_capability(
    (select tenant_id from sellertray_inventory_operation_fixture),
    (select staff_user_id from sellertray_inventory_operation_fixture),
    'can_receive_stock'
  ),
  'Staff receiving grant is effective'
);

update sellertray_inventory_operation_fixture
set receive_result=public.apply_sellertray_inventory_operation(
  tenant_id,branch_id,product_id,pack_uom_id,
  'receive',1,null,'GRN-001','Supplier delivery received',staff_user_id
);

select extensions.is(
  (select receive_result->>'operation' from sellertray_inventory_operation_fixture),
  'receive','governed operation records a stock receipt'
);

select extensions.is(
  (select (receive_result->>'quantityDelta')::numeric from sellertray_inventory_operation_fixture),
  12::numeric,'one Pack normalizes to twelve Bottles'
);

select extensions.is(
  (
    select s.quantity_on_hand
    from public.get_sellertray_branch_stock(
      (select tenant_id from sellertray_inventory_operation_fixture),
      (select branch_id from sellertray_inventory_operation_fixture)
    ) s
    where s.catalog_item_id=(select product_id from sellertray_inventory_operation_fixture)
  ),
  36::numeric,'receipt increases branch stock in Stock UOM'
);

select extensions.ok(
  exists(
    select 1
    from public.inventory_movements im
    where im.tenant_id=(select tenant_id from sellertray_inventory_operation_fixture)
      and im.catalog_item_id=(select product_id from sellertray_inventory_operation_fixture)
      and im.movement_type='purchase_receipt'
      and im.source_uom='Pack'
      and im.source_quantity=1
      and im.conversion_factor=12
      and im.quantity_delta=12
      and im.reference_id='GRN-001'
      and im.reason='Supplier delivery received'
  ),
  'receipt movement preserves unit conversion, reference and reason'
);

update sellertray_inventory_operation_fixture
set receive_replay=public.apply_sellertray_inventory_operation(
  tenant_id,branch_id,product_id,pack_uom_id,
  'receive',1,null,'GRN-001','Supplier delivery received',staff_user_id
);

select extensions.is(
  (select receive_replay->>'idempotentReplay' from sellertray_inventory_operation_fixture),
  'true','same receipt retry resolves idempotently'
);

select extensions.is(
  (
    select count(*)::integer
    from public.inventory_movements im
    where im.tenant_id=(select tenant_id from sellertray_inventory_operation_fixture)
      and im.reference_type='stock_receipt'
      and im.reference_id='GRN-001'
  ),
  1,'receipt retry does not duplicate stock effect'
);

do $$
begin
  begin
    perform public.apply_sellertray_inventory_operation(
      (select tenant_id from sellertray_inventory_operation_fixture),
      (select branch_id from sellertray_inventory_operation_fixture),
      (select product_id from sellertray_inventory_operation_fixture),
      (select pack_uom_id from sellertray_inventory_operation_fixture),
      'adjust',1,'decrease','ADJ-DENIED','Staff should not adjust yet',
      (select staff_user_id from sellertray_inventory_operation_fixture)
    );
  exception when sqlstate '42501' then
    update sellertray_inventory_operation_fixture set staff_adjust_denied=true;
  end;
end
$$;

select extensions.ok(
  (select staff_adjust_denied from sellertray_inventory_operation_fixture),
  'Staff adjustment is denied before capability grant'
);

select extensions.ok(
  public.set_sellertray_member_capability(
    (select tenant_id from sellertray_inventory_operation_fixture),
    (select staff_user_id from sellertray_inventory_operation_fixture),
    'can_adjust_stock',true,
    (select manager_user_id from sellertray_inventory_operation_fixture)
  ),
  'Manager can grant Staff stock adjustment authority'
);

select extensions.ok(
  public.sellertray_user_has_capability(
    (select tenant_id from sellertray_inventory_operation_fixture),
    (select staff_user_id from sellertray_inventory_operation_fixture),
    'can_adjust_stock'
  ),
  'Staff adjustment grant is effective'
);

update sellertray_inventory_operation_fixture
set adjust_result=public.apply_sellertray_inventory_operation(
  tenant_id,branch_id,product_id,pack_uom_id,
  'adjust',1,'decrease','ADJ-001','Damaged pack removed',staff_user_id
);

select extensions.is(
  (select (adjust_result->>'quantityDelta')::numeric from sellertray_inventory_operation_fixture),
  (-12)::numeric,'decrease adjustment posts a negative Stock UOM movement'
);

select extensions.is(
  (select (adjust_result->>'quantityOnHand')::numeric from sellertray_inventory_operation_fixture),
  24::numeric,'adjustment result returns the new on-hand balance'
);

select extensions.is(
  (
    select s.quantity_on_hand
    from public.get_sellertray_branch_stock(
      (select tenant_id from sellertray_inventory_operation_fixture),
      (select branch_id from sellertray_inventory_operation_fixture)
    ) s
    where s.catalog_item_id=(select product_id from sellertray_inventory_operation_fixture)
  ),
  24::numeric,'branch stock reflects the governed adjustment'
);

do $$
begin
  begin
    perform public.apply_sellertray_inventory_operation(
      (select tenant_id from sellertray_inventory_operation_fixture),
      (select branch_id from sellertray_inventory_operation_fixture),
      (select product_id from sellertray_inventory_operation_fixture),
      (select pack_uom_id from sellertray_inventory_operation_fixture),
      'adjust',3,'decrease','ADJ-OVERDRAW','Attempt to overdraw branch stock',
      (select staff_user_id from sellertray_inventory_operation_fixture)
    );
  exception when sqlstate '23514' then
    update sellertray_inventory_operation_fixture set overdraw_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select overdraw_rejected from sellertray_inventory_operation_fixture),
  'negative adjustment cannot take branch stock below zero'
);

select extensions.is(
  (
    select count(*)::integer
    from public.inventory_movements im
    where im.tenant_id=(select tenant_id from sellertray_inventory_operation_fixture)
      and im.reference_id='ADJ-OVERDRAW'
  ),
  0,'rejected overdraw creates no stock movement'
);

do $$
begin
  begin
    perform public.apply_sellertray_inventory_operation(
      (select tenant_id from sellertray_inventory_operation_fixture),
      (select branch_two_id from sellertray_inventory_operation_fixture),
      (select product_id from sellertray_inventory_operation_fixture),
      (select pack_uom_id from sellertray_inventory_operation_fixture),
      'receive',1,null,'GRN-SECOND','Unauthorized second-branch receipt',
      (select staff_user_id from sellertray_inventory_operation_fixture)
    );
  exception when sqlstate '42501' then
    update sellertray_inventory_operation_fixture set cross_branch_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select cross_branch_rejected from sellertray_inventory_operation_fixture),
  'capability does not bypass Staff branch isolation'
);

do $$
begin
  begin
    perform public.apply_sellertray_inventory_operation(
      (select tenant_id from sellertray_inventory_operation_fixture),
      (select branch_id from sellertray_inventory_operation_fixture),
      (select product_id from sellertray_inventory_operation_fixture),
      (select pack_uom_id from sellertray_inventory_operation_fixture),
      'receive',2,null,'GRN-001','Conflicting retry facts',
      (select staff_user_id from sellertray_inventory_operation_fixture)
    );
  exception when sqlstate '23505' then
    update sellertray_inventory_operation_fixture set conflicting_retry_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select conflicting_retry_rejected from sellertray_inventory_operation_fixture),
  'same receipt reference cannot be reused for different stock facts'
);

do $$
begin
  begin
    perform public.apply_sellertray_inventory_operation(
      (select tenant_id from sellertray_inventory_operation_fixture),
      (select branch_id from sellertray_inventory_operation_fixture),
      (select product_id from sellertray_inventory_operation_fixture),
      (select pack_uom_id from sellertray_inventory_operation_fixture),
      'receive',0.5,null,'GRN-FRACTION','Fractional Pack should fail',
      (select staff_user_id from sellertray_inventory_operation_fixture)
    );
  exception when sqlstate '23514' then
    update sellertray_inventory_operation_fixture set fractional_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select fractional_rejected from sellertray_inventory_operation_fixture),
  'inventory operation respects the configured fractional UOM policy'
);

select extensions.ok(
  not public.set_sellertray_member_capability(
    (select tenant_id from sellertray_inventory_operation_fixture),
    (select manager_user_id from sellertray_inventory_operation_fixture),
    'can_adjust_stock',false,
    (select owner_user_id from sellertray_inventory_operation_fixture)
  ),
  'Owner can explicitly constrain Manager adjustment authority'
);

select extensions.ok(
  not public.sellertray_user_has_capability(
    (select tenant_id from sellertray_inventory_operation_fixture),
    (select manager_user_id from sellertray_inventory_operation_fixture),
    'can_adjust_stock'
  ),
  'explicit Manager capability denial overrides the Manager default'
);

select extensions.ok(
  public.set_sellertray_member_capability(
    (select tenant_id from sellertray_inventory_operation_fixture),
    (select manager_user_id from sellertray_inventory_operation_fixture),
    'can_adjust_stock',true,
    (select owner_user_id from sellertray_inventory_operation_fixture)
  ),
  'Owner can restore Manager adjustment authority'
);

select extensions.ok(
  public.sellertray_user_has_capability(
    (select tenant_id from sellertray_inventory_operation_fixture),
    (select manager_user_id from sellertray_inventory_operation_fixture),
    'can_adjust_stock'
  ),
  'restored Manager capability is effective'
);

select set_config(
  'request.jwt.claim.sub',
  (select staff_user_id::text from sellertray_inventory_operation_fixture),
  true
);
select set_config('request.jwt.claim.role','authenticated',true);

select extensions.ok(
  (
    select c.can_receive_stock and c.can_adjust_stock
    from public.get_sellertray_inventory_capabilities(
      (select tenant_id from sellertray_inventory_operation_fixture),
      (select branch_id from sellertray_inventory_operation_fixture)
    ) c
  ),
  'mobile capability read exposes Staff permissions for an assigned branch'
);

select extensions.ok(
  (
    select not c.can_receive_stock and not c.can_adjust_stock
    from public.get_sellertray_inventory_capabilities(
      (select tenant_id from sellertray_inventory_operation_fixture),
      (select branch_two_id from sellertray_inventory_operation_fixture)
    ) c
  ),
  'mobile capability read fails closed for an inaccessible branch'
);

select * from extensions.finish();
rollback;