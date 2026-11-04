-- OA5: ProcessEdge internal installation identity and appointment-scope foundation.
-- No merchant membership, general platform_admins role, subscription, settlement or
-- existing appointment readiness authority is widened by this migration.
-- All mutation APIs remain service-role-only pending the audited AAL2 transport
-- and dedicated Mobile installation workflow. This PR is not deployable alone.
begin;

create table public.sellertray_internal_setup_staff (
  user_id uuid primary key references auth.users(id) on delete restrict,
  worker_id uuid not null unique references public.sellertray_setup_workers(id) on delete restrict,
  staff_role text not null default 'setup_installer'
    check (staff_role='setup_installer'),
  status text not null default 'pending'
    check (status in ('pending','active','suspended','revoked')),
  registered_by_user_id uuid not null references auth.users(id) on delete restrict,
  registered_at timestamptz not null default now(),
  activated_at timestamptz,
  updated_at timestamptz not null default now(),
  check (status<>'active' or activated_at is not null)
);

create table public.sellertray_internal_setup_staff_assignments (
  id uuid primary key default gen_random_uuid(),
  staff_user_id uuid not null references public.sellertray_internal_setup_staff(user_id) on delete restrict,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  appointment_id uuid not null references public.sellertray_commercial_setup_appointments(id) on delete restrict,
  worker_id uuid not null references public.sellertray_setup_workers(id) on delete restrict,
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  assigned_by_user_id uuid not null references auth.users(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by_user_id uuid references auth.users(id) on delete restrict,
  revocation_reason text,
  constraint sellertray_setup_installer_assignment_time_check check (valid_until>valid_from),
  constraint sellertray_setup_installer_assignment_revoke_check check (
    (revoked_at is null and revoked_by_user_id is null and revocation_reason is null)
    or (revoked_at is not null and revoked_by_user_id is not null
        and char_length(btrim(revocation_reason)) between 6 and 1000)
  )
);
create unique index sellertray_setup_installer_one_current_assignment
  on public.sellertray_internal_setup_staff_assignments(appointment_id) where revoked_at is null;
create index sellertray_setup_installer_staff_assignments_scope
  on public.sellertray_internal_setup_staff_assignments(staff_user_id,tenant_id,branch_id,valid_until desc);

create table public.sellertray_internal_setup_staff_events (
  id uuid primary key default gen_random_uuid(),
  command_id uuid not null unique,
  staff_user_id uuid not null references public.sellertray_internal_setup_staff(user_id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  event_type text not null check (event_type in (
    'registered','activated','suspended','revoked','assignment_created','assignment_revoked'
  )),
  tenant_id uuid references public.tenants(id) on delete restrict,
  appointment_id uuid references public.sellertray_commercial_setup_appointments(id) on delete restrict,
  reason text not null check (char_length(btrim(reason)) between 6 and 1000),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details)='object'),
  created_at timestamptz not null default now()
);
create index sellertray_internal_setup_staff_events_staff_recent
  on public.sellertray_internal_setup_staff_events(staff_user_id,created_at desc);

create trigger prevent_sellertray_internal_setup_staff_event_mutation
  before update or delete on public.sellertray_internal_setup_staff_events
  for each row execute function public.prevent_sellertray_commercial_history_mutation();

alter table public.sellertray_internal_setup_staff enable row level security;
alter table public.sellertray_internal_setup_staff_assignments enable row level security;
alter table public.sellertray_internal_setup_staff_events enable row level security;
revoke all on public.sellertray_internal_setup_staff from public,anon,authenticated;
revoke all on public.sellertray_internal_setup_staff_assignments from public,anon,authenticated;
revoke all on public.sellertray_internal_setup_staff_events from public,anon,authenticated;
grant select,insert,update on public.sellertray_internal_setup_staff to service_role;
grant select,insert,update on public.sellertray_internal_setup_staff_assignments to service_role;
grant select,insert on public.sellertray_internal_setup_staff_events to service_role;

