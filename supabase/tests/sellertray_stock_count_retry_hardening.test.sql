begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(16);

create temp table sellertray_count_retry_fixture (
  tenant_id uuid not null,
  owner_user_id uuid not null,
  staff_user_id uuid not null,
  product_id uuid not null,
  branch_id uuid,
  location_id uuid,
  stock_uom_id uuid,
  count_id uuid,
  second_count_id uuid,
  first_capture jsonb,
  retry_capture jsonb,
  correction_capture jsonb,
  apply_result jsonb,
  cancel_result jsonb,
  cancelled_replay_denied boolean not null default false
) on commit drop;

insert into sellertray_count_retry_fixture(
  tenant_id,owner_user_id,staff_user_id,product_id
)
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_user_id,
  'count-retry-owner-'||substr(owner_user_id::text,1,8)||'@example.com',
  'authenticated','authenticated',now(),now()
from sellertray_count_retry_fixture
union all
select staff_user_id,
  'count-retry-staff-'||substr(staff_user_id::text,1,8)||'@example.com',
  'authenticated','authenticated',now(),now()
from sellertray_count_retry_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'SellerTray Count Retry Test',
  'sellertray-count-retry-'||substr(tenant_id::text,1,8),'SCR','active'
from sellertray_count_retry_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from sellertray_count_retry_fixture);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner' from sellertray_count_retry_fixture
union all
select tenant_id,staff_user_id,'staff' from sellertray_count_retry_fixture;

update sellertray_count_retry_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

update sellertray_count_retry_fixture f
set location_id=sl.id
from public.stock_locations sl
where sl.tenant_id=f.tenant_id
  and sl.branch_id=f.branch_id
  and sl.is_default=true;

insert into public.catalog_items(
  id,tenant_id,name,sku,price_ngn,is_active,stock_uom,allow_fractional_stock
)
select product_id,tenant_id,'Retry Count Product','RETRY-COUNT',100,true,'Each',false
from sellertray_count_retry_fixture;

update sellertray_count_retry_fixture f
set stock_uom_id=u.id
from public.catalog_item_uoms u
where u.tenant_id=f.tenant_id
  and u.catalog_item_id=f.product_id
  and lower(u.uom_name)='each';

select public.record_sellertray_inventory_movement(
  tenant_id,branch_id,location_id,product_id,
  'opening',10,'Each',10,1,
  'opening_stock','COUNT-RETRY-OPEN','count-retry:open',
  now(),owner_user_id,'Opening retry test stock','{}'::jsonb,null
)
from sellertray_count_retry_fixture;

select extensions.ok(
  public.set_sellertray_member_capability(
    (select tenant_id from sellertray_count_retry_fixture),
    (select staff_user_id from sellertray_count_retry_fixture),
    'can_count_stock',true,
    (select owner_user_id from sellertray_count_retry_fixture)
  ),
  'Owner grants Staff stock count authority'
);

update sellertray_count_retry_fixture
set first_capture=null;

with started as (
  select public.start_sellertray_stock_count(
    tenant_id,branch_id,'COUNT-RETRY-001','Retry safety count',staff_user_id
  ) result
  from sellertray_count_retry_fixture
)
update sellertray_count_retry_fixture
set count_id=(select (result->>'countId')::uuid from started);

select extensions.is(
  (select sc.status from public.stock_counts sc where sc.id=(select count_id from sellertray_count_retry_fixture)),
  'counting','retry test count starts in counting state'
);

update sellertray_count_retry_fixture
set first_capture=public.capture_sellertray_stock_count_item(
  tenant_id,count_id,product_id,stock_uom_id,8,staff_user_id
);

select extensions.is(
  (select (first_capture->>'countedStockQuantity')::numeric from sellertray_count_retry_fixture),
  8::numeric,'first physical capture records eight units'
);

select extensions.ok(
  exists(
    select 1 from public.stock_count_items sci
    where sci.stock_count_id=(select count_id from sellertray_count_retry_fixture)
      and sci.expected_stock_quantity=10
      and sci.counted_stock_quantity=8
      and sci.variance_quantity=-2
  ),
  'first capture snapshots expected ten and variance negative two'
);

select public.record_sellertray_inventory_movement(
  tenant_id,branch_id,location_id,product_id,
  'adjustment',-2,'Each',2,1,
  'test_after_count','COUNT-RETRY-LATER','count-retry:later',
  now(),owner_user_id,'Movement after first capture','{}'::jsonb,null
)
from sellertray_count_retry_fixture;

