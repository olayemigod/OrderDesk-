begin;

-- A lost network response after an offline sale has already settled must not
-- turn a successful idempotent checkout into a permanent local sync failure.
-- Once the server has bound the immutable tax context, a matching retry may
-- acknowledge that binding even after the order is no longer a draft. Different
-- context still fails closed.
create or replace function public.bind_sellertray_offline_tax_context(
  p_tenant_id uuid,
  p_order_id uuid,
  p_actor_user_id uuid,
  p_expected_tax_configuration_id uuid,
  p_expected_tax_configuration_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order public.orders%rowtype;
  v_current public.sellertray_tax_configurations%rowtype;
  v_current_revision bigint:=0;
  v_current_id uuid:=null;
begin
  if p_tenant_id is null or p_order_id is null or p_actor_user_id is null
     or p_expected_tax_configuration_revision is null
     or p_expected_tax_configuration_revision<0 then
    raise exception 'Business, queued sale, operator and tax context are required' using errcode='22023';
  end if;
  if (p_expected_tax_configuration_revision=0 and p_expected_tax_configuration_id is not null)
     or (p_expected_tax_configuration_revision>0 and p_expected_tax_configuration_id is null) then
    raise exception 'Queued sale tax context is invalid' using errcode='22023';
  end if;

  select * into v_order
  from public.orders o
  where o.tenant_id=p_tenant_id and o.id=p_order_id
  for update;
  if not found or v_order.source<>'pos' then
    raise exception 'Queued SellerTray POS sale not found' using errcode='22023';
  end if;
  if v_order.branch_id is null
     or not public.sellertray_user_can_operate_branch(p_tenant_id,v_order.branch_id,p_actor_user_id) then
    raise exception 'You do not have access to sell from this Branch' using errcode='42501';
  end if;

  -- Replay acknowledgement comes before mutable-state checks. A successful
  -- checkout may already have payment, invoice and stock effects; matching the
  -- immutable bound context proves this is the same governed offline tax intent.
  if v_order.offline_tax_context_locked then
    if v_order.offline_tax_configuration_revision<>p_expected_tax_configuration_revision
       or v_order.offline_tax_configuration_id is distinct from p_expected_tax_configuration_id then
      raise exception 'Queued sale tax context is already locked to different settings' using errcode='23505';
    end if;
    return jsonb_build_object(
      'orderId',p_order_id,
      'taxConfigurationId',p_expected_tax_configuration_id,
      'taxConfigurationRevision',p_expected_tax_configuration_revision,
      'locked',true,
      'replayed',true
    );
  end if;

  if v_order.status<>'draft' then
    raise exception 'Queued SellerTray POS sale not found' using errcode='22023';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;
  if v_order.payment_status<>'unpaid' or coalesce(v_order.amount_paid,0)<>0
     or exists(select 1 from public.order_payments p where p.tenant_id=p_tenant_id and p.order_id=p_order_id)
     or exists(select 1 from public.order_financial_documents d where d.tenant_id=p_tenant_id and d.order_id=p_order_id)
     or exists(
       select 1 from public.inventory_movements im
       where im.tenant_id=p_tenant_id and im.reference_type='order' and im.reference_id=p_order_id::text
     ) then
    raise exception 'Queued sale already has commercial effects and cannot change tax context' using errcode='23514';
  end if;
  if not exists(
    select 1 from public.sellertray_pos_draft_requests r
    where r.tenant_id=p_tenant_id and r.order_id=p_order_id
  ) then
    raise exception 'Tax context may only be bound to an idempotent queued POS sale' using errcode='23514';
  end if;

  select * into v_current
  from public.sellertray_tax_configurations c
  where c.tenant_id=p_tenant_id
  order by c.revision desc
  limit 1;
  if found then
    v_current_revision:=v_current.revision;
    v_current_id:=v_current.id;
  end if;

  if v_current_revision<>p_expected_tax_configuration_revision
     or v_current_id is distinct from p_expected_tax_configuration_id then
    raise exception 'Queued sale needs review because Business tax settings changed' using errcode='23514';
  end if;

  update public.orders o
  set offline_tax_context_locked=true,
      offline_tax_configuration_id=p_expected_tax_configuration_id,
      offline_tax_configuration_revision=p_expected_tax_configuration_revision,
      updated_at=now()
  where o.tenant_id=p_tenant_id and o.id=p_order_id;

  return jsonb_build_object(
    'orderId',p_order_id,
    'taxConfigurationId',p_expected_tax_configuration_id,
    'taxConfigurationRevision',p_expected_tax_configuration_revision,
    'locked',true,
    'replayed',false
  );
end;
$$;

revoke all on function public.bind_sellertray_offline_tax_context(uuid,uuid,uuid,uuid,bigint)
  from public,anon,authenticated;
grant execute on function public.bind_sellertray_offline_tax_context(uuid,uuid,uuid,uuid,bigint)
  to service_role;

-- Profitability is commercial revenue, not cash collected on behalf of the tax
-- authority. Keep the existing immutable valuation/COGS logic, but derive
-- revenue from the posted pre-tax sale snapshot and completed historical return
-- subtotals whenever Tax Authority has posted the order.
create or replace function public.get_sellertray_order_profitability(
  p_tenant_id uuid,
  p_order_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
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
  if current_user<>'postgres' and coalesce((select auth.role()),'')<>'service_role' then
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
$$;
revoke all on function public.get_sellertray_order_profitability(uuid,uuid) from public,anon;
grant execute on function public.get_sellertray_order_profitability(uuid,uuid) to authenticated,service_role;

commit;
