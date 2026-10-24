begin;

-- SellerTray OA3 — governed setup scheduling.
--
-- Scheduling is attached to the existing commercial Branch-setup obligation and
-- existing immutable readiness fact. It does not create a parallel onboarding or
-- activation state machine. Appointment completion records the existing setup
-- readiness fact and then invokes the existing entitlement reconciliation.

create table if not exists public.sellertray_setup_service_areas (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sellertray_setup_service_areas_code_check check (char_length(btrim(code)) between 2 and 64),
  constraint sellertray_setup_service_areas_name_check check (char_length(btrim(name)) between 2 and 160)
);

create table if not exists public.sellertray_setup_workers (
  id uuid primary key default gen_random_uuid(),
  worker_code text not null unique,
  display_name text not null,
  active boolean not null default true,
  max_concurrent_setups integer not null default 1,
  travel_buffer_minutes integer not null default 30,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sellertray_setup_workers_code_check check (char_length(btrim(worker_code)) between 2 and 64),
  constraint sellertray_setup_workers_name_check check (char_length(btrim(display_name)) between 2 and 160),
  constraint sellertray_setup_workers_capacity_check check (max_concurrent_setups between 1 and 20),
  constraint sellertray_setup_workers_buffer_check check (travel_buffer_minutes between 0 and 480)
);

create table if not exists public.sellertray_setup_worker_service_areas (
  worker_id uuid not null references public.sellertray_setup_workers(id),
  service_area_id uuid not null references public.sellertray_setup_service_areas(id),
  created_at timestamptz not null default now(),
  primary key (worker_id,service_area_id)
);

create table if not exists public.sellertray_setup_branch_service_areas (
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  service_area_id uuid not null references public.sellertray_setup_service_areas(id),
  assigned_by_user_id uuid not null references auth.users(id),
  assigned_at timestamptz not null default now(),
  primary key (tenant_id,branch_id)
);

create table if not exists public.sellertray_commercial_setup_appointments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  commercial_order_id uuid not null references public.sellertray_commercial_orders(id),
  branch_id uuid not null references public.branches(id),
  worker_id uuid not null references public.sellertray_setup_workers(id),
  service_area_id uuid not null references public.sellertray_setup_service_areas(id),
  scheduled_start_at timestamptz not null,
  scheduled_end_at timestamptz not null,
  travel_buffer_minutes_snapshot integer not null,
  status text not null default 'scheduled',
  merchant_note text,
  internal_note text,
  created_by_user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  cancelled_at timestamptz,
  constraint sellertray_setup_appointment_window_check check (scheduled_end_at>scheduled_start_at),
  constraint sellertray_setup_appointment_duration_check check (scheduled_end_at<=scheduled_start_at+interval '16 hours'),
  constraint sellertray_setup_appointment_buffer_check check (travel_buffer_minutes_snapshot between 0 and 480),
  constraint sellertray_setup_appointment_status_check check (status in ('scheduled','in_progress','completed','cancelled','no_show')),
  constraint sellertray_setup_appointment_merchant_note_check check (merchant_note is null or char_length(merchant_note)<=2000),
  constraint sellertray_setup_appointment_internal_note_check check (internal_note is null or char_length(internal_note)<=4000)
);

create unique index if not exists sellertray_setup_one_active_subject_idx
  on public.sellertray_commercial_setup_appointments(tenant_id,commercial_order_id,branch_id)
  where status in ('scheduled','in_progress');
create index if not exists sellertray_setup_worker_schedule_idx
  on public.sellertray_commercial_setup_appointments(worker_id,scheduled_start_at,scheduled_end_at)
  where status in ('scheduled','in_progress');
create index if not exists sellertray_setup_tenant_schedule_idx
  on public.sellertray_commercial_setup_appointments(tenant_id,scheduled_start_at desc);

create table if not exists public.sellertray_commercial_setup_appointment_events (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.sellertray_commercial_setup_appointments(id),
  tenant_id uuid not null references public.tenants(id),
  commercial_order_id uuid not null references public.sellertray_commercial_orders(id),
  branch_id uuid not null references public.branches(id),
  command_id uuid not null unique,
  event_type text not null,
  actor_user_id uuid not null references auth.users(id),
  actor_kind text not null default 'platform',
  reason text not null,
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint sellertray_setup_event_type_check check (event_type in ('scheduled','rescheduled','reassigned','started','completed','cancelled','no_show')),
  constraint sellertray_setup_event_actor_kind_check check (actor_kind in ('platform','merchant')),
  constraint sellertray_setup_event_reason_check check (char_length(btrim(reason)) between 6 and 1000),
  constraint sellertray_setup_event_details_check check (jsonb_typeof(details)='object')
);

create index if not exists sellertray_setup_events_appointment_idx
  on public.sellertray_commercial_setup_appointment_events(appointment_id,occurred_at,id);

create table if not exists public.sellertray_setup_reschedule_requests (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.sellertray_commercial_setup_appointments(id),
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  command_id uuid not null unique,
  requested_by_user_id uuid not null references auth.users(id),
  requested_start_at timestamptz,
  requested_end_at timestamptz,
  merchant_note text not null,
  status text not null default 'pending',
  resolved_by_user_id uuid references auth.users(id),
  resolution_note text,
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint sellertray_setup_reschedule_window_check check (
    (requested_start_at is null and requested_end_at is null)
    or (requested_start_at is not null and requested_end_at is not null and requested_end_at>requested_start_at)
  ),
  constraint sellertray_setup_reschedule_note_check check (char_length(btrim(merchant_note)) between 6 and 2000),
  constraint sellertray_setup_reschedule_status_check check (status in ('pending','accepted','declined','withdrawn'))
);
create index if not exists sellertray_setup_reschedule_pending_idx
  on public.sellertray_setup_reschedule_requests(tenant_id,status,requested_at)
  where status='pending';

