begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(32);

select extensions.ok(
  (select p.prosecdef and p.provolatile='s' from pg_proc p where p.oid=to_regprocedure('public.get_sellertray_inventory_management_stock(uuid,uuid,text,text,text,timestamptz,integer,integer)'))
  and (select p.prosecdef and p.provolatile='s' from pg_proc p where p.oid=to_regprocedure('public.get_sellertray_inventory_management_movements(uuid,uuid,text,text,date,date,integer,integer)'))
  and (select p.prosecdef and p.provolatile='s' from pg_proc p where p.oid=to_regprocedure('public.get_sellertray_inventory_management_transfers(uuid,uuid,text,text,date,date,integer,integer)')),
  'Inventory management reads are stable SECURITY DEFINER functions'
);
select extensions.ok(
  has_function_privilege('authenticated','public.get_sellertray_inventory_management_stock(uuid,uuid,text,text,text,timestamptz,integer,integer)','EXECUTE')
  and has_function_privilege('authenticated','public.get_sellertray_inventory_management_movements(uuid,uuid,text,text,date,date,integer,integer)','EXECUTE')
  and has_function_privilege('authenticated','public.get_sellertray_inventory_management_transfers(uuid,uuid,text,text,date,date,integer,integer)','EXECUTE')
  and not has_function_privilege('anon','public.get_sellertray_inventory_management_stock(uuid,uuid,text,text,text,timestamptz,integer,integer)','EXECUTE')
  and not has_function_privilege('anon','public.get_sellertray_inventory_management_movements(uuid,uuid,text,text,date,date,integer,integer)','EXECUTE')
  and not has_function_privilege('anon','public.get_sellertray_inventory_management_transfers(uuid,uuid,text,text,date,date,integer,integer)','EXECUTE'),
  'Inventory management reads are authenticated-only'
);
select extensions.ok(
  position('sellertray_user_has_capability' in pg_get_functiondef('public.get_sellertray_inventory_management_stock(uuid,uuid,text,text,text,timestamptz,integer,integer)'::regprocedure))>0
  and position('sellertray_user_can_read_report_branch' in pg_get_functiondef('public.get_sellertray_inventory_management_stock(uuid,uuid,text,text,text,timestamptz,integer,integer)'::regprocedure))>0
  and position('get_sellertray_branch_stock_as_of' in pg_get_functiondef('public.get_sellertray_inventory_management_stock(uuid,uuid,text,text,text,timestamptz,integer,integer)'::regprocedure))>0
  and position('get_sellertray_branch_stock_valuation' in pg_get_functiondef('public.get_sellertray_inventory_management_stock(uuid,uuid,text,text,text,timestamptz,integer,integer)'::regprocedure))>0,
  'Stock management wraps governed as-of quantity and valuation authority'
);
select extensions.ok(
  position('sellertray_inventory_valuation_entries' in pg_get_functiondef('public.get_sellertray_inventory_management_movements(uuid,uuid,text,text,date,date,integer,integer)'::regprocedure))>0
  and position('business_at' in pg_get_functiondef('public.get_sellertray_inventory_management_movements(uuid,uuid,text,text,date,date,integer,integer)'::regprocedure))>0
  and position('limit v_limit offset v_offset' in lower(pg_get_functiondef('public.get_sellertray_inventory_management_movements(uuid,uuid,text,text,date,date,integer,integer)'::regprocedure)))>0,
  'Movement management exposes valuation evidence with business time and server pagination'
);
select extensions.ok(
  position('sellertray_user_can_read_report_branch' in pg_get_functiondef('public.get_sellertray_inventory_management_transfers(uuid,uuid,text,text,date,date,integer,integer)'::regprocedure))>0
  and position('stock_transfer_items' in pg_get_functiondef('public.get_sellertray_inventory_management_transfers(uuid,uuid,text,text,date,date,integer,integer)'::regprocedure))>0
  and position('limit v_limit offset v_offset' in lower(pg_get_functiondef('public.get_sellertray_inventory_management_transfers(uuid,uuid,text,text,date,date,integer,integer)'::regprocedure)))>0,
  'Transfer management preserves Branch authority, product search and server pagination'
);

create temp table inventory_management_fixture(
  tenant_id uuid not null,
  other_tenant_id uuid not null,
  owner_id uuid not null,
  staff_id uuid not null,
  branch_id uuid,
  destination_branch_id uuid,
  foreign_branch_id uuid,
  location_id uuid,
  product_a_id uuid not null,
  product_b_id uuid not null,
  stock_uom_id uuid,
  movement_id uuid,
  transfer_id uuid,
  stock jsonb,
  movements jsonb,
  transfers jsonb
) on commit drop;

