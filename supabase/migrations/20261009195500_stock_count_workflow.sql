begin;

-- Stock count is a separate governed workflow. Capturing a physical count does
-- not change stock. Only an authorized apply step may post reconciliation
-- movements to the immutable Stock-UOM ledger.

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

  -- Managers can operate and approve counts by default, but an Owner can
  -- explicitly constrain either authority. Staff need explicit grants.
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

create table public.stock_counts (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null,
  stock_location_id uuid not null,
  reference text not null,
  status text not null default 'counting'
    check (status in ('counting','review','applied','cancelled')),
  started_by uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  review_started_by uuid references auth.users(id) on delete set null,
  review_started_at timestamptz,
  applied_by uuid references auth.users(id) on delete set null,
  applied_at timestamptz,
  apply_reason text,
  cancelled_by uuid references auth.users(id) on delete set null,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,reference),
  constraint stock_counts_branch_same_tenant
    foreign key (tenant_id,branch_id)
    references public.branches(tenant_id,id)
    on delete cascade,
  constraint stock_counts_location_same_branch
    foreign key (tenant_id,branch_id,stock_location_id)
    references public.stock_locations(tenant_id,branch_id,id)
    on delete cascade,
  constraint stock_counts_state_fields_check check (
    (status='counting'
      and review_started_at is null and applied_at is null and cancelled_at is null)
    or (status='review'
      and review_started_at is not null and applied_at is null and cancelled_at is null)
    or (status='applied'
      and review_started_at is not null and applied_at is not null
      and nullif(btrim(coalesce(apply_reason,'')),'') is not null
      and cancelled_at is null)
    or (status='cancelled'
      and cancelled_at is not null
      and nullif(btrim(coalesce(cancel_reason,'')),'') is not null
      and applied_at is null)
  )
);

create unique index stock_counts_one_active_per_branch
  on public.stock_counts(tenant_id,branch_id)
  where status in ('counting','review');
create index stock_counts_branch_started_idx
  on public.stock_counts(tenant_id,branch_id,started_at desc);

create table public.stock_count_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  stock_count_id uuid not null,
  catalog_item_id uuid not null,
  stock_uom text not null check (nullif(btrim(stock_uom),'') is not null),
  expected_quantity numeric(18,6) not null,
  counted_uom_id uuid,
  counted_uom text,
  counted_quantity numeric(18,6),
  counted_conversion_factor numeric(18,6),
  counted_stock_quantity numeric(18,6),
  captured_by uuid references auth.users(id) on delete set null,
  captured_at timestamptz,
  applied_movement_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,stock_count_id,catalog_item_id),
  constraint stock_count_items_count_same_tenant
    foreign key (tenant_id,stock_count_id)
    references public.stock_counts(tenant_id,id)
    on delete cascade,
  constraint stock_count_items_product_same_tenant
    foreign key (tenant_id,catalog_item_id)
    references public.catalog_items(tenant_id,id)
    on delete cascade,
  constraint stock_count_items_uom_same_tenant
    foreign key (tenant_id,catalog_item_id,counted_uom_id)
    references public.catalog_item_uoms(tenant_id,catalog_item_id,id)
    on delete restrict,
  constraint stock_count_items_movement_same_tenant
    foreign key (tenant_id,applied_movement_id)
    references public.inventory_movements(tenant_id,id)
    on delete restrict,
  constraint stock_count_items_expected_nonnegative check (expected_quantity>=0),
  constraint stock_count_items_capture_check check (
    (
      counted_uom_id is null
      and counted_uom is null
      and counted_quantity is null
      and counted_conversion_factor is null
      and counted_stock_quantity is null
      and captured_at is null
    )
    or (
      counted_uom_id is not null
      and nullif(btrim(coalesce(counted_uom,'')),'') is not null
      and counted_quantity is not null and counted_quantity>=0
      and counted_conversion_factor is not null and counted_conversion_factor>0
      and counted_stock_quantity is not null and counted_stock_quantity>=0
      and captured_at is not null
    )
  )
);

