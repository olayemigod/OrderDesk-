begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(44);

create temp table sellertray_stock_count_fixture (
  tenant_id uuid not null,
  owner_user_id uuid not null,
  manager_user_id uuid not null,
  staff_user_id uuid not null,
  product_one_id uuid not null,
  product_two_id uuid not null,
  branch_id uuid,
  branch_two_id uuid,
  location_id uuid,
  pack_uom_id uuid,
  product_one_stock_uom_id uuid,
  product_two_stock_uom_id uuid,
  count_id uuid,
  second_count_id uuid,
  third_count_id uuid,
  start_result jsonb,
  replay_result jsonb,
  capture_result jsonb,
  review_result jsonb,
  apply_result jsonb,
  apply_replay jsonb,
  count_detail jsonb,
  review_detail jsonb,
  active_count_rejected boolean not null default false,
  incomplete_submit_rejected boolean not null default false,
  staff_apply_rejected boolean not null default false,
  underflow_apply_rejected boolean not null default false,
  fractional_rejected boolean not null default false,
  cross_branch_rejected boolean not null default false
) on commit drop;

insert into sellertray_stock_count_fixture(
  tenant_id,owner_user_id,manager_user_id,staff_user_id,
  product_one_id,product_two_id
)
values(
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
  gen_random_uuid(),gen_random_uuid()
);

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_user_id,
  'count-owner-'||substr(owner_user_id::text,1,8)||'@example.com',
  'authenticated','authenticated',now(),now()
from sellertray_stock_count_fixture
union all
select manager_user_id,
  'count-manager-'||substr(manager_user_id::text,1,8)||'@example.com',
  'authenticated','authenticated',now(),now()
from sellertray_stock_count_fixture
union all
select staff_user_id,
  'count-staff-'||substr(staff_user_id::text,1,8)||'@example.com',
  'authenticated','authenticated',now(),now()
from sellertray_stock_count_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'SellerTray Stock Count Test',
  'sellertray-stock-count-'||substr(tenant_id::text,1,8),'SCT','active'
from sellertray_stock_count_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from sellertray_stock_count_fixture);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner' from sellertray_stock_count_fixture
union all
select tenant_id,manager_user_id,'manager' from sellertray_stock_count_fixture
union all
select tenant_id,staff_user_id,'staff' from sellertray_stock_count_fixture;

update sellertray_stock_count_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

insert into public.branches(tenant_id,code,name,is_default,is_active)
select tenant_id,'COUNT2','Count Branch Two',false,true
from sellertray_stock_count_fixture;

update sellertray_stock_count_fixture f
set branch_two_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.code='COUNT2';

update sellertray_stock_count_fixture f
set location_id=sl.id
from public.stock_locations sl
where sl.tenant_id=f.tenant_id
  and sl.branch_id=f.branch_id
  and sl.is_default=true;

insert into public.branch_user_access(tenant_id,branch_id,user_id,can_operate)
select tenant_id,branch_id,staff_user_id,true
from sellertray_stock_count_fixture;

insert into public.catalog_items(
  id,tenant_id,name,sku,price_ngn,is_active,stock_uom,allow_fractional_stock
)
select product_one_id,tenant_id,'Count Drink','COUNT-DRINK',100,true,'Bottle',false
from sellertray_stock_count_fixture
union all
select product_two_id,tenant_id,'Count Snack','COUNT-SNACK',50,true,'Each',false
from sellertray_stock_count_fixture;

update sellertray_stock_count_fixture f
set product_one_stock_uom_id=u.id
from public.catalog_item_uoms u
where u.tenant_id=f.tenant_id
  and u.catalog_item_id=f.product_one_id
  and lower(u.uom_name)='bottle';

update sellertray_stock_count_fixture f
set product_two_stock_uom_id=u.id
from public.catalog_item_uoms u
where u.tenant_id=f.tenant_id
  and u.catalog_item_id=f.product_two_id
  and lower(u.uom_name)='each';

