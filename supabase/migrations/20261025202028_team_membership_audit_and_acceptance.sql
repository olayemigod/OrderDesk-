-- SellerTray team membership governance repair.
--
-- Goals:
-- 1. Keep membership truth server-authoritative and append-only auditable.
-- 2. Never auto-join an existing SellerTray identity when an invitation is created.
-- 3. Require explicit acceptance/decline of one invitation by the invited identity.
-- 4. Preserve current team RPC signatures where possible while auditing mutations.
-- 5. Provide a platform-admin-only, idempotent ownership transfer/correction command.
-- 6. Backfill existing state as observed legacy facts without inventing historical actors.
--
-- Deliberately NOT included: a global unique-owner constraint. Live authority currently has
-- a separate legacy tenant with more than one owner. The governed transfer command below
-- guarantees exactly one owner for the tenant it repairs without silently rewriting unrelated
-- legacy data.

begin;

alter table public.tenant_invitations
  drop constraint if exists tenant_invitations_status_check;

alter table public.tenant_invitations
  add constraint tenant_invitations_status_check
  check (status = any (array['pending'::text, 'accepted'::text, 'declined'::text, 'cancelled'::text, 'expired'::text]));

create table if not exists public.sellertray_membership_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event_type text not null check (event_type = any (array[
    'legacy_membership_observed'::text,
    'legacy_invitation_observed'::text,
    'invitation_created'::text,
    'invitation_refreshed'::text,
    'invitation_accepted'::text,
    'invitation_declined'::text,
    'invitation_cancelled'::text,
    'invitation_expired'::text,
    'member_role_changed'::text,
    'member_removed'::text,
    'ownership_transferred'::text
  ])),
  subject_user_id uuid references auth.users(id) on delete set null,
  subject_email text,
  invitation_id uuid references public.tenant_invitations(id) on delete set null,
  previous_role text check (previous_role is null or previous_role = any (array['owner'::text, 'manager'::text, 'staff'::text])),
  new_role text check (new_role is null or new_role = any (array['owner'::text, 'manager'::text, 'staff'::text])),
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_kind text not null check (actor_kind = any (array['merchant_member'::text, 'invitee'::text, 'platform_admin'::text, 'system'::text, 'legacy_backfill'::text])),
  reason text,
  command_id uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists sellertray_membership_events_tenant_created_idx
  on public.sellertray_membership_events(tenant_id, created_at desc);

create index if not exists sellertray_membership_events_subject_idx
  on public.sellertray_membership_events(subject_user_id, created_at desc)
  where subject_user_id is not null;

create index if not exists sellertray_membership_events_invitation_idx
  on public.sellertray_membership_events(invitation_id, created_at desc)
  where invitation_id is not null;

create unique index if not exists sellertray_membership_events_command_uq
  on public.sellertray_membership_events(tenant_id, command_id, event_type)
  where command_id is not null;

alter table public.sellertray_membership_events enable row level security;

revoke all on table public.sellertray_membership_events from anon, authenticated;
grant select, insert on table public.sellertray_membership_events to service_role;

create or replace function public.prevent_sellertray_membership_event_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'SellerTray membership events are append-only' using errcode = '42501';
end;
$$;

revoke all on function public.prevent_sellertray_membership_event_mutation() from public, anon, authenticated;
grant execute on function public.prevent_sellertray_membership_event_mutation() to service_role;

drop trigger if exists sellertray_membership_events_append_only on public.sellertray_membership_events;
create trigger sellertray_membership_events_append_only
before update or delete on public.sellertray_membership_events
for each row execute function public.prevent_sellertray_membership_event_mutation();

-- Existing state is evidence of current state only. Do not manufacture an actor or causal history.
insert into public.sellertray_membership_events (
  tenant_id,
  event_type,
  subject_user_id,
  subject_email,
  new_role,
  actor_kind,
  detail,
  created_at
)
select
  tm.tenant_id,
  'legacy_membership_observed',
  tm.user_id,
  lower(u.email),
  tm.role,
  'legacy_backfill',
  jsonb_build_object(
    'source', 'tenant_members',
    'provenance', 'observed_current_state',
    'historicalActorKnown', false,
    'note', 'Membership existed before the append-only membership event ledger; no historical actor is inferred.'
  ),
  coalesce(tm.created_at, now())
