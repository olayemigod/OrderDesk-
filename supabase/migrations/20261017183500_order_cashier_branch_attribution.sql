begin;

alter table public.orders
  add column if not exists branch_name_snapshot text;

comment on column public.orders.branch_name_snapshot is
  'Branch display name captured for the commercial transaction. Do not reconstruct historical output from the mutable branch row.';

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
  v_existing_operator uuid;
begin
  if p_tenant_id is null or p_order_id is null or p_actor_user_id is null then
    return;
  end if;

  select o.pos_operator_user_id
    into v_existing_operator
  from public.orders o
  where o.tenant_id = p_tenant_id
    and o.id = p_order_id
    and o.source = 'pos'
  for update;

  if not found or v_existing_operator is not null then
    return;
  end if;

  perform public.set_sellertray_pos_operator_snapshot(
    p_tenant_id,
    p_order_id,
    p_actor_user_id
  );
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
), attribution as (
  select
    o.tenant_id,
    o.id as order_id,
    a.actor_user_id,
    public.sellertray_user_display_name(a.actor_user_id) as operator_name
  from public.orders o
  join first_pos_actor a
    on a.tenant_id = o.tenant_id
   and a.order_id = o.id
  where o.source = 'pos'
    and o.pos_operator_user_id is null
)
update public.orders o
set pos_operator_user_id = a.actor_user_id,
    pos_operator_name = left(coalesce(nullif(btrim(a.operator_name), ''), 'Cashier'), 120)
from attribution a
where o.tenant_id = a.tenant_id
  and o.id = a.order_id
  and o.pos_operator_user_id is null;

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

  select o.branch_name_snapshot, o.pos_operator_name
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

drop trigger if exists sellertray_snapshot_receipt_pos_operator on public.sellertray_print_jobs;
drop trigger if exists zz_snapshot_sellertray_print_order_attribution on public.sellertray_print_jobs;
create trigger zz_snapshot_sellertray_print_order_attribution
before insert on public.sellertray_print_jobs
for each row execute function public.snapshot_sellertray_print_order_attribution();

commit;
