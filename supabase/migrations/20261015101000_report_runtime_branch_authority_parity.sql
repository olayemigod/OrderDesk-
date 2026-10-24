begin;

-- Report authority is capability-based, while data scope remains Branch-aware.
-- Management keeps tenant-wide historical visibility (including legacy rows that
-- predate Branch attribution). Staff with explicit report capability only see
-- Branches they are allowed to read.
create or replace function public.sellertray_user_can_read_report_branch(
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
begin
  if p_tenant_id is null or p_user_id is null then return false; end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_user_id;

  if v_role is null then return false; end if;
  if v_role in ('owner','manager') then return true; end if;
  if p_branch_id is null then return false; end if;

  return public.sellertray_user_can_read_branch(p_tenant_id,p_branch_id,p_user_id);
end;
$$;

revoke all on function public.sellertray_user_can_read_report_branch(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.sellertray_user_can_read_report_branch(uuid,uuid,uuid)
  to service_role;

-- Preserve the mobile report-summary contract, but converge its authority with
-- can_view_reports and apply the same Branch read scope used by Report Center.
create or replace function public.sellertray_report_summary(
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
  v_days integer := greatest(1,least(coalesce(p_days,30),365));
  v_since timestamptz;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if not public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_view_reports') then
    raise exception 'You do not have permission to view business reports' using errcode='42501';
  end if;

  v_since := now() - make_interval(days=>v_days);

  with order_stats as (
    select
      count(*)::int as orders,
      count(*) filter (where o.status='completed')::int as completed,
      count(*) filter (where o.status in ('rejected','cancelled'))::int as unsuccessful,
      count(*) filter (where o.source='whatsapp')::int as whatsapp_orders,
      count(*) filter (where o.source='manual')::int as manual_orders,
      count(*) filter (where o.payment_status='paid')::int as paid_orders,
      count(*) filter (
        where o.payment_status in ('unpaid','pending','verification_required','payment_issue')
          and o.status not in ('rejected','cancelled')
      )::int as awaiting_payment,
      coalesce(sum(o.total_amount) filter (where o.status not in ('rejected','cancelled')),0)::numeric as order_value,
      coalesce(sum(o.amount_paid),0)::numeric as paid_value,
      count(*) filter (where o.fulfillment_status='out_for_delivery')::int as out_for_delivery,
      count(*) filter (where o.fulfillment_status='delivered')::int as delivered,
      count(*) filter (where o.fulfillment_status='collected')::int as collected,
      count(*) filter (where o.status='ready' and o.fulfillment_status='unassigned')::int as awaiting_fulfillment
    from public.orders o
    where o.tenant_id=p_tenant_id
      and o.created_at>=v_since
      and public.sellertray_user_can_read_report_branch(p_tenant_id,o.branch_id,v_user_id)
  ),
  payment_method_stats as (
    select op.method_type,count(*)::int as method_count
    from public.order_payments op
    join public.orders o on o.tenant_id=op.tenant_id and o.id=op.order_id
    where op.tenant_id=p_tenant_id
      and op.created_at>=v_since
      and public.sellertray_user_can_read_report_branch(p_tenant_id,o.branch_id,v_user_id)
    group by op.method_type
  ),
  payment_stats as (
    select
      count(*) filter (where op.status='pending_verification')::int as verification_required,
      count(*) filter (where op.status='failed')::int as failed,
      count(*) filter (where op.exception_state<>'none')::int as exceptions
    from public.order_payments op
    join public.orders o on o.tenant_id=op.tenant_id and o.id=op.order_id
    where op.tenant_id=p_tenant_id
      and op.created_at>=v_since
      and public.sellertray_user_can_read_report_branch(p_tenant_id,o.branch_id,v_user_id)
  ),
  method_json as (
    select coalesce(jsonb_object_agg(pms.method_type,pms.method_count),'{}'::jsonb) as methods
    from payment_method_stats pms
  ),
  top_items as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name',x.item_name,'quantity',x.quantity,'value',x.value
    ) order by x.value desc,x.quantity desc),'[]'::jsonb) as items
    from (
      select oi.item_name,
             sum(oi.quantity)::numeric as quantity,
             sum(oi.quantity*coalesce(oi.unit_price,0))::numeric as value
      from public.order_items oi
      join public.orders o on o.id=oi.order_id and o.tenant_id=oi.tenant_id
      where oi.tenant_id=p_tenant_id
        and o.created_at>=v_since
        and o.status not in ('rejected','cancelled')
        and public.sellertray_user_can_read_report_branch(p_tenant_id,o.branch_id,v_user_id)
      group by oi.item_name
      order by value desc,quantity desc
      limit 10
    ) x
  )
  select jsonb_build_object(
    'days',v_days,
    'orders',jsonb_build_object(
      'total',os.orders,'completed',os.completed,'unsuccessful',os.unsuccessful,
      'whatsapp',os.whatsapp_orders,'manual',os.manual_orders,'orderValue',os.order_value,
      'averageOrderValue',case when os.orders>0 then os.order_value/os.orders else 0 end
    ),
    'payments',jsonb_build_object(
      'paidOrders',os.paid_orders,'awaitingPayment',os.awaiting_payment,'paidValue',os.paid_value,
      'verificationRequired',ps.verification_required,'failed',ps.failed,'exceptions',ps.exceptions,
      'methods',mj.methods
    ),
    'fulfillment',jsonb_build_object(
      'outForDelivery',os.out_for_delivery,'delivered',os.delivered,
      'collected',os.collected,'awaitingFulfillment',os.awaiting_fulfillment
    ),
    'topItems',ti.items
  )
  into v_result
  from order_stats os,payment_stats ps,method_json mj,top_items ti;

  return v_result;
