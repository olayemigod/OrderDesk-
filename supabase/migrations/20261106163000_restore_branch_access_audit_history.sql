-- Issue #224: forward-only convergence for Staff Branch permission audit history.
-- Production contains the governed set/reset RPCs but lacks their audit relation.
-- Recreate only the missing authoritative history boundary. Do not rewrite
-- tenant membership, Branch assignments, legacy versions, or historical events.
-- Safe on an isolated full source rebuild where the original table already exists.
begin;

create table if not exists public.sellertray_branch_access_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null,
  user_id uuid not null,
  previous_can_operate boolean,
  new_can_operate boolean,
  actor_user_id uuid not null,
  created_at timestamptz not null default now(),
  constraint sellertray_branch_access_events_branch_same_tenant
    foreign key (tenant_id, branch_id)
    references public.branches(tenant_id, id)
    on delete cascade
);

-- Do not silently accept a partial or incompatible pre-existing audit table.
do $validate$
begin
  if (
    select count(*) from pg_attribute a
    where a.attrelid='public.sellertray_branch_access_events'::regclass
      and a.attnum>0 and not a.attisdropped
      and (
        (a.attname in ('id','tenant_id','branch_id','user_id','actor_user_id') and a.atttypid='uuid'::regtype)
        or (a.attname in ('previous_can_operate','new_can_operate') and a.atttypid='boolean'::regtype)
        or (a.attname='created_at' and a.atttypid='timestamptz'::regtype)
      )
  ) <> 8 then
    raise exception 'Branch access audit relation has an incompatible column contract' using errcode='23514';
  end if;

  if not exists (
    select 1 from pg_constraint c
    where c.conrelid='public.sellertray_branch_access_events'::regclass
      and c.conname='sellertray_branch_access_events_branch_same_tenant'
      and c.contype='f'
      and c.confrelid='public.branches'::regclass
      and c.confdeltype='c'
  ) then
    raise exception 'Branch access audit history requires Branch-scoped cascading foreign key' using errcode='23514';
  end if;
end;
$validate$;

create index if not exists sellertray_branch_access_events_member_idx
  on public.sellertray_branch_access_events (tenant_id, user_id, created_at desc);

alter table public.sellertray_branch_access_events enable row level security;
revoke all on table public.sellertray_branch_access_events from public, anon, authenticated;
grant all on table public.sellertray_branch_access_events to service_role;
-- TRUNCATE bypasses row triggers and is never a governed audit-write operation.
revoke truncate on table public.sellertray_branch_access_events from service_role;

create or replace function public.prevent_sellertray_branch_access_event_mutation()
returns trigger
language plpgsql
set search_path=''
as $function$
begin
  -- Preserve the recorded tenant-retirement cascade exception.
  if tg_op='DELETE'
     and not exists (
       select 1 from public.tenants t where t.id=old.tenant_id
     ) then
    return old;
  end if;
  raise exception 'Branch access history is immutable while this business exists'
    using errcode='55000';
end;
$function$;

revoke all on function public.prevent_sellertray_branch_access_event_mutation()
  from public, anon, authenticated;
grant execute on function public.prevent_sellertray_branch_access_event_mutation()
  to service_role;

do $trigger$
begin
  if not exists (
    select 1 from pg_trigger t
    where t.tgrelid='public.sellertray_branch_access_events'::regclass
      and t.tgname='prevent_sellertray_branch_access_event_mutation'
      and not t.tgisinternal
  ) then
    execute 'create trigger prevent_sellertray_branch_access_event_mutation
      before update or delete on public.sellertray_branch_access_events
      for each row execute function public.prevent_sellertray_branch_access_event_mutation()';
  elsif not exists (
    select 1 from pg_trigger t
    where t.tgrelid='public.sellertray_branch_access_events'::regclass
      and t.tgname='prevent_sellertray_branch_access_event_mutation'
      and not t.tgisinternal
      and t.tgfoid='public.prevent_sellertray_branch_access_event_mutation()'::regprocedure
      and t.tgenabled='O'
      and (t.tgtype & 2)=2 -- BEFORE
      and (t.tgtype & 8)=8 -- DELETE
      and (t.tgtype & 16)=16 -- UPDATE
  ) then
    raise exception 'Existing Branch access audit trigger is disabled or inconsistent'
      using errcode='23514';
  end if;
end;
$trigger$;

-- The existing set_sellertray_member_branch_access/reset RPCs stay authoritative;
-- neither their permission checks nor default-Branch fallback are replaced.
commit;