alter table public.sellertray_setup_service_areas enable row level security;
alter table public.sellertray_setup_workers enable row level security;
alter table public.sellertray_setup_worker_service_areas enable row level security;
alter table public.sellertray_setup_branch_service_areas enable row level security;
alter table public.sellertray_commercial_setup_appointments enable row level security;
alter table public.sellertray_commercial_setup_appointment_events enable row level security;
alter table public.sellertray_setup_reschedule_requests enable row level security;

revoke all on table public.sellertray_setup_service_areas from public,anon,authenticated;
revoke all on table public.sellertray_setup_workers from public,anon,authenticated;
revoke all on table public.sellertray_setup_worker_service_areas from public,anon,authenticated;
revoke all on table public.sellertray_setup_branch_service_areas from public,anon,authenticated;
revoke all on table public.sellertray_commercial_setup_appointments from public,anon,authenticated;
revoke all on table public.sellertray_commercial_setup_appointment_events from public,anon,authenticated;
revoke all on table public.sellertray_setup_reschedule_requests from public,anon,authenticated;

grant all on table public.sellertray_setup_service_areas to service_role;
grant all on table public.sellertray_setup_workers to service_role;
grant all on table public.sellertray_setup_worker_service_areas to service_role;
grant all on table public.sellertray_setup_branch_service_areas to service_role;
grant all on table public.sellertray_commercial_setup_appointments to service_role;
grant all on table public.sellertray_commercial_setup_appointment_events to service_role;
grant all on table public.sellertray_setup_reschedule_requests to service_role;

create or replace function public.prevent_sellertray_setup_event_mutation()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  raise exception 'SellerTray setup history is immutable' using errcode='55000';
end;
$$;

drop trigger if exists sellertray_setup_events_immutable on public.sellertray_commercial_setup_appointment_events;
create trigger sellertray_setup_events_immutable
before update or delete on public.sellertray_commercial_setup_appointment_events
for each row execute function public.prevent_sellertray_setup_event_mutation();