end;
$$;

revoke all on function public.sellertray_report_summary(uuid,integer) from public,anon;
grant execute on function public.sellertray_report_summary(uuid,integer) to authenticated,service_role;

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

  if not public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_view_reports') then
    raise exception 'You do not have permission to view business reports' using errcode='42501';
  end if;

  v_since := now() - make_interval(days=>v_days);
  v_summary := public.sellertray_report_summary(p_tenant_id,v_days);

  select coalesce(jsonb_agg(jsonb_build_object(
    'branchId',x.branch_id,'branchCode',x.branch_code,'branchName',x.branch_name,
    'isActive',x.is_active,'orders',x.orders,'completed',x.completed,
    'orderValue',x.order_value,'paidValue',x.paid_value,'whatsappOrders',x.whatsapp_orders,
    'closedShifts',x.closed_shifts,'cashVariance',x.cash_variance
  ) order by x.order_value desc,x.orders desc,x.branch_name),'[]'::jsonb)
  into v_branches
  from (
    select b.id branch_id,b.code branch_code,b.name branch_name,b.is_active,
           count(o.id)::int orders,
           count(o.id) filter (where o.status='completed')::int completed,
           coalesce(sum(o.total_amount) filter (where o.status not in ('rejected','cancelled')),0)::numeric order_value,
           coalesce(sum(o.amount_paid),0)::numeric paid_value,
           count(o.id) filter (where o.source='whatsapp')::int whatsapp_orders,
           coalesce(s.closed_shifts,0)::int closed_shifts,
           coalesce(s.cash_variance,0)::numeric cash_variance
    from public.branches b
    left join public.orders o
      on o.tenant_id=b.tenant_id and o.branch_id=b.id and o.created_at>=v_since
    left join (
      select cs.branch_id,
             count(*) filter (where cs.status in ('closed','reviewed'))::int closed_shifts,
             coalesce(sum(cs.variance) filter (where cs.status in ('closed','reviewed')),0)::numeric cash_variance
      from public.sellertray_cash_shifts cs
      where cs.tenant_id=p_tenant_id
        and cs.opened_at>=v_since
        and public.sellertray_user_can_read_report_branch(p_tenant_id,cs.branch_id,v_user_id)
      group by cs.branch_id
    ) s on s.branch_id=b.id
    where b.tenant_id=p_tenant_id
      and public.sellertray_user_can_read_report_branch(p_tenant_id,b.id,v_user_id)
    group by b.id,b.code,b.name,b.is_active,s.closed_shifts,s.cash_variance
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
    'date',x.business_date,'orders',x.orders,'orderValue',x.order_value,'paidValue',x.paid_value
  ) order by x.business_date),'[]'::jsonb)
  into v_trend
  from (
    select (o.created_at at time zone 'UTC')::date business_date,count(*)::int orders,
           coalesce(sum(o.total_amount) filter (where o.status not in ('rejected','cancelled')),0)::numeric order_value,
           coalesce(sum(o.amount_paid),0)::numeric paid_value
    from public.orders o
    where o.tenant_id=p_tenant_id
      and o.created_at>=v_since
      and public.sellertray_user_can_read_report_branch(p_tenant_id,o.branch_id,v_user_id)
    group by (o.created_at at time zone 'UTC')::date
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
    'channel',x.source,'orders',x.orders,'orderValue',x.order_value,'paidValue',x.paid_value
  ) order by x.order_value desc,x.orders desc,x.source),'[]'::jsonb)
  into v_channels
  from (
    select o.source,count(*)::int orders,
           coalesce(sum(o.total_amount) filter (where o.status not in ('rejected','cancelled')),0)::numeric order_value,
           coalesce(sum(o.amount_paid),0)::numeric paid_value
    from public.orders o
    where o.tenant_id=p_tenant_id
      and o.created_at>=v_since
      and public.sellertray_user_can_read_report_branch(p_tenant_id,o.branch_id,v_user_id)
    group by o.source
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
    'method',x.method_type,'attempts',x.attempts,'confirmed',x.confirmed,
    'confirmedValue',x.confirmed_value,'pendingVerification',x.pending_verification,'failed',x.failed
  ) order by x.confirmed_value desc,x.attempts desc,x.method_type),'[]'::jsonb)
  into v_methods
  from (
    select op.method_type,count(*)::int attempts,
           count(*) filter (where op.status='confirmed')::int confirmed,
           coalesce(sum(op.amount) filter (where op.status='confirmed'),0)::numeric confirmed_value,
           count(*) filter (where op.status='pending_verification')::int pending_verification,
           count(*) filter (where op.status='failed')::int failed
    from public.order_payments op
    join public.orders o on o.tenant_id=op.tenant_id and o.id=op.order_id
    where op.tenant_id=p_tenant_id
      and op.created_at>=v_since
      and public.sellertray_user_can_read_report_branch(p_tenant_id,o.branch_id,v_user_id)
    group by op.method_type
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
    'customerId',x.customer_id,'customerName',x.customer_name,'orders',x.orders,
    'orderValue',x.order_value,'paidValue',x.paid_value,'lastOrderAt',x.last_order_at
  ) order by x.order_value desc,x.orders desc,x.last_order_at desc),'[]'::jsonb)
  into v_customers
  from (
    select o.customer_id,coalesce(c.display_name,c.phone,c.wa_id,'Customer') customer_name,
           count(*)::int orders,
           coalesce(sum(o.total_amount) filter (where o.status not in ('rejected','cancelled')),0)::numeric order_value,
           coalesce(sum(o.amount_paid),0)::numeric paid_value,
           max(o.created_at) last_order_at
    from public.orders o
    left join public.customers c on c.tenant_id=o.tenant_id and c.id=o.customer_id
    where o.tenant_id=p_tenant_id
      and o.created_at>=v_since
      and public.sellertray_user_can_read_report_branch(p_tenant_id,o.branch_id,v_user_id)
    group by o.customer_id,coalesce(c.display_name,c.phone,c.wa_id,'Customer')
    order by order_value desc,orders desc,last_order_at desc
    limit 10
  ) x;

  with period_purchase as (
    select po.id,po.status,po.total_amount
    from public.sellertray_purchase_orders po
    where po.tenant_id=p_tenant_id
      and po.created_at>=v_since
      and public.sellertray_user_can_read_report_branch(p_tenant_id,po.branch_id,v_user_id)
  ),
  period_payment as (
    select p.amount
    from public.sellertray_supplier_payments p
    where p.tenant_id=p_tenant_id
      and p.paid_at>=v_since
      and public.sellertray_user_can_read_report_branch(p_tenant_id,p.branch_id,v_user_id)
      and not exists(
        select 1 from public.sellertray_supplier_payment_reversals r
        where r.tenant_id=p.tenant_id and r.payment_id=p.id
      )
  ),
  current_outstanding as (
    select coalesce(sum(greatest(
      po.total_amount-public.sellertray_purchase_paid_amount(po.tenant_id,po.id),0
    )),0)::numeric amount
    from public.sellertray_purchase_orders po
    where po.tenant_id=p_tenant_id
      and po.status in ('ordered','partially_received','received')
      and public.sellertray_user_can_read_report_branch(p_tenant_id,po.branch_id,v_user_id)
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
    'status',x.status,'purchaseOrders',x.purchase_orders,'purchaseValue',x.purchase_value
  ) order by x.status),'[]'::jsonb)
  into v_purchase_status
  from (
    select po.status,count(*)::int purchase_orders,
           coalesce(sum(po.total_amount),0)::numeric purchase_value
    from public.sellertray_purchase_orders po
    where po.tenant_id=p_tenant_id
      and po.created_at>=v_since
      and public.sellertray_user_can_read_report_branch(p_tenant_id,po.branch_id,v_user_id)
    group by po.status
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
    'branchId',x.branch_id,'branchCode',x.branch_code,'branchName',x.branch_name,
    'isActive',x.is_active,'purchaseOrders',x.purchase_orders,'purchaseValue',x.purchase_value,
    'receivedPurchaseOrders',x.received_purchase_orders,'receivedValue',x.received_value,
    'supplierPaidValue',x.supplier_paid_value
  ) order by x.purchase_value desc,x.purchase_orders desc,x.branch_name),'[]'::jsonb)
  into v_branch_procurement
  from (
    select b.id branch_id,b.code branch_code,b.name branch_name,b.is_active,
      coalesce(p.purchase_orders,0)::int purchase_orders,
      coalesce(p.purchase_value,0)::numeric purchase_value,
      coalesce(p.received_purchase_orders,0)::int received_purchase_orders,
      coalesce(p.received_value,0)::numeric received_value,
      coalesce(pay.supplier_paid_value,0)::numeric supplier_paid_value
    from public.branches b
    left join (
      select po.branch_id,
        count(*) filter (where po.status in ('ordered','partially_received','received'))::int purchase_orders,
        coalesce(sum(po.total_amount) filter (where po.status in ('ordered','partially_received','received')),0)::numeric purchase_value,
        count(*) filter (where po.status='received')::int received_purchase_orders,
        coalesce(sum(po.total_amount) filter (where po.status='received'),0)::numeric received_value
      from public.sellertray_purchase_orders po
      where po.tenant_id=p_tenant_id and po.created_at>=v_since
      group by po.branch_id
    ) p on p.branch_id=b.id
    left join (
      select sp.branch_id,coalesce(sum(sp.amount),0)::numeric supplier_paid_value
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
      and public.sellertray_user_can_read_report_branch(p_tenant_id,b.id,v_user_id)
  ) x;

  with per_purchase as (
    select po.supplier_id,po.currency,po.total_amount,
           public.sellertray_purchase_paid_amount(po.tenant_id,po.id) as paid
    from public.sellertray_purchase_orders po
    where po.tenant_id=p_tenant_id
      and po.status in ('ordered','partially_received','received')
      and public.sellertray_user_can_read_report_branch(p_tenant_id,po.branch_id,v_user_id)
  ), supplier_state as (
    select s.id supplier_id,s.name supplier_name,
           coalesce(max(pp.currency),(select t.currency from public.tenants t where t.id=p_tenant_id),'NGN')::text currency,
           coalesce(sum(pp.total_amount),0)::numeric(14,2) purchase_total,
           coalesce(sum(pp.paid),0)::numeric(14,2) paid_amount,
           coalesce(sum(greatest(pp.total_amount-pp.paid,0)),0)::numeric(14,2) outstanding_amount,
           count(pp.total_amount) purchase_count
    from public.sellertray_suppliers s
    left join per_purchase pp on pp.supplier_id=s.id
    where s.tenant_id=p_tenant_id
    group by s.id,s.name
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'supplierId',s.supplier_id,'supplierName',s.supplier_name,'currency',s.currency,
    'purchaseTotal',s.purchase_total,'paidAmount',s.paid_amount,
    'outstandingAmount',s.outstanding_amount,'purchaseCount',s.purchase_count
  ) order by s.outstanding_amount desc,s.purchase_total desc,s.supplier_name),'[]'::jsonb)
  into v_supplier_outstanding
  from supplier_state s
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

revoke all on function public.sellertray_report_center(uuid,integer) from public,anon;
grant execute on function public.sellertray_report_center(uuid,integer) to authenticated,service_role;

commit;
