begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(15);

create temp table sellertray_attribution_fixture (
  tenant_id uuid not null,
  cashier_user_id uuid not null,
  manager_user_id uuid not null,
  product_id uuid not null,
  branch_id uuid,
  stock_uom_id uuid,
  order_id uuid
) on commit drop;

insert into sellertray_attribution_fixture(tenant_id,cashier_user_id,manager_user_id,product_id)
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,raw_user_meta_data,created_at,updated_at)
select cashier_user_id,'cashier-'||substr(cashier_user_id::text,1,8)||'@example.com','authenticated','authenticated',jsonb_build_object('full_name','Ada Cashier'),now(),now()
from sellertray_attribution_fixture
union all
select manager_user_id,'manager-'||substr(manager_user_id::text,1,8)||'@example.com','authenticated','authenticated',jsonb_build_object('full_name','Musa Manager'),now(),now()
from sellertray_attribution_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'SellerTray Attribution Test','sellertray-attribution-'||substr(tenant_id::text,1,8),'SAT','active'
from sellertray_attribution_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from sellertray_attribution_fixture);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,cashier_user_id,'staff' from sellertray_attribution_fixture
union all
select tenant_id,manager_user_id,'manager' from sellertray_attribution_fixture;

update sellertray_attribution_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

insert into public.branch_user_access(tenant_id,branch_id,user_id,can_operate)
select tenant_id,branch_id,cashier_user_id,true
from sellertray_attribution_fixture;

insert into public.catalog_items(id,tenant_id,name,sku,price_ngn,is_active,stock_uom,allow_fractional_stock)
select product_id,tenant_id,'Attribution Product','ATTR-PRODUCT',500,true,'Each',false
from sellertray_attribution_fixture;

update sellertray_attribution_fixture f
set stock_uom_id=u.id
from public.catalog_item_uoms u
where u.tenant_id=f.tenant_id and u.catalog_item_id=f.product_id and lower(u.uom_name)='each';

select set_config('request.jwt.claim.sub',(select cashier_user_id::text from sellertray_attribution_fixture),true);
select set_config('request.jwt.claim.role','authenticated',true);

update sellertray_attribution_fixture
set order_id=public.create_sellertray_pos_order_atomic(
  tenant_id,branch_id,null,null,'Attribution test sale',
  jsonb_build_array(jsonb_build_object(
    'catalog_item_id',product_id,
    'uom_id',stock_uom_id,
    'quantity',1
  ))
);

select extensions.has_column('public','orders','branch_name_snapshot','orders captures branch display history');
select extensions.has_column('public','orders','pos_operator_user_id','orders captures canonical POS operator identity');
select extensions.has_column('public','orders','pos_operator_name','orders captures canonical POS operator display history');

select extensions.is(
  (select o.branch_name_snapshot from public.orders o where o.id=(select order_id from sellertray_attribution_fixture)),
  (select b.name from public.branches b where b.id=(select branch_id from sellertray_attribution_fixture)),
  'POS order snapshots the branch name at transaction time'
);

select extensions.is(
  (select o.pos_operator_user_id from public.orders o where o.id=(select order_id from sellertray_attribution_fixture)),
  null::uuid,
  'an unpaid POS draft is not prematurely attributed to its eventual checkout cashier'
);

select public.set_sellertray_pos_operator_snapshot(
  tenant_id,order_id,cashier_user_id
)
from sellertray_attribution_fixture;

select extensions.is(
  (select o.pos_operator_user_id from public.orders o where o.id=(select order_id from sellertray_attribution_fixture)),
  (select cashier_user_id from sellertray_attribution_fixture),
  'checkout snapshots the authenticated cashier through canonical operator identity'
);

select extensions.is(
  (select o.pos_operator_name from public.orders o where o.id=(select order_id from sellertray_attribution_fixture)),
  'Ada Cashier',
  'checkout snapshots the cashier display name'
);

update public.branches
set name='Renamed Branch After Sale'
where id=(select branch_id from sellertray_attribution_fixture);

update auth.users
set raw_user_meta_data=jsonb_build_object('full_name','Renamed Cashier After Sale')
where id=(select cashier_user_id from sellertray_attribution_fixture);

select extensions.isnt(
  (select o.branch_name_snapshot from public.orders o where o.id=(select order_id from sellertray_attribution_fixture)),
  'Renamed Branch After Sale',
  'historical order branch display does not drift when the branch is renamed'
);

select extensions.is(
  (select o.pos_operator_name from public.orders o where o.id=(select order_id from sellertray_attribution_fixture)),
  'Ada Cashier',
  'historical cashier display does not drift when the user profile changes'
);

select public.apply_sellertray_order_operator_snapshot(
  tenant_id,order_id,manager_user_id
)
from sellertray_attribution_fixture;

select extensions.is(
  (select o.pos_operator_user_id from public.orders o where o.id=(select order_id from sellertray_attribution_fixture)),
  (select cashier_user_id from sellertray_attribution_fixture),
  'later operators cannot overwrite the original POS cashier snapshot'
);

select extensions.ok(
  exists(
    select 1 from pg_trigger
    where tgrelid='public.orders'::regclass
      and tgname='zz_snapshot_sellertray_order_branch_name'
      and not tgisinternal
  ),
  'branch attribution trigger is installed on orders'
);

select extensions.ok(
  exists(
    select 1 from pg_trigger
    where tgrelid='public.commercial_action_ledger'::regclass
      and tgname='snapshot_sellertray_order_operator_from_audit'
      and not tgisinternal
  ),
  'settlement audit can backfill canonical operator attribution when needed'
);

select extensions.ok(
  exists(
    select 1 from pg_trigger
    where tgrelid='public.sellertray_print_jobs'::regclass
      and tgname='zz_snapshot_sellertray_print_order_attribution'
      and not tgisinternal
  ),
  'receipt print jobs carry governed order attribution'
);

select extensions.ok(
  position('branchName' in pg_get_functiondef('public.snapshot_sellertray_print_order_attribution()'::regprocedure)) > 0
  and position('cashierName' in pg_get_functiondef('public.snapshot_sellertray_print_order_attribution()'::regprocedure)) > 0,
  'receipt print snapshot injects both branch and cashier display facts'
);

select extensions.ok(
  position('set_sellertray_pos_operator_snapshot' in pg_get_functiondef('public.apply_sellertray_order_operator_snapshot(uuid,uuid,uuid)'::regprocedure)) > 0
  and position('v_existing_operator is not null' in pg_get_functiondef('public.apply_sellertray_order_operator_snapshot(uuid,uuid,uuid)'::regprocedure)) > 0,
  'fallback attribution reuses canonical first-write POS operator authority'
);

select * from extensions.finish();
rollback;
