begin;

create or replace function public.sellertray_report_center(
  p_tenant_id uuid,
  p_days integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_days integer := greatest(1,least(coalesce(p_days,30),365));
  v_since timestamptz;
  v_summary jsonb;
  v_branches jsonb;
  v_trend jsonb;
  v_channels jsonb;
  v_methods jsonb;
  v_customers jsonb;
  v_procurement_summary jsonb;
  v_purchase_status jsonb;
  v_branch_procurement jsonb;
  v_supplier_outstanding jsonb;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;
  if v_role not in ('owner','manager') then
    raise exception 'Owner or Manager access is required for business reports' using errcode='42501';
  end if;

  v_since := now() - make_interval(days=>v_days);
  v_summary := public.sellertray_report_summary(p_tenant_id,v_days);

  select coalesce(jsonb_agg(jsonb_build_object(
    'branchId',x.branch_id,
    'branchCode',x.branch_code,
    'branchName',x.branch_name,
    'isActive',x.is_active,
    'orders',x.orders,
    'completed',x.completed,
    'orderValue',x.order_value,
    'paidValue',x.paid_value,
    'whatsappOrders',x.whatsapp_orders,
    'closedShifts',x.closed_shifts,
    'cashVariance',x.cash_variance
  ) order by x.order_value desc,x.orders desc,x.branch_name),'[]'::jsonb)
  into v_branches
  from (
    select b.id as branch_id,b.code as branch_code,b.name as branch_name,b.is_active,
           count(o.id)::int as orders,
           count(o.id) filter (where o.status='completed')::int as completed,
           coalesce(sum(o.total_amount) filter (where o.status not in ('rejected','cancelled')),0)::numeric as order_value,
           coalesce(sum(o.amount_paid),0)::numeric as paid_value,
           count(o.id) filter (where o.source='whatsapp')::int as whatsapp_orders,
           coalesce(s.closed_shifts,0)::int as closed_shifts,
           coalesce(s.cash_variance,0)::numeric as cash_variance
    from public.branches b
    left join public.orders o
      on o.tenant_id=b.tenant_id and o.branch_id=b.id and o.created_at>=v_since
    left join (
      select cs.branch_id,
             count(*) filter (where cs.status in ('closed','reviewed'))::int as closed_shifts,
             coalesce(sum(cs.variance) filter (where cs.status in ('closed','reviewed')),0)::numeric as cash_variance
      from public.sellertray_cash_shifts cs
      where cs.tenant_id=p_tenant_id and cs.opened_at>=v_since
      group by cs.branch_id
    ) s on s.branch_id=b.id
    where b.tenant_id=p_tenant_id
    group by b.id,b.code,b.name,b.is_active,s.closed_shifts,s.cash_variance
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
    'date',x.business_date,
    'orders',x.orders,
    'orderValue',x.order_value,
    'paidValue',x.paid_value
  ) order by x.business_date),'[]'::jsonb)
  into v_trend
  from (
    select (o.created_at at time zone 'UTC')::date as business_date,
           count(*)::int as orders,
           coalesce(sum(o.total_amount) filter (where o.status not in ('rejected','cancelled')),0)::numeric as order_value,
           coalesce(sum(o.amount_paid),0)::numeric as paid_value
    from public.orders o
    where o.tenant_id=p_tenant_id and o.created_at>=v_since
    group by (o.created_at at time zone 'UTC')::date
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
    'channel',x.source,
    'orders',x.orders,
    'orderValue',x.order_value,
    'paidValue',x.paid_value
  ) order by x.order_value desc,x.orders desc,x.source),'[]'::jsonb)
  into v_channels
  from (
    select o.source,
           count(*)::int as orders,
           coalesce(sum(o.total_amount) filter (where o.status not in ('rejected','cancelled')),0)::numeric as order_value,
           coalesce(sum(o.amount_paid),0)::numeric as paid_value
    from public.orders o
    where o.tenant_id=p_tenant_id and o.created_at>=v_since
    group by o.source
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
    'method',x.method_type,
    'attempts',x.attempts,
    'confirmed',x.confirmed,
    'confirmedValue',x.confirmed_value,
    'pendingVerification',x.pending_verification,
    'failed',x.failed
  ) order by x.confirmed_value desc,x.attempts desc,x.method_type),'[]'::jsonb)
  into v_methods
  from (
    select op.method_type,
           count(*)::int as attempts,
           count(*) filter (where op.status='confirmed')::int as confirmed,
           coalesce(sum(op.amount) filter (where op.status='confirmed'),0)::numeric as confirmed_value,
           count(*) filter (where op.status='pending_verification')::int as pending_verification,
           count(*) filter (where op.status='failed')::int as failed
    from public.order_payments op
    where op.tenant_id=p_tenant_id and op.created_at>=v_since
    group by op.method_type
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
    'customerId',x.customer_id,
    'customerName',x.customer_name,
    'orders',x.orders,
    'orderValue',x.order_value,
    'paidValue',x.paid_value,
    'lastOrderAt',x.last_order_at
  ) order by x.order_value desc,x.orders desc,x.last_order_at desc),'[]'::jsonb)
  into v_customers
  from (
    select o.customer_id,
           coalesce(c.display_name,c.phone,c.wa_id,'Customer') as customer_name,
           count(*)::int as orders,
           coalesce(sum(o.total_amount) filter (where o.status not in ('rejected','cancelled')),0)::numeric as order_value,
           coalesce(sum(o.amount_paid),0)::numeric as paid_value,
           max(o.created_at) as last_order_at
    from public.orders o
    left join public.customers c
      on c.tenant_id=o.tenant_id and c.id=o.customer_id
    where o.tenant_id=p_tenant_id and o.created_at>=v_since
    group by o.customer_id,coalesce(c.display_name,c.phone,c.wa_id,'Customer')
    order by order_value desc,orders desc,last_order_at desc
    limit 10
  ) x;

  with period_purchase as (
    select po.id,po.status,po.total_amount
    from public.sellertray_purchase_orders po
    where po.tenant_id=p_tenant_id
      and po.created_at>=v_since
  ), period_payment as (
    select p.amount
    from public.sellertray_supplier_payments p
    where p.tenant_id=p_tenant_id
      and p.paid_at>=v_since
      and not exists(
        select 1 from public.sellertray_supplier_payment_reversals r
        where r.tenant_id=p.tenant_id and r.payment_id=p.id
      )
  ), current_outstanding as (
    select coalesce(sum(greatest(po.total_amount-public.sellertray_purchase_paid_amount(po.tenant_id,po.id),0)),0)::numeric as amount
    from public.sellertray_purchase_orders po
    where po.tenant_id=p_tenant_id
      and po.status in ('ordered','partially_received','received')
  )
  select jsonb_build_object(
    'purchaseOrders',count(*) filter (where pp.status in ('ordered','partially_received','received')),
    'purchaseValue',coalesce(sum(pp.total_amount) filter (where pp.status in ('ordered','partially_received','received')),0),
    'receivedPurchaseOrders',count(*) filter (where pp.status='received'),
    'receivedValue',coalesce(sum(pp.total_amount) filter (where pp.status='received'),0),
    'supplierPaidValue',(select coalesce(sum(amount),0) from period_payment),
    'supplierOutstanding',(select amount from current_outstanding)
  )
  into v_procurement_summary
  from period_purchase pp;

  select coalesce(jsonb_agg(jsonb_build_object(
    'status',x.status,
    'purchaseOrders',x.purchase_orders,
    'purchaseValue',x.purchase_value
  ) order by case x.status when 'draft' then 1 when 'ordered' then 2 when 'partially_received' then 3 when 'received' then 4 when 'cancelled' then 5 else 6 end,x.status),'[]'::jsonb)
  into v_purchase_status
  from (
    select po.status,
           count(*)::int as purchase_orders,
           coalesce(sum(po.total_amount),0)::numeric as purchase_value
    from public.sellertray_purchase_orders po
    where po.tenant_id=p_tenant_id and po.created_at>=v_since
    group by po.status
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
    'branchId',x.branch_id,
    'branchCode',x.branch_code,
    'branchName',x.branch_name,
    'isActive',x.is_active,
    'purchaseOrders',x.purchase_orders,
    'purchaseValue',x.purchase_value,
    'receivedPurchaseOrders',x.received_purchase_orders,
    'receivedValue',x.received_value,
    'supplierPaidValue',x.supplier_paid_value
  ) order by x.purchase_value desc,x.purchase_orders desc,x.branch_name),'[]'::jsonb)
  into v_branch_procurement
  from (
    select b.id as branch_id,b.code as branch_code,b.name as branch_name,b.is_active,
           coalesce(p.purchase_orders,0)::int as purchase_orders,
           coalesce(p.purchase_value,0)::numeric as purchase_value,
           coalesce(p.received_purchase_orders,0)::int as received_purchase_orders,
           coalesce(p.received_value,0)::numeric as received_value,
           coalesce(pay.supplier_paid_value,0)::numeric as supplier_paid_value
    from public.branches b
    left join (
      select po.branch_id,
             count(*) filter (where po.status in ('ordered','partially_received','received'))::int as purchase_orders,
             coalesce(sum(po.total_amount) filter (where po.status in ('ordered','partially_received','received')),0)::numeric as purchase_value,
             count(*) filter (where po.status='received')::int as received_purchase_orders,
             coalesce(sum(po.total_amount) filter (where po.status='received'),0)::numeric as received_value
      from public.sellertray_purchase_orders po
      where po.tenant_id=p_tenant_id and po.created_at>=v_since
      group by po.branch_id
    ) p on p.branch_id=b.id
    left join (
      select sp.branch_id,
             coalesce(sum(sp.amount),0)::numeric as supplier_paid_value
      from public.sellertray_supplier_payments sp
      where sp.tenant_id=p_tenant_id
        and sp.paid_at>=v_since
        and not exists(
          select 1 from public.sellertray_supplier_payment_reversals r
          where r.tenant_id=sp.tenant_id and r.payment_id=sp.id
        )
      group by sp.branch_id
    ) pay on pay.branch_id=b.id
    where b.tenant_id=p_tenant_id
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
    'supplierId',s.supplier_id,
    'supplierName',s.supplier_name,
    'currency',s.currency,
    'purchaseTotal',s.purchase_total,
    'paidAmount',s.paid_amount,
    'outstandingAmount',s.outstanding_amount,
    'purchaseCount',s.purchase_count
  ) order by s.outstanding_amount desc,s.purchase_total desc,s.supplier_name),'[]'::jsonb)
  into v_supplier_outstanding
  from public.get_sellertray_supplier_outstanding_summary(p_tenant_id) s
  where s.purchase_count>0;

  return jsonb_build_object(
    'days',v_days,
    'summary',v_summary,
    'branchPerformance',v_branches,
    'salesTrend',v_trend,
    'channels',v_channels,
    'paymentMethods',v_methods,
    'topCustomers',v_customers,
    'procurementSummary',v_procurement_summary,
    'purchaseStatus',v_purchase_status,
    'branchProcurement',v_branch_procurement,
    'supplierOutstanding',v_supplier_outstanding
  );
end;
$$;

revoke all on function public.sellertray_report_center(uuid,integer)
  from public,anon;
grant execute on function public.sellertray_report_center(uuid,integer)
  to authenticated,service_role;

commit;
