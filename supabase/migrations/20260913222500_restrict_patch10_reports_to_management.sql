-- SellerTray Patch 10: business reports are management-only.

create or replace function public.sellertray_report_summary(p_tenant_id uuid,p_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_days integer := greatest(1,least(coalesce(p_days,30),365));
  v_since timestamptz;
  v_result jsonb;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;

  if v_role not in ('owner','manager') then
    raise exception 'Owner or Manager access is required for business reports';
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
    where o.tenant_id=p_tenant_id and o.created_at>=v_since
  ),
  payment_method_stats as (
    select op.method_type,count(*)::int as method_count
    from public.order_payments op
    where op.tenant_id=p_tenant_id and op.created_at>=v_since
    group by op.method_type
  ),
  payment_stats as (
    select
      count(*) filter (where op.status='pending_verification')::int as verification_required,
      count(*) filter (where op.status='failed')::int as failed,
      count(*) filter (where op.exception_state<>'none')::int as exceptions
    from public.order_payments op
    where op.tenant_id=p_tenant_id and op.created_at>=v_since
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
      where oi.tenant_id=p_tenant_id and o.created_at>=v_since and o.status not in ('rejected','cancelled')
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

revoke all on function public.sellertray_report_summary(uuid,integer) from public, anon;
grant execute on function public.sellertray_report_summary(uuid,integer) to authenticated, service_role;
