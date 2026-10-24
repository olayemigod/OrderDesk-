begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(23);

create temp table sellertray_inventory_command_fixture (
  tenant_id uuid not null,
  owner_user_id uuid not null,
  product_id uuid not null,
  branch_id uuid,
  location_id uuid,
  stock_uom_id uuid,
  opening_result jsonb,
  opening_replay jsonb,
  reference_replay jsonb,
  damage_result jsonb,
  expiry_result jsonb,
  recovery_result jsonb,
  command_conflict boolean not null default false,
  reference_conflict boolean not null default false,
  second_opening_rejected boolean not null default false,
  replenishment_rejected boolean not null default false,
  count_reason_rejected boolean not null default false,
  damage_increase_rejected boolean not null default false,
  expiry_increase_rejected boolean not null default false,
  missing_increase_rejected boolean not null default false,
  recovery_decrease_rejected boolean not null default false
) on commit drop;

insert into sellertray_inventory_command_fixture(tenant_id,owner_user_id,product_id)
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_user_id,
  'inventory-command-'||substr(owner_user_id::text,1,8)||'@example.com',
  'authenticated','authenticated',now(),now()
from sellertray_inventory_command_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'SellerTray Inventory Command Test',
  'sellertray-inventory-command-'||substr(tenant_id::text,1,8),'ICT','active'
from sellertray_inventory_command_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from sellertray_inventory_command_fixture);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner'
from sellertray_inventory_command_fixture;

update sellertray_inventory_command_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

update sellertray_inventory_command_fixture f
set location_id=sl.id
from public.stock_locations sl
where sl.tenant_id=f.tenant_id
  and sl.branch_id=f.branch_id
  and sl.is_default=true;

insert into public.catalog_items(
  id,tenant_id,name,sku,price_ngn,is_active,stock_uom,allow_fractional_stock
)
select product_id,tenant_id,'Inventory Command Product','ICT-PRODUCT',100,true,'Bottle',false
from sellertray_inventory_command_fixture;

update sellertray_inventory_command_fixture f
set stock_uom_id=u.id
from public.catalog_item_uoms u
where u.tenant_id=f.tenant_id
  and u.catalog_item_id=f.product_id
  and lower(u.uom_name)='bottle';

select extensions.ok(
  to_regprocedure('public.apply_sellertray_inventory_operation(uuid,uuid,uuid,uuid,text,numeric,text,text,text,text,uuid)') is not null,
  'inventory command accepts an explicit hidden retry identity'
);

select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.apply_sellertray_inventory_operation(uuid,uuid,uuid,uuid,text,numeric,text,text,text,text,uuid)',
    'EXECUTE'
  ),
  'service role can execute the authoritative inventory command'
);

select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.apply_sellertray_inventory_operation(uuid,uuid,uuid,uuid,text,numeric,text,text,text,text,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot bypass the inventory Edge Function'
);

update sellertray_inventory_command_fixture
set opening_result=public.apply_sellertray_inventory_operation(
  tenant_id,branch_id,product_id,stock_uom_id,
  'receive',20,null,'OPEN-001','Opening stock','cmd:opening:001',owner_user_id
);

select extensions.is(
  (
    select im.movement_type
    from public.inventory_movements im
    where im.tenant_id=(select tenant_id from sellertray_inventory_command_fixture)
      and im.id=(select (opening_result->>'movementId')::uuid from sellertray_inventory_command_fixture)
  ),
  'opening','Opening stock posts the canonical opening movement type'
);

select extensions.is(
  (select (opening_result->>'quantityOnHand')::numeric from sellertray_inventory_command_fixture),
  20::numeric,'Opening stock establishes the initial on-hand balance'
);

update sellertray_inventory_command_fixture
set opening_replay=public.apply_sellertray_inventory_operation(
  tenant_id,branch_id,product_id,stock_uom_id,
  'receive',20,null,'OPEN-001','Opening stock','cmd:opening:001',owner_user_id
);

select extensions.is(
  (select opening_replay->>'idempotentReplay' from sellertray_inventory_command_fixture),
  'true','exact retry of one hidden command identity replays safely'
);

select extensions.is(
  (
    select count(*)::integer
    from public.inventory_movements im
    where im.tenant_id=(select tenant_id from sellertray_inventory_command_fixture)
      and im.catalog_item_id=(select product_id from sellertray_inventory_command_fixture)
      and im.reference_id='OPEN-001'
  ),
  1,'exact retry does not duplicate the opening stock effect'
);

