begin;

create table public.branch_inventory_policies (
  tenant_id uuid not null,
  branch_id uuid not null,
  catalog_item_id uuid not null,
  low_stock_threshold numeric(18,6) not null default 0
    check (low_stock_threshold>=0),
  reorder_target numeric(18,6)
    check (reorder_target is null or reorder_target>=0),
  updated_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id,branch_id,catalog_item_id),
  constraint branch_inventory_policies_branch_same_tenant
    foreign key (tenant_id,branch_id)
    references public.branches(tenant_id,id)
    on delete cascade,
  constraint branch_inventory_policies_item_same_tenant
    foreign key (tenant_id,catalog_item_id)
    references public.catalog_items(tenant_id,id)
    on delete cascade,
  constraint branch_inventory_policies_target_check
    check (reorder_target is null or reorder_target>=low_stock_threshold)
);

create index branch_inventory_policies_item_idx
  on public.branch_inventory_policies(tenant_id,catalog_item_id,branch_id);

alter table public.branch_inventory_policies enable row level security;
revoke all on public.branch_inventory_policies from public,anon,authenticated;
grant all on public.branch_inventory_policies to service_role;

create table public.branch_inventory_policy_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null,
  catalog_item_id uuid not null,
  previous_low_stock_threshold numeric(18,6),
  new_low_stock_threshold numeric(18,6),
  previous_reorder_target numeric(18,6),
  new_reorder_target numeric(18,6),
  actor_user_id uuid,
  created_at timestamptz not null default now(),
  constraint branch_inventory_policy_events_branch_same_tenant
    foreign key (tenant_id,branch_id)
    references public.branches(tenant_id,id)
    on delete cascade,
  constraint branch_inventory_policy_events_item_same_tenant
    foreign key (tenant_id,catalog_item_id)
    references public.catalog_items(tenant_id,id)
    on delete cascade
);

create index branch_inventory_policy_events_lookup_idx
  on public.branch_inventory_policy_events(
    tenant_id,branch_id,catalog_item_id,created_at desc
  );

alter table public.branch_inventory_policy_events enable row level security;
revoke all on public.branch_inventory_policy_events from public,anon,authenticated;
grant all on public.branch_inventory_policy_events to service_role;

create or replace function public.prevent_sellertray_inventory_policy_event_mutation()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if tg_op='DELETE'
     and not exists(select 1 from public.tenants t where t.id=old.tenant_id) then
    return old;
  end if;
  raise exception 'Inventory policy history is immutable'
    using errcode='55000';
end;
$$;

revoke all on function public.prevent_sellertray_inventory_policy_event_mutation()
  from public,anon,authenticated;

create trigger prevent_sellertray_inventory_policy_event_mutation
before update or delete on public.branch_inventory_policy_events
for each row execute function public.prevent_sellertray_inventory_policy_event_mutation();

