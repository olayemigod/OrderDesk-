begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(33);

create temp table sellertray_return_settlement_fixture (
  tenant_id uuid not null,
  owner_user_id uuid not null,
  staff_user_id uuid not null,
  product_id uuid not null,
  branch_id uuid,
  location_id uuid,
  register_id uuid,
  shift_id uuid,
  pack_uom_id uuid,
  pay_later_order_id uuid,
  cash_order_id uuid,
  bank_order_id uuid,
  pay_later_item_id uuid,
  cash_item_id uuid,
  bank_item_id uuid,
  pay_later_checkout jsonb,
  pay_later_return jsonb,
  pay_later_replay jsonb,
  cash_checkout jsonb,
  cash_return jsonb,
  cash_replay jsonb,
  bank_checkout jsonb,
  bank_return jsonb,
  staff_cash_refund_rejected boolean not null default false
) on commit drop;

insert into sellertray_return_settlement_fixture(
  tenant_id,owner_user_id,staff_user_id,product_id
) values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_user_id,
  'return-settlement-owner-'||substr(owner_user_id::text,1,8)||'@example.com',
  'authenticated','authenticated',now(),now()
from sellertray_return_settlement_fixture
union all
select staff_user_id,
  'return-settlement-staff-'||substr(staff_user_id::text,1,8)||'@example.com',
  'authenticated','authenticated',now(),now()
from sellertray_return_settlement_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'SellerTray Return Settlement Test',
  'sellertray-return-settlement-'||substr(tenant_id::text,1,8),'RST','active'
from sellertray_return_settlement_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from sellertray_return_settlement_fixture);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner' from sellertray_return_settlement_fixture
union all
select tenant_id,staff_user_id,'staff' from sellertray_return_settlement_fixture;

update public.merchant_operational_policies
set allow_pos_partial_payments=true,
    allow_pos_pay_later=true,
    allow_pos_split_payments=true,
    updated_at=now()
where tenant_id=(select tenant_id from sellertray_return_settlement_fixture);

update sellertray_return_settlement_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

update sellertray_return_settlement_fixture f
set location_id=sl.id
from public.stock_locations sl
where sl.tenant_id=f.tenant_id and sl.branch_id=f.branch_id and sl.is_default=true;

update sellertray_return_settlement_fixture f
set register_id=r.id
from public.sellertray_registers r
where r.tenant_id=f.tenant_id and r.branch_id=f.branch_id and r.is_default=true;

insert into public.catalog_items(
  id,tenant_id,name,sku,price_ngn,is_active,stock_uom,allow_fractional_stock
)
select product_id,tenant_id,'Return Settlement Drink','RET-SETTLE',100,true,'Bottle',false
from sellertray_return_settlement_fixture;

with inserted_uom as (
  insert into public.catalog_item_uoms(
    tenant_id,catalog_item_id,uom_name,conversion_factor,selling_price,
    allow_fractional,is_default_selling
  )
  select tenant_id,product_id,'Pack',12,1050,false,false
  from sellertray_return_settlement_fixture
  returning id
)
update sellertray_return_settlement_fixture set pack_uom_id=(select id from inserted_uom);

select public.record_sellertray_inventory_movement(
  tenant_id,branch_id,location_id,product_id,
  'opening',60,'Bottle',60,1,
  'opening_stock','RETURN-SETTLEMENT-OPENING','opening:RETURN-SETTLEMENT-OPENING',
  now(),owner_user_id,'Opening stock for receivable-first return test','{}'::jsonb,null
)
from sellertray_return_settlement_fixture;

update sellertray_return_settlement_fixture
set pay_later_order_id=public.create_sellertray_pos_order_atomic(
  tenant_id,branch_id,null,null,'Pay later sale to return',
  jsonb_build_array(jsonb_build_object(
    'catalog_item_id',product_id,'uom_id',pack_uom_id,'quantity',1
  ))
),
cash_order_id=public.create_sellertray_pos_order_atomic(
  tenant_id,branch_id,null,null,'Partial cash sale to return by Cash',
  jsonb_build_array(jsonb_build_object(
    'catalog_item_id',product_id,'uom_id',pack_uom_id,'quantity',1
  ))
),
bank_order_id=public.create_sellertray_pos_order_atomic(
  tenant_id,branch_id,null,null,'Partial cash sale to return by Bank',
  jsonb_build_array(jsonb_build_object(
    'catalog_item_id',product_id,'uom_id',pack_uom_id,'quantity',1
  ))
);

