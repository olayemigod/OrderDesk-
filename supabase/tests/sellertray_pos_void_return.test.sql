begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(22);

create temp table sellertray_pos_return_fixture (
  tenant_id uuid not null,
  actor_user_id uuid not null,
  staff_user_id uuid not null,
  product_id uuid not null,
  branch_id uuid,
  location_id uuid,
  pack_uom_id uuid,
  void_order_id uuid,
  sale_order_id uuid,
  void_result jsonb,
  void_replay jsonb,
  completion jsonb,
  return_result jsonb,
  return_replay jsonb,
  immutable_rejected boolean not null default false,
  staff_return_rejected boolean not null default false
) on commit drop;

insert into sellertray_pos_return_fixture(tenant_id,actor_user_id,staff_user_id,product_id)
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select actor_user_id,
  'pos-return-owner-'||substr(actor_user_id::text,1,8)||'@example.com',
  'authenticated','authenticated',now(),now()
from sellertray_pos_return_fixture
union all
select staff_user_id,
  'pos-return-staff-'||substr(staff_user_id::text,1,8)||'@example.com',
  'authenticated','authenticated',now(),now()
from sellertray_pos_return_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'SellerTray POS Return Test',
  'sellertray-pos-return-'||substr(tenant_id::text,1,8),'PRT','active'
from sellertray_pos_return_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from sellertray_pos_return_fixture);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,actor_user_id,'owner' from sellertray_pos_return_fixture
union all
select tenant_id,staff_user_id,'staff' from sellertray_pos_return_fixture;

update sellertray_pos_return_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

update sellertray_pos_return_fixture f
set location_id=sl.id
from public.stock_locations sl
where sl.tenant_id=f.tenant_id and sl.branch_id=f.branch_id and sl.is_default=true;

insert into public.catalog_items(
  id,tenant_id,name,sku,price_ngn,is_active,stock_uom,allow_fractional_stock
)
select product_id,tenant_id,'Return Test Drink','RET-DRINK',100,true,'Bottle',false
from sellertray_pos_return_fixture;

with inserted_uom as (
  insert into public.catalog_item_uoms(
    tenant_id,catalog_item_id,uom_name,conversion_factor,selling_price,
    allow_fractional,is_default_selling
  )
  select tenant_id,product_id,'Pack',12,1050,false,false
  from sellertray_pos_return_fixture
  returning id
)
update sellertray_pos_return_fixture set pack_uom_id=(select id from inserted_uom);

select public.record_sellertray_inventory_movement(
  tenant_id,branch_id,location_id,product_id,
  'opening',48,'Bottle',48,1,
  'opening_stock','POS-RETURN-OPENING','opening:POS-RETURN-OPENING',
  now(),actor_user_id,'Opening stock for POS return test','{}'::jsonb,null
)
from sellertray_pos_return_fixture;

update sellertray_pos_return_fixture
set void_order_id=public.create_sellertray_pos_order_atomic(
  tenant_id,branch_id,null,null,'Draft to void',
  jsonb_build_array(jsonb_build_object(
    'catalog_item_id',product_id,'uom_id',pack_uom_id,'quantity',1
  ))
);

update sellertray_pos_return_fixture
set sale_order_id=public.create_sellertray_pos_order_atomic(
  tenant_id,branch_id,null,null,'Completed sale to return',
  jsonb_build_array(jsonb_build_object(
    'catalog_item_id',product_id,'uom_id',pack_uom_id,'quantity',2
  ))
);

set local request.jwt.claim.role='service_role';

select extensions.ok(
  not has_function_privilege('authenticated','public.void_sellertray_pos_draft(uuid,uuid,uuid,text)','EXECUTE')
  and has_function_privilege('service_role','public.void_sellertray_pos_draft(uuid,uuid,uuid,text)','EXECUTE')
  and not has_function_privilege('authenticated','public.return_sellertray_pos_cash_sale(uuid,uuid,uuid,text)','EXECUTE')
  and has_function_privilege('service_role','public.return_sellertray_pos_cash_sale(uuid,uuid,uuid,text)','EXECUTE'),
  'POS void and return commands remain server-only'
);

update sellertray_pos_return_fixture
set void_result=public.void_sellertray_pos_draft(
  tenant_id,void_order_id,actor_user_id,'Customer changed their mind before payment'
);

select extensions.is(
  (select o.status from public.orders o where o.id=(select void_order_id from sellertray_pos_return_fixture)),
  'cancelled','unpaid POS draft can be voided'
);

select extensions.is(
  (select count(*)::integer from public.order_payments p where p.order_id=(select void_order_id from sellertray_pos_return_fixture)),
  0,'voiding a draft creates no payment effect'
);

select extensions.is(
  (
    select count(*)::integer from public.inventory_movements im
    where im.reference_type='order'
      and im.reference_id=(select void_order_id::text from sellertray_pos_return_fixture)
  ),
  0,'voiding a draft creates no stock effect'
);

update sellertray_pos_return_fixture
set void_replay=public.void_sellertray_pos_draft(
  tenant_id,void_order_id,actor_user_id,'Repeated void request'
);

select extensions.is(
  (select void_replay->>'idempotentReplay' from sellertray_pos_return_fixture),
  'true','void retry is idempotent'
);

update sellertray_pos_return_fixture
set completion=public.complete_sellertray_pos_cash_sale(tenant_id,sale_order_id,actor_user_id);

