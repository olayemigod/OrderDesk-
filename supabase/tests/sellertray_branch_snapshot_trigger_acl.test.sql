begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(10);

-- Trigger helpers are internal database side effects, not client-callable RPCs.
select extensions.ok(
  not has_function_privilege('anon','public.snapshot_sellertray_order_branch_name()','EXECUTE')
  and not has_function_privilege('authenticated','public.snapshot_sellertray_order_branch_name()','EXECUTE'),
  'Order Branch snapshot trigger is not callable by public or merchant roles'
);
select extensions.ok(
  has_function_privilege('service_role','public.snapshot_sellertray_order_branch_name()','EXECUTE'),
  'Order snapshot trigger preserves privileged execution'
);
select extensions.ok(
  not has_function_privilege('anon','public.snapshot_sellertray_receipt_branch_name()','EXECUTE')
  and not has_function_privilege('authenticated','public.snapshot_sellertray_receipt_branch_name()','EXECUTE'),
  'Receipt Branch snapshot trigger is not callable by public or merchant roles'
);
select extensions.ok(
  has_function_privilege('service_role','public.snapshot_sellertray_receipt_branch_name()','EXECUTE'),
  'Receipt snapshot trigger preserves privileged execution'
);

select extensions.ok(
  exists (select 1 from pg_catalog.pg_trigger
          where tgname='orders_snapshot_branch_name'
            and tgrelid='public.orders'::regclass
            and tgenabled<>'D' and not tgisinternal),
  'Order table retains its enabled Branch snapshot trigger'
);
select extensions.ok(
  exists (select 1 from pg_catalog.pg_trigger
          where tgname='sellertray_print_jobs_snapshot_receipt_branch_name'
            and tgrelid='public.sellertray_print_jobs'::regclass
            and tgenabled<>'D' and not tgisinternal),
  'Print-job table retains its enabled receipt Branch snapshot trigger'
);

create temp table acl_snapshot_fixture (
  tenant_id uuid not null,
  customer_id uuid not null,
  order_id uuid not null,
  branch_id uuid,
  expected_branch_name text
) on commit drop;

insert into acl_snapshot_fixture (tenant_id,customer_id,order_id)
values (gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'QA Branch Snapshot','qa-snapshot-'||tenant_id,'QAS','active'
from acl_snapshot_fixture;
update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from acl_snapshot_fixture);
update acl_snapshot_fixture f
set branch_id=b.id,expected_branch_name=btrim(b.name)
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default;

insert into public.customers(id,tenant_id,wa_id)
select customer_id,tenant_id,'qa-snapshot:'||customer_id from acl_snapshot_fixture;

-- Exercise the actual order table's trigger with a real (rolled-back) order.
insert into public.orders(id,tenant_id,customer_id,branch_id,public_order_id)
select order_id,tenant_id,customer_id,branch_id,'ST/QA/'||replace(order_id::text,'-','')
from acl_snapshot_fixture;

select extensions.is(
  (select o.branch_name_snapshot from public.orders o
   join acl_snapshot_fixture f on f.order_id=o.id),
  (select expected_branch_name from acl_snapshot_fixture),
  'Order insert retains the authoritative Branch name snapshot'
);

select extensions.throws_ok(
  format('update public.orders set branch_name_snapshot=%L where id=%L::uuid',
     'Tampered Branch', (select order_id from acl_snapshot_fixture)),
  '22000','Order Branch name snapshot is immutable once recorded.',
  'Branch name snapshot cannot be rewritten on an existing order'
);

-- A local temporary probe avoids adding a real print job and still executes
-- the same receipt snapshot trigger function in the same database.
create temp table acl_receipt_trigger_probe(
  tenant_id uuid not null,
  order_id uuid not null,
  job_type text not null,
  content_snapshot jsonb
) on commit drop;
create trigger qa_receipt_branch_snapshot
before insert on acl_receipt_trigger_probe
for each row execute function public.snapshot_sellertray_receipt_branch_name();

insert into acl_receipt_trigger_probe (tenant_id,order_id,job_type,content_snapshot)
select tenant_id,order_id,'receipt','{}'::jsonb from acl_snapshot_fixture;

select extensions.is(
  (select content_snapshot->>'branchName' from acl_receipt_trigger_probe),
  (select expected_branch_name from acl_snapshot_fixture),
  'Receipt content uses the immutable original Order Branch name'
);

select extensions.is(
  (select count(*)::integer from public.sellertray_print_jobs p
    join acl_snapshot_fixture f on f.order_id=p.order_id),
  0,
  'Trigger test does not create a physical or pending receipt print job'
);

select * from extensions.finish();
rollback;
