begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(10);

create temp table sellertray_offline_replay_fixture(
  tenant_id uuid not null,
  branch_id uuid,
  stock_location_id uuid,
  product_id uuid not null,
  uom_id uuid,
  stock_rejected boolean not null default false,
  price_rejected boolean not null default false,
  branch_rejected boolean not null default false
) on commit drop;

insert into sellertray_offline_replay_fixture(tenant_id,product_id)
values(gen_random_uuid(),gen_random_uuid());

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'Offline Replay Validation','offline-replay-'||substr(tenant_id::text,1,8),'OFFREP','active'
from sellertray_offline_replay_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from sellertray_offline_replay_fixture);

update sellertray_offline_replay_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

update sellertray_offline_replay_fixture f
set stock_location_id=sl.id
from public.stock_locations sl
where sl.tenant_id=f.tenant_id and sl.branch_id=f.branch_id and sl.is_default=true;

insert into public.catalog_items(id,tenant_id,name,sku,price_ngn,is_active,stock_uom,allow_fractional_stock)
select product_id,tenant_id,'Replay Item','REPLAY-1',250,true,'Each',false
from sellertray_offline_replay_fixture;

update sellertray_offline_replay_fixture f
set uom_id=u.id
from public.catalog_item_uoms u
where u.tenant_id=f.tenant_id and u.catalog_item_id=f.product_id and u.is_default_selling=true;

insert into public.inventory_movements(
  tenant_id,branch_id,stock_location_id,catalog_item_id,movement_type,quantity_delta,
  stock_uom,source_uom,source_quantity,conversion_factor,reference_type,reference_id,
  idempotency_key,business_at,reason
)
select tenant_id,branch_id,stock_location_id,product_id,'opening',5,
       'Each','Each',5,1,'test','offline-replay-stock',
       'offline-replay-opening:'||product_id::text,now(),'Offline replay validation stock'
from sellertray_offline_replay_fixture;

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='create_sellertray_pos_order_idempotent'
      and lower(pg_get_functiondef(p.oid)) like '%expected_selling_price%'
      and lower(pg_get_functiondef(p.oid)) like '%expected_conversion_factor%'
  ),
  'offline replay command requires queued price and conversion snapshots'
);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='create_sellertray_pos_order_idempotent'
      and lower(pg_get_functiondef(p.oid)) like '%inventory_movements%'
      and lower(pg_get_functiondef(p.oid)) like '%branch stock is no longer sufficient%'
  ),
  'offline replay command rechecks current Branch stock'
);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='create_sellertray_pos_order_idempotent'
      and lower(pg_get_functiondef(p.oid)) like '%b.is_active=true%'
      and lower(pg_get_functiondef(p.oid)) like '%branch is no longer available%'
  ),
  'offline replay command rechecks active Branch state'
);

do $$
begin
  begin
    perform public.create_sellertray_pos_order_idempotent(
      (select tenant_id from sellertray_offline_replay_fixture),
      (select branch_id from sellertray_offline_replay_fixture),
      null,null,null,
      jsonb_build_array(jsonb_build_object(
        'catalog_item_id',(select product_id from sellertray_offline_replay_fixture),
        'uom_id',(select uom_id from sellertray_offline_replay_fixture),
        'quantity',6,
        'expected_selling_price',250,
        'expected_conversion_factor',1
      )),
      gen_random_uuid()
    );
  exception when check_violation then
    update sellertray_offline_replay_fixture set stock_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select stock_rejected from sellertray_offline_replay_fixture),
  'replay is rejected when current Branch stock cannot satisfy the held sale'
);

select extensions.is(
  (select count(*)::int from public.orders where tenant_id=(select tenant_id from sellertray_offline_replay_fixture) and source='pos'),
  0,
  'stock rejection creates no POS draft'
);

update public.catalog_item_uoms u
set selling_price=300
where u.id=(select uom_id from sellertray_offline_replay_fixture);

do $$
begin
  begin
    perform public.create_sellertray_pos_order_idempotent(
      (select tenant_id from sellertray_offline_replay_fixture),
      (select branch_id from sellertray_offline_replay_fixture),
      null,null,null,
      jsonb_build_array(jsonb_build_object(
        'catalog_item_id',(select product_id from sellertray_offline_replay_fixture),
        'uom_id',(select uom_id from sellertray_offline_replay_fixture),
        'quantity',1,
        'expected_selling_price',250,
        'expected_conversion_factor',1
      )),
      gen_random_uuid()
    );
  exception when check_violation then
    update sellertray_offline_replay_fixture set price_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select price_rejected from sellertray_offline_replay_fixture),
  'replay is rejected when the displayed selling price changed while offline'
);

select extensions.is(
  (select count(*)::int from public.sellertray_pos_draft_requests where tenant_id=(select tenant_id from sellertray_offline_replay_fixture)),
  0,
  'rejected price/stock replays create no idempotency registry row'
);

update public.catalog_item_uoms u set selling_price=250
where u.id=(select uom_id from sellertray_offline_replay_fixture);
update public.branches b set is_active=false
where b.id=(select branch_id from sellertray_offline_replay_fixture);

do $$
begin
  begin
    perform public.create_sellertray_pos_order_idempotent(
      (select tenant_id from sellertray_offline_replay_fixture),
      (select branch_id from sellertray_offline_replay_fixture),
      null,null,null,
      jsonb_build_array(jsonb_build_object(
        'catalog_item_id',(select product_id from sellertray_offline_replay_fixture),
        'uom_id',(select uom_id from sellertray_offline_replay_fixture),
        'quantity',1,
        'expected_selling_price',250,
        'expected_conversion_factor',1
      )),
      gen_random_uuid()
    );
  exception when check_violation then
    update sellertray_offline_replay_fixture set branch_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select branch_rejected from sellertray_offline_replay_fixture),
  'replay is rejected when the queued Branch has become inactive'
);

select extensions.is(
  (select count(*)::int from public.orders where tenant_id=(select tenant_id from sellertray_offline_replay_fixture) and source='pos'),
  0,
  'inactive Branch rejection creates no POS draft'
);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='create_sellertray_pos_order_atomic'
  ),
  'legacy POS command remains available for non-offline callers'
);

select * from extensions.finish();
rollback;