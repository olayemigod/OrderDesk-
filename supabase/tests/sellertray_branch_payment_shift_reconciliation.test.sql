begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(20);

create temp table sellertray_branch_payment_shift_fixture (
  tenant_id uuid not null,
  owner_user_id uuid not null,
  staff_user_id uuid not null,
  product_id uuid not null,
  branch_id uuid,
  branch_two_id uuid,
  location_id uuid,
  stock_uom_id uuid,
  register_id uuid,
  card_method_id uuid,
  unassigned_method_id uuid,
  shift_id uuid,
  card_order_id uuid,
  cash_order_id uuid,
  card_result jsonb,
  cash_result jsonb,
  close_result jsonb,
  staff_assignment_rejected boolean not null default false,
  unassigned_checkout_rejected boolean not null default false
) on commit drop;

insert into sellertray_branch_payment_shift_fixture(
  tenant_id,owner_user_id,staff_user_id,product_id
)
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_user_id,'branch-payment-owner-'||substr(owner_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_branch_payment_shift_fixture
union all
select staff_user_id,'branch-payment-staff-'||substr(staff_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_branch_payment_shift_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'SellerTray Branch Payment Test','sellertray-branch-payment-'||substr(tenant_id::text,1,8),'BPT','active'
from sellertray_branch_payment_shift_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from sellertray_branch_payment_shift_fixture);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner' from sellertray_branch_payment_shift_fixture
union all
select tenant_id,staff_user_id,'staff' from sellertray_branch_payment_shift_fixture;

update sellertray_branch_payment_shift_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

insert into public.branches(tenant_id,code,name,is_default,is_active)
select tenant_id,'PAY2','Payment Branch Two',false,true
from sellertray_branch_payment_shift_fixture;

update sellertray_branch_payment_shift_fixture f
set branch_two_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.code='PAY2';

update sellertray_branch_payment_shift_fixture f
set location_id=sl.id
from public.stock_locations sl
where sl.tenant_id=f.tenant_id and sl.branch_id=f.branch_id and sl.is_default=true;

update sellertray_branch_payment_shift_fixture f
set register_id=r.id
from public.sellertray_registers r
where r.tenant_id=f.tenant_id and r.branch_id=f.branch_id and r.is_default=true;

insert into public.catalog_items(
  id,tenant_id,name,sku,price_ngn,is_active,stock_uom,allow_fractional_stock
)
select product_id,tenant_id,'Branch Payment Product','BRPAY-PRODUCT',100,true,'Each',false
from sellertray_branch_payment_shift_fixture;

update sellertray_branch_payment_shift_fixture f
set stock_uom_id=u.id
from public.catalog_item_uoms u
where u.tenant_id=f.tenant_id and u.catalog_item_id=f.product_id and lower(u.uom_name)='each';

select public.record_sellertray_inventory_movement(
  tenant_id,branch_id,location_id,product_id,
  'opening',20,'Each',20,1,
  'opening_stock','BRPAY-OPENING','branch-payment:opening',
  now(),owner_user_id,'Opening stock for branch payment test','{}'::jsonb,null
)
from sellertray_branch_payment_shift_fixture;

update sellertray_branch_payment_shift_fixture
set card_method_id=(public.upsert_sellertray_payment_method(
  tenant_id,owner_user_id,null,'card_terminal','Moniepoint POS',true,false,20,'live',
  null,null,null,null,'Confirm on the terminal before completing the sale'
)->>'id')::uuid,
    unassigned_method_id=(public.upsert_sellertray_payment_method(
  tenant_id,owner_user_id,null,'card_terminal','Backup POS',true,false,30,'live',
  null,null,null,null,'Backup terminal'
)->>'id')::uuid;

select public.set_sellertray_payment_method_branches(
  tenant_id,card_method_id,array[branch_id],owner_user_id
)
from sellertray_branch_payment_shift_fixture;

select extensions.ok(
  exists(
    select 1
    from public.sellertray_branch_payment_methods bpm
    join sellertray_branch_payment_shift_fixture f on f.tenant_id=bpm.tenant_id
    where bpm.branch_id=f.branch_id
      and bpm.payment_method_id=f.card_method_id
      and bpm.is_enabled=true
  ),
  'Owner can assign an enabled payment method to a Branch'
);

select extensions.ok(
  not exists(
    select 1
    from public.sellertray_branch_payment_methods bpm
    join sellertray_branch_payment_shift_fixture f on f.tenant_id=bpm.tenant_id
    where bpm.branch_id=f.branch_two_id
      and bpm.payment_method_id=f.card_method_id
      and bpm.is_enabled=true
  ),
  'Branch assignment does not leak to another Branch'
);

do $$
begin
  begin
    perform public.set_sellertray_payment_method_branches(
      (select tenant_id from sellertray_branch_payment_shift_fixture),
      (select card_method_id from sellertray_branch_payment_shift_fixture),
      array[(select branch_id from sellertray_branch_payment_shift_fixture)],
      (select staff_user_id from sellertray_branch_payment_shift_fixture)
    );
  exception when sqlstate '42501' then
    update sellertray_branch_payment_shift_fixture set staff_assignment_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select staff_assignment_rejected from sellertray_branch_payment_shift_fixture),
  'Staff cannot manage Branch payment assignments'
);

