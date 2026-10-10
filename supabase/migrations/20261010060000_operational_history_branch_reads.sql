begin;

-- Current stock is an operational snapshot and remains active-Branch-only.
-- Stock movement history is audit evidence and remains readable after Branch
-- deactivation for users who retain historical Branch read authority.
create or replace function public.get_sellertray_stock_movements(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_catalog_item_id uuid default null,
  p_limit integer default 100
)
returns table (
  id uuid,
  catalog_item_id uuid,
  item_name text,
  movement_type text,
  quantity_delta numeric,
  stock_uom text,
  source_uom text,
  source_quantity numeric,
  conversion_factor numeric,
  reference_type text,
  reference_id text,
  business_at timestamptz,
  reason text,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with branch_access as (
    select 1
    where current_user = 'postgres'
       or (select auth.role()) = 'service_role'
       or public.sellertray_user_can_read_branch(
         p_tenant_id,
         p_branch_id,
         (select auth.uid())
       )
  )
  select
    im.id,
    im.catalog_item_id,
    ci.name,
    im.movement_type,
    im.quantity_delta,
    im.stock_uom,
    im.source_uom,
    im.source_quantity,
    im.conversion_factor,
    im.reference_type,
    im.reference_id,
    im.business_at,
    im.reason,
    im.created_at
  from branch_access access
  cross join public.inventory_movements im
  join public.catalog_items ci
    on ci.tenant_id = im.tenant_id
   and ci.id = im.catalog_item_id
  where im.tenant_id = p_tenant_id
    and im.branch_id = p_branch_id
    and (p_catalog_item_id is null or im.catalog_item_id = p_catalog_item_id)
  order by im.business_at desc, im.created_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

revoke all on function public.get_sellertray_stock_movements(uuid, uuid, uuid, integer)
  from public, anon;
grant execute on function public.get_sellertray_stock_movements(uuid, uuid, uuid, integer)
  to authenticated, service_role;

-- A completed/cancelled count is historical evidence. The active-count lookup and
-- every count mutation remain tied to active Branch operation.
create or replace function public.get_sellertray_stock_count(
  p_tenant_id uuid,
  p_stock_count_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_count public.stock_counts%rowtype;
  v_items jsonb;
  v_total integer;
  v_captured integer;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;

  select * into v_count
  from public.stock_counts sc
  where sc.tenant_id=p_tenant_id and sc.id=p_stock_count_id;
  if not found then return null; end if;

  if not public.sellertray_user_can_read_branch(
    p_tenant_id,v_count.branch_id,v_user_id
  ) then
    raise exception 'You do not have access to this stock count'
      using errcode='42501';
  end if;
  if not (
    public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_count_stock')
    or public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_apply_stock_count')
  ) then
    raise exception 'You do not have permission to view stock counts'
      using errcode='42501';
  end if;

  select count(*)::integer,
         count(*) filter (where sci.is_captured)::integer,
         coalesce(
           jsonb_agg(
             jsonb_build_object(
               'itemId',sci.id,
               'productId',sci.catalog_item_id,
               'productName',sci.product_name,
               'stockUom',sci.stock_uom,
               'captured',sci.is_captured,
               'selectedUom',sci.selected_uom,
               'countedQuantity',sci.counted_quantity,
               'conversionFactor',sci.conversion_factor,
               'countedStockQuantity',sci.counted_stock_quantity,
               'expectedStockQuantity',case when v_count.status='counting' then null else sci.expected_stock_quantity end,
               'varianceQuantity',case when v_count.status='counting' then null else sci.variance_quantity end,
               'capturedAt',sci.captured_at
             ) order by sci.product_name,sci.catalog_item_id
           ),
           '[]'::jsonb
         )
  into v_total,v_captured,v_items
  from public.stock_count_items sci
  where sci.tenant_id=p_tenant_id and sci.stock_count_id=p_stock_count_id;

  return jsonb_build_object(
    'countId',v_count.id,
    'branchId',v_count.branch_id,
    'reference',v_count.reference,
    'reason',v_count.reason,
    'status',v_count.status,
    'startedAt',v_count.started_at,
    'submittedAt',v_count.submitted_at,
    'appliedAt',v_count.applied_at,
    'cancelledAt',v_count.cancelled_at,
    'cancelReason',v_count.cancel_reason,
    'totalItems',v_total,
    'capturedItems',v_captured,
    'items',v_items
  );
end;
$$;

revoke all on function public.get_sellertray_stock_count(uuid,uuid)
  from public,anon;
grant execute on function public.get_sellertray_stock_count(uuid,uuid)
  to authenticated;

-- Transfer history belongs to both source and destination Branches. Historical
-- readers of either Branch may review it, while create/dispatch/receive/cancel
-- remain active-Branch operations in their existing command functions.
create or replace function public.get_sellertray_stock_transfer(
  p_tenant_id uuid,
  p_stock_transfer_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_transfer public.stock_transfers%rowtype;
  v_source_name text;
  v_destination_name text;
  v_items jsonb;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;

  select * into v_transfer
  from public.stock_transfers st
  where st.tenant_id=p_tenant_id and st.id=p_stock_transfer_id;
  if not found then return null; end if;

  if not (
    public.sellertray_user_can_read_branch(p_tenant_id,v_transfer.source_branch_id,v_user_id)
    or public.sellertray_user_can_read_branch(p_tenant_id,v_transfer.destination_branch_id,v_user_id)
  ) then
    raise exception 'You do not have access to this stock transfer'
      using errcode='42501';
  end if;

  select b.name into v_source_name from public.branches b
  where b.tenant_id=p_tenant_id and b.id=v_transfer.source_branch_id;
  select b.name into v_destination_name from public.branches b
  where b.tenant_id=p_tenant_id and b.id=v_transfer.destination_branch_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'itemId',sti.id,
      'productId',sti.catalog_item_id,
      'productName',sti.product_name,
      'stockUom',sti.stock_uom,
      'selectedUom',sti.selected_uom,
      'quantity',sti.transfer_quantity,
      'conversionFactor',sti.conversion_factor,
      'stockQuantity',sti.stock_quantity
    ) order by sti.product_name,sti.catalog_item_id
  ),'[]'::jsonb)
  into v_items
  from public.stock_transfer_items sti
  where sti.tenant_id=p_tenant_id and sti.stock_transfer_id=p_stock_transfer_id;

  return jsonb_build_object(
    'transferId',v_transfer.id,
    'reference',v_transfer.reference,
    'reason',v_transfer.reason,
    'status',v_transfer.status,
    'sourceBranchId',v_transfer.source_branch_id,
    'sourceBranchName',v_source_name,
    'destinationBranchId',v_transfer.destination_branch_id,
    'destinationBranchName',v_destination_name,
    'createdAt',v_transfer.created_at,
    'dispatchedAt',v_transfer.dispatched_at,
    'receivedAt',v_transfer.received_at,
    'cancelledAt',v_transfer.cancelled_at,
    'cancelReason',v_transfer.cancel_reason,
    'items',v_items
  );