with inserted_uom as (
  insert into public.catalog_item_uoms(
    tenant_id,catalog_item_id,uom_name,conversion_factor,selling_price,
    allow_fractional,is_default_selling,is_default_purchase
  )
  select tenant_id,product_one_id,'Pack',12,1050,false,false,false
  from sellertray_stock_count_fixture
  returning id
)
update sellertray_stock_count_fixture
set pack_uom_id=(select id from inserted_uom);

select public.record_sellertray_inventory_movement(
  tenant_id,branch_id,location_id,product_one_id,
  'opening',48,'Bottle',48,1,
  'opening_stock','COUNT-P1-OPEN','opening:COUNT-P1-OPEN',
  now(),owner_user_id,'Opening count stock','{}'::jsonb,null
)
from sellertray_stock_count_fixture;

select public.record_sellertray_inventory_movement(
  tenant_id,branch_id,location_id,product_two_id,
  'opening',5,'Each',5,1,
  'opening_stock','COUNT-P2-OPEN','opening:COUNT-P2-OPEN',
  now(),owner_user_id,'Opening count stock','{}'::jsonb,null
)
from sellertray_stock_count_fixture;

select extensions.ok(
  not has_function_privilege(
    'authenticated','public.start_sellertray_stock_count(uuid,uuid,text,text,uuid)','EXECUTE'
  )
  and not has_function_privilege(
    'authenticated','public.capture_sellertray_stock_count_item(uuid,uuid,uuid,uuid,numeric,uuid)','EXECUTE'
  )
  and not has_function_privilege(
    'authenticated','public.submit_sellertray_stock_count(uuid,uuid,uuid)','EXECUTE'
  )
  and not has_function_privilege(
    'authenticated','public.apply_sellertray_stock_count(uuid,uuid,uuid)','EXECUTE'
  )
  and not has_function_privilege(
    'authenticated','public.cancel_sellertray_stock_count(uuid,uuid,text,uuid)','EXECUTE'
  )
  and has_function_privilege(
    'service_role','public.apply_sellertray_stock_count(uuid,uuid,uuid)','EXECUTE'
  ),
  'stock count mutation commands remain server-only'
);

select extensions.ok(
  public.sellertray_user_has_capability(
    (select tenant_id from sellertray_stock_count_fixture),
    (select owner_user_id from sellertray_stock_count_fixture),
    'can_count_stock'
  ),
  'Owner has stock count authority by role'
);

select extensions.ok(
  public.sellertray_user_has_capability(
    (select tenant_id from sellertray_stock_count_fixture),
    (select manager_user_id from sellertray_stock_count_fixture),
    'can_apply_stock_count'
  ),
  'Manager has stock count apply authority by default'
);

select extensions.ok(
  not public.sellertray_user_has_capability(
    (select tenant_id from sellertray_stock_count_fixture),
    (select staff_user_id from sellertray_stock_count_fixture),
    'can_count_stock'
  ),
  'Staff does not gain stock count authority from role alone'
);

select extensions.ok(
  not public.sellertray_user_has_capability(
    (select tenant_id from sellertray_stock_count_fixture),
    (select staff_user_id from sellertray_stock_count_fixture),
    'can_apply_stock_count'
  ),
  'Staff does not gain count apply authority from role alone'
);

select extensions.ok(
  public.set_sellertray_member_capability(
    (select tenant_id from sellertray_stock_count_fixture),
    (select staff_user_id from sellertray_stock_count_fixture),
    'can_count_stock',true,
    (select owner_user_id from sellertray_stock_count_fixture)
  ),
  'Owner can grant Staff stock count authority'
);

select extensions.ok(
  public.sellertray_user_has_capability(
    (select tenant_id from sellertray_stock_count_fixture),
    (select staff_user_id from sellertray_stock_count_fixture),
    'can_count_stock'
  ),
  'Staff stock count grant is effective'
);

update sellertray_stock_count_fixture
set start_result=public.start_sellertray_stock_count(
  tenant_id,branch_id,'COUNT-001','Month-end physical count',staff_user_id
);

update sellertray_stock_count_fixture
set count_id=(start_result->>'countId')::uuid;

