begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(6);

create temp table sellertray_branch_snapshot_fixture (
  tenant_id uuid not null,
  owner_user_id uuid not null,
  product_id uuid not null,
  branch_id uuid,
  register_id uuid,
  location_id uuid,
  stock_uom_id uuid,
  printer_id uuid,
  order_id uuid,
  order_after_rename_id uuid,
  first_print_job_id uuid,
  reprint_job_id uuid,
  original_branch_name text,
  renamed_branch_name text,
  tamper_rejected boolean not null default false
) on commit drop;

insert into sellertray_branch_snapshot_fixture(tenant_id,owner_user_id,product_id)
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_user_id,
       'branch-snapshot-'||substr(owner_user_id::text,1,8)||'@example.com',
       'authenticated','authenticated',now(),now()
from sellertray_branch_snapshot_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status,business_email,business_phone)
select tenant_id,
       'SellerTray Branch Snapshot Test',
       'sellertray-branch-snapshot-'||substr(tenant_id::text,1,8),
       'BST','active','branch-snapshot@example.com','08000000000'
from sellertray_branch_snapshot_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from sellertray_branch_snapshot_fixture);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner'
from sellertray_branch_snapshot_fixture;

update sellertray_branch_snapshot_fixture f
set branch_id=b.id,
    original_branch_name=b.name,
    renamed_branch_name=b.name||' Renamed'
from public.branches b
where b.tenant_id=f.tenant_id
  and b.is_default=true;

update sellertray_branch_snapshot_fixture f
set register_id=r.id
from public.sellertray_registers r
where r.tenant_id=f.tenant_id
  and r.branch_id=f.branch_id
  and r.is_default=true;

update sellertray_branch_snapshot_fixture f
set location_id=sl.id
from public.stock_locations sl
where sl.tenant_id=f.tenant_id
  and sl.branch_id=f.branch_id
  and sl.is_default=true;

insert into public.catalog_items(
  id,tenant_id,name,sku,price_ngn,is_active,stock_uom,allow_fractional_stock
)
select product_id,tenant_id,'Branch Snapshot Product','BRANCH-SNAPSHOT-PRODUCT',150,true,'Each',false
from sellertray_branch_snapshot_fixture;

update sellertray_branch_snapshot_fixture f
set stock_uom_id=u.id
from public.catalog_item_uoms u
where u.tenant_id=f.tenant_id
  and u.catalog_item_id=f.product_id
  and lower(u.uom_name)='each';

select public.record_sellertray_inventory_movement(
  tenant_id,branch_id,location_id,product_id,
  'opening',20,'Each',20,1,
  'opening_stock','BRANCH-SNAPSHOT-OPENING','branch-snapshot:opening',
  now(),owner_user_id,'Opening stock for Branch snapshot test','{}'::jsonb,null
)
from sellertray_branch_snapshot_fixture;

select set_config('request.jwt.claim.sub',(select owner_user_id::text from sellertray_branch_snapshot_fixture),true);
select set_config('request.jwt.claim.role','authenticated',true);

update sellertray_branch_snapshot_fixture
set printer_id=(public.save_sellertray_printer(
  tenant_id,null,branch_id,register_id,
  'Branch Snapshot Printer','BT-BRANCH-SNAPSHOT-01',58,true,true,owner_user_id
)->>'printerId')::uuid;

update sellertray_branch_snapshot_fixture
set order_id=public.create_sellertray_pos_order_atomic(
  tenant_id,branch_id,null,null,'Historical Branch snapshot sale',
  jsonb_build_array(jsonb_build_object(
    'catalog_item_id',product_id,'uom_id',stock_uom_id,'quantity',2
  ))
);

select extensions.is(
  (
    select o.branch_name_snapshot
    from public.orders o
    where o.id=(select order_id from sellertray_branch_snapshot_fixture)
  ),
  (select original_branch_name from sellertray_branch_snapshot_fixture),
  'new orders freeze the authoritative Branch name at order time'
);

update public.branches b
set name=f.renamed_branch_name
from sellertray_branch_snapshot_fixture f
where b.id=f.branch_id
  and b.tenant_id=f.tenant_id;

select extensions.is(
  (
    select o.branch_name_snapshot
    from public.orders o
    where o.id=(select order_id from sellertray_branch_snapshot_fixture)
  ),
  (select original_branch_name from sellertray_branch_snapshot_fixture),
  'renaming the Branch does not rewrite an existing order Branch snapshot'
);

do $$
begin
  begin
    update public.orders
    set branch_name_snapshot='Tampered Branch'
    where id=(select order_id from sellertray_branch_snapshot_fixture);
  exception when sqlstate '22000' then
    update sellertray_branch_snapshot_fixture set tamper_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select tamper_rejected from sellertray_branch_snapshot_fixture),
  'order Branch snapshots reject direct historical tampering'
);

select public.open_sellertray_cash_shift(
  tenant_id,branch_id,register_id,0,owner_user_id
)
from sellertray_branch_snapshot_fixture;

select set_config('request.jwt.claim.role','service_role',true);
select public.complete_sellertray_pos_cash_sale(tenant_id,order_id,owner_user_id)
from sellertray_branch_snapshot_fixture;
select set_config('request.jwt.claim.role','authenticated',true);

update sellertray_branch_snapshot_fixture
set first_print_job_id=(public.request_sellertray_print_job(
  tenant_id,printer_id,'receipt',order_id,'BRANCH-SNAPSHOT-PRINT-001',owner_user_id
)->>'jobId')::uuid;

select extensions.is(
  (
    select j.content_snapshot->>'branchName'
    from public.sellertray_print_jobs j
    where j.id=(select first_print_job_id from sellertray_branch_snapshot_fixture)
  ),
  (select original_branch_name from sellertray_branch_snapshot_fixture),
  'receipt printing consumes the immutable order-time Branch name'
);

update sellertray_branch_snapshot_fixture
set reprint_job_id=(public.request_sellertray_print_job(
  tenant_id,printer_id,'receipt',order_id,'BRANCH-SNAPSHOT-PRINT-002',owner_user_id
)->>'jobId')::uuid;

select extensions.is(
  (
    select j.content_snapshot->>'branchName'
    from public.sellertray_print_jobs j
    where j.id=(select reprint_job_id from sellertray_branch_snapshot_fixture)
  ),
  (select original_branch_name from sellertray_branch_snapshot_fixture),
  'receipt reprints retain the original Branch name after the Branch master is renamed'
);

update sellertray_branch_snapshot_fixture
set order_after_rename_id=public.create_sellertray_pos_order_atomic(
  tenant_id,branch_id,null,null,'Post-rename Branch snapshot order',
  jsonb_build_array(jsonb_build_object(
    'catalog_item_id',product_id,'uom_id',stock_uom_id,'quantity',1
  ))
);

select extensions.is(
  (
    select o.branch_name_snapshot
    from public.orders o
    where o.id=(select order_after_rename_id from sellertray_branch_snapshot_fixture)
  ),
  (select renamed_branch_name from sellertray_branch_snapshot_fixture),
  'orders created after a Branch rename snapshot the new authoritative Branch name'
);

select * from extensions.finish();
rollback;
