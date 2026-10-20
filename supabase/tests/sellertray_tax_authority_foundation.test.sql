begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(24);

create temp table sellertray_tax_fixture (
  tenant_id uuid not null,
  other_tenant_id uuid not null,
  owner_user_id uuid not null,
  outsider_user_id uuid not null,
  product_id uuid not null,
  branch_id uuid,
  location_id uuid,
  register_id uuid,
  pack_uom_id uuid,
  shift_id uuid,
  taxed_order_id uuid,
  untaxed_order_id uuid,
  taxed_completion jsonb,
  taxed_return jsonb,
  immutable_config_rejected boolean not null default false,
  outsider_read_rejected boolean not null default false
) on commit drop;

insert into sellertray_tax_fixture(
  tenant_id,other_tenant_id,owner_user_id,outsider_user_id,product_id
) values(
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()
);

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_user_id,'tax-owner-'||substr(owner_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_tax_fixture
union all
select outsider_user_id,'tax-outsider-'||substr(outsider_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_tax_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'SellerTray Tax Test','sellertray-tax-'||substr(tenant_id::text,1,8),'TAX','active'
from sellertray_tax_fixture
union all
select other_tenant_id,'SellerTray Tax Other','sellertray-tax-other-'||substr(other_tenant_id::text,1,8),'TXO','active'
from sellertray_tax_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id in (
  (select tenant_id from sellertray_tax_fixture),
  (select other_tenant_id from sellertray_tax_fixture)
);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner' from sellertray_tax_fixture
union all
select other_tenant_id,outsider_user_id,'owner' from sellertray_tax_fixture;

update sellertray_tax_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

update sellertray_tax_fixture f
set location_id=sl.id
from public.stock_locations sl
where sl.tenant_id=f.tenant_id and sl.branch_id=f.branch_id and sl.is_default=true;

update sellertray_tax_fixture f
set register_id=r.id
from public.sellertray_registers r
where r.tenant_id=f.tenant_id and r.branch_id=f.branch_id and r.is_default=true;

insert into public.catalog_items(
  id,tenant_id,name,sku,price_ngn,is_active,stock_uom,allow_fractional_stock
)
select product_id,tenant_id,'Tax Test Drink','TAX-DRINK',100,true,'Bottle',false
from sellertray_tax_fixture;

with inserted_uom as (
  insert into public.catalog_item_uoms(
    tenant_id,catalog_item_id,uom_name,conversion_factor,selling_price,
    allow_fractional,is_default_selling
  )
  select tenant_id,product_id,'Pack',12,1050,false,false
  from sellertray_tax_fixture
  returning id
)
update sellertray_tax_fixture set pack_uom_id=(select id from inserted_uom);

select public.record_sellertray_inventory_movement(
  tenant_id,branch_id,location_id,product_id,
  'opening',96,'Bottle',96,1,
  'opening_stock','TAX-OPENING','opening:TAX-OPENING',
  now(),owner_user_id,'Opening stock for tax authority test','{}'::jsonb,null
)
from sellertray_tax_fixture;

select set_config('request.jwt.claim.sub',(select owner_user_id::text from sellertray_tax_fixture),true);
select set_config('request.jwt.claim.role','authenticated',true);

select extensions.ok(
  to_regprocedure('public.get_sellertray_tax_settings(uuid)') is not null
  and to_regprocedure('public.save_sellertray_tax_settings(uuid,boolean,numeric,boolean)') is not null
  and to_regprocedure('public.quote_sellertray_tax(uuid,numeric)') is not null,
  'governed tax settings and quote RPCs exist'
);

select extensions.ok(
  has_function_privilege('authenticated','public.get_sellertray_tax_settings(uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.save_sellertray_tax_settings(uuid,boolean,numeric,boolean)','EXECUTE')
  and has_function_privilege('authenticated','public.quote_sellertray_tax(uuid,numeric)','EXECUTE')
  and not has_function_privilege('anon','public.get_sellertray_tax_settings(uuid)','EXECUTE'),
  'tax settings are authenticated RPC authority rather than anonymous table access'
);

select extensions.ok(
  not has_table_privilege('authenticated','public.sellertray_tax_configurations','SELECT')
  and not has_table_privilege('authenticated','public.sellertray_tax_configurations','INSERT')
  and not has_table_privilege('authenticated','public.sellertray_tax_configurations','UPDATE'),
  'authenticated clients cannot read or mutate tax history directly'
);

select extensions.is(
  (public.get_sellertray_tax_settings((select tenant_id from sellertray_tax_fixture))->>'isActive')::boolean,
  false,
  'tax defaults to inactive when the Business has no tax configuration'
);

select extensions.is(
  (public.quote_sellertray_tax((select tenant_id from sellertray_tax_fixture),2100)->>'grossAmount')::numeric,
  2100::numeric,
  'inactive tax quote does not add tax'
);

select public.save_sellertray_tax_settings(
  (select tenant_id from sellertray_tax_fixture),true,7.5,true
);

select extensions.is(
  (public.get_sellertray_tax_settings((select tenant_id from sellertray_tax_fixture))->>'revision')::bigint,
  1::bigint,
  'first governed tax configuration is revision one'
);

select extensions.is(
  (public.quote_sellertray_tax((select tenant_id from sellertray_tax_fixture),2100)->>'taxAmount')::numeric,
  157.50::numeric,
  'server tax quote calculates the active Business tax rate'
);

select extensions.is(
  (public.quote_sellertray_tax((select tenant_id from sellertray_tax_fixture),2100)->>'grossAmount')::numeric,
  2257.50::numeric,
  'server tax quote returns subtotal plus tax as gross'
);

select public.save_sellertray_tax_settings(
  (select tenant_id from sellertray_tax_fixture),true,7.5,true
);

select extensions.is(
  (select count(*)::integer from public.sellertray_tax_configurations c
   where c.tenant_id=(select tenant_id from sellertray_tax_fixture)),
  1,
  'retrying identical tax settings is idempotent and does not invent a revision'
);

do $$
begin
  begin
    update public.sellertray_tax_configurations
    set rate_percent=9
    where tenant_id=(select tenant_id from sellertray_tax_fixture);
  exception when sqlstate '55000' then
    update sellertray_tax_fixture set immutable_config_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select immutable_config_rejected from sellertray_tax_fixture),
  'posted tax configuration history cannot be edited in place'
);

