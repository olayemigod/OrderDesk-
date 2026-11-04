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
        and s.status='active'
        -- A later role grant must not silently merge the ProcessEdge
        -- installer persona into platform Admin or merchant Team authority.
        and not exists(select 1 from public.platform_admins pa where pa.user_id=s.user_id)
        and not exists(select 1 from public.tenant_members tm where tm.user_id=s.user_id)
        and a.tenant_id=p_tenant_id
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
  v_expected_event_type text;
begin
  v_expected_event_type:=v_target;
  if v_target='active' then v_expected_event_type:='activated'; end if;
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
       or v_existing.event_type<>v_expected_event_type
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
  if v_target='active' and (
    exists(select 1 from public.platform_admins pa where pa.user_id=p_staff_user_id)
    or exists(select 1 from public.tenant_members tm where tm.user_id=p_staff_user_id)
  ) then raise exception 'Installer must use a separate ProcessEdge account' using errcode='23514';
  end if;
  -- Suspending or revoking a staff account also retires all active appointment
  -- assignments. Re-activation cannot silently revive an old assignment.
  if v_target in ('suspended','revoked') then
    with retired as (
      update public.sellertray_internal_setup_staff_assignments a
      set revoked_at=now(),revoked_by_user_id=p_actor_user_id,
          revocation_reason='Installer account status changed: '||v_target
      where a.staff_user_id=p_staff_user_id and a.revoked_at is null
      returning a.id,a.tenant_id,a.appointment_id,a.branch_id
    )
    insert into public.sellertray_internal_setup_staff_events(
      command_id,staff_user_id,actor_user_id,event_type,tenant_id,
      appointment_id,reason,details
    )
    select gen_random_uuid(),p_staff_user_id,p_actor_user_id,
      'assignment_revoked',r.tenant_id,r.appointment_id,
      'Assignment revoked on installer account '||v_target,
      jsonb_build_object('assignmentId',r.id,'branchId',r.branch_id,
        'sourceCommandId',p_command_id,'sourceStatus',v_target)
    from retired r;
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
    v_expected_event_type,
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


-- Bind an already active installer to exactly one governed, open appointment.
-- The appointment's worker assignment and Branch purchase are authoritative.
create or replace function public.platform_admin_assign_setup_installer(
  p_actor_user_id uuid,p_staff_user_id uuid,p_tenant_id uuid,
  p_appointment_id uuid,p_valid_until timestamptz,
  p_command_id uuid,p_reason text
) returns uuid language plpgsql security definer set search_path='' as $assign$
declare
  v_staff public.sellertray_internal_setup_staff%rowtype;
  v_appointment public.sellertray_commercial_setup_appointments%rowtype;
  v_existing_event public.sellertray_internal_setup_staff_events%rowtype;
  v_assignment public.sellertray_internal_setup_staff_assignments%rowtype;