from public.tenant_members tm
left join auth.users u on u.id = tm.user_id
where not exists (
  select 1
  from public.sellertray_membership_events e
  where e.tenant_id = tm.tenant_id
    and e.event_type = 'legacy_membership_observed'
    and e.subject_user_id = tm.user_id
);

insert into public.sellertray_membership_events (
  tenant_id,
  event_type,
  subject_user_id,
  subject_email,
  invitation_id,
  new_role,
  actor_kind,
  detail,
  created_at
)
select
  ti.tenant_id,
  'legacy_invitation_observed',
  ti.accepted_user_id,
  lower(ti.email),
  ti.id,
  ti.role,
  'legacy_backfill',
  jsonb_build_object(
    'source', 'tenant_invitations',
    'provenance', 'observed_current_state',
    'status', ti.status,
    'invitedByUserIdSnapshot', ti.invited_by_user_id,
    'historicalActorKnown', false,
    'note', 'Invitation existed before the append-only membership event ledger; invitation fields are snapshots, not reconstructed causal history.'
  ),
  coalesce(ti.created_at, now())
from public.tenant_invitations ti
where not exists (
  select 1
  from public.sellertray_membership_events e
  where e.event_type = 'legacy_invitation_observed'
    and e.invitation_id = ti.id
);

-- Invitation creation is always an invitation, even when the email already belongs to an auth user.
-- The existing JSON contract is preserved; outcome is now always `invited`.
create or replace function public.invite_orderdesk_team_member(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_email text,
  p_role text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text;
  normalized_email text := lower(trim(coalesce(p_email, '')));
  target_user_id uuid;
  invitation_id uuid;
  event_type text;
begin
  select tm.role into actor_role
  from public.tenant_members tm
  where tm.tenant_id = p_tenant_id and tm.user_id = p_actor_user_id;

  if actor_role not in ('owner', 'manager') then
    raise exception 'Only an Owner or Manager can invite team members' using errcode = '42501';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode = '42501';
  end if;
  if p_role not in ('manager', 'staff') then
    raise exception 'Team role must be Manager or Staff' using errcode = '22023';
  end if;
  if actor_role = 'manager' and p_role <> 'staff' then
    raise exception 'Managers can invite Staff only' using errcode = '42501';
  end if;
  if normalized_email = '' or position('@' in normalized_email) <= 1 then
    raise exception 'Enter a valid email address' using errcode = '22023';
  end if;

  select u.id into target_user_id
  from auth.users u
  where lower(u.email) = normalized_email
  limit 1;

  if target_user_id = p_actor_user_id then
    raise exception 'You are already a member of this business' using errcode = '23505';
  end if;

  if target_user_id is not null and exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = p_tenant_id and tm.user_id = target_user_id
  ) then
    raise exception 'This user is already a member of this business' using errcode = '23505';
  end if;

  select ti.id into invitation_id
  from public.tenant_invitations ti
  where ti.tenant_id = p_tenant_id
    and lower(ti.email) = normalized_email
    and ti.status = 'pending'
  order by ti.created_at desc
  limit 1
  for update;

  if invitation_id is null then
    insert into public.tenant_invitations (
      tenant_id,
      email,
      role,
      invited_by_user_id,
      expires_at
    ) values (
      p_tenant_id,
      normalized_email,
      p_role,
      p_actor_user_id,
      now() + interval '7 days'
    ) returning id into invitation_id;
    event_type := 'invitation_created';
  else
    update public.tenant_invitations
    set role = p_role,
        invited_by_user_id = p_actor_user_id,
        expires_at = now() + interval '7 days',
        updated_at = now()
    where id = invitation_id;
    event_type := 'invitation_refreshed';
  end if;

  insert into public.sellertray_membership_events (
    tenant_id,
    event_type,
    subject_user_id,
    subject_email,
    invitation_id,
    new_role,
    actor_user_id,
    actor_kind,
    detail
  ) values (
    p_tenant_id,
    event_type,
    target_user_id,
    normalized_email,
    invitation_id,
    p_role,
    p_actor_user_id,
    'merchant_member',
    jsonb_build_object('expiresInDays', 7)
  );

  return jsonb_build_object(
    'outcome', 'invited',
    'invitationId', invitation_id,
    'userId', target_user_id,
    'email', normalized_email,
    'role', p_role
  );
