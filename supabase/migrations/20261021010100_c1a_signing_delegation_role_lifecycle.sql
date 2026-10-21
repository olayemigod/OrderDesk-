begin;

-- Commercial agreement signing is an explicit Owner delegation to a Manager.
-- That delegation must not silently survive demotion/removal and later become
-- effective again after the user is promoted or re-added as a Manager.
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
set search_path=''
as $$
declare
  actor_role text;
  target_role text;
begin
  select tm.role into actor_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;

  if actor_role not in ('owner','manager') then
    raise exception 'Only an Owner or Manager can manage team members' using errcode='42501';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  select tm.role into target_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_target_user_id;

  if target_role is null then
    raise exception 'Team member not found' using errcode='P0002';
  end if;
  if p_target_user_id=p_actor_user_id then
    raise exception 'You cannot change your own membership from this screen' using errcode='42501';
  end if;
  if target_role='owner' then
    raise exception 'Owner membership is protected; ownership transfer is outside the current MVP' using errcode='42501';
  end if;
  if actor_role='manager' and target_role<>'staff' then
    raise exception 'Managers can manage Staff only' using errcode='42501';
  end if;

  if p_action='remove' then
    -- Defensive cleanup is allowed to remove authority even if a stale override
    -- is attached to a Staff member. It can never grant signing authority.
    update public.tenant_member_capabilities c
    set allowed=false,
        granted_by=p_actor_user_id,
        updated_at=now()
    where c.tenant_id=p_tenant_id
      and c.user_id=p_target_user_id
      and c.capability='can_accept_commercial_agreements'
      and c.allowed=true;

    if found then
      insert into public.tenant_member_capability_events(
        tenant_id,user_id,capability,previous_allowed,new_allowed,actor_user_id
      ) values (
        p_tenant_id,p_target_user_id,'can_accept_commercial_agreements',true,false,p_actor_user_id
      );
    end if;

    delete from public.tenant_members
    where tenant_id=p_tenant_id and user_id=p_target_user_id;
    return;
  end if;

  if p_action='set_role' then
    if actor_role<>'owner' then
      raise exception 'Only an Owner can change team roles' using errcode='42501';
    end if;
    if p_role not in ('manager','staff') then
      raise exception 'Team role must be Manager or Staff' using errcode='22023';
    end if;

    if p_role='staff' then
      update public.tenant_member_capabilities c
      set allowed=false,
          granted_by=p_actor_user_id,
          updated_at=now()
      where c.tenant_id=p_tenant_id
        and c.user_id=p_target_user_id
        and c.capability='can_accept_commercial_agreements'
        and c.allowed=true;

      if found then
        insert into public.tenant_member_capability_events(
          tenant_id,user_id,capability,previous_allowed,new_allowed,actor_user_id
        ) values (
          p_tenant_id,p_target_user_id,'can_accept_commercial_agreements',true,false,p_actor_user_id
        );
      end if;
    end if;

    update public.tenant_members
    set role=p_role
    where tenant_id=p_tenant_id and user_id=p_target_user_id;
    return;
  end if;

  raise exception 'Unsupported team action' using errcode='22023';
end;
$$;

revoke all on function public.change_orderdesk_team_member(uuid,uuid,uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.change_orderdesk_team_member(uuid,uuid,uuid,text,text)
  to service_role;

commit;
