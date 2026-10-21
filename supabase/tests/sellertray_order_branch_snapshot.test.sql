begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(11);

create temp table sellertray_branch_snapshot_fixture (
  tenant_id uuid not null,
  branch_id uuid,
  customer_id uuid not null,
  order_id uuid
) on commit drop;

insert into sellertray_branch_snapshot_fixture(tenant_id, customer_id)
values (gen_random_uuid(), gen_random_uuid());

insert into public.tenants(id, name, slug, merchant_code, subscription_status)
select
  tenant_id,
  'SellerTray Branch Snapshot Test',
  'sellertray-branch-snapshot-' || substr(tenant_id::text, 1, 8),
  upper(substr(replace(tenant_id::text, '-', ''), 1, 3)),
  'active'
from sellertray_branch_snapshot_fixture;

update public.tenant_subscriptions
set status = 'active', trial_ends_at = null, grace_ends_at = null
where tenant_id = (select tenant_id from sellertray_branch_snapshot_fixture);

update sellertray_branch_snapshot_fixture f
set branch_id = b.id
from public.branches b
where b.tenant_id = f.tenant_id
  and b.is_default = true;

insert into public.customers(id, tenant_id, wa_id, display_name)
select customer_id, tenant_id, 'branch-snapshot-' || substr(customer_id::text, 1, 12), 'Snapshot Customer'
from sellertray_branch_snapshot_fixture;

with inserted_order as (
  insert into public.orders(tenant_id, customer_id, branch_id, source, currency, status)
  select tenant_id, customer_id, branch_id, 'pos', 'NGN', 'needs_review'
  from sellertray_branch_snapshot_fixture
  returning id, tenant_id, customer_id
)
update sellertray_branch_snapshot_fixture f
set order_id = o.id
from inserted_order o
where o.tenant_id = f.tenant_id
  and o.customer_id = f.customer_id;

select extensions.has_column(
  'public', 'orders', 'branch_name_snapshot',
  'orders stores immutable Branch display history'
);

select extensions.ok(
  exists(
    select 1
    from pg_trigger
    where tgrelid = 'public.orders'::regclass
      and tgname = 'zz_snapshot_sellertray_order_branch_name'
      and not tgisinternal
  ),
  'order Branch snapshot trigger is installed'
);

select extensions.ok(
  position('BEFORE INSERT' in pg_get_triggerdef((
    select oid from pg_trigger
    where tgrelid = 'public.orders'::regclass
      and tgname = 'zz_snapshot_sellertray_order_branch_name'
      and not tgisinternal
  ), true)) > 0,
  'the shared insert boundary captures Branch history for every order creation path'
);

select extensions.is(
  (select o.branch_name_snapshot from public.orders o where o.id = (select order_id from sellertray_branch_snapshot_fixture)),
  (select b.name from public.branches b where b.id = (select branch_id from sellertray_branch_snapshot_fixture)),
  'new order captures the authoritative Branch name'
);

select extensions.throws_ok(
  $$
    update public.orders
    set branch_name_snapshot = 'Tampered Branch'
    where id = (select order_id from sellertray_branch_snapshot_fixture)
  $$,
  '55000',
  'SellerTray order Branch attribution is immutable',
  'historical Branch snapshot rejects direct mutation'
);

update public.branches
set name = 'Renamed Branch After Sale'
where id = (select branch_id from sellertray_branch_snapshot_fixture);

select extensions.isnt(
  (select o.branch_name_snapshot from public.orders o where o.id = (select order_id from sellertray_branch_snapshot_fixture)),
  'Renamed Branch After Sale',
  'renaming the Branch does not rewrite historical order attribution'
);

select extensions.ok(
  position('b.tenant_id = new.tenant_id' in pg_get_functiondef('public.snapshot_sellertray_order_branch_name()'::regprocedure)) > 0
  and position('b.id = new.branch_id' in pg_get_functiondef('public.snapshot_sellertray_order_branch_name()'::regprocedure)) > 0,
  'Branch snapshot resolution is scoped to the order Business and Branch identity'
);

select extensions.ok(
  exists(
    select 1
    from pg_trigger
    where tgrelid = 'public.sellertray_print_jobs'::regclass
      and tgname = 'sellertray_snapshot_receipt_branch_name'
      and not tgisinternal
  ),
  'receipt print jobs use the governed Branch snapshot trigger'
);

select extensions.ok(
  position('o.branch_name_snapshot' in pg_get_functiondef('public.sellertray_snapshot_receipt_branch_name()'::regprocedure)) > 0
  and position('jsonb_build_object(''branchName'', v_branch_name)' in pg_get_functiondef('public.sellertray_snapshot_receipt_branch_name()'::regprocedure)) > 0,
  'receipt and reprint content derive Branch display from the immutable order snapshot'
);

select extensions.ok(
  position('public.branches' in pg_get_functiondef('public.sellertray_snapshot_receipt_branch_name()'::regprocedure)) = 0,
  'receipt Branch attribution no longer depends on the mutable Branch row at print time'
);

select extensions.ok(
  exists(
    select 1
    from pg_trigger
    where tgrelid = 'public.orders'::regclass
      and tgname = 'guard_sellertray_pos_operator_snapshot'
      and not tgisinternal
  )
  and position('pos_operator' in pg_get_functiondef('public.snapshot_sellertray_order_branch_name()'::regprocedure)) = 0,
  'existing immutable cashier attribution remains separate and untouched'
);

select * from extensions.finish();
rollback;
