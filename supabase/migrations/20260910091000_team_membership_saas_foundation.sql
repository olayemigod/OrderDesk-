create table if not exists public.tenant_invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  email text not null check (char_length(trim(email)) between 3 and 320),
  role text not null check (role in ('manager', 'staff')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'cancelled', 'expired')),
  invited_by_user_id uuid not null references auth.users(id) on delete restrict,
  accepted_user_id uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists tenant_invitations_pending_email_uidx
  on public.tenant_invitations (tenant_id, lower(email))
  where status = 'pending';
create index if not exists tenant_invitations_email_status_idx
  on public.tenant_invitations (lower(email), status, expires_at);
create index if not exists tenant_invitations_invited_by_idx
  on public.tenant_invitations (invited_by_user_id);
create index if not exists tenant_invitations_accepted_user_idx
  on public.tenant_invitations (accepted_user_id)
  where accepted_user_id is not null;

alter table public.tenant_invitations enable row level security;
revoke all on table public.tenant_invitations from anon, authenticated;

create or replace function public.list_orderdesk_team(p_tenant_id uuid, p_actor_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text;
  members_json jsonb;
  invitations_json jsonb := '[]'::jsonb;
begin
  select tm.role into actor_role
  from public.tenant_members tm
  where tm.tenant_id = p_tenant_id and tm.user_id = p_actor_user_id;

  if actor_role is null then
    raise exception 'You are not a member of this OrderDesk business' using errcode = '42501';
  end if;

  update public.tenant_invitations ti
  set status = 'expired', updated_at = now()
  where ti.tenant_id = p_tenant_id and ti.status = 'pending' and ti.expires_at <= now();

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'userId', x.user_id,
      'email', x.email,
      'role', x.role,
      'joinedAt', x.created_at
    ) order by case x.role when 'owner' then 1 when 'manager' then 2 else 3 end, x.created_at
  ), '[]'::jsonb)
  into members_json
  from (
    select tm.user_id, coalesce(u.email, '') as email, tm.role, tm.created_at
    from public.tenant_members tm
    left join auth.users u on u.id = tm.user_id
    where tm.tenant_id = p_tenant_id
  ) x;

  if actor_role in ('owner', 'manager') then
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', x.id,
        'email', x.email,
        'role', x.role,
        'status', x.status,
        'expiresAt', x.expires_at,
        'createdAt', x.created_at
      ) order by x.created_at desc
    ), '[]'::jsonb)
    into invitations_json
    from (
      select ti.id, ti.email, ti.role, ti.status, ti.expires_at, ti.created_at
      from public.tenant_invitations ti
      where ti.tenant_id = p_tenant_id and ti.status = 'pending'
    ) x;
  end if;

  return jsonb_build_object('actorRole', actor_role, 'members', members_json, 'invitations', invitations_json);
end;
$$;

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
begin
  select tm.role into actor_role
  from public.tenant_members tm
  where tm.tenant_id = p_tenant_id and tm.user_id = p_actor_user_id;

  if actor_role not in ('owner', 'manager') then
    raise exception 'Only an Owner or Manager can invite team members' using errcode = '42501';
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

  if target_user_id is not null then
    if target_user_id = p_actor_user_id then
      raise exception 'You are already a member of this business' using errcode = '23505';
    end if;
    if exists (
      select 1 from public.tenant_members tm
      where tm.tenant_id = p_tenant_id and tm.user_id = target_user_id
    ) then
      raise exception 'This user is already a member of this business' using errcode = '23505';
    end if;

    insert into public.tenant_members (tenant_id, user_id, role)
    values (p_tenant_id, target_user_id, p_role);

    update public.tenant_invitations ti
    set status = 'accepted', accepted_user_id = target_user_id, updated_at = now()
    where ti.tenant_id = p_tenant_id
      and lower(ti.email) = normalized_email
      and ti.status = 'pending';

    return jsonb_build_object('outcome', 'joined', 'userId', target_user_id, 'email', normalized_email, 'role', p_role);
  end if;

  select ti.id into invitation_id
  from public.tenant_invitations ti
  where ti.tenant_id = p_tenant_id
    and lower(ti.email) = normalized_email
    and ti.status = 'pending'
  limit 1;

  if invitation_id is null then
    insert into public.tenant_invitations (tenant_id, email, role, invited_by_user_id, expires_at)
    values (p_tenant_id, normalized_email, p_role, p_actor_user_id, now() + interval '7 days')
    returning id into invitation_id;
  else
    update public.tenant_invitations ti
    set role = p_role,
        invited_by_user_id = p_actor_user_id,
        expires_at = now() + interval '7 days',
        updated_at = now()
    where ti.id = invitation_id;
  end if;

  return jsonb_build_object('outcome', 'invited', 'invitationId', invitation_id, 'email', normalized_email, 'role', p_role);