update sellertray_return_settlement_fixture f
set pay_later_item_id=(select oi.id from public.order_items oi where oi.tenant_id=f.tenant_id and oi.order_id=f.pay_later_order_id limit 1),
    cash_item_id=(select oi.id from public.order_items oi where oi.tenant_id=f.tenant_id and oi.order_id=f.cash_order_id limit 1),
    bank_item_id=(select oi.id from public.order_items oi where oi.tenant_id=f.tenant_id and oi.order_id=f.bank_order_id limit 1);

set local request.jwt.claim.role='service_role';

-- Pay Later: merchandise return settles the receivable and produces no payout.
update sellertray_return_settlement_fixture
set pay_later_checkout=public.checkout_sellertray_pos_sale(
  tenant_id,pay_later_order_id,'[]'::jsonb,true,owner_user_id,gen_random_uuid()
);

select extensions.is(
  (select pay_later_checkout->>'status' from sellertray_return_settlement_fixture),
  'completed','Pay Later checkout completes through the governed POS allocation authority'
);
select extensions.is(
  (select pay_later_checkout->>'paymentTerms' from sellertray_return_settlement_fixture),
  'pay_later','Pay Later checkout records explicit receivable terms'
);
select extensions.is(
  (select (pay_later_checkout->>'outstandingAmount')::numeric from sellertray_return_settlement_fixture),
  1050::numeric,'Pay Later sale starts with the full amount outstanding'
);
select extensions.is(
  (select count(*)::integer from public.order_payments p where p.order_id=(select pay_later_order_id from sellertray_return_settlement_fixture)),
  0,'Pay Later sale creates no invented payment evidence'
);

update sellertray_return_settlement_fixture
set pay_later_return=public.return_sellertray_pos_sale(
  tenant_id,pay_later_order_id,owner_user_id,
  'Customer returned the unpaid merchandise',
  jsonb_build_array(jsonb_build_object('orderItemId',pay_later_item_id,'quantity',1)),
  'return-pay-later-001',null
);

select extensions.is(
  (select (pay_later_return->>'receivableReduction')::numeric from sellertray_return_settlement_fixture),
  1050::numeric,'unpaid returned merchandise reduces receivable by the returned value first'
);
select extensions.is(
  (select (pay_later_return->>'refundedAmount')::numeric from sellertray_return_settlement_fixture),
  0::numeric,'unpaid returned merchandise produces no monetary refund'
);
select extensions.is(
  (select count(*)::integer from public.payment_refunds pr where pr.order_id=(select pay_later_order_id from sellertray_return_settlement_fixture)),
  0,'receivable-only return creates no refund evidence'
);
select extensions.is(
  (select sr.original_payment_id from public.sale_returns sr where sr.id=(select (pay_later_return->>'returnId')::uuid from sellertray_return_settlement_fixture)),
  null::uuid,'receivable-only return does not invent an original payment reference'
);

update sellertray_return_settlement_fixture
set pay_later_replay=public.return_sellertray_pos_sale(
  tenant_id,pay_later_order_id,owner_user_id,
  'Customer returned the unpaid merchandise',
  jsonb_build_array(jsonb_build_object('orderItemId',pay_later_item_id,'quantity',1)),
  'return-pay-later-001',null
);
select extensions.is(
  (select pay_later_replay->>'returnId' from sellertray_return_settlement_fixture),
  (select pay_later_return->>'returnId' from sellertray_return_settlement_fixture),
  'receivable-only return retry resolves to the original return'
);

-- Partial Cash: outstanding receivable is settled before only the collected excess is paid back.
update sellertray_return_settlement_fixture
set shift_id=(public.open_sellertray_cash_shift(
  tenant_id,branch_id,register_id,0,owner_user_id
)->>'shiftId')::uuid;

