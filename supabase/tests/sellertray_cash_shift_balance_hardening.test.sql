begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(17);

create temp table sellertray_cash_balance_fixture (
  tenant_id uuid not null,
  owner_user_id uuid not null,
  product_id uuid not null,
  branch_id uuid,
  location_id uuid,
  register_id uuid,
  stock_uom_id uuid,
  shift_id uuid,
  first_order_id uuid,
  second_order_id uuid,
  legacy_order_id uuid,
  return_result jsonb,
  return_replay jsonb,
  cash_out_rejected boolean not null default false,
  expense_rejected boolean not null default false,
  refund_overdraw_rejected boolean not null default false
) on commit drop;

insert into sellertray_cash_balance_fixture(tenant_id,owner_user_id,product_id)
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_user_id,'cash-balance-'||substr(owner_user_id::text,1,8)||'@example.com',
  'authenticated','authenticated',now(),now()
from sellertray_cash_balance_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'SellerTray Cash Balance Test',
  'sellertray-cash-balance-'||substr(tenant_id::text,1,8),'CBT','active'
from sellertray_cash_balance_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from sellertray_cash_balance_fixture);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner'
from sellertray_cash_balance_fixture;

update sellertray_cash_balance_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

update sellertray_cash_balance_fixture f
set location_id=sl.id
from public.stock_locations sl
where sl.tenant_id=f.tenant_id and sl.branch_id=f.branch_id and sl.is_default=true;

update sellertray_cash_balance_fixture f
set register_id=r.id
from public.sellertray_registers r
where r.tenant_id=f.tenant_id and r.branch_id=f.branch_id and r.is_default=true;

insert into public.catalog_items(
  id,tenant_id,name,sku,price_ngn,is_active,stock_uom,allow_fractional_stock
)
select product_id,tenant_id,'Cash Balance Product','CASH-BALANCE',100,true,'Each',false
from sellertray_cash_balance_fixture;

update sellertray_cash_balance_fixture f
set stock_uom_id=u.id
from public.catalog_item_uoms u
where u.tenant_id=f.tenant_id and u.catalog_item_id=f.product_id and lower(u.uom_name)='each';

select public.record_sellertray_inventory_movement(
  tenant_id,branch_id,location_id,product_id,
  'opening',20,'Each',20,1,
  'opening_stock','CASH-BALANCE-OPEN','cash-balance:open',
  now(),owner_user_id,'Opening stock for cashier balance test','{}'::jsonb,null
)
from sellertray_cash_balance_fixture;

update sellertray_cash_balance_fixture
set shift_id=(public.open_sellertray_cash_shift(
  tenant_id,branch_id,register_id,100,owner_user_id
)->>'shiftId')::uuid;

select extensions.is(
  (
    select t.expected_cash
    from public.sellertray_cash_shift_totals(
      (select tenant_id from sellertray_cash_balance_fixture),
      (select shift_id from sellertray_cash_balance_fixture)
    ) t
  ),
  100::numeric,'opening cash establishes the drawer balance'
);

do $$
begin
  begin
    perform public.record_sellertray_shift_cash_movement(
      (select tenant_id from sellertray_cash_balance_fixture),
      (select shift_id from sellertray_cash_balance_fixture),
      'cash_out',101,'OVERDRAW-CASH','Attempt to overdraw cash',null,
      (select owner_user_id from sellertray_cash_balance_fixture)
    );
  exception when sqlstate '23514' then
    update sellertray_cash_balance_fixture set cash_out_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select cash_out_rejected from sellertray_cash_balance_fixture),
  'cash out cannot take expected drawer cash below zero'
);

do $$
begin
  begin
    perform public.record_sellertray_shift_cash_movement(
      (select tenant_id from sellertray_cash_balance_fixture),
      (select shift_id from sellertray_cash_balance_fixture),
      'expense',101,'OVERDRAW-EXP','Attempt to overdraw expense','General',
      (select owner_user_id from sellertray_cash_balance_fixture)
    );
  exception when sqlstate '23514' then
    update sellertray_cash_balance_fixture set expense_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select expense_rejected from sellertray_cash_balance_fixture),
  'expense cannot take expected drawer cash below zero'
);

update sellertray_cash_balance_fixture
set first_order_id=public.create_sellertray_pos_order_atomic(
  tenant_id,branch_id,null,null,'First shift cash sale',
  jsonb_build_array(jsonb_build_object(
    'catalog_item_id',product_id,'uom_id',stock_uom_id,'quantity',2
  ))
);

set local request.jwt.claim.role='service_role';

select public.complete_sellertray_pos_cash_sale(tenant_id,first_order_id,owner_user_id)
from sellertray_cash_balance_fixture;

select extensions.is(
  (
    select count(*)::integer from public.sellertray_shift_cash_sales s
    where s.tenant_id=(select tenant_id from sellertray_cash_balance_fixture)
      and s.shift_id=(select shift_id from sellertray_cash_balance_fixture)
  ),
  1,'confirmed cash sale is attached to the locked open shift'
);

select extensions.is(
  (
    select t.expected_cash
    from public.sellertray_cash_shift_totals(
      (select tenant_id from sellertray_cash_balance_fixture),
      (select shift_id from sellertray_cash_balance_fixture)
    ) t
  ),
  300::numeric,'cash sale increases expected drawer cash'
);