do $$
begin
  begin
    perform public.apply_sellertray_inventory_operation(
      (select tenant_id from sellertray_inventory_command_fixture),
      (select branch_id from sellertray_inventory_command_fixture),
      (select product_id from sellertray_inventory_command_fixture),
      (select stock_uom_id from sellertray_inventory_command_fixture),
      'receive',20,null,'OPEN-CHANGED','Opening stock','cmd:opening:001',
      (select owner_user_id from sellertray_inventory_command_fixture)
    );
  exception when sqlstate '23505' then
    update sellertray_inventory_command_fixture set command_conflict=true;
  end;
end
$$;

select extensions.ok(
  (select command_conflict from sellertray_inventory_command_fixture),
  'one hidden command identity cannot be reused with a changed business reference'
);

update sellertray_inventory_command_fixture
set reference_replay=public.apply_sellertray_inventory_operation(
  tenant_id,branch_id,product_id,stock_uom_id,
  'receive',20,null,'OPEN-001','Opening stock','cmd:opening:002',owner_user_id
);

select extensions.is(
  (select reference_replay->>'idempotentReplay' from sellertray_inventory_command_fixture),
  'true','same business reference and same facts replay across a new transport identity'
);

do $$
begin
  begin
    perform public.apply_sellertray_inventory_operation(
      (select tenant_id from sellertray_inventory_command_fixture),
      (select branch_id from sellertray_inventory_command_fixture),
      (select product_id from sellertray_inventory_command_fixture),
      (select stock_uom_id from sellertray_inventory_command_fixture),
      'receive',21,null,'OPEN-001','Opening stock','cmd:opening:003',
      (select owner_user_id from sellertray_inventory_command_fixture)
    );
  exception when sqlstate '23505' then
    update sellertray_inventory_command_fixture set reference_conflict=true;
  end;
end
$$;

select extensions.ok(
  (select reference_conflict from sellertray_inventory_command_fixture),
  'same business reference cannot be reused for changed stock facts'
);

do $$
begin
  begin
    perform public.apply_sellertray_inventory_operation(
      (select tenant_id from sellertray_inventory_command_fixture),
      (select branch_id from sellertray_inventory_command_fixture),
      (select product_id from sellertray_inventory_command_fixture),
      (select stock_uom_id from sellertray_inventory_command_fixture),
      'receive',5,null,'OPEN-002','Opening stock','cmd:opening:004',
      (select owner_user_id from sellertray_inventory_command_fixture)
    );
  exception when sqlstate '23514' then
    update sellertray_inventory_command_fixture set second_opening_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select second_opening_rejected from sellertray_inventory_command_fixture),
  'a genuinely new opening balance is rejected after stock history exists'
);

do $$
begin
  begin
    perform public.apply_sellertray_inventory_operation(
      (select tenant_id from sellertray_inventory_command_fixture),
      (select branch_id from sellertray_inventory_command_fixture),
      (select product_id from sellertray_inventory_command_fixture),
      (select stock_uom_id from sellertray_inventory_command_fixture),
      'receive',2,null,'BRANCH-REPLENISH-001','Branch replenishment','cmd:receive:replenish',
      (select owner_user_id from sellertray_inventory_command_fixture)
    );
  exception when sqlstate '23514' then
    update sellertray_inventory_command_fixture set replenishment_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select replenishment_rejected from sellertray_inventory_command_fixture),
  'direct receiving cannot bypass Stock Transfer for branch replenishment'
);

do $$
begin
  begin
    perform public.apply_sellertray_inventory_operation(
      (select tenant_id from sellertray_inventory_command_fixture),
      (select branch_id from sellertray_inventory_command_fixture),
      (select product_id from sellertray_inventory_command_fixture),
      (select stock_uom_id from sellertray_inventory_command_fixture),
      'adjust',1,'increase','COUNT-BYPASS-001','Stock count correction','cmd:adjust:count',
      (select owner_user_id from sellertray_inventory_command_fixture)
    );
  exception when sqlstate '23514' then
    update sellertray_inventory_command_fixture set count_reason_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select count_reason_rejected from sellertray_inventory_command_fixture),
  'direct adjustment cannot bypass the governed Stock Count workflow'
);

do $$
begin
  begin
    perform public.apply_sellertray_inventory_operation(
      (select tenant_id from sellertray_inventory_command_fixture),
      (select branch_id from sellertray_inventory_command_fixture),
      (select product_id from sellertray_inventory_command_fixture),
      (select stock_uom_id from sellertray_inventory_command_fixture),
      'adjust',2,'increase','DAMAGE-BAD-001','Damage','cmd:damage:bad',
      (select owner_user_id from sellertray_inventory_command_fixture)
    );
  exception when sqlstate '23514' then
    update sellertray_inventory_command_fixture set damage_increase_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select damage_increase_rejected from sellertray_inventory_command_fixture),
  'Damage cannot increase stock'
);

update sellertray_inventory_command_fixture
set damage_result=public.apply_sellertray_inventory_operation(
  tenant_id,branch_id,product_id,stock_uom_id,
  'adjust',2,'decrease','DAMAGE-001','Damage','cmd:damage:001',owner_user_id
);