create or replace function public.assert_sellertray_setup_subject(
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_branch_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path=''
as $$
begin
  if not exists (
    select 1
    from public.sellertray_commercial_order_price_snapshots s
    join public.branches b on b.id=s.branch_id and b.tenant_id=s.tenant_id
    where s.tenant_id=p_tenant_id
      and s.commercial_order_id=p_commercial_order_id
      and s.line_type='branch_setup'
      and s.branch_id=p_branch_id
      and b.is_active
  ) then
    raise exception 'Branch is not part of this governed active SellerTray setup purchase' using errcode='23514';
  end if;
end;
$$;
revoke all on function public.assert_sellertray_setup_subject(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.assert_sellertray_setup_subject(uuid,uuid,uuid) to service_role;

create or replace function public.assert_sellertray_setup_capacity(
  p_worker_id uuid,
  p_service_area_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_exclude_appointment_id uuid default null
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_worker public.sellertray_setup_workers%rowtype;
  v_conflicts integer;
begin
  if p_start_at is null or p_end_at is null or p_end_at<=p_start_at then
    raise exception 'A valid setup appointment window is required' using errcode='22023';
  end if;
  if p_start_at<now()-interval '5 minutes' then
    raise exception 'A setup appointment cannot be scheduled in the past' using errcode='22023';
  end if;

  select w.* into strict v_worker
  from public.sellertray_setup_workers w
  where w.id=p_worker_id
  for update;

  if not v_worker.active then
    raise exception 'Selected setup worker is inactive' using errcode='23514';
  end if;
  if not exists (
    select 1 from public.sellertray_setup_worker_service_areas c
    where c.worker_id=v_worker.id and c.service_area_id=p_service_area_id
  ) then
    raise exception 'Selected setup worker does not cover this service area' using errcode='23514';
  end if;

  select count(*)::integer into v_conflicts
  from public.sellertray_commercial_setup_appointments a
  where a.worker_id=v_worker.id
    and a.status in ('scheduled','in_progress')
    and (p_exclude_appointment_id is null or a.id<>p_exclude_appointment_id)
    and a.scheduled_start_at < p_end_at + make_interval(mins=>greatest(v_worker.travel_buffer_minutes,a.travel_buffer_minutes_snapshot))
    and a.scheduled_end_at > p_start_at - make_interval(mins=>greatest(v_worker.travel_buffer_minutes,a.travel_buffer_minutes_snapshot));

  if v_conflicts>=v_worker.max_concurrent_setups then
    raise exception 'Selected setup worker has reached capacity for this time including travel buffer' using errcode='23514';
  end if;
end;
$$;
revoke all on function public.assert_sellertray_setup_capacity(uuid,uuid,timestamptz,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.assert_sellertray_setup_capacity(uuid,uuid,timestamptz,timestamptz,uuid) to service_role;

-- Converge the older readiness mutation on the named branch-setup capability.
create or replace function public.mark_sellertray_commercial_branch_setup_ready(
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_branch_id uuid,
  p_command_id uuid,
  p_evidence jsonb,
  p_reason text,
  p_ready_at timestamptz,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_evidence jsonb := coalesce(p_evidence,'{}'::jsonb);
  v_reason text := btrim(coalesce(p_reason,''));
  v_existing public.sellertray_commercial_branch_setup_readiness%rowtype;
  v_id uuid;
begin
  if p_tenant_id is null or p_commercial_order_id is null or p_branch_id is null
     or p_command_id is null or p_ready_at is null or p_actor_user_id is null then
    raise exception 'Business, commercial order, Branch, command, setup time and actor are required' using errcode='22023';
  end if;
  if jsonb_typeof(v_evidence)<>'object' then
    raise exception 'Setup readiness evidence must be an object' using errcode='22023';
  end if;
  if char_length(v_reason) not between 1 and 1000 then
    raise exception 'Setup readiness reason is required' using errcode='22023';
  end if;
  if p_ready_at>now()+interval '5 minutes' then
    raise exception 'Setup readiness time cannot be in the future' using errcode='22023';
  end if;
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.branch_setup.manage',p_tenant_id,now()) then
    raise exception 'Branch setup management capability required' using errcode='42501';
  end if;

  perform public.assert_sellertray_setup_subject(p_tenant_id,p_commercial_order_id,p_branch_id);

  insert into public.sellertray_commercial_branch_setup_readiness(
    tenant_id,commercial_order_id,branch_id,command_id,evidence,
    actor_user_id,reason,ready_at,recorded_at
  ) values (
    p_tenant_id,p_commercial_order_id,p_branch_id,p_command_id,v_evidence,
    p_actor_user_id,v_reason,p_ready_at,now()
  )
  on conflict do nothing
  returning id into v_id;

  if v_id is not null then return v_id; end if;

  select r.* into v_existing
  from public.sellertray_commercial_branch_setup_readiness r
  where r.tenant_id=p_tenant_id and r.command_id=p_command_id;

  if not found then
    select r.* into strict v_existing
    from public.sellertray_commercial_branch_setup_readiness r
    where r.tenant_id=p_tenant_id and r.commercial_order_id=p_commercial_order_id and r.branch_id=p_branch_id;
  end if;

  if v_existing.commercial_order_id<>p_commercial_order_id
     or v_existing.branch_id<>p_branch_id
     or v_existing.evidence is distinct from v_evidence
     or v_existing.actor_user_id<>p_actor_user_id
     or v_existing.reason<>v_reason
     or v_existing.ready_at<>p_ready_at then
    raise exception 'SellerTray setup readiness is already recorded with different facts' using errcode='23505';
  end if;
  return v_existing.id;
end;
$$;
revoke all on function public.mark_sellertray_commercial_branch_setup_ready(uuid,uuid,uuid,uuid,jsonb,text,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.mark_sellertray_commercial_branch_setup_ready(uuid,uuid,uuid,uuid,jsonb,text,timestamptz,uuid) to service_role;

create or replace function public.platform_admin_upsert_setup_service_area(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_service_area_id uuid,
  p_code text,
  p_name text,
  p_active boolean,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_id uuid;
  v_code text:=lower(btrim(coalesce(p_code,'')));
  v_name text:=btrim(coalesce(p_name,''));
  v_reason text:=btrim(coalesce(p_reason,''));
begin
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.branch_setup.manage',p_tenant_id,now()) then
    raise exception 'Branch setup management capability required' using errcode='42501';
  end if;
  if char_length(v_code) not between 2 and 64 or char_length(v_name) not between 2 and 160 or char_length(v_reason)<6 then
    raise exception 'Service area code, name and reason are required' using errcode='22023';
  end if;

  if p_service_area_id is null then
    insert into public.sellertray_setup_service_areas(code,name,active)
    values(v_code,v_name,coalesce(p_active,true)) returning id into v_id;
  else
    update public.sellertray_setup_service_areas
    set code=v_code,name=v_name,active=coalesce(p_active,true),updated_at=now()
    where id=p_service_area_id returning id into v_id;
    if v_id is null then raise exception 'Setup service area not found' using errcode='P0002'; end if;
  end if;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(p_actor_user_id,p_tenant_id,'setup_service_area_saved',jsonb_build_object('serviceAreaId',v_id,'reason',v_reason));
  return v_id;
end;
$$;

create or replace function public.platform_admin_upsert_setup_worker(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_worker_id uuid,
  p_worker_code text,
  p_display_name text,
  p_active boolean,
  p_max_concurrent_setups integer,
  p_travel_buffer_minutes integer,
  p_service_area_ids uuid[],
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_id uuid;
  v_code text:=lower(btrim(coalesce(p_worker_code,'')));
  v_name text:=btrim(coalesce(p_display_name,''));
  v_reason text:=btrim(coalesce(p_reason,''));
begin
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.branch_setup.manage',p_tenant_id,now()) then
    raise exception 'Branch setup management capability required' using errcode='42501';
  end if;
  if char_length(v_code) not between 2 and 64 or char_length(v_name) not between 2 and 160 or char_length(v_reason)<6
     or coalesce(p_max_concurrent_setups,0) not between 1 and 20
     or coalesce(p_travel_buffer_minutes,-1) not between 0 and 480 then
    raise exception 'Valid worker identity, capacity, travel buffer and reason are required' using errcode='22023';
  end if;
  if exists (select 1 from unnest(coalesce(p_service_area_ids,'{}'::uuid[])) x(id) where not exists (select 1 from public.sellertray_setup_service_areas a where a.id=x.id and a.active)) then
    raise exception 'Worker coverage contains an inactive or unknown service area' using errcode='23514';
  end if;

  if p_worker_id is null then
    insert into public.sellertray_setup_workers(worker_code,display_name,active,max_concurrent_setups,travel_buffer_minutes)
    values(v_code,v_name,coalesce(p_active,true),p_max_concurrent_setups,p_travel_buffer_minutes) returning id into v_id;
  else
    update public.sellertray_setup_workers
    set worker_code=v_code,display_name=v_name,active=coalesce(p_active,true),
        max_concurrent_setups=p_max_concurrent_setups,travel_buffer_minutes=p_travel_buffer_minutes,updated_at=now()
    where id=p_worker_id returning id into v_id;
    if v_id is null then raise exception 'Setup worker not found' using errcode='P0002'; end if;
  end if;

  delete from public.sellertray_setup_worker_service_areas where worker_id=v_id;
  insert into public.sellertray_setup_worker_service_areas(worker_id,service_area_id)
  select v_id,x.id from unnest(coalesce(p_service_area_ids,'{}'::uuid[])) x(id) on conflict do nothing;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(p_actor_user_id,p_tenant_id,'setup_worker_saved',jsonb_build_object('workerId',v_id,'reason',v_reason,'serviceAreaIds',coalesce(to_jsonb(p_service_area_ids),'[]'::jsonb)));
  return v_id;
end;
$$;

create or replace function public.platform_admin_assign_branch_setup_service_area(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_branch_id uuid,
  p_service_area_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare v_reason text:=btrim(coalesce(p_reason,''));
begin
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.branch_setup.manage',p_tenant_id,now()) then
    raise exception 'Branch setup management capability required' using errcode='42501';
  end if;
  if char_length(v_reason)<6 then raise exception 'Assignment reason is required' using errcode='22023'; end if;
  if not exists(select 1 from public.branches b where b.id=p_branch_id and b.tenant_id=p_tenant_id) then
    raise exception 'Branch not found for this Business' using errcode='P0002';
  end if;
  if not exists(select 1 from public.sellertray_setup_service_areas a where a.id=p_service_area_id and a.active) then
    raise exception 'Active setup service area required' using errcode='23514';
  end if;

  insert into public.sellertray_setup_branch_service_areas(tenant_id,branch_id,service_area_id,assigned_by_user_id,assigned_at)
  values(p_tenant_id,p_branch_id,p_service_area_id,p_actor_user_id,now())
  on conflict (tenant_id,branch_id) do update
    set service_area_id=excluded.service_area_id,assigned_by_user_id=excluded.assigned_by_user_id,assigned_at=excluded.assigned_at;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(p_actor_user_id,p_tenant_id,'setup_branch_service_area_assigned',jsonb_build_object('branchId',p_branch_id,'serviceAreaId',p_service_area_id,'reason',v_reason));
end;
$$;

create or replace function public.platform_admin_schedule_branch_setup(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_branch_id uuid,
  p_worker_id uuid,
  p_service_area_id uuid,
  p_scheduled_start_at timestamptz,
  p_scheduled_end_at timestamptz,
  p_merchant_note text,
  p_internal_note text,
  p_command_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_worker public.sellertray_setup_workers%rowtype;
  v_existing_event public.sellertray_commercial_setup_appointment_events%rowtype;
  v_appointment_id uuid;
  v_reason text:=btrim(coalesce(p_reason,''));
  v_merchant_note text:=nullif(btrim(coalesce(p_merchant_note,'')),'');
  v_internal_note text:=nullif(btrim(coalesce(p_internal_note,'')),'');
begin
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.branch_setup.manage',p_tenant_id,now()) then
    raise exception 'Branch setup management capability required' using errcode='42501';
  end if;
  if p_command_id is null or char_length(v_reason)<6 then raise exception 'Scheduling command and reason are required' using errcode='22023'; end if;
  perform public.assert_sellertray_setup_subject(p_tenant_id,p_commercial_order_id,p_branch_id);
  if exists(select 1 from public.sellertray_commercial_branch_setup_readiness r where r.tenant_id=p_tenant_id and r.commercial_order_id=p_commercial_order_id and r.branch_id=p_branch_id) then
    raise exception 'Completed Branch setup cannot be scheduled again' using errcode='23514';
  end if;
  if not exists(select 1 from public.sellertray_setup_branch_service_areas a where a.tenant_id=p_tenant_id and a.branch_id=p_branch_id and a.service_area_id=p_service_area_id) then
    raise exception 'Branch is not assigned to the selected setup service area' using errcode='23514';
  end if;

  select e.* into v_existing_event from public.sellertray_commercial_setup_appointment_events e where e.command_id=p_command_id;
  if found then
    if v_existing_event.event_type<>'scheduled' or v_existing_event.tenant_id<>p_tenant_id or v_existing_event.commercial_order_id<>p_commercial_order_id or v_existing_event.branch_id<>p_branch_id then
      raise exception 'Setup scheduling command is already used for different facts' using errcode='23505';
    end if;
    return v_existing_event.appointment_id;
  end if;

  if exists(select 1 from public.sellertray_commercial_setup_appointments a where a.tenant_id=p_tenant_id and a.commercial_order_id=p_commercial_order_id and a.branch_id=p_branch_id and a.status in ('scheduled','in_progress')) then
    raise exception 'Branch setup already has an active appointment' using errcode='23505';
  end if;

  perform public.assert_sellertray_setup_capacity(p_worker_id,p_service_area_id,p_scheduled_start_at,p_scheduled_end_at,null);
  select w.* into strict v_worker from public.sellertray_setup_workers w where w.id=p_worker_id;

  insert into public.sellertray_commercial_setup_appointments(
    tenant_id,commercial_order_id,branch_id,worker_id,service_area_id,scheduled_start_at,scheduled_end_at,
    travel_buffer_minutes_snapshot,status,merchant_note,internal_note,created_by_user_id
  ) values (
    p_tenant_id,p_commercial_order_id,p_branch_id,p_worker_id,p_service_area_id,p_scheduled_start_at,p_scheduled_end_at,
    v_worker.travel_buffer_minutes,'scheduled',v_merchant_note,v_internal_note,p_actor_user_id
  ) returning id into v_appointment_id;

  insert into public.sellertray_commercial_setup_appointment_events(
    appointment_id,tenant_id,commercial_order_id,branch_id,command_id,event_type,actor_user_id,actor_kind,reason,details
  ) values (
    v_appointment_id,p_tenant_id,p_commercial_order_id,p_branch_id,p_command_id,'scheduled',p_actor_user_id,'platform',v_reason,
    jsonb_build_object('workerId',p_worker_id,'serviceAreaId',p_service_area_id,'scheduledStartAt',p_scheduled_start_at,'scheduledEndAt',p_scheduled_end_at,'merchantNote',v_merchant_note)
  );

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(p_actor_user_id,p_tenant_id,'branch_setup_scheduled',jsonb_build_object('appointmentId',v_appointment_id,'commercialOrderId',p_commercial_order_id,'branchId',p_branch_id,'commandId',p_command_id));
  return v_appointment_id;
end;
$$;

create or replace function public.platform_admin_reschedule_branch_setup(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_appointment_id uuid,
  p_worker_id uuid,
  p_service_area_id uuid,
  p_scheduled_start_at timestamptz,
  p_scheduled_end_at timestamptz,
  p_merchant_note text,
  p_internal_note text,
  p_reschedule_request_id uuid,
  p_command_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_appointment public.sellertray_commercial_setup_appointments%rowtype;
  v_worker public.sellertray_setup_workers%rowtype;
  v_existing_event public.sellertray_commercial_setup_appointment_events%rowtype;
  v_reason text:=btrim(coalesce(p_reason,''));
  v_event_type text;
begin
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.branch_setup.manage',p_tenant_id,now()) then raise exception 'Branch setup management capability required' using errcode='42501'; end if;
  if p_command_id is null or char_length(v_reason)<6 then raise exception 'Reschedule command and reason are required' using errcode='22023'; end if;
  select e.* into v_existing_event from public.sellertray_commercial_setup_appointment_events e where e.command_id=p_command_id;
  if found then
    if v_existing_event.appointment_id<>p_appointment_id or v_existing_event.event_type not in ('rescheduled','reassigned') then raise exception 'Setup reschedule command is already used for different facts' using errcode='23505'; end if;
    return p_appointment_id;
  end if;

  select a.* into strict v_appointment from public.sellertray_commercial_setup_appointments a where a.id=p_appointment_id and a.tenant_id=p_tenant_id for update;
  if v_appointment.status<>'scheduled' then raise exception 'Only scheduled setup appointments can be rescheduled' using errcode='23514'; end if;
  if not exists(select 1 from public.sellertray_setup_branch_service_areas a where a.tenant_id=p_tenant_id and a.branch_id=v_appointment.branch_id and a.service_area_id=p_service_area_id) then raise exception 'Branch is not assigned to the selected setup service area' using errcode='23514'; end if;

  perform public.assert_sellertray_setup_capacity(p_worker_id,p_service_area_id,p_scheduled_start_at,p_scheduled_end_at,p_appointment_id);
  select w.* into strict v_worker from public.sellertray_setup_workers w where w.id=p_worker_id;
  v_event_type:=case when v_appointment.worker_id<>p_worker_id then 'reassigned' else 'rescheduled' end;

  update public.sellertray_commercial_setup_appointments
  set worker_id=p_worker_id,service_area_id=p_service_area_id,scheduled_start_at=p_scheduled_start_at,scheduled_end_at=p_scheduled_end_at,
      travel_buffer_minutes_snapshot=v_worker.travel_buffer_minutes,
      merchant_note=nullif(btrim(coalesce(p_merchant_note,'')),''),internal_note=nullif(btrim(coalesce(p_internal_note,'')),''),updated_at=now()
  where id=p_appointment_id;

  insert into public.sellertray_commercial_setup_appointment_events(
    appointment_id,tenant_id,commercial_order_id,branch_id,command_id,event_type,actor_user_id,actor_kind,reason,details
  ) values (
    p_appointment_id,p_tenant_id,v_appointment.commercial_order_id,v_appointment.branch_id,p_command_id,v_event_type,p_actor_user_id,'platform',v_reason,
    jsonb_build_object('from',jsonb_build_object('workerId',v_appointment.worker_id,'serviceAreaId',v_appointment.service_area_id,'scheduledStartAt',v_appointment.scheduled_start_at,'scheduledEndAt',v_appointment.scheduled_end_at),'to',jsonb_build_object('workerId',p_worker_id,'serviceAreaId',p_service_area_id,'scheduledStartAt',p_scheduled_start_at,'scheduledEndAt',p_scheduled_end_at))
  );

  if p_reschedule_request_id is not null then
    update public.sellertray_setup_reschedule_requests
    set status='accepted',resolved_by_user_id=p_actor_user_id,resolution_note=v_reason,resolved_at=now()
    where id=p_reschedule_request_id and appointment_id=p_appointment_id and tenant_id=p_tenant_id and status='pending';
  end if;
  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(p_actor_user_id,p_tenant_id,'branch_setup_rescheduled',jsonb_build_object('appointmentId',p_appointment_id,'commandId',p_command_id,'reason',v_reason));
  return p_appointment_id;
end;
$$;

create or replace function public.platform_admin_transition_branch_setup(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_appointment_id uuid,
  p_target_status text,
  p_command_id uuid,
  p_reason text,
  p_evidence jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_appointment public.sellertray_commercial_setup_appointments%rowtype;
  v_existing_event public.sellertray_commercial_setup_appointment_events%rowtype;
  v_target text:=lower(btrim(coalesce(p_target_status,'')));
  v_reason text:=btrim(coalesce(p_reason,''));
  v_readiness_id uuid;
  v_obligation_id uuid;
  v_state jsonb;
begin
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.branch_setup.manage',p_tenant_id,now()) then raise exception 'Branch setup management capability required' using errcode='42501'; end if;
  if p_command_id is null or char_length(v_reason)<6 or jsonb_typeof(coalesce(p_evidence,'{}'::jsonb))<>'object' then raise exception 'Transition command, reason and evidence are required' using errcode='22023'; end if;
  if v_target not in ('in_progress','completed','cancelled','no_show') then raise exception 'Unsupported setup appointment transition' using errcode='22023'; end if;

  select e.* into v_existing_event from public.sellertray_commercial_setup_appointment_events e where e.command_id=p_command_id;
  if found then
    if v_existing_event.appointment_id<>p_appointment_id or v_existing_event.event_type<>case v_target when 'in_progress' then 'started' else v_target end then raise exception 'Setup transition command is already used for different facts' using errcode='23505'; end if;
    select jsonb_build_object('appointmentId',a.id,'status',a.status,'readinessId',r.id)
      into v_state
    from public.sellertray_commercial_setup_appointments a
    left join public.sellertray_commercial_branch_setup_readiness r on r.tenant_id=a.tenant_id and r.commercial_order_id=a.commercial_order_id and r.branch_id=a.branch_id
    where a.id=p_appointment_id;
    return v_state;
  end if;

  select a.* into strict v_appointment from public.sellertray_commercial_setup_appointments a where a.id=p_appointment_id and a.tenant_id=p_tenant_id for update;
  if v_target='in_progress' and v_appointment.status<>'scheduled' then raise exception 'Only a scheduled setup can start' using errcode='23514'; end if;
  if v_target in ('completed','no_show') and v_appointment.status not in ('scheduled','in_progress') then raise exception 'Only an active setup appointment can finish' using errcode='23514'; end if;
  if v_target='cancelled' and v_appointment.status<>'scheduled' then raise exception 'Only a scheduled setup appointment can be cancelled' using errcode='23514'; end if;

  update public.sellertray_commercial_setup_appointments
  set status=v_target,updated_at=now(),completed_at=case when v_target='completed' then now() else completed_at end,cancelled_at=case when v_target='cancelled' then now() else cancelled_at end
  where id=p_appointment_id;

  insert into public.sellertray_commercial_setup_appointment_events(
    appointment_id,tenant_id,commercial_order_id,branch_id,command_id,event_type,actor_user_id,actor_kind,reason,details
  ) values (
    p_appointment_id,p_tenant_id,v_appointment.commercial_order_id,v_appointment.branch_id,p_command_id,
    case v_target when 'in_progress' then 'started' else v_target end,p_actor_user_id,'platform',v_reason,
    jsonb_build_object('fromStatus',v_appointment.status,'toStatus',v_target,'evidence',coalesce(p_evidence,'{}'::jsonb))
  );

  if v_target='completed' then
    v_readiness_id:=public.mark_sellertray_commercial_branch_setup_ready(
      p_tenant_id,v_appointment.commercial_order_id,v_appointment.branch_id,p_command_id,
      coalesce(p_evidence,'{}'::jsonb)||jsonb_build_object('source','oa3_setup_appointment','appointmentId',p_appointment_id),
      v_reason,now(),p_actor_user_id
    );
    select io.id into v_obligation_id from public.sellertray_commercial_installment_obligations io
    where io.tenant_id=p_tenant_id and io.commercial_order_id=v_appointment.commercial_order_id order by io.created_at,io.id limit 1;
    if v_obligation_id is not null then perform public.reconcile_sellertray_installment_entitlement(p_tenant_id,v_obligation_id); end if;
  end if;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(p_actor_user_id,p_tenant_id,'branch_setup_'||v_target,jsonb_build_object('appointmentId',p_appointment_id,'commercialOrderId',v_appointment.commercial_order_id,'branchId',v_appointment.branch_id,'commandId',p_command_id));

  return jsonb_build_object('appointmentId',p_appointment_id,'status',v_target,'readinessId',v_readiness_id);
end;
$$;

create or replace function public.platform_admin_resolve_setup_reschedule_request(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_request_id uuid,
  p_decision text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare v_decision text:=lower(btrim(coalesce(p_decision,''))); v_reason text:=btrim(coalesce(p_reason,''));
begin
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.branch_setup.manage',p_tenant_id,now()) then raise exception 'Branch setup management capability required' using errcode='42501'; end if;
  if v_decision not in ('declined','withdrawn') or char_length(v_reason)<6 then raise exception 'A valid reschedule-request decision and reason are required' using errcode='22023'; end if;
  update public.sellertray_setup_reschedule_requests
  set status=v_decision,resolved_by_user_id=p_actor_user_id,resolution_note=v_reason,resolved_at=now()
  where id=p_request_id and tenant_id=p_tenant_id and status='pending';
  if not found then raise exception 'Pending setup reschedule request not found' using errcode='P0002'; end if;
  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(p_actor_user_id,p_tenant_id,'setup_reschedule_request_'||v_decision,jsonb_build_object('requestId',p_request_id,'reason',v_reason));
end;
$$;

create or replace function public.platform_admin_setup_scheduling_center(
  p_actor_user_id uuid,
  p_tenant_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare v_result jsonb;
begin
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.branch_setup.manage',p_tenant_id,now()) then raise exception 'Branch setup management capability required' using errcode='42501'; end if;
  select jsonb_build_object(
    'canManage',true,
    'serviceAreas',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'code',a.code,'name',a.name,'active',a.active) order by a.name) from public.sellertray_setup_service_areas a),'[]'::jsonb),
    'workers',coalesce((select jsonb_agg(jsonb_build_object('id',w.id,'code',w.worker_code,'name',w.display_name,'active',w.active,'maxConcurrentSetups',w.max_concurrent_setups,'travelBufferMinutes',w.travel_buffer_minutes,'serviceAreaIds',coalesce((select jsonb_agg(c.service_area_id order by c.service_area_id) from public.sellertray_setup_worker_service_areas c where c.worker_id=w.id),'[]'::jsonb)) order by w.display_name) from public.sellertray_setup_workers w),'[]'::jsonb),
    'branchAreas',coalesce((select jsonb_agg(jsonb_build_object('branchId',b.id,'branchCode',b.code,'branchName',b.name,'serviceAreaId',ba.service_area_id) order by b.name) from public.branches b left join public.sellertray_setup_branch_service_areas ba on ba.tenant_id=b.tenant_id and ba.branch_id=b.id where b.tenant_id=p_tenant_id and b.is_active),'[]'::jsonb),
    'appointments',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'commercialOrderId',a.commercial_order_id,'branchId',a.branch_id,'branchName',b.name,'workerId',a.worker_id,'workerName',w.display_name,'serviceAreaId',a.service_area_id,'serviceAreaName',sa.name,'scheduledStartAt',a.scheduled_start_at,'scheduledEndAt',a.scheduled_end_at,'status',a.status,'merchantNote',a.merchant_note,'internalNote',a.internal_note,'createdAt',a.created_at,'completedAt',a.completed_at) order by a.scheduled_start_at desc) from public.sellertray_commercial_setup_appointments a join public.branches b on b.id=a.branch_id join public.sellertray_setup_workers w on w.id=a.worker_id join public.sellertray_setup_service_areas sa on sa.id=a.service_area_id where a.tenant_id=p_tenant_id),'[]'::jsonb),
    'pendingRequests',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'appointmentId',r.appointment_id,'branchId',r.branch_id,'requestedStartAt',r.requested_start_at,'requestedEndAt',r.requested_end_at,'merchantNote',r.merchant_note,'requestedAt',r.requested_at,'requestedByUserId',r.requested_by_user_id) order by r.requested_at) from public.sellertray_setup_reschedule_requests r where r.tenant_id=p_tenant_id and r.status='pending'),'[]'::jsonb),
    'setupSubjects',coalesce((select jsonb_agg(jsonb_build_object('commercialOrderId',s.commercial_order_id,'branchId',s.branch_id,'branchCode',b.code,'branchName',b.name,'ready',rr.id is not null,'readyAt',rr.ready_at,'serviceAreaId',ba.service_area_id) order by s.line_no) from public.sellertray_commercial_order_price_snapshots s join public.branches b on b.id=s.branch_id and b.tenant_id=s.tenant_id left join public.sellertray_commercial_branch_setup_readiness rr on rr.tenant_id=s.tenant_id and rr.commercial_order_id=s.commercial_order_id and rr.branch_id=s.branch_id left join public.sellertray_setup_branch_service_areas ba on ba.tenant_id=s.tenant_id and ba.branch_id=s.branch_id where s.tenant_id=p_tenant_id and s.line_type='branch_setup'),'[]'::jsonb),
    'generatedAt',now()
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.get_sellertray_setup_schedule(
  p_tenant_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare v_user_id uuid:=(select auth.uid()); v_role text; v_state jsonb;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select tm.role into v_role from public.tenant_members tm where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;
  if v_role is null or v_role not in ('owner','manager') then raise exception 'Setup scheduling requires an Owner or Manager' using errcode='42501'; end if;
  select jsonb_build_object(
    'tenantId',p_tenant_id,
    'appointments',coalesce(jsonb_agg(jsonb_build_object('id',a.id,'commercialOrderId',a.commercial_order_id,'branchId',a.branch_id,'branchName',b.name,'scheduledStartAt',a.scheduled_start_at,'scheduledEndAt',a.scheduled_end_at,'status',a.status,'merchantNote',a.merchant_note,'serviceAreaName',sa.name,'ready',r.id is not null,'readyAt',r.ready_at,'pendingRescheduleRequest',exists(select 1 from public.sellertray_setup_reschedule_requests rq where rq.appointment_id=a.id and rq.status='pending')) order by a.scheduled_start_at),'[]'::jsonb),
    'generatedAt',now()
  ) into v_state
  from public.sellertray_commercial_setup_appointments a
  join public.branches b on b.id=a.branch_id and b.tenant_id=a.tenant_id
  join public.sellertray_setup_service_areas sa on sa.id=a.service_area_id
  left join public.sellertray_commercial_branch_setup_readiness r on r.tenant_id=a.tenant_id and r.commercial_order_id=a.commercial_order_id and r.branch_id=a.branch_id
  where a.tenant_id=p_tenant_id;
  return coalesce(v_state,jsonb_build_object('tenantId',p_tenant_id,'appointments','[]'::jsonb,'generatedAt',now()));
end;
$$;

create or replace function public.request_sellertray_setup_reschedule(
  p_tenant_id uuid,
  p_appointment_id uuid,
  p_requested_start_at timestamptz,
  p_requested_end_at timestamptz,
  p_merchant_note text,
  p_command_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid:=(select auth.uid());
  v_role text;
  v_appointment public.sellertray_commercial_setup_appointments%rowtype;
  v_existing public.sellertray_setup_reschedule_requests%rowtype;
  v_id uuid;
  v_note text:=btrim(coalesce(p_merchant_note,''));
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select tm.role into v_role from public.tenant_members tm where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;
  if v_role is null or v_role not in ('owner','manager') then raise exception 'Setup reschedule requests require an Owner or Manager' using errcode='42501'; end if;
  if p_command_id is null or char_length(v_note) not between 6 and 2000 then raise exception 'Reschedule command and note are required' using errcode='22023'; end if;
  if (p_requested_start_at is null)<>(p_requested_end_at is null) or (p_requested_start_at is not null and p_requested_end_at<=p_requested_start_at) then raise exception 'Requested setup window must be complete and valid' using errcode='22023'; end if;

  select a.* into strict v_appointment from public.sellertray_commercial_setup_appointments a where a.id=p_appointment_id and a.tenant_id=p_tenant_id;
  if v_appointment.status<>'scheduled' then raise exception 'Only a scheduled setup can be changed' using errcode='23514'; end if;

  select r.* into v_existing from public.sellertray_setup_reschedule_requests r where r.command_id=p_command_id;
  if found then
    if v_existing.tenant_id<>p_tenant_id or v_existing.appointment_id<>p_appointment_id or v_existing.requested_by_user_id<>v_user_id or v_existing.requested_start_at is distinct from p_requested_start_at or v_existing.requested_end_at is distinct from p_requested_end_at or v_existing.merchant_note<>v_note then raise exception 'Setup reschedule command is already used for different facts' using errcode='23505'; end if;
    return v_existing.id;
  end if;
  if exists(select 1 from public.sellertray_setup_reschedule_requests r where r.appointment_id=p_appointment_id and r.status='pending') then raise exception 'A setup reschedule request is already pending' using errcode='23505'; end if;

  insert into public.sellertray_setup_reschedule_requests(appointment_id,tenant_id,branch_id,command_id,requested_by_user_id,requested_start_at,requested_end_at,merchant_note)
  values(p_appointment_id,p_tenant_id,v_appointment.branch_id,p_command_id,v_user_id,p_requested_start_at,p_requested_end_at,v_note)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.platform_admin_upsert_setup_service_area(uuid,uuid,uuid,text,text,boolean,text) from public,anon,authenticated;
revoke all on function public.platform_admin_upsert_setup_worker(uuid,uuid,uuid,text,text,boolean,integer,integer,uuid[],text) from public,anon,authenticated;
revoke all on function public.platform_admin_assign_branch_setup_service_area(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.platform_admin_schedule_branch_setup(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,text,uuid,text) from public,anon,authenticated;
revoke all on function public.platform_admin_reschedule_branch_setup(uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,text,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.platform_admin_transition_branch_setup(uuid,uuid,uuid,text,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.platform_admin_resolve_setup_reschedule_request(uuid,uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.platform_admin_setup_scheduling_center(uuid,uuid) from public,anon,authenticated;

grant execute on function public.platform_admin_upsert_setup_service_area(uuid,uuid,uuid,text,text,boolean,text) to service_role;
grant execute on function public.platform_admin_upsert_setup_worker(uuid,uuid,uuid,text,text,boolean,integer,integer,uuid[],text) to service_role;
grant execute on function public.platform_admin_assign_branch_setup_service_area(uuid,uuid,uuid,uuid,text) to service_role;
grant execute on function public.platform_admin_schedule_branch_setup(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,text,uuid,text) to service_role;
grant execute on function public.platform_admin_reschedule_branch_setup(uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,text,uuid,uuid,text) to service_role;
grant execute on function public.platform_admin_transition_branch_setup(uuid,uuid,uuid,text,uuid,text,jsonb) to service_role;
grant execute on function public.platform_admin_resolve_setup_reschedule_request(uuid,uuid,uuid,text,text) to service_role;
grant execute on function public.platform_admin_setup_scheduling_center(uuid,uuid) to service_role;

revoke all on function public.get_sellertray_setup_schedule(uuid) from public,anon,authenticated;
grant execute on function public.get_sellertray_setup_schedule(uuid) to authenticated;
revoke all on function public.request_sellertray_setup_reschedule(uuid,uuid,timestamptz,timestamptz,text,uuid) from public,anon,authenticated;
grant execute on function public.request_sellertray_setup_reschedule(uuid,uuid,timestamptz,timestamptz,text,uuid) to authenticated;

comment on table public.sellertray_commercial_setup_appointments is 'OA3 current Branch setup appointment state. Completion feeds existing immutable Branch setup readiness authority.';
comment on table public.sellertray_commercial_setup_appointment_events is 'OA3 immutable appointment lifecycle history; current appointment state is never the activation authority.';
comment on function public.platform_admin_setup_scheduling_center(uuid,uuid) is 'AAL2 transport calls this named-capability-protected OA3 Admin scheduling projection.';
comment on function public.get_sellertray_setup_schedule(uuid) is 'Merchant Owner/Manager view of setup appointments; ProcessEdge internal notes and workforce details are intentionally excluded.';

commit;