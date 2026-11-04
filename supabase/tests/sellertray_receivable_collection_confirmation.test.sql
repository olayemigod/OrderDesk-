begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

-- Disposable fixtures only. Every mutation in this suite rolls back.
create temp table collection_fixture (
  tenant_id uuid default gen_random_uuid(), other_tenant_id uuid default gen_random_uuid(),
  owner_id uuid default gen_random_uuid(), outsider_id uuid default gen_random_uuid(),
  staff_id uuid default gen_random_uuid(), customer_id uuid default gen_random_uuid(),
  product_id uuid default gen_random_uuid(), bank_id uuid default gen_random_uuid(),
  terminal_id uuid default gen_random_uuid(), branch_id uuid, second_branch_id uuid,
  location_id uuid, register_id uuid, shift_id uuid, uom_id uuid
) on commit drop;
insert into collection_fixture default values;
insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_id,'collect-owner-'||owner_id||'@example.com','authenticated','authenticated',now(),now() from collection_fixture
union all select staff_id,'collect-staff-'||staff_id||'@example.com','authenticated','authenticated',now(),now() from collection_fixture
union all select outsider_id,'collect-other-'||outsider_id||'@example.com','authenticated','authenticated',now(),now() from collection_fixture;
insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'Collection Test','collect-'||tenant_id,'RCP','active' from collection_fixture
union all select other_tenant_id,'Foreign Collection Test','collect-'||other_tenant_id,'RCX','active' from collection_fixture;
update public.tenant_subscriptions set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id in (select tenant_id from collection_fixture union all select other_tenant_id from collection_fixture);
insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_id,'owner' from collection_fixture
union all select tenant_id,staff_id,'staff' from collection_fixture
union all select other_tenant_id,outsider_id,'owner' from collection_fixture;
update collection_fixture f set branch_id=b.id from public.branches b where b.tenant_id=f.tenant_id and b.is_default=true;
with b as (
  insert into public.branches(tenant_id,code,name,is_default,is_active)
  select tenant_id,'SECOND','Other Branch',false,true from collection_fixture returning id
) update collection_fixture set second_branch_id=(select id from b);
insert into public.branch_user_access(tenant_id,branch_id,user_id,can_operate)
select tenant_id,second_branch_id,staff_id,true from collection_fixture;
update collection_fixture f set location_id=s.id from public.stock_locations s where s.tenant_id=f.tenant_id and s.branch_id=f.branch_id and s.is_default=true;
update collection_fixture f set register_id=r.id from public.sellertray_registers r where r.tenant_id=f.tenant_id and r.branch_id=f.branch_id and r.is_default=true;
insert into public.merchant_operational_policies(tenant_id,allow_pos_partial_payments,allow_pos_pay_later,pos_manual_confirmation_mode)
select tenant_id,true,true,'payment_manager' from collection_fixture
on conflict(tenant_id) do update set allow_pos_partial_payments=true,allow_pos_pay_later=true,pos_manual_confirmation_mode='payment_manager';
insert into public.customers(id,tenant_id,wa_id,display_name,phone)
select customer_id,tenant_id,'manual:+2348010000099','Collection Customer','+2348010000099' from collection_fixture;
insert into public.catalog_items(id,tenant_id,name,sku,price_ngn,is_active,stock_uom,allow_fractional_stock)
select product_id,tenant_id,'Collection Product','COLLECT-TEST',100,true,'Bottle',false from collection_fixture;
update collection_fixture f set uom_id=u.id from public.catalog_item_uoms u
where u.tenant_id=f.tenant_id and u.catalog_item_id=f.product_id and u.uom_name='Bottle';
insert into public.merchant_payment_methods(id,tenant_id,method_type,display_name,is_enabled,is_default,sort_order,mode,configuration_status,bank_name,bank_account_name,bank_account_number)
select bank_id,tenant_id,'bank_transfer','Collection Bank',true,false,10,'live','ready','Test Bank','Test Account','1000000099' from collection_fixture
union all select terminal_id,tenant_id,'card_terminal','Collection Terminal',true,false,20,'live','ready',null,null,null from collection_fixture;
insert into public.sellertray_branch_payment_methods(tenant_id,branch_id,payment_method_id,is_enabled)
select tenant_id,branch_id,bank_id,true from collection_fixture
union all select tenant_id,branch_id,terminal_id,true from collection_fixture;
select set_config('request.jwt.claim.sub',(select owner_id::text from collection_fixture),true);
set local request.jwt.claim.role='service_role';
select public.record_sellertray_inventory_movement(tenant_id,branch_id,location_id,product_id,
  'opening',20,'Bottle',20,1,'opening_stock','COLLECT-TEST','opening:COLLECT-TEST',now(),owner_id,'Collection test','{}'::jsonb,null)
