alter table public.orders
  add column if not exists status_reason text,
  add constraint orders_status_reason_length check (
    status_reason is null or char_length(btrim(status_reason)) between 1 and 500
  );

create table if not exists public.order_status_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid not null,
  event_type text not null default 'transition' check (event_type in ('created', 'transition', 'snapshot')),
  from_status text,
  to_status text not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_kind text not null default 'system' check (actor_kind in ('system', 'merchant')),
  reason text,
  created_at timestamptz not null default now(),
  constraint order_status_events_order_same_tenant
    foreign key (tenant_id, order_id)
    references public.orders(tenant_id, id)
    on delete cascade
);

create index if not exists order_status_events_tenant_order_created_idx
  on public.order_status_events (tenant_id, order_id, created_at desc);

alter table public.order_status_events enable row level security;
revoke all on table public.order_status_events from anon, authenticated;
grant select on table public.order_status_events to authenticated;

create policy order_status_events_select_member
on public.order_status_events
for select
to authenticated
using (
  exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = order_status_events.tenant_id
      and tm.user_id = (select auth.uid())
  )
);

create or replace function public.guard_order_status_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = old.status then
    if new.status_reason is distinct from old.status_reason then
      raise exception 'Order status reason can only change with a status transition' using errcode = '23514';
    end if;
    return new;
  end if;

  if old.status in ('completed', 'rejected', 'cancelled') then
    raise exception 'Order status % is terminal', old.status using errcode = '23514';
  end if;

  if new.status in ('rejected', 'cancelled') then
    new.status_reason := nullif(btrim(new.status_reason), '');
    if new.status_reason is null then
      raise exception 'A reason is required when rejecting or cancelling an order' using errcode = '23514';
    end if;
  else
    new.status_reason := null;
  end if;

  if new.status = 'accepted' then
    if old.status not in ('draft', 'needs_review') then
      raise exception 'Order cannot move from % to accepted', old.status using errcode = '23514';
    end if;

    if not exists (
      select 1
      from public.order_items oi
      where oi.tenant_id = new.tenant_id
        and oi.order_id = new.id
    ) then
      raise exception 'Order must contain at least one item before acceptance' using errcode = '23514';
    end if;

    if exists (
      select 1
      from public.order_items oi
      where oi.tenant_id = new.tenant_id
        and oi.order_id = new.id
        and oi.unit_price is null
    ) then
      raise exception 'All order items must be priced before acceptance' using errcode = '23514';
    end if;

    return new;
  end if;

  if new.status = 'rejected' and old.status in ('draft', 'needs_review') then
    return new;
  end if;

  if new.status = 'processing' and old.status = 'accepted' then
    return new;
  end if;

  if new.status = 'ready' and old.status = 'processing' then
    return new;
  end if;

  if new.status = 'completed' and old.status = 'ready' then
    return new;
  end if;

  if new.status = 'cancelled' and old.status in ('accepted', 'processing', 'ready') then
    return new;
  end if;

  raise exception 'Invalid order status transition: % -> %', old.status, new.status using errcode = '23514';
end;
$$;

drop trigger if exists guard_order_status_transition on public.orders;
create trigger guard_order_status_transition
before update of status, status_reason on public.orders
for each row
execute function public.guard_order_status_transition();

create or replace function public.record_order_status_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
begin
  actor := auth.uid();

  if tg_op = 'INSERT' then
    insert into public.order_status_events (
      tenant_id,
      order_id,
      event_type,
      from_status,
      to_status,
      actor_user_id,
      actor_kind,
      reason,
      created_at
    ) values (
      new.tenant_id,
      new.id,
      'created',
      null,
      new.status,
      actor,
      case when actor is null then 'system' else 'merchant' end,
      new.status_reason,
      new.created_at
    );
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.order_status_events (
      tenant_id,
      order_id,
      event_type,
      from_status,
      to_status,
      actor_user_id,
      actor_kind,
      reason
    ) values (
      new.tenant_id,
      new.id,
      'transition',
      old.status,
      new.status,
      actor,
      case when actor is null then 'system' else 'merchant' end,
      new.status_reason
    );
  end if;

  return new;
end;
$$;

revoke all on function public.record_order_status_event() from public;
revoke all on function public.record_order_status_event() from anon;
revoke all on function public.record_order_status_event() from authenticated;

drop trigger if exists record_order_status_created on public.orders;
create trigger record_order_status_created
after insert on public.orders
for each row
execute function public.record_order_status_event();

drop trigger if exists record_order_status_transition on public.orders;
create trigger record_order_status_transition
after update of status on public.orders
for each row
when (old.status is distinct from new.status)
execute function public.record_order_status_event();

insert into public.order_status_events (
  tenant_id,
  order_id,
  event_type,
  from_status,
  to_status,
  actor_user_id,
  actor_kind,
  reason,
  created_at
)
select
  o.tenant_id,
  o.id,
  'snapshot',
  null,
  o.status,
  null,
  'system',
  o.status_reason,
  greatest(o.created_at, o.updated_at)
from public.orders o
where not exists (
  select 1 from public.order_status_events ose where ose.order_id = o.id
);

revoke update on table public.orders from authenticated;
grant update (status, status_reason, updated_at) on table public.orders to authenticated;
