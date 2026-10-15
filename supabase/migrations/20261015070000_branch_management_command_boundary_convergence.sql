begin;

-- Branch and Staff-access mutations are governed business commands. Historical
-- databases can retain the original direct-table authenticated write grants
-- even after Merchant Web moved to RPC commands. Converge both fresh and live
-- databases on the command boundary so subscription checks, role rules,
-- default-Branch preservation and immutable access history cannot be bypassed.

create or replace function public.get_sellertray_manageable_branches(
  p_tenant_id uuid
)
returns table(
  id uuid,
  code text,
  name text,
  is_default boolean,
  is_active boolean,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=p_tenant_id
      and tm.user_id=v_user_id
      and tm.role in ('owner','manager')
  ) then
    raise exception 'Only business Owners and Managers can manage Branches' using errcode='42501';
  end if;

  return query
  select b.id,b.code,b.name,b.is_default,b.is_active,b.created_at
  from public.branches b
  where b.tenant_id=p_tenant_id
  order by b.is_default desc,b.is_active desc,b.name,b.id;
end;
$$;

create or replace function public.save_sellertray_branch(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_code text,
  p_name text,
  p_is_default boolean,
  p_is_active boolean
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_branch_id uuid := p_branch_id;
  v_code text := upper(nullif(btrim(coalesce(p_code,'')),''));
  v_name text := nullif(btrim(coalesce(p_name,'')),'');
  v_existing public.branches%rowtype;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=p_tenant_id
      and tm.user_id=v_user_id
      and tm.role in ('owner','manager')
  ) then
    raise exception 'Only business Owners and Managers can manage Branches' using errcode='42501';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;
  if v_code is null or v_name is null then
    raise exception 'Branch code and name are required' using errcode='22023';
  end if;
  if char_length(v_code)>40 or char_length(v_name)>120 then
    raise exception 'Branch code or name is too long' using errcode='22023';
  end if;
  if coalesce(p_is_default,false) and not coalesce(p_is_active,true) then
    raise exception 'The default Branch must remain active' using errcode='23514';
  end if;

  if v_branch_id is not null then
    select * into v_existing
    from public.branches b
    where b.tenant_id=p_tenant_id and b.id=v_branch_id
    for update;
    if not found then raise exception 'Branch not found' using errcode='22023'; end if;
    if v_existing.is_default and not coalesce(p_is_default,false) then
      raise exception 'Choose another default Branch before clearing this one' using errcode='23514';
    end if;
    if v_existing.is_default and not coalesce(p_is_active,true) then
      raise exception 'Choose another default Branch before archiving this one' using errcode='23514';
    end if;
  end if;

  if coalesce(p_is_default,false) then
    update public.branches b
    set is_default=false,updated_at=now()
    where b.tenant_id=p_tenant_id
      and (v_branch_id is null or b.id<>v_branch_id)
      and b.is_default=true;
  end if;

  if v_branch_id is null then
    insert into public.branches(tenant_id,code,name,is_default,is_active)
    values(p_tenant_id,v_code,v_name,coalesce(p_is_default,false),coalesce(p_is_active,true))
    returning id into v_branch_id;
  else
    update public.branches b
    set code=v_code,
        name=v_name,
        is_default=coalesce(p_is_default,false),
        is_active=coalesce(p_is_active,true),
        updated_at=now()
    where b.tenant_id=p_tenant_id and b.id=v_branch_id;
  end if;

  return v_branch_id;
end;
$$;

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

  -- Staff without explicit assignments historically operate the active default
  -- Branch. Preserve that access when their first explicit assignment is to a
  -- different Branch so adding access never silently removes existing access.
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

create or replace function public.reset_sellertray_member_branch_access(
  p_tenant_id uuid,
  p_target_user_id uuid
)
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor_user_id uuid := (select auth.uid());
  v_actor_role text;
  v_target_role text;
  v_row record;
  v_count integer := 0;
begin
  if v_actor_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
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
  if v_target_role<>'staff' then
    raise exception 'Branch assignments are required only for Staff' using errcode='23514';
  end if;

  for v_row in
    select bua.branch_id,bua.can_operate
    from public.branch_user_access bua
    where bua.tenant_id=p_tenant_id and bua.user_id=p_target_user_id
    order by bua.branch_id
  loop
    insert into public.sellertray_branch_access_events(
      tenant_id,branch_id,user_id,previous_can_operate,new_can_operate,actor_user_id
    ) values(
      p_tenant_id,v_row.branch_id,p_target_user_id,v_row.can_operate,null,v_actor_user_id
    );
    v_count := v_count+1;
  end loop;

  delete from public.branch_user_access bua
  where bua.tenant_id=p_tenant_id and bua.user_id=p_target_user_id;

  return v_count;
end;
$$;

create or replace function public.set_sellertray_member_capability_for_current_user(
  p_tenant_id uuid,
  p_target_user_id uuid,
  p_capability text,
  p_allowed boolean
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor_user_id uuid := (select auth.uid());
begin
  if v_actor_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;
  return public.set_sellertray_member_capability(
    p_tenant_id,p_target_user_id,p_capability,p_allowed,v_actor_user_id
  );
end;
$$;

revoke all on function public.get_sellertray_manageable_branches(uuid) from public,anon;
revoke all on function public.save_sellertray_branch(uuid,uuid,text,text,boolean,boolean) from public,anon;
revoke all on function public.set_sellertray_member_branch_access(uuid,uuid,uuid,boolean) from public,anon;
revoke all on function public.reset_sellertray_member_branch_access(uuid,uuid) from public,anon;
revoke all on function public.set_sellertray_member_capability_for_current_user(uuid,uuid,text,boolean) from public,anon;

grant execute on function public.get_sellertray_manageable_branches(uuid) to authenticated,service_role;
grant execute on function public.save_sellertray_branch(uuid,uuid,text,text,boolean,boolean) to authenticated,service_role;
grant execute on function public.set_sellertray_member_branch_access(uuid,uuid,uuid,boolean) to authenticated,service_role;
grant execute on function public.reset_sellertray_member_branch_access(uuid,uuid) to authenticated,service_role;
grant execute on function public.set_sellertray_member_capability_for_current_user(uuid,uuid,text,boolean) to authenticated,service_role;

-- Read access remains RLS-scoped. All authenticated writes must use the
-- governed commands above so they cannot bypass subscription checks or access
-- history.
revoke insert,update,delete on table public.branches from authenticated;
revoke insert,update,delete on table public.branch_user_access from authenticated;
grant select on table public.branches to authenticated;
grant select on table public.branch_user_access to authenticated;

drop policy if exists branches_insert_management on public.branches;
drop policy if exists branches_update_management on public.branches;
drop policy if exists branch_user_access_manage_management on public.branch_user_access;

commit;
