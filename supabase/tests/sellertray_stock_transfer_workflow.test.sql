begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(40);

create temp table sellertray_stock_transfer_fixture (
  tenant_id uuid not null,
  owner_user_id uuid not null,
  manager_user_id uuid not null,
  staff_user_id uuid not null,
  product_id uuid not null,
  source_branch_id uuid,
  destination_branch_id uuid,
  source_location_id uuid,
  destination_location_id uuid,
  stock_uom_id uuid,
  pack_uom_id uuid,
  transfer_id uuid,
  cancel_transfer_id uuid,
  insufficient_transfer_id uuid,
  create_result jsonb,
  replay_result jsonb,
  dispatch_result jsonb,
  receive_result jsonb,
  branch_rejected boolean not null default false,
  conflict_rejected boolean not null default false,
  receive_branch_rejected boolean not null default false,
  received_cancel_rejected boolean not null default false,
  insufficient_dispatch_rejected boolean not null default false,
  fractional_rejected boolean not null default false,
  duplicate_product_rejected boolean not null default false,
  same_branch_rejected boolean not null default false
) on commit drop;

insert into sellertray_stock_transfer_fixture(
  tenant_id,owner_user_id,manager_user_id,staff_user_id,product_id
)
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_user_id,'transfer-owner-'||substr(owner_user_id::text,1,8)||'@example.com',
  'authenticated','authenticated',now(),now()
from sellertray_stock_transfer_fixture
union all
select manager_user_id,'transfer-manager-'||substr(manager_user_id::text,1,8)||'@example.com',
  'authenticated','authenticated',now(),now()
from sellertray_stock_transfer_fixture
union all
select staff_user_id,'transfer-staff-'||substr(staff_user_id::text,1,8)||'@example.com',
  'authenticated','authenticated',now(),now()
from sellertray_stock_transfer_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'SellerTray Stock Transfer Test',
  'sellertray-stock-transfer-'||substr(tenant_id::text,1,8),'STF','active'
from sellertray_stock_transfer_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from sellertray_stock_transfer_fixture);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner' from sellertray_stock_transfer_fixture
union all
select tenant_id,manager_user_id,'manager' from sellertray_stock_transfer_fixture
union all
select tenant_id,staff_user_id,'staff' from sellertray_stock_transfer_fixture;

update sellertray_stock_transfer_fixture f
set source_branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

insert into public.branches(tenant_id,code,name,is_default,is_active)
select tenant_id,'DEST','Destination Branch',false,true
from sellertray_stock_transfer_fixture;

update sellertray_stock_transfer_fixture f
set destination_branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.code='DEST';

update sellertray_stock_transfer_fixture f
set source_location_id=sl.id
from public.stock_locations sl
where sl.tenant_id=f.tenant_id and sl.branch_id=f.source_branch_id and sl.is_default=true;

update sellertray_stock_transfer_fixture f
set destination_location_id=sl.id
from public.stock_locations sl
where sl.tenant_id=f.tenant_id and sl.branch_id=f.destination_branch_id and sl.is_default=true;

insert into public.branch_user_access(tenant_id,branch_id,user_id,can_operate)
select tenant_id,source_branch_id,staff_user_id,true
from sellertray_stock_transfer_fixture;

insert into public.catalog_items(
  id,tenant_id,name,sku,price_ngn,is_active,stock_uom,allow_fractional_stock
)
select product_id,tenant_id,'Transfer Drink','TRANSFER-DRINK',100,true,'Bottle',false
from sellertray_stock_transfer_fixture;

update sellertray_stock_transfer_fixture f
set stock_uom_id=u.id
from public.catalog_item_uoms u
where u.tenant_id=f.tenant_id and u.catalog_item_id=f.product_id
  and lower(u.uom_name)='bottle';

with inserted_uom as (
  insert into public.catalog_item_uoms(
    tenant_id,catalog_item_id,uom_name,conversion_factor,selling_price,
    allow_fractional,is_default_selling,is_default_purchase
  )
  select tenant_id,product_id,'Pack',12,1050,false,false,false
  from sellertray_stock_transfer_fixture
  returning id
)
update sellertray_stock_transfer_fixture
set pack_uom_id=(select id from inserted_uom);