select extensions.is(
  (select completion->>'status' from sellertray_pos_return_fixture),
  'completed','return fixture first completes through governed cash checkout'
);

update sellertray_pos_return_fixture
set return_result=public.return_sellertray_pos_cash_sale(
  tenant_id,sale_order_id,actor_user_id,'Customer returned the complete counter sale'
);

select extensions.is(
  (select return_result->>'returnStatus' from sellertray_pos_return_fixture),
  'returned','completed counter cash sale records a completed return'
);

select extensions.is(
  (select o.status from public.orders o where o.id=(select sale_order_id from sellertray_pos_return_fixture)),
  'completed','return does not rewrite the original completed sale status'
);

select extensions.is(
  (select o.return_status from public.orders o where o.id=(select sale_order_id from sellertray_pos_return_fixture)),
  'returned','order exposes returned projection separately from original status'
);

select extensions.is(
  (select o.returned_amount from public.orders o where o.id=(select sale_order_id from sellertray_pos_return_fixture)),
  2100::numeric,'returned amount matches the original POS cash value'
);

select extensions.is(
  (
    select count(*)::integer from public.order_payments p
    where p.order_id=(select sale_order_id from sellertray_pos_return_fixture)
      and p.method_type='cash' and p.provider='pos_cash' and p.status='confirmed'
  ),
  1,'original confirmed cash payment remains unchanged'
);

select extensions.ok(
  exists(
    select 1 from public.order_financial_documents d
    where d.order_id=(select sale_order_id from sellertray_pos_return_fixture)
      and d.document_type='receipt' and d.status='issued'
  ),
  'original issued payment receipt remains historical evidence'
);

select extensions.is(
  (
    select pr.amount from public.payment_refunds pr
    where pr.order_id=(select sale_order_id from sellertray_pos_return_fixture)
  ),
  2100::numeric,'cash refund evidence is recorded separately from the original payment'
);

select extensions.is(
  (
    select s.quantity_on_hand
    from public.get_sellertray_branch_stock(
      (select tenant_id from sellertray_pos_return_fixture),
      (select branch_id from sellertray_pos_return_fixture)
    ) s
    where s.catalog_item_id=(select product_id from sellertray_pos_return_fixture)
  ),
  48::numeric,'full return restores branch stock in Stock UOM'
);

select extensions.is(
  (
    select count(*)::integer from public.inventory_movements im
    where im.tenant_id=(select tenant_id from sellertray_pos_return_fixture)
      and im.reference_type='sale_return'
      and im.movement_type='sale_return'
      and im.reference_id=(select return_result->>'returnId' from sellertray_pos_return_fixture)
  ),
  1,'return creates one compensating stock movement for the one sale line'
);

select extensions.is(
  (
    select sri.conversion_factor from public.sale_return_items sri
    where sri.sale_return_id=(select (return_result->>'returnId')::uuid from sellertray_pos_return_fixture)
  ),
  12::numeric,'return preserves the transaction UOM conversion snapshot'
);

update sellertray_pos_return_fixture
set return_replay=public.return_sellertray_pos_cash_sale(
  tenant_id,sale_order_id,actor_user_id,'Repeated return request'
);

select extensions.is(
  (select return_replay->>'returnId' from sellertray_pos_return_fixture),
  (select return_result->>'returnId' from sellertray_pos_return_fixture),
  'return retry resolves to the original return'
);

select extensions.is(
  (select return_replay->>'refundId' from sellertray_pos_return_fixture),
  (select return_result->>'refundId' from sellertray_pos_return_fixture),
  'return retry resolves to the original refund evidence'
);

select extensions.is(
  (
    select count(*)::integer from public.payment_refunds pr
    where pr.order_id=(select sale_order_id from sellertray_pos_return_fixture)
  ),
  1,'return retry does not duplicate refund evidence'
);

select extensions.is(
  (
    select count(*)::integer from public.inventory_movements im
    where im.tenant_id=(select tenant_id from sellertray_pos_return_fixture)
      and im.reference_type='sale_return'
      and im.reference_id=(select return_result->>'returnId' from sellertray_pos_return_fixture)
  ),
  1,'return retry does not duplicate stock effects'
);

select extensions.ok(
  exists(
    select 1 from public.commercial_action_ledger l
    where l.tenant_id=(select tenant_id from sellertray_pos_return_fixture)
      and l.target_order_id=(select sale_order_id from sellertray_pos_return_fixture)
      and l.action_type='sale_returned'
      and l.action_status='applied'
  ),
  'completed return leaves a high-risk commercial audit record'
);

do $$
begin
  begin
    perform public.return_sellertray_pos_cash_sale(
      (select tenant_id from sellertray_pos_return_fixture),
      (select sale_order_id from sellertray_pos_return_fixture),
      (select staff_user_id from sellertray_pos_return_fixture),
      'Staff replay should be denied'
    );
  exception when sqlstate '42501' then
    update sellertray_pos_return_fixture set staff_return_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select staff_return_rejected from sellertray_pos_return_fixture),
  'staff cannot return or replay a completed POS cash sale'
);

do $$
begin
  begin
    update public.payment_refunds
    set reason='mutated reason'
    where order_id=(select sale_order_id from sellertray_pos_return_fixture);
  exception when others then
    update sellertray_pos_return_fixture set immutable_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select immutable_rejected from sellertray_pos_return_fixture),
  'posted refund evidence is immutable'
);

select * from extensions.finish();
rollback;