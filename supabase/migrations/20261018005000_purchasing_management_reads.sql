begin;

create or replace function public.get_sellertray_purchase_orders_management_list(
  p_tenant_id uuid,
  p_branch_id uuid default null,
  p_search text default null,
  p_status text default null,
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
  v_status text := nullif(lower(btrim(coalesce(p_status,''))),'');
  v_limit integer := greatest(1,least(coalesce(p_limit,50),100));
  v_offset integer := greatest(coalesce(p_offset,0),0);
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if p_tenant_id is null then
    raise exception 'Business is required' using errcode='22023';
  end if;
  if not exists(
    select 1 from public.tenant_members tm
    where tm.tenant_id=p_tenant_id
      and tm.user_id=v_user_id
      and tm.role in ('owner','manager')
  ) then
    raise exception 'Owner or Manager access is required to manage purchasing' using errcode='42501';
  end if;
  if p_branch_id is not null and not exists(
    select 1 from public.branches b
    where b.tenant_id=p_tenant_id and b.id=p_branch_id
  ) then
    raise exception 'Branch not found' using errcode='P0002';
  end if;
  if v_status='all' then v_status:=null; end if;
  if v_status is not null and v_status not in ('draft','ordered','partially_received','received','cancelled') then
    raise exception 'Unsupported Purchase Order status' using errcode='22023';
  end if;

  with filtered as materialized (
    select
      po.id,
      po.reference,
      po.status,
      po.branch_id,
      b.name as branch_name,
      po.supplier_id,
      s.name as supplier_name,
      po.currency,
      coalesce(po.total_amount,0) as total_amount,
      po.expected_date,
      po.created_at,
      po.ordered_at,
      po.received_at,
      coalesce(values.received_value,0) as received_value,
      case when po.status in ('ordered','partially_received') then coalesce(values.open_commitment,0) else 0 end as open_commitment,
      coalesce(values.item_count,0) as item_count
    from public.sellertray_purchase_orders po
    join public.branches b
      on b.tenant_id=po.tenant_id and b.id=po.branch_id
    join public.sellertray_suppliers s
      on s.tenant_id=po.tenant_id and s.id=po.supplier_id
    left join lateral (
      select
        count(*)::integer as item_count,
        coalesce(sum(coalesce(poi.received_quantity,0)*coalesce(poi.unit_cost,0)),0) as received_value,
        coalesce(sum(greatest(coalesce(poi.ordered_quantity,0)-coalesce(poi.received_quantity,0),0)*coalesce(poi.unit_cost,0)),0) as open_commitment
      from public.sellertray_purchase_order_items poi
      where poi.tenant_id=po.tenant_id and poi.purchase_order_id=po.id
    ) values on true
    where po.tenant_id=p_tenant_id
      and (p_branch_id is null or po.branch_id=p_branch_id)
      and (v_status is null or po.status=v_status)
      and (
        v_search is null
        or lower(coalesce(po.reference,'')) like '%'||lower(v_search)||'%'
        or lower(coalesce(s.name,'')) like '%'||lower(v_search)||'%'
        or lower(coalesce(b.name,'')) like '%'||lower(v_search)||'%'
        or exists(
          select 1
          from public.sellertray_purchase_order_items poi_search
          where poi_search.tenant_id=po.tenant_id
            and poi_search.purchase_order_id=po.id
            and (
              lower(coalesce(poi_search.product_name,'')) like '%'||lower(v_search)||'%'
              or lower(coalesce(poi_search.sku,'')) like '%'||lower(v_search)||'%'
            )
        )
      )
  ),
  paged as (
    select * from filtered
    order by created_at desc,id desc
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'items',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',p.id,
        'reference',p.reference,
        'status',p.status,
        'branchId',p.branch_id,
        'branchName',p.branch_name,
        'supplierId',p.supplier_id,
        'supplierName',p.supplier_name,
        'currency',p.currency,
        'totalAmount',p.total_amount,
        'itemCount',p.item_count,
        'receivedValue',p.received_value,
        'openCommitment',p.open_commitment,
        'expectedDate',p.expected_date,
        'createdAt',p.created_at,
        'orderedAt',p.ordered_at,
        'receivedAt',p.received_at
      ) order by p.created_at desc,p.id desc)
      from paged p
    ),'[]'::jsonb),
    'totalCount',(select count(*) from filtered),
    'orderedValue',coalesce((select sum(total_amount) from filtered where status in ('ordered','partially_received','received')),0),
    'receivedValue',coalesce((select sum(received_value) from filtered),0),
    'openCommitment',coalesce((select sum(open_commitment) from filtered),0),
    'currency',(select case when count(distinct currency)=1 then min(currency) else null end from filtered),
    'limit',v_limit,
    'offset',v_offset
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.get_sellertray_purchase_order_management_detail(
  p_tenant_id uuid,
  p_purchase_order_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_order jsonb;
  v_items jsonb;
  v_receipts jsonb;
  v_paid numeric := 0;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if p_tenant_id is null or p_purchase_order_id is null then
    raise exception 'Business and Purchase Order are required' using errcode='22023';
  end if;
  if not exists(
    select 1 from public.tenant_members tm
    where tm.tenant_id=p_tenant_id
      and tm.user_id=v_user_id
      and tm.role in ('owner','manager')
  ) then
    raise exception 'Owner or Manager access is required to manage purchasing' using errcode='42501';
  end if;

  select jsonb_build_object(
    'purchaseOrderId',po.id,
    'reference',po.reference,
    'status',po.status,
    'branchId',po.branch_id,
    'branchName',b.name,
    'supplierId',po.supplier_id,
    'supplierName',s.name,
    'currency',po.currency,
    'totalAmount',coalesce(po.total_amount,0),
    'expectedDate',po.expected_date,
    'notes',po.notes,
    'createdAt',po.created_at,
    'orderedAt',po.ordered_at,
    'receivedAt',po.received_at,
    'cancelledAt',po.cancelled_at,
    'cancelReason',po.cancel_reason
  ) into v_order
  from public.sellertray_purchase_orders po
  join public.branches b on b.tenant_id=po.tenant_id and b.id=po.branch_id
  join public.sellertray_suppliers s on s.tenant_id=po.tenant_id and s.id=po.supplier_id
  where po.tenant_id=p_tenant_id and po.id=p_purchase_order_id;

  if v_order is null then
    raise exception 'Purchase Order not found' using errcode='P0002';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'itemId',poi.id,
    'catalogItemId',poi.catalog_item_id,
    'uomId',poi.uom_id,
    'productName',poi.product_name,
    'sku',poi.sku,
    'selectedUom',poi.selected_uom,
    'conversionFactor',poi.conversion_factor,
    'orderedQuantity',poi.ordered_quantity,
    'orderedStockQuantity',poi.ordered_stock_quantity,
    'unitCost',poi.unit_cost,
    'lineTotal',poi.line_total,
    'receivedQuantity',poi.received_quantity,
    'receivedStockQuantity',poi.received_stock_quantity,
    'remainingQuantity',greatest(poi.ordered_quantity-poi.received_quantity,0),
    'receivedValue',coalesce(poi.received_quantity,0)*coalesce(poi.unit_cost,0),
    'remainingValue',greatest(coalesce(poi.ordered_quantity,0)-coalesce(poi.received_quantity,0),0)*coalesce(poi.unit_cost,0)
  ) order by poi.created_at,poi.id),'[]'::jsonb) into v_items
  from public.sellertray_purchase_order_items poi
  where poi.tenant_id=p_tenant_id and poi.purchase_order_id=p_purchase_order_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'receiptId',pr.id,
    'reference',pr.reference,
    'receivedAt',pr.received_at,
    'notes',pr.notes,
    'itemCount',coalesce(ri.item_count,0)
  ) order by pr.received_at desc,pr.id desc),'[]'::jsonb) into v_receipts
  from public.sellertray_purchase_receipts pr
  left join lateral (
    select count(*)::integer as item_count
    from public.sellertray_purchase_receipt_items pri
    where pri.tenant_id=pr.tenant_id and pri.receipt_id=pr.id
  ) ri on true
  where pr.tenant_id=p_tenant_id and pr.purchase_order_id=p_purchase_order_id;

  v_paid:=public.sellertray_purchase_paid_amount(p_tenant_id,p_purchase_order_id);
  return v_order||jsonb_build_object(
    'items',v_items,
    'receipts',v_receipts,
    'paidAmount',v_paid,
    'outstandingAmount',greatest(coalesce((v_order->>'totalAmount')::numeric,0)-v_paid,0)
  );
