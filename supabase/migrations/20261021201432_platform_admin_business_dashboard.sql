begin;

create index if not exists platform_admin_completed_sales_period_idx
  on public.orders(created_at) where status='completed' and deleted_at is null;
create index if not exists platform_admin_installment_collection_period_idx
  on public.sellertray_commercial_installment_payment_confirmations(paid_at);

-- Read-only ProcessEdge analytics. No compatibility subscription fields,
-- checkout attempts, browser arithmetic or new financial ledger.
create or replace function public.platform_admin_business_summary(
  p_actor_user_id uuid, p_days integer default 30
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_now timestamptz := now();
  v_start timestamptz;
  v_previous timestamptz;
  v_result jsonb;
begin
  if not exists(select 1 from public.platform_admins where user_id=p_actor_user_id and role in ('admin','support')) then
    raise exception 'Platform administrator access required' using errcode='42501';
  end if;
  if p_days is null or p_days not in (7,30,90) then
    raise exception 'Business period must be 7, 30 or 90 days' using errcode='22023';
  end if;
  v_start := v_now-make_interval(days=>p_days);
  v_previous := v_start-make_interval(days=>p_days);
  with periods as (
    select 'current'::text period,v_start start_at,v_now end_at
    union all select 'previous',v_previous,v_start
  ), sales as materialized (
    select o.tenant_id,o.branch_id,o.currency,o.source,o.total_amount,o.created_at
    from public.orders o where o.deleted_at is null and o.status='completed'
      and o.created_at>=v_previous and o.created_at<v_now
  ), activations as materialized (
    select tenant_id,min(effective_from) activated_at
    from public.sellertray_commercial_entitlement_events
    where event_type='installment.provisional_activated' and effective_from<v_now
    group by tenant_id
  ), metrics as (
    select p.period,
      (select count(*) from public.tenants t where t.created_at>=p.start_at and t.created_at<p.end_at) new_merchants,
      (select count(*) from activations a where a.activated_at>=p.start_at and a.activated_at<p.end_at) new_activations,
      count(distinct s.tenant_id) transacting_merchants,count(distinct s.branch_id) transacting_branches,
      count(*) filter(where s.tenant_id is not null) completed_orders,
      count(*) filter(where s.source='pos') pos_orders,
      count(*) filter(where s.source='whatsapp') whatsapp_orders
    from periods p left join sales s on s.created_at>=p.start_at and s.created_at<p.end_at group by p.period,p.start_at,p.end_at
  ), currencies as (
    select currency from sales union select currency from public.sellertray_commercial_orders
    union select currency from public.sellertray_commercial_installment_payment_confirmations
    union select currency from public.sale_returns where status='completed' and created_at>=v_previous and created_at<v_now
  ), money as (
    select p.period,c.currency,
      coalesce((select sum(s.total_amount) from sales s where s.currency=c.currency and s.created_at>=p.start_at and s.created_at<p.end_at),0) merchant_gmv,
      coalesce((select sum(r.amount) from public.sale_returns r where r.status='completed' and r.currency=c.currency and r.created_at>=p.start_at and r.created_at<p.end_at),0) merchant_returns,
      coalesce((select sum(x.amount) from public.sellertray_commercial_installment_payment_confirmations x where x.currency=c.currency and x.paid_at>=p.start_at and x.paid_at<p.end_at),0) installment_collections,
      coalesce((select sum(o.total_gross_amount) from public.sellertray_commercial_orders o where o.currency=c.currency and o.ordered_at>=p.start_at and o.ordered_at<p.end_at),0) commercial_order_value
    from periods p cross join currencies c
  ), outstanding as (
    select o.currency,sum(greatest(o.obligated_amount-coalesce(p.paid,0),0)) balance
    from public.sellertray_commercial_installment_obligations o
    left join (select installment_obligation_id,sum(amount) paid from public.sellertray_commercial_installment_payment_confirmations where paid_at<v_now group by installment_obligation_id) p on p.installment_obligation_id=o.id
    group by o.currency
  )
  select jsonb_build_object(
    'generatedAt',v_now,'startAt',v_start,'previousStartAt',v_previous,'days',p_days,
    'totalMerchants',(select count(*) from public.tenants),
    'activatedMerchants',(select count(*) from activations),
    'whatsappConnected',(select count(*) from public.tenants where whatsapp_connection_status='connected'),
    'current',(select to_jsonb(m)-'period' from metrics m where period='current'),
    'previous',(select to_jsonb(m)-'period' from metrics m where period='previous'),
    'insights',jsonb_build_array(jsonb_build_object('code','transacting_change',
      'change',(select transacting_merchants from metrics where period='current')-(select transacting_merchants from metrics where period='previous'),
      'action','Review merchants','href','#merchants')),
    'money',coalesce((select jsonb_agg(to_jsonb(m) order by m.currency,m.period) from money m),'[]'::jsonb),
    'outstanding',coalesce((select jsonb_agg(to_jsonb(o) order by o.currency) from outstanding o),'[]'::jsonb),
    'coverage',jsonb_build_object('collections','Confirmed installment payments only; legacy subscription collections excluded.',
      'activation','Governed installment activations only; legacy activation history unavailable.',
      'gmv','Completed, non-deleted merchant orders by creation time; gross before returns and including applicable tax.',
      'revenue','Revenue recognition, run-rate, profit, FX consolidation and guarantee/refund exposure are not available.')
  ) into v_result;
  return v_result;
end $$;

create or replace function public.platform_admin_business_attention(p_actor_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;
begin
  if not exists(select 1 from public.platform_admins where user_id=p_actor_user_id and role in ('admin','support')) then
    raise exception 'Platform administrator access required' using errcode='42501';
  end if;
  with activity as (
    select tenant_id,max(created_at) last_sale from public.orders
    where status='completed' and deleted_at is null group by tenant_id
  ), entitlement as (
    -- Full release supersedes provisional expiry on the same order.
    select tenant_id,commercial_order_id,min(effective_from) activation_at,max(effective_until) active_until
    from public.sellertray_commercial_entitlement_events
    where event_type in ('installment.provisional_activated','installment.full_entitlement_released')
      and effective_from<=now() group by tenant_id,commercial_order_id
  ), signals as (
    select t.id tenant_id,t.name,'inactive_14d'::text signal,'Review merchant adoption'::text action
    from public.tenants t join entitlement e on e.tenant_id=t.id left join activity a on a.tenant_id=t.id
    where e.activation_at<=now()-interval '14 days' and coalesce(a.last_sale,e.activation_at)<=now()-interval '14 days'
    union
    select t.id,t.name,'entitlement_ending','Review subscription & billing'
    from public.tenants t join entitlement e on e.tenant_id=t.id
    where e.active_until>now() and e.active_until<=now()+interval '7 days'
    union
    select t.id,t.name,'setup_incomplete','Review Branch setup'
    from public.tenants t join public.sellertray_commercial_order_price_snapshots s on s.tenant_id=t.id
    where s.line_type='branch_setup' and not exists(
      select 1 from public.sellertray_commercial_branch_setup_readiness r
      where r.tenant_id=s.tenant_id and r.commercial_order_id=s.commercial_order_id and r.branch_id=s.branch_id)
  ) select jsonb_build_object(
    'total',(select count(*) from signals),
    'counts',coalesce((select jsonb_agg(to_jsonb(c) order by c.signal) from (select signal,count(*) count from signals group by signal) c),'[]'::jsonb),
    'items',coalesce((select jsonb_agg(to_jsonb(x) order by x.signal,x.name,x.tenant_id) from (select * from signals order by signal,name,tenant_id limit 20) x),'[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;

revoke all on function public.platform_admin_business_summary(uuid,integer) from public,anon,authenticated;
revoke all on function public.platform_admin_business_attention(uuid) from public,anon,authenticated;
grant execute on function public.platform_admin_business_summary(uuid,integer) to service_role;
grant execute on function public.platform_admin_business_attention(uuid) to service_role;
commit;
