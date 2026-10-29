begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(10);

create temp table sellertray_stock_count_history_fixture (
  tenant_id uuid not null,
  owner_user_id uuid not null,
  product_id uuid not null,
  branch_id uuid,
  location_id uuid,
  stock_uom_id uuid,
  count_id uuid,
  baseline_change_rejected boolean not null default false,
  review_item_change_rejected boolean not null default false,
  identity_change_rejected boolean not null default false,
  terminal_change_rejected boolean not null default false,
  item_delete_rejected boolean not null default false,
  count_delete_rejected boolean not null default false
) on commit drop;

insert into sellertray_stock_count_history_fixture(tenant_id,owner_user_id,product_id)
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_user_id,
  'count-history-'||substr(owner_user_id::text,1,8)||'@example.com',
  'authenticated','authenticated',now(),now()
from sellertray_stock_count_history_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'SellerTray Count History Test',
  'sellertray-count-history-'||substr(tenant_id::text,1,8),'SCH','active'
from sellertray_stock_count_history_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from sellertray_stock_count_history_fixture);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner'
from sellertray_stock_count_history_fixture;

update sellertray_stock_count_history_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

update sellertray_stock_count_history_fixture f
set location_id=sl.id
from public.stock_locations sl
where sl.tenant_id=f.tenant_id and sl.branch_id=f.branch_id and sl.is_default=true;

insert into public.catalog_items(
  id,tenant_id,name,sku,price_ngn,is_active,stock_uom,allow_fractional_stock
)
select product_id,tenant_id,'History Count Item','HCOUNT-1',100,true,'Each',false
from sellertray_stock_count_history_fixture;

update sellertray_stock_count_history_fixture f
set stock_uom_id=u.id
from public.catalog_item_uoms u
where u.tenant_id=f.tenant_id
  and u.catalog_item_id=f.product_id
  and lower(u.uom_name)='each';

select public.record_sellertray_inventory_movement(
  tenant_id,branch_id,location_id,product_id,
  'opening',5,'Each',5,1,
  'opening_stock','HCOUNT-OPEN','opening:HCOUNT-OPEN',
  now(),owner_user_id,'Opening stock for history test','{}'::jsonb,null
)
from sellertray_stock_count_history_fixture;

update sellertray_stock_count_history_fixture
set count_id=(public.start_sellertray_stock_count(
  tenant_id,branch_id,'HCOUNT-001','Physical count history test',owner_user_id
)->>'countId')::uuid;

select public.capture_sellertray_stock_count_item(
  tenant_id,count_id,product_id,stock_uom_id,4,owner_user_id
)
from sellertray_stock_count_history_fixture;

do $$
begin
  begin
    update public.stock_count_items
    set expected_stock_quantity=999
    where stock_count_id=(select count_id from sellertray_stock_count_history_fixture);
  exception when sqlstate '55000' then
    update sellertray_stock_count_history_fixture set baseline_change_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select baseline_change_rejected from sellertray_stock_count_history_fixture),
  'captured expected-stock baseline cannot be rewritten directly'
);

select public.capture_sellertray_stock_count_item(
  tenant_id,count_id,product_id,stock_uom_id,3,owner_user_id
)
from sellertray_stock_count_history_fixture;

select extensions.ok(
  exists(
    select 1 from public.stock_count_items sci
    where sci.stock_count_id=(select count_id from sellertray_stock_count_history_fixture)
      and sci.expected_stock_quantity=5
      and sci.counted_stock_quantity=3
      and sci.variance_quantity=-2
  ),
  'governed correction changes the physical count while preserving the original expected snapshot'
);

select public.submit_sellertray_stock_count(
  tenant_id,count_id,owner_user_id
)
from sellertray_stock_count_history_fixture;

do $$
begin
  begin
    update public.stock_count_items
    set counted_quantity=2
    where stock_count_id=(select count_id from sellertray_stock_count_history_fixture);
  exception when sqlstate '55000' then
    update sellertray_stock_count_history_fixture set review_item_change_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select review_item_change_rejected from sellertray_stock_count_history_fixture),
  'count item facts become immutable when review begins'
);

do $$
begin
  begin
    update public.stock_counts
    set reference='HCOUNT-TAMPERED'
    where id=(select count_id from sellertray_stock_count_history_fixture);
  exception when sqlstate '55000' then
    update sellertray_stock_count_history_fixture set identity_change_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select identity_change_rejected from sellertray_stock_count_history_fixture),
  'stock count identity and start facts cannot be rewritten'
);

select public.apply_sellertray_stock_count(
  tenant_id,count_id,owner_user_id
)
from sellertray_stock_count_history_fixture;

select extensions.is(
  (
    select status from public.stock_counts
    where id=(select count_id from sellertray_stock_count_history_fixture)
  ),
  'applied','governed review-to-apply transition remains allowed'
);

do $$
begin
  begin
    update public.stock_counts
    set status='review',applied_by_user_id=null,applied_at=null
    where id=(select count_id from sellertray_stock_count_history_fixture);
  exception when sqlstate '55000' then
    update sellertray_stock_count_history_fixture set terminal_change_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select terminal_change_rejected from sellertray_stock_count_history_fixture),
  'applied stock count history cannot be reopened or rewritten'
);

do $$
begin
  begin
    delete from public.stock_count_items
    where stock_count_id=(select count_id from sellertray_stock_count_history_fixture);
  exception when sqlstate '55000' then
    update sellertray_stock_count_history_fixture set item_delete_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select item_delete_rejected from sellertray_stock_count_history_fixture),
  'stock count item history cannot be deleted while the business exists'
);

do $$
begin
  begin
    delete from public.stock_counts
    where id=(select count_id from sellertray_stock_count_history_fixture);
  exception when sqlstate '55000' then
    update sellertray_stock_count_history_fixture set count_delete_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select count_delete_rejected from sellertray_stock_count_history_fixture),
  'stock count session history cannot be deleted while the business exists'
);

delete from public.tenants
where id=(select tenant_id from sellertray_stock_count_history_fixture);

select extensions.is(
  (
    select count(*)::integer from public.stock_counts sc
    where sc.tenant_id=(select tenant_id from sellertray_stock_count_history_fixture)
  ),
  0,'governed Tenant deletion can cascade through protected stock count history'
);

select extensions.is(
  (
    select count(*)::integer from public.stock_count_items sci
    where sci.tenant_id=(select tenant_id from sellertray_stock_count_history_fixture)
  ),
  0,'governed Tenant deletion removes dependent stock count items'
);

select * from extensions.finish();
rollback;