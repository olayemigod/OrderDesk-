begin;

create table public.tenant_member_capabilities (
  tenant_id uuid not null,
  user_id uuid not null,
  capability text not null
    check (capability in ('can_receive_stock','can_adjust_stock')),
  allowed boolean not null,
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id,user_id,capability),
  constraint tenant_member_capabilities_member_same_tenant
    foreign key (tenant_id,user_id)
    references public.tenant_members(tenant_id,user_id)
    on delete cascade
);

create index tenant_member_capabilities_user_idx
  on public.tenant_member_capabilities(user_id,tenant_id,capability);

alter table public.tenant_member_capabilities enable row level security;
revoke all on table public.tenant_member_capabilities from public,anon,authenticated;
grant all on table public.tenant_member_capabilities to service_role;

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
     or p_capability not in ('can_receive_stock','can_adjust_stock') then
    return false;
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id
    and tm.user_id=p_user_id;

  if v_role is null then
    return false;
  end if;

  -- Owners retain the governing business capabilities. Managers default to
  -- operational management access but can be explicitly constrained. Staff
  -- receive no inventory mutation capability unless it is explicitly granted.
  if v_role='owner' then
    return true;
  end if;

  select c.allowed into v_override
  from public.tenant_member_capabilities c
  where c.tenant_id=p_tenant_id
    and c.user_id=p_user_id
    and c.capability=p_capability;

  if found then
    return v_override;
  end if;

  return v_role='manager';
end;
$$;

