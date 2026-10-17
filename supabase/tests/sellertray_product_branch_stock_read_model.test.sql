begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(7);

select extensions.ok(
  lower(pg_get_functiondef('public.get_sellertray_product_management_detail(uuid,uuid)'::regprocedure)) like '%branchstock%',
  'product management detail exposes Branch stock'
);

select extensions.ok(
  lower(pg_get_functiondef('public.get_sellertray_product_management_detail(uuid,uuid)'::regprocedure)) like '%sellertray_user_can_read_branch%'
  and lower(pg_get_functiondef('public.get_sellertray_product_management_detail(uuid,uuid)'::regprocedure)) like '%inventory_movements%',
  'Product Branch stock is ledger-derived and Branch-read scoped'
);

create temp table sellertray_product_stock_fixture (
  tenant_id uuid not null,
  owner_user_id uuid not null,
  product_id uuid not null,
  branch_id uuid,
  location_id uuid,
  branch2_id uuid,
  location2_id uuid,
  detail jsonb
) on commit drop;

insert into sellertray_product_stock_fixture(tenant_id,owner_user_id,product_id)
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_user_id,'product-stock-owner-'||substr(owner_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_product_stock_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'SellerTray Product Stock Test','sellertray-product-stock-'||substr(tenant_id::text,1,8),'PST','active'
from sellertray_product_stock_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from sellertray_product_stock_fixture);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner'
from sellertray_product_stock_fixture;

update sellertray_product_stock_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

update sellertray_product_stock_fixture f
set location_id=sl.id
from public.stock_locations sl
where sl.tenant_id=f.tenant_id and sl.branch_id=f.branch_id and sl.is_default=true;

with ins as (
  insert into public.branches(tenant_id,code,name,is_default,is_active)
  select tenant_id,'ARCH','Archive Branch',false,true
  from sellertray_product_stock_fixture
  returning id
)
update sellertray_product_stock_fixture set branch2_id=(select id from ins);

update sellertray_product_stock_fixture f
set location2_id=sl.id
from public.stock_locations sl
where sl.tenant_id=f.tenant_id and sl.branch_id=f.branch2_id and sl.is_default=true;

insert into public.catalog_items(id,tenant_id,name,sku,price_ngn,is_active,stock_uom,allow_fractional_stock)
select product_id,tenant_id,'Branch Stock Product','PST-001',500,true,'Each',false
from sellertray_product_stock_fixture;

select public.record_sellertray_inventory_movement(
  tenant_id,branch_id,location_id,product_id,'opening',12,'Each',12,1,
  'opening_stock','PST-OPEN-001','product-stock:open:1','2026-10-17 10:00:00+00'::timestamptz,
  owner_user_id,'Product stock fixture','{}'::jsonb,null
)
from sellertray_product_stock_fixture;

select public.record_sellertray_inventory_movement(
  tenant_id,branch2_id,location2_id,product_id,'opening',5,'Each',5,1,
  'opening_stock','PST-OPEN-002','product-stock:open:2','2026-10-17 11:00:00+00'::timestamptz,
  owner_user_id,'Product stock fixture','{}'::jsonb,null
)
from sellertray_product_stock_fixture;

update public.branches
set is_active=false
where tenant_id=(select tenant_id from sellertray_product_stock_fixture)
  and id=(select branch2_id from sellertray_product_stock_fixture);

select set_config('request.jwt.claim.sub',(select owner_user_id::text from sellertray_product_stock_fixture),true);
select set_config('request.jwt.claim.role','authenticated',true);

update sellertray_product_stock_fixture
set detail=public.get_sellertray_product_management_detail(tenant_id,product_id);

select extensions.is(
  (select jsonb_array_length(detail->'branchStock') from sellertray_product_stock_fixture),
  2,
  'Product detail returns every readable Branch including historical inactive Branches'
);

select extensions.is(
  (
    select (row->>'quantityOnHand')::numeric
    from sellertray_product_stock_fixture f,
         jsonb_array_elements(f.detail->'branchStock') row
    where row->>'branchId'=f.branch_id::text
  ),
  12::numeric,
  'default Branch quantity comes from the governed inventory ledger'
);

select extensions.is(
  (
    select (row->>'quantityOnHand')::numeric
    from sellertray_product_stock_fixture f,
         jsonb_array_elements(f.detail->'branchStock') row
    where row->>'branchId'=f.branch2_id::text
  ),
  5::numeric,
  'historical inactive Branch quantity remains visible'
);

select extensions.ok(
  (
    select (row->>'isActive')::boolean=false and nullif(row->>'lastMovementAt','') is not null
    from sellertray_product_stock_fixture f,
         jsonb_array_elements(f.detail->'branchStock') row
    where row->>'branchId'=f.branch2_id::text
  ),
  'Product stock marks inactive Branch history without hiding its last movement'
);

select extensions.is(
  (
    select count(*)::integer
    from public.inventory_movements im
    where im.tenant_id=(select tenant_id from sellertray_product_stock_fixture)
      and im.catalog_item_id=(select product_id from sellertray_product_stock_fixture)
  ),
  2,
  'reading Product Branch stock does not create or invent inventory movements'
);

select * from extensions.finish();
rollback;