create or replace function public.set_sellertray_low_stock_policy(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_catalog_item_id uuid,
  p_low_stock_threshold numeric,
  p_reorder_target numeric,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_role text;
  v_allow_fractional boolean;
  v_stock_uom text;
  v_previous public.branch_inventory_policies%rowtype;
  v_changed boolean := false;
begin
  if p_tenant_id is null or p_branch_id is null or p_catalog_item_id is null
     or p_actor_user_id is null or p_low_stock_threshold is null then
    raise exception 'Business, branch, product, threshold and operator are required'
      using errcode='22023';
  end if;
  if p_low_stock_threshold<0
     or (p_reorder_target is not null and p_reorder_target<p_low_stock_threshold) then
    raise exception 'Reorder target must be at least the low stock threshold'
      using errcode='22023';
  end if;

  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;
  if v_role not in ('owner','manager') then
    raise exception 'Only an Owner or Manager can change low stock policy'
      using errcode='42501';
  end if;

  if not public.sellertray_user_can_operate_branch(
    p_tenant_id,p_branch_id,p_actor_user_id
  ) then
    raise exception 'You do not have access to this branch' using errcode='42501';
  end if;

  select ci.allow_fractional_stock,ci.stock_uom
  into v_allow_fractional,v_stock_uom
  from public.catalog_items ci
  where ci.tenant_id=p_tenant_id and ci.id=p_catalog_item_id and ci.is_active=true;
  if not found then
    raise exception 'Product is unavailable for this business' using errcode='23514';
  end if;

  if not exists(
    select 1 from public.branches b
    where b.tenant_id=p_tenant_id and b.id=p_branch_id and b.is_active=true
  ) then
    raise exception 'Branch is unavailable for this business' using errcode='23514';
  end if;

  if not v_allow_fractional and (
    p_low_stock_threshold<>trunc(p_low_stock_threshold)
    or (p_reorder_target is not null and p_reorder_target<>trunc(p_reorder_target))
  ) then
    raise exception 'This product stock unit does not allow fractional policy quantities'
      using errcode='23514';
  end if;

  select * into v_previous
  from public.branch_inventory_policies p
  where p.tenant_id=p_tenant_id
    and p.branch_id=p_branch_id
    and p.catalog_item_id=p_catalog_item_id;

  if not found
     or v_previous.low_stock_threshold is distinct from p_low_stock_threshold
     or v_previous.reorder_target is distinct from p_reorder_target then
    v_changed:=true;
  end if;

  insert into public.branch_inventory_policies(
    tenant_id,branch_id,catalog_item_id,low_stock_threshold,reorder_target,
    updated_by_user_id,created_at,updated_at
  ) values(
    p_tenant_id,p_branch_id,p_catalog_item_id,p_low_stock_threshold,p_reorder_target,
    p_actor_user_id,now(),now()
  )
  on conflict(tenant_id,branch_id,catalog_item_id) do update
    set low_stock_threshold=excluded.low_stock_threshold,
        reorder_target=excluded.reorder_target,
        updated_by_user_id=excluded.updated_by_user_id,
        updated_at=now();

  if v_changed then
    insert into public.branch_inventory_policy_events(
      tenant_id,branch_id,catalog_item_id,
      previous_low_stock_threshold,new_low_stock_threshold,
      previous_reorder_target,new_reorder_target,actor_user_id
    ) values(
      p_tenant_id,p_branch_id,p_catalog_item_id,
      case when v_previous.tenant_id is null then 0 else v_previous.low_stock_threshold end,
      p_low_stock_threshold,
      v_previous.reorder_target,p_reorder_target,p_actor_user_id
    );
  end if;

  return jsonb_build_object(
    'productId',p_catalog_item_id,
    'branchId',p_branch_id,
    'stockUom',v_stock_uom,
    'lowStockThreshold',p_low_stock_threshold,
    'reorderTarget',p_reorder_target,
    'changed',v_changed
  );
end;
$$;

revoke all on function public.set_sellertray_low_stock_policy(
  uuid,uuid,uuid,numeric,numeric,uuid
) from public,anon,authenticated;
grant execute on function public.set_sellertray_low_stock_policy(
  uuid,uuid,uuid,numeric,numeric,uuid
) to service_role;

create or replace function public.get_sellertray_low_stock(
  p_tenant_id uuid,
  p_branch_id uuid
)
returns table(
  catalog_item_id uuid,
  item_name text,
  sku text,
  category text,
  stock_uom text,
  quantity_on_hand numeric,
  low_stock_threshold numeric,
  reorder_target numeric,
  suggested_reorder_quantity numeric,
  is_out_of_stock boolean
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
  if not public.sellertray_user_can_operate_branch(
    p_tenant_id,p_branch_id,v_user_id
  ) then
    raise exception 'You do not have access to this branch' using errcode='42501';
  end if;

  return query
  with balances as (
    select
      ci.id,
      ci.name,
      ci.sku,
      ci.category,
      ci.stock_uom,
      coalesce(sum(im.quantity_delta),0)::numeric(18,6) as quantity_on_hand,
      coalesce(p.low_stock_threshold,0)::numeric(18,6) as low_stock_threshold,
      p.reorder_target::numeric(18,6) as reorder_target
    from public.catalog_items ci
    left join public.inventory_movements im
      on im.tenant_id=ci.tenant_id
     and im.catalog_item_id=ci.id
     and im.branch_id=p_branch_id
    left join public.branch_inventory_policies p
      on p.tenant_id=ci.tenant_id
     and p.branch_id=p_branch_id
     and p.catalog_item_id=ci.id
    where ci.tenant_id=p_tenant_id
      and ci.is_active=true
      and exists(
        select 1 from public.branches b
        where b.tenant_id=p_tenant_id and b.id=p_branch_id and b.is_active=true
      )
    group by ci.id,ci.name,ci.sku,ci.category,ci.stock_uom,
      p.low_stock_threshold,p.reorder_target
  )
  select
    b.id,b.name,b.sku,b.category,b.stock_uom,
    b.quantity_on_hand,b.low_stock_threshold,b.reorder_target,
    case
      when b.reorder_target is null then null
      else greatest(b.reorder_target-b.quantity_on_hand,0)::numeric(18,6)
    end,
    b.quantity_on_hand<=0
  from balances b
  where b.quantity_on_hand<=b.low_stock_threshold
  order by
    (b.quantity_on_hand<=0) desc,
    (b.low_stock_threshold-b.quantity_on_hand) desc,
    b.name;
end;
$$;

revoke all on function public.get_sellertray_low_stock(uuid,uuid)
  from public,anon;
grant execute on function public.get_sellertray_low_stock(uuid,uuid)
  to authenticated;

commit;