begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(8);

select extensions.ok(
  to_regprocedure('public.apply_sellertray_opening_inventory(uuid,uuid,uuid,numeric,numeric,text,text,uuid,uuid)') is not null,
  'governed opening-inventory cost authority exists'
);

select extensions.ok(
  has_function_privilege('service_role','public.apply_sellertray_opening_inventory(uuid,uuid,uuid,numeric,numeric,text,text,uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.apply_sellertray_opening_inventory(uuid,uuid,uuid,numeric,numeric,text,text,uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.apply_sellertray_opening_inventory(uuid,uuid,uuid,numeric,numeric,text,text,uuid,uuid)','EXECUTE'),
  'opening inventory is service-only and cannot be called directly by browser clients'
);

create temp table sellertray_opening_fixture(
  tenant_id uuid not null,
  user_id uuid not null,
  product_id uuid not null,
  branch_id uuid,
  location_id uuid,
  cost_command_id uuid not null,
  result jsonb,
  retry_result jsonb,
  sale_id uuid,
  second_opening_rejected boolean not null default false
) on commit drop;

insert into sellertray_opening_fixture(tenant_id,user_id,product_id,cost_command_id)
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,aud,role,email,created_at,updated_at)
select user_id,'authenticated','authenticated','opening-'||substr(user_id::text,1,8)||'@example.test',now(),now()
from sellertray_opening_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'SellerTray Opening Inventory Test','sellertray-opening-'||substr(tenant_id::text,1,8),'OPN','active'
from sellertray_opening_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from sellertray_opening_fixture);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,user_id,'owner' from sellertray_opening_fixture;

update sellertray_opening_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

update sellertray_opening_fixture f
set location_id=sl.id
from public.stock_locations sl
where sl.tenant_id=f.tenant_id and sl.branch_id=f.branch_id and sl.is_default=true;

insert into public.catalog_items(
  id,tenant_id,name,sku,price_ngn,is_active,stock_uom,allow_fractional_stock
)
select product_id,tenant_id,'Opening Inventory Product','OPENING-PROD',150,true,'Each',false
from sellertray_opening_fixture;

update sellertray_opening_fixture
set result=public.apply_sellertray_opening_inventory(
  tenant_id,
  branch_id,
  product_id,
  10,
  50,
  'OPENING-001',
  'invop:receive:mvctm680:openingtest1',
  cost_command_id,
  user_id
);

select extensions.ok(
  exists(
    select 1
    from public.inventory_movements m
    join sellertray_opening_fixture f on m.id=(f.result->>'movementId')::uuid
    where m.tenant_id=f.tenant_id
      and m.branch_id=f.branch_id
      and m.stock_location_id=f.location_id
      and m.catalog_item_id=f.product_id
      and m.movement_type='opening'
      and m.quantity_delta=10
      and m.source_quantity=10
      and m.conversion_factor=1
      and m.stock_uom='Each'
      and m.business_at='2026-10-17 20:00:00+00'::timestamptz
  ),
  'opening command creates the native opening movement in Stock UOM at authoritative business time'
);

select extensions.ok(
  exists(
    select 1
    from public.sellertray_inventory_cost_basis_evidence e
    join sellertray_opening_fixture f on e.id=(f.result->>'costEvidenceId')::uuid
    where e.tenant_id=f.tenant_id
      and e.inventory_movement_id=(f.result->>'movementId')::uuid
      and e.catalog_item_id=f.product_id
      and e.branch_id=f.branch_id
      and e.stock_unit_cost=50
      and e.currency='NGN'
      and e.reference='OPENING-001'
      and e.reason='Opening inventory cost basis'
      and e.command_id=f.cost_command_id
      and e.actor_user_id=f.user_id
  ),
  'opening command appends governed historical cost evidence to the same movement'
);

select extensions.ok(
  exists(
    select 1
    from public.sellertray_inventory_valuation_state s
    join sellertray_opening_fixture f
      on s.tenant_id=f.tenant_id and s.branch_id=f.branch_id and s.catalog_item_id=f.product_id
    where s.quantity_on_hand=10
      and s.valued_quantity_on_hand=10
      and s.unvalued_quantity_on_hand=0
      and s.known_inventory_value=500
      and s.average_unit_cost=50
      and s.valuation_status='valued'
  ),
  'opening cost evidence immediately establishes fully valued opening stock'
);

update sellertray_opening_fixture
set sale_id=public.record_sellertray_inventory_movement(
  tenant_id,branch_id,location_id,product_id,'sale',-2,'Each',2,1,
  'order','OPENING-SALE-001','opening:test:sale:1','2026-10-17 21:00:00+00'::timestamptz,
  user_id,null,
  jsonb_build_object(
    'order_id','00000000-0000-0000-0000-000000000301',
    'order_item_id','00000000-0000-0000-0000-000000000302'
  ),
  null
)
where true;

select extensions.ok(
  exists(
    select 1
    from public.sellertray_inventory_valuation_entries ve
    join sellertray_opening_fixture f on ve.movement_id=f.sale_id
    where ve.cogs_amount=100
      and ve.cogs_complete=true
      and ve.valuation_source='moving_weighted_average'
  ),
  'the first sale consumes opening inventory at its governed historical cost basis'
);

update sellertray_opening_fixture
set retry_result=public.apply_sellertray_opening_inventory(
  tenant_id,
  branch_id,
  product_id,
  10,
  50,
  'OPENING-001',
  'invop:receive:mvctm680:openingtest1',
  cost_command_id,
  user_id
);

select extensions.ok(
  (select retry_result->>'movementId'=result->>'movementId'
      and retry_result->>'costEvidenceId'=result->>'costEvidenceId'
   from sellertray_opening_fixture)
  and (
    select count(*)=1
    from public.inventory_movements m
    join sellertray_opening_fixture f on m.tenant_id=f.tenant_id
    where m.catalog_item_id=f.product_id and m.movement_type='opening'
  )
  and (
    select count(*)=1
    from public.sellertray_inventory_cost_basis_evidence e
    join sellertray_opening_fixture f on e.tenant_id=f.tenant_id
    where e.catalog_item_id=f.product_id and e.command_id=f.cost_command_id
  ),
  'retrying the exact opening command is idempotent for both quantity and cost evidence'
);

do $$
begin
  begin
    perform public.apply_sellertray_opening_inventory(
      (select tenant_id from sellertray_opening_fixture),
      (select branch_id from sellertray_opening_fixture),
      (select product_id from sellertray_opening_fixture),
      3,
      55,
      'OPENING-002',
      'invop:receive:mvctm680:openingtest2',
      gen_random_uuid(),
      (select user_id from sellertray_opening_fixture)
    );
  exception when others then
    update sellertray_opening_fixture set second_opening_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select second_opening_rejected from sellertray_opening_fixture),
  'a second opening movement is rejected once governed stock history exists'
);

select * from extensions.finish();
rollback;