begin
  if p_actor_user_id is null or p_staff_user_id is null or p_tenant_id is null
     or p_appointment_id is null or p_command_id is null or p_valid_until is null
     or p_valid_until<=now()
     or p_valid_until>now()+interval '90 days'
     or char_length(btrim(coalesce(p_reason,''))) not between 6 and 1000 then
    raise exception 'Appointment, installer, bounded expiry, command and reason are required' using errcode='22023';
  end if;
  if not exists (select 1 from public.platform_admins pa
      where pa.user_id=p_actor_user_id and pa.role='admin')
     or not public.platform_admin_has_capability(
       p_actor_user_id,'admin.branch_setup.manage',p_tenant_id,now()
     ) then raise exception 'Platform Admin Branch setup authority required' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_command_id::text,0));
  select * into v_existing_event from public.sellertray_internal_setup_staff_events
   where command_id=p_command_id;
  if found then
    if v_existing_event.actor_user_id<>p_actor_user_id
      or v_existing_event.staff_user_id<>p_staff_user_id
      or v_existing_event.tenant_id is distinct from p_tenant_id
      or v_existing_event.appointment_id is distinct from p_appointment_id
      or v_existing_event.event_type<>'assignment_created'
      or v_existing_event.reason<>btrim(p_reason)
      or (v_existing_event.details->>'validUntil')::timestamptz is distinct from p_valid_until then
      raise exception 'Installer assignment command already used for different facts' using errcode='23505';
    end if;
    return (v_existing_event.details->>'assignmentId')::uuid;
  end if;

  select * into strict v_staff from public.sellertray_internal_setup_staff
    where user_id=p_staff_user_id for share;
  if v_staff.status<>'active'
     or exists(select 1 from public.platform_admins pa where pa.user_id=p_staff_user_id)
     or exists(select 1 from public.tenant_members tm where tm.user_id=p_staff_user_id)
  then raise exception 'Only dedicated active ProcessEdge installers may be assigned' using errcode='23514';
  end if;
  select * into strict v_appointment from public.sellertray_commercial_setup_appointments
    where id=p_appointment_id and tenant_id=p_tenant_id for share;
  if v_appointment.worker_id<>v_staff.worker_id
     or v_appointment.status not in ('scheduled','in_progress')
     or not exists (select 1 from public.sellertray_setup_workers w
       where w.id=v_staff.worker_id and w.active)
     or not exists (select 1 from public.tenants t
       where t.id=p_tenant_id and t.retired_at is null)
     or not exists(
       select 1 from public.sellertray_commercial_order_price_snapshots x
       where x.tenant_id=p_tenant_id and x.commercial_order_id=v_appointment.commercial_order_id
         and x.branch_id=v_appointment.branch_id and x.line_type='branch_setup'
     ) then
    raise exception 'Installer must match the live purchased Branch setup appointment and worker' using errcode='23514';
  end if;

  insert into public.sellertray_internal_setup_staff_assignments(
     staff_user_id,tenant_id,branch_id,appointment_id,worker_id,
     valid_from,valid_until,assigned_by_user_id
  ) values(
     p_staff_user_id,p_tenant_id,v_appointment.branch_id,p_appointment_id,v_staff.worker_id,
     now(),p_valid_until,p_actor_user_id
  ) returning * into v_assignment;

  insert into public.sellertray_internal_setup_staff_events(
     command_id,staff_user_id,actor_user_id,event_type,tenant_id,
     appointment_id,reason,details
  ) values (
     p_command_id,p_staff_user_id,p_actor_user_id,'assignment_created',
     p_tenant_id,p_appointment_id,btrim(p_reason),
     jsonb_build_object('assignmentId',v_assignment.id,'workerId',v_staff.worker_id,
       'branchId',v_appointment.branch_id,'validUntil',p_valid_until)
  );
  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values (p_actor_user_id,p_tenant_id,'setup_installer_assigned',
    jsonb_build_object('staffUserId',p_staff_user_id,'appointmentId',p_appointment_id,
      'branchId',v_appointment.branch_id,'assignmentId',v_assignment.id,
      'commandId',p_command_id));
  return v_assignment.id;
end;
$assign$;
revoke all on function public.platform_admin_assign_setup_installer(
  uuid,uuid,uuid,uuid,timestamptz,uuid,text
) from public,anon,authenticated;
grant execute on function public.platform_admin_assign_setup_installer(
  uuid,uuid,uuid,uuid,timestamptz,uuid,text
) to service_role;

-- Revocation changes only the assignment's current access state; the original
-- assignment and all command events retain their original IDs and audit facts.
create or replace function public.platform_admin_revoke_setup_installer_assignment(
  p_actor_user_id uuid,p_assignment_id uuid,p_command_id uuid,p_reason text
) returns boolean language plpgsql security definer set search_path='' as $revoke$
declare
  v_assignment public.sellertray_internal_setup_staff_assignments%rowtype;
  v_existing_event public.sellertray_internal_setup_staff_events%rowtype;
