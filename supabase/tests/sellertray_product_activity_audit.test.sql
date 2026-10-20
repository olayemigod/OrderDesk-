begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(12);

select extensions.ok(
  to_regclass('public.sellertray_product_activity_events') is not null,
  'Product activity audit table exists'
);
select extensions.ok(
  (select c.relrowsecurity from pg_class c where c.oid='public.sellertray_product_activity_events'::regclass),
  'Product activity audit table has RLS enabled'
);
select extensions.ok(
  (
    select p.prosecdef and p.provolatile='s'
    from pg_proc p
    where p.oid=to_regprocedure('public.get_sellertray_product_activity(uuid,uuid,integer)')
  ),
  'Product activity read is stable and SECURITY DEFINER'
);
select extensions.ok(
  has_function_privilege('authenticated','public.get_sellertray_product_activity(uuid,uuid,integer)','EXECUTE')
  and not has_function_privilege('anon','public.get_sellertray_product_activity(uuid,uuid,integer)','EXECUTE'),
  'Product activity read is authenticated-only'
);
select extensions.ok(
  not has_table_privilege('authenticated','public.sellertray_product_activity_events','SELECT'),
  'authenticated clients cannot read internal Product audit rows directly'
);
select extensions.ok(
  exists(
    select 1 from pg_trigger t
    where t.tgrelid='public.sellertray_product_activity_events'::regclass
      and t.tgname='guard_sellertray_product_activity_immutability'
      and not t.tgisinternal
  ),
  'Product activity audit rows are guarded as immutable'
);
select extensions.ok(
  exists(select 1 from pg_trigger t where t.tgrelid='public.catalog_items'::regclass and t.tgname='capture_sellertray_product_activity' and not t.tgisinternal)
  and exists(select 1 from pg_trigger t where t.tgrelid='public.catalog_item_uoms'::regclass and t.tgname='capture_sellertray_product_uom_activity' and not t.tgisinternal),
  'Product and UOM mutations feed the shared activity audit'
);

create temp table sellertray_product_activity_fixture (
  tenant_id uuid not null,
  owner_user_id uuid not null,
  product_id uuid,
  branch_id uuid,
  location_id uuid,
  activity jsonb
) on commit drop;

insert into sellertray_product_activity_fixture(tenant_id,owner_user_id)
values(gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,raw_user_meta_data,created_at,updated_at)
select owner_user_id,'activity-owner-'||substr(owner_user_id::text,1,8)||'@example.com','authenticated','authenticated',jsonb_build_object('full_name','Activity Owner'),now(),now()
from sellertray_product_activity_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'SellerTray Product Activity Test','sellertray-product-activity-'||substr(tenant_id::text,1,8),'PAT','active'
from sellertray_product_activity_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from sellertray_product_activity_fixture);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner'
from sellertray_product_activity_fixture;

update sellertray_product_activity_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

update sellertray_product_activity_fixture f
set location_id=sl.id
from public.stock_locations sl
where sl.tenant_id=f.tenant_id and sl.branch_id=f.branch_id and sl.is_default=true;

select set_config('request.jwt.claim.sub',(select owner_user_id::text from sellertray_product_activity_fixture),true);
select set_config('request.jwt.claim.role','authenticated',true);

select public.create_sellertray_product_category(tenant_id,'QA')
from sellertray_product_activity_fixture;
select public.create_sellertray_business_uom(tenant_id,'Box')
from sellertray_product_activity_fixture;

update sellertray_product_activity_fixture
set product_id=public.save_sellertray_product(
  tenant_id,null,'Activity Product','ACT-001','QA','Each',false,1000
);

select public.save_sellertray_product_uom(
  tenant_id,product_id,null,'Box',12,11000,'ACT-BOX-001',false,false,true
)
from sellertray_product_activity_fixture;

select public.set_sellertray_product_active(tenant_id,product_id,false)
from sellertray_product_activity_fixture;

select public.record_sellertray_inventory_movement(
  tenant_id,branch_id,location_id,product_id,'opening',3,'Each',3,1,
  'opening_stock','ACT-OPEN-001','product-activity:open:1','2026-10-17 12:00:00+00'::timestamptz,
  owner_user_id,'Product activity fixture','{}'::jsonb,null
)
from sellertray_product_activity_fixture;

update sellertray_product_activity_fixture
set activity=public.get_sellertray_product_activity(tenant_id,product_id,100);

select extensions.ok(
  exists(
    select 1
    from sellertray_product_activity_fixture f,jsonb_array_elements(f.activity) a
    where a->>'kind'='configuration'
      and a->>'eventType'='product_created'
      and a->>'actorName'='Activity Owner'
  ),
  'Product creation is captured with actor attribution'
);
select extensions.ok(
  exists(
    select 1
    from sellertray_product_activity_fixture f,jsonb_array_elements(f.activity) a
    where a->>'kind'='configuration'
      and a->>'eventType'='unit_added'
      and a->'details'->'after'->>'uom_name'='Box'
  ),
  'alternate UOM creation is captured in Product activity'
);
select extensions.ok(
  exists(
    select 1
    from sellertray_product_activity_fixture f,jsonb_array_elements(f.activity) a
    where a->>'kind'='configuration'
      and a->>'eventType'='product_archived'
  ),
  'Product archive is captured in Product activity'
);
select extensions.ok(
  exists(
    select 1
    from sellertray_product_activity_fixture f,jsonb_array_elements(f.activity) a
    where a->>'kind'='stock'
      and a->>'eventType'='opening'
      and (a->>'quantityDelta')::numeric=3
      and a->>'stockUom'='Each'
      and nullif(a->>'branchName','') is not null
      and a->>'referenceId'='ACT-OPEN-001'
  ),
  'Product activity merges governed stock movement history with Branch context'
);
select extensions.is(
  (
    select count(*)::integer
    from public.inventory_movements im
    where im.tenant_id=(select tenant_id from sellertray_product_activity_fixture)
      and im.catalog_item_id=(select product_id from sellertray_product_activity_fixture)
  ),
  1,
  'reading Product activity does not create or duplicate stock movements'
);

select * from extensions.finish();
rollback;
