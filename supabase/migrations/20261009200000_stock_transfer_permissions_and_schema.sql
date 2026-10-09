begin;

alter table public.tenant_member_capabilities
  drop constraint if exists tenant_member_capabilities_capability_check,
  add constraint tenant_member_capabilities_capability_check
    check (capability in (
      'can_receive_stock',
      'can_adjust_stock',
      'can_count_stock',
      'can_apply_stock_count',
      'can_transfer_stock'
    ));

alter table public.tenant_member_capability_events
  drop constraint if exists tenant_member_capability_events_capability_check,
  add constraint tenant_member_capability_events_capability_check
    check (capability in (
      'can_receive_stock',
      'can_adjust_stock',
      'can_count_stock',
      'can_apply_stock_count',
      'can_transfer_stock'
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
       'can_receive_stock',
       'can_adjust_stock',
       'can_count_stock',
       'can_apply_stock_count',
       'can_transfer_stock'
     ) then
    return false;
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id
    and tm.user_id=p_user_id;

  if v_role is null then
    return false;
  end if;

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
  if p_tenant_id is null or p_target_user_id is null or p_actor_user_id is null
     or p_allowed is null then
    raise exception 'Business, staff member, permission and decision are required'
      using errcode='22023';
  end if;

  if v_capability not in (
    'can_receive_stock',
    'can_adjust_stock',
    'can_count_stock',
    'can_apply_stock_count',
    'can_transfer_stock'
  ) then
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

  v_previous_effective := public.sellertray_user_has_capability(
    p_tenant_id,p_target_user_id,v_capability
  );

  select c.allowed into v_previous_override
  from public.tenant_member_capabilities c
  where c.tenant_id=p_tenant_id
    and c.user_id=p_target_user_id
    and c.capability=v_capability;

  if not found or v_previous_override is distinct from p_allowed then
    v_changed := true;
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

  if v_changed then
    insert into public.tenant_member_capability_events(
      tenant_id,user_id,capability,previous_allowed,new_allowed,actor_user_id
    ) values(
      p_tenant_id,p_target_user_id,v_capability,
      v_previous_effective,p_allowed,p_actor_user_id
    );
  end if;

  return p_allowed;
end;
$$;

revoke all on function public.set_sellertray_member_capability(uuid,uuid,text,boolean,uuid)
  from public,anon,authenticated;
grant execute on function public.set_sellertray_member_capability(uuid,uuid,text,boolean,uuid)
  to service_role;

drop function if exists public.get_sellertray_inventory_capabilities(uuid,uuid);
create function public.get_sellertray_inventory_capabilities(
  p_tenant_id uuid,
  p_branch_id uuid
)
returns table (
  can_receive_stock boolean,
  can_adjust_stock boolean,
  can_count_stock boolean,
  can_apply_stock_count boolean,
  can_transfer_stock boolean
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
    ),
    v_branch_allowed and public.sellertray_user_has_capability(
      p_tenant_id,v_user_id,'can_count_stock'
    ),
    v_branch_allowed and public.sellertray_user_has_capability(
      p_tenant_id,v_user_id,'can_apply_stock_count'
    ),
    v_branch_allowed and public.sellertray_user_has_capability(
      p_tenant_id,v_user_id,'can_transfer_stock'
    );
end;
$$;

revoke all on function public.get_sellertray_inventory_capabilities(uuid,uuid)
  from public,anon;
grant execute on function public.get_sellertray_inventory_capabilities(uuid,uuid)
  to authenticated;

create table public.stock_transfers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source_branch_id uuid not null,
  source_stock_location_id uuid not null,
  destination_branch_id uuid not null,
  destination_stock_location_id uuid not null,
  reference text not null check (char_length(btrim(reference)) between 1 and 160),
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  status text not null default 'draft'
    check (status in ('draft','dispatched','received','cancelled')),
  created_by_user_id uuid,
  dispatched_by_user_id uuid,
  received_by_user_id uuid,
  cancelled_by_user_id uuid,
  created_at timestamptz not null default now(),
  dispatched_at timestamptz,
  received_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  updated_at timestamptz not null default now(),
  unique (tenant_id,id),
  constraint stock_transfers_distinct_branches_check
    check (source_branch_id<>destination_branch_id),
  constraint stock_transfers_source_branch_same_tenant
    foreign key (tenant_id,source_branch_id)
    references public.branches(tenant_id,id)
    on delete cascade,
  constraint stock_transfers_destination_branch_same_tenant
    foreign key (tenant_id,destination_branch_id)
    references public.branches(tenant_id,id)
    on delete cascade,
  constraint stock_transfers_source_location_same_branch
    foreign key (tenant_id,source_branch_id,source_stock_location_id)
    references public.stock_locations(tenant_id,branch_id,id)
    on delete cascade,
  constraint stock_transfers_destination_location_same_branch
    foreign key (tenant_id,destination_branch_id,destination_stock_location_id)
    references public.stock_locations(tenant_id,branch_id,id)
    on delete cascade,
  constraint stock_transfers_cancel_reason_check
    check (
      (status='cancelled' and char_length(btrim(coalesce(cancel_reason,''))) between 1 and 500)
      or (status<>'cancelled' and cancel_reason is null)
    ),
  constraint stock_transfers_state_check
    check (
      (status='draft' and dispatched_at is null and received_at is null and cancelled_at is null)
      or (status='dispatched' and dispatched_at is not null and received_at is null and cancelled_at is null)
      or (status='received' and dispatched_at is not null and received_at is not null and cancelled_at is null)
      or (status='cancelled' and dispatched_at is null and received_at is null and cancelled_at is not null)
    )
);

create unique index stock_transfers_reference_unique
  on public.stock_transfers(tenant_id,lower(btrim(reference)));
create index stock_transfers_source_status_created_idx
  on public.stock_transfers(tenant_id,source_branch_id,status,created_at desc);
create index stock_transfers_destination_status_created_idx
  on public.stock_transfers(tenant_id,destination_branch_id,status,created_at desc);

create table public.stock_transfer_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  stock_transfer_id uuid not null,
  catalog_item_id uuid not null,
  product_name text not null check (nullif(btrim(product_name),'') is not null),
  stock_uom text not null check (nullif(btrim(stock_uom),'') is not null),
  selected_uom text not null check (nullif(btrim(selected_uom),'') is not null),
  transfer_quantity numeric(18,6) not null check (transfer_quantity>0),
  conversion_factor numeric(18,6) not null check (conversion_factor>0),
  stock_quantity numeric(18,6) not null check (stock_quantity>0),
  created_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,stock_transfer_id,catalog_item_id),
  constraint stock_transfer_items_transfer_same_tenant
    foreign key (tenant_id,stock_transfer_id)
    references public.stock_transfers(tenant_id,id)
    on delete cascade,
  constraint stock_transfer_items_product_same_tenant
    foreign key (tenant_id,catalog_item_id)
    references public.catalog_items(tenant_id,id)
    on delete cascade
);

create index stock_transfer_items_transfer_idx
  on public.stock_transfer_items(tenant_id,stock_transfer_id,catalog_item_id);

alter table public.stock_transfers enable row level security;
alter table public.stock_transfer_items enable row level security;
revoke all on public.stock_transfers from public,anon,authenticated;
revoke all on public.stock_transfer_items from public,anon,authenticated;
grant all on public.stock_transfers to service_role;
grant all on public.stock_transfer_items to service_role;

commit;