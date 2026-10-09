begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(10);

create temp table sellertray_stock_transfer_history_fixture (
  tenant_id uuid not null,
  owner_user_id uuid not null,
  product_id uuid not null,
  source_branch_id uuid,
  destination_branch_id uuid,
  source_location_id uuid,
  stock_uom_id uuid,
  transfer_id uuid,
  item_update_rejected boolean not null default false,
  header_update_rejected boolean not null default false,
  dispatch_tamper_rejected boolean not null default false,
  terminal_update_rejected boolean not null default false,
  item_delete_rejected boolean not null default false,
  transfer_delete_rejected boolean not null default false
) on commit drop;

insert into sellertray_stock_transfer_history_fixture(tenant_id,owner_user_id,product_id)
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_user_id,
  'transfer-history-'||substr(owner_user_id::text,1,8)||'@example.com',
  'authenticated','authenticated',now(),now()
from sellertray_stock_transfer_history_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'SellerTray Transfer History Test',
  'sellertray-transfer-history-'||substr(tenant_id::text,1,8),'STH','active'
from sellertray_stock_transfer_history_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from sellertray_stock_transfer_history_fixture);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner'
from sellertray_stock_transfer_history_fixture;

update sellertray_stock_transfer_history_fixture f
set source_branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

insert into public.branches(tenant_id,code,name,is_default,is_active)
select tenant_id,'HDEST','History Destination',false,true
from sellertray_stock_transfer_history_fixture;

update sellertray_stock_transfer_history_fixture f
set destination_branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.code='HDEST';

update sellertray_stock_transfer_history_fixture f
set source_location_id=sl.id
from public.stock_locations sl
where sl.tenant_id=f.tenant_id and sl.branch_id=f.source_branch_id and sl.is_default=true;

insert into public.catalog_items(
  id,tenant_id,name,sku,price_ngn,is_active,stock_uom,allow_fractional_stock
)
select product_id,tenant_id,'Transfer History Item','THIST-1',100,true,'Each',false
from sellertray_stock_transfer_history_fixture;

update sellertray_stock_transfer_history_fixture f
set stock_uom_id=u.id
from public.catalog_item_uoms u
where u.tenant_id=f.tenant_id
  and u.catalog_item_id=f.product_id
  and lower(u.uom_name)='each';

select public.record_sellertray_inventory_movement(
  tenant_id,source_branch_id,source_location_id,product_id,
  'opening',5,'Each',5,1,
  'opening_stock','THIST-OPEN','opening:THIST-OPEN',
  now(),owner_user_id,'Opening stock for transfer history test','{}'::jsonb,null
)
from sellertray_stock_transfer_history_fixture;

update sellertray_stock_transfer_history_fixture
set transfer_id=(public.create_sellertray_stock_transfer(
  tenant_id,source_branch_id,destination_branch_id,
  'THIST-001','History integrity transfer',
  jsonb_build_array(jsonb_build_object(
    'catalogItemId',product_id,'uomId',stock_uom_id,'quantity',2
  )),owner_user_id
)->>'transferId')::uuid;

do $$
begin
  begin
    update public.stock_transfer_items
    set transfer_quantity=3,stock_quantity=3
    where stock_transfer_id=(select transfer_id from sellertray_stock_transfer_history_fixture);
  exception when sqlstate '55000' then
    update sellertray_stock_transfer_history_fixture set item_update_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select item_update_rejected from sellertray_stock_transfer_history_fixture),
  'draft transfer line facts cannot be rewritten directly'
);

do $$
begin
  begin
    update public.stock_transfers
    set reason='Tampered transfer reason'
    where id=(select transfer_id from sellertray_stock_transfer_history_fixture);
  exception when sqlstate '55000' then
    update sellertray_stock_transfer_history_fixture set header_update_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select header_update_rejected from sellertray_stock_transfer_history_fixture),
  'transfer identity and draft facts cannot be rewritten directly'
);

select extensions.is(
  (
    select public.dispatch_sellertray_stock_transfer(
      tenant_id,transfer_id,owner_user_id
    )->>'status'
    from sellertray_stock_transfer_history_fixture
  ),
  'dispatched','governed Draft to Dispatched transition remains allowed'
);

do $$
begin
  begin
    update public.stock_transfers
    set dispatched_at=dispatched_at+interval '1 minute'
    where id=(select transfer_id from sellertray_stock_transfer_history_fixture);
  exception when sqlstate '55000' then
    update sellertray_stock_transfer_history_fixture set dispatch_tamper_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select dispatch_tamper_rejected from sellertray_stock_transfer_history_fixture),
  'dispatch evidence cannot be rewritten after stock leaves the source branch'
);

select extensions.is(
  (
    select public.receive_sellertray_stock_transfer(
      tenant_id,transfer_id,owner_user_id
    )->>'status'
    from sellertray_stock_transfer_history_fixture
  ),
  'received','governed Dispatched to Received transition remains allowed'
);

do $$
begin
  begin
    update public.stock_transfers
    set status='dispatched',received_by_user_id=null,received_at=null
    where id=(select transfer_id from sellertray_stock_transfer_history_fixture);
  exception when sqlstate '55000' then
    update sellertray_stock_transfer_history_fixture set terminal_update_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select terminal_update_rejected from sellertray_stock_transfer_history_fixture),
  'received transfer history cannot be reopened or rewritten'
);

do $$
begin
  begin
    delete from public.stock_transfer_items
    where stock_transfer_id=(select transfer_id from sellertray_stock_transfer_history_fixture);
  exception when sqlstate '55000' then
    update sellertray_stock_transfer_history_fixture set item_delete_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select item_delete_rejected from sellertray_stock_transfer_history_fixture),
  'transfer item history cannot be deleted while the business exists'
);

do $$
begin
  begin
    delete from public.stock_transfers
    where id=(select transfer_id from sellertray_stock_transfer_history_fixture);
  exception when sqlstate '55000' then
    update sellertray_stock_transfer_history_fixture set transfer_delete_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select transfer_delete_rejected from sellertray_stock_transfer_history_fixture),
  'transfer aggregate history cannot be deleted while the business exists'
);

delete from public.tenants
where id=(select tenant_id from sellertray_stock_transfer_history_fixture);

select extensions.is(
  (
    select count(*)::integer from public.stock_transfers st
    where st.tenant_id=(select tenant_id from sellertray_stock_transfer_history_fixture)
  ),
  0,'governed Tenant deletion can cascade through protected transfer history'
);

select extensions.is(
  (
    select count(*)::integer from public.stock_transfer_items sti
    where sti.tenant_id=(select tenant_id from sellertray_stock_transfer_history_fixture)
  ),
  0,'governed Tenant deletion removes dependent transfer lines'
);

select * from extensions.finish();
rollback;