end;
$$;

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
begin
  select tm.role into actor_role
  from public.tenant_members tm
  where tm.tenant_id = p_tenant_id and tm.user_id = p_actor_user_id;

  if actor_role not in ('owner', 'manager') then
    raise exception 'Only an Owner or Manager can manage team members' using errcode = '42501';
  end if;

  select tm.role into target_role
  from public.tenant_members tm
  where tm.tenant_id = p_tenant_id and tm.user_id = p_target_user_id;

  if target_role is null then
    raise exception 'Team member not found' using errcode = 'P0002';
  end if;
  if p_target_user_id = p_actor_user_id then
    raise exception 'You cannot change your own membership from this screen' using errcode = '42501';
  end if;
  if target_role = 'owner' then
    raise exception 'Owner membership is protected; ownership transfer is outside the current MVP' using errcode = '42501';
  end if;
  if actor_role = 'manager' and target_role <> 'staff' then
    raise exception 'Managers can manage Staff only' using errcode = '42501';
  end if;

  if p_action = 'remove' then
    delete from public.tenant_members tm
    where tm.tenant_id = p_tenant_id and tm.user_id = p_target_user_id;
    return;
  end if;

  if p_action = 'set_role' then
    if actor_role <> 'owner' then
      raise exception 'Only an Owner can change team roles' using errcode = '42501';
    end if;
    if p_role not in ('manager', 'staff') then
      raise exception 'Team role must be Manager or Staff' using errcode = '22023';
    end if;

    update public.tenant_members tm
    set role = p_role
    where tm.tenant_id = p_tenant_id and tm.user_id = p_target_user_id;
    return;
  end if;

  raise exception 'Unsupported team action' using errcode = '22023';
end;
$$;

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
  invitation_role text;
begin
  select tm.role into actor_role
  from public.tenant_members tm
  where tm.tenant_id = p_tenant_id and tm.user_id = p_actor_user_id;

  if actor_role not in ('owner', 'manager') then
    raise exception 'Only an Owner or Manager can cancel invitations' using errcode = '42501';
  end if;

  select ti.role into invitation_role
  from public.tenant_invitations ti
  where ti.id = p_invitation_id
    and ti.tenant_id = p_tenant_id
    and ti.status = 'pending';

  if invitation_role is null then
    raise exception 'Pending invitation not found' using errcode = 'P0002';
  end if;
  if actor_role = 'manager' and invitation_role <> 'staff' then
    raise exception 'Managers can manage Staff invitations only' using errcode = '42501';
  end if;

  update public.tenant_invitations ti
  set status = 'cancelled', updated_at = now()
  where ti.id = p_invitation_id;
end;
$$;

create or replace function public.claim_orderdesk_team_invitations(p_user_id uuid, p_email text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(trim(coalesce(p_email, '')));
  actual_email text;
  invitation record;
  claimed_count integer := 0;
begin
  select lower(u.email) into actual_email
  from auth.users u
  where u.id = p_user_id;

  if actual_email is null or actual_email <> normalized_email then
    raise exception 'Authenticated email does not match invitation claim' using errcode = '42501';
  end if;

  update public.tenant_invitations ti
  set status = 'expired', updated_at = now()
  where ti.status = 'pending' and ti.expires_at <= now();

  for invitation in
    select ti.id, ti.tenant_id, ti.role
    from public.tenant_invitations ti
    where lower(ti.email) = normalized_email
      and ti.status = 'pending'
      and ti.expires_at > now()
    order by ti.created_at
    for update
  loop
    insert into public.tenant_members (tenant_id, user_id, role)
    values (invitation.tenant_id, p_user_id, invitation.role)
    on conflict (tenant_id, user_id) do nothing;

    update public.tenant_invitations ti
    set status = 'accepted', accepted_user_id = p_user_id, updated_at = now()
    where ti.id = invitation.id;

    claimed_count := claimed_count + 1;
  end loop;

  return claimed_count;
end;
$$;

revoke all on function public.list_orderdesk_team(uuid, uuid) from public, anon, authenticated;
revoke all on function public.invite_orderdesk_team_member(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.change_orderdesk_team_member(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.cancel_orderdesk_team_invitation(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.claim_orderdesk_team_invitations(uuid, text) from public, anon, authenticated;

grant execute on function public.list_orderdesk_team(uuid, uuid) to service_role;
grant execute on function public.invite_orderdesk_team_member(uuid, uuid, text, text) to service_role;
grant execute on function public.change_orderdesk_team_member(uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.cancel_orderdesk_team_invitation(uuid, uuid, uuid) to service_role;
grant execute on function public.claim_orderdesk_team_invitations(uuid, text) to service_role;