create index stock_count_items_count_idx
  on public.stock_count_items(tenant_id,stock_count_id,catalog_item_id);

alter table public.stock_counts enable row level security;
alter table public.stock_count_items enable row level security;
revoke all on public.stock_counts from public,anon,authenticated;
revoke all on public.stock_count_items from public,anon,authenticated;
grant all on public.stock_counts to service_role;
grant all on public.stock_count_items to service_role;

create or replace function public.prevent_sellertray_stock_count_delete()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if tg_op='DELETE'
     and not exists(select 1 from public.tenants t where t.id=old.tenant_id) then
    return old;
  end if;
  raise exception 'Stock count history is immutable while this business exists'
    using errcode='55000';
end;
$$;

revoke all on function public.prevent_sellertray_stock_count_delete()
  from public,anon,authenticated;

create trigger prevent_stock_counts_delete
before delete on public.stock_counts
for each row execute function public.prevent_sellertray_stock_count_delete();

create trigger prevent_stock_count_items_delete
before delete on public.stock_count_items
for each row execute function public.prevent_sellertray_stock_count_delete();

create or replace function public.get_sellertray_stock_count_capabilities(
  p_tenant_id uuid,
  p_branch_id uuid
)
returns table(
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

  return query select
    v_branch_allowed and public.sellertray_user_has_capability(
      p_tenant_id,v_user_id,'can_count_stock'
    ),
    v_branch_allowed and public.sellertray_user_has_capability(
      p_tenant_id,v_user_id,'can_apply_stock_count'
    );
end;
$$;

revoke all on function public.get_sellertray_stock_count_capabilities(uuid,uuid)
  from public,anon;
grant execute on function public.get_sellertray_stock_count_capabilities(uuid,uuid)
  to authenticated;

create or replace function public.start_sellertray_stock_count(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_count_id uuid := gen_random_uuid();
  v_location_id uuid;
  v_reference text;
  v_item_count integer;
begin
  if p_tenant_id is null or p_branch_id is null or p_actor_user_id is null then
    raise exception 'Business, branch and operator are required' using errcode='22023';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;
  if not public.sellertray_user_can_operate_branch(p_tenant_id,p_branch_id,p_actor_user_id) then
    raise exception 'You do not have access to count stock for this branch' using errcode='42501';
  end if;
  if not public.sellertray_user_has_capability(p_tenant_id,p_actor_user_id,'can_count_stock') then
    raise exception 'You do not have permission to count stock' using errcode='42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_tenant_id::text||':stock-count:'||p_branch_id::text,0)
  );

  if exists(
    select 1 from public.stock_counts sc
    where sc.tenant_id=p_tenant_id
      and sc.branch_id=p_branch_id
      and sc.status in ('counting','review')
  ) then
    raise exception 'This branch already has an active stock count' using errcode='23505';
  end if;

  select sl.id into v_location_id
  from public.stock_locations sl
  where sl.tenant_id=p_tenant_id
    and sl.branch_id=p_branch_id
    and sl.is_default=true
    and sl.is_active=true
  order by sl.created_at,sl.id
  limit 1;

  if v_location_id is null then
    raise exception 'This branch has no active default stock location' using errcode='23514';
  end if;

  v_reference := 'COUNT-'||upper(substr(replace(v_count_id::text,'-',''),1,10));

  insert into public.stock_counts(
    id,tenant_id,branch_id,stock_location_id,reference,status,started_by,started_at
  ) values(
    v_count_id,p_tenant_id,p_branch_id,v_location_id,v_reference,'counting',p_actor_user_id,now()
  );

  insert into public.stock_count_items(
    tenant_id,stock_count_id,catalog_item_id,stock_uom,expected_quantity
  )
  select
    p_tenant_id,
    v_count_id,
    ci.id,
    ci.stock_uom,
    coalesce((
      select sum(im.quantity_delta)
      from public.inventory_movements im
      where im.tenant_id=p_tenant_id
        and im.branch_id=p_branch_id
        and im.stock_location_id=v_location_id
        and im.catalog_item_id=ci.id
    ),0)::numeric(18,6)
  from public.catalog_items ci
  where ci.tenant_id=p_tenant_id
    and ci.is_active=true
  order by ci.name,ci.id;

  get diagnostics v_item_count = row_count;
  if v_item_count=0 then
    raise exception 'Add at least one active product before starting a stock count'
      using errcode='23514';
  end if;

  return jsonb_build_object(
    'countId',v_count_id,
    'reference',v_reference,
    'status','counting',
    'itemCount',v_item_count
  );
end;
$$;

revoke all on function public.start_sellertray_stock_count(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.start_sellertray_stock_count(uuid,uuid,uuid)
  to service_role;

create or replace function public.capture_sellertray_stock_count_item(
  p_tenant_id uuid,
  p_count_id uuid,
  p_catalog_item_id uuid,
  p_uom_id uuid,
  p_quantity numeric,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_count public.stock_counts%rowtype;
  v_product_name text;
  v_uom_name text;
  v_conversion numeric(18,6);
  v_allow_fractional boolean;
  v_stock_quantity numeric(18,6);
  v_captured integer;
  v_total integer;
begin
  if p_tenant_id is null or p_count_id is null or p_catalog_item_id is null
     or p_uom_id is null or p_actor_user_id is null or p_quantity is null or p_quantity<0 then
    raise exception 'Count, product, unit, quantity and operator are required'
      using errcode='22023';
  end if;

  select * into v_count
  from public.stock_counts sc
  where sc.tenant_id=p_tenant_id and sc.id=p_count_id
  for update;

  if not found then
    raise exception 'Stock count not found' using errcode='22023';
  end if;
  if v_count.status<>'counting' then
    raise exception 'This stock count is no longer accepting quantities' using errcode='23514';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;
  if not public.sellertray_user_can_operate_branch(
    p_tenant_id,v_count.branch_id,p_actor_user_id
  ) then
    raise exception 'You do not have access to count stock for this branch' using errcode='42501';
  end if;
  if not public.sellertray_user_has_capability(
    p_tenant_id,p_actor_user_id,'can_count_stock'
  ) then
    raise exception 'You do not have permission to count stock' using errcode='42501';
  end if;

  select ci.name,u.uom_name,u.conversion_factor,u.allow_fractional
  into v_product_name,v_uom_name,v_conversion,v_allow_fractional
  from public.catalog_items ci
  join public.catalog_item_uoms u
    on u.tenant_id=ci.tenant_id
   and u.catalog_item_id=ci.id
  where ci.tenant_id=p_tenant_id
    and ci.id=p_catalog_item_id
    and u.id=p_uom_id
    and ci.is_active=true;

  if not found then
    raise exception 'Product unit is unavailable for this business' using errcode='23514';
  end if;
  if not v_allow_fractional and p_quantity<>trunc(p_quantity) then
    raise exception 'This product unit does not allow fractional quantity'
      using errcode='23514';
  end if;

  if not exists(
    select 1 from public.stock_count_items sci
    where sci.tenant_id=p_tenant_id
      and sci.stock_count_id=p_count_id
      and sci.catalog_item_id=p_catalog_item_id
  ) then
    raise exception 'Product is not part of this stock count' using errcode='23514';
  end if;

  v_stock_quantity := round((p_quantity*v_conversion)::numeric,6);

  update public.stock_count_items
  set counted_uom_id=p_uom_id,
      counted_uom=v_uom_name,
      counted_quantity=p_quantity,
      counted_conversion_factor=v_conversion,
      counted_stock_quantity=v_stock_quantity,
      captured_by=p_actor_user_id,
      captured_at=now(),
      updated_at=now()
  where tenant_id=p_tenant_id
    and stock_count_id=p_count_id
    and catalog_item_id=p_catalog_item_id;

  select
    count(*) filter(where captured_at is not null)::integer,
    count(*)::integer
  into v_captured,v_total
  from public.stock_count_items sci
  where sci.tenant_id=p_tenant_id and sci.stock_count_id=p_count_id;

  -- Deliberately do not return expected quantity or variance while counting.
  return jsonb_build_object(
    'countId',p_count_id,
    'productId',p_catalog_item_id,
    'productName',v_product_name,
    'countedUom',v_uom_name,
    'countedQuantity',p_quantity,
    'countedStockQuantity',v_stock_quantity,
    'capturedItems',v_captured,
    'totalItems',v_total
  );
end;
$$;

revoke all on function public.capture_sellertray_stock_count_item(
  uuid,uuid,uuid,uuid,numeric,uuid
) from public,anon,authenticated;
grant execute on function public.capture_sellertray_stock_count_item(
  uuid,uuid,uuid,uuid,numeric,uuid
) to service_role;

create or replace function public.review_sellertray_stock_count(
  p_tenant_id uuid,
  p_count_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_count public.stock_counts%rowtype;
  v_missing integer;
begin
  select * into v_count
  from public.stock_counts sc
  where sc.tenant_id=p_tenant_id and sc.id=p_count_id
  for update;

  if not found then raise exception 'Stock count not found' using errcode='22023'; end if;
  if v_count.status='review' then
    return jsonb_build_object('countId',p_count_id,'status','review','idempotentReplay',true);
  end if;
  if v_count.status<>'counting' then
    raise exception 'Only an active stock count can move to review' using errcode='23514';
  end if;
  if not public.sellertray_user_can_operate_branch(
    p_tenant_id,v_count.branch_id,p_actor_user_id
  ) or not public.sellertray_user_has_capability(
    p_tenant_id,p_actor_user_id,'can_count_stock'
  ) then
    raise exception 'You do not have permission to review this stock count'
      using errcode='42501';
  end if;

  select count(*)::integer into v_missing
  from public.stock_count_items sci
  where sci.tenant_id=p_tenant_id
    and sci.stock_count_id=p_count_id
    and sci.captured_at is null;

  if v_missing>0 then
    raise exception '% product(s) still need a counted quantity',v_missing using errcode='23514';
  end if;

  update public.stock_counts
  set status='review',
      review_started_by=p_actor_user_id,
      review_started_at=now(),
      updated_at=now()
  where tenant_id=p_tenant_id and id=p_count_id;

  return jsonb_build_object('countId',p_count_id,'status','review','idempotentReplay',false);
end;
$$;

revoke all on function public.review_sellertray_stock_count(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.review_sellertray_stock_count(uuid,uuid,uuid)
  to service_role;

create or replace function public.cancel_sellertray_stock_count(
  p_tenant_id uuid,
  p_count_id uuid,
  p_actor_user_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_count public.stock_counts%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason,'')),'');
begin
  if v_reason is null then raise exception 'Cancellation reason is required' using errcode='22023'; end if;

  select * into v_count
  from public.stock_counts sc
  where sc.tenant_id=p_tenant_id and sc.id=p_count_id
  for update;

  if not found then raise exception 'Stock count not found' using errcode='22023'; end if;
  if v_count.status='cancelled' then
    return jsonb_build_object('countId',p_count_id,'status','cancelled','idempotentReplay',true);
  end if;
  if v_count.status='applied' then
    raise exception 'An applied stock count cannot be cancelled' using errcode='23514';
  end if;
  if not public.sellertray_user_can_operate_branch(
    p_tenant_id,v_count.branch_id,p_actor_user_id
  ) or not public.sellertray_user_has_capability(
    p_tenant_id,p_actor_user_id,'can_count_stock'
  ) then
    raise exception 'You do not have permission to cancel this stock count'
      using errcode='42501';
  end if;

  update public.stock_counts
  set status='cancelled',cancelled_by=p_actor_user_id,cancelled_at=now(),
      cancel_reason=left(v_reason,500),updated_at=now()
  where tenant_id=p_tenant_id and id=p_count_id;

  return jsonb_build_object('countId',p_count_id,'status','cancelled','idempotentReplay',false);
end;
$$;

revoke all on function public.cancel_sellertray_stock_count(uuid,uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.cancel_sellertray_stock_count(uuid,uuid,uuid,text)
  to service_role;

create or replace function public.apply_sellertray_stock_count(
  p_tenant_id uuid,
  p_count_id uuid,
  p_actor_user_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_count public.stock_counts%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason,'')),'');
  v_line record;
  v_current numeric(18,6);
  v_variance numeric(18,6);
  v_movement_id uuid;
  v_movement_count integer := 0;
  v_total_absolute_variance numeric(18,6) := 0;
begin
  if v_reason is null then raise exception 'Reconciliation reason is required' using errcode='22023'; end if;

  select * into v_count
  from public.stock_counts sc
  where sc.tenant_id=p_tenant_id and sc.id=p_count_id
  for update;

  if not found then raise exception 'Stock count not found' using errcode='22023'; end if;
  if v_count.status='applied' then
    select count(*)::integer,coalesce(sum(abs(im.quantity_delta)),0)::numeric(18,6)
    into v_movement_count,v_total_absolute_variance
    from public.inventory_movements im
    where im.tenant_id=p_tenant_id
      and im.reference_type='stock_count'
      and im.reference_id=v_count.reference;
    return jsonb_build_object(
      'countId',p_count_id,'reference',v_count.reference,'status','applied',
      'movementCount',v_movement_count,'totalAbsoluteVariance',v_total_absolute_variance,
      'idempotentReplay',true
    );
  end if;
  if v_count.status<>'review' then
    raise exception 'Review the completed count before applying it' using errcode='23514';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;
  if not public.sellertray_user_can_operate_branch(
    p_tenant_id,v_count.branch_id,p_actor_user_id
  ) then
    raise exception 'You do not have access to apply stock for this branch' using errcode='42501';
  end if;
  if not public.sellertray_user_has_capability(
    p_tenant_id,p_actor_user_id,'can_apply_stock_count'
  ) then
    raise exception 'You do not have permission to apply stock count variances'
      using errcode='42501';
  end if;

  -- Lock every counted stock position in deterministic product order before
  -- validating the snapshot. This prevents a sale/receipt/adjustment from
  -- interleaving between validation and reconciliation posting.
  for v_line in
    select sci.catalog_item_id
    from public.stock_count_items sci
    where sci.tenant_id=p_tenant_id and sci.stock_count_id=p_count_id
    order by sci.catalog_item_id
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      public.sellertray_inventory_lock_key(
        p_tenant_id,v_count.branch_id,v_count.stock_location_id,v_line.catalog_item_id
      )
    );
  end loop;

  -- Counts are blind snapshots. If stock changed after the count started,
  -- applying the old snapshot would create a false variance, so fail closed.
  for v_line in
    select sci.catalog_item_id,sci.expected_quantity
    from public.stock_count_items sci
    where sci.tenant_id=p_tenant_id and sci.stock_count_id=p_count_id
    order by sci.catalog_item_id
  loop
    select coalesce(sum(im.quantity_delta),0)::numeric(18,6)
    into v_current
    from public.inventory_movements im
    where im.tenant_id=p_tenant_id
      and im.branch_id=v_count.branch_id
      and im.stock_location_id=v_count.stock_location_id
      and im.catalog_item_id=v_line.catalog_item_id;

    if v_current is distinct from v_line.expected_quantity then
      raise exception 'Stock changed after this count started. Cancel it and start a new count before applying variances.'
        using errcode='40001';
    end if;
  end loop;

  for v_line in
    select
      sci.id,
      sci.catalog_item_id,
      sci.stock_uom,
      sci.expected_quantity,
      sci.counted_uom,
      sci.counted_quantity,
      sci.counted_conversion_factor,
      sci.counted_stock_quantity
    from public.stock_count_items sci
    where sci.tenant_id=p_tenant_id and sci.stock_count_id=p_count_id
    order by sci.catalog_item_id
  loop
    v_variance := round((v_line.counted_stock_quantity-v_line.expected_quantity)::numeric,6);
    v_total_absolute_variance := v_total_absolute_variance+abs(v_variance);

    if v_variance<>0 then
      v_movement_id := public.record_sellertray_inventory_movement(
        p_tenant_id,
        v_count.branch_id,
        v_count.stock_location_id,
        v_line.catalog_item_id,
        'count_reconciliation',
        v_variance,
        v_line.stock_uom,
        abs(v_variance),
        1,
        'stock_count',
        v_count.reference,
        'stock_count:'||p_count_id::text||':'||v_line.catalog_item_id::text,
        now(),
        p_actor_user_id,
        left(v_reason,500),
        jsonb_build_object(
          'stock_count_id',p_count_id,
          'expected_stock_quantity',v_line.expected_quantity,
          'counted_uom',v_line.counted_uom,
          'counted_quantity',v_line.counted_quantity,
          'counted_conversion_factor',v_line.counted_conversion_factor,
          'counted_stock_quantity',v_line.counted_stock_quantity
        ),
        null
      );

      update public.stock_count_items
      set applied_movement_id=v_movement_id,updated_at=now()
      where tenant_id=p_tenant_id and id=v_line.id;
      v_movement_count := v_movement_count+1;
    end if;
  end loop;

  update public.stock_counts
  set status='applied',applied_by=p_actor_user_id,applied_at=now(),
      apply_reason=left(v_reason,500),updated_at=now()
  where tenant_id=p_tenant_id and id=p_count_id;

  return jsonb_build_object(
    'countId',p_count_id,
    'reference',v_count.reference,
    'status','applied',
    'movementCount',v_movement_count,
    'totalAbsoluteVariance',v_total_absolute_variance,
    'idempotentReplay',false
  );
end;
$$;

revoke all on function public.apply_sellertray_stock_count(uuid,uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.apply_sellertray_stock_count(uuid,uuid,uuid,text)
  to service_role;

create or replace function public.get_sellertray_active_stock_count(
  p_tenant_id uuid,
  p_branch_id uuid
)
returns table(
  id uuid,
  reference text,
  status text,
  started_at timestamptz,
  review_started_at timestamptz,
  applied_at timestamptz,
  captured_items integer,
  total_items integer
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null or not public.sellertray_user_can_operate_branch(
    p_tenant_id,p_branch_id,v_user_id
  ) then
    raise exception 'You do not have access to this branch' using errcode='42501';
  end if;

  return query
  select
    sc.id,sc.reference,sc.status,sc.started_at,sc.review_started_at,sc.applied_at,
    count(sci.id) filter(where sci.captured_at is not null)::integer,
    count(sci.id)::integer
  from public.stock_counts sc
  join public.stock_count_items sci
    on sci.tenant_id=sc.tenant_id and sci.stock_count_id=sc.id
  where sc.tenant_id=p_tenant_id
    and sc.branch_id=p_branch_id
    and sc.status in ('counting','review')
  group by sc.id,sc.reference,sc.status,sc.started_at,sc.review_started_at,sc.applied_at
  order by sc.started_at desc
  limit 1;
end;
$$;

revoke all on function public.get_sellertray_active_stock_count(uuid,uuid)
  from public,anon;
grant execute on function public.get_sellertray_active_stock_count(uuid,uuid)
  to authenticated;

create or replace function public.get_sellertray_stock_count_capture_items(
  p_tenant_id uuid,
  p_count_id uuid
)
returns table(
  catalog_item_id uuid,
  item_name text,
  sku text,
  stock_uom text,
  counted_uom_id uuid,
  counted_uom text,
  counted_quantity numeric,
  counted_conversion_factor numeric,
  counted_stock_quantity numeric,
  captured_at timestamptz
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_count public.stock_counts%rowtype;
begin
  if v_user_id is null then raise exception 'SellerTray authentication required' using errcode='42501'; end if;
  select * into v_count from public.stock_counts sc
  where sc.tenant_id=p_tenant_id and sc.id=p_count_id;
  if not found then raise exception 'Stock count not found' using errcode='22023'; end if;
  if not public.sellertray_user_can_operate_branch(p_tenant_id,v_count.branch_id,v_user_id) then
    raise exception 'You do not have access to this stock count' using errcode='42501';
  end if;
  if v_count.status<>'counting' then
    raise exception 'This stock count is no longer in capture' using errcode='23514';
  end if;

  return query
  select
    sci.catalog_item_id,ci.name,ci.sku,sci.stock_uom,
    sci.counted_uom_id,sci.counted_uom,sci.counted_quantity,
    sci.counted_conversion_factor,sci.counted_stock_quantity,sci.captured_at
  from public.stock_count_items sci
  join public.catalog_items ci
    on ci.tenant_id=sci.tenant_id and ci.id=sci.catalog_item_id
  where sci.tenant_id=p_tenant_id and sci.stock_count_id=p_count_id
  order by ci.name,ci.id;
end;
$$;

revoke all on function public.get_sellertray_stock_count_capture_items(uuid,uuid)
  from public,anon;
grant execute on function public.get_sellertray_stock_count_capture_items(uuid,uuid)
  to authenticated;

create or replace function public.get_sellertray_stock_count_review_items(
  p_tenant_id uuid,
  p_count_id uuid
)
returns table(
  catalog_item_id uuid,
  item_name text,
  sku text,
  stock_uom text,
  expected_quantity numeric,
  counted_uom text,
  counted_quantity numeric,
  counted_stock_quantity numeric,
  variance_stock_quantity numeric,
  applied_movement_id uuid
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_count public.stock_counts%rowtype;
begin
  if v_user_id is null then raise exception 'SellerTray authentication required' using errcode='42501'; end if;
  select * into v_count from public.stock_counts sc
  where sc.tenant_id=p_tenant_id and sc.id=p_count_id;
  if not found then raise exception 'Stock count not found' using errcode='22023'; end if;
  if not public.sellertray_user_can_operate_branch(p_tenant_id,v_count.branch_id,v_user_id) then
    raise exception 'You do not have access to this stock count' using errcode='42501';
  end if;
  if v_count.status not in ('review','applied') then
    raise exception 'Variance is available only after capture is submitted for review'
      using errcode='23514';
  end if;

  return query
  select
    sci.catalog_item_id,ci.name,ci.sku,sci.stock_uom,
    sci.expected_quantity,sci.counted_uom,sci.counted_quantity,
    sci.counted_stock_quantity,
    round((sci.counted_stock_quantity-sci.expected_quantity)::numeric,6),
    sci.applied_movement_id
  from public.stock_count_items sci
  join public.catalog_items ci
    on ci.tenant_id=sci.tenant_id and ci.id=sci.catalog_item_id
  where sci.tenant_id=p_tenant_id and sci.stock_count_id=p_count_id
  order by ci.name,ci.id;
end;
$$;

revoke all on function public.get_sellertray_stock_count_review_items(uuid,uuid)
  from public,anon;
grant execute on function public.get_sellertray_stock_count_review_items(uuid,uuid)
  to authenticated;

commit;