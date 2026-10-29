begin;

-- Merchant identity is a first-class commercial fact. Snapshot the governed
-- Business identity from public.tenants when the agreement is generated rather
-- than relying on mutable browser text. Provider legal identity is deliberately
-- not invented here; it requires its own governed platform source.

create or replace function public.build_sellertray_commercial_agreement_snapshot(
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_installment_obligation_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path=''
as $$
declare
  v_tenant public.tenants%rowtype;
  v_order public.sellertray_commercial_orders%rowtype;
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_lines jsonb;
  v_schedule jsonb;
begin
  select t.* into strict v_tenant
  from public.tenants t
  where t.id=p_tenant_id;

  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.tenant_id=p_tenant_id and o.id=p_commercial_order_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'line_no',s.line_no,
    'line_type',s.line_type,
    'source_price_version_id',s.source_price_version_id,
    'plan_code',s.plan_code,
    'branch_id',s.branch_id,
    'billing_cycle',s.billing_cycle,
    'description',s.description_snapshot,
    'quantity',s.quantity,
    'currency',s.currency,
    'unit_gross_amount',s.unit_gross_amount,
    'gross_amount',s.gross_amount,
    'net_amount',s.net_amount,
    'tax_rate_percent',s.tax_rate_percent,
    'tax_amount',s.tax_amount
  ) order by s.line_no),'[]'::jsonb)
  into v_lines
  from public.sellertray_commercial_order_price_snapshots s
  where s.tenant_id=p_tenant_id and s.commercial_order_id=p_commercial_order_id;

  if p_installment_obligation_id is not null then
    select o.* into strict v_obligation
    from public.sellertray_commercial_installment_obligations o
    where o.tenant_id=p_tenant_id
      and o.commercial_order_id=p_commercial_order_id
      and o.id=p_installment_obligation_id;

    select coalesce(jsonb_agg(jsonb_build_object(
      'sequence_no',s.sequence_no,
      'percentage',s.percentage,
      'amount_due',s.amount_due,
      'due_at',s.due_at
    ) order by s.sequence_no),'[]'::jsonb)
    into v_schedule
    from public.sellertray_commercial_installment_schedule s
    where s.tenant_id=p_tenant_id
      and s.installment_obligation_id=p_installment_obligation_id;
  else
    v_schedule := null;
  end if;

  return jsonb_build_object(
    'merchant',jsonb_build_object(
      'tenant_id',v_tenant.id,
      'merchant_code',v_tenant.merchant_code,
      'business_name',v_tenant.name,
      'business_email',v_tenant.business_email,
      'business_phone',v_tenant.business_phone,
      'business_type',v_tenant.business_type
    ),
    'commercial_order_id',v_order.id,
    'order_reference',v_order.order_reference,
    'currency',v_order.currency,
    'total_gross_amount',v_order.total_gross_amount,
    'ordered_at',v_order.ordered_at,
    'price_snapshots',v_lines,
    'installment',case when p_installment_obligation_id is null then null else jsonb_build_object(
      'installment_obligation_id',v_obligation.id,
      'structure_code',v_obligation.structure_code,
      'currency',v_obligation.currency,
      'obligated_amount',v_obligation.obligated_amount,
      'schedule',v_schedule
    ) end
  );
end;
$$;

revoke all on function public.build_sellertray_commercial_agreement_snapshot(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.build_sellertray_commercial_agreement_snapshot(uuid,uuid,uuid)
  to service_role;

commit;
