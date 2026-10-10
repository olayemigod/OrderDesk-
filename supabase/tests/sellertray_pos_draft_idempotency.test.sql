begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(14);

select extensions.ok(
  to_regclass('public.sellertray_pos_draft_requests') is not null,
  'POS draft request ledger exists'
);

select extensions.ok(
  not has_table_privilege('authenticated','public.sellertray_pos_draft_requests','SELECT')
  and not has_table_privilege('authenticated','public.sellertray_pos_draft_requests','INSERT')
  and not has_table_privilege('authenticated','public.sellertray_pos_draft_requests','UPDATE')
  and not has_table_privilege('authenticated','public.sellertray_pos_draft_requests','DELETE'),
  'client sessions cannot read or mutate POS request history'
);

select extensions.ok(
  has_function_privilege('service_role','public.create_sellertray_pos_order_idempotent(uuid,uuid,text,text,text,jsonb,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.create_sellertray_pos_order_idempotent(uuid,uuid,text,text,text,jsonb,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.create_sellertray_pos_order_idempotent(uuid,uuid,text,text,text,jsonb,uuid)','EXECUTE'),
  'idempotent POS draft creation is service-only'
);

select extensions.ok(
  exists(
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='create_sellertray_pos_order_idempotent'
      and lower(pg_get_functiondef(p.oid)) like '%pg_advisory_xact_lock%'
      and lower(pg_get_functiondef(p.oid)) like '%sha256%'
      and lower(pg_get_functiondef(p.oid)) like '%create_sellertray_pos_order_atomic%'
  ),
  'POS idempotency wrapper locks request identity, fingerprints payload and reuses the shared creator'
);

create temporary table pos_idempotency_fixture(
  tenant_id uuid not null,
  product_id uuid not null,
  branch_id uuid,
  pack_uom_id uuid,
  request_id uuid not null,
  first_payload jsonb,
  replay_payload jsonb,
  second_payload jsonb,
  conflict_rejected boolean not null default false
) on commit drop;

insert into pos_idempotency_fixture(tenant_id,product_id,request_id)
values(
  'b1000000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000001',
  'b3000000-0000-4000-8000-000000000001'
);

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'POS Idempotency Test','pos-idempotency-test','PIT','active'
from pos_idempotency_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from pos_idempotency_fixture);

update pos_idempotency_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

insert into public.catalog_items(
  id,tenant_id,name,sku,price_ngn,is_active,stock_uom,allow_fractional_stock
)
select product_id,tenant_id,'Offline Retry Drink','OFF-RETRY',100,true,'Bottle',false
from pos_idempotency_fixture;

with inserted as (
  insert into public.catalog_item_uoms(
    tenant_id,catalog_item_id,uom_name,conversion_factor,selling_price,
    allow_fractional,is_default_selling
  )
  select tenant_id,product_id,'Pack',12,1050,false,false
  from pos_idempotency_fixture
  returning id
)
update pos_idempotency_fixture
set pack_uom_id=(select id from inserted);

update pos_idempotency_fixture f
set first_payload=public.create_sellertray_pos_order_idempotent(
  f.tenant_id,f.branch_id,null,null,'Offline-safe retry',
  jsonb_build_array(jsonb_build_object(
    'catalog_item_id',f.product_id,
    'uom_id',f.pack_uom_id,
    'quantity',2
  )),
  f.request_id
);

update pos_idempotency_fixture f
set replay_payload=public.create_sellertray_pos_order_idempotent(
  f.tenant_id,f.branch_id,null,null,'Offline-safe retry',
  jsonb_build_array(jsonb_build_object(
    'catalog_item_id',f.product_id,
    'uom_id',f.pack_uom_id,
    'quantity',2
  )),
  f.request_id
);

select extensions.ok(
  not ((select first_payload from pos_idempotency_fixture)->>'idempotentReplay')::boolean,
  'first POS request creates a new draft'
);

select extensions.ok(
  ((select replay_payload from pos_idempotency_fixture)->>'idempotentReplay')::boolean,
  'exact POS request replay is identified'
);

select extensions.is(
  (select first_payload->>'orderId' from pos_idempotency_fixture),
  (select replay_payload->>'orderId' from pos_idempotency_fixture),
  'exact replay returns the original order'
);

select extensions.is(
  (
    select count(*)::integer
    from public.orders o
    where o.tenant_id=(select tenant_id from pos_idempotency_fixture)
      and o.source='pos'
  ),
  1,
  'exact replay does not create a duplicate POS order'
);

select extensions.is(
  (
    select count(*)::integer
    from public.sellertray_pos_draft_requests r
    where r.tenant_id=(select tenant_id from pos_idempotency_fixture)
  ),
  1,
  'exact replay creates only one request-ledger row'
);

select extensions.is(
  (
    select char_length(r.request_fingerprint)
    from public.sellertray_pos_draft_requests r
    where r.tenant_id=(select tenant_id from pos_idempotency_fixture)
      and r.request_id=(select request_id from pos_idempotency_fixture)
  ),
  64,
  'request ledger stores only a SHA-256 fingerprint for conflict detection'
);

do $$
begin
  begin
    perform public.create_sellertray_pos_order_idempotent(
      (select tenant_id from pos_idempotency_fixture),
      (select branch_id from pos_idempotency_fixture),
      null,null,'Offline-safe retry',
      jsonb_build_array(jsonb_build_object(
        'catalog_item_id',(select product_id from pos_idempotency_fixture),
        'uom_id',(select pack_uom_id from pos_idempotency_fixture),
        'quantity',3
      )),
      (select request_id from pos_idempotency_fixture)
    );
  exception when unique_violation then
    update pos_idempotency_fixture set conflict_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select conflict_rejected from pos_idempotency_fixture),
  'same request key with different sale details is rejected'
);

update pos_idempotency_fixture f
set second_payload=public.create_sellertray_pos_order_idempotent(
  f.tenant_id,f.branch_id,null,null,'Second sale',
  jsonb_build_array(jsonb_build_object(
    'catalog_item_id',f.product_id,
    'uom_id',f.pack_uom_id,
    'quantity',1
  )),
  'b3000000-0000-4000-8000-000000000002'
);

select extensions.is(
  (
    select count(*)::integer
    from public.orders o
    where o.tenant_id=(select tenant_id from pos_idempotency_fixture)
      and o.source='pos'
  ),
  2,
  'a different request key can create a distinct POS draft'
);

select extensions.throws_ok(
  $$
    update public.sellertray_pos_draft_requests
    set request_fingerprint=request_fingerprint
    where tenant_id='b1000000-0000-4000-8000-000000000001'
  $$,
  '55000',
  'SellerTray POS request history is immutable',
  'POS request history cannot be updated directly'
);

select extensions.throws_ok(
  $$
    delete from public.sellertray_pos_draft_requests
    where tenant_id='b1000000-0000-4000-8000-000000000001'
  $$,
  '55000',
  'SellerTray POS request history is immutable',
  'POS request history cannot be deleted directly'
);

delete from public.tenants
where id='b1000000-0000-4000-8000-000000000001';

select extensions.is(
  (
    select count(*)::integer
    from public.sellertray_pos_draft_requests r
    where r.tenant_id='b1000000-0000-4000-8000-000000000001'
  ),
  0,
  'Tenant deletion clears POS request history without weakening ordinary immutability'
);

select * from extensions.finish();
rollback;
