begin;

-- Merchant Web profitability is a bounded, set-based projection of the same
-- posted order/return and immutable valuation evidence as the existing
-- get_sellertray_order_profitability(uuid,uuid) authority. No new cost truth.
create or replace function public.get_sellertray_profitability_report(
  p_tenant_id uuid,
  p_date_from date default null,
  p_date_to date default null,
  p_branch_id uuid default null,
  p_source text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_timezone text;
  v_currency text;
  v_date_from date;
  v_date_to date;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_source text := nullif(lower(btrim(coalesce(p_source,''))),'');
  v_result jsonb;
begin
  if p_tenant_id is null or v_user_id is null then
    raise exception 'SellerTray authentication and Business are required' using errcode='42501';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;

  if v_role not in ('owner','manager')
     or not public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_view_reports') then
    raise exception 'Merchant Web reports are available to Owners and Managers'
      using errcode='42501';
  end if;

  select coalesce(nullif(t.timezone,''),'Africa/Lagos'),upper(t.currency)
  into v_timezone,v_currency
  from public.tenants t where t.id=p_tenant_id;
  if v_timezone is null or v_currency is null then
    raise exception 'Business not found' using errcode='P0002';
  end if;

  v_date_to := coalesce(p_date_to,(now() at time zone v_timezone)::date);
  v_date_from := coalesce(p_date_from,v_date_to-29);
  if v_date_from>v_date_to or (v_date_to-v_date_from)>365 then
    raise exception 'Choose a valid report range of up to 366 days' using errcode='22023';
  end if;

  v_source := nullif(v_source,'all');
  if v_source is not null and v_source not in ('pos','whatsapp','manual') then
    raise exception 'Unsupported sales channel' using errcode='22023';
  end if;

  if p_branch_id is not null then
    if not exists(select 1 from public.branches b
                  where b.tenant_id=p_tenant_id and b.id=p_branch_id) then
      raise exception 'Branch not found' using errcode='P0002';
    end if;
    if not public.sellertray_user_can_read_report_branch(p_tenant_id,p_branch_id,v_user_id) then
      raise exception 'You do not have access to reports for this Branch'
        using errcode='42501';
    end if;
  end if;

  v_start_at := v_date_from::timestamp at time zone v_timezone;
  v_end_at := (v_date_to+1)::timestamp at time zone v_timezone;

  -- Never sum dissimilar currencies under a single Business total.
  if exists (
    select 1 from public.orders o
    where o.tenant_id=p_tenant_id and o.deleted_at is null and o.status='completed'
      and o.created_at>=v_start_at and o.created_at<v_end_at
      and (p_branch_id is null or o.branch_id=p_branch_id)
      and (v_source is null or o.source=v_source)
      and public.sellertray_user_can_read_report_branch(p_tenant_id,o.branch_id,v_user_id)
      and o.currency is distinct from v_currency
  ) then
    raise exception 'Sales use different currencies and cannot be combined'
      using errcode='22023';
  end if;

  with completed_sales as materialized (
    select o.id,o.branch_id,o.currency,o.source,o.tax_posted_at,
           o.subtotal_amount,o.total_amount,o.returned_amount
    from public.orders o
    where o.tenant_id=p_tenant_id
      and o.deleted_at is null
      and o.status='completed'
      and o.created_at>=v_start_at and o.created_at<v_end_at
      and (p_branch_id is null or o.branch_id=p_branch_id)
      and (v_source is null or o.source=v_source)
      and public.sellertray_user_can_read_report_branch(p_tenant_id,o.branch_id,v_user_id)
  ),
  completed_returns as (
    select sr.order_id,
           count(*)::integer as return_count,
           coalesce(sum(coalesce(sr.subtotal_amount,sr.amount)),0)::numeric(24,6)
             as return_subtotal
    from public.sale_returns sr
    join completed_sales s on s.id=sr.order_id
    where sr.tenant_id=p_tenant_id and sr.status='completed'
    group by sr.order_id
  ),
  order_movements as materialized (
    select s.id as order_id,im.id as movement_id,im.movement_type
    from completed_sales s
    join public.inventory_movements im on im.tenant_id=p_tenant_id
      and (
        (im.movement_type='sale'
          and im.reference_type='order' and im.reference_id=s.id::text)
        or (im.movement_type in ('sale_return','reversal')
          and im.metadata->>'order_id'=s.id::text)
      )
  ),
  historical_cost as (
    select m.order_id,
           count(*) filter (where m.movement_type='sale')::integer as sale_movements,
           count(*) filter (where m.movement_type in ('sale_return','reversal'))::integer
             as return_movements,
           count(*) filter (
             where ve.movement_id is null or ve.cogs_amount is null
               or ve.cogs_complete is distinct from true
           )::integer as unvalued_movements,
           coalesce(sum(ve.cogs_amount),0)::numeric(24,6) as known_cogs
    from order_movements m
    left join public.sellertray_inventory_valuation_entries ve
      on ve.tenant_id=p_tenant_id and ve.movement_id=m.movement_id
    group by m.order_id
  ),
  facts as materialized (
    select s.id as order_id,s.branch_id,
           case when s.tax_posted_at is not null
             then (coalesce(s.subtotal_amount,0)-coalesce(r.return_subtotal,0))
             else (coalesce(s.total_amount,0)-coalesce(s.returned_amount,0))
           end::numeric(24,6) as net_revenue,
           coalesce(c.known_cogs,0)::numeric(24,6) as known_cogs,
           (
             coalesce(c.sale_movements,0)>0
             and coalesce(c.unvalued_movements,0)=0
             and coalesce(c.return_movements,0)>=coalesce(r.return_count,0)
           ) as cost_complete
    from completed_sales s
    left join historical_cost c on c.order_id=s.id
    left join completed_returns r on r.order_id=s.id
  ),
  summary as (
    select count(*)::integer as sales_count,
           count(*) filter (where cost_complete)::integer as complete_sales,
           count(*) filter (where not cost_complete)::integer as incomplete_sales,
           coalesce(sum(net_revenue),0)::numeric(24,6) as net_revenue,
           coalesce(sum(known_cogs),0)::numeric(24,6) as known_cogs
    from facts
  ),
  by_branch as (
    select f.branch_id,b.name as branch_name,
           count(*)::integer as sales_count,
           count(*) filter (where not f.cost_complete)::integer as incomplete_sales,
           coalesce(sum(f.net_revenue),0)::numeric(24,6) as net_revenue,
           coalesce(sum(f.known_cogs),0)::numeric(24,6) as known_cogs
    from facts f
    join public.branches b on b.tenant_id=p_tenant_id and b.id=f.branch_id
    group by f.branch_id,b.name
  )
  select jsonb_build_object(
    'dateFrom',v_date_from,
    'dateTo',v_date_to,
    'timezone',v_timezone,
    'currency',v_currency,
    'scope','completed_sales_created_in_period_returns_to_date',
    'summary',(
      select jsonb_build_object(
        'salesCount',s.sales_count,
        'fullyCostedSales',s.complete_sales,
        'incompleteCostSales',s.incomplete_sales,
        'costComplete',s.incomplete_sales=0,
        'netRevenue',s.net_revenue,
        'knownCogs',s.known_cogs,
        'grossProfit',case when s.incomplete_sales=0
          then s.net_revenue-s.known_cogs else null end,
        'grossMarginPercent',case when s.incomplete_sales=0 and s.net_revenue<>0
          then round((s.net_revenue-s.known_cogs)*100/s.net_revenue,6)
          else null end
      ) from summary s
    ),
    'branches',coalesce((
      select jsonb_agg(jsonb_build_object(
        'branchId',b.branch_id,
        'branchName',b.branch_name,
        'salesCount',b.sales_count,
        'incompleteCostSales',b.incomplete_sales,
        'costComplete',b.incomplete_sales=0,
        'netRevenue',b.net_revenue,
        'knownCogs',b.known_cogs,
        'grossProfit',case when b.incomplete_sales=0
          then b.net_revenue-b.known_cogs else null end,
        'grossMarginPercent',case when b.incomplete_sales=0 and b.net_revenue<>0
          then round((b.net_revenue-b.known_cogs)*100/b.net_revenue,6)
          else null end
      ) order by b.net_revenue desc,b.branch_name)
      from by_branch b
    ),'[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$;

revoke all on function public.get_sellertray_profitability_report(uuid,date,date,uuid,text)
  from public,anon,authenticated;
grant execute on function public.get_sellertray_profitability_report(uuid,date,date,uuid,text)
  to authenticated,service_role;

commit;
