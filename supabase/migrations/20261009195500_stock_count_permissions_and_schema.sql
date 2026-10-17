begin;

alter table public.tenant_member_capabilities
  drop constraint if exists tenant_member_capabilities_capability_check,
  add constraint tenant_member_capabilities_capability_check
    check (capability in (
      'can_receive_stock',
      'can_adjust_stock',
      'can_count_stock',
      'can_apply_stock_count'
    ));

alter table public.tenant_member_capability_events
  drop constraint if exists tenant_member_capability_events_capability_check,
  add constraint tenant_member_capability_events_capability_check
    check (capability in (
      'can_receive_stock',
      'can_adjust_stock',
      'can_count_stock',
      'can_apply_stock_count'
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
       'can_apply_stock_count'
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
    'can_apply_stock_count'
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
  can_apply_stock_count boolean
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
    );
end;
$$;

revoke all on function public.get_sellertray_inventory_capabilities(uuid,uuid)
  from public,anon;
grant execute on function public.get_sellertray_inventory_capabilities(uuid,uuid)
  to authenticated;

create table public.stock_counts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null,
  stock_location_id uuid not null,
  reference text not null check (char_length(btrim(reference)) between 1 and 160),
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  status text not null default 'counting'
    check (status in ('counting','review','applied','cancelled')),
  started_by_user_id uuid references auth.users(id) on delete set null,
  submitted_by_user_id uuid references auth.users(id) on delete set null,
  applied_by_user_id uuid references auth.users(id) on delete set null,
  cancelled_by_user_id uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  applied_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id,id),
  constraint stock_counts_branch_same_tenant
    foreign key (tenant_id,branch_id)
    references public.branches(tenant_id,id)
    on delete cascade,
  constraint stock_counts_location_same_branch
    foreign key (tenant_id,branch_id,stock_location_id)
    references public.stock_locations(tenant_id,branch_id,id)
    on delete cascade,
  constraint stock_counts_cancel_reason_check
    check (
      (status='cancelled' and char_length(btrim(coalesce(cancel_reason,''))) between 1 and 500)
      or (status<>'cancelled' and cancel_reason is null)
    ),
  constraint stock_counts_state_timestamps_check
    check (
      (status='counting' and submitted_at is null and applied_at is null and cancelled_at is null)
      or (status='review' and submitted_at is not null and applied_at is null and cancelled_at is null)
      or (status='applied' and submitted_at is not null and applied_at is not null and cancelled_at is null)
      or (status='cancelled' and applied_at is null and cancelled_at is not null)
    )
);

create unique index stock_counts_reference_unique
  on public.stock_counts(tenant_id,branch_id,lower(btrim(reference)));
create unique index stock_counts_one_active_per_location
  on public.stock_counts(tenant_id,stock_location_id)
  where status in ('counting','review');
create index stock_counts_branch_status_started_idx
  on public.stock_counts(tenant_id,branch_id,status,started_at desc);

create table public.stock_count_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  stock_count_id uuid not null,
  catalog_item_id uuid not null,
  product_name text not null check (nullif(btrim(product_name),'') is not null),
  stock_uom text not null check (nullif(btrim(stock_uom),'') is not null),
  is_captured boolean not null default false,
  selected_uom text,
  counted_quantity numeric(18,6),
  conversion_factor numeric(18,6),
  counted_stock_quantity numeric(18,6),
  expected_stock_quantity numeric(18,6),
  variance_quantity numeric(18,6),
  captured_by_user_id uuid references auth.users(id) on delete set null,
  captured_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,stock_count_id,catalog_item_id),
  constraint stock_count_items_count_same_tenant
    foreign key (tenant_id,stock_count_id)
    references public.stock_counts(tenant_id,id)
    on delete cascade,
  constraint stock_count_items_capture_check
    check (
      (
        is_captured
        and selected_uom is not null
        and counted_quantity is not null and counted_quantity>=0
        and conversion_factor is not null and conversion_factor>0
        and counted_stock_quantity is not null and counted_stock_quantity>=0
        and expected_stock_quantity is not null
        and variance_quantity is not null
        and captured_by_user_id is not null
        and captured_at is not null
      )
      or (
        not is_captured
        and selected_uom is null
        and counted_quantity is null
        and conversion_factor is null
        and counted_stock_quantity is null
        and expected_stock_quantity is null
        and variance_quantity is null
        and captured_by_user_id is null
        and captured_at is null
      )
    )
);

create index stock_count_items_count_capture_idx
  on public.stock_count_items(tenant_id,stock_count_id,is_captured,product_name);

alter table public.stock_counts enable row level security;
alter table public.stock_count_items enable row level security;
revoke all on table public.stock_counts from public,anon,authenticated;
revoke all on table public.stock_count_items from public,anon,authenticated;
grant all on table public.stock_counts to service_role;
grant all on table public.stock_count_items to service_role;

commit;