begin
  if p_actor_user_id is null or p_assignment_id is null or p_command_id is null
     or char_length(btrim(coalesce(p_reason,''))) not between 6 and 1000 then
    raise exception 'Installer assignment, command and reason are required' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_command_id::text,0));
  select * into v_assignment
    from public.sellertray_internal_setup_staff_assignments
    where id=p_assignment_id for update;
  if not found then raise exception 'Installer assignment not found' using errcode='23514'; end if;
  if not exists(select 1 from public.platform_admins pa
      where pa.user_id=p_actor_user_id and pa.role='admin')
     or not public.platform_admin_has_capability(
       p_actor_user_id,'admin.branch_setup.manage',v_assignment.tenant_id,now()
     ) then raise exception 'Platform Admin Branch setup authority required' using errcode='42501';
  end if;
  select * into v_existing_event from public.sellertray_internal_setup_staff_events
    where command_id=p_command_id;
  if found then
    if v_existing_event.event_type<>'assignment_revoked'
       or v_existing_event.actor_user_id<>p_actor_user_id
       or v_existing_event.staff_user_id<>v_assignment.staff_user_id
       or v_existing_event.tenant_id is distinct from v_assignment.tenant_id
       or v_existing_event.appointment_id is distinct from v_assignment.appointment_id
       or v_existing_event.details->>'assignmentId'<>p_assignment_id::text
       or v_existing_event.reason<>btrim(p_reason) then
      raise exception 'Assignment revocation command already used for different facts' using errcode='23505';
    end if;
    return true;
  end if;
  if v_assignment.revoked_at is not null then
    raise exception 'Installer assignment already revoked; replay the original command' using errcode='23514';
  end if;
  update public.sellertray_internal_setup_staff_assignments
    set revoked_at=now(),revoked_by_user_id=p_actor_user_id,revocation_reason=btrim(p_reason)
    where id=p_assignment_id;
  insert into public.sellertray_internal_setup_staff_events(
    command_id,staff_user_id,actor_user_id,event_type,tenant_id,appointment_id,reason,details
  ) values (
    p_command_id,v_assignment.staff_user_id,p_actor_user_id,'assignment_revoked',
    v_assignment.tenant_id,v_assignment.appointment_id,btrim(p_reason),
    jsonb_build_object('assignmentId',p_assignment_id,'branchId',v_assignment.branch_id)
  );
  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values (p_actor_user_id,v_assignment.tenant_id,'setup_installer_assignment_revoked',
    jsonb_build_object('assignmentId',p_assignment_id,'staffUserId',v_assignment.staff_user_id,
      'branchId',v_assignment.branch_id,'commandId',p_command_id));
  return true;
end;
$revoke$;
revoke all on function public.platform_admin_revoke_setup_installer_assignment(
  uuid,uuid,uuid,text
) from public,anon,authenticated;
grant execute on function public.platform_admin_revoke_setup_installer_assignment(
  uuid,uuid,uuid,text
) to service_role;

-- Dedicated ProcessEdge Mobile installation inbox. This is not a Merchant
-- business list and cannot be used to infer an unrelated Business's identity.
-- The AAL2-validated Edge transport supplies the authenticated actor ID.
create or replace function public.get_sellertray_setup_installer_work(
  p_actor_user_id uuid
) returns jsonb language sql stable security invoker set search_path='' as $work$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'assignmentId',a.id,
      'appointmentId',ap.id,
      'tenantId',a.tenant_id,
      'businessName',t.name,
      'branchId',a.branch_id,
      'branchName',b.name,
      'workerId',a.worker_id,
      'scheduledStartAt',ap.scheduled_start_at,
      'scheduledEndAt',ap.scheduled_end_at,
      'appointmentStatus',ap.status,
      'validUntil',a.valid_until
    ) order by ap.scheduled_start_at,ap.id
  ),'[]'::jsonb)
  from public.sellertray_internal_setup_staff_assignments a
  join public.sellertray_commercial_setup_appointments ap
    on ap.id=a.appointment_id and ap.tenant_id=a.tenant_id
      and ap.branch_id=a.branch_id and ap.worker_id=a.worker_id
  join public.tenants t on t.id=a.tenant_id
  join public.branches b on b.id=a.branch_id and b.tenant_id=a.tenant_id
  where a.staff_user_id=p_actor_user_id
    and public.sellertray_setup_installer_has_assignment(
      p_actor_user_id,a.tenant_id,a.branch_id,a.appointment_id,now()
    );
