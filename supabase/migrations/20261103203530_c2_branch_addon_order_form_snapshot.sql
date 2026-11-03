begin;
-- C2-7: freeze exact selected add-on versions, prices and tax in the Merchant Order Form.
create or replace function public.build_sellertray_commercial_agreement_snapshot(
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_installment_obligation_id uuid
)
returns jsonb
language plpgsql
stable
set search_path=''
as $function$
declare
  v_tenant public.tenants%rowtype;
  v_order public.sellertray_commercial_orders%rowtype;
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_lines jsonb;
  v_schedule jsonb;
  v_settlement jsonb;
  v_branch_commitments jsonb;
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
    'charge_type_code',s.charge_type_code,
    'price_scope',s.price_scope_snapshot,
    'plan_code',s.plan_code,
    'plan_profile_version_id',s.plan_profile_version_id,
    'addon_version_id',s.addon_version_id,
    'commercial_tax_profile_version_id',s.commercial_tax_profile_version_id,
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

  if v_order.order_kind='branch_commercial_v2' then
    if p_installment_obligation_id is not null then
      raise exception 'Commercial V2 Branch Order Form covers the complete commercial order, not one Branch obligation'
        using errcode='23514';
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'subject_id',s.id,
      'branch_id',s.branch_id,
      'plan_profile_version_id',s.plan_profile_version_id,
      'billing_cycle',s.billing_cycle,
      'branch_subscription_line_id',s.branch_subscription_line_id,
      'branch_setup_line_id',s.branch_setup_line_id,
      'setup_required',s.setup_required,
      'supersedes_branch_subscription_id',s.supersedes_branch_subscription_id,
      'installment_obligation_id',s.installment_obligation_id,
      'installment_template_id',s.installment_template_id,
      'installment_template_code',cs.template_code,
      'installment_template_version',cs.template_version,
      'installment_policy_version_id',s.installment_policy_version_id,
      'addon_lines',coalesce((
        select jsonb_agg(jsonb_build_object(
          'order_line_id',l.id,
          'addon_version_id',l.addon_version_id,
          'billing_cycle',l.billing_cycle,
          'gross_amount',l.gross_amount,
          'tax_amount',l.tax_amount
        ) order by l.line_no)
        from public.sellertray_commercial_order_price_snapshots l
        where l.tenant_id=s.tenant_id and l.commercial_order_id=s.commercial_order_id
          and l.branch_id=s.branch_id and l.line_type='branch_addon'
      ),'[]'::jsonb),
      'settlement',public.get_sellertray_commercial_obligation_settlement_state(
        p_tenant_id,s.installment_obligation_id
      )
    ) order by s.branch_id),'[]'::jsonb)
    into v_branch_commitments
    from public.sellertray_branch_commercial_order_subjects s
    join public.sellertray_installment_contract_snapshots cs
      on cs.tenant_id=s.tenant_id and cs.installment_obligation_id=s.installment_obligation_id
    where s.tenant_id=p_tenant_id and s.commercial_order_id=p_commercial_order_id;

    if jsonb_array_length(v_branch_commitments)=0 then
      raise exception 'Commercial V2 order has no Branch commitments' using errcode='23514';
    end if;

    v_settlement:=public.get_sellertray_commercial_settlement_state(
      p_tenant_id,p_commercial_order_id
    );
    v_schedule:=null;
  else
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
      v_schedule:=null;
    end if;

    v_settlement:=public.get_sellertray_commercial_settlement_state(
      p_tenant_id,p_commercial_order_id
    );
    if p_installment_obligation_id is not null then
      select jsonb_agg(jsonb_build_object(
        'sequence_no',x->'sequenceNo',
        'percentage',x->'percentage',
        'amount_due',x->'amountDue',
        'due_at',x->'dueAt'
      ) order by (x->>'sequenceNo')::integer)
      into v_schedule
      from jsonb_array_elements(v_settlement->'schedule') x;
    end if;
    v_branch_commitments:=null;
  end if;

  return jsonb_build_object(
    'schemaVersion',case when v_order.order_kind='branch_commercial_v2' then 2 else 1 end,
    'orderKind',v_order.order_kind,
    'settlementTerms',jsonb_build_object(
      'approvedAdjustmentAmount',v_settlement->'approvedAdjustmentAmount',
      'netAmountDue',v_settlement->'netAmountDue',
      'outstandingAmount',v_settlement->'outstandingAmount'
    ),
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
    'branch_commitments',v_branch_commitments,
    'installment',case
      when p_installment_obligation_id is null then null
      else jsonb_build_object(
        'installment_obligation_id',v_obligation.id,
        'structure_code',v_obligation.structure_code,
        'currency',v_obligation.currency,
        'obligated_amount',v_obligation.obligated_amount,
        'schedule',v_schedule
      )
    end
  );
end;
$function$;
commit;
