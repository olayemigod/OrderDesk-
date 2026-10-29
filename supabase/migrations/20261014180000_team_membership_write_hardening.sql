begin;

-- Team writes are service-boundary commands, but every command must still
-- enforce the tenant's subscription state itself. This prevents bypasses from
-- alternate server callers and keeps authorization close to the mutation.
create or replace function public.invite_orderdesk_team_member(
  p_tenant_id uuid,p_actor_user_id uuid,p_email text,p_role text
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  actor_role text;
  normalized_email text := lower(trim(coalesce(p_email,'')));
  target_user_id uuid;
  invitation_id uuid;
begin
  select tm.role into actor_role from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;
  if actor_role not in ('owner','manager') then
    raise exception 'Only an Owner or Manager can invite team members' using errcode='42501';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;
  if p_role not in ('manager','staff') then raise exception 'Team role must be Manager or Staff' using errcode='22023'; end if;
  if actor_role='manager' and p_role<>'staff' then raise exception 'Managers can invite Staff only' using errcode='42501'; end if;
  if normalized_email='' or position('@' in normalized_email)<=1 then raise exception 'Enter a valid email address' using errcode='22023'; end if;

  select u.id into target_user_id from auth.users u where lower(u.email)=normalized_email limit 1;
  if target_user_id is not null then
    if target_user_id=p_actor_user_id then raise exception 'You are already a member of this business' using errcode='23505'; end if;
    if exists(select 1 from public.tenant_members tm where tm.tenant_id=p_tenant_id and tm.user_id=target_user_id) then
      raise exception 'This user is already a member of this business' using errcode='23505';
    end if;
    insert into public.tenant_members(tenant_id,user_id,role) values(p_tenant_id,target_user_id,p_role);
    update public.tenant_invitations set status='accepted',accepted_user_id=target_user_id,updated_at=now()
    where tenant_id=p_tenant_id and lower(email)=normalized_email and status='pending';
    return jsonb_build_object('outcome','joined','userId',target_user_id,'email',normalized_email,'role',p_role);
  end if;

  select ti.id into invitation_id from public.tenant_invitations ti
  where ti.tenant_id=p_tenant_id and lower(ti.email)=normalized_email and ti.status='pending' limit 1;
  if invitation_id is null then
    insert into public.tenant_invitations(tenant_id,email,role,invited_by_user_id,expires_at)
    values(p_tenant_id,normalized_email,p_role,p_actor_user_id,now()+interval '7 days') returning id into invitation_id;
  else
    update public.tenant_invitations set role=p_role,invited_by_user_id=p_actor_user_id,
      expires_at=now()+interval '7 days',updated_at=now() where id=invitation_id;
  end if;
  return jsonb_build_object('outcome','invited','invitationId',invitation_id,'email',normalized_email,'role',p_role);
end;
$$;

create or replace function public.change_orderdesk_team_member(
  p_tenant_id uuid,p_actor_user_id uuid,p_target_user_id uuid,p_action text,p_role text default null
)
returns void language plpgsql security definer set search_path=''
as $$
declare actor_role text; target_role text;
begin
  select tm.role into actor_role from public.tenant_members tm where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;
  if actor_role not in ('owner','manager') then raise exception 'Only an Owner or Manager can manage team members' using errcode='42501'; end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then raise exception 'SellerTray subscription is read-only' using errcode='42501'; end if;
  select tm.role into target_role from public.tenant_members tm where tm.tenant_id=p_tenant_id and tm.user_id=p_target_user_id;
  if target_role is null then raise exception 'Team member not found' using errcode='P0002'; end if;
  if p_target_user_id=p_actor_user_id then raise exception 'You cannot change your own membership from this screen' using errcode='42501'; end if;
  if target_role='owner' then raise exception 'Owner membership is protected; ownership transfer is outside the current MVP' using errcode='42501'; end if;
  if actor_role='manager' and target_role<>'staff' then raise exception 'Managers can manage Staff only' using errcode='42501'; end if;
  if p_action='remove' then delete from public.tenant_members where tenant_id=p_tenant_id and user_id=p_target_user_id; return; end if;
  if p_action='set_role' then
    if actor_role<>'owner' then raise exception 'Only an Owner can change team roles' using errcode='42501'; end if;
    if p_role not in ('manager','staff') then raise exception 'Team role must be Manager or Staff' using errcode='22023'; end if;
    update public.tenant_members set role=p_role where tenant_id=p_tenant_id and user_id=p_target_user_id; return;
  end if;
  raise exception 'Unsupported team action' using errcode='22023';
end;
$$;

create or replace function public.cancel_orderdesk_team_invitation(
  p_tenant_id uuid,p_actor_user_id uuid,p_invitation_id uuid
)
returns void language plpgsql security definer set search_path=''
as $$
declare actor_role text; invitation_role text;
begin
  select tm.role into actor_role from public.tenant_members tm where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;
  if actor_role not in ('owner','manager') then raise exception 'Only an Owner or Manager can cancel invitations' using errcode='42501'; end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then raise exception 'SellerTray subscription is read-only' using errcode='42501'; end if;
  select ti.role into invitation_role from public.tenant_invitations ti
  where ti.id=p_invitation_id and ti.tenant_id=p_tenant_id and ti.status='pending';
  if invitation_role is null then raise exception 'Pending invitation not found' using errcode='P0002'; end if;
  if actor_role='manager' and invitation_role<>'staff' then raise exception 'Managers can manage Staff invitations only' using errcode='42501'; end if;
  update public.tenant_invitations set status='cancelled',updated_at=now() where id=p_invitation_id and tenant_id=p_tenant_id;
end;
$$;

revoke all on function public.invite_orderdesk_team_member(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.change_orderdesk_team_member(uuid,uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.cancel_orderdesk_team_invitation(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.invite_orderdesk_team_member(uuid,uuid,text,text) to service_role;
grant execute on function public.change_orderdesk_team_member(uuid,uuid,uuid,text,text) to service_role;
grant execute on function public.cancel_orderdesk_team_invitation(uuid,uuid,uuid) to service_role;

commit;