select public.record_sellertray_inventory_movement(
  tenant_id,source_branch_id,source_location_id,product_id,
  'opening',36,'Bottle',36,1,
  'opening_stock','TRANSFER-OPEN','opening:TRANSFER-OPEN',
  now(),owner_user_id,'Opening stock for transfer test','{}'::jsonb,null
)
from sellertray_stock_transfer_fixture;

select extensions.ok(
  not has_function_privilege(
    'authenticated','public.create_sellertray_stock_transfer(uuid,uuid,uuid,text,text,jsonb,uuid)','EXECUTE'
  )
  and not has_function_privilege(
    'authenticated','public.dispatch_sellertray_stock_transfer(uuid,uuid,uuid)','EXECUTE'
  )
  and not has_function_privilege(
    'authenticated','public.receive_sellertray_stock_transfer(uuid,uuid,uuid)','EXECUTE'
  )
  and not has_function_privilege(
    'authenticated','public.cancel_sellertray_stock_transfer(uuid,uuid,text,uuid)','EXECUTE'
  )
  and has_function_privilege(
    'service_role','public.dispatch_sellertray_stock_transfer(uuid,uuid,uuid)','EXECUTE'
  ),
  'stock transfer mutation commands remain server-only'
);

select extensions.ok(
  public.sellertray_user_has_capability(
    (select tenant_id from sellertray_stock_transfer_fixture),
    (select owner_user_id from sellertray_stock_transfer_fixture),
    'can_transfer_stock'
  ),
  'Owner has stock transfer authority by role'
);

select extensions.ok(
  public.sellertray_user_has_capability(
    (select tenant_id from sellertray_stock_transfer_fixture),
    (select manager_user_id from sellertray_stock_transfer_fixture),
    'can_transfer_stock'
  ),
  'Manager has stock transfer authority by default'
);

select extensions.ok(
  not public.sellertray_user_has_capability(
    (select tenant_id from sellertray_stock_transfer_fixture),
    (select staff_user_id from sellertray_stock_transfer_fixture),
    'can_transfer_stock'
  ),
  'Staff does not gain transfer authority from role alone'
);

select extensions.ok(
  public.set_sellertray_member_capability(
    (select tenant_id from sellertray_stock_transfer_fixture),
    (select staff_user_id from sellertray_stock_transfer_fixture),
    'can_transfer_stock',true,
    (select owner_user_id from sellertray_stock_transfer_fixture)
  ),
  'Owner can grant Staff stock transfer authority'
);

select extensions.ok(
  exists(
    select 1 from public.tenant_member_capability_events e
    where e.tenant_id=(select tenant_id from sellertray_stock_transfer_fixture)
      and e.user_id=(select staff_user_id from sellertray_stock_transfer_fixture)
      and e.capability='can_transfer_stock'
      and e.previous_allowed=false and e.new_allowed=true
  ),
  'stock transfer grant is written to immutable permission history'
);

do $$
begin
  begin
    perform public.create_sellertray_stock_transfer(
      (select tenant_id from sellertray_stock_transfer_fixture),
      (select source_branch_id from sellertray_stock_transfer_fixture),
      (select destination_branch_id from sellertray_stock_transfer_fixture),
      'TRANSFER-001','Replenish destination branch',
      jsonb_build_array(jsonb_build_object(
        'catalogItemId',(select product_id from sellertray_stock_transfer_fixture),
        'uomId',(select pack_uom_id from sellertray_stock_transfer_fixture),
        'quantity',2
      )),
      (select staff_user_id from sellertray_stock_transfer_fixture)
    );
  exception when sqlstate '42501' then
    update sellertray_stock_transfer_fixture set branch_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select branch_rejected from sellertray_stock_transfer_fixture),
  'transfer capability does not bypass destination branch isolation'
);

insert into public.branch_user_access(tenant_id,branch_id,user_id,can_operate)
select tenant_id,destination_branch_id,staff_user_id,true
from sellertray_stock_transfer_fixture;

update sellertray_stock_transfer_fixture
set create_result=public.create_sellertray_stock_transfer(
  tenant_id,source_branch_id,destination_branch_id,
  'TRANSFER-001','Replenish destination branch',
  jsonb_build_array(jsonb_build_object(
    'catalogItemId',product_id,'uomId',pack_uom_id,'quantity',2
  )),
  staff_user_id
);

update sellertray_stock_transfer_fixture
set transfer_id=(create_result->>'transferId')::uuid;