end;
$$;

revoke all on function public.invite_orderdesk_team_member(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.invite_orderdesk_team_member(uuid, uuid, text, text) to service_role;

-- Automatic/bulk claim is deliberately retired. Existing callers now fail closed instead of
-- silently attaching a user to every Business that invited the same email address.
create or replace function public.claim_orderdesk_team_invitations(
  p_user_id uuid,
  p_email text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Automatic invitation claiming is no longer supported; accept a specific invitation' using errcode = '0A000';
end;
$$;

revoke all on function public.claim_orderdesk_team_invitations(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_orderdesk_team_invitations(uuid, text) to service_role;

create or replace function public.list_orderdesk_pending_team_invitations(
  p_user_id uuid
)
returns table (
  invitation_id uuid,
  tenant_id uuid,
  tenant_name text,
  tenant_slug text,
  email text,
  role text,
  invited_by_user_id uuid,
  invited_by_email text,
  expires_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text;
  expired_invite record;
begin
  select lower(u.email) into normalized_email
  from auth.users u
  where u.id = p_user_id;

  if normalized_email is null then
    raise exception 'Authenticated user not found' using errcode = '42501';
  end if;

  for expired_invite in
    select ti.id, ti.tenant_id, ti.email, ti.role
    from public.tenant_invitations ti
    where lower(ti.email) = normalized_email
      and ti.status = 'pending'
      and ti.expires_at <= now()
    for update
  loop
    update public.tenant_invitations
    set status = 'expired', updated_at = now()
    where id = expired_invite.id and status = 'pending';

    if found then
      insert into public.sellertray_membership_events (
        tenant_id, event_type, subject_user_id, subject_email, invitation_id,
        new_role, actor_kind, detail
      ) values (
        expired_invite.tenant_id, 'invitation_expired', p_user_id,
        lower(expired_invite.email), expired_invite.id, expired_invite.role,
        'system', jsonb_build_object('reason', 'invitation_expired_before_listing')
      );
    end if;
  end loop;

  return query
  select
    ti.id,
    ti.tenant_id,
    t.name,
    t.slug,
    lower(ti.email),
    ti.role,
    ti.invited_by_user_id,
    lower(inviter.email),
    ti.expires_at,
    ti.created_at
  from public.tenant_invitations ti
  join public.tenants t on t.id = ti.tenant_id
  left join auth.users inviter on inviter.id = ti.invited_by_user_id
  where lower(ti.email) = normalized_email
    and ti.status = 'pending'
    and ti.expires_at > now()
  order by ti.created_at asc;
end;
$$;

revoke all on function public.list_orderdesk_pending_team_invitations(uuid) from public, anon, authenticated;
grant execute on function public.list_orderdesk_pending_team_invitations(uuid) to service_role;

create or replace function public.accept_orderdesk_team_invitation(
  p_invitation_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text;
  invitation record;
  existing_role text;
begin
  select lower(u.email) into normalized_email
  from auth.users u
  where u.id = p_user_id;

  if normalized_email is null then
    raise exception 'Authenticated user not found' using errcode = '42501';
  end if;

  select ti.* into invitation
  from public.tenant_invitations ti
  where ti.id = p_invitation_id
  for update;

  if invitation.id is null then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;
  if lower(invitation.email) <> normalized_email then
    raise exception 'This invitation belongs to another identity' using errcode = '42501';
  end if;

  if invitation.status = 'accepted' and invitation.accepted_user_id = p_user_id then
    select tm.role into existing_role
    from public.tenant_members tm
    where tm.tenant_id = invitation.tenant_id and tm.user_id = p_user_id;

    return jsonb_build_object(
      'outcome', 'accepted',
      'invitationId', invitation.id,
      'tenantId', invitation.tenant_id,
      'role', coalesce(existing_role, invitation.role),
      'idempotent', true
    );
  end if;

  if invitation.status <> 'pending' then
    raise exception 'Invitation is no longer pending' using errcode = '22023';
  end if;

  if invitation.expires_at <= now() then
    update public.tenant_invitations
    set status = 'expired', updated_at = now()
    where id = invitation.id;

    insert into public.sellertray_membership_events (
      tenant_id, event_type, subject_user_id, subject_email, invitation_id,
      new_role, actor_kind, detail
    ) values (
      invitation.tenant_id, 'invitation_expired', p_user_id, normalized_email,
      invitation.id, invitation.role, 'system',
      jsonb_build_object('reason', 'accept_attempt_after_expiry')
    );

    raise exception 'Invitation has expired' using errcode = '22023';
  end if;

  insert into public.tenant_members (tenant_id, user_id, role)
  values (invitation.tenant_id, p_user_id, invitation.role)
  on conflict (tenant_id, user_id) do nothing;

  select tm.role into existing_role
  from public.tenant_members tm
  where tm.tenant_id = invitation.tenant_id and tm.user_id = p_user_id;

  if existing_role is distinct from invitation.role then
    raise exception 'Existing membership role conflicts with this invitation' using errcode = '23505';
  end if;

  update public.tenant_invitations
  set status = 'accepted',
      accepted_user_id = p_user_id,
      updated_at = now()
  where id = invitation.id;

  insert into public.sellertray_membership_events (
    tenant_id,
    event_type,
    subject_user_id,
    subject_email,
    invitation_id,
    new_role,
    actor_user_id,
    actor_kind,
    detail
  ) values (
    invitation.tenant_id,
    'invitation_accepted',
    p_user_id,
    normalized_email,
    invitation.id,
    invitation.role,
    p_user_id,
    'invitee',
    jsonb_build_object('explicitAcceptance', true)
  );

  return jsonb_build_object(
    'outcome', 'accepted',
    'invitationId', invitation.id,
    'tenantId', invitation.tenant_id,
    'role', invitation.role,
    'idempotent', false
  );
end;
$$;

revoke all on function public.accept_orderdesk_team_invitation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.accept_orderdesk_team_invitation(uuid, uuid) to service_role;

create or replace function public.decline_orderdesk_team_invitation(
  p_invitation_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text;
  invitation record;
begin
  select lower(u.email) into normalized_email
  from auth.users u
  where u.id = p_user_id;

  if normalized_email is null then
    raise exception 'Authenticated user not found' using errcode = '42501';
  end if;

  select ti.* into invitation
  from public.tenant_invitations ti
  where ti.id = p_invitation_id
  for update;

  if invitation.id is null then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;
  if lower(invitation.email) <> normalized_email then
    raise exception 'This invitation belongs to another identity' using errcode = '42501';
  end if;
  if invitation.status = 'declined' then
    return jsonb_build_object('outcome', 'declined', 'invitationId', invitation.id, 'idempotent', true);
  end if;
  if invitation.status <> 'pending' then
    raise exception 'Invitation is no longer pending' using errcode = '22023';
  end if;

  update public.tenant_invitations
  set status = 'declined', updated_at = now()
  where id = invitation.id;

  insert into public.sellertray_membership_events (
    tenant_id,
    event_type,
    subject_user_id,
    subject_email,
    invitation_id,
    new_role,
    actor_user_id,
    actor_kind,
    detail
  ) values (
    invitation.tenant_id,
    'invitation_declined',
    p_user_id,
    normalized_email,
    invitation.id,
    invitation.role,
    p_user_id,
    'invitee',
    jsonb_build_object('explicitDecline', true)
  );

  return jsonb_build_object('outcome', 'declined', 'invitationId', invitation.id, 'idempotent', false);
end;
$$;

revoke all on function public.decline_orderdesk_team_invitation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.decline_orderdesk_team_invitation(uuid, uuid) to service_role;

create or replace function public.change_orderdesk_team_member(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_action text,
  p_role text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text;
  target_role text;
  target_email text;
begin
  select tm.role into actor_role
  from public.tenant_members tm
  where tm.tenant_id = p_tenant_id and tm.user_id = p_actor_user_id;

  if actor_role not in ('owner', 'manager') then
    raise exception 'Only an Owner or Manager can manage team members' using errcode = '42501';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode = '42501';
  end if;

  select tm.role, lower(u.email) into target_role, target_email
  from public.tenant_members tm
  left join auth.users u on u.id = tm.user_id
  where tm.tenant_id = p_tenant_id and tm.user_id = p_target_user_id
  for update of tm;

  if target_role is null then
    raise exception 'Team member not found' using errcode = 'P0002';
  end if;
  if p_target_user_id = p_actor_user_id then
    raise exception 'You cannot change your own membership from this screen' using errcode = '42501';
  end if;
  if target_role = 'owner' then
    raise exception 'Owner membership is protected; use the governed ownership transfer authority' using errcode = '42501';
  end if;
  if actor_role = 'manager' and target_role <> 'staff' then
    raise exception 'Managers can manage Staff only' using errcode = '42501';
  end if;

  if p_action = 'remove' then
    update public.tenant_member_capabilities c
    set allowed = false, granted_by = p_actor_user_id, updated_at = now()
    where c.tenant_id = p_tenant_id
      and c.user_id = p_target_user_id
      and c.capability = 'can_accept_commercial_agreements'
      and c.allowed = true;

    if found then
      insert into public.tenant_member_capability_events (
        tenant_id, user_id, capability, previous_allowed, new_allowed, actor_user_id
      ) values (
        p_tenant_id, p_target_user_id, 'can_accept_commercial_agreements', true, false, p_actor_user_id
      );
    end if;

    delete from public.tenant_members
    where tenant_id = p_tenant_id and user_id = p_target_user_id;

    insert into public.sellertray_membership_events (
      tenant_id, event_type, subject_user_id, subject_email, previous_role,
      actor_user_id, actor_kind, detail
    ) values (
      p_tenant_id, 'member_removed', p_target_user_id, target_email, target_role,
      p_actor_user_id, 'merchant_member', jsonb_build_object('action', 'remove')
    );
    return;
  end if;

  if p_action = 'set_role' then
    if actor_role <> 'owner' then
      raise exception 'Only an Owner can change team roles' using errcode = '42501';
    end if;
    if p_role not in ('manager', 'staff') then
      raise exception 'Team role must be Manager or Staff' using errcode = '22023';
    end if;

    if p_role = 'staff' then
      update public.tenant_member_capabilities c
      set allowed = false, granted_by = p_actor_user_id, updated_at = now()
      where c.tenant_id = p_tenant_id
        and c.user_id = p_target_user_id
        and c.capability = 'can_accept_commercial_agreements'
        and c.allowed = true;

      if found then
        insert into public.tenant_member_capability_events (
          tenant_id, user_id, capability, previous_allowed, new_allowed, actor_user_id
        ) values (
          p_tenant_id, p_target_user_id, 'can_accept_commercial_agreements', true, false, p_actor_user_id
        );
      end if;
    end if;

    if target_role is distinct from p_role then
      update public.tenant_members
      set role = p_role
      where tenant_id = p_tenant_id and user_id = p_target_user_id;

      insert into public.sellertray_membership_events (
        tenant_id, event_type, subject_user_id, subject_email, previous_role, new_role,
        actor_user_id, actor_kind, detail
      ) values (
        p_tenant_id, 'member_role_changed', p_target_user_id, target_email, target_role, p_role,
        p_actor_user_id, 'merchant_member', jsonb_build_object('action', 'set_role')
      );
    end if;
    return;
  end if;

  raise exception 'Unsupported team action' using errcode = '22023';
end;
$$;

revoke all on function public.change_orderdesk_team_member(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.change_orderdesk_team_member(uuid, uuid, uuid, text, text) to service_role;

create or replace function public.cancel_orderdesk_team_invitation(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_invitation_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text;
  invitation record;
begin
  select tm.role into actor_role
  from public.tenant_members tm
  where tm.tenant_id = p_tenant_id and tm.user_id = p_actor_user_id;

  if actor_role not in ('owner', 'manager') then
    raise exception 'Only an Owner or Manager can cancel invitations' using errcode = '42501';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode = '42501';
  end if;

  select ti.* into invitation
  from public.tenant_invitations ti
  where ti.id = p_invitation_id
    and ti.tenant_id = p_tenant_id
    and ti.status = 'pending'
  for update;

  if invitation.id is null then
    raise exception 'Pending invitation not found' using errcode = 'P0002';
  end if;
  if actor_role = 'manager' and invitation.role <> 'staff' then
    raise exception 'Managers can manage Staff invitations only' using errcode = '42501';
  end if;

  update public.tenant_invitations
  set status = 'cancelled', updated_at = now()
  where id = p_invitation_id and tenant_id = p_tenant_id;

  insert into public.sellertray_membership_events (
    tenant_id, event_type, subject_email, invitation_id, new_role,
    actor_user_id, actor_kind, detail
  ) values (
    p_tenant_id, 'invitation_cancelled', lower(invitation.email), invitation.id, invitation.role,
    p_actor_user_id, 'merchant_member', jsonb_build_object('action', 'cancel_invite')
  );
end;
$$;

revoke all on function public.cancel_orderdesk_team_invitation(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.cancel_orderdesk_team_invitation(uuid, uuid, uuid) to service_role;

create or replace function public.list_orderdesk_team_membership_history(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_limit integer default 100
)
returns table (
  event_id uuid,
  event_type text,
  subject_user_id uuid,
  subject_email text,
  invitation_id uuid,
  previous_role text,
  new_role text,
  actor_user_id uuid,
  actor_email text,
  actor_kind text,
  reason text,
  detail jsonb,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text;
  safe_limit integer := least(greatest(coalesce(p_limit, 100), 1), 250);
begin
  select tm.role into actor_role
  from public.tenant_members tm
  where tm.tenant_id = p_tenant_id and tm.user_id = p_actor_user_id;

  if actor_role not in ('owner', 'manager') then
    raise exception 'Only an Owner or Manager can view team membership history' using errcode = '42501';
  end if;

  return query
  select
    e.id,
    e.event_type,
    e.subject_user_id,
    e.subject_email,
    e.invitation_id,
    e.previous_role,
    e.new_role,
    e.actor_user_id,
    lower(actor.email),
    e.actor_kind,
    e.reason,
    e.detail,
    e.created_at
  from public.sellertray_membership_events e
  left join auth.users actor on actor.id = e.actor_user_id
  where e.tenant_id = p_tenant_id
  order by e.created_at desc, e.id desc
  limit safe_limit;
end;
$$;

revoke all on function public.list_orderdesk_team_membership_history(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.list_orderdesk_team_membership_history(uuid, uuid, integer) to service_role;

-- Platform-admin ownership transfer/correction.
-- This command is idempotent by command_id and guarantees exactly one owner for the target tenant.
create or replace function public.platform_admin_transfer_tenant_ownership(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_target_email text,
  p_reason text,
  p_command_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_target_email text := lower(trim(coalesce(p_target_email, '')));
  target_user_id uuid;
  target_previous_role text;
  actor_admin_role text;
  owner_count integer;
  previous_owners jsonb;
  existing_event record;
  result jsonb;
begin
  if p_command_id is null then
    raise exception 'command_id is required' using errcode = '22023';
  end if;
  if trim(coalesce(p_reason, '')) = '' then
    raise exception 'A reason is required for ownership transfer' using errcode = '22023';
  end if;

  select pa.role into actor_admin_role
  from public.platform_admins pa
  where pa.user_id = p_actor_user_id;

  if actor_admin_role <> 'admin' then
    raise exception 'Platform Admin authority is required' using errcode = '42501';
  end if;

  perform 1 from public.tenants t where t.id = p_tenant_id for update;
  if not found then
    raise exception 'Business not found' using errcode = 'P0002';
  end if;

  select e.* into existing_event
  from public.sellertray_membership_events e
  where e.tenant_id = p_tenant_id
    and e.command_id = p_command_id
    and e.event_type = 'ownership_transferred'
  limit 1;

  if existing_event.id is not null then
    return existing_event.detail || jsonb_build_object(
      'eventId', existing_event.id,
      'commandId', p_command_id,
      'idempotent', true
    );
  end if;

  if normalized_target_email = '' or position('@' in normalized_target_email) <= 1 then
    raise exception 'A valid target email is required' using errcode = '22023';
  end if;

  select u.id into target_user_id
  from auth.users u
  where lower(u.email) = normalized_target_email
  limit 1;

  if target_user_id is null then
    raise exception 'Target SellerTray identity not found' using errcode = 'P0002';
  end if;

  select tm.role into target_previous_role
  from public.tenant_members tm
  where tm.tenant_id = p_tenant_id and tm.user_id = target_user_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'userId', tm.user_id,
    'email', lower(u.email),
    'role', tm.role
  ) order by lower(u.email)), '[]'::jsonb)
  into previous_owners
  from public.tenant_members tm
  left join auth.users u on u.id = tm.user_id
  where tm.tenant_id = p_tenant_id and tm.role = 'owner';

  update public.tenant_members
  set role = 'manager'
  where tenant_id = p_tenant_id
    and role = 'owner'
    and user_id <> target_user_id;

  insert into public.tenant_members (tenant_id, user_id, role)
  values (p_tenant_id, target_user_id, 'owner')
  on conflict (tenant_id, user_id)
  do update set role = excluded.role;

  select count(*) into owner_count
  from public.tenant_members tm
  where tm.tenant_id = p_tenant_id and tm.role = 'owner';

  if owner_count <> 1 then
    raise exception 'Ownership transfer did not converge to exactly one Owner' using errcode = '23514';
  end if;

  result := jsonb_build_object(
    'tenantId', p_tenant_id,
    'targetUserId', target_user_id,
    'targetEmail', normalized_target_email,
    'targetPreviousRole', target_previous_role,
    'previousOwners', previous_owners,
    'newOwnerCount', owner_count,
    'reason', trim(p_reason)
  );

  insert into public.sellertray_membership_events (
    tenant_id,
    event_type,
    subject_user_id,
    subject_email,
    previous_role,
    new_role,
    actor_user_id,
    actor_kind,
    reason,
    command_id,
    detail
  ) values (
    p_tenant_id,
    'ownership_transferred',
    target_user_id,
    normalized_target_email,
    target_previous_role,
    'owner',
    p_actor_user_id,
    'platform_admin',
    trim(p_reason),
    p_command_id,
    result
  );

  insert into public.platform_admin_audit (
    actor_user_id,
    tenant_id,
    action,
    detail
  ) values (
    p_actor_user_id,
    p_tenant_id,
    'team.ownership_transfer',
    result || jsonb_build_object('commandId', p_command_id)
  );

  return result || jsonb_build_object('commandId', p_command_id, 'idempotent', false);
end;
$$;

revoke all on function public.platform_admin_transfer_tenant_ownership(uuid, uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.platform_admin_transfer_tenant_ownership(uuid, uuid, text, text, uuid) to service_role;

commit;