update sellertray_branch_payment_shift_fixture
set shift_id=(public.open_sellertray_cash_shift(
  tenant_id,branch_id,register_id,1000,staff_user_id
)->>'shiftId')::uuid;

select extensions.ok(
  exists(
    select 1
    from public.sellertray_shift_payment_methods sm
    join sellertray_branch_payment_shift_fixture f on f.shift_id=sm.shift_id
    where sm.method_type='cash' and sm.method_key='cash'
  ),
  'Opening a shift snapshots cash as a reconciliation method'
);

select extensions.ok(
  exists(
    select 1
    from public.sellertray_shift_payment_methods sm
    join sellertray_branch_payment_shift_fixture f on f.shift_id=sm.shift_id
    where sm.payment_method_id=f.card_method_id
      and sm.display_name='Moniepoint POS'
  ),
  'Opening a shift snapshots the Branch card terminal'
);

update sellertray_branch_payment_shift_fixture
set card_order_id=public.create_sellertray_pos_order_atomic(
  tenant_id,branch_id,null,null,'Card terminal counter sale',
  jsonb_build_array(jsonb_build_object(
    'catalog_item_id',product_id,
    'uom_id',stock_uom_id,
    'quantity',1
  ))
);

set local request.jwt.claim.role='service_role';

update sellertray_branch_payment_shift_fixture
set card_result=public.complete_sellertray_pos_sale(
  tenant_id,card_order_id,card_method_id,staff_user_id
);

select extensions.is(
  (select card_result->>'methodType' from sellertray_branch_payment_shift_fixture),
  'card_terminal',
  'POS completion records the selected Branch card terminal method'
);

select extensions.is(
  (
    select p.provider
    from public.order_payments p
    join sellertray_branch_payment_shift_fixture f on f.card_order_id=p.order_id
    where p.status='confirmed'
  ),
  'manual_card',
  'card terminal payment uses the manual card provider classification'
);

select extensions.is(
  (
    select count(*)::integer
    from public.sellertray_shift_payments sp
    join sellertray_branch_payment_shift_fixture f on f.shift_id=sp.shift_id
    where sp.payment_method_id=f.card_method_id
  ),
  1,
  'confirmed card terminal sale is captured in the immutable shift payment ledger'
);

select extensions.is(
  (
    select sp.amount
    from public.sellertray_shift_payments sp
    join sellertray_branch_payment_shift_fixture f on f.shift_id=sp.shift_id
    where sp.payment_method_id=f.card_method_id
  ),
  100::numeric,
  'shift payment ledger preserves the exact card terminal amount'
);

select extensions.is(
  (
    select t.expected_cash
    from public.sellertray_cash_shift_totals(
      (select tenant_id from sellertray_branch_payment_shift_fixture),
      (select shift_id from sellertray_branch_payment_shift_fixture)
    ) t
  ),
  1000::numeric,
  'non-cash settlement does not inflate expected drawer cash'
);

update sellertray_branch_payment_shift_fixture
set cash_order_id=public.create_sellertray_pos_order_atomic(
  tenant_id,branch_id,null,null,'Cash counter sale',
  jsonb_build_array(jsonb_build_object(
    'catalog_item_id',product_id,
    'uom_id',stock_uom_id,
    'quantity',1
  ))
);

update sellertray_branch_payment_shift_fixture
set cash_result=public.complete_sellertray_pos_cash_sale(
  tenant_id,cash_order_id,staff_user_id
);