select extensions.is(
  (select create_result->>'status' from sellertray_stock_transfer_fixture),
  'draft','new stock transfer starts as a stock-neutral draft'
);

select extensions.ok(
  exists(
    select 1 from public.stock_transfer_items sti
    where sti.stock_transfer_id=(select transfer_id from sellertray_stock_transfer_fixture)
      and sti.selected_uom='Pack'
      and sti.transfer_quantity=2
      and sti.conversion_factor=12
      and sti.stock_quantity=24
      and sti.stock_uom='Bottle'
  ),
  'transfer line preserves selected UOM, conversion and Stock UOM quantity'
);

select extensions.is(
  (
    select coalesce(sum(im.quantity_delta),0)::numeric
    from public.inventory_movements im
    where im.tenant_id=(select tenant_id from sellertray_stock_transfer_fixture)
      and im.branch_id=(select source_branch_id from sellertray_stock_transfer_fixture)
      and im.catalog_item_id=(select product_id from sellertray_stock_transfer_fixture)
  ),
  36::numeric,'saving a draft transfer does not reduce source stock'
);

select extensions.is(
  (
    select coalesce(sum(im.quantity_delta),0)::numeric
    from public.inventory_movements im
    where im.tenant_id=(select tenant_id from sellertray_stock_transfer_fixture)
      and im.branch_id=(select destination_branch_id from sellertray_stock_transfer_fixture)
      and im.catalog_item_id=(select product_id from sellertray_stock_transfer_fixture)
  ),
  0::numeric,'saving a draft transfer does not increase destination stock'
);

update sellertray_stock_transfer_fixture
set replay_result=public.create_sellertray_stock_transfer(
  tenant_id,source_branch_id,destination_branch_id,
  'TRANSFER-001','Replenish destination branch',
  jsonb_build_array(jsonb_build_object(
    'catalogItemId',product_id,'uomId',pack_uom_id,'quantity',2
  )),
  staff_user_id
);

select extensions.is(
  (select replay_result->>'idempotentReplay' from sellertray_stock_transfer_fixture),
  'true','recreating the same transfer reference and facts is idempotent'
);

select extensions.is(
  (
    select count(*)::integer from public.stock_transfers st
    where st.tenant_id=(select tenant_id from sellertray_stock_transfer_fixture)
      and st.reference='TRANSFER-001'
  ),
  1,'create retry does not duplicate the transfer aggregate'
);

do $$
begin
  begin
    perform public.create_sellertray_stock_transfer(
      (select tenant_id from sellertray_stock_transfer_fixture),
      (select source_branch_id from sellertray_stock_transfer_fixture),
      (select destination_branch_id from sellertray_stock_transfer_fixture),
      'TRANSFER-001','Replenish destination branch',
      jsonb_build_array(jsonb_build_object(
        'catalogItemId',(select product_id from sellertray_stock_transfer_fixture),
        'uomId',(select pack_uom_id from sellertray_stock_transfer_fixture),
        'quantity',1
      )),
      (select staff_user_id from sellertray_stock_transfer_fixture)
    );
  exception when sqlstate '23505' then
    update sellertray_stock_transfer_fixture set conflict_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select conflict_rejected from sellertray_stock_transfer_fixture),
  'reusing a transfer reference with different facts is rejected'
);

update sellertray_stock_transfer_fixture
set dispatch_result=public.dispatch_sellertray_stock_transfer(
  tenant_id,transfer_id,staff_user_id
);

select extensions.is(
  (select dispatch_result->>'status' from sellertray_stock_transfer_fixture),
  'dispatched','dispatch commits the source-side transfer state'
);

select extensions.is(
  (
    select coalesce(sum(im.quantity_delta),0)::numeric
    from public.inventory_movements im
    where im.tenant_id=(select tenant_id from sellertray_stock_transfer_fixture)
      and im.branch_id=(select source_branch_id from sellertray_stock_transfer_fixture)
      and im.catalog_item_id=(select product_id from sellertray_stock_transfer_fixture)
  ),
  12::numeric,'dispatch reduces source branch stock exactly once'
);

