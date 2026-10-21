begin;

alter table public.orders
  add column if not exists branch_name_snapshot text;

comment on column public.orders.branch_name_snapshot is
  'Server-captured Branch display name for historical order and receipt attribution. Do not reconstruct from the mutable Branch row.';

-- Legacy reconstruction only: pre-snapshot orders can preserve only the Branch label
-- that exists at migration time. New orders are captured authoritatively by trigger.
update public.orders o
set branch_name_snapshot = b.name
from public.branches b
where b.tenant_id = o.tenant_id
  and b.id = o.branch_id
  and nullif(btrim(o.branch_name_snapshot), '') is null;

create or replace function public.snapshot_sellertray_order_branch_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_branch_name text;
begin
  if tg_op = 'UPDATE' and new.branch_id is not distinct from old.branch_id then
    if new.branch_name_snapshot is distinct from old.branch_name_snapshot then
      raise exception 'SellerTray order Branch attribution is immutable'
        using errcode = '55000';
    end if;
    return new;
  end if;

  select b.name
    into v_branch_name
  from public.branches b
  where b.tenant_id = new.tenant_id
    and b.id = new.branch_id
  limit 1;

  if nullif(btrim(coalesce(v_branch_name, '')), '') is null then
    raise exception 'SellerTray could not capture the Branch name for this order'
      using errcode = '23514';
  end if;

  new.branch_name_snapshot := v_branch_name;
  return new;
end;
$$;

revoke all on function public.snapshot_sellertray_order_branch_name()
  from public, anon, authenticated;

drop trigger if exists zz_snapshot_sellertray_order_branch_name on public.orders;
create trigger zz_snapshot_sellertray_order_branch_name
before insert or update of tenant_id, branch_id, branch_name_snapshot on public.orders
for each row execute function public.snapshot_sellertray_order_branch_name();

create or replace function public.sellertray_snapshot_receipt_branch_name()
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
    and o.id = new.order_id
  limit 1;

  if nullif(btrim(coalesce(v_branch_name, '')), '') is null then
    raise exception 'SellerTray receipt Branch attribution is unavailable'
      using errcode = '23514';
  end if;

  new.content_snapshot := new.content_snapshot
    || jsonb_build_object('branchName', v_branch_name);
  return new;
end;
$$;

revoke all on function public.sellertray_snapshot_receipt_branch_name()
  from public, anon, authenticated;

drop trigger if exists sellertray_snapshot_receipt_branch_name on public.sellertray_print_jobs;
create trigger sellertray_snapshot_receipt_branch_name
before insert on public.sellertray_print_jobs
for each row execute function public.sellertray_snapshot_receipt_branch_name();

commit;
