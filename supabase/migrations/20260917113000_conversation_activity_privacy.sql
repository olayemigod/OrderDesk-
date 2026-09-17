-- SellerTray P1 privacy hardening phase A: introduce a minimal Realtime activity
-- stream without breaking older QA builds that still subscribe to inbound_messages.

create table if not exists public.conversation_activity_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  occurred_at timestamptz not null default now()
);

create index if not exists conversation_activity_events_tenant_occurred_idx
  on public.conversation_activity_events (tenant_id, occurred_at desc);

create index if not exists conversation_activity_events_tenant_customer_idx
  on public.conversation_activity_events (tenant_id, customer_id, occurred_at desc);

alter table public.conversation_activity_events enable row level security;

revoke all on table public.conversation_activity_events from anon;
revoke all on table public.conversation_activity_events from authenticated;
grant select on table public.conversation_activity_events to authenticated;
grant select, insert, update, delete on table public.conversation_activity_events to service_role;

create policy conversation_activity_events_select_member
  on public.conversation_activity_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.tenant_members tm
      where tm.tenant_id = conversation_activity_events.tenant_id
        and tm.user_id = (select auth.uid())
    )
  );

create or replace function public.emit_conversation_activity_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.conversation_activity_events (
    tenant_id,
    customer_id,
    occurred_at
  ) values (
    new.tenant_id,
    new.customer_id,
    coalesce(new.received_at, now())
  );

  return new;
end;
$function$;

revoke all on function public.emit_conversation_activity_event() from public;
revoke all on function public.emit_conversation_activity_event() from anon;
revoke all on function public.emit_conversation_activity_event() from authenticated;
grant execute on function public.emit_conversation_activity_event() to service_role;

drop trigger if exists trg_emit_conversation_activity_event on public.inbound_messages;
create trigger trg_emit_conversation_activity_event
after insert on public.inbound_messages
for each row
execute function public.emit_conversation_activity_event();

-- Publish the minimal stream now. Keep inbound_messages temporarily published and
-- readable for backward compatibility until the matching mobile QA build is installed.
do $do$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'conversation_activity_events'
  ) then
    execute 'alter publication supabase_realtime add table public.conversation_activity_events';
  end if;
end
$do$;
