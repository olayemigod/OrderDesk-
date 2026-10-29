begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(12);

create temp table sellertray_branch_customer_payment_fixture (
  tenant_id uuid not null,
  customer_id uuid not null,
  branch_id uuid,
  branch_two_id uuid,
  order_id uuid,
  assigned_bank_id uuid not null,
  unassigned_bank_id uuid not null,
  card_method_id uuid not null,
  gateway_method_id uuid not null,
  payment_id uuid,
  unassigned_rejected boolean not null default false
) on commit drop;

insert into sellertray_branch_customer_payment_fixture(
  tenant_id,customer_id,assigned_bank_id,unassigned_bank_id,card_method_id,gateway_method_id
)
values(
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()
);

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'Branch Customer Payment Test','branch-customer-payment-'||substr(tenant_id::text,1,8),'BCP','active'
from sellertray_branch_customer_payment_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from sellertray_branch_customer_payment_fixture);

update sellertray_branch_customer_payment_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

insert into public.branches(tenant_id,code,name,is_default,is_active)
select tenant_id,'BCP2','Customer Payment Branch Two',false,true
from sellertray_branch_customer_payment_fixture;

update sellertray_branch_customer_payment_fixture f
set branch_two_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.code='BCP2';

insert into public.customers(id,tenant_id,wa_id,display_name,phone)
select customer_id,tenant_id,'manual:+234801'||substr(replace(customer_id::text,'-',''),1,7),'Branch Payment Customer','+2348010000000'
from sellertray_branch_customer_payment_fixture;

with inserted as (
  insert into public.orders(
    tenant_id,branch_id,customer_id,status,source,customer_note,parser_source,review_reasons,currency,total_amount
  )
  select tenant_id,branch_id,customer_id,'needs_review','manual','Branch-scoped payment order','manual','{}'::text[],'NGN',2500
  from sellertray_branch_customer_payment_fixture
  returning id
)
update sellertray_branch_customer_payment_fixture f set order_id=i.id from inserted i;

insert into public.order_items(
  tenant_id,order_id,item_name,original_item_name,quantity,unit_price,match_source,match_confidence
)
select tenant_id,order_id,'Branch Payment Item','Branch Payment Item',1,2500,'manual',1
from sellertray_branch_customer_payment_fixture;

update public.orders set status='accepted'
where id=(select order_id from sellertray_branch_customer_payment_fixture);

insert into public.merchant_payment_methods(
  id,tenant_id,method_type,display_name,is_enabled,is_default,sort_order,mode,configuration_status,
  bank_name,bank_account_name,bank_account_number
)
select assigned_bank_id,tenant_id,'bank_transfer','Main Branch Bank',true,true,10,'live','ready','Test Bank','SellerTray Test','1000000001'
from sellertray_branch_customer_payment_fixture
union all
select unassigned_bank_id,tenant_id,'bank_transfer','Other Branch Bank',true,false,20,'live','ready','Other Bank','SellerTray Test','1000000002'
from sellertray_branch_customer_payment_fixture
union all
select card_method_id,tenant_id,'card_terminal','Counter Terminal',true,false,30,'live','ready',null,null,null
from sellertray_branch_customer_payment_fixture
union all
select gateway_method_id,tenant_id,'paystack','Paystack',true,false,40,'test','configured',null,null,null
from sellertray_branch_customer_payment_fixture;

insert into public.sellertray_branch_payment_methods(
  tenant_id,branch_id,payment_method_id,is_enabled
)
select tenant_id,branch_id,assigned_bank_id,true from sellertray_branch_customer_payment_fixture
union all
select tenant_id,branch_two_id,unassigned_bank_id,true from sellertray_branch_customer_payment_fixture
union all
select tenant_id,branch_id,card_method_id,true from sellertray_branch_customer_payment_fixture
union all
select tenant_id,branch_id,gateway_method_id,true from sellertray_branch_customer_payment_fixture;

