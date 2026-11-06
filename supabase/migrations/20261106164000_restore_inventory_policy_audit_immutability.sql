-- Issue #225: forward-only restoration of immutable inventory policy history.
-- The existing Branch low-stock writer already records policy-change events,
-- but Production has no UPDATE/DELETE protection on those evidence rows.
-- Safe with the historical guard already present in an isolated source rebuild.
begin;

-- Refuse a missing or substituted history table; this patch must not
-- manufacture stock policy evidence or a competing history relation.
do $validate$
begin
  if to_regclass('public.branch_inventory_policy_events') is null then
    raise exception 'Branch inventory policy event authority is missing'
      using errcode='42P01';
  end if;
  if not exists (
    select 1 from pg_constraint c
    where c.conrelid='public.branch_inventory_policy_events'::regclass
      and c.conname='branch_inventory_policy_events_branch_same_tenant'
      and c.confrelid='public.branches'::regclass
      and c.contype='f'
  ) then
    raise exception 'Branch inventory policy history lacks same-Business Branch identity'
      using errcode='23514';
  end if;
end;
$validate$;

-- Keep audit history service-only and protected even if earlier migrations
-- granted broad DML. TRUNCATE bypasses the row-level immutability trigger.
alter table public.branch_inventory_policy_events enable row level security;
revoke all on table public.branch_inventory_policy_events from public, anon, authenticated;
revoke truncate on table public.branch_inventory_policy_events from service_role;

create or replace function public.prevent_sellertray_inventory_policy_event_mutation()
returns trigger
language plpgsql
set search_path=''
as $function$
begin
  -- Allow the original tenant-retirement cascade only after its parent is gone.
  if tg_op='DELETE'
     and not exists (
       select 1 from public.tenants t where t.id=old.tenant_id
     ) then
    return old;
  end if;
  raise exception 'Inventory policy history is immutable'
    using errcode='55000';
end;
$function$;

revoke all on function public.prevent_sellertray_inventory_policy_event_mutation()
  from public, anon, authenticated;
grant execute on function public.prevent_sellertray_inventory_policy_event_mutation()
  to service_role;

do $trigger$
begin
  if not exists (
    select 1 from pg_trigger t
    where t.tgrelid='public.branch_inventory_policy_events'::regclass
      and t.tgname='prevent_sellertray_inventory_policy_event_mutation'
      and not t.tgisinternal
  ) then
    execute 'create trigger prevent_sellertray_inventory_policy_event_mutation
      before update or delete on public.branch_inventory_policy_events
      for each row execute function public.prevent_sellertray_inventory_policy_event_mutation()';
  elsif not exists (
    select 1 from pg_trigger t
    where t.tgrelid='public.branch_inventory_policy_events'::regclass
      and t.tgname='prevent_sellertray_inventory_policy_event_mutation'
      and not t.tgisinternal
      and t.tgfoid='public.prevent_sellertray_inventory_policy_event_mutation()'::regprocedure
      and t.tgenabled='O'
      and (t.tgtype & 2)=2 -- BEFORE
      and (t.tgtype & 8)=8 -- DELETE
      and (t.tgtype & 16)=16 -- UPDATE
  ) then
    raise exception 'Existing inventory policy audit trigger is disabled or inconsistent'
      using errcode='23514';
  end if;
end;
$trigger$;

-- Neither inventory quantity ledger, cost evidence nor historical policy rows
-- are mutated by this repair. Normal low-stock policy commands stay unchanged.
commit;
