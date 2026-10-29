begin;

create or replace function public.get_sellertray_report_management(
  p_tenant_id uuid,
  p_date_from date default null,
  p_date_to date default null,
  p_branch_id uuid default null,
  p_source text default null,
  p_payment_method text default null
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
  v_timezone text;
  v_currency text;
  v_date_to date;
  v_date_from date;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_source text := nullif(lower(btrim(coalesce(p_source,''))),'');
  v_payment_method text := nullif(lower(btrim(coalesce(p_payment_method,''))),'');
  v_summary jsonb;
  v_attention jsonb;
  v_branches jsonb;
  v_trend jsonb;
  v_channels jsonb;
  v_methods jsonb;
  v_customers jsonb;
  v_products jsonb;
  v_categories jsonb;
  v_staff jsonb;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if p_tenant_id is null then
    raise exception 'Business is required' using errcode='22023';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;

  if v_role not in ('owner','manager')
     or not public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_view_reports') then
    raise exception 'Merchant Web reports are available to Owners and Managers' using errcode='42501';
  end if;

  select coalesce(nullif(t.timezone,''),'Africa/Lagos'),upper(t.currency)
  into v_timezone,v_currency
  from public.tenants t
  where t.id=p_tenant_id;

  if v_timezone is null then
    raise exception 'Business not found' using errcode='P0002';
  end if;

  v_date_to := coalesce(p_date_to,(now() at time zone v_timezone)::date);
  v_date_from := coalesce(p_date_from,v_date_to-29);
  if v_date_from>v_date_to then
    raise exception 'Report date range is invalid' using errcode='22023';
  end if;
  if (v_date_to-v_date_from)>365 then
    raise exception 'Report date range cannot exceed 366 days' using errcode='22023';
  end if;

  v_start_at := v_date_from::timestamp at time zone v_timezone;
  v_end_at := (v_date_to+1)::timestamp at time zone v_timezone;

  if v_source='all' then v_source:=null; end if;
  if v_source is not null and v_source not in ('pos','whatsapp','manual') then
    raise exception 'Unsupported sales channel' using errcode='22023';
  end if;
  if v_payment_method='all' then v_payment_method:=null; end if;
  if v_payment_method is not null and char_length(v_payment_method)>80 then
    raise exception 'Payment method filter is invalid' using errcode='22023';
  end if;

  if p_branch_id is not null then
    if not exists(
      select 1 from public.branches b
      where b.tenant_id=p_tenant_id and b.id=p_branch_id
    ) then
      raise exception 'Branch not found' using errcode='P0002';
    end if;
    if not public.sellertray_user_can_read_report_branch(p_tenant_id,p_branch_id,v_user_id) then
      raise exception 'You do not have access to reports for this Branch' using errcode='42501';
    end if;
  end if;

  with sales_scope as materialized (
    select o.*
    from public.orders o
    where o.tenant_id=p_tenant_id
      and o.deleted_at is null
      and o.status='completed'
      and o.created_at>=v_start_at
      and o.created_at<v_end_at
      and public.sellertray_user_can_read_report_branch(p_tenant_id,o.branch_id,v_user_id)
      and (p_branch_id is null or o.branch_id=p_branch_id)
      and (v_source is null or o.source=v_source)
      and (
        v_payment_method is null
        or exists(
          select 1 from public.order_payments op
          where op.tenant_id=o.tenant_id
            and op.order_id=o.id
            and lower(op.method_type)=v_payment_method
        )
      )
  )
  select jsonb_build_object(
    'salesCount',count(*)::integer,
    'salesValue',coalesce(sum(coalesce(total_amount,0)),0),
    'collectedValue',coalesce(sum(coalesce(amount_paid,0)),0),
    'returnedValue',coalesce(sum(coalesce(returned_amount,0)),0),
    'averageSale',case when count(*)>0 then coalesce(sum(coalesce(total_amount,0)),0)/count(*) else 0 end,
    'whatsappSales',count(*) filter (where source='whatsapp')::integer
  ) into v_summary
  from sales_scope;

  with accessible_branches as materialized (
    select b.id
    from public.branches b
    where b.tenant_id=p_tenant_id
      and public.sellertray_user_can_read_report_branch(p_tenant_id,b.id,v_user_id)
      and (p_branch_id is null or b.id=p_branch_id)
  ),
  payment_attention as (
    select
      count(*) filter (where op.status='pending_verification')::integer as verification_required,
      count(*) filter (where op.status='failed' or op.exception_state<>'none')::integer as payment_issues
    from public.order_payments op
    join public.orders o on o.tenant_id=op.tenant_id and o.id=op.order_id
    join accessible_branches ab on ab.id=o.branch_id
    where op.tenant_id=p_tenant_id
      and o.deleted_at is null
      and o.status<>'draft'
      and o.status not in ('rejected','cancelled')
      and (v_source is null or o.source=v_source)
      and (v_payment_method is null or lower(op.method_type)=v_payment_method)
  ),
  order_attention as (
    select
      count(*) filter (
        where o.status not in ('completed','rejected','cancelled')
          and o.payment_status in ('unpaid','pending','verification_required','payment_issue')
      )::integer as awaiting_payment,
      count(*) filter (where o.status='ready' and o.fulfillment_status='unassigned')::integer as awaiting_fulfillment
    from public.orders o
    join accessible_branches ab on ab.id=o.branch_id
    where o.tenant_id=p_tenant_id
      and o.deleted_at is null
      and o.status<>'draft'
      and (v_source is null or o.source=v_source)
  ),
  cash_attention as (
    select
      count(*) filter (where cs.status='open')::integer as open_shifts,
      count(distinct cs.branch_id) filter (
        where cs.status='closed' and abs(coalesce(cs.variance,0))>=0.01
      )::integer as cash_variance_branches
    from public.sellertray_cash_shifts cs
    join accessible_branches ab on ab.id=cs.branch_id
    where cs.tenant_id=p_tenant_id
  ),
  transfer_attention as (
    select count(*)::integer as open_transfers
    from public.stock_transfers st
    where st.tenant_id=p_tenant_id
      and st.status in ('draft','dispatched')
      and (
        (p_branch_id is not null and (st.source_branch_id=p_branch_id or st.destination_branch_id=p_branch_id))
        or (
          p_branch_id is null
          and (
            public.sellertray_user_can_read_report_branch(p_tenant_id,st.source_branch_id,v_user_id)
            or public.sellertray_user_can_read_report_branch(p_tenant_id,st.destination_branch_id,v_user_id)
          )
        )
      )
  ),
  stock_attention as (
    select
      count(*) filter (
        where q.quantity_on_hand>0
          and q.quantity_on_hand<=coalesce(bip.low_stock_threshold,0)
      )::integer as low_stock_items,
      count(*) filter (where q.quantity_on_hand<=0)::integer as out_of_stock_items
    from accessible_branches ab
    cross join lateral public.get_sellertray_branch_stock_as_of(p_tenant_id,ab.id,now()) q
    left join public.branch_inventory_policies bip
      on bip.tenant_id=p_tenant_id
     and bip.branch_id=ab.id
     and bip.catalog_item_id=q.catalog_item_id
  )
  select jsonb_build_object(
    'verificationRequired',pa.verification_required,
    'paymentIssues',pa.payment_issues,
    'awaitingPayment',oa.awaiting_payment,
    'awaitingFulfillment',oa.awaiting_fulfillment,
    'openShifts',ca.open_shifts,
    'cashVarianceBranches',ca.cash_variance_branches,
    'lowStockItems',sa.low_stock_items,
    'outOfStockItems',sa.out_of_stock_items,
    'openTransfers',ta.open_transfers,
    'total',
      pa.verification_required+pa.payment_issues+oa.awaiting_fulfillment+
      ca.open_shifts+ca.cash_variance_branches+sa.low_stock_items+
      sa.out_of_stock_items+ta.open_transfers
  ) into v_attention
  from payment_attention pa,order_attention oa,cash_attention ca,transfer_attention ta,stock_attention sa;

  with sales_scope as materialized (
    select o.*
    from public.orders o
    where o.tenant_id=p_tenant_id
      and o.deleted_at is null
      and o.status='completed'
      and o.created_at>=v_start_at and o.created_at<v_end_at
      and public.sellertray_user_can_read_report_branch(p_tenant_id,o.branch_id,v_user_id)
      and (p_branch_id is null or o.branch_id=p_branch_id)
      and (v_source is null or o.source=v_source)
      and (v_payment_method is null or exists(
        select 1 from public.order_payments op
        where op.tenant_id=o.tenant_id and op.order_id=o.id and lower(op.method_type)=v_payment_method
      ))
  ),
  shift_stats as (
    select cs.branch_id,
      count(*) filter (where cs.status in ('closed','reviewed'))::integer as closed_shifts,
      coalesce(sum(cs.variance) filter (where cs.status in ('closed','reviewed')),0)::numeric as cash_variance
    from public.sellertray_cash_shifts cs
    where cs.tenant_id=p_tenant_id
      and cs.opened_at>=v_start_at and cs.opened_at<v_end_at
      and public.sellertray_user_can_read_report_branch(p_tenant_id,cs.branch_id,v_user_id)
      and (p_branch_id is null or cs.branch_id=p_branch_id)
    group by cs.branch_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'branchId',b.id,
    'branchCode',b.code,
    'branchName',b.name,
    'isActive',b.is_active,
    'salesCount',coalesce(x.sales_count,0),
    'salesValue',coalesce(x.sales_value,0),
    'collectedValue',coalesce(x.collected_value,0),
    'returnedValue',coalesce(x.returned_value,0),
    'whatsappSales',coalesce(x.whatsapp_sales,0),
    'closedShifts',coalesce(s.closed_shifts,0),
    'cashVariance',coalesce(s.cash_variance,0)
  ) order by coalesce(x.sales_value,0) desc,coalesce(x.sales_count,0) desc,b.name),'[]'::jsonb)
  into v_branches
  from public.branches b
  left join (
    select o.branch_id,
      count(*)::integer as sales_count,
      coalesce(sum(coalesce(o.total_amount,0)),0)::numeric as sales_value,
      coalesce(sum(coalesce(o.amount_paid,0)),0)::numeric as collected_value,
      coalesce(sum(coalesce(o.returned_amount,0)),0)::numeric as returned_value,
      count(*) filter (where o.source='whatsapp')::integer as whatsapp_sales
    from sales_scope o
    group by o.branch_id
  ) x on x.branch_id=b.id
  left join shift_stats s on s.branch_id=b.id
  where b.tenant_id=p_tenant_id
    and public.sellertray_user_can_read_report_branch(p_tenant_id,b.id,v_user_id)
    and (p_branch_id is null or b.id=p_branch_id);

  with sales_scope as materialized (
    select o.*
    from public.orders o
    where o.tenant_id=p_tenant_id and o.deleted_at is null and o.status='completed'
      and o.created_at>=v_start_at and o.created_at<v_end_at
      and public.sellertray_user_can_read_report_branch(p_tenant_id,o.branch_id,v_user_id)
      and (p_branch_id is null or o.branch_id=p_branch_id)
      and (v_source is null or o.source=v_source)
      and (v_payment_method is null or exists(
        select 1 from public.order_payments op where op.tenant_id=o.tenant_id and op.order_id=o.id and lower(op.method_type)=v_payment_method
      ))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'date',x.business_date,
    'salesCount',x.sales_count,
    'salesValue',x.sales_value,
    'collectedValue',x.collected_value,
    'returnedValue',x.returned_value
  ) order by x.business_date),'[]'::jsonb)
  into v_trend
  from (
    select (o.created_at at time zone v_timezone)::date as business_date,
      count(*)::integer as sales_count,
      coalesce(sum(coalesce(o.total_amount,0)),0)::numeric as sales_value,
      coalesce(sum(coalesce(o.amount_paid,0)),0)::numeric as collected_value,
      coalesce(sum(coalesce(o.returned_amount,0)),0)::numeric as returned_value
    from sales_scope o
    group by (o.created_at at time zone v_timezone)::date
  ) x;

  with sales_scope as materialized (
    select o.*
    from public.orders o
    where o.tenant_id=p_tenant_id and o.deleted_at is null and o.status='completed'
      and o.created_at>=v_start_at and o.created_at<v_end_at
      and public.sellertray_user_can_read_report_branch(p_tenant_id,o.branch_id,v_user_id)
      and (p_branch_id is null or o.branch_id=p_branch_id)
      and (v_source is null or o.source=v_source)
      and (v_payment_method is null or exists(
        select 1 from public.order_payments op where op.tenant_id=o.tenant_id and op.order_id=o.id and lower(op.method_type)=v_payment_method
      ))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'channel',x.source,
    'salesCount',x.sales_count,
    'salesValue',x.sales_value,
    'collectedValue',x.collected_value
  ) order by x.sales_value desc,x.sales_count desc,x.source),'[]'::jsonb)
  into v_channels
  from (
    select o.source,count(*)::integer as sales_count,
      coalesce(sum(coalesce(o.total_amount,0)),0)::numeric as sales_value,
      coalesce(sum(coalesce(o.amount_paid,0)),0)::numeric as collected_value
    from sales_scope o group by o.source
  ) x;

  with sales_scope as materialized (
    select o.*
    from public.orders o
    where o.tenant_id=p_tenant_id and o.deleted_at is null and o.status='completed'
      and o.created_at>=v_start_at and o.created_at<v_end_at
      and public.sellertray_user_can_read_report_branch(p_tenant_id,o.branch_id,v_user_id)
      and (p_branch_id is null or o.branch_id=p_branch_id)
      and (v_source is null or o.source=v_source)
  )
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
      count(*)::integer as attempts,
      count(*) filter (where op.status='confirmed')::integer as confirmed,
      coalesce(sum(op.amount) filter (where op.status='confirmed'),0)::numeric as confirmed_value,
      count(*) filter (where op.status='pending_verification')::integer as pending_verification,
      count(*) filter (where op.status='failed')::integer as failed
    from public.order_payments op
    join sales_scope o on o.tenant_id=op.tenant_id and o.id=op.order_id
    where v_payment_method is null or lower(op.method_type)=v_payment_method
    group by op.method_type
  ) x;

  with sales_scope as materialized (
    select o.*
    from public.orders o
    where o.tenant_id=p_tenant_id and o.deleted_at is null and o.status='completed'
      and o.created_at>=v_start_at and o.created_at<v_end_at
      and public.sellertray_user_can_read_report_branch(p_tenant_id,o.branch_id,v_user_id)
      and (p_branch_id is null or o.branch_id=p_branch_id)
      and (v_source is null or o.source=v_source)
      and (v_payment_method is null or exists(
        select 1 from public.order_payments op where op.tenant_id=o.tenant_id and op.order_id=o.id and lower(op.method_type)=v_payment_method
      ))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'customerId',x.customer_id,
    'customerName',x.customer_name,
    'salesCount',x.sales_count,
    'salesValue',x.sales_value,
    'collectedValue',x.collected_value,
    'lastSaleAt',x.last_sale_at
  ) order by x.sales_value desc,x.sales_count desc,x.last_sale_at desc),'[]'::jsonb)
  into v_customers
  from (
    select o.customer_id,
      coalesce(nullif(btrim(c.display_name),''),nullif(btrim(c.phone),''),'Walk-in customer') as customer_name,
      count(*)::integer as sales_count,
      coalesce(sum(coalesce(o.total_amount,0)),0)::numeric as sales_value,
      coalesce(sum(coalesce(o.amount_paid,0)),0)::numeric as collected_value,
      max(o.created_at) as last_sale_at
    from sales_scope o
    left join public.customers c on c.tenant_id=o.tenant_id and c.id=o.customer_id
    where o.customer_id is not null
    group by o.customer_id,c.display_name,c.phone
    order by sales_value desc,sales_count desc,last_sale_at desc
    limit 20
  ) x;

  with sales_scope as materialized (
    select o.*
    from public.orders o
    where o.tenant_id=p_tenant_id and o.deleted_at is null and o.status='completed'
      and o.created_at>=v_start_at and o.created_at<v_end_at
      and public.sellertray_user_can_read_report_branch(p_tenant_id,o.branch_id,v_user_id)
      and (p_branch_id is null or o.branch_id=p_branch_id)
      and (v_source is null or o.source=v_source)
      and (v_payment_method is null or exists(
        select 1 from public.order_payments op where op.tenant_id=o.tenant_id and op.order_id=o.id and lower(op.method_type)=v_payment_method
      ))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'catalogItemId',x.catalog_item_id,
    'name',x.item_name,
    'stockUom',x.stock_uom,
    'stockQuantity',x.stock_quantity,
    'salesValue',x.sales_value
  ) order by x.sales_value desc,x.stock_quantity desc,x.item_name),'[]'::jsonb)
  into v_products
  from (
    select oi.catalog_item_id,
      oi.item_name,
      coalesce(ci.stock_uom,'unit') as stock_uom,
      sum(coalesce(oi.stock_quantity,oi.quantity))::numeric as stock_quantity,
      sum(coalesce(oi.line_total,oi.quantity*coalesce(oi.unit_price,0),0))::numeric as sales_value
    from public.order_items oi
    join sales_scope o on o.tenant_id=oi.tenant_id and o.id=oi.order_id
    left join public.catalog_items ci on ci.tenant_id=oi.tenant_id and ci.id=oi.catalog_item_id
    group by oi.catalog_item_id,oi.item_name,ci.stock_uom
    order by sales_value desc,stock_quantity desc,item_name
    limit 20
  ) x;

  with sales_scope as materialized (
    select o.*
    from public.orders o
    where o.tenant_id=p_tenant_id and o.deleted_at is null and o.status='completed'
      and o.created_at>=v_start_at and o.created_at<v_end_at
      and public.sellertray_user_can_read_report_branch(p_tenant_id,o.branch_id,v_user_id)
      and (p_branch_id is null or o.branch_id=p_branch_id)
      and (v_source is null or o.source=v_source)
      and (v_payment_method is null or exists(
        select 1 from public.order_payments op where op.tenant_id=o.tenant_id and op.order_id=o.id and lower(op.method_type)=v_payment_method
      ))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'category',x.category,
    'salesCount',x.sales_count,
    'salesValue',x.sales_value
  ) order by x.sales_value desc,x.sales_count desc,x.category),'[]'::jsonb)
  into v_categories
  from (
    select coalesce(nullif(btrim(ci.category),''),'Uncategorised') as category,
      count(distinct o.id)::integer as sales_count,
      sum(coalesce(oi.line_total,oi.quantity*coalesce(oi.unit_price,0),0))::numeric as sales_value
    from public.order_items oi
    join sales_scope o on o.tenant_id=oi.tenant_id and o.id=oi.order_id
    left join public.catalog_items ci on ci.tenant_id=oi.tenant_id and ci.id=oi.catalog_item_id
    group by coalesce(nullif(btrim(ci.category),''),'Uncategorised')
  ) x;

  with sales_scope as materialized (
    select o.*
    from public.orders o
    where o.tenant_id=p_tenant_id and o.deleted_at is null and o.status='completed'
      and o.created_at>=v_start_at and o.created_at<v_end_at
      and public.sellertray_user_can_read_report_branch(p_tenant_id,o.branch_id,v_user_id)
      and (p_branch_id is null or o.branch_id=p_branch_id)
      and (v_source is null or o.source=v_source)
      and (v_payment_method is null or exists(
        select 1 from public.order_payments op where op.tenant_id=o.tenant_id and op.order_id=o.id and lower(op.method_type)=v_payment_method
      ))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'staffUserId',x.pos_operator_user_id,
    'staffName',x.pos_operator_name,
    'salesCount',x.sales_count,
    'salesValue',x.sales_value,
    'collectedValue',x.collected_value
  ) order by x.sales_value desc,x.sales_count desc,x.pos_operator_name),'[]'::jsonb)
  into v_staff
  from (
    select o.pos_operator_user_id,o.pos_operator_name,
      count(*)::integer as sales_count,
      coalesce(sum(coalesce(o.total_amount,0)),0)::numeric as sales_value,
      coalesce(sum(coalesce(o.amount_paid,0)),0)::numeric as collected_value
    from sales_scope o
    where o.pos_operator_user_id is not null
    group by o.pos_operator_user_id,o.pos_operator_name
  ) x;

  return jsonb_build_object(
    'dateFrom',v_date_from,
    'dateTo',v_date_to,
    'timezone',v_timezone,
    'currency',v_currency,
    'filters',jsonb_build_object(
      'branchId',p_branch_id,
      'source',v_source,
      'paymentMethod',v_payment_method
    ),
    'summary',v_summary,
    'attention',v_attention,
    'branchPerformance',v_branches,
    'salesTrend',v_trend,
    'channels',v_channels,
    'paymentMethods',v_methods,
    'topCustomers',v_customers,
    'topProducts',v_products,
    'categoryPerformance',v_categories,
    'staffPerformance',v_staff
  );
end;
$$;

revoke all on function public.get_sellertray_report_management(uuid,date,date,uuid,text,text)
  from public,anon;
grant execute on function public.get_sellertray_report_management(uuid,date,date,uuid,text,text)
  to authenticated,service_role;

commit;