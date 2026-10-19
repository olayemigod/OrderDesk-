begin;

create or replace function public.get_sellertray_inventory_management_stock(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_search text default null,
  p_stock_state text default 'all',
  p_valuation_state text default 'all',
  p_as_of timestamptz default now(),
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_search text := nullif(btrim(coalesce(p_search,'')),'');
  v_stock_state text := lower(btrim(coalesce(p_stock_state,'all')));
  v_valuation_state text := lower(btrim(coalesce(p_valuation_state,'all')));
  v_limit integer := greatest(1,least(coalesce(p_limit,50),100));
  v_offset integer := greatest(coalesce(p_offset,0),0);
  v_currency text;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if p_tenant_id is null or p_branch_id is null or p_as_of is null then
    raise exception 'Business, Branch and as-of time are required' using errcode='22023';
  end if;
  if not exists(select 1 from public.branches b where b.tenant_id=p_tenant_id and b.id=p_branch_id) then
    raise exception 'Branch not found' using errcode='P0002';
  end if;
  if not public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_view_reports') then
    raise exception 'You do not have permission to view inventory management' using errcode='42501';
  end if;
  if not public.sellertray_user_can_read_report_branch(p_tenant_id,p_branch_id,v_user_id) then
    raise exception 'You do not have access to inventory reporting for this Branch' using errcode='42501';
  end if;
  if v_stock_state='' then v_stock_state:='all'; end if;
  if v_stock_state not in ('all','in_stock','low_stock','out_of_stock') then
    raise exception 'Unsupported stock state' using errcode='22023';
  end if;
  if v_valuation_state='' then v_valuation_state:='all'; end if;
  if v_valuation_state not in ('all','valued','partial','unvalued','empty') then
    raise exception 'Unsupported valuation state' using errcode='22023';
  end if;

  select upper(t.currency) into v_currency
  from public.tenants t where t.id=p_tenant_id;
  if v_currency is null then
    raise exception 'Business not found' using errcode='P0002';
  end if;

  with quantity_snapshot as materialized (
    select *
    from public.get_sellertray_branch_stock_as_of(p_tenant_id,p_branch_id,p_as_of)
  ),
  valuation_snapshot as materialized (
    select *
    from public.get_sellertray_branch_stock_valuation(p_tenant_id,p_branch_id,p_as_of)
  ),
  base_filtered as materialized (
    select
      q.catalog_item_id,
      q.item_name,
      q.sku,
      q.category,
      q.stock_uom,
      coalesce(v.currency,v_currency) as currency,
      q.quantity_on_hand::numeric as quantity_on_hand,
      coalesce(v.valued_quantity_on_hand,0)::numeric as valued_quantity_on_hand,
      case
        when v.catalog_item_id is null and q.quantity_on_hand>0 then q.quantity_on_hand
        else coalesce(v.unvalued_quantity_on_hand,0)
      end::numeric as unvalued_quantity_on_hand,
      coalesce(v.known_inventory_value,0)::numeric as known_inventory_value,
      v.average_unit_cost::numeric as average_unit_cost,
      case
        when v.catalog_item_id is not null then v.valuation_status
        when abs(q.quantity_on_hand)<=0.000001 then 'empty'
        else 'unvalued'
      end as valuation_status,
      coalesce(p.low_stock_threshold,0)::numeric as low_stock_threshold,
      p.reorder_target::numeric as reorder_target,
      (q.quantity_on_hand<=coalesce(p.low_stock_threshold,0)) as is_low_stock,
      (q.quantity_on_hand<=0) as is_out_of_stock,
      coalesce(v.last_movement_at,q.last_movement_at) as last_movement_at
    from quantity_snapshot q
    left join valuation_snapshot v on v.catalog_item_id=q.catalog_item_id
    left join public.branch_inventory_policies p
      on p.tenant_id=p_tenant_id
     and p.branch_id=p_branch_id
     and p.catalog_item_id=q.catalog_item_id
    where v_search is null
       or lower(q.item_name) like '%'||lower(v_search)||'%'
       or lower(coalesce(q.sku,'')) like '%'||lower(v_search)||'%'
       or lower(coalesce(q.category,'')) like '%'||lower(v_search)||'%'
       or lower(q.stock_uom) like '%'||lower(v_search)||'%'
  ),
  filtered as materialized (
    select * from base_filtered x
    where (
      v_stock_state='all'
      or (v_stock_state='in_stock' and x.quantity_on_hand>0)
      or (v_stock_state='low_stock' and x.is_low_stock)
      or (v_stock_state='out_of_stock' and x.is_out_of_stock)
    )
    and (v_valuation_state='all' or x.valuation_status=v_valuation_state)
  ),
  paged as (
    select * from filtered
    order by lower(item_name),catalog_item_id
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'items',coalesce((
      select jsonb_agg(jsonb_build_object(
        'catalogItemId',x.catalog_item_id,
        'itemName',x.item_name,
        'sku',x.sku,
        'category',x.category,
        'stockUom',x.stock_uom,
        'currency',x.currency,
        'quantityOnHand',x.quantity_on_hand,
        'valuedQuantityOnHand',x.valued_quantity_on_hand,
        'unvaluedQuantityOnHand',x.unvalued_quantity_on_hand,
        'knownInventoryValue',x.known_inventory_value,
        'averageUnitCost',x.average_unit_cost,
        'valuationStatus',x.valuation_status,
        'lowStockThreshold',x.low_stock_threshold,
        'reorderTarget',x.reorder_target,
        'suggestedReorderQuantity',case when x.reorder_target is null then null else greatest(x.reorder_target-x.quantity_on_hand,0) end,
        'isLowStock',x.is_low_stock,
        'isOutOfStock',x.is_out_of_stock,
        'lastMovementAt',x.last_movement_at
      ) order by lower(x.item_name),x.catalog_item_id)
      from paged x
    ),'[]'::jsonb),
    'totalCount',(select count(*) from filtered),
    'lowStockCount',(select count(*) from filtered where is_low_stock),
    'outOfStockCount',(select count(*) from filtered where is_out_of_stock),
    'valuedCount',(select count(*) from filtered where valuation_status='valued'),
    'partialValuationCount',(select count(*) from filtered where valuation_status='partial'),
    'unvaluedCount',(select count(*) from filtered where valuation_status='unvalued'),
    'emptyCount',(select count(*) from filtered where valuation_status='empty'),
    'knownInventoryValue',coalesce((select sum(known_inventory_value) from filtered),0),
    'currency',v_currency,
    'asOf',p_as_of,
    'limit',v_limit,
    'offset',v_offset
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.get_sellertray_inventory_management_movements(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_search text default null,
  p_movement_type text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_search text := nullif(btrim(coalesce(p_search,'')),'');
  v_movement_type text := nullif(lower(btrim(coalesce(p_movement_type,''))),'');
  v_limit integer := greatest(1,least(coalesce(p_limit,50),100));
  v_offset integer := greatest(coalesce(p_offset,0),0);
  v_timezone text;
  v_currency text;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if p_tenant_id is null or p_branch_id is null then
    raise exception 'Business and Branch are required' using errcode='22023';
  end if;
  if not exists(select 1 from public.branches b where b.tenant_id=p_tenant_id and b.id=p_branch_id) then
    raise exception 'Branch not found' using errcode='P0002';
  end if;
  if not public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_view_reports') then
    raise exception 'You do not have permission to view inventory management' using errcode='42501';
  end if;
  if not public.sellertray_user_can_read_report_branch(p_tenant_id,p_branch_id,v_user_id) then
    raise exception 'You do not have access to inventory reporting for this Branch' using errcode='42501';
  end if;
  if v_movement_type='all' then v_movement_type:=null; end if;
  if v_movement_type is not null and v_movement_type not in (
    'opening','sale','sale_return','purchase_receipt','adjustment','count_reconciliation',
    'transfer_out','transfer_in','damaged','expired','reversal'
  ) then
    raise exception 'Unsupported inventory movement type' using errcode='22023';
  end if;
  if p_date_from is not null and p_date_to is not null and p_date_from>p_date_to then
    raise exception 'Inventory movement date range is invalid' using errcode='22023';
  end if;

  select coalesce(nullif(t.timezone,''),'Africa/Lagos'),upper(t.currency)
  into v_timezone,v_currency
  from public.tenants t where t.id=p_tenant_id;
  if v_timezone is null then
    raise exception 'Business not found' using errcode='P0002';
  end if;
  if p_date_from is not null then v_start_at:=p_date_from::timestamp at time zone v_timezone; end if;
  if p_date_to is not null then v_end_at:=(p_date_to+1)::timestamp at time zone v_timezone; end if;

  with filtered as materialized (
    select
      im.id,
      im.catalog_item_id,
      ci.name as item_name,
      ci.sku,
      ci.category,
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
      im.created_at,
      coalesce(ve.currency,v_currency) as currency,
      ve.known_unit_cost,
      ve.value_delta,
      ve.cogs_amount,
      ve.cogs_complete,
      coalesce(ve.valuation_status,'unvalued') as valuation_status,
      coalesce(ve.valuation_source,'valuation_unavailable') as valuation_source
    from public.inventory_movements im
    join public.catalog_items ci on ci.tenant_id=im.tenant_id and ci.id=im.catalog_item_id
    left join public.sellertray_inventory_valuation_entries ve on ve.movement_id=im.id
    where im.tenant_id=p_tenant_id
      and im.branch_id=p_branch_id
      and (v_movement_type is null or im.movement_type=v_movement_type)
      and (v_start_at is null or im.business_at>=v_start_at)
      and (v_end_at is null or im.business_at<v_end_at)
      and (
        v_search is null
        or lower(ci.name) like '%'||lower(v_search)||'%'
        or lower(coalesce(ci.sku,'')) like '%'||lower(v_search)||'%'
        or lower(coalesce(ci.category,'')) like '%'||lower(v_search)||'%'
        or lower(im.movement_type) like '%'||lower(v_search)||'%'
        or lower(im.reference_type) like '%'||lower(v_search)||'%'
        or lower(im.reference_id) like '%'||lower(v_search)||'%'
        or lower(coalesce(im.reason,'')) like '%'||lower(v_search)||'%'
      )
  ),
  paged as (
    select * from filtered
    order by business_at desc,created_at desc,id desc
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'items',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',x.id,
        'catalogItemId',x.catalog_item_id,
        'itemName',x.item_name,
        'sku',x.sku,
        'category',x.category,
        'movementType',x.movement_type,
        'quantityDelta',x.quantity_delta,
        'stockUom',x.stock_uom,
        'sourceUom',x.source_uom,
        'sourceQuantity',x.source_quantity,
        'conversionFactor',x.conversion_factor,
        'referenceType',x.reference_type,
        'referenceId',x.reference_id,
        'businessAt',x.business_at,
        'reason',x.reason,
        'createdAt',x.created_at,
        'currency',x.currency,
        'knownUnitCost',x.known_unit_cost,
        'valueDelta',x.value_delta,
        'cogsAmount',x.cogs_amount,
        'cogsComplete',x.cogs_complete,
        'valuationStatus',x.valuation_status,
        'valuationSource',x.valuation_source
      ) order by x.business_at desc,x.created_at desc,x.id desc)
      from paged x
    ),'[]'::jsonb),
    'totalCount',(select count(*) from filtered),
    'inflowCount',(select count(*) from filtered where quantity_delta>0),
    'outflowCount',(select count(*) from filtered where quantity_delta<0),
    'valuedCount',(select count(*) from filtered where valuation_status='valued'),
    'partialValuationCount',(select count(*) from filtered where valuation_status='partial'),
    'unvaluedCount',(select count(*) from filtered where valuation_status='unvalued'),
    'knownValueDelta',coalesce((select sum(value_delta) from filtered),0),
    'currency',v_currency,
    'limit',v_limit,
    'offset',v_offset
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.get_sellertray_inventory_management_transfers(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_search text default null,
  p_status text default 'all',
  p_date_from date default null,
  p_date_to date default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_search text := nullif(btrim(coalesce(p_search,'')),'');
  v_status text := lower(btrim(coalesce(p_status,'all')));
  v_limit integer := greatest(1,least(coalesce(p_limit,50),100));
  v_offset integer := greatest(coalesce(p_offset,0),0);
  v_timezone text;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if p_tenant_id is null or p_branch_id is null then
    raise exception 'Business and Branch are required' using errcode='22023';
  end if;
  if not exists(select 1 from public.branches b where b.tenant_id=p_tenant_id and b.id=p_branch_id) then
    raise exception 'Branch not found' using errcode='P0002';
  end if;
  if not public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_view_reports') then
    raise exception 'You do not have permission to view inventory management' using errcode='42501';
  end if;
  if not public.sellertray_user_can_read_report_branch(p_tenant_id,p_branch_id,v_user_id) then
    raise exception 'You do not have access to inventory reporting for this Branch' using errcode='42501';
  end if;
  if v_status='' then v_status:='all'; end if;
  if v_status not in ('all','draft','dispatched','received','cancelled') then
    raise exception 'Unsupported stock transfer status' using errcode='22023';
  end if;
  if p_date_from is not null and p_date_to is not null and p_date_from>p_date_to then
    raise exception 'Stock transfer date range is invalid' using errcode='22023';
  end if;

  select coalesce(nullif(t.timezone,''),'Africa/Lagos') into v_timezone
  from public.tenants t where t.id=p_tenant_id;
  if v_timezone is null then raise exception 'Business not found' using errcode='P0002'; end if;
  if p_date_from is not null then v_start_at:=p_date_from::timestamp at time zone v_timezone; end if;
  if p_date_to is not null then v_end_at:=(p_date_to+1)::timestamp at time zone v_timezone; end if;

  with base_filtered as materialized (
    select
      st.id,
      st.reference,
      st.reason,
      st.status,
      st.source_branch_id,
      sb.name as source_branch_name,
      st.destination_branch_id,
      db.name as destination_branch_name,
      (select count(*)::integer from public.stock_transfer_items sti
       where sti.tenant_id=st.tenant_id and sti.stock_transfer_id=st.id) as item_count,
      st.created_at,
      st.dispatched_at,
      st.received_at,
      st.cancelled_at,
      st.cancel_reason
    from public.stock_transfers st
    join public.branches sb on sb.tenant_id=st.tenant_id and sb.id=st.source_branch_id
    join public.branches db on db.tenant_id=st.tenant_id and db.id=st.destination_branch_id
    where st.tenant_id=p_tenant_id
      and (st.source_branch_id=p_branch_id or st.destination_branch_id=p_branch_id)
      and (v_start_at is null or st.created_at>=v_start_at)
      and (v_end_at is null or st.created_at<v_end_at)
      and (
        v_search is null
        or lower(st.reference) like '%'||lower(v_search)||'%'
        or lower(coalesce(st.reason,'')) like '%'||lower(v_search)||'%'
        or lower(sb.name) like '%'||lower(v_search)||'%'
        or lower(db.name) like '%'||lower(v_search)||'%'
        or exists(
          select 1 from public.stock_transfer_items sti
          where sti.tenant_id=st.tenant_id and sti.stock_transfer_id=st.id
            and lower(sti.product_name) like '%'||lower(v_search)||'%'
        )
      )
  ),
  filtered as materialized (
    select * from base_filtered
    where v_status='all' or status=v_status
  ),
  paged as (
    select * from filtered
    order by created_at desc,id desc
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'items',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',x.id,
        'reference',x.reference,
        'reason',x.reason,
        'status',x.status,
        'sourceBranchId',x.source_branch_id,
        'sourceBranchName',x.source_branch_name,
        'destinationBranchId',x.destination_branch_id,
        'destinationBranchName',x.destination_branch_name,
        'itemCount',x.item_count,
        'createdAt',x.created_at,
        'dispatchedAt',x.dispatched_at,
        'receivedAt',x.received_at,
        'cancelledAt',x.cancelled_at,
        'cancelReason',x.cancel_reason
      ) order by x.created_at desc,x.id desc)
      from paged x
    ),'[]'::jsonb),
    'totalCount',(select count(*) from filtered),
    'openCount',(select count(*) from filtered where status in ('draft','dispatched')),
    'draftCount',(select count(*) from filtered where status='draft'),
    'dispatchedCount',(select count(*) from filtered where status='dispatched'),
    'limit',v_limit,
    'offset',v_offset
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_sellertray_inventory_management_stock(uuid,uuid,text,text,text,timestamptz,integer,integer)
  from public,anon;
grant execute on function public.get_sellertray_inventory_management_stock(uuid,uuid,text,text,text,timestamptz,integer,integer)
  to authenticated,service_role;

revoke all on function public.get_sellertray_inventory_management_movements(uuid,uuid,text,text,date,date,integer,integer)
  from public,anon;
grant execute on function public.get_sellertray_inventory_management_movements(uuid,uuid,text,text,date,date,integer,integer)
  to authenticated,service_role;

revoke all on function public.get_sellertray_inventory_management_transfers(uuid,uuid,text,text,date,date,integer,integer)
  from public,anon;
grant execute on function public.get_sellertray_inventory_management_transfers(uuid,uuid,text,text,date,date,integer,integer)
  to authenticated,service_role;

commit;