select extensions.is(
  (select start_result->>'status' from sellertray_stock_count_fixture),
  'counting','stock count starts in counting state'
);

select extensions.is(
  (select (start_result->>'totalItems')::integer from sellertray_stock_count_fixture),
  2,'stock count snapshots the full active product roster'
);

update sellertray_stock_count_fixture
set replay_result=public.start_sellertray_stock_count(
  tenant_id,branch_id,'COUNT-001','Month-end physical count',staff_user_id
);

select extensions.is(
  (select replay_result->>'idempotentReplay' from sellertray_stock_count_fixture),
  'true','restarting the same stock count reference is idempotent'
);

select extensions.is(
  (
    select count(*)::integer from public.stock_counts sc
    where sc.tenant_id=(select tenant_id from sellertray_stock_count_fixture)
      and sc.reference='COUNT-001'
  ),
  1,'stock count start retry does not duplicate the session'
);

do $$
begin
  begin
    perform public.start_sellertray_stock_count(
      (select tenant_id from sellertray_stock_count_fixture),
      (select branch_id from sellertray_stock_count_fixture),
      'COUNT-ACTIVE','Overlapping count should fail',
      (select staff_user_id from sellertray_stock_count_fixture)
    );
  exception when sqlstate '23514' then
    update sellertray_stock_count_fixture set active_count_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select active_count_rejected from sellertray_stock_count_fixture),
  'a stock location cannot have overlapping active counts'
);

update sellertray_stock_count_fixture
set capture_result=public.capture_sellertray_stock_count_item(
  tenant_id,count_id,product_one_id,pack_uom_id,3,staff_user_id
);

select extensions.is(
  (select (capture_result->>'countedStockQuantity')::numeric from sellertray_stock_count_fixture),
  36::numeric,'three Packs normalize to thirty-six Bottles for counting'
);

select extensions.ok(
  exists(
    select 1 from public.stock_count_items sci
    where sci.tenant_id=(select tenant_id from sellertray_stock_count_fixture)
      and sci.stock_count_id=(select count_id from sellertray_stock_count_fixture)
      and sci.catalog_item_id=(select product_one_id from sellertray_stock_count_fixture)
      and sci.selected_uom='Pack'
      and sci.counted_quantity=3
      and sci.conversion_factor=12
      and sci.expected_stock_quantity=48
      and sci.counted_stock_quantity=36
      and sci.variance_quantity=-12
  ),
  'capture snapshots expected stock, counted Stock UOM and variance'
);

select set_config(
  'request.jwt.claim.sub',
  (select staff_user_id::text from sellertray_stock_count_fixture),
  true
);
select set_config('request.jwt.claim.role','authenticated',true);

update sellertray_stock_count_fixture
set count_detail=public.get_sellertray_stock_count(tenant_id,count_id);

select extensions.ok(
  (
    select (item->>'expectedStockQuantity') is null
      and (item->>'varianceQuantity') is null
    from sellertray_stock_count_fixture f,
         lateral jsonb_array_elements(f.count_detail->'items') item
    where item->>'productId'=f.product_one_id::text
  ),
  'counting view keeps expected stock and variance blind during capture'
);

do $$
begin
  begin
    perform public.submit_sellertray_stock_count(
      (select tenant_id from sellertray_stock_count_fixture),
      (select count_id from sellertray_stock_count_fixture),
      (select staff_user_id from sellertray_stock_count_fixture)
    );
  exception when sqlstate '23514' then
    update sellertray_stock_count_fixture set incomplete_submit_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select incomplete_submit_rejected from sellertray_stock_count_fixture),
  'stock count cannot enter review until every product is counted'
);

update sellertray_stock_count_fixture
set capture_result=public.capture_sellertray_stock_count_item(
  tenant_id,count_id,product_two_id,product_two_stock_uom_id,0,staff_user_id
);

select extensions.is(
  (select (capture_result->>'countedStockQuantity')::numeric from sellertray_stock_count_fixture),
  0::numeric,'zero physical count is captured explicitly rather than treated as missing'
);

update sellertray_stock_count_fixture
set review_result=public.submit_sellertray_stock_count(
  tenant_id,count_id,staff_user_id
);