update sellertray_tax_fixture
set taxed_order_id=public.create_sellertray_pos_order_atomic(
  tenant_id,branch_id,null,null,'Taxed counter sale',
  jsonb_build_array(jsonb_build_object(
    'catalog_item_id',product_id,'uom_id',pack_uom_id,'quantity',2
  ))
);

update sellertray_tax_fixture
set shift_id=(public.open_sellertray_cash_shift(
  tenant_id,branch_id,register_id,0,owner_user_id
)->>'shiftId')::uuid;

set local request.jwt.claim.role='service_role';

update sellertray_tax_fixture
set taxed_completion=public.complete_sellertray_pos_cash_sale(
  tenant_id,taxed_order_id,owner_user_id
);

select extensions.is(
  (select o.subtotal_amount from public.orders o where o.id=(select taxed_order_id from sellertray_tax_fixture)),
  2100::numeric,
  'posted sale snapshots the pre-tax revenue basis'
);

select extensions.is(
  (select o.tax_amount from public.orders o where o.id=(select taxed_order_id from sellertray_tax_fixture)),
  157.50::numeric,
  'posted sale snapshots authoritative tax'
);

select extensions.is(
  (select o.total_amount from public.orders o where o.id=(select taxed_order_id from sellertray_tax_fixture)),
  2257.50::numeric,
  'orders.total_amount remains the gross payable amount after tax posting'
);

select extensions.is(
  (select d.amount from public.order_financial_documents d
   where d.order_id=(select taxed_order_id from sellertray_tax_fixture) and d.document_type='invoice'),
  2257.50::numeric,
  'issued invoice uses the authoritative gross snapshot'
);