select extensions.is(
  (
    select s.quantity_on_hand
    from public.get_sellertray_branch_stock(
      (select tenant_id from sellertray_count_retry_fixture),
      (select branch_id from sellertray_count_retry_fixture)
    ) s
    where s.catalog_item_id=(select product_id from sellertray_count_retry_fixture)
  ),
  8::numeric,'later movement changes live stock after the physical capture'
);

update sellertray_count_retry_fixture
set retry_capture=public.capture_sellertray_stock_count_item(
  tenant_id,count_id,product_id,stock_uom_id,8,staff_user_id
);

select extensions.is(
  (select retry_capture->>'idempotentReplay' from sellertray_count_retry_fixture),
  'true','same-fact capture retry is idempotent'
);

select extensions.ok(
  exists(
    select 1 from public.stock_count_items sci
    where sci.stock_count_id=(select count_id from sellertray_count_retry_fixture)
      and sci.expected_stock_quantity=10
      and sci.counted_stock_quantity=8
      and sci.variance_quantity=-2
  ),
  'same-fact retry does not recalculate expected stock after later movement'
);

update sellertray_count_retry_fixture
set correction_capture=public.capture_sellertray_stock_count_item(
  tenant_id,count_id,product_id,stock_uom_id,7,staff_user_id
);

select extensions.is(
  (select correction_capture->>'idempotentReplay' from sellertray_count_retry_fixture),
  'false','changed physical quantity is treated as a correction rather than a retry'
);

select extensions.ok(
  exists(
    select 1 from public.stock_count_items sci
    where sci.stock_count_id=(select count_id from sellertray_count_retry_fixture)
      and sci.expected_stock_quantity=10
      and sci.counted_stock_quantity=7
      and sci.variance_quantity=-3
  ),
  'corrected count keeps the original expected-stock baseline'
);

select extensions.is(
  (
    select public.submit_sellertray_stock_count(
      tenant_id,count_id,staff_user_id
    )->>'status'
    from sellertray_count_retry_fixture
  ),
  'review','corrected count can move to review'
);

update sellertray_count_retry_fixture
set apply_result=public.apply_sellertray_stock_count(
  tenant_id,count_id,owner_user_id
);

select extensions.is(
  (select apply_result->>'status' from sellertray_count_retry_fixture),
  'applied','Owner can apply the corrected reviewed count'
);

select extensions.is(
  (
    select s.quantity_on_hand
    from public.get_sellertray_branch_stock(
      (select tenant_id from sellertray_count_retry_fixture),
      (select branch_id from sellertray_count_retry_fixture)
    ) s
    where s.catalog_item_id=(select product_id from sellertray_count_retry_fixture)
  ),
  5::numeric,'applying corrected variance preserves the later two-unit movement'
);

with started as (
  select public.start_sellertray_stock_count(
    tenant_id,branch_id,'COUNT-RETRY-002','Cancellation replay authority test',staff_user_id
  ) result
  from sellertray_count_retry_fixture
)
update sellertray_count_retry_fixture
set second_count_id=(select (result->>'countId')::uuid from started);

select extensions.is(
  (select sc.status from public.stock_counts sc where sc.id=(select second_count_id from sellertray_count_retry_fixture)),
  'counting','second count starts for cancellation replay test'
);

update sellertray_count_retry_fixture
set cancel_result=public.cancel_sellertray_stock_count(
  tenant_id,second_count_id,'No longer required',staff_user_id
);

select extensions.is(
  (select cancel_result->>'status' from sellertray_count_retry_fixture),
  'cancelled','authorised Staff can cancel their counting session'
);

select extensions.ok(
  not public.set_sellertray_member_capability(
    (select tenant_id from sellertray_count_retry_fixture),
    (select staff_user_id from sellertray_count_retry_fixture),
    'can_count_stock',false,
    (select owner_user_id from sellertray_count_retry_fixture)
  ),
  'Owner can revoke Staff count authority after cancellation'
);

do $$
begin
  begin
    perform public.cancel_sellertray_stock_count(
      (select tenant_id from sellertray_count_retry_fixture),
      (select second_count_id from sellertray_count_retry_fixture),
      'Replay after permission revoked',
      (select staff_user_id from sellertray_count_retry_fixture)
    );
  exception when sqlstate '42501' then
    update sellertray_count_retry_fixture set cancelled_replay_denied=true;
  end;
end
$$;

select extensions.ok(
  (select cancelled_replay_denied from sellertray_count_retry_fixture),
  'cancelled-count replay rechecks current branch capability before returning identifiers'
);

select * from extensions.finish();
rollback;