insert into inventory_management_fixture(
  tenant_id,other_tenant_id,owner_id,staff_id,product_a_id,product_b_id
) values(
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()
);

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_id,'inventory-mgmt-owner-'||substr(owner_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now() from inventory_management_fixture
union all
select staff_id,'inventory-mgmt-staff-'||substr(staff_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now() from inventory_management_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status,timezone,currency)
select tenant_id,'Inventory Management Test','inventory-management-'||substr(tenant_id::text,1,8),'IMR','active','Africa/Lagos','NGN' from inventory_management_fixture
union all
select other_tenant_id,'Inventory Foreign Test','inventory-foreign-'||substr(other_tenant_id::text,1,8),'IMX','active','Africa/Lagos','NGN' from inventory_management_fixture;
update public.tenant_subscriptions set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id in (select tenant_id from inventory_management_fixture union all select other_tenant_id from inventory_management_fixture);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_id,'owner' from inventory_management_fixture
union all select tenant_id,staff_id,'staff' from inventory_management_fixture;

update inventory_management_fixture f set branch_id=b.id
from public.branches b where b.tenant_id=f.tenant_id and b.is_default=true;
update inventory_management_fixture f set foreign_branch_id=b.id
from public.branches b where b.tenant_id=f.other_tenant_id and b.is_default=true;
with x as (
  insert into public.branches(tenant_id,code,name,is_default,is_active)
  select tenant_id,'IM2','Inventory Destination',false,true from inventory_management_fixture returning id
)
update inventory_management_fixture set destination_branch_id=(select id from x);
update inventory_management_fixture f set location_id=sl.id
from public.stock_locations sl where sl.tenant_id=f.tenant_id and sl.branch_id=f.branch_id and sl.is_default=true;

insert into public.catalog_items(id,tenant_id,name,sku,category,price_ngn,is_active,stock_uom,allow_fractional_stock)
select product_a_id,tenant_id,'Management Paint','MGT-A','Paint',1500,true,'Each',false from inventory_management_fixture
union all
select product_b_id,tenant_id,'Management Brush','MGT-B','Accessories',500,true,'Each',false from inventory_management_fixture;
update inventory_management_fixture f set stock_uom_id=u.id
from public.catalog_item_uoms u
where u.tenant_id=f.tenant_id and u.catalog_item_id=f.product_a_id and lower(u.uom_name)='each';

insert into public.branch_inventory_policies(tenant_id,branch_id,catalog_item_id,low_stock_threshold,reorder_target)
select tenant_id,branch_id,product_a_id,10,20 from inventory_management_fixture;

update inventory_management_fixture f set movement_id=public.record_sellertray_inventory_movement(
  f.tenant_id,f.branch_id,f.location_id,f.product_a_id,'opening',5,'Each',5,1,
  'opening_stock','MGT-OPEN-001','inventory-management:opening:1',
  '2026-10-19 08:00:00+00'::timestamptz,f.owner_id,'Management fixture opening stock','{}'::jsonb,null
);

update inventory_management_fixture f set transfer_id=(public.create_sellertray_stock_transfer(
  f.tenant_id,f.branch_id,f.destination_branch_id,'MGT-TRANSFER-001','Move paint to destination',
  jsonb_build_array(jsonb_build_object('catalogItemId',f.product_a_id,'uomId',f.stock_uom_id,'quantity',1)),
  f.owner_id
)->>'transferId')::uuid;

select set_config('request.jwt.claim.sub',(select owner_id::text from inventory_management_fixture),true);
select set_config('request.jwt.claim.role','authenticated',true);
update inventory_management_fixture set
  stock=public.get_sellertray_inventory_management_stock(tenant_id,branch_id,null,'all','all','2026-10-19 12:00:00+00'::timestamptz,50,0),
  movements=public.get_sellertray_inventory_management_movements(tenant_id,branch_id,null,null,null,null,50,0),
  transfers=public.get_sellertray_inventory_management_transfers(tenant_id,branch_id,null,'all',null,null,50,0);

select extensions.is((select (stock->>'totalCount')::integer from inventory_management_fixture),2,'Stock management returns all active Branch products');
select extensions.ok(
  (select (stock->>'lowStockCount')::integer=2 and (stock->>'outOfStockCount')::integer=1 from inventory_management_fixture),
  'Stock aggregates cover the full Branch result set rather than only a page'
);
select extensions.is(
  (public.get_sellertray_inventory_management_stock((select tenant_id from inventory_management_fixture),(select branch_id from inventory_management_fixture),'MGT-A','all','all','2026-10-19 12:00:00+00',50,0)->>'totalCount')::integer,
  1,'Stock search is server-side'
);
select extensions.is(
  (public.get_sellertray_inventory_management_stock((select tenant_id from inventory_management_fixture),(select branch_id from inventory_management_fixture),null,'out_of_stock','all','2026-10-19 12:00:00+00',50,0)->>'totalCount')::integer,
  1,'Stock-state filtering is server-side'
);
select extensions.is(
  (public.get_sellertray_inventory_management_stock((select tenant_id from inventory_management_fixture),(select branch_id from inventory_management_fixture),null,'all','unvalued','2026-10-19 12:00:00+00',50,0)->>'totalCount')::integer,
  1,'Valuation-state filtering is server-side'
);
select extensions.ok(
  (select (stock->>'totalCount')::integer=2 and jsonb_array_length(public.get_sellertray_inventory_management_stock(tenant_id,branch_id,null,'all','all','2026-10-19 12:00:00+00',1,0)->'items')=1 from inventory_management_fixture),
  'Stock pagination retains the full filtered count'
);
select extensions.ok(
  exists(
    select 1 from inventory_management_fixture f,jsonb_array_elements(f.stock->'items') x
    where x->>'catalogItemId'=f.product_a_id::text
      and x->>'valuationStatus'='unvalued'
      and x->'averageUnitCost'='null'::jsonb
      and (x->>'unvaluedQuantityOnHand')::numeric=5
  ),
  'Unknown opening cost remains explicitly unvalued and is never exposed as zero unit cost'
);
select extensions.ok(
  exists(
    select 1 from inventory_management_fixture f,
      jsonb_array_elements(public.get_sellertray_inventory_management_stock(f.tenant_id,f.branch_id,'MGT-A','all','all','2026-10-19 07:59:59+00',50,0)->'items') x
    where x->>'catalogItemId'=f.product_a_id::text
      and (x->>'quantityOnHand')::numeric=0
      and x->>'valuationStatus'='empty'
  ),
  'Stock management preserves deterministic business-time as-of reads'
);

select extensions.is((select (movements->>'totalCount')::integer from inventory_management_fixture),1,'Movement management returns the Branch ledger movement');
select extensions.is(
  (public.get_sellertray_inventory_management_movements((select tenant_id from inventory_management_fixture),(select branch_id from inventory_management_fixture),'MGT-OPEN-001',null,null,null,50,0)->>'totalCount')::integer,
  1,'Movement search is server-side'
);
select extensions.is(
  (public.get_sellertray_inventory_management_movements((select tenant_id from inventory_management_fixture),(select branch_id from inventory_management_fixture),null,null,'2026-10-19','2026-10-19',50,0)->>'totalCount')::integer,
  1,'Movement date filtering uses Business-local dates'
);
select extensions.ok(
  exists(
    select 1 from inventory_management_fixture f,jsonb_array_elements(f.movements->'items') x
    where x->>'id'=f.movement_id::text and x->>'valuationStatus'='unvalued'
      and x->>'businessAt' is not null and x->>'valuationSource' is not null
  ),
  'Movement management joins authoritative valuation evidence without rewriting ledger history'
);
select extensions.ok(
  (select jsonb_array_length(public.get_sellertray_inventory_management_movements(tenant_id,branch_id,null,null,null,null,1,0)->'items')=1
     and (public.get_sellertray_inventory_management_movements(tenant_id,branch_id,null,null,null,null,1,0)->>'totalCount')::integer=1
   from inventory_management_fixture),
  'Movement pagination returns stable full-filter totals'
);

select extensions.is((select (transfers->>'totalCount')::integer from inventory_management_fixture),1,'Transfer management returns transfers involving the selected Branch');
select extensions.is(
  (public.get_sellertray_inventory_management_transfers((select tenant_id from inventory_management_fixture),(select branch_id from inventory_management_fixture),'MGT-TRANSFER-001','all',null,null,50,0)->>'totalCount')::integer,
  1,'Transfer reference search is server-side'
);
select extensions.is(
  (public.get_sellertray_inventory_management_transfers((select tenant_id from inventory_management_fixture),(select branch_id from inventory_management_fixture),'Management Paint','all',null,null,50,0)->>'totalCount')::integer,
  1,'Transfer product search is server-side'
);
select extensions.ok(
  (select (transfers->>'openCount')::integer=1 from inventory_management_fixture)
  and (public.get_sellertray_inventory_management_transfers((select tenant_id from inventory_management_fixture),(select branch_id from inventory_management_fixture),null,'draft',null,null,50,0)->>'totalCount')::integer=1,
  'Transfer status filtering and open-transfer aggregate use the full Branch result set'
);
select extensions.ok(
  (select jsonb_array_length(public.get_sellertray_inventory_management_transfers(tenant_id,branch_id,null,'all',null,null,1,0)->'items')=1
     and (public.get_sellertray_inventory_management_transfers(tenant_id,branch_id,null,'all',null,null,1,0)->>'totalCount')::integer=1
   from inventory_management_fixture),
  'Transfer pagination returns stable full-filter totals'
);

select extensions.throws_ok(
  format('select public.get_sellertray_inventory_management_stock(%L::uuid,%L::uuid,null,''all'',''all'',now(),50,0)',(select tenant_id::text from inventory_management_fixture),(select foreign_branch_id::text from inventory_management_fixture)),
  'P0002','Branch not found','Inventory management fails closed for another Business Branch'
);
select extensions.throws_ok(
  format('select public.get_sellertray_inventory_management_stock(%L::uuid,%L::uuid,null,''mystery'',''all'',now(),50,0)',(select tenant_id::text from inventory_management_fixture),(select branch_id::text from inventory_management_fixture)),
  '22023','Unsupported stock state','Unsupported stock state is rejected'
);
select extensions.throws_ok(
  format('select public.get_sellertray_inventory_management_stock(%L::uuid,%L::uuid,null,''all'',''mystery'',now(),50,0)',(select tenant_id::text from inventory_management_fixture),(select branch_id::text from inventory_management_fixture)),
  '22023','Unsupported valuation state','Unsupported valuation state is rejected'
);
select extensions.throws_ok(
  format('select public.get_sellertray_inventory_management_movements(%L::uuid,%L::uuid,null,''mystery'',null,null,50,0)',(select tenant_id::text from inventory_management_fixture),(select branch_id::text from inventory_management_fixture)),
  '22023','Unsupported inventory movement type','Unsupported movement type is rejected'
);
select extensions.throws_ok(
  format('select public.get_sellertray_inventory_management_movements(%L::uuid,%L::uuid,null,null,''2026-10-20''::date,''2026-10-19''::date,50,0)',(select tenant_id::text from inventory_management_fixture),(select branch_id::text from inventory_management_fixture)),
  '22023','Inventory movement date range is invalid','Invalid movement date range is rejected'
);
select extensions.throws_ok(
  format('select public.get_sellertray_inventory_management_transfers(%L::uuid,%L::uuid,null,''mystery'',null,null,50,0)',(select tenant_id::text from inventory_management_fixture),(select branch_id::text from inventory_management_fixture)),
  '22023','Unsupported stock transfer status','Unsupported transfer status is rejected'
);
select extensions.throws_ok(
  format('select public.get_sellertray_inventory_management_transfers(%L::uuid,%L::uuid,null,''all'',''2026-10-20''::date,''2026-10-19''::date,50,0)',(select tenant_id::text from inventory_management_fixture),(select branch_id::text from inventory_management_fixture)),
  '22023','Stock transfer date range is invalid','Invalid transfer date range is rejected'
);

select set_config('request.jwt.claim.sub',(select staff_id::text from inventory_management_fixture),true);
select extensions.throws_ok(
  format('select public.get_sellertray_inventory_management_stock(%L::uuid,%L::uuid,null,''all'',''all'',now(),50,0)',(select tenant_id::text from inventory_management_fixture),(select branch_id::text from inventory_management_fixture)),
  '42501','You do not have permission to view inventory management','Staff without report capability cannot use Inventory management reads'
);

select set_config('request.jwt.claim.sub','',true);
select extensions.throws_ok(
  format('select public.get_sellertray_inventory_management_stock(%L::uuid,%L::uuid,null,''all'',''all'',now(),50,0)',(select tenant_id::text from inventory_management_fixture),(select branch_id::text from inventory_management_fixture)),
  '42501','SellerTray authentication required','Inventory management reads require an authenticated SellerTray user'
);

select * from extensions.finish();
rollback;