begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(14);

create temp table sellertray_offline_pos_fixture (
  tenant_id uuid not null,
  product_id uuid not null,
  branch_id uuid,
  stock_location_id uuid,
  uom_id uuid,
  client_reference uuid not null,
  first_order_id uuid,
  replay_order_id uuid,
  conflict_rejected boolean not null default false,
  second_order_id uuid
) on commit drop;

insert into sellertray_offline_pos_fixture(tenant_id,product_id,client_reference)
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'SellerTray Offline POS Test','sellertray-offline-pos-'||substr(tenant_id::text,1,8),'OFFPOS','active'
from sellertray_offline_pos_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from sellertray_offline_pos_fixture);

update sellertray_offline_pos_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

update sellertray_offline_pos_fixture f
set stock_location_id=sl.id
from public.stock_locations sl
where sl.tenant_id=f.tenant_id
  and sl.branch_id=f.branch_id
  and sl.is_default=true;

insert into public.catalog_items(
  id,tenant_id,name,sku,price_ngn,is_active,stock_uom,allow_fractional_stock
)
select product_id,tenant_id,'Offline Test Item','OFF-ITEM',250,true,'Each',false
from sellertray_offline_pos_fixture;

update sellertray_offline_pos_fixture f
set uom_id=u.id
from public.catalog_item_uoms u
where u.tenant_id=f.tenant_id
  and u.catalog_item_id=f.product_id
  and u.is_default_selling=true;

insert into public.inventory_movements(
  tenant_id,branch_id,stock_location_id,catalog_item_id,movement_type,
  quantity_delta,stock_uom,source_uom,source_quantity,conversion_factor,
  reference_type,reference_id,idempotency_key,business_at,reason
)
select tenant_id,branch_id,stock_location_id,product_id,'opening',
       100,'Each','Each',100,1,'test',client_reference::text,
       'offline-pos-opening:'||client_reference::text,now(),'Offline POS test opening stock'
from sellertray_offline_pos_fixture;

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='create_sellertray_pos_order_idempotent'
  ),
  'idempotent POS draft command exists'
);

select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.create_sellertray_pos_order_idempotent(uuid,uuid,text,text,text,jsonb,uuid)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.create_sellertray_pos_order_idempotent(uuid,uuid,text,text,text,jsonb,uuid)',
    'EXECUTE'
  ),
  'idempotent POS draft command is service-only'
);

select extensions.ok(
  not has_table_privilege('authenticated','public.sellertray_pos_draft_requests','SELECT')
  and not has_table_privilege('authenticated','public.sellertray_pos_draft_requests','INSERT')
  and not has_table_privilege('anon','public.sellertray_pos_draft_requests','SELECT'),
  'POS draft replay registry is server-only'
);

select extensions.is(
  (
    select count(*)::int
    from information_schema.columns
    where table_schema='public' and table_name='sellertray_pos_draft_requests'
      and column_name in ('payload','customer_name','customer_phone','items','note')
  ),
  0,
  'replay registry does not persist the sale payload or customer details'
);

update sellertray_offline_pos_fixture f
set first_order_id=public.create_sellertray_pos_order_idempotent(
  f.tenant_id,f.branch_id,null,null,'Offline held sale',
  jsonb_build_array(jsonb_build_object(
    'catalog_item_id',f.product_id,
    'uom_id',f.uom_id,
    'quantity',2,
    'expected_selling_price',250,
    'expected_conversion_factor',1
  )),
  f.client_reference
);

select extensions.ok(
  (select first_order_id is not null from sellertray_offline_pos_fixture),
  'first client reference creates a POS draft'
);

update sellertray_offline_pos_fixture f
set replay_order_id=public.create_sellertray_pos_order_idempotent(
  f.tenant_id,f.branch_id,null,null,'Offline held sale',
  jsonb_build_array(jsonb_build_object(
    'catalog_item_id',f.product_id,
    'uom_id',f.uom_id,
    'quantity',2,
    'expected_selling_price',250,
    'expected_conversion_factor',1
  )),
  f.client_reference
);

select extensions.is(
  (select replay_order_id from sellertray_offline_pos_fixture),
  (select first_order_id from sellertray_offline_pos_fixture),
  'same reference and payload replay returns the original draft'
);

select extensions.is(
  (
    select count(*)::int from public.orders o
    where o.tenant_id=(select tenant_id from sellertray_offline_pos_fixture)
      and o.source='pos'
  ),
  1,
  'idempotent replay does not create a second POS order'
);

select extensions.is(
  (
    select count(*)::int from public.sellertray_pos_draft_requests r
    where r.tenant_id=(select tenant_id from sellertray_offline_pos_fixture)
  ),
  1,
  'one replay registry row is stored for one client reference'
);

select extensions.ok(
  (
    select r.payload_fingerprint ~ '^[0-9a-f]{32}$'
    from public.sellertray_pos_draft_requests r
    where r.tenant_id=(select tenant_id from sellertray_offline_pos_fixture)
  ),
  'replay registry stores only a bounded fingerprint of sale details'
);

do $$
begin
  begin
    perform public.create_sellertray_pos_order_idempotent(
      (select tenant_id from sellertray_offline_pos_fixture),
      (select branch_id from sellertray_offline_pos_fixture),
      null,null,'Offline held sale',
      jsonb_build_array(jsonb_build_object(
        'catalog_item_id',(select product_id from sellertray_offline_pos_fixture),
        'uom_id',(select uom_id from sellertray_offline_pos_fixture),
        'quantity',3,
        'expected_selling_price',250,
        'expected_conversion_factor',1
      )),
      (select client_reference from sellertray_offline_pos_fixture)
    );
  exception when unique_violation then
    update sellertray_offline_pos_fixture set conflict_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select conflict_rejected from sellertray_offline_pos_fixture),
  'reusing a client reference with changed sale details is rejected'
);

select extensions.is(
  (
    select count(*)::int from public.orders o
    where o.tenant_id=(select tenant_id from sellertray_offline_pos_fixture)
      and o.source='pos'
  ),
  1,
  'conflicting replay does not create another order'
);

update sellertray_offline_pos_fixture f
set second_order_id=public.create_sellertray_pos_order_idempotent(
  f.tenant_id,f.branch_id,null,null,'Second held sale',
  jsonb_build_array(jsonb_build_object(
    'catalog_item_id',f.product_id,
    'uom_id',f.uom_id,
    'quantity',1,
    'expected_selling_price',250,
    'expected_conversion_factor',1
  )),
  gen_random_uuid()
);

select extensions.ok(
  (select second_order_id is not null and second_order_id<>first_order_id from sellertray_offline_pos_fixture),
  'a new client reference creates a distinct draft'
);

select extensions.is(
  (
    select count(*)::int from public.sellertray_pos_draft_requests r
    where r.tenant_id=(select tenant_id from sellertray_offline_pos_fixture)
  ),
  2,
  'distinct client references have distinct replay registry rows'
);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='create_sellertray_pos_order_idempotent'
      and lower(pg_get_functiondef(p.oid)) like '%pg_advisory_xact_lock%'
      and lower(pg_get_functiondef(p.oid)) like '%create_sellertray_pos_order_atomic%'
  ),
  'idempotent wrapper serializes replay and reuses the existing POS business command'
);

select * from extensions.finish();
rollback;