select extensions.is(
  (select cash_result->>'methodType' from sellertray_branch_payment_shift_fixture),
  'cash',
  'legacy cash checkout delegates to the shared POS completion command'
);

select extensions.is(
  (
    select count(*)::integer
    from public.sellertray_shift_payments sp
    join sellertray_branch_payment_shift_fixture f on f.shift_id=sp.shift_id
    where sp.method_type='cash'
  ),
  1,
  'cash sale is also represented in the all-method shift payment ledger'
);

select extensions.is(
  (
    select t.expected_cash
    from public.sellertray_cash_shift_totals(
      (select tenant_id from sellertray_branch_payment_shift_fixture),
      (select shift_id from sellertray_branch_payment_shift_fixture)
    ) t
  ),
  1100::numeric,
  'only the cash sale changes expected drawer cash'
);

select set_config('request.jwt.claim.sub',(select staff_user_id::text from sellertray_branch_payment_shift_fixture),true);
select set_config('request.jwt.claim.role','authenticated',true);

select extensions.is(
  (
    select (entry->>'amount')::numeric
    from jsonb_array_elements(public.get_sellertray_shift_payment_summary(
      (select tenant_id from sellertray_branch_payment_shift_fixture),
      (select shift_id from sellertray_branch_payment_shift_fixture)
    )) entry
    where entry->>'methodType'='card_terminal'
      and entry->>'displayName'='Moniepoint POS'
  ),
  100::numeric,
  'shift close summary exposes card terminal settlements separately'
);

select extensions.is(
  (
    select (entry->>'amount')::numeric
    from jsonb_array_elements(public.get_sellertray_shift_payment_summary(
      (select tenant_id from sellertray_branch_payment_shift_fixture),
      (select shift_id from sellertray_branch_payment_shift_fixture)
    )) entry
    where entry->>'methodType'='cash'
  ),
  100::numeric,
  'shift close summary exposes cash settlement separately'
);

set local request.jwt.claim.role='service_role';

update sellertray_branch_payment_shift_fixture
set close_result=public.close_sellertray_cash_shift(
  tenant_id,shift_id,1100,null,staff_user_id
);

select extensions.is(
  (select (close_result->>'variance')::numeric from sellertray_branch_payment_shift_fixture),
  0::numeric,
  'shift closes with zero cash variance even when non-cash payments were accepted'
);

select extensions.is(
  (
    select s.amount
    from public.sellertray_shift_payments s
    join sellertray_branch_payment_shift_fixture f on f.shift_id=s.shift_id
    where s.payment_method_id=f.card_method_id
  ),
  100::numeric,
  'non-cash shift payment evidence remains after close'
);

-- An enabled merchant method that is not assigned to the Branch cannot be used
-- for in-person checkout.
update sellertray_branch_payment_shift_fixture
set card_order_id=public.create_sellertray_pos_order_atomic(
  tenant_id,branch_id,null,null,'Unassigned terminal attempt',
  jsonb_build_array(jsonb_build_object(
    'catalog_item_id',product_id,
    'uom_id',stock_uom_id,
    'quantity',1
  ))
);

do $$
begin
  begin
    perform public.complete_sellertray_pos_sale(
      (select tenant_id from sellertray_branch_payment_shift_fixture),
      (select card_order_id from sellertray_branch_payment_shift_fixture),
      (select unassigned_method_id from sellertray_branch_payment_shift_fixture),
      (select owner_user_id from sellertray_branch_payment_shift_fixture)
    );
  exception when sqlstate '23514' then
    update sellertray_branch_payment_shift_fixture set unassigned_checkout_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select unassigned_checkout_rejected from sellertray_branch_payment_shift_fixture),
  'POS checkout rejects a payment method that is not assigned to the sale Branch'
);

select extensions.is(
  (
    select count(*)::integer
    from public.sellertray_shift_payment_methods sm
    join sellertray_branch_payment_shift_fixture f on f.shift_id=sm.shift_id
    where sm.method_type in ('cash','card_terminal')
  ),
  2,
  'shift reconciliation method snapshot contains only cash and the assigned card terminal'
);

select extensions.is(
  (
    select count(*)::integer
    from public.order_payments p
    join sellertray_branch_payment_shift_fixture f on f.card_order_id=p.order_id
  ),
  0,
  'rejected unassigned checkout creates no payment side effect'
);

select * from extensions.finish();
rollback;