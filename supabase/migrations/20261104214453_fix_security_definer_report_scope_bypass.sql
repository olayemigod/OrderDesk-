begin;

-- Fix confirmed SECURITY DEFINER owner-identity bypass:
-- current_user = postgres inside these functions even for authenticated users.
-- Drop only the owner-identity exemption. Retain protected service_role JWT
-- operation and authenticated Branch/report capability validation.
-- No stock/valuation/COGS/history calculations are changed.
do $precheck$
begin
  if (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.prosecdef
        and p.proname in ('get_sellertray_branch_stock_as_of','get_sellertray_branch_stock_valuation','get_sellertray_order_profitability')
        and p.prosrc ~* 'current_user[[:space:]]*<>[[:space:]]*''postgres''') <> 3 then
    raise exception 'Unexpected reporting RPC authority; reconcile before applying security correction';
  end if;
end;
$precheck$;

CREATE OR REPLACE FUNCTION public.get_sellertray_branch_stock_as_of(p_tenant_id uuid, p_branch_id uuid, p_as_of timestamp with time zone)
 RETURNS TABLE(catalog_item_id uuid, item_name text, sku text, category text, stock_uom text, quantity_on_hand numeric, last_movement_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_tenant_id is null or p_branch_id is null or p_as_of is null then
    raise exception 'Business, Branch and as-of time are required' using errcode='22023';
  end if;
  if coalesce((select auth.role()),'')<>'service_role'
     and not public.sellertray_current_user_can_read_branch(p_tenant_id,p_branch_id) then
    raise exception 'You do not have access to this Branch' using errcode='42501';
  end if;

  return query
  select ci.id,ci.name,ci.sku,ci.category,ci.stock_uom,
         coalesce(sum(im.quantity_delta),0)::numeric,
         max(im.business_at)
  from public.catalog_items ci
  left join public.inventory_movements im
    on im.tenant_id=ci.tenant_id and im.catalog_item_id=ci.id
   and im.branch_id=p_branch_id and im.business_at<=p_as_of
  where ci.tenant_id=p_tenant_id
    and (ci.is_active or im.id is not null)
  group by ci.id,ci.name,ci.sku,ci.category,ci.stock_uom
  order by ci.name,ci.id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_sellertray_branch_stock_valuation(p_tenant_id uuid, p_branch_id uuid, p_as_of timestamp with time zone DEFAULT now())
 RETURNS TABLE(catalog_item_id uuid, item_name text, sku text, category text, stock_uom text, currency text, quantity_on_hand numeric, valued_quantity_on_hand numeric, unvalued_quantity_on_hand numeric, known_inventory_value numeric, average_unit_cost numeric, valuation_status text, last_movement_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
begin
  if p_tenant_id is null or p_branch_id is null or p_as_of is null then
    raise exception 'Business, Branch and as-of time are required' using errcode='22023';
  end if;
  if coalesce((select auth.role()),'')<>'service_role' then
    if v_user_id is null
       or not public.sellertray_current_user_can_read_branch(p_tenant_id,p_branch_id)
       or not public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_view_reports') then
      raise exception 'You do not have permission to view inventory valuation for this Branch' using errcode='42501';
    end if;
  end if;

  return query
  with latest_position as (
    select distinct on (ve.stock_location_id,ve.catalog_item_id)
      ve.stock_location_id,ve.catalog_item_id,ve.currency,
      ve.quantity_balance,ve.valued_quantity_balance,ve.unvalued_quantity_balance,
      ve.known_value_balance,ve.business_at,ve.movement_created_at,ve.movement_id
    from public.sellertray_inventory_valuation_entries ve
    where ve.tenant_id=p_tenant_id and ve.branch_id=p_branch_id and ve.business_at<=p_as_of
    order by ve.stock_location_id,ve.catalog_item_id,ve.business_at desc,ve.movement_created_at desc,ve.movement_id desc
  ), aggregated as (
    select lp.catalog_item_id,max(lp.currency) currency,
           sum(lp.quantity_balance)::numeric quantity_on_hand,
           sum(lp.valued_quantity_balance)::numeric valued_quantity_on_hand,
           sum(lp.unvalued_quantity_balance)::numeric unvalued_quantity_on_hand,
           sum(lp.known_value_balance)::numeric known_inventory_value,
           max(lp.business_at) last_movement_at
    from latest_position lp
    group by lp.catalog_item_id
  )
  select ci.id,ci.name,ci.sku,ci.category,ci.stock_uom,a.currency,
         a.quantity_on_hand,a.valued_quantity_on_hand,a.unvalued_quantity_on_hand,
         a.known_inventory_value,
         case when a.quantity_on_hand>0 and abs(a.unvalued_quantity_on_hand)<=0.000001
              then round((a.known_inventory_value/a.quantity_on_hand)::numeric,8) else null end,
         case when abs(a.quantity_on_hand)<=0.000001 then 'empty'
              when a.quantity_on_hand<0 then 'unvalued'
              when abs(a.unvalued_quantity_on_hand)<=0.000001 then 'valued'
              when a.valued_quantity_on_hand<=0.000001 then 'unvalued'
              else 'partial' end,
         a.last_movement_at
  from aggregated a
  join public.catalog_items ci on ci.tenant_id=p_tenant_id and ci.id=a.catalog_item_id
  order by ci.name,ci.id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_sellertray_order_profitability(p_tenant_id uuid, p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order public.orders%rowtype;
  v_user_id uuid := auth.uid();
  v_cogs numeric(24,6) := 0;
  v_entry_count integer := 0;
  v_incomplete integer := 0;
  v_sale_count integer := 0;
  v_return_subtotal numeric(24,6) := 0;
  v_net_revenue numeric(24,6);
  v_complete boolean;
  v_profit numeric(24,6);
  v_margin numeric(18,6);
begin
  select * into v_order from public.orders o
  where o.tenant_id=p_tenant_id and o.id=p_order_id;
  if not found or v_order.branch_id is null then
    raise exception 'Sale not found' using errcode='22023';
  end if;
  if coalesce((select auth.role()),'')<>'service_role' then
    if v_user_id is null
       or not public.sellertray_current_user_can_read_branch(p_tenant_id,v_order.branch_id)
       or not public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_view_reports') then
      raise exception 'You do not have permission to view profitability for this sale' using errcode='42501';
    end if;
  end if;

  select count(*)::integer,
         coalesce(sum(ve.cogs_amount),0)::numeric(24,6),
         count(*) filter (where ve.cogs_complete is false)::integer
  into v_entry_count,v_cogs,v_incomplete
  from public.sellertray_inventory_valuation_entries ve
  join public.inventory_movements im on im.id=ve.movement_id
  where im.tenant_id=p_tenant_id
    and ve.cogs_amount is not null
    and (
      (im.movement_type='sale' and im.reference_type='order' and im.reference_id=p_order_id::text)
      or (im.movement_type in ('sale_return','reversal') and im.metadata->>'order_id'=p_order_id::text)
    );

  select count(*)::integer into v_sale_count
  from public.inventory_movements im
  where im.tenant_id=p_tenant_id and im.movement_type='sale'
    and im.reference_type='order' and im.reference_id=p_order_id::text;

  if v_order.tax_posted_at is not null then
    select coalesce(sum(coalesce(sr.subtotal_amount,sr.amount)),0)::numeric(24,6)
    into v_return_subtotal
    from public.sale_returns sr
    where sr.tenant_id=p_tenant_id
      and sr.order_id=p_order_id
      and sr.status='completed';
    v_net_revenue := (coalesce(v_order.subtotal_amount,0)-v_return_subtotal)::numeric(24,6);
  else
    v_net_revenue := (coalesce(v_order.total_amount,0)-coalesce(v_order.returned_amount,0))::numeric(24,6);
  end if;

  v_complete := v_sale_count>0 and v_entry_count>=v_sale_count and v_incomplete=0;
  if v_complete then
    v_profit:=v_net_revenue-v_cogs;
    v_margin:=case when v_net_revenue<>0 then round((v_profit*100/v_net_revenue)::numeric,6) else null end;
  end if;

  return jsonb_build_object(
    'orderId',v_order.id,
    'publicOrderId',v_order.public_order_id,
    'branchId',v_order.branch_id,
    'currency',v_order.currency,
    'netRevenue',v_net_revenue,
    'knownCogs',v_cogs,
    'cogsComplete',v_complete,
    'grossProfit',v_profit,
    'grossMarginPercent',v_margin
  );
end;
$function$;

do $verify$
begin
  if (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.prosecdef
        and p.proname in ('get_sellertray_branch_stock_as_of','get_sellertray_branch_stock_valuation','get_sellertray_order_profitability')
        and p.prosrc !~* 'current_user[[:space:]]*<>[[:space:]]*''postgres'''
        and p.prosrc like '%service_role%') <> 3 then
    raise exception 'Reporting RPC scope enforcement is incomplete';
  end if;
end;
$verify$;

commit;