select extensions.is(
  (
    select im.movement_type
    from public.inventory_movements im
    where im.id=(select (damage_result->>'movementId')::uuid from sellertray_inventory_command_fixture)
  ),
  'damaged','Damage posts the canonical damaged movement type'
);

do $$
begin
  begin
    perform public.apply_sellertray_inventory_operation(
      (select tenant_id from sellertray_inventory_command_fixture),
      (select branch_id from sellertray_inventory_command_fixture),
      (select product_id from sellertray_inventory_command_fixture),
      (select stock_uom_id from sellertray_inventory_command_fixture),
      'adjust',1,'increase','EXPIRY-BAD-001','Expiry','cmd:expiry:bad',
      (select owner_user_id from sellertray_inventory_command_fixture)
    );
  exception when sqlstate '23514' then
    update sellertray_inventory_command_fixture set expiry_increase_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select expiry_increase_rejected from sellertray_inventory_command_fixture),
  'Expiry cannot increase stock'
);

update sellertray_inventory_command_fixture
set expiry_result=public.apply_sellertray_inventory_operation(
  tenant_id,branch_id,product_id,stock_uom_id,
  'adjust',1,'decrease','EXPIRY-001','Expiry','cmd:expiry:001',owner_user_id
);

select extensions.is(
  (
    select im.movement_type
    from public.inventory_movements im
    where im.id=(select (expiry_result->>'movementId')::uuid from sellertray_inventory_command_fixture)
  ),
  'expired','Expiry posts the canonical expired movement type'
);

do $$
begin
  begin
    perform public.apply_sellertray_inventory_operation(
      (select tenant_id from sellertray_inventory_command_fixture),
      (select branch_id from sellertray_inventory_command_fixture),
      (select product_id from sellertray_inventory_command_fixture),
      (select stock_uom_id from sellertray_inventory_command_fixture),
      'adjust',1,'increase','MISSING-BAD-001','Missing / shrinkage','cmd:missing:bad',
      (select owner_user_id from sellertray_inventory_command_fixture)
    );
  exception when sqlstate '23514' then
    update sellertray_inventory_command_fixture set missing_increase_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select missing_increase_rejected from sellertray_inventory_command_fixture),
  'Missing or shrinkage cannot increase stock'
);

do $$
begin
  begin
    perform public.apply_sellertray_inventory_operation(
      (select tenant_id from sellertray_inventory_command_fixture),
      (select branch_id from sellertray_inventory_command_fixture),
      (select product_id from sellertray_inventory_command_fixture),
      (select stock_uom_id from sellertray_inventory_command_fixture),
      'adjust',1,'decrease','RECOVERY-BAD-001','Inventory recovery','cmd:recovery:bad',
      (select owner_user_id from sellertray_inventory_command_fixture)
    );
  exception when sqlstate '23514' then
    update sellertray_inventory_command_fixture set recovery_decrease_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select recovery_decrease_rejected from sellertray_inventory_command_fixture),
  'Inventory recovery cannot reduce stock'
);

update sellertray_inventory_command_fixture
set recovery_result=public.apply_sellertray_inventory_operation(
  tenant_id,branch_id,product_id,stock_uom_id,
  'adjust',1,'increase','RECOVERY-001','Inventory recovery','cmd:recovery:001',owner_user_id
);

select extensions.is(
  (
    select im.movement_type
    from public.inventory_movements im
    where im.id=(select (recovery_result->>'movementId')::uuid from sellertray_inventory_command_fixture)
  ),
  'adjustment','Inventory recovery posts a controlled positive adjustment'
);

select extensions.is(
  (
    select s.quantity_on_hand
    from public.get_sellertray_branch_stock(
      (select tenant_id from sellertray_inventory_command_fixture),
      (select branch_id from sellertray_inventory_command_fixture)
    ) s
    where s.catalog_item_id=(select product_id from sellertray_inventory_command_fixture)
  ),
  18::numeric,'governed classifications reconcile to the expected Stock-UOM balance'
);

select extensions.ok(
  exists(
    select 1 from public.inventory_movements im
    where im.id=(select (opening_result->>'movementId')::uuid from sellertray_inventory_command_fixture)
      and im.idempotency_key like 'inventory-operation:%'
      and im.idempotency_key not like '%OPEN-001%'
  ),
  'stored retry identity does not expose or depend on the visible business reference'
);

select extensions.ok(
  exists(
    select 1 from public.inventory_movements im
    where im.id=(select (opening_result->>'movementId')::uuid from sellertray_inventory_command_fixture)
      and im.metadata->>'retry_identity'='client_command_id'
  ),
  'movement audit records the governed retry identity model'
);

select * from extensions.finish();
rollback;