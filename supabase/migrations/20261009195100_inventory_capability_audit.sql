begin;

create table public.tenant_member_capability_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  user_id uuid not null,
  capability text not null
    check (capability in ('can_receive_stock','can_adjust_stock')),
  previous_allowed boolean not null,
  new_allowed boolean not null,
  actor_user_id uuid not null,
  created_at timestamptz not null default now(),
  constraint tenant_member_capability_events_target_same_tenant
    foreign key (tenant_id,user_id)
    references public.tenant_members(tenant_id,user_id)
    on delete restrict,
  constraint tenant_member_capability_events_actor_same_tenant
    foreign key (tenant_id,actor_user_id)
    references public.tenant_members(tenant_id,user_id)
    on delete restrict
);

create index tenant_member_capability_events_target_idx
  on public.tenant_member_capability_events(
    tenant_id,user_id,capability,created_at desc
  );

alter table public.tenant_member_capability_events enable row level security;
revoke all on table public.tenant_member_capability_events
  from public,anon,authenticated;
grant all on table public.tenant_member_capability_events to service_role;

create or replace function public.prevent_sellertray_capability_event_mutation()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  raise exception 'SellerTray permission history is immutable' using errcode='55000';
end;
$$;

revoke all on function public.prevent_sellertray_capability_event_mutation()
  from public,anon,authenticated;

drop trigger if exists prevent_sellertray_capability_event_mutation
  on public.tenant_member_capability_events;
create trigger prevent_sellertray_capability_event_mutation
before update or delete on public.tenant_member_capability_events
for each row execute function public.prevent_sellertray_capability_event_mutation();

create or replace function public.set_sellertray_member_capability(
  p_tenant_id uuid,
  p_target_user_id uuid,
  p_capability text,
  p_allowed boolean,
  p_actor_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor_role text;
  v_target_role text;
  v_capability text := lower(btrim(coalesce(p_capability,'')));
  v_previous_override boolean;
  v_previous_effective boolean;
  v_changed boolean := false;
begin
  if p_tenant_id is null or p_target_user_id is null or p_actor_user_id is null
     or p_allowed is null then
    raise exception 'Business, staff member, permission and decision are required'
      using errcode='22023';
  end if;

  if v_capability not in ('can_receive_stock','can_adjust_stock') then
    raise exception 'Unknown SellerTray inventory permission' using errcode='22023';
  end if;

  select tm.role into v_actor_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id
    and tm.user_id=p_actor_user_id;

  select tm.role into v_target_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id
    and tm.user_id=p_target_user_id;

  if v_actor_role not in ('owner','manager') then
    raise exception 'Only an Owner or Manager can change staff permissions'
      using errcode='42501';
  end if;
  if v_target_role is null then
    raise exception 'Staff member does not belong to this business' using errcode='23503';
  end if;
  if v_target_role='owner' then
    raise exception 'Owner inventory authority cannot be changed here' using errcode='42501';
  end if;
  if v_actor_role='manager' and v_target_role<>'staff' then
    raise exception 'Managers can change inventory permissions for Staff only'
      using errcode='42501';
  end if;

  v_previous_effective := public.sellertray_user_has_capability(
    p_tenant_id,p_target_user_id,v_capability
  );

  select c.allowed into v_previous_override
  from public.tenant_member_capabilities c
  where c.tenant_id=p_tenant_id
    and c.user_id=p_target_user_id
    and c.capability=v_capability;

  if not found or v_previous_override is distinct from p_allowed then
    v_changed := true;
  end if;

  insert into public.tenant_member_capabilities(
    tenant_id,user_id,capability,allowed,granted_by,created_at,updated_at
  ) values(
    p_tenant_id,p_target_user_id,v_capability,p_allowed,p_actor_user_id,now(),now()
  )
  on conflict(tenant_id,user_id,capability) do update
    set allowed=excluded.allowed,
        granted_by=excluded.granted_by,
        updated_at=now();

  if v_changed then
    insert into public.tenant_member_capability_events(
      tenant_id,user_id,capability,previous_allowed,new_allowed,actor_user_id
    ) values(
      p_tenant_id,p_target_user_id,v_capability,
      v_previous_effective,p_allowed,p_actor_user_id
    );
  end if;

  return p_allowed;
end;
$$;

revoke all on function public.set_sellertray_member_capability(uuid,uuid,text,boolean,uuid)
  from public,anon,authenticated;
grant execute on function public.set_sellertray_member_capability(uuid,uuid,text,boolean,uuid)
  to service_role;

commit;