select extensions.is(
  (select review_result->>'status' from sellertray_stock_count_fixture),
  'review','complete count moves to variance review without changing stock'
);

update sellertray_stock_count_fixture
set review_detail=public.get_sellertray_stock_count(tenant_id,count_id);

select extensions.ok(
  (
    select (item->>'expectedStockQuantity')::numeric=48
      and (item->>'countedStockQuantity')::numeric=36
      and (item->>'varianceQuantity')::numeric=-12
    from sellertray_stock_count_fixture f,
         lateral jsonb_array_elements(f.review_detail->'items') item
    where item->>'productId'=f.product_one_id::text
  ),
  'review view reveals expected, counted and variance facts'
);

do $$
begin
  begin
    perform public.apply_sellertray_stock_count(
      (select tenant_id from sellertray_stock_count_fixture),
      (select count_id from sellertray_stock_count_fixture),
      (select staff_user_id from sellertray_stock_count_fixture)
    );
  exception when sqlstate '42501' then
    update sellertray_stock_count_fixture set staff_apply_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select staff_apply_rejected from sellertray_stock_count_fixture),
  'count capture permission does not grant variance apply authority'
);

select extensions.ok(
  public.set_sellertray_member_capability(
    (select tenant_id from sellertray_stock_count_fixture),
    (select staff_user_id from sellertray_stock_count_fixture),
    'can_apply_stock_count',true,
    (select manager_user_id from sellertray_stock_count_fixture)
  ),
  'Manager can grant Staff stock count apply authority'
);

select extensions.ok(
  public.sellertray_user_has_capability(
    (select tenant_id from sellertray_stock_count_fixture),
    (select staff_user_id from sellertray_stock_count_fixture),
    'can_apply_stock_count'
  ),
  'Staff count apply grant is effective'
);

select public.record_sellertray_inventory_movement(
  tenant_id,branch_id,location_id,product_one_id,
  'adjustment',-6,'Bottle',6,1,
  'test_after_count','COUNT-P1-LATER','count:test:p1:later',
  now(),owner_user_id,'Movement after physical capture','{}'::jsonb,null
)
from sellertray_stock_count_fixture;

update sellertray_stock_count_fixture
set apply_result=public.apply_sellertray_stock_count(
  tenant_id,count_id,staff_user_id
);

select extensions.is(
  (select apply_result->>'status' from sellertray_stock_count_fixture),
  'applied','authorized review applies through the stock count command'
);

select extensions.is(
  (select (apply_result->>'inventoryMovementCount')::integer from sellertray_stock_count_fixture),
  2,'apply posts one reconciliation movement for each non-zero variance'
);

select extensions.is(
  (
    select s.quantity_on_hand
    from public.get_sellertray_branch_stock(
      (select tenant_id from sellertray_stock_count_fixture),
      (select branch_id from sellertray_stock_count_fixture)
    ) s
    where s.catalog_item_id=(select product_one_id from sellertray_stock_count_fixture)
  ),
  30::numeric,'variance apply preserves movements that occurred after physical capture'
);

select extensions.is(
  (
    select s.quantity_on_hand
    from public.get_sellertray_branch_stock(
      (select tenant_id from sellertray_stock_count_fixture),
      (select branch_id from sellertray_stock_count_fixture)
    ) s
    where s.catalog_item_id=(select product_two_id from sellertray_stock_count_fixture)
  ),
  0::numeric,'zero physical count reconciles the second product through a ledger movement'
);

select extensions.is(
  (
    select count(*)::integer from public.inventory_movements im
    where im.tenant_id=(select tenant_id from sellertray_stock_count_fixture)
      and im.reference_type='stock_count'
      and im.reference_id=(select count_id::text from sellertray_stock_count_fixture)
      and im.movement_type='count_reconciliation'
  ),
  2,'stock count apply writes only immutable count reconciliation movements'
);

