-- OA5 forward-only correction. An invitation is an internal identity claim
-- even when external email delivery succeeds but account linkage fails.
-- Prevent alternate merchant/Platform Admin entry points from elevating it.
begin;

create table public.sellertray_internal_setup_invitation_reservations (
  command_id uuid primary key,
  email_normalized text not null unique
    check (email_normalized = lower(btrim(email_normalized))
      and char_length(email_normalized) between 5 and 254
      and position('@' in email_normalized) > 1),
  worker_id uuid not null references public.sellertray_setup_workers(id) on delete restrict,
  requested_by_user_id uuid not null references auth.users(id) on delete restrict,
  reason text not null check (char_length(btrim(reason)) between 6 and 1000),
  created_at timestamptz not null default now(),
  delivery_started_at timestamptz,
  auth_user_id uuid unique references auth.users(id) on delete restrict,
  linked_at timestamptz
);
create index sellertray_internal_setup_reservations_worker
  on public.sellertray_internal_setup_invitation_reservations(worker_id,created_at desc);
alter table public.sellertray_internal_setup_invitation_reservations enable row level security;
revoke all on public.sellertray_internal_setup_invitation_reservations from public,anon,authenticated;
grant select,insert,update on public.sellertray_internal_setup_invitation_reservations to service_role;

create or replace function public.sellertray_user_is_reserved_setup_installer(p_user_id uuid)
returns boolean language sql stable security definer set search_path='' as $reserved$
  select p_user_id is not null and (
    exists (select 1 from public.sellertray_internal_setup_staff s where s.user_id=p_user_id)
    or exists (
      select 1 from public.sellertray_internal_setup_invitation_reservations r
      join auth.users u on (u.id=r.auth_user_id
        or lower(btrim(u.email))=r.email_normalized)
      where u.id=p_user_id
    )
  );
$reserved$;
revoke all on function public.sellertray_user_is_reserved_setup_installer(uuid)
  from public,anon,authenticated;
grant execute on function public.sellertray_user_is_reserved_setup_installer(uuid) to service_role;

-- Table-level exclusion covers initial provisioning, accepted invitations,
-- later manual Team membership and future writers, not only the Mobile gate.
create or replace function public.sellertray_reject_setup_installer_membership()
returns trigger language plpgsql security definer set search_path='' as $guard$
declare v_email text;
begin
  -- Serialize membership grants against reservation creation on this email.
  -- Otherwise concurrent invite and merchant signup transactions could each
  -- observe the other's uncommitted state and both succeed.
  select lower(btrim(u.email)) into v_email from auth.users u where u.id=new.user_id;
  if v_email is not null then
    perform pg_advisory_xact_lock(hashtextextended('setup-invite:'||v_email,0));
  end if;
  if public.sellertray_user_is_reserved_setup_installer(new.user_id) then
    raise exception 'ProcessEdge installation accounts cannot join Merchant Team or Platform Admin'
      using errcode='42501';
  end if;
  return new;
end;
$guard$;
revoke all on function public.sellertray_reject_setup_installer_membership()
  from public,anon,authenticated;
create trigger sellertray_setup_installer_merchant_membership_exclusion
  before insert or update of user_id on public.tenant_members
  for each row execute function public.sellertray_reject_setup_installer_membership();
create trigger sellertray_setup_installer_platform_admin_exclusion
  before insert or update of user_id on public.platform_admins
  for each row execute function public.sellertray_reject_setup_installer_membership();

create or replace function public.platform_admin_reserve_setup_installer_invitation(
  p_actor_user_id uuid,p_email text,p_worker_id uuid,p_command_id uuid,p_reason text
) returns uuid language plpgsql security definer set search_path='' as $reserve$
declare v_email text := lower(btrim(coalesce(p_email,'')));
        v_previous public.sellertray_internal_setup_invitation_reservations%rowtype;