update sellertray_return_settlement_fixture
set cash_checkout=public.checkout_sellertray_pos_sale(
  tenant_id,cash_order_id,
  jsonb_build_array(jsonb_build_object('amount',400,'confirmNow',true)),
  false,owner_user_id,gen_random_uuid()
);

select extensions.is(
  (select cash_checkout->>'status' from sellertray_return_settlement_fixture),
  'completed','partial Cash checkout completes through the governed POS allocation authority'
);
select extensions.is(
  (select cash_checkout->>'paymentTerms' from sellertray_return_settlement_fixture),
  'partial','partial Cash checkout records partial payment terms'
);
select extensions.is(
  (select (cash_checkout->>'amountPaid')::numeric from sellertray_return_settlement_fixture),
  400::numeric,'partial Cash checkout confirms only the money actually collected'
);
select extensions.is(
  (select (cash_checkout->>'outstandingAmount')::numeric from sellertray_return_settlement_fixture),
  650::numeric,'partial Cash checkout exposes the remaining receivable'
);
select extensions.is(
  (select t.expected_cash from public.sellertray_cash_shift_totals(
    (select tenant_id from sellertray_return_settlement_fixture),
    (select shift_id from sellertray_return_settlement_fixture)
  ) t),
  400::numeric,'partial Cash collection increases the active drawer only by collected cash'
);

select public.set_sellertray_member_capability(
  (select tenant_id from sellertray_return_settlement_fixture),
  (select staff_user_id from sellertray_return_settlement_fixture),
  'can_refund_sale',true,
  (select owner_user_id from sellertray_return_settlement_fixture)
);

do $$
begin
  begin
    perform public.return_sellertray_pos_sale(
      (select tenant_id from sellertray_return_settlement_fixture),
      (select cash_order_id from sellertray_return_settlement_fixture),
      (select staff_user_id from sellertray_return_settlement_fixture),
      'Delegated Cashier prepares but must not complete payout',
      jsonb_build_array(jsonb_build_object(
        'orderItemId',(select cash_item_id from sellertray_return_settlement_fixture),
        'quantity',1
      )),
      'return-staff-cash-001','cash'
    );
  exception when sqlstate '42501' then
    update sellertray_return_settlement_fixture set staff_cash_refund_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select staff_cash_refund_rejected from sellertray_return_settlement_fixture),
  'delegated Staff cannot complete a return that requires monetary payout'
);
select extensions.is(
  (select count(*)::integer from public.sale_returns sr where sr.order_id=(select cash_order_id from sellertray_return_settlement_fixture)),
  0,'rejected Staff payout attempt leaves no return effect'
);

update sellertray_return_settlement_fixture
set cash_return=public.return_sellertray_pos_sale(
  tenant_id,cash_order_id,owner_user_id,
  'Owner completes Cash refund after receivable settlement',
  jsonb_build_array(jsonb_build_object('orderItemId',cash_item_id,'quantity',1)),
  'return-owner-cash-001','cash'
);

select extensions.is(
  (select (cash_return->>'receivableReduction')::numeric from sellertray_return_settlement_fixture),
  650::numeric,'partial sale return clears the outstanding receivable before payout'
);
select extensions.is(
  (select (cash_return->>'refundedAmount')::numeric from sellertray_return_settlement_fixture),
  400::numeric,'Cash payout is limited to the excess returned value already collected'
);
select extensions.is(
  (select cash_return->>'refundMethod' from sellertray_return_settlement_fixture),
  'cash','Owner can explicitly choose Cash as the refund payout method'
);
select extensions.is(
  (select pr.amount from public.payment_refunds pr where pr.id=(select (cash_return->>'refundId')::uuid from sellertray_return_settlement_fixture)),
  400::numeric,'Cash refund evidence records only the actual payout amount'
);
select extensions.is(
  (select count(*)::integer from public.sellertray_shift_cash_refunds r where r.refund_id=(select (cash_return->>'refundId')::uuid from sellertray_return_settlement_fixture)),
  1,'Cash payout is immutably attributed to the active drawer'
);
select extensions.is(
  (select t.expected_cash from public.sellertray_cash_shift_totals(
    (select tenant_id from sellertray_return_settlement_fixture),
    (select shift_id from sellertray_return_settlement_fixture)
  ) t),
  0::numeric,'Cash refund reduces the drawer by the actual payout amount'
);