-- An appointment assignment is a distinct internal permission, never a
-- merchant membership. Active worker, exact purchased Branch, assignment
-- status and validity interval must all agree at the time of each command.
create or replace function public.sellertray_setup_installer_has_assignment(
  p_actor_user_id uuid,p_tenant_id uuid,p_branch_id uuid,p_appointment_id uuid default null,
  p_as_of timestamptz default now()
) returns boolean language sql stable security invoker set search_path='' as $access$
  select p_actor_user_id is not null and p_tenant_id is not null
    and p_branch_id is not null and p_as_of is not null
    and exists (
      select 1 from public.sellertray_internal_setup_staff s
      join public.sellertray_setup_workers w
        on w.id=s.worker_id and w.active
      join public.sellertray_internal_setup_staff_assignments a
        on a.staff_user_id=s.user_id and a.worker_id=w.id
      join public.sellertray_commercial_setup_appointments ap
        on ap.id=a.appointment_id and ap.worker_id=a.worker_id
        and ap.tenant_id=a.tenant_id and ap.branch_id=a.branch_id
      join public.tenants t on t.id=a.tenant_id and t.retired_at is null
      where s.user_id=p_actor_user_id and s.staff_role='setup_installer'
        and s.status='active' and a.tenant_id=p_tenant_id
        and a.branch_id=p_branch_id
        and (p_appointment_id is null or a.appointment_id=p_appointment_id)
        and a.revoked_at is null and a.valid_from<=p_as_of
        and a.valid_until>p_as_of
        and ap.status in ('scheduled','in_progress')
        and exists (
          select 1 from public.sellertray_commercial_order_price_snapshots x
          where x.tenant_id=a.tenant_id and x.commercial_order_id=ap.commercial_order_id
            and x.branch_id=a.branch_id and x.line_type='branch_setup'
        )
    );
$access$;
revoke all on function public.sellertray_setup_installer_has_assignment(uuid,uuid,uuid,uuid,timestamptz)
  from public,anon,authenticated;
grant execute on function public.sellertray_setup_installer_has_assignment(uuid,uuid,uuid,uuid,timestamptz)
  to service_role;

-- Only a platform Admin (not Support) with explicit setup capability may
-- link an already authenticated ProcessEdge staff user to a scheduling worker.
-- Staff starts pending and does not gain any installation authority merely
-- by being linked. A later AAL2 Admin transport handles actual invitations.
create or replace function public.platform_admin_link_setup_installer(
  p_actor_user_id uuid,p_staff_user_id uuid,p_worker_id uuid,
  p_command_id uuid,p_reason text
) returns uuid language plpgsql security definer set search_path='' as $link$
declare
  v_current public.sellertray_internal_setup_staff%rowtype;
  v_existing public.sellertray_internal_setup_staff_events%rowtype;
begin
  if p_actor_user_id is null or p_staff_user_id is null or p_worker_id is null
     or p_command_id is null or char_length(btrim(coalesce(p_reason,''))) not between 6 and 1000 then
    raise exception 'ProcessEdge staff identity, worker, command and reason are required' using errcode='22023';
  end if;
  if not exists (select 1 from public.platform_admins pa
      where pa.user_id=p_actor_user_id and pa.role='admin')
     or not public.platform_admin_has_capability(
       p_actor_user_id,'admin.branch_setup.manage',null,now()
     ) then raise exception 'ProcessEdge staff administration requires Platform Admin setup authority' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_command_id::text,0));
  select * into v_existing from public.sellertray_internal_setup_staff_events
   where command_id=p_command_id;
  if found then
    if v_existing.actor_user_id<>p_actor_user_id
       or v_existing.staff_user_id<>p_staff_user_id
       or v_existing.event_type<>'registered'
       or v_existing.reason<>btrim(p_reason)
       or v_existing.details->>'workerId'<>p_worker_id::text then
      raise exception 'Installer account command already used for different facts' using errcode='23505';
    end if;
    return p_staff_user_id;
  end if;
  if not exists(select 1 from auth.users u where u.id=p_staff_user_id)
     or not exists(select 1 from public.sellertray_setup_workers w
       where w.id=p_worker_id and w.active) then
    raise exception 'Verified ProcessEdge user and active setup worker are required' using errcode='23514';
  end if;
  if exists(select 1 from public.platform_admins pa where pa.user_id=p_staff_user_id)
     or exists(select 1 from public.tenant_members tm where tm.user_id=p_staff_user_id) then
    raise exception 'A dedicated ProcessEdge installer identity is required' using errcode='23514';
  end if;
  insert into public.sellertray_internal_setup_staff(
     user_id,worker_id,staff_role,status,registered_by_user_id
  ) values (p_staff_user_id,p_worker_id,'setup_installer','pending',p_actor_user_id)
  returning * into v_current;
  insert into public.sellertray_internal_setup_staff_events(
    command_id,staff_user_id,actor_user_id,event_type,reason,details
  ) values (
    p_command_id,p_staff_user_id,p_actor_user_id,'registered',btrim(p_reason),
    jsonb_build_object('workerId',p_worker_id,'status','pending')
  );
  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(p_actor_user_id,null,'setup_installer_registered',
    jsonb_build_object('userId',p_staff_user_id,'workerId',p_worker_id,'commandId',p_command_id));
  return v_current.user_id;
