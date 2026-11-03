begin;

-- Pre-C2 OA2 settlement repair: restore the approved fixed-amount / percentage
-- discount authoring contract without changing immutable commercial gross or
-- historical settlement facts. Monetary settlement continues to consume the
-- calculated absolute adjustment amount.

alter table public.sellertray_commercial_adjustments
  add column if not exists discount_input_type text,
  add column if not exists discount_input_value numeric(18,6),
  add column if not exists discount_calculation_base_amount numeric(18,2);

alter table public.sellertray_commercial_adjustments
  drop constraint if exists sellertray_commercial_adjustments_discount_authoring_check;
alter table public.sellertray_commercial_adjustments
  add constraint sellertray_commercial_adjustments_discount_authoring_check
  check (
    (discount_input_type is null and discount_input_value is null and discount_calculation_base_amount is null)
    or
    (
      discount_input_type in ('fixed_amount','percentage')
      and discount_input_value > 0
      and (discount_input_type <> 'percentage' or discount_input_value <= 100)
      and discount_calculation_base_amount >= 0
    )
  );

create or replace function public.record_sellertray_commercial_discount_internal(
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_command_id uuid,
  p_discount_type text,
  p_discount_value numeric,
  p_reason text,
  p_evidence jsonb,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order public.sellertray_commercial_orders%rowtype;
  v_row public.sellertray_commercial_adjustments%rowtype;
  v_discount_type text := lower(btrim(coalesce(p_discount_type,'')));
  v_discount_value numeric(18,6);
  v_amount numeric(18,2);
  v_adjustments numeric(18,2) := 0;
  v_gateway numeric(18,2) := 0;
  v_direct numeric(18,2) := 0;
  v_confirmed_payments numeric(18,2) := 0;
  v_evidence jsonb := coalesce(p_evidence,'{}'::jsonb);
begin
  perform public.lock_sellertray_commercial_order(p_tenant_id,p_commercial_order_id);

  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.tenant_id=p_tenant_id and o.id=p_commercial_order_id;

  if v_discount_type not in ('fixed_amount','percentage') then
    raise exception 'Discount type must be fixed amount or percentage' using errcode='22023';
  end if;
  if p_discount_value is null or p_discount_value <= 0 then
    raise exception 'Discount value must be positive' using errcode='22023';
  end if;
  if v_discount_type='percentage' and p_discount_value > 100 then
    raise exception 'Discount percentage cannot exceed 100' using errcode='22023';
  end if;
  if char_length(btrim(coalesce(p_reason,'')))<6 then
    raise exception 'Discount reason must be at least 6 characters' using errcode='22023';
  end if;
  if jsonb_typeof(v_evidence)<>'object' then
    raise exception 'Discount evidence must be an object' using errcode='22023';
  end if;

  v_discount_value := round(p_discount_value::numeric,6);
  if v_discount_type='percentage' then
    v_amount := round((v_order.total_gross_amount * v_discount_value / 100)::numeric,2);
  else
    v_amount := round(v_discount_value::numeric,2);
  end if;

  if v_amount <= 0 then
    raise exception 'Discount resolves to zero at the commercial currency precision' using errcode='22023';
  end if;

  select a.* into v_row
  from public.sellertray_commercial_adjustments a
  where a.tenant_id=p_tenant_id and a.command_id=p_command_id;

  if found then
    if v_row.commercial_order_id<>p_commercial_order_id
       or v_row.discount_input_type is distinct from v_discount_type
       or v_row.discount_input_value is distinct from v_discount_value
       or v_row.discount_calculation_base_amount is distinct from v_order.total_gross_amount
       or abs(v_row.amount-v_amount)>=0.005
       or v_row.actor_user_id is distinct from p_actor_user_id
       or v_row.reason is distinct from btrim(p_reason)
       or v_row.evidence is distinct from v_evidence then
      raise exception 'Commercial discount command id was already used with different input' using errcode='23505';
    end if;
  else
    select coalesce(sum(a.amount),0)::numeric(18,2) into v_adjustments
    from public.sellertray_commercial_adjustments a
    where a.tenant_id=p_tenant_id and a.commercial_order_id=p_commercial_order_id;

    select coalesce(sum(p.amount),0)::numeric(18,2) into v_gateway
    from public.sellertray_commercial_installment_payment_confirmations p
    where p.tenant_id=p_tenant_id and p.commercial_order_id=p_commercial_order_id;

    select coalesce(sum(p.amount),0)::numeric(18,2) into v_direct
    from public.sellertray_commercial_direct_payment_confirmations p
    where p.tenant_id=p_tenant_id and p.commercial_order_id=p_commercial_order_id;

    v_confirmed_payments := (v_gateway+v_direct)::numeric(18,2);

    if v_adjustments+v_amount > v_order.total_gross_amount + 0.004 then
      raise exception 'Approved discounts cannot exceed immutable order gross' using errcode='23514';
    end if;
    if v_order.total_gross_amount-(v_adjustments+v_amount) < v_confirmed_payments - 0.004 then
      raise exception 'Discount cannot reduce the net amount below confirmed payments' using errcode='23514';
    end if;

    insert into public.sellertray_commercial_adjustments(
      tenant_id,commercial_order_id,command_id,adjustment_type,amount,currency,
      discount_input_type,discount_input_value,discount_calculation_base_amount,
      reason,evidence,actor_user_id
    ) values (
      p_tenant_id,p_commercial_order_id,p_command_id,'discount',v_amount,v_order.currency,
      v_discount_type,v_discount_value,v_order.total_gross_amount,
      btrim(p_reason),v_evidence,p_actor_user_id
    )
    returning * into strict v_row;
  end if;

  perform public.supersede_sellertray_stale_installment_checkouts(p_tenant_id,p_commercial_order_id);
  return public.get_sellertray_commercial_settlement_state(p_tenant_id,p_commercial_order_id);
end;
$$;

revoke all on function public.record_sellertray_commercial_discount_internal(uuid,uuid,uuid,text,numeric,text,jsonb,uuid)
  from public,anon,authenticated;
grant execute on function public.record_sellertray_commercial_discount_internal(uuid,uuid,uuid,text,numeric,text,jsonb,uuid)
  to service_role;

create or replace function public.platform_admin_record_commercial_discount(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_command_id uuid,
  p_discount_type text,
  p_discount_value numeric,
  p_reason text,
  p_evidence jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_obligation_id uuid;
  v_state jsonb;
  v_existing boolean;
  v_adjustment public.sellertray_commercial_adjustments%rowtype;
begin
  if not public.platform_admin_has_capability(
    p_actor_user_id,'admin.pricing.manage',p_tenant_id,now()
  ) then
    raise exception 'Commercial pricing capability required' using errcode='42501';
  end if;
  if char_length(btrim(coalesce(p_reason,'')))<6 then
    raise exception 'Discount reason must be at least 6 characters' using errcode='22023';
  end if;
  if p_evidence is null or jsonb_typeof(p_evidence)<>'object' then
    raise exception 'Discount evidence must be an object' using errcode='22023';
  end if;

  select exists(
    select 1 from public.sellertray_commercial_adjustments a
    where a.tenant_id=p_tenant_id and a.command_id=p_command_id
  ) into v_existing;

  v_state := public.record_sellertray_commercial_discount_internal(
    p_tenant_id,p_commercial_order_id,p_command_id,p_discount_type,p_discount_value,
    p_reason,p_evidence,p_actor_user_id
  );

  if not v_existing then
    select a.* into strict v_adjustment
    from public.sellertray_commercial_adjustments a
    where a.tenant_id=p_tenant_id and a.command_id=p_command_id;

    select io.id into v_obligation_id
    from public.sellertray_commercial_installment_obligations io
    where io.tenant_id=p_tenant_id and io.commercial_order_id=p_commercial_order_id
    order by io.created_at,io.id limit 1;
    if v_obligation_id is not null then
      begin
        perform public.reconcile_sellertray_installment_entitlement(p_tenant_id,v_obligation_id);
      exception when others then
        insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
        values(p_actor_user_id,p_tenant_id,'commercial_reconciliation_pending',jsonb_build_object(
          'commercialOrderId',p_commercial_order_id,'commandId',p_command_id,'error',sqlerrm
        ));
      end;
    end if;

    insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
    values (
      p_actor_user_id,p_tenant_id,'commercial_adjustment_recorded',
      jsonb_build_object(
        'commercialOrderId',p_commercial_order_id,
        'commandId',p_command_id,
        'discountType',v_adjustment.discount_input_type,
        'discountValue',v_adjustment.discount_input_value,
        'calculationBaseAmount',v_adjustment.discount_calculation_base_amount,
        'amount',v_adjustment.amount,
        'currency',v_adjustment.currency,
        'reason',v_adjustment.reason
      )
    );
  end if;

  return public.get_sellertray_commercial_settlement_detail_internal(
    p_tenant_id,p_commercial_order_id
  );
end;
$$;

revoke all on function public.platform_admin_record_commercial_discount(uuid,uuid,uuid,uuid,text,numeric,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.platform_admin_record_commercial_discount(uuid,uuid,uuid,uuid,text,numeric,text,jsonb)
  to service_role;

-- Extend the shared read model with authoring metadata while preserving all
-- pre-existing adjustment rows (their authoring metadata remains null).
create or replace function public.get_sellertray_commercial_settlement_detail_internal(
  p_tenant_id uuid,
  p_commercial_order_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_order public.sellertray_commercial_orders%rowtype;
  v_plan_code text;
  v_billing_cycle text;
  v_obligation_id uuid;
  v_settlement jsonb;
  v_billing jsonb;
  v_policy jsonb;
  v_contract jsonb;
  v_adjustments jsonb;
  v_direct_payments jsonb;
  v_gateway_payments jsonb;
begin
  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.tenant_id=p_tenant_id and o.id=p_commercial_order_id;

  select s.plan_code,s.billing_cycle into v_plan_code,v_billing_cycle
  from public.sellertray_commercial_order_price_snapshots s
  where s.tenant_id=p_tenant_id and s.commercial_order_id=p_commercial_order_id and s.line_type='subscription'
  order by s.line_no limit 1;

  select io.id into v_obligation_id
  from public.sellertray_commercial_installment_obligations io
  where io.tenant_id=p_tenant_id and io.commercial_order_id=p_commercial_order_id
  order by io.created_at,io.id limit 1;

  v_settlement := public.get_sellertray_commercial_settlement_state(p_tenant_id,p_commercial_order_id);

  if v_obligation_id is not null then
    v_billing := public.get_sellertray_installment_billing_state(p_tenant_id,v_obligation_id);
    select jsonb_build_object(
      'id',cs.id,'policyVersionId',cs.policy_version_id,'templateId',cs.template_id,
      'templateCode',cs.template_code,'templateVersion',cs.template_version,
      'templateDisplayName',t.display_name,'provisionalEntitlementMonths',cs.provisional_entitlement_months,
      'qualifyingSettlementSequence',cs.qualifying_settlement_sequence,'snapshottedAt',cs.snapshotted_at
    ) into v_contract
    from public.sellertray_installment_contract_snapshots cs
    join public.sellertray_installment_schedule_templates t on t.id=cs.template_id
    where cs.tenant_id=p_tenant_id and cs.installment_obligation_id=v_obligation_id;
  else
    v_billing := null;
    v_contract := null;
  end if;

  if v_plan_code is not null and v_billing_cycle is not null then
    v_policy := public.resolve_sellertray_installment_policy(
      p_tenant_id,p_commercial_order_id,v_plan_code,v_billing_cycle,now()
    );
  else
    v_policy := null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',a.id,'commandId',a.command_id,'type',a.adjustment_type,'amount',a.amount,
    'currency',a.currency,'discountInputType',a.discount_input_type,
    'discountInputValue',a.discount_input_value,
    'discountCalculationBaseAmount',a.discount_calculation_base_amount,
    'reason',a.reason,'evidence',a.evidence,'actorUserId',a.actor_user_id,
    'approvedAt',a.approved_at,'recordedAt',a.recorded_at
  ) order by a.approved_at desc,a.recorded_at desc,a.id desc),'[]'::jsonb)
  into v_adjustments
  from public.sellertray_commercial_adjustments a
  where a.tenant_id=p_tenant_id and a.commercial_order_id=p_commercial_order_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',d.id,'commandId',d.command_id,'paymentReference',d.payment_reference,
    'paymentMethod',d.payment_method,'amount',d.amount,'currency',d.currency,
    'reason',d.reason,'evidence',d.evidence,'actorUserId',d.actor_user_id,
    'paidAt',d.paid_at,'recordedAt',d.recorded_at
  ) order by d.paid_at desc,d.recorded_at desc,d.id desc),'[]'::jsonb)
  into v_direct_payments
  from public.sellertray_commercial_direct_payment_confirmations d
  where d.tenant_id=p_tenant_id and d.commercial_order_id=p_commercial_order_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,'installmentScheduleId',p.installment_schedule_id,'provider',p.provider,
    'providerReference',p.provider_reference,'amount',p.amount,'currency',p.currency,
    'paidAt',p.paid_at,'recordedAt',p.recorded_at
  ) order by p.paid_at desc,p.recorded_at desc,p.id desc),'[]'::jsonb)
  into v_gateway_payments
  from public.sellertray_commercial_installment_payment_confirmations p
  where p.tenant_id=p_tenant_id and p.commercial_order_id=p_commercial_order_id;

  return jsonb_build_object(
    'tenantId',p_tenant_id,'commercialOrderId',v_order.id,'orderReference',v_order.order_reference,
    'orderedAt',v_order.ordered_at,'currency',v_order.currency,'grossAmount',v_order.total_gross_amount,
    'planCode',v_plan_code,'billingCycle',v_billing_cycle,'installmentObligationId',v_obligation_id,
    'settlement',v_settlement,'billingState',v_billing,'contractSnapshot',v_contract,
    'currentInstallmentPolicy',v_policy,'adjustments',v_adjustments,
    'directPayments',v_direct_payments,'gatewayPayments',v_gateway_payments
  );
end;
$$;

revoke all on function public.get_sellertray_commercial_settlement_detail_internal(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.get_sellertray_commercial_settlement_detail_internal(uuid,uuid)
  to service_role;

commit;