begin
  if p_actor_user_id is null or p_command_id is null or p_worker_id is null
    or char_length(v_email) not between 5 and 254 or position('@' in v_email)<=1
    or char_length(btrim(coalesce(p_reason,''))) not between 6 and 1000 then
    raise exception 'Installer invitation email, worker, command and reason are required' using errcode='22023';
  end if;
  if not exists(select 1 from public.platform_admins pa
    where pa.user_id=p_actor_user_id and pa.role='admin')
    or not public.platform_admin_has_capability(
      p_actor_user_id,'admin.branch_setup.manage',null,now()) then
    raise exception 'Platform Admin setup authority is required' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('setup-invite:'||v_email,0));
  select * into v_previous from public.sellertray_internal_setup_invitation_reservations
    where command_id=p_command_id;
  if found then
    if v_previous.email_normalized<>v_email
      or v_previous.worker_id<>p_worker_id
      or v_previous.requested_by_user_id<>p_actor_user_id
      or v_previous.reason<>btrim(p_reason) then
      raise exception 'Installer invitation command already used with different facts' using errcode='23505';
    end if;
    return p_command_id;
  end if;
  if not exists(select 1 from public.sellertray_setup_workers w
       where w.id=p_worker_id and w.active) then
    raise exception 'Active ProcessEdge setup worker required before invitation' using errcode='23514';
  end if;
  if exists(select 1 from auth.users u
      where lower(btrim(u.email))=v_email
      and (exists(select 1 from public.tenant_members tm where tm.user_id=u.id)
        or exists(select 1 from public.platform_admins pa where pa.user_id=u.id))) then
    raise exception 'A dedicated ProcessEdge installer email is required' using errcode='42501';
  end if;
  if exists(select 1 from public.sellertray_internal_setup_invitation_reservations r
      where r.email_normalized=v_email) then
    raise exception 'An installer invitation already exists; reconcile it without resending'
      using errcode='23505';
  end if;
  insert into public.sellertray_internal_setup_invitation_reservations(
    command_id,email_normalized,worker_id,requested_by_user_id,reason)
    values (p_command_id,v_email,p_worker_id,p_actor_user_id,btrim(p_reason));
  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
    values(p_actor_user_id,null,'setup_installer_invitation_reserved',
      jsonb_build_object('commandId',p_command_id,'workerId',p_worker_id,
        'email',v_email));
  return p_command_id;
end;
$reserve$;
revoke all on function public.platform_admin_reserve_setup_installer_invitation(
  uuid,text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.platform_admin_reserve_setup_installer_invitation(
  uuid,text,uuid,uuid,text) to service_role;

-- Delivery is an external side effect. Atomically mark its *attempt* before
-- calling Auth, so retrying a timed-out request cannot send a second email.
create or replace function public.platform_admin_begin_setup_installer_delivery(
  p_actor_user_id uuid,p_command_id uuid
) returns boolean language plpgsql security definer set search_path='' as $begin_delivery$
declare v_row public.sellertray_internal_setup_invitation_reservations%rowtype;
begin
  select * into v_row from public.sellertray_internal_setup_invitation_reservations
    where command_id=p_command_id for update;
  if not found or v_row.requested_by_user_id<>p_actor_user_id
    or not exists(select 1 from public.platform_admins pa
      where pa.user_id=p_actor_user_id and pa.role='admin')
    or not public.platform_admin_has_capability(
      p_actor_user_id,'admin.branch_setup.manage',null,now()) then
    raise exception 'ProcessEdge installer invitation authority required' using errcode='42501';
  end if;
  if v_row.delivery_started_at is not null then return false; end if;
  update public.sellertray_internal_setup_invitation_reservations
    set delivery_started_at=now() where command_id=p_command_id;
  return true;
end;
$begin_delivery$;
revoke all on function public.platform_admin_begin_setup_installer_delivery(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.platform_admin_begin_setup_installer_delivery(uuid,uuid)
  to service_role;

-- Bind the actual Auth identity immediately after an invitation response,
-- before attempting the (possibly failing) worker/account relationship.
create or replace function public.platform_admin_bind_setup_installer_invitation(
  p_actor_user_id uuid,p_command_id uuid,p_auth_user_id uuid
) returns boolean language plpgsql security definer set search_path='' as $bind$
declare v_row public.sellertray_internal_setup_invitation_reservations%rowtype;
begin
  select * into v_row from public.sellertray_internal_setup_invitation_reservations
    where command_id=p_command_id for update;
  if not found or v_row.requested_by_user_id<>p_actor_user_id
    or not exists(select 1 from public.platform_admins pa
      where pa.user_id=p_actor_user_id and pa.role='admin')
    or not public.platform_admin_has_capability(
      p_actor_user_id,'admin.branch_setup.manage',null,now()) then
    raise exception 'ProcessEdge installer invitation authority required' using errcode='42501';
  end if;
  if v_row.delivery_started_at is null or p_auth_user_id is null
    or not exists(select 1 from auth.users u where u.id=p_auth_user_id
      and lower(btrim(u.email))=v_row.email_normalized) then
    raise exception 'Invitation requires a matching verified Auth identity' using errcode='23514';
  end if;
  if v_row.auth_user_id is not null and v_row.auth_user_id<>p_auth_user_id then
    raise exception 'Installer reservation already bound to another identity' using errcode='23505';
  end if;
  update public.sellertray_internal_setup_invitation_reservations
     set auth_user_id=p_auth_user_id where command_id=p_command_id;
  return true;
end;
$bind$;
revoke all on function public.platform_admin_bind_setup_installer_invitation(uuid,uuid,uuid)
 from public,anon,authenticated;
grant execute on function public.platform_admin_bind_setup_installer_invitation(uuid,uuid,uuid)
 to service_role;

-- A reserved-but-unlinked invite is still an internal identity. It must not
-- fall through Mobile onboarding to Create Business on first login.
create or replace function public.get_sellertray_setup_installer_profile(
  p_actor_user_id uuid
) returns jsonb language sql stable security invoker set search_path='' as $profile$
  select jsonb_build_object(
    'isInstaller',public.sellertray_user_is_reserved_setup_installer(p_actor_user_id),
    'status',coalesce(
      (select s.status from public.sellertray_internal_setup_staff s
        where s.user_id=p_actor_user_id and s.staff_role='setup_installer'),
      case when exists(select 1 from public.sellertray_internal_setup_invitation_reservations r
        join auth.users u on (u.id=r.auth_user_id
          or lower(btrim(u.email))=r.email_normalized)
        where u.id=p_actor_user_id) then 'pending'::text end
    )
  );
$profile$;
revoke all on function public.get_sellertray_setup_installer_profile(uuid)
  from public,anon,authenticated;
grant execute on function public.get_sellertray_setup_installer_profile(uuid)
  to service_role;

-- Authorized Admins can inspect unresolved delivery attempts without
-- exposing internal staff or invitation identities to merchant clients.
create or replace function public.platform_admin_list_setup_installer_reservations(
  p_actor_user_id uuid
) returns jsonb language plpgsql stable security definer set search_path='' as $list$
begin
  if not exists(select 1 from public.platform_admins pa
      where pa.user_id=p_actor_user_id and pa.role='admin')
    or not public.platform_admin_has_capability(
      p_actor_user_id,'admin.branch_setup.manage',null,now()) then
    raise exception 'Platform Admin setup authority required' using errcode='42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'commandId',r.command_id,
    'email',r.email_normalized,
    'workerId',r.worker_id,
    'deliveryStartedAt',r.delivery_started_at,
    'authUserId',r.auth_user_id,
    'linkedAt',r.linked_at,
    'createdAt',r.created_at
  ) order by r.created_at desc,r.command_id)
  from (select * from public.sellertray_internal_setup_invitation_reservations
    order by created_at desc,command_id limit 100) r),'[]'::jsonb);