end;
$$;

create or replace function public.get_sellertray_suppliers_management_list(
  p_tenant_id uuid,
  p_search text default null,
  p_status text default null,
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
  v_status text := nullif(lower(btrim(coalesce(p_status,''))),'');
  v_limit integer := greatest(1,least(coalesce(p_limit,50),100));
  v_offset integer := greatest(coalesce(p_offset,0),0);
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if p_tenant_id is null then
    raise exception 'Business is required' using errcode='22023';
  end if;
  if not exists(
    select 1 from public.tenant_members tm
    where tm.tenant_id=p_tenant_id
      and tm.user_id=v_user_id
      and tm.role in ('owner','manager')
  ) then
    raise exception 'Owner or Manager access is required to manage suppliers' using errcode='42501';
  end if;
  if v_status='all' then v_status:=null; end if;
  if v_status is not null and v_status not in ('active','inactive') then
    raise exception 'Unsupported supplier status' using errcode='22023';
  end if;

  with purchase_metrics as materialized (
    select
      po.supplier_id,
      count(*)::integer as purchase_count,
      count(*) filter(where po.status in ('ordered','partially_received'))::integer as open_purchase_count,
      coalesce(sum(po.total_amount),0) as purchase_total,
      coalesce(sum(public.sellertray_purchase_paid_amount(po.tenant_id,po.id)),0) as paid_amount,
      max(coalesce(po.ordered_at,po.created_at)) as last_purchase_at
    from public.sellertray_purchase_orders po
    where po.tenant_id=p_tenant_id
      and po.status in ('ordered','partially_received','received')
    group by po.supplier_id
  ),
  filtered as materialized (
    select
      s.id,
      s.name,
      s.contact_name,
      s.phone,
      s.email,
      s.address,
      s.notes,
      s.is_active,
      s.created_at,
      s.updated_at,
      coalesce(pm.purchase_count,0) as purchase_count,
      coalesce(pm.open_purchase_count,0) as open_purchase_count,
      coalesce(pm.purchase_total,0) as purchase_total,
      coalesce(pm.paid_amount,0) as paid_amount,
      greatest(coalesce(pm.purchase_total,0)-coalesce(pm.paid_amount,0),0) as outstanding_amount,
      pm.last_purchase_at
    from public.sellertray_suppliers s
    left join purchase_metrics pm on pm.supplier_id=s.id
    where s.tenant_id=p_tenant_id
      and (v_status is null or (v_status='active' and s.is_active) or (v_status='inactive' and not s.is_active))
      and (
        v_search is null
        or lower(coalesce(s.name,'')) like '%'||lower(v_search)||'%'
        or lower(coalesce(s.contact_name,'')) like '%'||lower(v_search)||'%'
        or lower(coalesce(s.phone,'')) like '%'||lower(v_search)||'%'
        or lower(coalesce(s.email,'')) like '%'||lower(v_search)||'%'
      )
  ),
  paged as (
    select * from filtered
    order by name,id
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'id',p.id,
      'name',p.name,
      'contactName',p.contact_name,
      'phone',p.phone,
      'email',p.email,
      'address',p.address,
      'notes',p.notes,
      'isActive',p.is_active,
      'purchaseCount',p.purchase_count,
      'openPurchaseCount',p.open_purchase_count,
      'purchaseTotal',p.purchase_total,
      'paidAmount',p.paid_amount,
      'outstandingAmount',p.outstanding_amount,
      'lastPurchaseAt',p.last_purchase_at,
      'createdAt',p.created_at,
      'updatedAt',p.updated_at
    ) order by p.name,p.id) from paged p),'[]'::jsonb),
    'totalCount',(select count(*) from filtered),
    'outstandingAmount',coalesce((select sum(outstanding_amount) from filtered),0),
    'limit',v_limit,
    'offset',v_offset
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.get_sellertray_supplier_management_detail(
  p_tenant_id uuid,
  p_supplier_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_supplier jsonb;
  v_history jsonb;
  v_purchase_total numeric := 0;
  v_paid numeric := 0;
  v_purchase_count integer := 0;
  v_open_count integer := 0;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if p_tenant_id is null or p_supplier_id is null then
    raise exception 'Business and supplier are required' using errcode='22023';
  end if;
  if not exists(
    select 1 from public.tenant_members tm
    where tm.tenant_id=p_tenant_id
      and tm.user_id=v_user_id
      and tm.role in ('owner','manager')
  ) then
    raise exception 'Owner or Manager access is required to manage suppliers' using errcode='42501';
  end if;

  select jsonb_build_object(
    'id',s.id,
    'name',s.name,
    'contactName',s.contact_name,
    'phone',s.phone,
    'email',s.email,
    'address',s.address,
    'notes',s.notes,
    'isActive',s.is_active,
    'createdAt',s.created_at,
    'updatedAt',s.updated_at
  ) into v_supplier
  from public.sellertray_suppliers s
  where s.tenant_id=p_tenant_id and s.id=p_supplier_id;

  if v_supplier is null then
    raise exception 'Supplier not found' using errcode='P0002';
  end if;

  select
    count(*)::integer,
    count(*) filter(where po.status in ('ordered','partially_received'))::integer,
    coalesce(sum(po.total_amount),0),
    coalesce(sum(public.sellertray_purchase_paid_amount(po.tenant_id,po.id)),0)
  into v_purchase_count,v_open_count,v_purchase_total,v_paid
  from public.sellertray_purchase_orders po
  where po.tenant_id=p_tenant_id
    and po.supplier_id=p_supplier_id
    and po.status in ('ordered','partially_received','received');

  select coalesce(jsonb_agg(jsonb_build_object(
    'purchaseOrderId',h.id,
    'reference',h.reference,
    'status',h.status,
    'branchId',h.branch_id,
    'branchName',h.branch_name,
    'currency',h.currency,
    'totalAmount',h.total_amount,
    'paidAmount',h.paid_amount,
    'outstandingAmount',greatest(h.total_amount-h.paid_amount,0),
    'orderedAt',h.ordered_at,
    'receivedAt',h.received_at,
    'createdAt',h.created_at
  ) order by h.created_at desc,h.id desc),'[]'::jsonb) into v_history
  from (
    select
      po.id,po.reference,po.status,po.branch_id,b.name as branch_name,po.currency,
      coalesce(po.total_amount,0) as total_amount,
      public.sellertray_purchase_paid_amount(po.tenant_id,po.id) as paid_amount,
      po.ordered_at,po.received_at,po.created_at
    from public.sellertray_purchase_orders po
    join public.branches b on b.tenant_id=po.tenant_id and b.id=po.branch_id
    where po.tenant_id=p_tenant_id and po.supplier_id=p_supplier_id
    order by po.created_at desc,po.id desc
    limit 100
  ) h;

  return v_supplier||jsonb_build_object(
    'purchaseCount',v_purchase_count,
    'openPurchaseCount',v_open_count,
    'purchaseTotal',v_purchase_total,
    'paidAmount',v_paid,
    'outstandingAmount',greatest(v_purchase_total-v_paid,0),
    'purchaseHistory',v_history
  );
end;
$$;

revoke all on function public.get_sellertray_purchase_orders_management_list(uuid,uuid,text,text,integer,integer) from public,anon;
revoke all on function public.get_sellertray_purchase_order_management_detail(uuid,uuid) from public,anon;
revoke all on function public.get_sellertray_suppliers_management_list(uuid,text,text,integer,integer) from public,anon;
revoke all on function public.get_sellertray_supplier_management_detail(uuid,uuid) from public,anon;

grant execute on function public.get_sellertray_purchase_orders_management_list(uuid,uuid,text,text,integer,integer) to authenticated,service_role;
grant execute on function public.get_sellertray_purchase_order_management_detail(uuid,uuid) to authenticated,service_role;
grant execute on function public.get_sellertray_suppliers_management_list(uuid,text,text,integer,integer) to authenticated,service_role;
grant execute on function public.get_sellertray_supplier_management_detail(uuid,uuid) to authenticated,service_role;

commit;