update sellertray_cash_balance_fixture
set return_result=public.return_sellertray_pos_cash_sale(
  tenant_id,first_order_id,owner_user_id,'Customer returned first sale'
);

select extensions.is(
  (select return_result->>'returnStatus' from sellertray_cash_balance_fixture),
  'returned','funded cash return completes normally'
);

select extensions.is(
  (
    select count(*)::integer from public.sellertray_shift_cash_refunds r
    where r.tenant_id=(select tenant_id from sellertray_cash_balance_fixture)
      and r.shift_id=(select shift_id from sellertray_cash_balance_fixture)
  ),
  1,'cash refund is attached to the same open shift'
);

select extensions.is(
  (
    select t.expected_cash
    from public.sellertray_cash_shift_totals(
      (select tenant_id from sellertray_cash_balance_fixture),
      (select shift_id from sellertray_cash_balance_fixture)
    ) t
  ),
  100::numeric,'cash refund reduces expected drawer cash exactly once'
);

update sellertray_cash_balance_fixture
set return_replay=public.return_sellertray_pos_cash_sale(
  tenant_id,first_order_id,owner_user_id,'Customer returned first sale'
);

select extensions.is(
  (select return_replay->>'idempotentReplay' from sellertray_cash_balance_fixture),
  'true','cash return retry remains idempotent'
);

select extensions.is(
  (
    select count(*)::integer from public.sellertray_shift_cash_refunds r
    where r.tenant_id=(select tenant_id from sellertray_cash_balance_fixture)
      and r.shift_id=(select shift_id from sellertray_cash_balance_fixture)
  ),
  1,'cash return retry does not duplicate drawer refund evidence'
);

update sellertray_cash_balance_fixture
set second_order_id=public.create_sellertray_pos_order_atomic(
  tenant_id,branch_id,null,null,'Second shift cash sale',
  jsonb_build_array(jsonb_build_object(
    'catalog_item_id',product_id,'uom_id',stock_uom_id,'quantity',2
  ))
);

select public.complete_sellertray_pos_cash_sale(tenant_id,second_order_id,owner_user_id)
from sellertray_cash_balance_fixture;

select public.record_sellertray_shift_cash_movement(
  tenant_id,shift_id,'cash_out',250,'SAFE-DROP-001','Cash removed from drawer',null,owner_user_id
)
from sellertray_cash_balance_fixture;

select extensions.is(
  (
    select t.expected_cash
    from public.sellertray_cash_shift_totals(
      (select tenant_id from sellertray_cash_balance_fixture),
      (select shift_id from sellertray_cash_balance_fixture)
    ) t
  ),
  50::numeric,'cash removal leaves the drawer with fifty expected cash'
);

do $$
begin
  begin
    perform public.return_sellertray_pos_cash_sale(
      (select tenant_id from sellertray_cash_balance_fixture),
      (select second_order_id from sellertray_cash_balance_fixture),
      (select owner_user_id from sellertray_cash_balance_fixture),
      'Refund would overdraw drawer'
    );
  exception when sqlstate '23514' then
    update sellertray_cash_balance_fixture set refund_overdraw_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select refund_overdraw_rejected from sellertray_cash_balance_fixture),
  'cash refund cannot overdraw the active drawer'
);

select extensions.is(
  (
    select o.return_status from public.orders o
    where o.id=(select second_order_id from sellertray_cash_balance_fixture)
  ),
  'none','failed cash refund rolls back the order return projection'
);

select extensions.is(
  (
    select count(*)::integer from public.sale_returns sr
    where sr.order_id=(select second_order_id from sellertray_cash_balance_fixture)
  ),
  0,'failed cash refund rolls back the sale-return aggregate'
);

select extensions.is(
  (
    select count(*)::integer from public.payment_refunds pr
    where pr.order_id=(select second_order_id from sellertray_cash_balance_fixture)
  ),
  0,'failed cash refund leaves no payment-refund evidence'
);

select extensions.is(
  (
    select public.close_sellertray_cash_shift(
      tenant_id,shift_id,50,null,owner_user_id
    )->>'status'
    from sellertray_cash_balance_fixture
  ),
  'closed','drawer closes cleanly after serialized cash activity'
);

update sellertray_cash_balance_fixture
set legacy_order_id=public.create_sellertray_pos_order_atomic(
  tenant_id,branch_id,null,null,'Legacy compatible unshifted sale',
  jsonb_build_array(jsonb_build_object(
    'catalog_item_id',product_id,'uom_id',stock_uom_id,'quantity',1
  ))
);

select extensions.is(
  (
    select public.complete_sellertray_pos_cash_sale(
      tenant_id,legacy_order_id,owner_user_id
    )->>'status'
    from sellertray_cash_balance_fixture
  ),
  'completed','existing server checkout remains compatible when no shift is open'
);

select extensions.is(
  (
    select count(*)::integer from public.sellertray_shift_cash_sales s
    where s.order_id=(select legacy_order_id from sellertray_cash_balance_fixture)
  ),
  0,'unshifted legacy checkout does not fabricate cashier-shift evidence'
);

select * from extensions.finish();
rollback;