select extensions.is(
  (
    select coalesce(sum(im.quantity_delta),0)::numeric
    from public.inventory_movements im
    where im.tenant_id=(select tenant_id from sellertray_stock_transfer_fixture)
      and im.branch_id=(select destination_branch_id from sellertray_stock_transfer_fixture)
      and im.catalog_item_id=(select product_id from sellertray_stock_transfer_fixture)
  ),
  0::numeric,'destination stock remains unchanged while transfer is in transit'
);

select extensions.ok(
  exists(
    select 1 from public.inventory_movements im
    where im.tenant_id=(select tenant_id from sellertray_stock_transfer_fixture)
      and im.reference_type='stock_transfer'
      and im.reference_id=(select transfer_id::text from sellertray_stock_transfer_fixture)
      and im.movement_type='transfer_out'
      and im.quantity_delta=-24
      and im.source_uom='Pack'
      and im.source_quantity=2
      and im.conversion_factor=12
  ),
  'dispatch writes an auditable transfer_out movement with UOM snapshot'
);

update sellertray_stock_transfer_fixture
set dispatch_result=public.dispatch_sellertray_stock_transfer(
  tenant_id,transfer_id,staff_user_id
);

select extensions.is(
  (select dispatch_result->>'idempotentReplay' from sellertray_stock_transfer_fixture),
  'true','dispatch retry is idempotent'
);

select extensions.is(
  (
    select count(*)::integer from public.inventory_movements im
    where im.tenant_id=(select tenant_id from sellertray_stock_transfer_fixture)
      and im.reference_type='stock_transfer'
      and im.reference_id=(select transfer_id::text from sellertray_stock_transfer_fixture)
      and im.movement_type='transfer_out'
  ),
  1,'dispatch retry does not duplicate source stock effect'
);

delete from public.branch_user_access
where tenant_id=(select tenant_id from sellertray_stock_transfer_fixture)
  and branch_id=(select destination_branch_id from sellertray_stock_transfer_fixture)
  and user_id=(select staff_user_id from sellertray_stock_transfer_fixture);

do $$
begin
  begin
    perform public.receive_sellertray_stock_transfer(
      (select tenant_id from sellertray_stock_transfer_fixture),
      (select transfer_id from sellertray_stock_transfer_fixture),
      (select staff_user_id from sellertray_stock_transfer_fixture)
    );
  exception when sqlstate '42501' then
    update sellertray_stock_transfer_fixture set receive_branch_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select receive_branch_rejected from sellertray_stock_transfer_fixture),
  'receipt requires current access to the destination branch'
);

insert into public.branch_user_access(tenant_id,branch_id,user_id,can_operate)
select tenant_id,destination_branch_id,staff_user_id,true
from sellertray_stock_transfer_fixture;

update sellertray_stock_transfer_fixture
set receive_result=public.receive_sellertray_stock_transfer(
  tenant_id,transfer_id,staff_user_id
);

select extensions.is(
  (select receive_result->>'status' from sellertray_stock_transfer_fixture),
  'received','destination receipt commits the transfer as received'
);

select extensions.is(
  (
    select coalesce(sum(im.quantity_delta),0)::numeric
    from public.inventory_movements im
    where im.tenant_id=(select tenant_id from sellertray_stock_transfer_fixture)
      and im.branch_id=(select destination_branch_id from sellertray_stock_transfer_fixture)
      and im.catalog_item_id=(select product_id from sellertray_stock_transfer_fixture)
  ),
  24::numeric,'receipt increases destination stock using the dispatched quantity'
);

select extensions.is(
  (
    select coalesce(sum(im.quantity_delta),0)::numeric
    from public.inventory_movements im
    where im.tenant_id=(select tenant_id from sellertray_stock_transfer_fixture)
      and im.branch_id=(select source_branch_id from sellertray_stock_transfer_fixture)
      and im.catalog_item_id=(select product_id from sellertray_stock_transfer_fixture)
  ),
  12::numeric,'receipt does not alter the already-dispatched source balance'
);

select extensions.ok(
  exists(
    select 1 from public.inventory_movements im
    where im.tenant_id=(select tenant_id from sellertray_stock_transfer_fixture)
      and im.reference_type='stock_transfer'
      and im.reference_id=(select transfer_id::text from sellertray_stock_transfer_fixture)
      and im.movement_type='transfer_in'
      and im.quantity_delta=24
      and im.source_uom='Pack'
      and im.source_quantity=2
      and im.conversion_factor=12
  ),
  'receipt writes an auditable transfer_in movement from the original UOM snapshot'
);

