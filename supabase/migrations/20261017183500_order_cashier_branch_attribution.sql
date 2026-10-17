begin;

alter table public.orders
  add column if not exists branch_name_snapshot text,
  add column if not exists cashier_user_id uuid,
  add column if not exists cashier_name_snapshot text;

comment on column public.orders.branch_name_snapshot is
  'Branch display name captured for the commercial transaction. Do not reconstruct historical output from the mutable branch row.';
comment on column public.orders.cashier_user_id is
  'Authenticated SellerTray operator captured for POS work when known.';
comment on column public.orders.cashier_name_snapshot is
  'Human cashier/operator name captured for POS receipts, order history and audit display.';

update public.orders o
set branch_name_snapshot = b.name
from public.branches b
where b.tenant_id = o.tenant_id
  and b.id = o.branch_id
  and nullif(btrim(o.branch_name_snapshot), '') is null;

create or replace function public.sellertray_user_display_name(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
    nullif(btrim(u.email), ''),
    'Cashier'
  )
  from auth.users u
  where u.id = p_user_id
  limit 1;
$$;

revoke all on function public.sellertray_user_display_name(uuid) from public, anon, authenticated;
grant execute on function public.sellertray_user_display_name(uuid) to service_role;

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
    new.branch_name_snapshot := old.branch_name_snapshot;
    return new;
  end if;

  select b.name into v_branch_name
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

revoke all on function public.snapshot_sellertray_order_branch_name() from public, anon, authenticated;

drop trigger if exists zz_snapshot_sellertray_order_branch_name on public.orders;
create trigger zz_snapshot_sellertray_order_branch_name
before insert or update of tenant_id, branch_id on public.orders
for each row execute function public.snapshot_sellertray_order_branch_name();

create or replace function public.apply_sellertray_order_cashier_snapshot(
  p_tenant_id uuid,
  p_order_id uuid,
  p_actor_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if p_tenant_id is null or p_order_id is null or p_actor_user_id is null then
    return;
  end if;

  if not exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = p_tenant_id
      and tm.user_id = p_actor_user_id
  ) then
    return;
  end if;

  select public.sellertray_user_display_name(p_actor_user_id) into v_name;
  if nullif(btrim(coalesce(v_name, '')), '') is null then
    return;
  end if;

  update public.orders o
  set cashier_user_id = coalesce(o.cashier_user_id, p_actor_user_id),
      cashier_name_snapshot = coalesce(o.cashier_name_snapshot, v_name)
  where o.tenant_id = p_tenant_id
    and o.id = p_order_id
    and o.source = 'pos'
    and (o.cashier_user_id is null or o.cashier_name_snapshot is null);
end;
$$;

revoke all on function public.apply_sellertray_order_cashier_snapshot(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.apply_sellertray_order_cashier_snapshot(uuid,uuid,uuid) to service_role;

create or replace function public.snapshot_sellertray_order_cashier_from_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.target_order_id is not null
     and new.actor_user_id is not null
     and new.action_type in ('pos_draft_created', 'pos_sale_completed', 'pos_payment_awaiting_confirmation') then
    perform public.apply_sellertray_order_cashier_snapshot(
      new.tenant_id,
      new.target_order_id,
      new.actor_user_id
    );
  end if;
  return new;
end;
$$;

revoke all on function public.snapshot_sellertray_order_cashier_from_audit() from public, anon, authenticated;

drop trigger if exists snapshot_sellertray_order_cashier_from_audit on public.commercial_action_ledger;
create trigger snapshot_sellertray_order_cashier_from_audit
after insert on public.commercial_action_ledger
for each row execute function public.snapshot_sellertray_order_cashier_from_audit();

with first_pos_actor as (
  select distinct on (cal.tenant_id, cal.target_order_id)
    cal.tenant_id,
    cal.target_order_id as order_id,
    cal.actor_user_id
  from public.commercial_action_ledger cal
  where cal.target_order_id is not null
    and cal.actor_user_id is not null
    and cal.action_type in ('pos_draft_created', 'pos_sale_completed', 'pos_payment_awaiting_confirmation')
  order by cal.tenant_id, cal.target_order_id, cal.created_at asc
)
update public.orders o
set cashier_user_id = a.actor_user_id,
    cashier_name_snapshot = public.sellertray_user_display_name(a.actor_user_id)
from first_pos_actor a
where o.tenant_id = a.tenant_id
  and o.id = a.order_id
  and o.source = 'pos'
  and (o.cashier_user_id is null or o.cashier_name_snapshot is null);

create or replace function public.snapshot_sellertray_print_order_attribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_branch_name text;
  v_cashier_name text;
begin
  if new.job_type <> 'receipt' or new.order_id is null then
    return new;
  end if;

  select o.branch_name_snapshot, o.cashier_name_snapshot
    into v_branch_name, v_cashier_name
  from public.orders o
  where o.tenant_id = new.tenant_id
    and o.id = new.order_id
  limit 1;

  if nullif(btrim(coalesce(v_branch_name, '')), '') is not null then
    new.content_snapshot := new.content_snapshot || jsonb_build_object('branchName', v_branch_name);
  end if;
  if nullif(btrim(coalesce(v_cashier_name, '')), '') is not null then
    new.content_snapshot := new.content_snapshot || jsonb_build_object('cashierName', v_cashier_name);
  end if;
  return new;
end;
$$;

revoke all on function public.snapshot_sellertray_print_order_attribution() from public, anon, authenticated;
grant execute on function public.snapshot_sellertray_print_order_attribution() to service_role;

drop trigger if exists zz_snapshot_sellertray_print_order_attribution on public.sellertray_print_jobs;
create trigger zz_snapshot_sellertray_print_order_attribution
before insert on public.sellertray_print_jobs
for each row execute function public.snapshot_sellertray_print_order_attribution();

commit;