select extensions.ok(
  exists(
    select 1 from public.inventory_movements im
    where im.tenant_id=(select tenant_id from sellertray_stock_count_fixture)
      and im.reference_type='stock_count'
      and im.reference_id=(select count_id::text from sellertray_stock_count_fixture)
      and im.catalog_item_id=(select product_one_id from sellertray_stock_count_fixture)
      and im.quantity_delta=-12
      and (im.metadata->>'expected_at_capture')::numeric=48
      and (im.metadata->>'counted_stock_quantity')::numeric=36
      and (im.metadata->>'variance_quantity')::numeric=-12
  ),
  'reconciliation movement preserves the reviewed count evidence'
);

update sellertray_stock_count_fixture
set apply_replay=public.apply_sellertray_stock_count(
  tenant_id,count_id,staff_user_id
);

select extensions.is(
  (select apply_replay->>'idempotentReplay' from sellertray_stock_count_fixture),
  'true','stock count apply retry is idempotent'
);

select extensions.is(
  (
    select count(*)::integer from public.inventory_movements im
    where im.tenant_id=(select tenant_id from sellertray_stock_count_fixture)
      and im.reference_type='stock_count'
      and im.reference_id=(select count_id::text from sellertray_stock_count_fixture)
  ),
  2,'apply retry does not duplicate count reconciliation movements'
);

select extensions.is(
  (
    select sc.status from public.stock_counts sc
    where sc.id=(select count_id from sellertray_stock_count_fixture)
  ),
  'applied','applied stock count retains its governed terminal state'
);

select public.record_sellertray_inventory_movement(
  tenant_id,branch_id,location_id,product_two_id,
  'purchase_receipt',5,'Each',5,1,
  'test_receipt','COUNT-P2-RESTOCK','count:test:p2:restock',
  now(),owner_user_id,'Restock before underflow scenario','{}'::jsonb,null
)
from sellertray_stock_count_fixture;

update sellertray_stock_count_fixture
set start_result=public.start_sellertray_stock_count(
  tenant_id,branch_id,'COUNT-002','Underflow review test',staff_user_id
);
update sellertray_stock_count_fixture
set second_count_id=(start_result->>'countId')::uuid;

select extensions.is(
  (select start_result->>'status' from sellertray_stock_count_fixture),
  'counting','a new stock count can start after the prior count is applied'
);

select public.capture_sellertray_stock_count_item(
  tenant_id,second_count_id,product_one_id,product_one_stock_uom_id,30,staff_user_id
)
from sellertray_stock_count_fixture;
select public.capture_sellertray_stock_count_item(
  tenant_id,second_count_id,product_two_id,product_two_stock_uom_id,0,staff_user_id
)
from sellertray_stock_count_fixture;

select extensions.ok(
  exists(
    select 1 from public.stock_count_items sci
    where sci.stock_count_id=(select second_count_id from sellertray_stock_count_fixture)
      and sci.catalog_item_id=(select product_two_id from sellertray_stock_count_fixture)
      and sci.expected_stock_quantity=5
      and sci.counted_stock_quantity=0
      and sci.variance_quantity=-5
  ),
  'second count snapshots the five-unit negative variance before later movement'
);

select public.submit_sellertray_stock_count(
  tenant_id,second_count_id,staff_user_id
)
from sellertray_stock_count_fixture;

select public.record_sellertray_inventory_movement(
  tenant_id,branch_id,location_id,product_two_id,
  'adjustment',-5,'Each',5,1,
  'test_after_count','COUNT-P2-LATER','count:test:p2:later',
  now(),owner_user_id,'Movement after second physical capture','{}'::jsonb,null
)
from sellertray_stock_count_fixture;

do $$
begin
  begin
    perform public.apply_sellertray_stock_count(
      (select tenant_id from sellertray_stock_count_fixture),
      (select second_count_id from sellertray_stock_count_fixture),
      (select staff_user_id from sellertray_stock_count_fixture)
    );
  exception when sqlstate '23514' then
    update sellertray_stock_count_fixture set underflow_apply_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select underflow_apply_rejected from sellertray_stock_count_fixture),
  'count apply fails closed when later stock movement makes a negative variance unsafe'
);