update sellertray_stock_transfer_fixture
set receive_result=public.receive_sellertray_stock_transfer(
  tenant_id,transfer_id,staff_user_id
);

select extensions.is(
  (select receive_result->>'idempotentReplay' from sellertray_stock_transfer_fixture),
  'true','receipt retry is idempotent'
);

select extensions.is(
  (
    select count(*)::integer from public.inventory_movements im
    where im.tenant_id=(select tenant_id from sellertray_stock_transfer_fixture)
      and im.reference_type='stock_transfer'
      and im.reference_id=(select transfer_id::text from sellertray_stock_transfer_fixture)
      and im.movement_type='transfer_in'
  ),
  1,'receipt retry does not duplicate destination stock effect'
);

do $$
begin
  begin
    perform public.cancel_sellertray_stock_transfer(
      (select tenant_id from sellertray_stock_transfer_fixture),
      (select transfer_id from sellertray_stock_transfer_fixture),
      'Cannot cancel received transfer',
      (select staff_user_id from sellertray_stock_transfer_fixture)
    );
  exception when sqlstate '23514' then
    update sellertray_stock_transfer_fixture set received_cancel_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select received_cancel_rejected from sellertray_stock_transfer_fixture),
  'received stock cannot be cancelled out of history'
);

update sellertray_stock_transfer_fixture
set create_result=public.create_sellertray_stock_transfer(
  tenant_id,source_branch_id,destination_branch_id,
  'TRANSFER-CANCEL','Draft cancellation test',
  jsonb_build_array(jsonb_build_object(
    'catalogItemId',product_id,'uomId',stock_uom_id,'quantity',1
  )),staff_user_id
);
update sellertray_stock_transfer_fixture
set cancel_transfer_id=(create_result->>'transferId')::uuid;

select extensions.is(
  (
    select public.cancel_sellertray_stock_transfer(
      tenant_id,cancel_transfer_id,'No longer required',staff_user_id
    )->>'status'
    from sellertray_stock_transfer_fixture
  ),
  'cancelled','draft transfer can be cancelled before any stock effect'
);

select extensions.is(
  (
    select count(*)::integer from public.inventory_movements im
    where im.tenant_id=(select tenant_id from sellertray_stock_transfer_fixture)
      and im.reference_type='stock_transfer'
      and im.reference_id=(select cancel_transfer_id::text from sellertray_stock_transfer_fixture)
  ),
  0,'cancelled draft transfer creates no stock movement'
);

update sellertray_stock_transfer_fixture
set create_result=public.create_sellertray_stock_transfer(
  tenant_id,source_branch_id,destination_branch_id,
  'TRANSFER-INSUFFICIENT','Insufficient stock test',
  jsonb_build_array(jsonb_build_object(
    'catalogItemId',product_id,'uomId',pack_uom_id,'quantity',2
  )),staff_user_id
);
update sellertray_stock_transfer_fixture
set insufficient_transfer_id=(create_result->>'transferId')::uuid;

do $$
begin
  begin
    perform public.dispatch_sellertray_stock_transfer(
      (select tenant_id from sellertray_stock_transfer_fixture),
      (select insufficient_transfer_id from sellertray_stock_transfer_fixture),
      (select staff_user_id from sellertray_stock_transfer_fixture)
    );
  exception when sqlstate '23514' then
    update sellertray_stock_transfer_fixture set insufficient_dispatch_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select insufficient_dispatch_rejected from sellertray_stock_transfer_fixture),
  'dispatch fails closed when source stock is insufficient'
);

select extensions.is(
  (
    select status from public.stock_transfers
    where id=(select insufficient_transfer_id from sellertray_stock_transfer_fixture)
  ),
  'draft','failed dispatch leaves transfer in stock-neutral draft state'
);

select extensions.is(
  (
    select count(*)::integer from public.inventory_movements im
    where im.tenant_id=(select tenant_id from sellertray_stock_transfer_fixture)
      and im.reference_type='stock_transfer'
      and im.reference_id=(select insufficient_transfer_id::text from sellertray_stock_transfer_fixture)
  ),
  0,'failed dispatch rolls back all transfer stock effects'
);