end;
$list$;
revoke all on function public.platform_admin_list_setup_installer_reservations(uuid)
  from public,anon,authenticated;
grant execute on function public.platform_admin_list_setup_installer_reservations(uuid)
  to service_role;

-- Explicit reconciliation never resends mail. It uses only the Auth account
-- matching the original reserved address and the original designated worker.
create or replace function public.platform_admin_reconcile_setup_installer_invitation(
  p_actor_user_id uuid,p_reservation_command_id uuid,
  p_command_id uuid,p_reason text
) returns uuid language plpgsql security definer set search_path='' as $reconcile$
declare v_reservation public.sellertray_internal_setup_invitation_reservations%rowtype;
        v_user_id uuid;
        v_staff public.sellertray_internal_setup_staff%rowtype;
begin
  if p_command_id is null or p_reservation_command_id is null
    or char_length(btrim(coalesce(p_reason,''))) not between 6 and 1000 then
    raise exception 'Reconciliation command, invitation and reason are required' using errcode='22023';
  end if;
  if not exists(select 1 from public.platform_admins pa
      where pa.user_id=p_actor_user_id and pa.role='admin')
    or not public.platform_admin_has_capability(
      p_actor_user_id,'admin.branch_setup.manage',null,now()) then
    raise exception 'Platform Admin setup authority required' using errcode='42501';
  end if;
  select * into v_reservation
    from public.sellertray_internal_setup_invitation_reservations
    where command_id=p_reservation_command_id for update;
  if not found then raise exception 'Installer invitation not found' using errcode='23514'; end if;
  if v_reservation.delivery_started_at is null then
    raise exception 'Installer invitation has not been attempted' using errcode='23514';
  end if;
  select u.id into v_user_id from auth.users u
    where lower(btrim(u.email))=v_reservation.email_normalized
    order by u.created_at asc limit 1;
  if v_user_id is null
    or (v_reservation.auth_user_id is not null
      and v_reservation.auth_user_id<>v_user_id) then
    raise exception 'Reserved invitation has no matching Auth account to reconcile'
      using errcode='23514';
  end if;
  select * into v_staff from public.sellertray_internal_setup_staff
    where user_id=v_user_id;
  if found then
    if v_staff.worker_id<>v_reservation.worker_id then
      raise exception 'Reserved installer is linked to a different worker'
        using errcode='23514';
    end if;
  else
    perform public.platform_admin_link_setup_installer(
      p_actor_user_id,v_user_id,v_reservation.worker_id,p_command_id,p_reason
    );
  end if;
  update public.sellertray_internal_setup_invitation_reservations
    set auth_user_id=v_user_id,linked_at=coalesce(linked_at,now())
    where command_id=p_reservation_command_id;
  return v_user_id;
end;
$reconcile$;
revoke all on function public.platform_admin_reconcile_setup_installer_invitation(
 uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.platform_admin_reconcile_setup_installer_invitation(
 uuid,uuid,uuid,text) to service_role;

commit;