select extensions.is(
  (
    select count(*)::integer from public.inventory_movements im
    where im.tenant_id=(select tenant_id from sellertray_stock_count_fixture)
      and im.reference_type='stock_count'
      and im.reference_id=(select second_count_id::text from sellertray_stock_count_fixture)
  ),
  0,'failed count apply rolls back all reconciliation movements'
);

select extensions.is(
  (
    select public.cancel_sellertray_stock_count(
      tenant_id,second_count_id,'Recount required after later stock movement',staff_user_id
    )->>'status'
    from sellertray_stock_count_fixture
  ),
  'cancelled','authorized reviewer can cancel a review count without stock effect'
);

update sellertray_stock_count_fixture
set start_result=public.start_sellertray_stock_count(
  tenant_id,branch_id,'COUNT-003','Fractional capture test',staff_user_id
);
update sellertray_stock_count_fixture
set third_count_id=(start_result->>'countId')::uuid;

select extensions.is(
  (select start_result->>'status' from sellertray_stock_count_fixture),
  'counting','a new count can start after the previous review is cancelled'
);

do $$
begin
  begin
    perform public.capture_sellertray_stock_count_item(
      (select tenant_id from sellertray_stock_count_fixture),
      (select third_count_id from sellertray_stock_count_fixture),
      (select product_one_id from sellertray_stock_count_fixture),
      (select pack_uom_id from sellertray_stock_count_fixture),
      0.5,
      (select staff_user_id from sellertray_stock_count_fixture)
    );
  exception when sqlstate '23514' then
    update sellertray_stock_count_fixture set fractional_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select fractional_rejected from sellertray_stock_count_fixture),
  'stock count capture respects configured fractional UOM policy'
);

select extensions.is(
  (
    select public.cancel_sellertray_stock_count(
      tenant_id,third_count_id,'Test count cancelled',staff_user_id
    )->>'status'
    from sellertray_stock_count_fixture
  ),
  'cancelled','counting session can be cancelled before review with an explicit reason'
);

do $$
begin
  begin
    perform public.start_sellertray_stock_count(
      (select tenant_id from sellertray_stock_count_fixture),
      (select branch_two_id from sellertray_stock_count_fixture),
      'COUNT-BRANCH2','Unauthorized branch count',
      (select staff_user_id from sellertray_stock_count_fixture)
    );
  exception when sqlstate '42501' then
    update sellertray_stock_count_fixture set cross_branch_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select cross_branch_rejected from sellertray_stock_count_fixture),
  'stock count capability does not bypass Staff branch isolation'
);

select extensions.ok(
  (
    select c.can_count_stock and c.can_apply_stock_count
    from public.get_sellertray_inventory_capabilities(
      (select tenant_id from sellertray_stock_count_fixture),
      (select branch_id from sellertray_stock_count_fixture)
    ) c
  ),
  'mobile capability read exposes Staff count and apply authority on the assigned branch'
);

select extensions.ok(
  (
    select not c.can_count_stock and not c.can_apply_stock_count
    from public.get_sellertray_inventory_capabilities(
      (select tenant_id from sellertray_stock_count_fixture),
      (select branch_two_id from sellertray_stock_count_fixture)
    ) c
  ),
  'mobile capability read fails closed for stock count authority on an inaccessible branch'
);

select extensions.ok(
  exists(
    select 1 from public.tenant_member_capability_events e
    where e.tenant_id=(select tenant_id from sellertray_stock_count_fixture)
      and e.user_id=(select staff_user_id from sellertray_stock_count_fixture)
      and e.capability='can_count_stock'
      and e.previous_allowed=false
      and e.new_allowed=true
  ),
  'stock count grant is written to immutable permission history'
);

select extensions.ok(
  exists(
    select 1 from public.tenant_member_capability_events e
    where e.tenant_id=(select tenant_id from sellertray_stock_count_fixture)
      and e.user_id=(select staff_user_id from sellertray_stock_count_fixture)
      and e.capability='can_apply_stock_count'
      and e.previous_allowed=false
      and e.new_allowed=true
  ),
  'stock count apply grant is written to immutable permission history'
);

select * from extensions.finish();
rollback;