do $$
begin
  begin
    perform public.create_sellertray_stock_transfer(
      (select tenant_id from sellertray_stock_transfer_fixture),
      (select source_branch_id from sellertray_stock_transfer_fixture),
      (select destination_branch_id from sellertray_stock_transfer_fixture),
      'TRANSFER-FRACTION','Fractional test',
      jsonb_build_array(jsonb_build_object(
        'catalogItemId',(select product_id from sellertray_stock_transfer_fixture),
        'uomId',(select pack_uom_id from sellertray_stock_transfer_fixture),
        'quantity',0.5
      )),(select staff_user_id from sellertray_stock_transfer_fixture)
    );
  exception when sqlstate '23514' then
    update sellertray_stock_transfer_fixture set fractional_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select fractional_rejected from sellertray_stock_transfer_fixture),
  'transfer creation respects configured fractional UOM policy'
);

do $$
begin
  begin
    perform public.create_sellertray_stock_transfer(
      (select tenant_id from sellertray_stock_transfer_fixture),
      (select source_branch_id from sellertray_stock_transfer_fixture),
      (select destination_branch_id from sellertray_stock_transfer_fixture),
      'TRANSFER-DUPLICATE','Duplicate product test',
      jsonb_build_array(
        jsonb_build_object(
          'catalogItemId',(select product_id from sellertray_stock_transfer_fixture),
          'uomId',(select stock_uom_id from sellertray_stock_transfer_fixture),
          'quantity',1
        ),
        jsonb_build_object(
          'catalogItemId',(select product_id from sellertray_stock_transfer_fixture),
          'uomId',(select pack_uom_id from sellertray_stock_transfer_fixture),
          'quantity',1
        )
      ),(select staff_user_id from sellertray_stock_transfer_fixture)
    );
  exception when sqlstate '23514' then
    update sellertray_stock_transfer_fixture set duplicate_product_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select duplicate_product_rejected from sellertray_stock_transfer_fixture),
  'a product can appear only once in a stock transfer'
);

do $$
begin
  begin
    perform public.create_sellertray_stock_transfer(
      (select tenant_id from sellertray_stock_transfer_fixture),
      (select source_branch_id from sellertray_stock_transfer_fixture),
      (select source_branch_id from sellertray_stock_transfer_fixture),
      'TRANSFER-SAME-BRANCH','Invalid same-branch transfer',
      jsonb_build_array(jsonb_build_object(
        'catalogItemId',(select product_id from sellertray_stock_transfer_fixture),
        'uomId',(select stock_uom_id from sellertray_stock_transfer_fixture),
        'quantity',1
      )),(select staff_user_id from sellertray_stock_transfer_fixture)
    );
  exception when sqlstate '22023' then
    update sellertray_stock_transfer_fixture set same_branch_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select same_branch_rejected from sellertray_stock_transfer_fixture),
  'source and destination branches must be different'
);

select set_config(
  'request.jwt.claim.sub',
  (select staff_user_id::text from sellertray_stock_transfer_fixture),
  true
);
select set_config('request.jwt.claim.role','authenticated',true);

select extensions.ok(
  (
    select public.get_sellertray_stock_transfer(
      tenant_id,transfer_id
    )->>'status'='received'
    from sellertray_stock_transfer_fixture
  ),
  'authorized branch user can read received transfer detail'
);

select extensions.ok(
  exists(
    select 1
    from public.get_sellertray_stock_transfers(
      (select tenant_id from sellertray_stock_transfer_fixture),
      (select source_branch_id from sellertray_stock_transfer_fixture),
      50
    ) t
    where t.id=(select transfer_id from sellertray_stock_transfer_fixture)
      and t.status='received'
  ),
  'authorized branch transfer list includes the shared transfer history'
);

select extensions.ok(
  (
    select c.can_transfer_stock
    from public.get_sellertray_inventory_capabilities(
      (select tenant_id from sellertray_stock_transfer_fixture),
      (select source_branch_id from sellertray_stock_transfer_fixture)
    ) c
  ),
  'mobile capability projection exposes granted stock transfer authority'
);

select extensions.ok(
  (
    select c.can_transfer_stock
    from public.get_sellertray_inventory_capabilities(
      (select tenant_id from sellertray_stock_transfer_fixture),
      (select destination_branch_id from sellertray_stock_transfer_fixture)
    ) c
  ),
  'transfer authority is usable only where Staff also has branch access'
);

select * from extensions.finish();
rollback;