from collection_fixture;
update collection_fixture set shift_id=(public.open_sellertray_cash_shift(tenant_id,branch_id,register_id,0,owner_id)->>'shiftId')::uuid;

create temp table collections(kind text primary key,order_id uuid,command_id uuid default gen_random_uuid(),result jsonb,replay jsonb,fulfilled_at timestamptz,invoice jsonb) on commit drop;
insert into collections(kind,order_id)
select k,public.create_sellertray_pos_order_atomic(f.tenant_id,f.branch_id,f.owner_id,f.customer_id,null,null,'Collection fixture',
  jsonb_build_array(jsonb_build_object('catalog_item_id',f.product_id,'uom_id',f.uom_id,'quantity',2)))
from collection_fixture f cross join (values('cash'),('card_terminal'),('bank_transfer'),('returned')) v(k);
select public.checkout_sellertray_pos_sale(f.tenant_id,c.order_id,'[]'::jsonb,true,f.owner_id,gen_random_uuid())
from collection_fixture f cross join collections c;
update collections c set fulfilled_at=o.fulfilled_at from public.orders o where o.id=c.order_id;
update collections c set invoice=to_jsonb(d) from public.order_financial_documents d where d.order_id=c.order_id and d.document_type='invoice';
select extensions.is((select count(*)::integer from public.inventory_movements m where m.reference_type='order' and m.reference_id in(select order_id::text from collections) and m.movement_type='sale'),4,'Original pay-later sales post stock once before any collection');

-- The allocator must continue rejecting the inappropriate start state.
select extensions.throws_ok(format(
  'select public.sellertray_record_pos_payment_allocation(%L::uuid,%L::uuid,null,100,''confirmed'',%L::uuid,''direct-confirmed-test'')',
  f.tenant_id,c.order_id,f.owner_id),'22023','Invalid POS payment start state','Direct initially confirmed allocation remains rejected')
from collection_fixture f cross join collections c where c.kind='cash';

set local request.jwt.claim.role='authenticated';
update collections c set result=public.collect_sellertray_customer_receivable(f.tenant_id,c.order_id,
  case c.kind when 'card_terminal' then f.terminal_id when 'bank_transfer' then f.bank_id else null end,200,c.command_id)
from collection_fixture f where c.kind<>'returned';
select extensions.is((select result->>'status' from collections where kind='cash'),'confirmed','Cash uses allocation then governed confirmation');
select extensions.is((select result->>'status' from collections where kind='card_terminal'),'confirmed','Terminal uses allocation then governed confirmation');
select extensions.is((select result->>'status' from collections where kind='bank_transfer'),'pending_verification','Bank stays pending verification');
select extensions.is((select o.amount_paid from public.orders o join collections c on c.order_id=o.id where c.kind='cash'),200::numeric,'Cash reduces receivable by the confirmed amount');
select extensions.is((select o.amount_paid from public.orders o join collections c on c.order_id=o.id where c.kind='bank_transfer'),0::numeric,'Pending Bank never reduces confirmed receivable');
select extensions.is((select t.expected_cash from public.sellertray_cash_shift_totals((select tenant_id from collection_fixture),(select shift_id from collection_fixture)) t),200::numeric,'Only Cash affects the drawer');
select extensions.is((select count(*)::integer from public.sellertray_shift_payments p where p.payment_id in(select (result->>'paymentId')::uuid from collections)),2,'Cash and Terminal each produce one shift allocation');
select extensions.is((select count(*)::integer from public.order_payment_events e where e.payment_id in(select (result->>'paymentId')::uuid from collections) and e.event_type='manual_confirmation'),2,'Canonical confirmation audit event exists for each immediate collection');

