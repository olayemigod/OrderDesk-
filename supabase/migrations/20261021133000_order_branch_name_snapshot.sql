begin;

-- Historical Branch attribution is administrative migration truth, not a merchant write.
-- Read-only subscriptions may still have pre-snapshot orders that must be backfilled.
-- Disable only the subscription write guard for this bounded backfill; every other
-- order integrity trigger remains active, and the subscription guard is restored
-- before the transaction commits.
alter table public.orders disable trigger guard_subscription_orders;

alter table public.orders
  add column if not exists branch_name_snapshot text;

update public.orders o
set branch_name_snapshot = btrim(b.name)
from public.branches b
where b.tenant_id = o.tenant_id
  and b.id = o.branch_id
  and nullif(btrim(o.branch_name_snapshot), '') is null;

do $$
begin
  if exists (
    select 1
    from public.orders
    where nullif(btrim(branch_name_snapshot), '') is null
  ) then
    raise exception using
      errcode = '23514',
      message = 'Cannot backfill immutable Branch name snapshots for all orders.';
  end if;
end;
$$;

alter table public.orders
  alter column branch_name_snapshot set not null;

alter table public.orders
  drop constraint if exists orders_branch_name_snapshot_nonempty;

alter table public.orders
  add constraint orders_branch_name_snapshot_nonempty
    check (btrim(branch_name_snapshot) <> '');

comment on column public.orders.branch_name_snapshot is
  'Immutable order-time Branch display name. Existing orders were backfilled from the Branch name present when this snapshot was introduced.';

create or replace function public.snapshot_sellertray_order_branch_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_branch_name text;
begin
  if tg_op = 'UPDATE'
     and new.branch_id is not distinct from old.branch_id
     and new.tenant_id is not distinct from old.tenant_id then
    if new.branch_name_snapshot is distinct from old.branch_name_snapshot then
      raise exception using
        errcode = '22000',
        message = 'Order Branch name snapshot is immutable once recorded.';
    end if;

    return new;
  end if;

  select btrim(b.name)
  into v_branch_name
  from public.branches b
  where b.tenant_id = new.tenant_id
    and b.id = new.branch_id;

  if nullif(v_branch_name, '') is null then
    raise exception using
      errcode = '23503',
      message = 'Order Branch name snapshot requires a valid Branch.';
  end if;

  new.branch_name_snapshot := v_branch_name;
  return new;
end;
$$;

drop trigger if exists orders_snapshot_branch_name on public.orders;
create trigger orders_snapshot_branch_name
before insert or update of tenant_id, branch_id, branch_name_snapshot
on public.orders
for each row
execute function public.snapshot_sellertray_order_branch_name();

create or replace function public.snapshot_sellertray_receipt_branch_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_branch_name text;
begin
  if new.job_type <> 'receipt' or new.order_id is null then
    return new;
  end if;

  select o.branch_name_snapshot
  into v_branch_name
  from public.orders o
  where o.tenant_id = new.tenant_id
    and o.id = new.order_id;

  if nullif(btrim(v_branch_name), '') is null then
    raise exception using
      errcode = '23514',
      message = 'Receipt Branch snapshot is unavailable for this order.';
  end if;

  new.content_snapshot :=
    coalesce(new.content_snapshot, '{}'::jsonb)
    || jsonb_build_object('branchName', v_branch_name);

  return new;
end;
$$;

drop trigger if exists sellertray_print_jobs_snapshot_receipt_branch_name on public.sellertray_print_jobs;
create trigger sellertray_print_jobs_snapshot_receipt_branch_name
before insert on public.sellertray_print_jobs
for each row
execute function public.snapshot_sellertray_receipt_branch_name();

alter table public.orders enable trigger guard_subscription_orders;

commit;