select extensions.ok(
  has_function_privilege('service_role','public.sellertray_branch_customer_payment_methods(uuid,uuid)','EXECUTE'),
  'service payment flows can read governed Branch customer payment methods'
);
select extensions.ok(
  not has_function_privilege('authenticated','public.sellertray_branch_customer_payment_methods(uuid,uuid)','EXECUTE'),
  'authenticated clients cannot bypass the guarded Branch customer payment reader'
);
select extensions.ok(
  has_function_privilege('authenticated','public.get_sellertray_branch_customer_payment_methods(uuid,uuid)','EXECUTE'),
  'authenticated mobile clients use the guarded Branch customer payment reader'
);
select extensions.ok(
  position('sellertray_branch_payment_methods' in pg_get_functiondef('public.create_sellertray_order_payment_for_method(uuid,uuid,uuid,text,text,text,timestamptz)'::regprocedure)) > 0
  and position('branch_id' in pg_get_functiondef('public.create_sellertray_order_payment_for_method(uuid,uuid,uuid,text,text,text,timestamptz)'::regprocedure)) > 0,
  'payment creation enforces the order Branch assignment centrally'
);
select extensions.ok(
  position('card_terminal' in pg_get_functiondef('public.sellertray_branch_customer_payment_methods(uuid,uuid)'::regprocedure)) = 0,
  'customer payment method discovery excludes in-person card terminals'
);
select extensions.ok(
  exists(
    select 1 from public.sellertray_branch_customer_payment_methods(
      (select tenant_id from sellertray_branch_customer_payment_fixture),
      (select branch_id from sellertray_branch_customer_payment_fixture)
    ) m
    where m.id=(select assigned_bank_id from sellertray_branch_customer_payment_fixture)
  ),
  'assigned bank transfer is available at the order Branch'
);
select extensions.ok(
  exists(
    select 1 from public.sellertray_branch_customer_payment_methods(
      (select tenant_id from sellertray_branch_customer_payment_fixture),
      (select branch_id from sellertray_branch_customer_payment_fixture)
    ) m
    where m.id=(select gateway_method_id from sellertray_branch_customer_payment_fixture)
  ),
  'assigned configured gateway is available at the order Branch'
);
select extensions.ok(
  not exists(
    select 1 from public.sellertray_branch_customer_payment_methods(
      (select tenant_id from sellertray_branch_customer_payment_fixture),
      (select branch_id from sellertray_branch_customer_payment_fixture)
    ) m
    where m.id=(select unassigned_bank_id from sellertray_branch_customer_payment_fixture)
  ),
  'payment method assigned to another Branch is not offered'
);
select extensions.ok(
  not exists(
    select 1 from public.sellertray_branch_customer_payment_methods(
      (select tenant_id from sellertray_branch_customer_payment_fixture),
      (select branch_id from sellertray_branch_customer_payment_fixture)
    ) m
    where m.id=(select card_method_id from sellertray_branch_customer_payment_fixture)
  ),
  'card terminal is not exposed as a customer payment option'
);

update sellertray_branch_customer_payment_fixture
set payment_id=public.create_sellertray_order_payment_for_method(
  tenant_id,order_id,assigned_bank_id,'initiated',null,'branch-customer-payment-assigned',null
);

select extensions.ok(
  (select payment_id from sellertray_branch_customer_payment_fixture) is not null,
  'new payment succeeds when the method is assigned to the order Branch'
);

do $$
begin
  begin
    perform public.create_sellertray_order_payment_for_method(
      (select tenant_id from sellertray_branch_customer_payment_fixture),
      (select order_id from sellertray_branch_customer_payment_fixture),
      (select unassigned_bank_id from sellertray_branch_customer_payment_fixture),
      'initiated',null,'branch-customer-payment-unassigned',null
    );
  exception when sqlstate '23514' then
    update sellertray_branch_customer_payment_fixture set unassigned_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select unassigned_rejected from sellertray_branch_customer_payment_fixture),
  'new payment is rejected when the method is not assigned to the order Branch'
);

update public.sellertray_branch_payment_methods
set is_enabled=false
where tenant_id=(select tenant_id from sellertray_branch_customer_payment_fixture)
  and branch_id=(select branch_id from sellertray_branch_customer_payment_fixture)
  and payment_method_id=(select assigned_bank_id from sellertray_branch_customer_payment_fixture);

select extensions.is(
  public.create_sellertray_order_payment_for_method(
    (select tenant_id from sellertray_branch_customer_payment_fixture),
    (select order_id from sellertray_branch_customer_payment_fixture),
    (select assigned_bank_id from sellertray_branch_customer_payment_fixture),
    'initiated',null,'branch-customer-payment-assigned',null
  ),
  (select payment_id from sellertray_branch_customer_payment_fixture),
  'idempotent replay returns the existing payment after later Branch configuration changes'
);

select * from extensions.finish();
rollback;