-- Replay is checked before the newly reduced outstanding balance.
update collections c set replay=public.collect_sellertray_customer_receivable(f.tenant_id,c.order_id,
  case c.kind when 'card_terminal' then f.terminal_id when 'bank_transfer' then f.bank_id else null end,200,c.command_id)
from collection_fixture f where c.kind<>'returned';
select extensions.ok((select bool_and(result->>'paymentId'=replay->>'paymentId' and (replay->>'idempotentReplay')::boolean) from collections where kind<>'returned'),'Repeated settled and pending commands resolve to the original payment');
select extensions.is((select count(*)::integer from public.order_payments p where p.order_id in(select order_id from collections)),3,'Replay creates no duplicate payment');
select extensions.is((select count(*)::integer from public.order_payment_events e where e.payment_id in(select (result->>'paymentId')::uuid from collections) and e.event_type='manual_confirmation'),2,'Replay creates no duplicate confirmation event');
select extensions.is((select count(*)::integer from public.sellertray_shift_cash_sales p where p.payment_id in(select (result->>'paymentId')::uuid from collections)),1,'Replay creates no duplicate cash evidence');
select extensions.is((select count(*)::integer from public.inventory_movements m where m.reference_type='order' and m.reference_id in(select order_id::text from collections) and m.movement_type='sale'),4,'Collection and replay never post stock again');
select extensions.ok((select bool_and(o.status='completed' and o.fulfillment_status='collected' and o.fulfilled_at=c.fulfilled_at and o.pos_payment_terms='pay_later') from public.orders o join collections c on c.order_id=o.id),'Fulfilment and original credit terms remain unchanged');
select extensions.ok((select bool_and(to_jsonb(d)=c.invoice) from public.order_financial_documents d join collections c on c.order_id=d.order_id where d.document_type='invoice'),'Original issued invoice remains immutable');
select extensions.is((select count(*)::integer from public.order_financial_documents d where d.order_id in(select order_id from collections) and d.document_type='receipt'),2,'Only fully confirmed orders acquire receipt evidence once');

select extensions.throws_ok(format('select public.collect_sellertray_customer_receivable(%L::uuid,%L::uuid,null,199,%L::uuid)',f.tenant_id,c.order_id,c.command_id),
  '23505','SellerTray payment command conflicts with an existing allocation','Changed amount cannot reuse a settled command') from collection_fixture f cross join collections c where c.kind='cash';
select extensions.throws_ok(format('select public.collect_sellertray_customer_receivable(%L::uuid,%L::uuid,null,1,%L::uuid)',f.tenant_id,c.order_id,gen_random_uuid()),
  '23514','Payment exceeds the unreserved customer balance','Pending Bank reserves capacity against another collection') from collection_fixture f cross join collections c where c.kind='bank_transfer';
select extensions.throws_ok(format('select public.collect_sellertray_customer_receivable(%L::uuid,%L::uuid,null,201,%L::uuid)',f.tenant_id,c.order_id,gen_random_uuid()),
  '23514','Payment exceeds the outstanding customer balance','Overpayment remains rejected') from collection_fixture f cross join collections c where c.kind='returned';

-- Foreign membership and Branch scope apply even to a successful replay.
select set_config('request.jwt.claim.sub',(select outsider_id::text from collection_fixture),true);
select extensions.throws_ok(format('select public.collect_sellertray_customer_receivable(%L::uuid,%L::uuid,null,200,%L::uuid)',f.tenant_id,c.order_id,c.command_id),
  '42501','You do not have permission to collect this customer balance','Other-tenant user cannot replay a payment') from collection_fixture f cross join collections c where c.kind='cash';
