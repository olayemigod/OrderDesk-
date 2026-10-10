begin;

create or replace function public.set_sellertray_member_branch_access(
  p_tenant_id uuid,
  p_target_user_id uuid,
  p_branch_id uuid,
  p_can_operate boolean
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor_user_id uuid := (select auth.uid());
  v_actor_role text;
  v_target_role text;
  v_previous boolean;
  v_had_previous boolean := false;
  v_had_any_assignment boolean := false;
  v_target_is_default boolean := false;
  v_default_branch_id uuid;
begin
  if v_actor_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if p_target_user_id is null or p_branch_id is null or p_can_operate is null then
    raise exception 'Staff member, Branch and access decision are required' using errcode='22023';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  select tm.role into v_actor_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_actor_user_id;
  select tm.role into v_target_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_target_user_id;

  if v_actor_role not in ('owner','manager') then
    raise exception 'Only an Owner or Manager can change Staff Branch access' using errcode='42501';
  end if;
  if v_target_role is null then
    raise exception 'Staff member does not belong to this business' using errcode='23503';
  end if;
  if v_target_role<>'staff' then
    raise exception 'Branch assignments are required only for Staff' using errcode='23514';
  end if;

  select b.is_default into v_target_is_default
  from public.branches b
  where b.tenant_id=p_tenant_id and b.id=p_branch_id
    and (b.is_active=true or p_can_operate=false);
  if not found then
    raise exception 'Selected Branch is unavailable' using errcode='23514';
  end if;

  select exists(
    select 1 from public.branch_user_access bua
    where bua.tenant_id=p_tenant_id and bua.user_id=p_target_user_id
  ) into v_had_any_assignment;

  if not v_had_any_assignment and p_can_operate=true and not v_target_is_default then
    select b.id into v_default_branch_id
    from public.branches b
    where b.tenant_id=p_tenant_id and b.is_default=true and b.is_active=true
    limit 1;

    if v_default_branch_id is not null then
      insert into public.branch_user_access(tenant_id,branch_id,user_id,can_operate)
      values(p_tenant_id,v_default_branch_id,p_target_user_id,true)
      on conflict(tenant_id,branch_id,user_id) do update set can_operate=true;

      insert into public.sellertray_branch_access_events(
        tenant_id,branch_id,user_id,previous_can_operate,new_can_operate,actor_user_id
      ) values(
        p_tenant_id,v_default_branch_id,p_target_user_id,null,true,v_actor_user_id
      );
    end if;
  end if;

  select bua.can_operate into v_previous
  from public.branch_user_access bua
  where bua.tenant_id=p_tenant_id
    and bua.branch_id=p_branch_id
    and bua.user_id=p_target_user_id;
  v_had_previous := found;

  insert into public.branch_user_access(tenant_id,branch_id,user_id,can_operate)
  values(p_tenant_id,p_branch_id,p_target_user_id,p_can_operate)
  on conflict(tenant_id,branch_id,user_id) do update
    set can_operate=excluded.can_operate;

  if not v_had_previous or v_previous is distinct from p_can_operate then
    insert into public.sellertray_branch_access_events(
      tenant_id,branch_id,user_id,previous_can_operate,new_can_operate,actor_user_id
    ) values(
      p_tenant_id,p_branch_id,p_target_user_id,
      case when v_had_previous then v_previous else null end,
      p_can_operate,v_actor_user_id
    );
  end if;

  return p_can_operate;
end;
$$;

revoke all on function public.set_sellertray_member_branch_access(uuid,uuid,uuid,boolean)
  from public,anon;
grant execute on function public.set_sellertray_member_branch_access(uuid,uuid,uuid,boolean)
  to authenticated;

commit;