$work$;
revoke all on function public.get_sellertray_setup_installer_work(uuid)
  from public,anon,authenticated;
grant execute on function public.get_sellertray_setup_installer_work(uuid)
  to service_role;

-- Platform Admin sees the bounded internal installer roster. Assignment data is
-- limited to a selected Business; the roster is never exposed to merchants.
create or replace function public.platform_admin_list_setup_installer_staff(
  p_actor_user_id uuid,p_tenant_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path='' as $list$
declare v_staff jsonb; v_assignments jsonb;
begin
  if not exists(select 1 from public.platform_admins pa where pa.user_id=p_actor_user_id and pa.role='admin')
    or not public.platform_admin_has_capability(
      p_actor_user_id,'admin.branch_setup.manage',null,now()
    ) then raise exception 'Platform Admin setup administration required' using errcode='42501'; end if;
  if p_tenant_id is not null and not public.platform_admin_has_capability(
    p_actor_user_id,'admin.branch_setup.manage',p_tenant_id,now()
  ) then raise exception 'Business setup administration capability required' using errcode='42501'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'userId',s.user_id,'email',u.email,'workerId',s.worker_id,
    'workerName',w.display_name,'role',s.staff_role,'status',s.status,
    'registeredAt',s.registered_at,'activatedAt',s.activated_at
  ) order by s.registered_at desc,s.user_id),'[]'::jsonb)
  into v_staff from (
    select * from public.sellertray_internal_setup_staff s order by registered_at desc,user_id limit 100
  ) s
  join auth.users u on u.id=s.user_id
  join public.sellertray_setup_workers w on w.id=s.worker_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'assignmentId',a.id,'userId',a.staff_user_id,'workerId',a.worker_id,
    'tenantId',a.tenant_id,'branchId',a.branch_id,'appointmentId',a.appointment_id,
    'validFrom',a.valid_from,'validUntil',a.valid_until,
    'revokedAt',a.revoked_at,'assignedAt',a.assigned_at
  ) order by a.assigned_at desc,a.id),'[]'::jsonb)
  into v_assignments from (
    select * from public.sellertray_internal_setup_staff_assignments a
    where p_tenant_id is not null and a.tenant_id=p_tenant_id
    order by a.assigned_at desc,a.id limit 100
  ) a;

  return jsonb_build_object('staff',v_staff,'assignments',v_assignments);
end;
$list$;
revoke all on function public.platform_admin_list_setup_installer_staff(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.platform_admin_list_setup_installer_staff(uuid,uuid)
  to service_role;

-- An authenticated, unprivileged staff user may discover only whether
-- their own ProcessEdge installer account exists. The Edge gateway binds the
-- actor to an already verified JWT, and no appointment or tenant information
-- is returned until AAL2 has been verified.
create or replace function public.get_sellertray_setup_installer_profile(
  p_actor_user_id uuid
) returns jsonb language sql stable security invoker set search_path='' as $profile$
  select jsonb_build_object(
    'isInstaller',exists(
      select 1 from public.sellertray_internal_setup_staff s
      where s.user_id=p_actor_user_id and s.staff_role='setup_installer'
    ),
    'status',(
      select s.status from public.sellertray_internal_setup_staff s
      where s.user_id=p_actor_user_id and s.staff_role='setup_installer'
    )
  );
$profile$;
revoke all on function public.get_sellertray_setup_installer_profile(uuid)
  from public,anon,authenticated;
grant execute on function public.get_sellertray_setup_installer_profile(uuid)
  to service_role;

commit;