select extensions.throws_ok(format('select public.collect_sellertray_customer_receivable(%L::uuid,%L::uuid,null,1,%L::uuid)',f.other_tenant_id,c.order_id,gen_random_uuid()),
  'P0002','Sale not found','Foreign Business cannot select the sale') from collection_fixture f cross join collections c where c.kind='returned';
select set_config('request.jwt.claim.sub',(select staff_id::text from collection_fixture),true);
select extensions.throws_ok(format('select public.collect_sellertray_customer_receivable(%L::uuid,%L::uuid,null,200,%L::uuid)',f.tenant_id,c.order_id,c.command_id),
  '42501','You do not have permission to collect this customer balance','Unassigned Branch cannot replay a payment') from collection_fixture f cross join collections c where c.kind='cash';
select extensions.throws_ok(format('select public.collect_sellertray_customer_receivable(%L::uuid,%L::uuid,null,10,%L::uuid)',f.tenant_id,c.order_id,gen_random_uuid()),
  '42501','You do not have permission to collect this customer balance','Unassigned Branch cannot create a payment') from collection_fixture f cross join collections c where c.kind='returned';

-- Assign the cashier to the sale Branch, while retaining manager-only Terminal confirmation.
insert into public.branch_user_access(tenant_id,branch_id,user_id,can_operate)
select tenant_id,branch_id,staff_id,true from collection_fixture
on conflict(tenant_id,branch_id,user_id) do update set can_operate=true;
select extensions.throws_ok(format('select public.collect_sellertray_customer_receivable(%L::uuid,%L::uuid,%L::uuid,10,%L::uuid)',f.tenant_id,c.order_id,f.terminal_id,gen_random_uuid()),
  '42501','You do not have permission to confirm manual payments for this Branch','Terminal confirmation keeps configured manual-payment authority') from collection_fixture f cross join collections c where c.kind='returned';
select extensions.is((select count(*)::integer from public.order_payments p join collections c on c.order_id=p.order_id where c.kind='returned'),0,'Failed confirmation rolls back the new allocation atomically');

-- Completed returns still reduce collectible value.
select set_config('request.jwt.claim.sub',(select owner_id::text from collection_fixture),true);
set local request.jwt.claim.role='service_role';
select public.return_sellertray_pos_sale(f.tenant_id,c.order_id,f.owner_id,'Return one unpaid item',
  jsonb_build_array(jsonb_build_object('orderItemId',oi.id,'quantity',1)),'collection-return-test',null)
from collection_fixture f cross join collections c join public.order_items oi on oi.order_id=c.order_id where c.kind='returned';
set local request.jwt.claim.role='authenticated';
select extensions.throws_ok(format('select public.collect_sellertray_customer_receivable(%L::uuid,%L::uuid,null,101,%L::uuid)',f.tenant_id,c.order_id,gen_random_uuid()),
  '23514','Payment exceeds the outstanding customer balance','Return-adjusted overpayment stays rejected') from collection_fixture f cross join collections c where c.kind='returned';
update collections c set result=public.collect_sellertray_customer_receivable(f.tenant_id,c.order_id,null,100,c.command_id)
from collection_fixture f where c.kind='returned';
select extensions.is((select result->>'status' from collections where kind='returned'),'confirmed','Remaining receivable after a return can be collected');
select extensions.ok(
  has_function_privilege('authenticated','public.collect_sellertray_customer_receivable(uuid,uuid,uuid,numeric,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.collect_sellertray_customer_receivable(uuid,uuid,uuid,numeric,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.confirm_sellertray_offline_payment(uuid,uuid,text)','EXECUTE')
  and not has_function_privilege('authenticated','public.sellertray_record_pos_payment_allocation(uuid,uuid,uuid,numeric,text,uuid,text)','EXECUTE'),
  'Public receivable command retains auth and internal allocation/confirmation remain server-only');

select * from extensions.finish();
rollback;
