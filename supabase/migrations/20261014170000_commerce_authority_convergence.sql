begin;

alter table public.tenant_member_capabilities
  drop constraint if exists tenant_member_capabilities_capability_check,
  add constraint tenant_member_capabilities_capability_check
    check (capability in (
      'can_receive_stock','can_adjust_stock','can_count_stock','can_apply_stock_count','can_transfer_stock',
      'can_open_shift','can_record_cash_movement','can_record_expense','can_close_shift','can_review_shift',
      'can_print_receipt','can_manage_devices','can_manage_orders','can_manage_products','can_manage_purchasing',
      'can_manage_payments','can_view_reports'
    ));

alter table public.tenant_member_capability_events
  drop constraint if exists tenant_member_capability_events_capability_check,
  add constraint tenant_member_capability_events_capability_check
    check (capability in (
      'can_receive_stock','can_adjust_stock','can_count_stock','can_apply_stock_count','can_transfer_stock',
      'can_open_shift','can_record_cash_movement','can_record_expense','can_close_shift','can_review_shift',
      'can_print_receipt','can_manage_devices','can_manage_orders','can_manage_products','can_manage_purchasing',
      'can_manage_payments','can_view_reports'
    ));

create or replace function public.sellertray_user_has_capability(
  p_tenant_id uuid,
  p_user_id uuid,
  p_capability text
)
returns boolean
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_role text;
  v_override boolean;
begin
  if p_tenant_id is null or p_user_id is null
     or p_capability not in (
       'can_receive_stock','can_adjust_stock','can_count_stock','can_apply_stock_count','can_transfer_stock',
       'can_open_shift','can_record_cash_movement','can_record_expense','can_close_shift','can_review_shift',
       'can_print_receipt','can_manage_devices','can_manage_orders','can_manage_products','can_manage_purchasing',
       'can_manage_payments','can_view_reports'
     ) then
    return false;
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_user_id;

  if v_role is null then return false; end if;
  if v_role='owner' then return true; end if;

  select c.allowed into v_override
  from public.tenant_member_capabilities c
  where c.tenant_id=p_tenant_id and c.user_id=p_user_id and c.capability=p_capability;
  if found then return v_override; end if;

  if v_role='manager' then return true; end if;
  if v_role='staff' then
    return p_capability in (
      'can_open_shift','can_record_cash_movement','can_record_expense','can_close_shift','can_print_receipt'
    );
  end if;
  return false;
end;
$$;

revoke all on function public.sellertray_user_has_capability(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.sellertray_user_has_capability(uuid,uuid,text) to service_role;

create or replace function public.set_sellertray_member_capability(
  p_tenant_id uuid,
  p_target_user_id uuid,
  p_capability text,
  p_allowed boolean,
  p_actor_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor_role text;
  v_target_role text;
  v_capability text := lower(btrim(coalesce(p_capability,'')));
  v_previous_override boolean;
  v_previous_effective boolean;
  v_changed boolean := false;
begin
  if p_tenant_id is null or p_target_user_id is null or p_actor_user_id is null or p_allowed is null then
    raise exception 'Business, staff member, permission and decision are required' using errcode='22023';
  end if;
  if v_capability not in (
    'can_receive_stock','can_adjust_stock','can_count_stock','can_apply_stock_count','can_transfer_stock',
    'can_open_shift','can_record_cash_movement','can_record_expense','can_close_shift','can_review_shift',
    'can_print_receipt','can_manage_devices','can_manage_orders','can_manage_products','can_manage_purchasing',
    'can_manage_payments','can_view_reports'
  ) then
    raise exception 'Unknown SellerTray permission' using errcode='22023';
  end if;

  select tm.role into v_actor_role from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;
  select tm.role into v_target_role from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_target_user_id;

  if v_actor_role not in ('owner','manager') then
    raise exception 'Only an Owner or Manager can change staff permissions' using errcode='42501';
  end if;
  if v_target_role is null then raise exception 'Staff member does not belong to this business' using errcode='23503'; end if;
  if v_target_role='owner' then raise exception 'Owner authority cannot be changed here' using errcode='42501'; end if;
  if v_actor_role='manager' and v_target_role<>'staff' then
    raise exception 'Managers can change permissions for Staff only' using errcode='42501';
  end if;

  v_previous_effective := public.sellertray_user_has_capability(p_tenant_id,p_target_user_id,v_capability);
  select c.allowed into v_previous_override from public.tenant_member_capabilities c
  where c.tenant_id=p_tenant_id and c.user_id=p_target_user_id and c.capability=v_capability;
  if not found or v_previous_override is distinct from p_allowed then v_changed := true; end if;

  insert into public.tenant_member_capabilities(tenant_id,user_id,capability,allowed,granted_by,created_at,updated_at)
  values(p_tenant_id,p_target_user_id,v_capability,p_allowed,p_actor_user_id,now(),now())
  on conflict(tenant_id,user_id,capability) do update
    set allowed=excluded.allowed,granted_by=excluded.granted_by,updated_at=now();

  if v_changed then
    insert into public.tenant_member_capability_events(
      tenant_id,user_id,capability,previous_allowed,new_allowed,actor_user_id
    ) values(p_tenant_id,p_target_user_id,v_capability,v_previous_effective,p_allowed,p_actor_user_id);
  end if;
  return p_allowed;
end;
$$;

revoke all on function public.set_sellertray_member_capability(uuid,uuid,text,boolean,uuid) from public,anon,authenticated;
grant execute on function public.set_sellertray_member_capability(uuid,uuid,text,boolean,uuid) to service_role;

create or replace function public.sellertray_purchase_management_role(p_tenant_id uuid,p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select public.sellertray_user_has_capability(p_tenant_id,p_user_id,'can_manage_purchasing');
$$;

revoke all on function public.sellertray_purchase_management_role(uuid,uuid) from public,anon,authenticated;
grant execute on function public.sellertray_purchase_management_role(uuid,uuid) to service_role;

create or replace function public.sellertray_user_can_manage_products(
  p_tenant_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select public.sellertray_user_has_capability(p_tenant_id,p_user_id,'can_manage_products');
$$;

revoke all on function public.sellertray_user_can_manage_products(uuid,uuid) from public,anon;
grant execute on function public.sellertray_user_can_manage_products(uuid,uuid) to authenticated;

commit;