end;
$$;

revoke all on function public.get_sellertray_stock_transfer(uuid,uuid)
  from public,anon;
grant execute on function public.get_sellertray_stock_transfer(uuid,uuid)
  to authenticated;

create or replace function public.get_sellertray_stock_transfers(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_limit integer default 50
)
returns table(
  id uuid,
  reference text,
  status text,
  source_branch_id uuid,
  source_branch_name text,
  destination_branch_id uuid,
  destination_branch_name text,
  item_count integer,
  created_at timestamptz,
  dispatched_at timestamptz,
  received_at timestamptz
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_limit integer := greatest(1,least(coalesce(p_limit,50),100));
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if not public.sellertray_user_can_read_branch(p_tenant_id,p_branch_id,v_user_id) then
    raise exception 'You do not have access to this branch' using errcode='42501';
  end if;

  return query
  select
    st.id,st.reference,st.status,
    st.source_branch_id,sb.name,
    st.destination_branch_id,db.name,
    (select count(*)::integer from public.stock_transfer_items sti
      where sti.tenant_id=st.tenant_id and sti.stock_transfer_id=st.id),
    st.created_at,st.dispatched_at,st.received_at
  from public.stock_transfers st
  join public.branches sb on sb.tenant_id=st.tenant_id and sb.id=st.source_branch_id
  join public.branches db on db.tenant_id=st.tenant_id and db.id=st.destination_branch_id
  where st.tenant_id=p_tenant_id
    and (st.source_branch_id=p_branch_id or st.destination_branch_id=p_branch_id)
  order by st.created_at desc,st.id desc
  limit v_limit;
end;
$$;

revoke all on function public.get_sellertray_stock_transfers(uuid,uuid,integer)
  from public,anon;
grant execute on function public.get_sellertray_stock_transfers(uuid,uuid,integer)
  to authenticated;

-- Shift history remains visible for audit after Branch deactivation. Opening a
-- shift, drawer movement, expense, close and review remain active-Branch-only.
create or replace function public.get_sellertray_cash_shift_history(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_limit integer default 50
)
returns table(
  shift_id uuid,
  register_id uuid,
  register_name text,
  status text,
  currency text,
  opening_cash numeric,
  expected_cash numeric,
  declared_cash numeric,
  variance numeric,
  opened_by_user_id uuid,
  opened_at timestamptz,
  closed_at timestamptz,
  review_decision text,
  reviewed_at timestamptz
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_role text;
  v_limit integer := least(greatest(coalesce(p_limit,50),1),100);
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if not public.sellertray_user_can_read_branch(p_tenant_id,p_branch_id,v_user_id) then
    raise exception 'You do not have access to cashier shifts in this branch' using errcode='42501';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;
  if v_role is null then
    raise exception 'SellerTray tenant membership required' using errcode='42501';
  end if;

  return query
  select
    s.id,
    s.register_id,
    r.name,
    s.status,
    s.currency,
    s.opening_cash,
    case when s.status='open'
      then (select t.expected_cash from public.sellertray_cash_shift_totals(s.tenant_id,s.id) t)
      else s.expected_cash
    end,
    s.declared_cash,
    s.variance,
    s.opened_by_user_id,
    s.opened_at,
    s.closed_at,
    s.review_decision,
    s.reviewed_at
  from public.sellertray_cash_shifts s
  join public.sellertray_registers r
    on r.tenant_id=s.tenant_id and r.id=s.register_id
  where s.tenant_id=p_tenant_id
    and s.branch_id=p_branch_id
    and (v_role in ('owner','manager') or s.opened_by_user_id=v_user_id)
  order by s.opened_at desc,s.id desc
  limit v_limit;
end;
$$;

revoke all on function public.get_sellertray_cash_shift_history(uuid,uuid,integer)
  from public,anon;
grant execute on function public.get_sellertray_cash_shift_history(uuid,uuid,integer)
  to authenticated;

commit;
