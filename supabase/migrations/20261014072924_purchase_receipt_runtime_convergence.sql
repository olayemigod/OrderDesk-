begin;

-- Keep mobile purchase receiving on the shared current branch authority. The
-- historical purchase receipt migration remains the clean-install source for
-- tables, receipt integrity and stock-ledger posting.
create or replace function public.get_sellertray_purchase_order_detail(
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
  v_role text;
  v_po public.sellertray_purchase_orders%rowtype;
  v_supplier_name text;
  v_branch_name text;
  v_items jsonb;
  v_receipts jsonb;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;

  if v_role is null then
    raise exception 'SellerTray business membership required' using errcode='42501';
  end if;

  select * into v_po
  from public.sellertray_purchase_orders po
  where po.tenant_id=p_tenant_id and po.id=p_purchase_order_id;

  if not found then
    raise exception 'Purchase order not found' using errcode='P0002';
  end if;

  select s.name,b.name into v_supplier_name,v_branch_name
  from public.sellertray_suppliers s
  join public.branches b
    on b.tenant_id=p_tenant_id and b.id=v_po.branch_id
  where s.tenant_id=p_tenant_id and s.id=v_po.supplier_id;

  if not found then
    raise exception 'Purchase order supplier or Branch is unavailable' using errcode='P0002';
  end if;

  if v_role='staff' and (
    v_po.status not in ('ordered','partially_received')
    or not public.sellertray_user_can_operate_branch(
      p_tenant_id,v_po.branch_id,v_user_id
    )
    or not public.sellertray_user_has_capability(
      p_tenant_id,v_user_id,'can_receive_stock'
    )
  ) then
    raise exception 'You do not have access to this purchase order' using errcode='42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'itemId',i.id,
    'catalogItemId',i.catalog_item_id,
    'uomId',i.uom_id,
    'productName',i.product_name,
    'sku',i.sku,
    'selectedUom',i.selected_uom,
    'conversionFactor',i.conversion_factor,
    'orderedQuantity',i.ordered_quantity,
    'orderedStockQuantity',i.ordered_stock_quantity,
    'unitCost',i.unit_cost,
    'lineTotal',i.line_total,
    'receivedQuantity',i.received_quantity,
    'receivedStockQuantity',i.received_stock_quantity,
    'remainingQuantity',greatest(i.ordered_quantity-i.received_quantity,0)
  ) order by i.created_at,i.id),'[]'::jsonb)
  into v_items
  from public.sellertray_purchase_order_items i
  where i.tenant_id=p_tenant_id and i.purchase_order_id=v_po.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'receiptId',r.id,
    'reference',r.reference,
    'receivedAt',r.received_at,
    'notes',r.notes,
    'itemCount',coalesce(x.item_count,0)
  ) order by r.received_at desc,r.id),'[]'::jsonb)
  into v_receipts
  from public.sellertray_purchase_receipts r
  left join (
    select ri.receipt_id,count(*)::int as item_count
    from public.sellertray_purchase_receipt_items ri
    where ri.tenant_id=p_tenant_id
    group by ri.receipt_id
  ) x on x.receipt_id=r.id
  where r.tenant_id=p_tenant_id and r.purchase_order_id=v_po.id;

  return jsonb_build_object(
    'purchaseOrderId',v_po.id,
    'reference',v_po.reference,
    'status',v_po.status,
    'branchId',v_po.branch_id,
    'branchName',v_branch_name,
    'supplierId',v_po.supplier_id,
    'supplierName',v_supplier_name,
    'currency',v_po.currency,
    'totalAmount',v_po.total_amount,
    'expectedDate',v_po.expected_date,
    'notes',v_po.notes,
    'createdAt',v_po.created_at,
    'orderedAt',v_po.ordered_at,
    'receivedAt',v_po.received_at,
    'cancelledAt',v_po.cancelled_at,
    'cancelReason',v_po.cancel_reason,
    'items',v_items,
    'receipts',v_receipts
  );
end;
$$;

revoke all on function public.get_sellertray_purchase_order_detail(uuid,uuid)
  from public,anon;
grant execute on function public.get_sellertray_purchase_order_detail(uuid,uuid)
  to authenticated;

commit;
