begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(5);

select extensions.ok(
  (
    select p.prosecdef and p.provolatile='s'
    from pg_proc p
    where p.oid=to_regprocedure('public.get_sellertray_inventory_product_options(uuid,uuid)')
  ),
  'Inventory Product options read is stable and SECURITY DEFINER'
);

select extensions.ok(
  has_function_privilege('authenticated','public.get_sellertray_inventory_product_options(uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.get_sellertray_inventory_product_options(uuid,uuid)','EXECUTE'),
  'Inventory Product options read is authenticated-only'
);

create temp table sellertray_inventory_options_fixture (
  tenant_id uuid not null,
  owner_user_id uuid not null,
  branch_id uuid,
  product_id uuid,
  options jsonb
) on commit drop;

insert into sellertray_inventory_options_fixture(tenant_id,owner_user_id)
values(gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,raw_user_meta_data,created_at,updated_at)
select owner_user_id,'inventory-options-'||substr(owner_user_id::text,1,8)||'@example.com','authenticated','authenticated',jsonb_build_object('full_name','Inventory Options Owner'),now(),now()
from sellertray_inventory_options_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'SellerTray Inventory Options Test','sellertray-inventory-options-'||substr(tenant_id::text,1,8),'IOT','active'
from sellertray_inventory_options_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from sellertray_inventory_options_fixture);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner'
from sellertray_inventory_options_fixture;

update sellertray_inventory_options_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

select set_config('request.jwt.claim.sub',(select owner_user_id::text from sellertray_inventory_options_fixture),true);
select set_config('request.jwt.claim.role','authenticated',true);

update sellertray_inventory_options_fixture
set product_id=public.save_sellertray_product(
  tenant_id,null,'Inventory Options Product','IOP-001','QA','Each',false,1000
);

select public.save_sellertray_product_uom(
  tenant_id,product_id,null,'Box',12,11000,'IOP-BOX-001',false,false,true
)
from sellertray_inventory_options_fixture;

update sellertray_inventory_options_fixture
set options=public.get_sellertray_inventory_product_options(tenant_id,branch_id);

select extensions.is(
  (
    select count(*)::integer
    from sellertray_inventory_options_fixture f,jsonb_array_elements(f.options) option
    where option->>'id'=f.product_id::text
  ),
  1,
  'Inventory Product options include the active Product exactly once'
);

select extensions.ok(
  exists(
    select 1
    from sellertray_inventory_options_fixture f,jsonb_array_elements(f.options) option,
         jsonb_array_elements(option->'catalog_item_uoms') uom
    where option->>'id'=f.product_id::text
      and uom->>'uom_name'='Each'
  )
  and exists(
    select 1
    from sellertray_inventory_options_fixture f,jsonb_array_elements(f.options) option,
         jsonb_array_elements(option->'catalog_item_uoms') uom
    where option->>'id'=f.product_id::text
      and uom->>'uom_name'='Box'
      and (uom->>'conversion_factor')::numeric=12
  ),
  'Inventory Product options expose governed Stock and alternate UOM choices'
);

select extensions.throws_ok(
  format(
    'select public.get_sellertray_inventory_product_options(%L::uuid,%L::uuid)',
    (select tenant_id::text from sellertray_inventory_options_fixture),
    gen_random_uuid()::text
  ),
  '42501',
  'You do not have permission to read inventory for this Branch',
  'Inventory Product options fail closed outside Branch read authority'
);

select * from extensions.finish();
rollback;