select extensions.is(
  (select p.amount from public.order_payments p
   where p.order_id=(select taxed_order_id from sellertray_tax_fixture) and p.status='confirmed'),
  2257.50::numeric,
  'payment settlement uses the same gross invoice truth'
);

select extensions.is(
  (select sum(oi.tax_amount) from public.order_items oi
   where oi.order_id=(select taxed_order_id from sellertray_tax_fixture)),
  157.50::numeric,
  'line tax allocation reconciles exactly to the order tax snapshot'
);

select set_config('request.jwt.claim.sub',(select owner_user_id::text from sellertray_tax_fixture),true);
select set_config('request.jwt.claim.role','authenticated',true);
select public.save_sellertray_tax_settings(
  (select tenant_id from sellertray_tax_fixture),true,10,false
);

select extensions.is(
  (select o.tax_rate_percent from public.orders o where o.id=(select taxed_order_id from sellertray_tax_fixture)),
  7.5::numeric,
  'later tax-setting changes do not rewrite historical sale rate'
);

select extensions.is(
  (select o.tax_amount from public.orders o where o.id=(select taxed_order_id from sellertray_tax_fixture)),
  157.50::numeric,
  'later tax-setting changes do not rewrite historical tax amount'
);

set local request.jwt.claim.role='service_role';
update sellertray_tax_fixture
set taxed_return=public.return_sellertray_pos_cash_sale(
  tenant_id,taxed_order_id,owner_user_id,'Customer returned one pack',
  jsonb_build_array(jsonb_build_object('orderItemId',(
    select oi.id from public.order_items oi
    where oi.order_id=taxed_order_id order by oi.id limit 1
  ),'quantity',1)),
  'tax-partial-return-1'
);

select extensions.is(
  (select taxed_return->>'refundedSubtotal' from sellertray_tax_fixture)::numeric,
  1050::numeric,
  'partial return reverses the original line subtotal proportionally'
);

select extensions.is(
  (select taxed_return->>'refundedTax' from sellertray_tax_fixture)::numeric,
  78.75::numeric,
  'partial return reverses historical tax rather than the current 10 percent setting'
);

select extensions.is(
  (select taxed_return->>'refundedAmount' from sellertray_tax_fixture)::numeric,
  1128.75::numeric,
  'partial refund gross equals historical subtotal plus historical tax reversal'
);

select extensions.is(
  (select sr.tax_rate_percent from public.sale_returns sr
   where sr.id=(select (taxed_return->>'returnId')::uuid from sellertray_tax_fixture)),
  7.5::numeric,
  'return snapshots the original sale tax rate'
);

select set_config('request.jwt.claim.sub',(select outsider_user_id::text from sellertray_tax_fixture),true);
select set_config('request.jwt.claim.role','authenticated',true);

do $$
begin
  begin
    perform public.get_sellertray_tax_settings((select tenant_id from sellertray_tax_fixture));
  exception when sqlstate '42501' then
    update sellertray_tax_fixture set outsider_read_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select outsider_read_rejected from sellertray_tax_fixture),
  'tax settings fail closed across Business membership boundaries'
);

select set_config('request.jwt.claim.sub',(select owner_user_id::text from sellertray_tax_fixture),true);
select set_config('request.jwt.claim.role','authenticated',true);

select extensions.ok(
  (public.get_sellertray_tax_report_summary(
    (select tenant_id from sellertray_tax_fixture),current_date-1,current_date+1,null,'pos'
  )->>'salesTax')::numeric >= 157.50
  and (public.get_sellertray_tax_report_summary(
    (select tenant_id from sellertray_tax_fixture),current_date-1,current_date+1,null,'pos'
  )->>'returnedTax')::numeric >= 78.75,
  'tax reporting separates posted tax from historical returned tax'
);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='ensure_sellertray_invoice_for_order'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_tax_configurations%'
      and lower(pg_get_functiondef(p.oid)) like '%tax_posted_at%'
  ),
  'shared invoice posting is the tax calculation authority across channels'
);

select * from extensions.finish();
rollback;