end;
$link$;
revoke all on function public.platform_admin_link_setup_installer(uuid,uuid,uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.platform_admin_link_setup_installer(uuid,uuid,uuid,uuid,text)
  to service_role;

-- Status transition requires a separately verified Admin command. Only a
-- confirmed email may become active; revocation is permanent and takes
-- immediate effect in the assignment resolver.
create or replace function public.platform_admin_set_setup_installer_status(
  p_actor_user_id uuid,p_staff_user_id uuid,p_status text,
  p_command_id uuid,p_reason text
) returns text language plpgsql security definer set search_path='' as $status$
declare
  v_current public.sellertray_internal_setup_staff%rowtype;
  v_existing public.sellertray_internal_setup_staff_events%rowtype;
  v_target text:=lower(btrim(coalesce(p_status,'')));
begin
  if p_actor_user_id is null or p_staff_user_id is null or p_command_id is null
     or v_target not in ('active','suspended','revoked')
     or char_length(btrim(coalesce(p_reason,''))) not between 6 and 1000 then
    raise exception 'Installer status, command and reason are required' using errcode='22023';
  end if;
  if not exists(select 1 from public.platform_admins pa where pa.user_id=p_actor_user_id and pa.role='admin')
     or not public.platform_admin_has_capability(p_actor_user_id,'admin.branch_setup.manage',null,now()) then
    raise exception 'ProcessEdge staff status requires Platform Admin setup authority' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_command_id::text,0));
  select * into v_existing from public.sellertray_internal_setup_staff_events where command_id=p_command_id;
  if found then
    if v_existing.actor_user_id<>p_actor_user_id or v_existing.staff_user_id<>p_staff_user_id
       or v_existing.event_type<>case v_target when 'active' then 'activated'
          when 'suspended' then 'suspended' else 'revoked' end
       or v_existing.reason<>btrim(p_reason) then
      raise exception 'Installer status command already used for different facts' using errcode='23505';
    end if;
    return v_target;
  end if;
  select * into strict v_current from public.sellertray_internal_setup_staff
    where user_id=p_staff_user_id for update;
  if v_current.status='revoked' then
    raise exception 'Revoked installer accounts cannot be reactivated' using errcode='23514';
  end if;
  if v_target=v_current.status then
    raise exception 'Installer status is already set; use prior command for idempotent replay' using errcode='23514';
  end if;
  if v_target='active' and not exists(
    select 1 from auth.users u where u.id=p_staff_user_id and u.email_confirmed_at is not null
  ) then raise exception 'Verified installer email is required before activation' using errcode='23514';
  end if;
  update public.sellertray_internal_setup_staff set
    status=v_target,
    activated_at=case when v_target='active' then coalesce(activated_at,now()) else activated_at end,
    updated_at=now()
  where user_id=p_staff_user_id;
  insert into public.sellertray_internal_setup_staff_events(
    command_id,staff_user_id,actor_user_id,event_type,reason,details
  ) values (
    p_command_id,p_staff_user_id,p_actor_user_id,
    case v_target when 'active' then 'activated' when 'suspended' then 'suspended' else 'revoked' end,
    btrim(p_reason),jsonb_build_object('from',v_current.status,'to',v_target)
  );
  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(p_actor_user_id,null,'setup_installer_status_updated',
    jsonb_build_object('userId',p_staff_user_id,'from',v_current.status,'to',v_target,'commandId',p_command_id));
  return v_target;
end;
$status$;
revoke all on function public.platform_admin_set_setup_installer_status(uuid,uuid,text,uuid,text)
  from public,anon,authenticated;
grant execute on function public.platform_admin_set_setup_installer_status(uuid,uuid,text,uuid,text)
  to service_role;

commit;