update sellertray_return_settlement_fixture
set cash_replay=public.return_sellertray_pos_sale(
  tenant_id,cash_order_id,owner_user_id,
  'Owner completes Cash refund after receivable settlement',
  jsonb_build_array(jsonb_build_object('orderItemId',cash_item_id,'quantity',1)),
  'return-owner-cash-001','cash'
);
select extensions.is(
  (select cash_replay->>'refundId' from sellertray_return_settlement_fixture),
  (select cash_return->>'refundId' from sellertray_return_settlement_fixture),
  'Cash refund retry resolves to the original payout evidence'
);

-- Bank payout: original collection can be Cash, while the chosen refund payout is Bank.
update sellertray_return_settlement_fixture
set bank_checkout=public.checkout_sellertray_pos_sale(
  tenant_id,bank_order_id,
  jsonb_build_array(jsonb_build_object('amount',400,'confirmNow',true)),
  false,owner_user_id,gen_random_uuid()
);
select extensions.is(
  (select (bank_checkout->>'outstandingAmount')::numeric from sellertray_return_settlement_fixture),
  650::numeric,'second partial sale creates the same governed receivable before Bank refund'
);
select extensions.is(
  (select t.expected_cash from public.sellertray_cash_shift_totals(
    (select tenant_id from sellertray_return_settlement_fixture),
    (select shift_id from sellertray_return_settlement_fixture)
  ) t),
  400::numeric,'second partial Cash collection is present in the drawer before closing'
);

select public.close_sellertray_cash_shift(
  tenant_id,shift_id,400,null,owner_user_id
)
from sellertray_return_settlement_fixture;

update sellertray_return_settlement_fixture
set bank_return=public.return_sellertray_pos_sale(
  tenant_id,bank_order_id,owner_user_id,
  'Owner chooses Bank payout after receivable settlement',
  jsonb_build_array(jsonb_build_object('orderItemId',bank_item_id,'quantity',1)),
  'return-owner-bank-001','bank'
);

select extensions.is(
  (select (bank_return->>'receivableReduction')::numeric from sellertray_return_settlement_fixture),
  650::numeric,'Bank refund path also settles the receivable first'
);
select extensions.is(
  (select (bank_return->>'refundedAmount')::numeric from sellertray_return_settlement_fixture),
  400::numeric,'Bank refund pays only the previously collected excess'
);
select extensions.is(
  (select bank_return->>'refundMethod' from sellertray_return_settlement_fixture),
  'bank','Owner can explicitly choose Bank as the payout method'
);
select extensions.ok(
  exists(
    select 1 from public.payment_refunds pr
    where pr.id=(select (bank_return->>'refundId')::uuid from sellertray_return_settlement_fixture)
      and pr.method_type='bank_transfer'
      and pr.provider='sellertray_bank_refund'
      and pr.amount=400
  ),
  'Bank payout records governed bank refund evidence'
);
select extensions.is(
  (select count(*)::integer from public.sellertray_shift_cash_refunds r where r.refund_id=(select (bank_return->>'refundId')::uuid from sellertray_return_settlement_fixture)),
  0,'Bank payout creates no drawer refund movement'
);
select extensions.is(
  (select t.expected_cash from public.sellertray_cash_shift_totals(
    (select tenant_id from sellertray_return_settlement_fixture),
    (select shift_id from sellertray_return_settlement_fixture)
  ) t),
  400::numeric,'Bank payout leaves the already closed Cash drawer total unchanged'
);

select extensions.is(
  (select s.quantity_on_hand from public.get_sellertray_branch_stock(
    (select tenant_id from sellertray_return_settlement_fixture),
    (select branch_id from sellertray_return_settlement_fixture)
  ) s where s.catalog_item_id=(select product_id from sellertray_return_settlement_fixture)),
  60::numeric,'all three completed returns restore stock through the shared Stock ledger'
);
select extensions.is(
  (select count(*)::integer from public.sale_returns sr where sr.tenant_id=(select tenant_id from sellertray_return_settlement_fixture)),
  3,'only the three authorised return commands persist return evidence'
);

select * from extensions.finish();
rollback;