revoke all on function public.sellertray_user_has_capability(uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.sellertray_user_has_capability(uuid,uuid,text)
  to service_role;

create or replace function public.sellertray_user_can_operate_branch(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_user_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_role text;
  v_is_default boolean;
begin
  if p_tenant_id is null or p_branch_id is null or p_user_id is null then
    return false;
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id
    and tm.user_id=p_user_id;

  if v_role is null then
    return false;
  end if;

  select b.is_default into v_is_default
  from public.branches b
  where b.tenant_id=p_tenant_id
    and b.id=p_branch_id
    and b.is_active=true;

  if not found then
    return false;
  end if;

  if v_role in ('owner','manager') then
    return true;
  end if;

  if v_role<>'staff' then
    return false;
  end if;

  if exists (
    select 1
    from public.branch_user_access any_bua
    where any_bua.tenant_id=p_tenant_id
      and any_bua.user_id=p_user_id
  ) then
    return exists (
      select 1
      from public.branch_user_access bua
      where bua.tenant_id=p_tenant_id
        and bua.branch_id=p_branch_id
        and bua.user_id=p_user_id
        and bua.can_operate=true
    );
  end if;

  return v_is_default=true;
end;
$$;

revoke all on function public.sellertray_user_can_operate_branch(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.sellertray_user_can_operate_branch(uuid,uuid,uuid)
  to service_role;

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
begin
  if p_tenant_id is null or p_target_user_id is null or p_actor_user_id is null
     or p_allowed is null then
    raise exception 'Business, staff member, permission and decision are required'
      using errcode='22023';
  end if;

  if v_capability not in ('can_receive_stock','can_adjust_stock') then
    raise exception 'Unknown SellerTray inventory permission' using errcode='22023';
  end if;

  select tm.role into v_actor_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id
    and tm.user_id=p_actor_user_id;

  select tm.role into v_target_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id
    and tm.user_id=p_target_user_id;

  if v_actor_role not in ('owner','manager') then
    raise exception 'Only an Owner or Manager can change staff permissions'
      using errcode='42501';
  end if;
  if v_target_role is null then
    raise exception 'Staff member does not belong to this business' using errcode='23503';
  end if;
  if v_target_role='owner' then
    raise exception 'Owner inventory authority cannot be changed here' using errcode='42501';
  end if;
  if v_actor_role='manager' and v_target_role<>'staff' then
    raise exception 'Managers can change inventory permissions for Staff only'
      using errcode='42501';
  end if;

  insert into public.tenant_member_capabilities(
    tenant_id,user_id,capability,allowed,granted_by,created_at,updated_at
  ) values(
    p_tenant_id,p_target_user_id,v_capability,p_allowed,p_actor_user_id,now(),now()
  )
  on conflict(tenant_id,user_id,capability) do update
    set allowed=excluded.allowed,
        granted_by=excluded.granted_by,
        updated_at=now();

  return p_allowed;
end;
$$;

revoke all on function public.set_sellertray_member_capability(uuid,uuid,text,boolean,uuid)
  from public,anon,authenticated;
grant execute on function public.set_sellertray_member_capability(uuid,uuid,text,boolean,uuid)
  to service_role;

create or replace function public.get_sellertray_inventory_capabilities(
  p_tenant_id uuid,
  p_branch_id uuid
)
returns table (
  can_receive_stock boolean,
  can_adjust_stock boolean
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_branch_allowed boolean;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;

  v_branch_allowed := public.sellertray_user_can_operate_branch(
    p_tenant_id,p_branch_id,v_user_id
  );

  return query
  select
    v_branch_allowed and public.sellertray_user_has_capability(
      p_tenant_id,v_user_id,'can_receive_stock'
    ),
    v_branch_allowed and public.sellertray_user_has_capability(
      p_tenant_id,v_user_id,'can_adjust_stock'
    );
end;
$$;

revoke all on function public.get_sellertray_inventory_capabilities(uuid,uuid)
  from public,anon;
grant execute on function public.get_sellertray_inventory_capabilities(uuid,uuid)
  to authenticated;

create or replace function public.sellertray_inventory_lock_key(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_stock_location_id uuid,
  p_catalog_item_id uuid
)
returns bigint
language sql
immutable
set search_path=''
as $$
  select pg_catalog.hashtextextended(
    coalesce(p_tenant_id::text,'') || ':' ||
    coalesce(p_branch_id::text,'') || ':' ||
    coalesce(p_stock_location_id::text,'') || ':' ||
    coalesce(p_catalog_item_id::text,''),
    0
  );
$$;

revoke all on function public.sellertray_inventory_lock_key(uuid,uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.sellertray_inventory_lock_key(uuid,uuid,uuid,uuid)
  to service_role;

create or replace function public.apply_sellertray_inventory_operation(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_catalog_item_id uuid,
  p_uom_id uuid,
  p_operation text,
  p_quantity numeric,
  p_adjustment_direction text,
  p_reference text,
  p_reason text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_operation text := lower(btrim(coalesce(p_operation,'')));
  v_direction text := lower(btrim(coalesce(p_adjustment_direction,'')));
  v_reference text := nullif(btrim(coalesce(p_reference,'')),'');
  v_reason text := nullif(btrim(coalesce(p_reason,'')),'');
  v_required_capability text;
  v_stock_location_id uuid;
  v_product_name text;
  v_stock_uom text;
  v_source_uom text;
  v_conversion_factor numeric(18,6);
  v_allow_fractional boolean;
  v_stock_quantity numeric(18,6);
  v_quantity_delta numeric(18,6);
  v_movement_type text;
  v_reference_type text;
  v_idempotency_key text;
  v_existing public.inventory_movements%rowtype;
  v_movement_id uuid;
  v_on_hand numeric(18,6);
  v_replayed boolean := false;
begin
  if p_tenant_id is null or p_branch_id is null or p_catalog_item_id is null
     or p_uom_id is null or p_actor_user_id is null then
    raise exception 'Business, branch, product, unit and operator are required'
      using errcode='22023';
  end if;
  if v_operation not in ('receive','adjust') then
    raise exception 'Choose Receive stock or Adjust stock' using errcode='22023';
  end if;
  if p_quantity is null or p_quantity<=0 then
    raise exception 'Quantity must be greater than zero' using errcode='22023';
  end if;
  if v_reference is null then
    raise exception 'Reference is required' using errcode='22023';
  end if;
  if v_reason is null then
    raise exception 'Reason is required' using errcode='22023';
  end if;
  if v_operation='adjust' and v_direction not in ('increase','decrease') then
    raise exception 'Choose whether the adjustment increases or decreases stock'
      using errcode='22023';
  end if;

  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  if not public.sellertray_user_can_operate_branch(
    p_tenant_id,p_branch_id,p_actor_user_id
  ) then
    raise exception 'You do not have access to change stock for this branch'
      using errcode='42501';
  end if;

  v_required_capability := case
    when v_operation='receive' then 'can_receive_stock'
    else 'can_adjust_stock'
  end;

  if not public.sellertray_user_has_capability(
    p_tenant_id,p_actor_user_id,v_required_capability
  ) then
    raise exception 'You do not have permission for this stock action'
      using errcode='42501';
  end if;

  select
    ci.name,
    ci.stock_uom,
    u.uom_name,
    u.conversion_factor,
    u.allow_fractional
  into
    v_product_name,
    v_stock_uom,
    v_source_uom,
    v_conversion_factor,
    v_allow_fractional
  from public.catalog_items ci
  join public.catalog_item_uoms u
    on u.tenant_id=ci.tenant_id
   and u.catalog_item_id=ci.id
  where ci.tenant_id=p_tenant_id
    and ci.id=p_catalog_item_id
    and ci.is_active=true
    and u.id=p_uom_id;

  if not found then
    raise exception 'Product unit is unavailable for this business' using errcode='23514';
  end if;

  if not v_allow_fractional and p_quantity<>trunc(p_quantity) then
    raise exception 'This product unit does not allow fractional quantity'
      using errcode='23514';
  end if;

  select sl.id into v_stock_location_id
  from public.stock_locations sl
  where sl.tenant_id=p_tenant_id
    and sl.branch_id=p_branch_id
    and sl.is_default=true
    and sl.is_active=true
  order by sl.created_at,sl.id
  limit 1;

  if v_stock_location_id is null then
    raise exception 'This branch has no active default stock location'
      using errcode='23514';
  end if;

  v_stock_quantity := round((p_quantity*v_conversion_factor)::numeric,6);
  if v_stock_quantity<=0 then
    raise exception 'Stock quantity must be greater than zero' using errcode='23514';
  end if;

  if v_operation='receive' then
    v_quantity_delta := v_stock_quantity;
    v_movement_type := 'purchase_receipt';
    v_reference_type := 'stock_receipt';
  else
    v_quantity_delta := case
      when v_direction='increase' then v_stock_quantity
      else -v_stock_quantity
    end;
    v_movement_type := 'adjustment';
    v_reference_type := 'stock_adjustment';
  end if;

  v_idempotency_key :=
    'inventory:' || v_operation || ':' || p_branch_id::text || ':' ||
    p_catalog_item_id::text || ':' || lower(v_reference);

  perform pg_catalog.pg_advisory_xact_lock(
    public.sellertray_inventory_lock_key(
      p_tenant_id,p_branch_id,v_stock_location_id,p_catalog_item_id
    )
  );

  select * into v_existing
  from public.inventory_movements im
  where im.tenant_id=p_tenant_id
    and im.idempotency_key=v_idempotency_key;

  if found then
    v_movement_id := public.record_sellertray_inventory_movement(
      p_tenant_id,
      p_branch_id,
      v_stock_location_id,
      p_catalog_item_id,
      v_movement_type,
      v_quantity_delta,
      v_source_uom,
      p_quantity,
      v_conversion_factor,
      v_reference_type,
      v_reference,
      v_idempotency_key,
      now(),
      p_actor_user_id,
      v_reason,
      jsonb_build_object('operation',v_operation,'adjustment_direction',nullif(v_direction,'')),
      null
    );
    v_replayed := true;
  else
    if v_quantity_delta<0 then
      select coalesce(sum(im.quantity_delta),0)::numeric(18,6)
      into v_on_hand
      from public.inventory_movements im
      where im.tenant_id=p_tenant_id
        and im.branch_id=p_branch_id
        and im.stock_location_id=v_stock_location_id
        and im.catalog_item_id=p_catalog_item_id;

      if v_on_hand+v_quantity_delta<0 then
        raise exception 'Not enough % stock: % % available',
          coalesce(v_product_name,'product'),v_on_hand,v_stock_uom
          using errcode='23514';
      end if;
    end if;

    v_movement_id := public.record_sellertray_inventory_movement(
      p_tenant_id,
      p_branch_id,
      v_stock_location_id,
      p_catalog_item_id,
      v_movement_type,
      v_quantity_delta,
      v_source_uom,
      p_quantity,
      v_conversion_factor,
      v_reference_type,
      v_reference,
      v_idempotency_key,
      now(),
      p_actor_user_id,
      v_reason,
      jsonb_build_object('operation',v_operation,'adjustment_direction',nullif(v_direction,'')),
      null
    );
  end if;

  select coalesce(sum(im.quantity_delta),0)::numeric(18,6)
  into v_on_hand
  from public.inventory_movements im
  where im.tenant_id=p_tenant_id
    and im.branch_id=p_branch_id
    and im.stock_location_id=v_stock_location_id
    and im.catalog_item_id=p_catalog_item_id;

  return jsonb_build_object(
    'movementId',v_movement_id,
    'operation',v_operation,
    'productId',p_catalog_item_id,
    'productName',v_product_name,
    'sourceUom',v_source_uom,
    'sourceQuantity',p_quantity,
    'conversionFactor',v_conversion_factor,
    'stockUom',v_stock_uom,
    'quantityDelta',v_quantity_delta,
    'quantityOnHand',v_on_hand,
    'reference',v_reference,
    'idempotentReplay',v_replayed
  );
end;
$$;

revoke all on function public.apply_sellertray_inventory_operation(
  uuid,uuid,uuid,uuid,text,numeric,text,text,text,uuid
) from public,anon,authenticated;
grant execute on function public.apply_sellertray_inventory_operation(
  uuid,uuid,uuid,uuid,text,numeric,text,text,text,uuid
) to service_role;

commit;