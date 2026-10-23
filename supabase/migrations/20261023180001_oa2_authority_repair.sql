begin;
-- Generated with Supabase CLI; version placed after the candidate's 18:00 migration.
-- Forward convergence only: preserve commercial history and runtime compatibility.

-- Locking is internal authority, not permission to update immutable orders.
create or replace function public.lock_sellertray_commercial_order(p_tenant_id uuid,p_commercial_order_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.sellertray_commercial_orders o
  where o.tenant_id=p_tenant_id and o.id=p_commercial_order_id for update;
  if not found then raise exception 'Commercial order not found for this Business' using errcode='P0002'; end if;
end;
$$;
revoke all on function public.lock_sellertray_commercial_order(uuid,uuid) from public,anon,authenticated;
grant execute on function public.lock_sellertray_commercial_order(uuid,uuid) to service_role;

create or replace function public.get_sellertray_commercial_billing_center(
  p_tenant_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_role text;
  v_orders jsonb;
begin
  if p_tenant_id is null or p_actor_user_id is null then
    raise exception 'Business and user are required' using errcode='22023';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;
  if coalesce(v_role,'') not in ('owner','manager') then
    raise exception 'Merchant billing access requires an Owner or Manager' using errcode='42501';
  end if;

  select coalesce(jsonb_agg(
    public.get_sellertray_commercial_settlement_detail_internal(p_tenant_id,o.id)
    order by o.ordered_at desc,o.id desc
  ),'[]'::jsonb)
  into v_orders
  from public.sellertray_commercial_orders o
  where o.tenant_id=p_tenant_id;

  return jsonb_build_object(
    'tenantId',p_tenant_id,
    'actorRole',v_role,
    'canPay',v_role='owner',
    'orders',v_orders,
    'generatedAt',now()
  );
end;
$$;

create or replace function public.platform_admin_commercial_settlement_center(
  p_actor_user_id uuid,
  p_tenant_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_role text;
  v_orders jsonb;
  v_templates jsonb;
begin
  if p_actor_user_id is null or p_tenant_id is null then
    raise exception 'Administrator and Business are required' using errcode='22023';
  end if;

  select pa.role into v_role
  from public.platform_admins pa
  where pa.user_id=p_actor_user_id;
  if coalesce(v_role,'') not in ('admin','support') then
    raise exception 'Platform administrator access required' using errcode='42501';
  end if;
  if not exists (select 1 from public.tenants t where t.id=p_tenant_id) then
    raise exception 'SellerTray business not found' using errcode='P0002';
  end if;

  select coalesce(jsonb_agg(
    public.get_sellertray_commercial_settlement_detail_internal(p_tenant_id,o.id)
    order by o.ordered_at desc,o.id desc
  ),'[]'::jsonb)
  into v_orders
  from public.sellertray_commercial_orders o
  where o.tenant_id=p_tenant_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',t.id,
    'code',t.template_code,
    'version',t.version,
    'displayName',t.display_name,
    'status',t.status,
    'provisionalEntitlementMonths',t.provisional_entitlement_months,
    'qualifyingSettlementSequence',t.qualifying_settlement_sequence,
    'effectiveFrom',t.effective_from,
    'effectiveUntil',t.effective_until,
    'lines',coalesce((
      select jsonb_agg(jsonb_build_object(
        'sequenceNo',l.sequence_no,
        'percentage',l.percentage,
        'fixedAmount',l.fixed_amount,
        'dueOffsetDays',l.due_offset_days
      ) order by l.sequence_no)
      from public.sellertray_installment_schedule_template_lines l
      where l.template_id=t.id
    ),'[]'::jsonb)
  ) order by t.template_code,t.version desc),'[]'::jsonb)
  into v_templates
  from public.sellertray_installment_schedule_templates t
  where t.status='published'
    and t.effective_from<=now()
    and (t.effective_until is null or t.effective_until>now());

  return jsonb_build_object(
    'actorRole',v_role,
    'tenantId',p_tenant_id,
    'capabilities',jsonb_build_object(
      'canAdjust',public.platform_admin_has_capability(
        p_actor_user_id,'admin.pricing.manage',p_tenant_id,now()
      ),
      'canConfirmDirectPayment',public.platform_admin_has_capability(
        p_actor_user_id,'admin.payments.reconcile',p_tenant_id,now()
      ),
      'canManageInstallments',public.platform_admin_has_capability(
        p_actor_user_id,'admin.installments.manage',p_tenant_id,now()
      )
    ),
    'templates',v_templates,
    'orders',v_orders,
    'generatedAt',now()
  );
end;
$$;

create or replace function public.platform_admin_has_capability(
  p_actor_user_id uuid,
  p_capability_code text,
  p_tenant_id uuid default null,
  p_as_of timestamptz default now()
)
returns boolean
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_role text;
  v_enabled boolean;
begin
  select pa.role into v_role
  from public.platform_admins pa
  where pa.user_id=p_actor_user_id;

  if coalesce(v_role,'') not in ('admin','support') then
    return false;
  end if;

  select g.enabled into v_enabled
  from public.platform_admin_capability_grant_versions g
  where g.grantee_user_id=p_actor_user_id
    and g.capability_code=p_capability_code
    and g.effective_from<=p_as_of
    and (g.effective_until is null or g.effective_until>p_as_of)
    and (
      g.scope_kind='platform'
      or (g.scope_kind='tenant' and p_tenant_id is not null and g.tenant_id=p_tenant_id)
    )
  order by
    case g.scope_kind when 'tenant' then 200 else 100 end desc,
    g.effective_from desc,
    g.created_at desc
  limit 1;

  return coalesce(v_enabled,v_role='admin');
end;
$$;

create or replace function public.snapshot_sellertray_inserted_installment_contract()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_template public.sellertray_installment_schedule_templates%rowtype; v_policy jsonb; v_plan text; v_cycle text;
begin
  -- The old Admin bridge and trusted legacy import paths must establish the same
  -- immutable contract as the new materializer, including policy enforcement.
  select ps.plan_code,ps.billing_cycle into strict v_plan,v_cycle
  from public.sellertray_commercial_order_price_snapshots ps
  where ps.tenant_id=new.tenant_id and ps.commercial_order_id=new.commercial_order_id and ps.line_type='subscription';
  v_policy:=public.resolve_sellertray_installment_policy(new.tenant_id,new.commercial_order_id,v_plan,v_cycle,now());
  if not coalesce((v_policy->>'enabled')::boolean,false) then
    raise exception 'Installments are not enabled for this commercial order' using errcode='23514';
  end if;
  select t.* into strict v_template from public.sellertray_installment_schedule_templates t
  where t.template_code=new.structure_code and t.status='published'
    and t.effective_from<=now() and (t.effective_until is null or t.effective_until>now())
  order by (t.id=nullif(v_policy->>'defaultTemplateId','')::uuid) desc,t.version desc limit 1;
  insert into public.sellertray_installment_contract_snapshots(
    tenant_id,commercial_order_id,installment_obligation_id,policy_version_id,
    template_id,template_code,template_version,provisional_entitlement_months,qualifying_settlement_sequence,snapshotted_at
  ) values(new.tenant_id,new.commercial_order_id,new.id,nullif(v_policy->>'policyVersionId','')::uuid,
    v_template.id,v_template.template_code,v_template.version,v_template.provisional_entitlement_months,
    v_template.qualifying_settlement_sequence,new.created_at);
  return new;
end;
$$;
revoke all on function public.snapshot_sellertray_inserted_installment_contract() from public,anon,authenticated;
create trigger snapshot_sellertray_inserted_installment_contract after insert on public.sellertray_commercial_installment_obligations
for each row execute function public.snapshot_sellertray_inserted_installment_contract();

create or replace function public.materialize_sellertray_installment_obligation_internal(
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_existing public.sellertray_commercial_installment_obligations%rowtype;
  v_order public.sellertray_commercial_orders%rowtype;
  v_plan_code text;
  v_billing_cycle text;
  v_policy jsonb;
  v_policy_id uuid;
  v_template_id uuid;
  v_template public.sellertray_installment_schedule_templates%rowtype;
  v_obligation_id uuid;
  v_line record;
  v_last_sequence integer;
  v_allocated numeric(18,2) := 0;
  v_amount numeric(18,2);
begin
  if p_tenant_id is null or p_commercial_order_id is null or p_actor_user_id is null then
    raise exception 'Business, commercial order and actor are required' using errcode='22023';
  end if;

  select o.* into v_existing
  from public.sellertray_commercial_installment_obligations o
  where o.tenant_id=p_tenant_id and o.commercial_order_id=p_commercial_order_id;
  if found then
    return v_existing.id;
  end if;

  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.tenant_id=p_tenant_id and o.id=p_commercial_order_id;

  select s.plan_code,s.billing_cycle
    into strict v_plan_code,v_billing_cycle
  from public.sellertray_commercial_order_price_snapshots s
  where s.tenant_id=p_tenant_id
    and s.commercial_order_id=p_commercial_order_id
    and s.line_type='subscription';

  v_policy := public.resolve_sellertray_installment_policy(
    p_tenant_id,p_commercial_order_id,v_plan_code,v_billing_cycle,now()
  );
  if v_policy is null or not coalesce((v_policy->>'enabled')::boolean,false) then
    raise exception 'Installments are not enabled for this commercial order' using errcode='23514';
  end if;

  v_policy_id := nullif(v_policy->>'policyVersionId','')::uuid;
  v_template_id := nullif(v_policy->>'defaultTemplateId','')::uuid;
  if v_policy_id is null or v_template_id is null then
    raise exception 'Enabled installment policy has no governed schedule template' using errcode='23514';
  end if;

  select t.* into strict v_template
  from public.sellertray_installment_schedule_templates t
  where t.id=v_template_id
    and t.status='published'
    and t.effective_from<=now()
    and (t.effective_until is null or t.effective_until>now());

  if exists (
    select 1
    from public.sellertray_installment_schedule_template_lines l
    where l.template_id=v_template.id and l.percentage is null
  ) then
    raise exception 'Fixed-amount installment templates are not materializable until their order-allocation policy is approved'
      using errcode='0A000';
  end if;

  select max(l.sequence_no) into strict v_last_sequence
  from public.sellertray_installment_schedule_template_lines l
  where l.template_id=v_template.id;

  insert into public.sellertray_commercial_installment_obligations(
    tenant_id,commercial_order_id,structure_code,currency,obligated_amount,created_by_user_id
  ) values (
    p_tenant_id,p_commercial_order_id,v_template.template_code,v_order.currency,
    v_order.total_gross_amount,p_actor_user_id
  ) returning id into v_obligation_id;

  for v_line in
    select l.*
    from public.sellertray_installment_schedule_template_lines l
    where l.template_id=v_template.id
    order by l.sequence_no
  loop
    if v_line.sequence_no=v_last_sequence then
      v_amount := (v_order.total_gross_amount-v_allocated)::numeric(18,2);
    else
      v_amount := round((v_order.total_gross_amount*v_line.percentage/100)::numeric,2);
      v_allocated := (v_allocated+v_amount)::numeric(18,2);
    end if;

    insert into public.sellertray_commercial_installment_schedule(
      tenant_id,installment_obligation_id,sequence_no,percentage,amount_due,due_at
    ) values (
      p_tenant_id,v_obligation_id,v_line.sequence_no,v_line.percentage,v_amount,
      case
        when v_line.due_offset_days is null then null
        else v_order.ordered_at+make_interval(days=>v_line.due_offset_days)
      end
    );
  end loop;

  insert into public.sellertray_installment_contract_snapshots(
    tenant_id,commercial_order_id,installment_obligation_id,policy_version_id,
    template_id,template_code,template_version,provisional_entitlement_months,
    qualifying_settlement_sequence,snapshotted_at
  ) values (
    p_tenant_id,p_commercial_order_id,v_obligation_id,v_policy_id,
    v_template.id,v_template.template_code,v_template.version,
    v_template.provisional_entitlement_months,v_template.qualifying_settlement_sequence,now()
  ) on conflict (installment_obligation_id) do nothing;

  return v_obligation_id;
end;
$$;

create or replace function public.get_sellertray_commercial_settlement_state(
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
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_adjustments numeric(18,2) := 0;
  v_gateway numeric(18,2) := 0;
  v_direct numeric(18,2) := 0;
  v_net_due numeric(18,2) := 0;
  v_total_paid numeric(18,2) := 0;
  v_outstanding numeric(18,2) := 0;
  v_credit numeric(18,2) := 0;
  v_schedule jsonb := '[]'::jsonb;
  v_next_schedule_id uuid;
  v_next_payable numeric(18,2);
  v_status text;
begin
  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.tenant_id=p_tenant_id and o.id=p_commercial_order_id;

  select coalesce(sum(a.amount),0)::numeric(18,2) into v_adjustments
  from public.sellertray_commercial_adjustments a
  where a.tenant_id=p_tenant_id and a.commercial_order_id=p_commercial_order_id;

  select coalesce(sum(p.amount),0)::numeric(18,2) into v_gateway
  from public.sellertray_commercial_installment_payment_confirmations p
  where p.tenant_id=p_tenant_id and p.commercial_order_id=p_commercial_order_id;

  select coalesce(sum(p.amount),0)::numeric(18,2) into v_direct
  from public.sellertray_commercial_direct_payment_confirmations p
  where p.tenant_id=p_tenant_id and p.commercial_order_id=p_commercial_order_id;

  v_net_due := greatest(v_order.total_gross_amount-v_adjustments,0)::numeric(18,2);
  v_total_paid := (v_gateway+v_direct)::numeric(18,2);
  v_outstanding := greatest(v_net_due-v_total_paid,0)::numeric(18,2);
  v_credit := least(v_total_paid,v_net_due)::numeric(18,2);

  select o.* into v_obligation
  from public.sellertray_commercial_installment_obligations o
  where o.tenant_id=p_tenant_id and o.commercial_order_id=p_commercial_order_id;

  if found then
    with raw_lines as (
      select s.*,max(s.sequence_no) over () last_sequence,
             round(v_net_due*s.percentage/100,2)::numeric(18,2) rounded_due
      from public.sellertray_commercial_installment_schedule s
      where s.tenant_id=p_tenant_id and s.installment_obligation_id=v_obligation.id
    ), payable_lines as (
      select r.id,r.sequence_no,r.percentage,r.due_at,
        case when r.sequence_no=r.last_sequence then
          v_net_due-coalesce(sum(r.rounded_due) over (order by r.sequence_no rows between unbounded preceding and 1 preceding),0)
        else r.rounded_due end::numeric(18,2) amount_due
      from raw_lines r
    ), lines as (
      select p.*,coalesce(sum(p.amount_due) over (order by p.sequence_no rows between unbounded preceding and 1 preceding),0)::numeric(18,2) prior_due
      from payable_lines p
    ), allocated as (
      select l.*,
             least(l.amount_due,greatest(v_credit-l.prior_due,0))::numeric(18,2) as settled_amount,
             greatest(l.amount_due-least(l.amount_due,greatest(v_credit-l.prior_due,0)),0)::numeric(18,2) as remaining_amount
      from lines l
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'scheduleId',a.id,
             'sequenceNo',a.sequence_no,
             'percentage',a.percentage,
             'amountDue',a.amount_due,
             'settledAmount',a.settled_amount,
             'remainingAmount',a.remaining_amount,
             'dueAt',a.due_at,
             'settled',a.remaining_amount < 0.005
           ) order by a.sequence_no),'[]'::jsonb),
           (array_agg(a.id order by a.sequence_no) filter (where a.remaining_amount >= 0.005))[1],
           (array_agg(least(a.remaining_amount,v_outstanding)::numeric(18,2) order by a.sequence_no)
              filter (where a.remaining_amount >= 0.005))[1]
      into v_schedule,v_next_schedule_id,v_next_payable
    from allocated a;
  end if;

  if v_outstanding < 0.005 then
    v_status := 'settled';
    v_next_schedule_id := null;
    v_next_payable := 0;
  elsif v_total_paid > 0 or v_adjustments > 0 then
    v_status := 'partially_settled';
  else
    v_status := 'unsettled';
  end if;

  return jsonb_build_object(
    'tenantId',p_tenant_id,
    'commercialOrderId',p_commercial_order_id,
    'currency',v_order.currency,
    'grossAmount',v_order.total_gross_amount,
    'approvedAdjustmentAmount',v_adjustments,
    'gatewayPaymentAmount',v_gateway,
    'directPaymentAmount',v_direct,
    'totalConfirmedPaymentAmount',v_total_paid,
    'netAmountDue',v_net_due,
    'outstandingAmount',v_outstanding,
    'overpaymentAmount',greatest(v_total_paid-v_net_due,0)::numeric(18,2),
    'settlementStatus',v_status,
    'installmentObligationId',v_obligation.id,
    'schedule',v_schedule,
    'nextInstallmentScheduleId',v_next_schedule_id,
    'nextPayableAmount',coalesce(v_next_payable,v_outstanding)
  );
end;
$$;

create or replace function public.prepare_sellertray_commercial_credit_fact()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_order public.sellertray_commercial_orders%rowtype;
  v_adjustments numeric(18,2);
  v_gateway numeric(18,2);
  v_direct numeric(18,2);
begin
  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.tenant_id=new.tenant_id and o.id=new.commercial_order_id for update;

  new.currency := v_order.currency;
  new.reason := btrim(new.reason);

  select coalesce(sum(a.amount),0)::numeric(18,2) into v_adjustments
  from public.sellertray_commercial_adjustments a
  where a.tenant_id=new.tenant_id and a.commercial_order_id=new.commercial_order_id;

  select coalesce(sum(p.amount),0)::numeric(18,2) into v_gateway
  from public.sellertray_commercial_installment_payment_confirmations p
  where p.tenant_id=new.tenant_id and p.commercial_order_id=new.commercial_order_id;

  select coalesce(sum(p.amount),0)::numeric(18,2) into v_direct
  from public.sellertray_commercial_direct_payment_confirmations p
  where p.tenant_id=new.tenant_id and p.commercial_order_id=new.commercial_order_id;

  if v_adjustments+v_gateway+v_direct+new.amount > v_order.total_gross_amount + 0.004 then
    raise exception 'Commercial credits cannot exceed immutable order gross' using errcode='23514';
  end if;
  return new;
end;
$$;

create or replace function public.record_sellertray_commercial_adjustment_internal(
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_command_id uuid,
  p_amount numeric,
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
  v_row public.sellertray_commercial_adjustments%rowtype;
begin
  perform public.lock_sellertray_commercial_order(p_tenant_id,p_commercial_order_id);
  if p_amount is null or p_amount <= 0 then
    raise exception 'Commercial adjustment amount must be positive' using errcode='22023';
  end if;
  if nullif(btrim(p_reason),'') is null then
    raise exception 'Commercial adjustment reason is required' using errcode='22023';
  end if;

  select a.* into v_row
  from public.sellertray_commercial_adjustments a
  where a.tenant_id=p_tenant_id and a.command_id=p_command_id;

  if found then
    if v_row.commercial_order_id<>p_commercial_order_id or abs(v_row.amount-round(p_amount::numeric,2))>=0.005
       or v_row.actor_user_id is distinct from p_actor_user_id
       or v_row.reason is distinct from btrim(p_reason)
       or v_row.evidence is distinct from coalesce(p_evidence,'{}'::jsonb) then
      raise exception 'Commercial adjustment command id was already used with different input' using errcode='23505';
    end if;
  else
    insert into public.sellertray_commercial_adjustments(
      tenant_id,commercial_order_id,command_id,amount,currency,reason,evidence,actor_user_id
    )
    select p_tenant_id,p_commercial_order_id,p_command_id,round(p_amount::numeric,2),o.currency,
           btrim(p_reason),coalesce(p_evidence,'{}'::jsonb),p_actor_user_id
    from public.sellertray_commercial_orders o
    where o.tenant_id=p_tenant_id and o.id=p_commercial_order_id
    returning * into strict v_row;
  end if;

  perform public.supersede_sellertray_stale_installment_checkouts(p_tenant_id,p_commercial_order_id);
  return public.get_sellertray_commercial_settlement_state(p_tenant_id,p_commercial_order_id);
end;
$$;

create or replace function public.record_sellertray_commercial_direct_payment_internal(
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_command_id uuid,
  p_payment_reference text,
  p_payment_method text,
  p_amount numeric,
  p_paid_at timestamptz,
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
  v_row public.sellertray_commercial_direct_payment_confirmations%rowtype;
begin
  perform public.lock_sellertray_commercial_order(p_tenant_id,p_commercial_order_id);
  if p_amount is null or p_amount <= 0 then
    raise exception 'Direct payment amount must be positive' using errcode='22023';
  end if;
  if nullif(btrim(p_payment_reference),'') is null or nullif(btrim(p_payment_method),'') is null then
    raise exception 'Direct payment reference and method are required' using errcode='22023';
  end if;
  if nullif(btrim(p_reason),'') is null then
    raise exception 'Direct payment reason is required' using errcode='22023';
  end if;

  select d.* into v_row
  from public.sellertray_commercial_direct_payment_confirmations d
  where d.tenant_id=p_tenant_id and d.command_id=p_command_id;

  if found then
    if v_row.commercial_order_id<>p_commercial_order_id
       or v_row.payment_reference<>btrim(p_payment_reference)
       or abs(v_row.amount-round(p_amount::numeric,2))>=0.005
       or v_row.actor_user_id is distinct from p_actor_user_id
       or v_row.reason is distinct from btrim(p_reason)
       or v_row.evidence is distinct from coalesce(p_evidence,'{}'::jsonb)
       or v_row.payment_method is distinct from lower(btrim(p_payment_method))
       or v_row.paid_at is distinct from p_paid_at then
      raise exception 'Direct payment command id was already used with different input' using errcode='23505';
    end if;
  else
    insert into public.sellertray_commercial_direct_payment_confirmations(
      tenant_id,commercial_order_id,command_id,payment_reference,payment_method,
      amount,currency,reason,evidence,actor_user_id,paid_at
    )
    select p_tenant_id,p_commercial_order_id,p_command_id,btrim(p_payment_reference),
           lower(btrim(p_payment_method)),round(p_amount::numeric,2),o.currency,btrim(p_reason),
           coalesce(p_evidence,'{}'::jsonb),p_actor_user_id,p_paid_at
    from public.sellertray_commercial_orders o
    where o.tenant_id=p_tenant_id and o.id=p_commercial_order_id
    returning * into strict v_row;
  end if;

  perform public.supersede_sellertray_stale_installment_checkouts(p_tenant_id,p_commercial_order_id);
  return public.get_sellertray_commercial_settlement_state(p_tenant_id,p_commercial_order_id);
end;
$$;

create or replace function public.sellertray_commercial_agreement_terms_current(p_agreement_id uuid)
returns boolean language sql stable security invoker set search_path='' as $$
  select coalesce((a.commercial_snapshot->'settlementTerms'->>'approvedAdjustmentAmount')::numeric,0)
       = coalesce((select sum(d.amount) from public.sellertray_commercial_adjustments d
                   where d.tenant_id=a.tenant_id and d.commercial_order_id=a.commercial_order_id),0)
  from public.sellertray_commercial_agreements a where a.id=p_agreement_id;
$$;
revoke all on function public.sellertray_commercial_agreement_terms_current(uuid) from public,anon,authenticated;
grant execute on function public.sellertray_commercial_agreement_terms_current(uuid) to service_role;

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
  v_settlement jsonb;
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

  v_settlement:=public.get_sellertray_commercial_settlement_state(p_tenant_id,p_commercial_order_id);
  if p_installment_obligation_id is not null then
    select jsonb_agg(jsonb_build_object('sequence_no',x->'sequenceNo','percentage',x->'percentage','amount_due',x->'amountDue','due_at',x->'dueAt') order by (x->>'sequenceNo')::integer)
      into v_schedule from jsonb_array_elements(v_settlement->'schedule') x;
  end if;
  return jsonb_build_object(
    'settlementTerms',jsonb_build_object('approvedAdjustmentAmount',v_settlement->'approvedAdjustmentAmount','netAmountDue',v_settlement->'netAmountDue'),
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

create or replace function public.accept_sellertray_commercial_agreement(
  p_tenant_id uuid,
  p_agreement_id uuid,
  p_accepted_legal_name text,
  p_request_evidence jsonb,
  p_command_id uuid,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_role text;
  v_agreement public.sellertray_commercial_agreements%rowtype;
  v_existing public.sellertray_commercial_agreement_acceptances%rowtype;
  v_id uuid;
  v_name text := btrim(coalesce(p_accepted_legal_name,''));
  v_evidence jsonb := coalesce(p_request_evidence,'{}'::jsonb);
begin
  if p_tenant_id is null or p_agreement_id is null or p_actor_user_id is null or p_command_id is null then
    raise exception 'Business, agreement, accepting user and command are required' using errcode='22023';
  end if;
  if jsonb_typeof(v_evidence)<>'object' then
    raise exception 'Agreement acceptance evidence must be an object' using errcode='22023';
  end if;
  if char_length(v_name) not between 1 and 200 then
    raise exception 'Enter the authorised representative legal name' using errcode='22023';
  end if;

  -- A committed command is immutable historical evidence. Returning an exact
  -- replay is not a new signing act, so later capability revocation or document
  -- supersession must not turn the committed command into a failure.
  select a.* into v_existing
  from public.sellertray_commercial_agreement_acceptances a
  where a.tenant_id=p_tenant_id and a.command_id=p_command_id;

  if found then
    if v_existing.agreement_id<>p_agreement_id
       or v_existing.accepted_by_user_id<>p_actor_user_id
       or v_existing.accepted_legal_name<>v_name
       or v_existing.acceptance_method<>'merchant_web_authenticated'
       or v_existing.request_evidence->>'channel' is distinct from v_evidence->>'channel'
       or v_existing.request_evidence->>'authority_confirmed' is distinct from v_evidence->>'authority_confirmed' then
      raise exception 'Agreement acceptance command is already used for different facts' using errcode='23505';
    end if;
    return v_existing.id;
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;

  if v_role='owner' then
    null;
  elsif v_role='manager' and public.sellertray_user_has_capability(
    p_tenant_id,p_actor_user_id,'can_accept_commercial_agreements'
  ) then
    null;
  else
    raise exception 'You are not authorised to accept SellerTray commercial agreements' using errcode='42501';
  end if;

  select a.* into strict v_agreement
  from public.sellertray_commercial_agreements a
  where a.tenant_id=p_tenant_id and a.id=p_agreement_id;

  perform public.lock_sellertray_commercial_order(p_tenant_id,v_agreement.commercial_order_id);
  if not coalesce(public.sellertray_commercial_agreement_terms_current(v_agreement.id),false) then
    raise exception 'Commercial terms changed. Ask ProcessEdge to issue a replacement agreement before accepting.' using errcode='23514';
  end if;
  if exists (
    select 1 from public.sellertray_commercial_agreements r
    where r.tenant_id=p_tenant_id and r.supersedes_agreement_id=v_agreement.id
  ) then
    raise exception 'This SellerTray agreement has been replaced and cannot be accepted' using errcode='23514';
  end if;

  insert into public.sellertray_commercial_agreement_acceptances(
    tenant_id,agreement_id,template_version_id,template_version_code,
    template_content_sha256,agreement_content_sha256,accepted_by_user_id,
    accepted_legal_name,accepted_role,acceptance_method,request_evidence,
    command_id,accepted_at,created_at
  ) values (
    p_tenant_id,v_agreement.id,v_agreement.template_version_id,v_agreement.template_version_code,
    v_agreement.template_content_sha256,v_agreement.content_sha256,p_actor_user_id,
    v_name,v_role,'merchant_web_authenticated',v_evidence,p_command_id,now(),now()
  )
  on conflict do nothing
  returning id into v_id;

  if v_id is not null then
    return v_id;
  end if;

  -- Concurrent reuse of the same command is valid only for the same stable
  -- acceptance facts. The first recorded transport evidence remains immutable.
  select a.* into v_existing
  from public.sellertray_commercial_agreement_acceptances a
  where a.tenant_id=p_tenant_id and a.command_id=p_command_id;

  if found then
    if v_existing.agreement_id<>v_agreement.id
       or v_existing.template_version_id<>v_agreement.template_version_id
       or v_existing.template_content_sha256<>v_agreement.template_content_sha256
       or v_existing.agreement_content_sha256<>v_agreement.content_sha256
       or v_existing.accepted_by_user_id<>p_actor_user_id
       or v_existing.accepted_legal_name<>v_name
       or v_existing.accepted_role<>v_role
       or v_existing.acceptance_method<>'merchant_web_authenticated'
       or v_existing.request_evidence->>'channel' is distinct from v_evidence->>'channel'
       or v_existing.request_evidence->>'authority_confirmed' is distinct from v_evidence->>'authority_confirmed' then
      raise exception 'Agreement acceptance command is already used for different facts' using errcode='23505';
    end if;
    return v_existing.id;
  end if;

  -- A client may lose the successful response and reload, losing its in-memory
  -- command ID. Because an agreement version can be accepted only once, a new
  -- command may recover that result only while the signer is still authorised
  -- and every immutable signer/document/stable-acceptance fact is identical.
  select a.* into strict v_existing
  from public.sellertray_commercial_agreement_acceptances a
  where a.tenant_id=p_tenant_id and a.agreement_id=v_agreement.id;

  if v_existing.template_version_id<>v_agreement.template_version_id
     or v_existing.template_content_sha256<>v_agreement.template_content_sha256
     or v_existing.agreement_content_sha256<>v_agreement.content_sha256
     or v_existing.accepted_by_user_id<>p_actor_user_id
     or v_existing.accepted_legal_name<>v_name
     or v_existing.accepted_role<>v_role
     or v_existing.acceptance_method<>'merchant_web_authenticated'
     or v_existing.request_evidence->>'channel' is distinct from v_evidence->>'channel'
     or v_existing.request_evidence->>'authority_confirmed' is distinct from v_evidence->>'authority_confirmed' then
    raise exception 'SellerTray agreement is already accepted with different acceptance facts'
      using errcode='23505';
  end if;

  return v_existing.id;
end;
$$;

create or replace function public.sellertray_installment_agreement_is_accepted(
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_installment_obligation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists (
    select 1
    from public.sellertray_commercial_agreements a
    join public.sellertray_commercial_agreement_acceptances ac
      on ac.tenant_id=a.tenant_id and ac.agreement_id=a.id
    where a.tenant_id=p_tenant_id
      and a.commercial_order_id=p_commercial_order_id
      and a.installment_obligation_id=p_installment_obligation_id
      and a.agreement_family='installment_agreement'
      and public.sellertray_commercial_agreement_terms_current(a.id)
      and not exists (
        select 1
        from public.sellertray_commercial_agreements replacement
        where replacement.tenant_id=a.tenant_id
          and replacement.supersedes_agreement_id=a.id
      )
  );
$$;

create or replace function public.get_sellertray_installment_contract_checkout_policy(
  p_tenant_id uuid,
  p_installment_obligation_id uuid,
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_snapshot public.sellertray_installment_contract_snapshots%rowtype;
  v_plan_code text;
  v_billing_cycle text;
  v_accepted_at timestamptz;
  v_policy jsonb;
  v_policy_enabled boolean := false;
  v_policy_template_id uuid;
begin
  select o.* into strict v_obligation
  from public.sellertray_commercial_installment_obligations o
  where o.tenant_id=p_tenant_id and o.id=p_installment_obligation_id;

  select s.* into strict v_snapshot
  from public.sellertray_installment_contract_snapshots s
  where s.tenant_id=p_tenant_id and s.installment_obligation_id=v_obligation.id;

  select s.plan_code,s.billing_cycle
    into strict v_plan_code,v_billing_cycle
  from public.sellertray_commercial_order_price_snapshots s
  where s.tenant_id=p_tenant_id
    and s.commercial_order_id=v_obligation.commercial_order_id
    and s.line_type='subscription';

  select ac.accepted_at into v_accepted_at
  from public.sellertray_commercial_agreements a
  join public.sellertray_commercial_agreement_acceptances ac
    on ac.tenant_id=a.tenant_id and ac.agreement_id=a.id
  where a.tenant_id=p_tenant_id
    and a.commercial_order_id=v_obligation.commercial_order_id
    and a.installment_obligation_id=v_obligation.id
    and a.agreement_family='installment_agreement'
    and public.sellertray_commercial_agreement_terms_current(a.id)
    and not exists (
      select 1
      from public.sellertray_commercial_agreements replacement
      where replacement.tenant_id=a.tenant_id
        and replacement.supersedes_agreement_id=a.id
    )
  order by ac.accepted_at desc
  limit 1;

  v_policy := public.resolve_sellertray_installment_policy(
    p_tenant_id,v_obligation.commercial_order_id,v_plan_code,v_billing_cycle,p_as_of
  );
  v_policy_enabled := coalesce((v_policy->>'enabled')::boolean,false);
  v_policy_template_id := nullif(v_policy->>'defaultTemplateId','')::uuid;

  return jsonb_build_object(
    'tenantId',p_tenant_id,
    'commercialOrderId',v_obligation.commercial_order_id,
    'installmentObligationId',v_obligation.id,
    'planCode',v_plan_code,
    'billingCycle',v_billing_cycle,
    'agreementAccepted',v_accepted_at is not null,
    'agreementAcceptedAt',v_accepted_at,
    'contractTemplateId',v_snapshot.template_id,
    'contractTemplateCode',v_snapshot.template_code,
    'contractTemplateVersion',v_snapshot.template_version,
    'currentPolicy',v_policy,
    'draftEligible',v_policy_enabled and v_policy_template_id=v_snapshot.template_id,
    'checkoutEligible',v_accepted_at is not null
  );
end;
$$;

create or replace function public.get_sellertray_installment_billing_state(
  p_tenant_id uuid,
  p_installment_obligation_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path=''
as $$
declare
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_order public.sellertray_commercial_orders%rowtype;
  v_snapshot public.sellertray_installment_contract_snapshots%rowtype;
  v_plan_code text;
  v_billing_cycle text;
  v_agreement_accepted_at timestamptz;
  v_setup_required integer := 0;
  v_setup_ready integer := 0;
  v_setup_ready_at timestamptz;
  v_settlement jsonb;
  v_schedule jsonb := '[]'::jsonb;
  v_schedule_count integer := 0;
  v_settled_count integer := 0;
  v_qualifying_settled boolean := false;
  v_first_paid_at timestamptz;
  v_first_settlement_at timestamptz;
  v_provisional public.sellertray_commercial_entitlement_events%rowtype;
  v_full public.sellertray_commercial_entitlement_events%rowtype;
  v_state text := 'pending';
begin
  select o.* into strict v_obligation
  from public.sellertray_commercial_installment_obligations o
  where o.tenant_id=p_tenant_id and o.id=p_installment_obligation_id;

  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.tenant_id=p_tenant_id and o.id=v_obligation.commercial_order_id;

  select s.* into strict v_snapshot
  from public.sellertray_installment_contract_snapshots s
  where s.tenant_id=p_tenant_id and s.installment_obligation_id=v_obligation.id;

  select s.plan_code,s.billing_cycle into strict v_plan_code,v_billing_cycle
  from public.sellertray_commercial_order_price_snapshots s
  where s.tenant_id=p_tenant_id and s.commercial_order_id=v_order.id
    and s.line_type='subscription';

  select ac.accepted_at into v_agreement_accepted_at
  from public.sellertray_commercial_agreements a
  join public.sellertray_commercial_agreement_acceptances ac
    on ac.tenant_id=a.tenant_id and ac.agreement_id=a.id
  where a.tenant_id=p_tenant_id
    and a.commercial_order_id=v_order.id
    and a.installment_obligation_id=v_obligation.id
    and a.agreement_family='installment_agreement'
    and public.sellertray_commercial_agreement_terms_current(a.id)
    and not exists (
      select 1 from public.sellertray_commercial_agreements replacement
      where replacement.tenant_id=a.tenant_id and replacement.supersedes_agreement_id=a.id
    )
  order by ac.accepted_at desc
  limit 1;

  select count(*)::integer,count(r.id)::integer,max(r.ready_at)
    into v_setup_required,v_setup_ready,v_setup_ready_at
  from public.sellertray_commercial_order_price_snapshots s
  left join public.sellertray_commercial_branch_setup_readiness r
    on r.tenant_id=s.tenant_id
   and r.commercial_order_id=s.commercial_order_id
   and r.branch_id=s.branch_id
  where s.tenant_id=p_tenant_id
    and s.commercial_order_id=v_order.id
    and s.line_type='branch_setup';

  v_settlement := public.get_sellertray_commercial_settlement_state(p_tenant_id,v_order.id);

  with allocation as (
    select (x->>'scheduleId')::uuid as schedule_id,
           (x->>'settledAmount')::numeric as settled_amount,
           (x->>'remainingAmount')::numeric as remaining_amount
    from jsonb_array_elements(coalesce(v_settlement->'schedule','[]'::jsonb)) x
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',sch.id,
           'sequenceNo',sch.sequence_no,
           'percentage',sch.percentage,
           'amountDue',(select (x->>'amountDue')::numeric from jsonb_array_elements(v_settlement->'schedule') x where (x->>'scheduleId')::uuid=sch.id),
           'settledAmount',coalesce(a.settled_amount,0),
           'remainingAmount',coalesce(a.remaining_amount,sch.amount_due),
           'dueAt',sch.due_at,
           'paymentStatus',case
             when coalesce(a.remaining_amount,sch.amount_due)<0.005 then 'settled'
             when coalesce(a.settled_amount,0)>0 then 'partial'
             else 'unpaid'
           end,
           'dueState',case
             when coalesce(a.remaining_amount,sch.amount_due)<0.005 then 'settled'
             when sch.due_at is null then 'unscheduled'
             when sch.due_at<=now() then 'past_due'
             else 'scheduled'
           end,
           'paidAt',pc.paid_at,
           'provider',pc.provider,
           'providerReference',pc.provider_reference
         ) order by sch.sequence_no),'[]'::jsonb),
         count(*)::integer,
         count(*) filter (where coalesce(a.remaining_amount,sch.amount_due)<0.005)::integer
    into v_schedule,v_schedule_count,v_settled_count
  from public.sellertray_commercial_installment_schedule sch
  left join allocation a on a.schedule_id=sch.id
  left join public.sellertray_commercial_installment_payment_confirmations pc
    on pc.tenant_id=sch.tenant_id and pc.installment_schedule_id=sch.id
  where sch.tenant_id=p_tenant_id and sch.installment_obligation_id=v_obligation.id;

  select coalesce(bool_and((x->>'remainingAmount')::numeric<0.005),false)
    into v_qualifying_settled
  from jsonb_array_elements(coalesce(v_settlement->'schedule','[]'::jsonb)) x
  where (x->>'sequenceNo')::integer<=v_snapshot.qualifying_settlement_sequence;

  select min(paid_at) into v_first_paid_at
  from (
    select pc.paid_at
    from public.sellertray_commercial_installment_payment_confirmations pc
    where pc.tenant_id=p_tenant_id and pc.commercial_order_id=v_order.id
    union all
    select dp.paid_at
    from public.sellertray_commercial_direct_payment_confirmations dp
    where dp.tenant_id=p_tenant_id and dp.commercial_order_id=v_order.id
  ) paid;

  select min(event_at) into v_first_settlement_at
  from (
    select a.approved_at as event_at
    from public.sellertray_commercial_adjustments a
    where a.tenant_id=p_tenant_id and a.commercial_order_id=v_order.id
    union all
    select pc.paid_at
    from public.sellertray_commercial_installment_payment_confirmations pc
    where pc.tenant_id=p_tenant_id and pc.commercial_order_id=v_order.id
    union all
    select dp.paid_at
    from public.sellertray_commercial_direct_payment_confirmations dp
    where dp.tenant_id=p_tenant_id and dp.commercial_order_id=v_order.id
  ) settlement_fact;

  select e.* into v_provisional
  from public.sellertray_commercial_entitlement_events e
  where e.tenant_id=p_tenant_id and e.installment_obligation_id=v_obligation.id
    and e.event_type='installment.provisional_activated'
  order by e.recorded_at desc limit 1;

  select e.* into v_full
  from public.sellertray_commercial_entitlement_events e
  where e.tenant_id=p_tenant_id and e.installment_obligation_id=v_obligation.id
    and e.event_type='installment.full_entitlement_released'
  order by e.recorded_at desc limit 1;

  if v_full.id is not null then
    v_state := 'full';
  elsif v_provisional.id is not null then
    v_state := 'provisional';
  elsif v_agreement_accepted_at is null then
    v_state := 'pending_agreement';
  elsif v_setup_required=0 or v_setup_ready<v_setup_required then
    v_state := 'pending_setup';
  elsif not v_qualifying_settled then
    v_state := 'awaiting_qualifying_settlement';
  else
    v_state := 'ready_for_activation';
  end if;

  return jsonb_build_object(
    'tenantId',p_tenant_id,
    'commercialOrderId',v_order.id,
    'installmentObligationId',v_obligation.id,
    'structureCode',v_obligation.structure_code,
    'contractTemplateCode',v_snapshot.template_code,
    'contractTemplateVersion',v_snapshot.template_version,
    'currency',v_obligation.currency,
    'obligatedAmount',v_obligation.obligated_amount,
    'planCode',v_plan_code,
    'billingCycle',v_billing_cycle,
    'agreementAccepted',v_agreement_accepted_at is not null,
    'agreementAcceptedAt',v_agreement_accepted_at,
    'setupRequiredCount',v_setup_required,
    'setupReadyCount',v_setup_ready,
    'setupReady',v_setup_required>0 and v_setup_ready=v_setup_required,
    'setupReadyAt',v_setup_ready_at,
    'paidInstallmentCount',v_settled_count,
    'installmentCount',v_schedule_count,
    'qualifyingSettlementSequence',v_snapshot.qualifying_settlement_sequence,
    'qualifyingSettlementSatisfied',v_qualifying_settled,
    'provisionalEntitlementMonths',v_snapshot.provisional_entitlement_months,
    'fullyPaid',coalesce((v_settlement->>'outstandingAmount')::numeric,0)<0.005,
    'firstPaidAt',v_first_paid_at,
    'firstSettlementAt',v_first_settlement_at,
    'entitlementState',v_state,
    'activationAt',coalesce(v_provisional.effective_from,v_full.effective_from),
    'provisionalUntil',v_provisional.effective_until,
    'fullTermUntil',v_full.effective_until,
    'nextPayableScheduleId',nullif(v_settlement->>'nextInstallmentScheduleId','')::uuid,
    'nextPayableAmount',coalesce((v_settlement->>'nextPayableAmount')::numeric,0),
    'settlement',v_settlement,
    'schedule',v_schedule,
    'dueEnforcementMode','informational_only'
  );
end;
$$;

create or replace function public.reconcile_sellertray_installment_entitlement(
  p_tenant_id uuid,
  p_installment_obligation_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_order public.sellertray_commercial_orders%rowtype;
  v_snapshot public.sellertray_installment_contract_snapshots%rowtype;
  v_subscription public.tenant_subscriptions%rowtype;
  v_existing_provisional public.sellertray_commercial_entitlement_events%rowtype;
  v_existing_full public.sellertray_commercial_entitlement_events%rowtype;
  v_plan_code text;
  v_billing_cycle text;
  v_agreement_accepted_at timestamptz;
  v_setup_required integer := 0;
  v_setup_ready integer := 0;
  v_setup_ready_at timestamptz;
  v_settlement jsonb;
  v_qualifying_settled boolean := false;
  v_fully_settled boolean := false;
  v_settlement_at timestamptz;
  v_activation_at timestamptz;
  v_provisional_until timestamptz;
  v_full_until timestamptz;
  v_provisional_id uuid;
  v_full_id uuid;
  v_runtime_owned boolean := false;
begin
  perform public.lock_sellertray_commercial_order(io.tenant_id,io.commercial_order_id)
  from public.sellertray_commercial_installment_obligations io where io.tenant_id=p_tenant_id and io.id=p_installment_obligation_id;
  select o.* into strict v_obligation
  from public.sellertray_commercial_installment_obligations o
  where o.tenant_id=p_tenant_id and o.id=p_installment_obligation_id;

  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.tenant_id=p_tenant_id and o.id=v_obligation.commercial_order_id;

  select s.* into strict v_snapshot
  from public.sellertray_installment_contract_snapshots s
  where s.tenant_id=p_tenant_id and s.installment_obligation_id=v_obligation.id;

  select s.plan_code,s.billing_cycle into strict v_plan_code,v_billing_cycle
  from public.sellertray_commercial_order_price_snapshots s
  where s.tenant_id=p_tenant_id and s.commercial_order_id=v_order.id
    and s.line_type='subscription';

  select ac.accepted_at into v_agreement_accepted_at
  from public.sellertray_commercial_agreements a
  join public.sellertray_commercial_agreement_acceptances ac
    on ac.tenant_id=a.tenant_id and ac.agreement_id=a.id
  where a.tenant_id=p_tenant_id
    and a.commercial_order_id=v_order.id
    and a.installment_obligation_id=v_obligation.id
    and a.agreement_family='installment_agreement'
    and public.sellertray_commercial_agreement_terms_current(a.id)
    and not exists (
      select 1 from public.sellertray_commercial_agreements replacement
      where replacement.tenant_id=a.tenant_id and replacement.supersedes_agreement_id=a.id
    )
  order by ac.accepted_at desc limit 1;

  select count(*)::integer,count(r.id)::integer,max(r.ready_at)
    into v_setup_required,v_setup_ready,v_setup_ready_at
  from public.sellertray_commercial_order_price_snapshots s
  left join public.sellertray_commercial_branch_setup_readiness r
    on r.tenant_id=s.tenant_id
   and r.commercial_order_id=s.commercial_order_id
   and r.branch_id=s.branch_id
  where s.tenant_id=p_tenant_id and s.commercial_order_id=v_order.id
    and s.line_type='branch_setup';

  v_settlement := public.get_sellertray_commercial_settlement_state(p_tenant_id,v_order.id);
  v_fully_settled := coalesce((v_settlement->>'outstandingAmount')::numeric,0)<0.005;

  select coalesce(bool_and((x->>'remainingAmount')::numeric<0.005),false)
    into v_qualifying_settled
  from jsonb_array_elements(coalesce(v_settlement->'schedule','[]'::jsonb)) x
  where (x->>'sequenceNo')::integer<=v_snapshot.qualifying_settlement_sequence;

  -- Reconciliation consumes immutable settlement facts. The latest fact present
  -- when the qualifying threshold is first reconciled is a conservative,
  -- deterministic activation boundary. Once a provisional event exists its
  -- original effective_from remains authoritative on every replay.
  select max(event_at) into v_settlement_at
  from (
    select a.approved_at as event_at
    from public.sellertray_commercial_adjustments a
    where a.tenant_id=p_tenant_id and a.commercial_order_id=v_order.id
    union all
    select pc.paid_at
    from public.sellertray_commercial_installment_payment_confirmations pc
    where pc.tenant_id=p_tenant_id and pc.commercial_order_id=v_order.id
    union all
    select dp.paid_at
    from public.sellertray_commercial_direct_payment_confirmations dp
    where dp.tenant_id=p_tenant_id and dp.commercial_order_id=v_order.id
  ) settlement_fact;

  select e.* into v_existing_provisional
  from public.sellertray_commercial_entitlement_events e
  where e.tenant_id=p_tenant_id and e.installment_obligation_id=v_obligation.id
    and e.event_type='installment.provisional_activated'
  order by e.recorded_at desc limit 1;

  select e.* into v_existing_full
  from public.sellertray_commercial_entitlement_events e
  where e.tenant_id=p_tenant_id and e.installment_obligation_id=v_obligation.id
    and e.event_type='installment.full_entitlement_released'
  order by e.recorded_at desc limit 1;

  if v_agreement_accepted_at is null
     or v_setup_required=0 or v_setup_ready<v_setup_required
     or not v_qualifying_settled
     or v_settlement_at is null then
    return public.get_sellertray_installment_billing_state(p_tenant_id,p_installment_obligation_id);
  end if;

  if v_existing_provisional.id is not null then
    v_activation_at := v_existing_provisional.effective_from;
    v_provisional_id := v_existing_provisional.id;
  else
    v_activation_at := greatest(
      v_agreement_accepted_at,
      coalesce(v_setup_ready_at,v_agreement_accepted_at),
      v_settlement_at
    );
  end if;

  if v_billing_cycle='monthly' then
    v_full_until := v_activation_at+interval '1 month';
  elsif v_billing_cycle='yearly' then
    v_full_until := v_activation_at+interval '12 months';
  else
    raise exception 'Unsupported SellerTray billing cycle for entitlement reconciliation'
      using errcode='23514';
  end if;

  if v_snapshot.provisional_entitlement_months>0 then
    v_provisional_until := least(
      v_activation_at+make_interval(months=>v_snapshot.provisional_entitlement_months),
      v_full_until
    );

    if v_existing_provisional.id is null then
      v_provisional_id := public.append_sellertray_commercial_entitlement_event(
        p_tenant_id,v_plan_code,v_order.id,v_obligation.id,
        'installment.provisional_activated',
        'oa2:provisional:'||v_obligation.id::text,
        v_activation_at,v_provisional_until,
        jsonb_build_object(
          'template_code',v_snapshot.template_code,
          'template_version',v_snapshot.template_version,
          'provisional_months',v_snapshot.provisional_entitlement_months,
          'qualifying_settlement_sequence',v_snapshot.qualifying_settlement_sequence,
          'activation_at',v_activation_at,
          'full_term_until',v_full_until
        ),
        null,
        'Governed OA2 installment provisional entitlement'
      );
    end if;
  elsif not v_fully_settled then
    return public.get_sellertray_installment_billing_state(p_tenant_id,p_installment_obligation_id);
  end if;

  if v_fully_settled then
    if v_existing_full.id is not null then
      v_full_id := v_existing_full.id;
    else
      v_full_id := public.append_sellertray_commercial_entitlement_event(
        p_tenant_id,v_plan_code,v_order.id,v_obligation.id,
        'installment.full_entitlement_released',
        'oa2:full:'||v_obligation.id::text,
        v_activation_at,v_full_until,
        jsonb_build_object(
          'template_code',v_snapshot.template_code,
          'template_version',v_snapshot.template_version,
          'billing_cycle',v_billing_cycle,
          'activation_at',v_activation_at,
          'settled_amount',v_settlement->>'netAmountDue'
        ),
        null,
        'Governed OA2 full-settlement entitlement release'
      );
    end if;
  end if;

  select s.* into strict v_subscription
  from public.tenant_subscriptions s
  where s.tenant_id=p_tenant_id
  for update;

  if v_subscription.current_period_start is not null
     and v_subscription.current_period_end is not null then
    select exists (
      select 1
      from public.sellertray_commercial_entitlement_events e
      where e.tenant_id=p_tenant_id
        and e.commercial_order_id=v_order.id
        and e.effective_from=v_subscription.current_period_start
        and e.effective_until=v_subscription.current_period_end
        and e.event_type in ('installment.provisional_activated','installment.full_entitlement_released')
    ) into v_runtime_owned;
  end if;

  if v_subscription.status<>'trial'
     and not v_runtime_owned
     and (
       v_subscription.current_period_start is not null
       or v_subscription.current_period_end is not null
       or v_subscription.status<>'active'
     ) then
    raise exception 'Existing SellerTray runtime subscription is not owned by this commercial installment order'
      using errcode='23505';
  end if;

  update public.tenant_subscriptions
  set plan_code=v_plan_code,
      status='active',
      current_period_start=v_activation_at,
      current_period_end=case
        when v_full_id is not null then v_full_until
        else v_provisional_until
      end,
      grace_ends_at=null,
      cancel_at_period_end=false,
      updated_at=now()
  where tenant_id=p_tenant_id;

  return public.get_sellertray_installment_billing_state(p_tenant_id,p_installment_obligation_id);
end;
$$;

create or replace function public.get_sellertray_onboarding_state_core(
  p_tenant_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_tenant public.tenants%rowtype;
  v_order public.sellertray_commercial_orders%rowtype;
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_subscription public.tenant_subscriptions%rowtype;
  v_has_subscription boolean := false;
  v_plan_code text;
  v_billing_cycle text;
  v_active_branch_count integer := 0;
  v_agreement_required boolean := false;
  v_agreement_accepted_at timestamptz;
  v_schedule_count integer := 0;
  v_paid_schedule_count integer := 0;
  v_first_installment_amount numeric(18,2);
  v_first_paid_at timestamptz;
  v_confirmed_payment_amount numeric(18,2) := 0;
  v_approved_adjustment_amount numeric(18,2) := 0;
  v_outstanding_amount numeric(18,2) := 0;
  v_qualifying_settlement boolean := false;
  v_fully_settled boolean := false;
  v_setup_required_count integer := 0;
  v_setup_ready_count integer := 0;
  v_setup_branches jsonb := '[]'::jsonb;
  v_entitlement_state text := 'not_active';
  v_entitlement_effective_from timestamptz;
  v_entitlement_effective_until timestamptz;
  v_runtime_can_write boolean := false;
  v_current_stage text;
  v_blockers jsonb := '[]'::jsonb;
  v_next_action jsonb;
  v_settlement jsonb;
  v_billing jsonb;
  v_direct_payment_amount numeric(18,2):=0;
  v_policy jsonb;
begin
  if p_tenant_id is null then
    raise exception 'Business is required' using errcode='22023';
  end if;

  select t.* into v_tenant
  from public.tenants t
  where t.id=p_tenant_id;
  if not found then
    raise exception 'Business not found' using errcode='P0002';
  end if;

  select count(*)::integer into v_active_branch_count
  from public.branches b
  where b.tenant_id=p_tenant_id and b.is_active;

  -- The current commercial bridge creates only one initial subscription order.
  -- Select the first governed subscription order so later renewal work cannot
  -- silently redefine the merchant's original onboarding lifecycle.
  select o.* into v_order
  from public.sellertray_commercial_orders o
  where o.tenant_id=p_tenant_id
    and exists (
      select 1
      from public.sellertray_commercial_order_price_snapshots ps
      where ps.tenant_id=o.tenant_id
        and ps.commercial_order_id=o.id
        and ps.line_type='subscription'
    )
  order by o.ordered_at,o.created_at,o.id
  limit 1;

  if v_order.id is not null then
    select ps.plan_code,ps.billing_cycle
      into v_plan_code,v_billing_cycle
    from public.sellertray_commercial_order_price_snapshots ps
    where ps.tenant_id=p_tenant_id
      and ps.commercial_order_id=v_order.id
      and ps.line_type='subscription'
    order by ps.line_no
    limit 1;

    select io.* into v_obligation
    from public.sellertray_commercial_installment_obligations io
    where io.tenant_id=p_tenant_id
      and io.commercial_order_id=v_order.id
    order by io.created_at,io.id
    limit 1;

    if v_obligation.id is not null then
      v_agreement_required := true;

      select ac.accepted_at
        into v_agreement_accepted_at
      from public.sellertray_commercial_agreements a
      join public.sellertray_commercial_agreement_acceptances ac
        on ac.tenant_id=a.tenant_id and ac.agreement_id=a.id
      where a.tenant_id=p_tenant_id
        and a.commercial_order_id=v_order.id
        and a.installment_obligation_id=v_obligation.id
        and a.agreement_family='installment_agreement'
        and public.sellertray_commercial_agreement_terms_current(a.id)
        and not exists (
          select 1
          from public.sellertray_commercial_agreements replacement
          where replacement.tenant_id=a.tenant_id
            and replacement.supersedes_agreement_id=a.id
        )
      order by ac.accepted_at desc
      limit 1;

      select
        count(*)::integer,
        count(distinct pc.installment_schedule_id)::integer,
        coalesce(sum(pc.amount),0)::numeric(18,2),
        max(sch.amount_due) filter (where sch.sequence_no=1),
        max(pc.paid_at) filter (where sch.sequence_no=1)
      into
        v_schedule_count,
        v_paid_schedule_count,
        v_confirmed_payment_amount,
        v_first_installment_amount,
        v_first_paid_at
      from public.sellertray_commercial_installment_schedule sch
      left join public.sellertray_commercial_installment_payment_confirmations pc
        on pc.tenant_id=sch.tenant_id
       and pc.installment_schedule_id=sch.id
      where sch.tenant_id=p_tenant_id
        and sch.installment_obligation_id=v_obligation.id;

      -- C1B's approved installment activation condition is qualifying first
      -- settlement, not full settlement of every later installment.
      v_qualifying_settlement := v_first_paid_at is not null;
    end if;

    v_outstanding_amount := greatest(
      round((v_order.total_gross_amount-v_approved_adjustment_amount-v_confirmed_payment_amount)::numeric,2),
      0::numeric
    );
    v_fully_settled := v_outstanding_amount < 0.005;

    -- A future non-installment first-purchase path may have no installment
    -- obligation. Until its governed confirmation authority lands, only a fully
    -- confirmed zero balance may qualify it as settled.
    if v_obligation.id is null then
      v_qualifying_settlement := v_fully_settled;
    end if;

    v_settlement:=public.get_sellertray_commercial_settlement_state(p_tenant_id,v_order.id);
    v_policy:=public.resolve_sellertray_installment_policy(p_tenant_id,v_order.id,v_plan_code,v_billing_cycle,now());
    v_approved_adjustment_amount:=(v_settlement->>'approvedAdjustmentAmount')::numeric;
    v_direct_payment_amount:=(v_settlement->>'directPaymentAmount')::numeric;
    v_confirmed_payment_amount:=(v_settlement->>'totalConfirmedPaymentAmount')::numeric;
    v_outstanding_amount:=(v_settlement->>'outstandingAmount')::numeric;
    v_fully_settled:=v_outstanding_amount<0.005;
    if v_obligation.id is not null then
      v_billing:=public.get_sellertray_installment_billing_state(p_tenant_id,v_obligation.id);
      v_qualifying_settlement:=coalesce((v_billing->>'qualifyingSettlementSatisfied')::boolean,false);
      v_paid_schedule_count:=(v_billing->>'paidInstallmentCount')::integer;
      v_first_installment_amount:=(v_settlement->'schedule'->0->>'amountDue')::numeric;
      v_first_paid_at:=(v_billing->>'firstPaidAt')::timestamptz;
    else
      v_qualifying_settlement:=v_fully_settled;
    end if;
    select
      count(*)::integer,
      count(r.id)::integer,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'branchId',ps.branch_id,
            'branchCode',b.code,
            'branchName',b.name,
            'ready',r.id is not null,
            'readyAt',r.ready_at
          )
          order by ps.line_no
        ),
        '[]'::jsonb
      )
    into v_setup_required_count,v_setup_ready_count,v_setup_branches
    from public.sellertray_commercial_order_price_snapshots ps
    join public.branches b
      on b.tenant_id=ps.tenant_id and b.id=ps.branch_id
    left join public.sellertray_commercial_branch_setup_readiness r
      on r.tenant_id=ps.tenant_id
     and r.commercial_order_id=ps.commercial_order_id
     and r.branch_id=ps.branch_id
    where ps.tenant_id=p_tenant_id
      and ps.commercial_order_id=v_order.id
      and ps.line_type='branch_setup';

    select
      case e.event_type
        when 'installment.full_entitlement_released' then 'full'
        when 'installment.provisional_activated' then 'provisional'
        else 'not_active'
      end,
      e.effective_from,
      e.effective_until
    into v_entitlement_state,v_entitlement_effective_from,v_entitlement_effective_until
    from public.sellertray_commercial_entitlement_events e
    where e.tenant_id=p_tenant_id
      and e.commercial_order_id=v_order.id
      and e.event_type in (
        'installment.provisional_activated',
        'installment.full_entitlement_released'
      )
    order by
      case e.event_type when 'installment.full_entitlement_released' then 0 else 1 end,
      e.recorded_at desc
    limit 1;

    if not found then
      v_entitlement_state := 'not_active';
      v_entitlement_effective_from := null;
      v_entitlement_effective_until := null;
    end if;
  end if;

  select s.* into v_subscription
  from public.tenant_subscriptions s
  where s.tenant_id=p_tenant_id;
  v_has_subscription := found;

  if v_has_subscription then
    v_runtime_can_write := public.orderdesk_subscription_can_write(p_tenant_id);
  end if;

  -- User-facing stage order follows ONBOARDING_ACTIVATION.md, while the
  -- entitlement event remains authoritative evidence that onboarding activation
  -- already happened. OA1 deliberately does not use this projection to gate Sell.
  if v_entitlement_state in ('provisional','full') then
    v_current_stage := 'active';
    if v_runtime_can_write then
      v_next_action := jsonb_build_object(
        'code','start_selling',
        'label','Continue selling',
        'surface','mobile'
      );
    else
      v_blockers := jsonb_build_array(jsonb_build_object(
        'code','subscription_attention_required',
        'message','The governed onboarding activation exists, but runtime subscription access needs attention.',
        'surface','merchant_web'
      ));
      v_next_action := jsonb_build_object(
        'code','resolve_subscription',
        'label','Review subscription access',
        'surface','merchant_web'
      );
    end if;
  elsif v_order.id is null and v_active_branch_count=0 then
    v_current_stage := 'business_setup';
    v_blockers := jsonb_build_array(jsonb_build_object(
      'code','active_branch_required',
      'message','Prepare at least one active Branch before creating the commercial purchase.',
      'surface','mobile'
    ));
    v_next_action := jsonb_build_object(
      'code','prepare_branch',
      'label','Prepare a Branch',
      'surface','mobile'
    );
  elsif v_order.id is null then
    v_current_stage := 'commercial_order';
    v_blockers := jsonb_build_array(jsonb_build_object(
      'code','commercial_order_required',
      'message','Choose the SellerTray plan and Branch setup scope for this Business.',
      'surface','merchant_web'
    ));
    v_next_action := jsonb_build_object(
      'code','select_plan',
      'label','Choose plan and purchase',
      'surface','merchant_web'
    );
  elsif v_agreement_required and v_agreement_accepted_at is null then
    v_current_stage := 'agreement';
    v_blockers := jsonb_build_array(jsonb_build_object(
      'code','agreement_acceptance_required',
      'message','The current commercial agreement must be accepted before activation can proceed.',
      'surface','merchant_web'
    ));
    v_next_action := jsonb_build_object(
      'code','review_agreement',
      'label','Review and accept agreement',
      'surface','merchant_web'
    );
  elsif not v_qualifying_settlement then
    v_current_stage := 'settlement';
    v_blockers := jsonb_build_array(jsonb_build_object(
      'code','qualifying_settlement_required',
      'message','A qualifying confirmed payment is required before Branch setup can complete activation.',
      'surface','merchant_web'
    ));
    v_next_action := jsonb_build_object(
      'code','pay_outstanding',
      'label','Complete required payment',
      'surface','merchant_web'
    );
  elsif v_setup_required_count=0 then
    v_current_stage := 'setup';
    v_blockers := jsonb_build_array(jsonb_build_object(
      'code','branch_setup_scope_required',
      'message','The commercial purchase does not yet contain a governed Branch setup scope.',
      'surface','admin_web'
    ));
    v_next_action := jsonb_build_object(
      'code','resolve_setup_scope',
      'label','Resolve Branch setup scope',
      'surface','admin_web'
    );
  elsif v_setup_ready_count<v_setup_required_count then
    v_current_stage := 'setup';
    v_blockers := jsonb_build_array(jsonb_build_object(
      'code','branch_setup_incomplete',
      'message',format('%s of %s required Branch setups are complete.',v_setup_ready_count,v_setup_required_count),
      'surface','mobile'
    ));
    v_next_action := jsonb_build_object(
      'code','prepare_branches',
      'label','Prepare Branch setup',
      'surface','mobile'
    );
  else
    v_current_stage := 'activation';
    v_blockers := jsonb_build_array(jsonb_build_object(
      'code','activation_reconciliation_pending',
      'message','Commercial terms, settlement and Branch setup are ready. Activation reconciliation is pending.',
      'surface','shared_core'
    ));
    v_next_action := jsonb_build_object(
      'code','await_activation_reconciliation',
      'label','Await automatic activation',
      'surface','shared_core'
    );
  end if;

  return jsonb_build_object(
    'readModelVersion','oa1-v1',
    'generatedAt',now(),
    'tenantId',p_tenant_id,
    'currentStage',v_current_stage,
    'blockers',v_blockers,
    'nextAction',v_next_action,
    'accessEnforcement','informational_only_until_oa4',
    'branchPreparation',jsonb_build_object(
      'activeBranchCount',v_active_branch_count,
      'readyForCommercialOrder',v_active_branch_count>0
    ),
    'commercialOrder',case when v_order.id is null then null else jsonb_build_object(
      'id',v_order.id,
      'reference',v_order.order_reference,
      'currency',v_order.currency,
      'grossAmount',v_order.total_gross_amount,
      'orderedAt',v_order.ordered_at,
      'planCode',v_plan_code,
      'billingCycle',v_billing_cycle,
      'installmentObligationId',v_obligation.id,
      'installmentStructureCode',v_obligation.structure_code
    ) end,
    'agreement',jsonb_build_object(
      'required',v_agreement_required,
      'accepted',not v_agreement_required or v_agreement_accepted_at is not null,
      'acceptedAt',v_agreement_accepted_at
    ),
    'settlement',jsonb_build_object(
      'currency',coalesce(v_order.currency,v_tenant.currency),
      'grossAmount',coalesce(v_order.total_gross_amount,0),
      'approvedAdjustmentAmount',v_approved_adjustment_amount,
      'gatewayPaymentAmount',coalesce((v_settlement->>'gatewayPaymentAmount')::numeric,0),
      'directPaymentAmount',v_direct_payment_amount,
      'confirmedPaymentAmount',v_confirmed_payment_amount,
      'outstandingAmount',v_outstanding_amount,
      'qualifyingSettlementSatisfied',v_qualifying_settlement,
      'fullySettled',v_fully_settled,
      'installmentCount',v_schedule_count,
      'paidInstallmentCount',v_paid_schedule_count,
      'firstInstallmentAmount',v_first_installment_amount,
      'firstPaidAt',v_first_paid_at
    ),
    'installmentPolicy',v_policy,
    'branchSetup',jsonb_build_object(
      'requiredCount',v_setup_required_count,
      'readyCount',v_setup_ready_count,
      'ready',v_setup_required_count>0 and v_setup_ready_count=v_setup_required_count,
      'branches',v_setup_branches
    ),
    'activation',jsonb_build_object(
      'entitlementState',v_entitlement_state,
      'effectiveFrom',v_entitlement_effective_from,
      'effectiveUntil',v_entitlement_effective_until,
      'operationallyActive',v_entitlement_state in ('provisional','full') and v_runtime_can_write
    ),
    'legacyRuntime',jsonb_build_object(
      'status',case when v_has_subscription then v_subscription.status else null end,
      'canWrite',v_runtime_can_write,
      'compatibilityAccess',v_runtime_can_write and v_entitlement_state='not_active'
    )
  );
end;
$$;

create or replace function public.platform_admin_record_commercial_adjustment(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_command_id uuid,
  p_amount numeric,
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
begin
  if not public.platform_admin_has_capability(
    p_actor_user_id,'admin.pricing.manage',p_tenant_id,now()
  ) then
    raise exception 'Commercial pricing capability required' using errcode='42501';
  end if;
  if char_length(btrim(coalesce(p_reason,'')))<6 then
    raise exception 'Adjustment reason must be at least 6 characters' using errcode='22023';
  end if;
  if p_evidence is null or jsonb_typeof(p_evidence)<>'object' then
    raise exception 'Adjustment evidence must be an object' using errcode='22023';
  end if;

  v_state := public.record_sellertray_commercial_adjustment_internal(
    p_tenant_id,p_commercial_order_id,p_command_id,p_amount,p_reason,p_evidence,p_actor_user_id
  );

  select io.id into v_obligation_id
  from public.sellertray_commercial_installment_obligations io
  where io.tenant_id=p_tenant_id and io.commercial_order_id=p_commercial_order_id
  order by io.created_at,io.id limit 1;
  if v_obligation_id is not null then
    begin
      perform public.reconcile_sellertray_installment_entitlement(p_tenant_id,v_obligation_id);
    exception when others then
      insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
      values(p_actor_user_id,p_tenant_id,'commercial_reconciliation_pending',jsonb_build_object('commercialOrderId',p_commercial_order_id,'commandId',p_command_id,'error',sqlerrm));
    end;
  end if;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values (
    p_actor_user_id,p_tenant_id,'commercial_adjustment_recorded',
    jsonb_build_object(
      'commercialOrderId',p_commercial_order_id,
      'commandId',p_command_id,
      'amount',round(p_amount::numeric,2),
      'reason',btrim(p_reason)
    )
  );

  return public.get_sellertray_commercial_settlement_detail_internal(
    p_tenant_id,p_commercial_order_id
  );
end;
$$;

create or replace function public.platform_admin_record_commercial_direct_payment(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_command_id uuid,
  p_payment_reference text,
  p_payment_method text,
  p_amount numeric,
  p_paid_at timestamptz,
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
begin
  if not public.platform_admin_has_capability(
    p_actor_user_id,'admin.payments.reconcile',p_tenant_id,now()
  ) then
    raise exception 'Payment reconciliation capability required' using errcode='42501';
  end if;
  if char_length(btrim(coalesce(p_reason,'')))<6 then
    raise exception 'Direct payment reason must be at least 6 characters' using errcode='22023';
  end if;
  if p_paid_at is null or p_paid_at>now()+interval '5 minutes' then
    raise exception 'Direct payment time is invalid' using errcode='22023';
  end if;
  if p_evidence is null or jsonb_typeof(p_evidence)<>'object' then
    raise exception 'Direct payment evidence must be an object' using errcode='22023';
  end if;

  v_state := public.record_sellertray_commercial_direct_payment_internal(
    p_tenant_id,p_commercial_order_id,p_command_id,p_payment_reference,p_payment_method,
    p_amount,p_paid_at,p_reason,p_evidence,p_actor_user_id
  );

  select io.id into v_obligation_id
  from public.sellertray_commercial_installment_obligations io
  where io.tenant_id=p_tenant_id and io.commercial_order_id=p_commercial_order_id
  order by io.created_at,io.id limit 1;
  if v_obligation_id is not null then
    begin
      perform public.reconcile_sellertray_installment_entitlement(p_tenant_id,v_obligation_id);
    exception when others then
      insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
      values(p_actor_user_id,p_tenant_id,'commercial_reconciliation_pending',jsonb_build_object('commercialOrderId',p_commercial_order_id,'commandId',p_command_id,'error',sqlerrm));
    end;
  end if;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values (
    p_actor_user_id,p_tenant_id,'commercial_direct_payment_confirmed',
    jsonb_build_object(
      'commercialOrderId',p_commercial_order_id,
      'commandId',p_command_id,
      'paymentReference',btrim(p_payment_reference),
      'paymentMethod',lower(btrim(p_payment_method)),
      'amount',round(p_amount::numeric,2),
      'paidAt',p_paid_at,
      'reason',btrim(p_reason)
    )
  );

  return public.get_sellertray_commercial_settlement_detail_internal(
    p_tenant_id,p_commercial_order_id
  );
end;
$$;

create or replace function public.supersede_sellertray_stale_installment_checkouts(
  p_tenant_id uuid,
  p_commercial_order_id uuid
)
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  v_state jsonb;
  v_next_schedule_id uuid;
  v_next_amount numeric(18,2);
  v_outstanding numeric(18,2);
  v_count integer;
begin
  perform public.lock_sellertray_commercial_order(p_tenant_id,p_commercial_order_id);
  v_state := public.get_sellertray_commercial_settlement_state(p_tenant_id,p_commercial_order_id);
  v_next_schedule_id := nullif(v_state->>'nextInstallmentScheduleId','')::uuid;
  v_next_amount := coalesce((v_state->>'nextPayableAmount')::numeric,0);
  v_outstanding := coalesce((v_state->>'outstandingAmount')::numeric,0);

  update public.billing_checkout_sessions s
  set status='superseded'
  where s.tenant_id=p_tenant_id
    and s.commercial_order_id=p_commercial_order_id
    and s.checkout_kind='installment'
    and s.status in ('preparing','initialized')
    and (
      v_outstanding < 0.005
      or v_next_schedule_id is null
      or s.installment_schedule_id <> v_next_schedule_id
      or abs(coalesce(s.amount,0)-v_next_amount) >= 0.005
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.reserve_sellertray_installment_checkout(
  p_tenant_id uuid,
  p_installment_schedule_id uuid,
  p_command_id uuid,
  p_actor_user_id uuid,
  p_billing_email text
)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_role text;
  v_email text := lower(btrim(coalesce(p_billing_email,'')));
  v_schedule public.sellertray_commercial_installment_schedule%rowtype;
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_order public.sellertray_commercial_orders%rowtype;
  v_plan_code text;
  v_contract jsonb;
  v_state jsonb;
  v_next_schedule_id uuid;
  v_next_amount numeric(18,2);
  v_existing public.billing_checkout_sessions%rowtype;
  v_reference text;
  v_session public.billing_checkout_sessions%rowtype;
begin
  if p_tenant_id is null or p_installment_schedule_id is null
     or p_command_id is null or p_actor_user_id is null then
    raise exception 'Business, installment, command and user are required' using errcode='22023';
  end if;
  if char_length(v_email) not between 3 and 320 or position('@' in v_email)=0 then
    raise exception 'A valid billing email is required' using errcode='22023';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;
  if v_role is distinct from 'owner' then
    raise exception 'Only the business Owner can start installment billing' using errcode='42501';
  end if;

  select sch.* into strict v_schedule
  from public.sellertray_commercial_installment_schedule sch
  where sch.tenant_id=p_tenant_id and sch.id=p_installment_schedule_id;
  select o.* into strict v_obligation
  from public.sellertray_commercial_installment_obligations o
  where o.tenant_id=p_tenant_id and o.id=v_schedule.installment_obligation_id;
  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.tenant_id=p_tenant_id and o.id=v_obligation.commercial_order_id;
  select s.plan_code into strict v_plan_code
  from public.sellertray_commercial_order_price_snapshots s
  where s.tenant_id=p_tenant_id and s.commercial_order_id=v_order.id and s.line_type='subscription';

  perform public.lock_sellertray_commercial_order(p_tenant_id,v_order.id);
  v_contract := public.get_sellertray_installment_contract_checkout_policy(
    p_tenant_id,v_obligation.id,now()
  );
  if not coalesce((v_contract->>'agreementAccepted')::boolean,false) then
    raise exception 'The current installment agreement must be accepted before checkout'
      using errcode='23514';
  end if;

  perform public.supersede_sellertray_stale_installment_checkouts(p_tenant_id,v_order.id);
  v_state := public.get_sellertray_commercial_settlement_state(p_tenant_id,v_order.id);
  v_next_schedule_id := nullif(v_state->>'nextInstallmentScheduleId','')::uuid;
  v_next_amount := coalesce((v_state->>'nextPayableAmount')::numeric,0);

  if coalesce((v_state->>'outstandingAmount')::numeric,0)<0.005 then
    return jsonb_build_object(
      'status','paid','installmentScheduleId',p_installment_schedule_id,
      'amount',0,'currency',v_obligation.currency,'planCode',v_plan_code,
      'needsProviderInitialization',false
    );
  end if;

  select s.* into v_existing
  from public.billing_checkout_sessions s
  where s.tenant_id=p_tenant_id and s.checkout_kind='installment' and s.command_id=p_command_id;
  if found then
    if v_existing.installment_schedule_id<>v_schedule.id
       or v_existing.requested_by_user_id<>p_actor_user_id
       or lower(v_existing.billing_email)<>v_email then
      raise exception 'Installment checkout command is already used for different facts'
        using errcode='23505';
    end if;
    return jsonb_build_object(
      'sessionId',v_existing.id,'status',v_existing.status,'reference',v_existing.reference,
      'authorizationUrl',v_existing.authorization_url,
      'installmentScheduleId',v_existing.installment_schedule_id,'amount',v_existing.amount,
      'currency',v_existing.currency,'planCode',v_existing.plan_code,
      'needsProviderInitialization',v_existing.status='preparing' and v_existing.authorization_url is null
    );
  end if;

  if v_next_schedule_id is distinct from p_installment_schedule_id then
    raise exception 'Selected installment is not the current authoritative payable schedule'
      using errcode='23514';
  end if;

  select s.* into v_existing
  from public.billing_checkout_sessions s
  where s.tenant_id=p_tenant_id and s.checkout_kind='installment'
    and s.installment_schedule_id=v_schedule.id
    and s.status in ('preparing','initialized','paid')
  order by s.created_at desc
  limit 1;
  if found then
    return jsonb_build_object(
      'sessionId',v_existing.id,'status',v_existing.status,'reference',v_existing.reference,
      'authorizationUrl',v_existing.authorization_url,
      'installmentScheduleId',v_existing.installment_schedule_id,'amount',v_existing.amount,
      'currency',v_existing.currency,'planCode',v_existing.plan_code,
      'needsProviderInitialization',false
    );
  end if;

  v_reference := 'sti-'||substr(replace(p_tenant_id::text,'-',''),1,8)
    ||'-'||replace(p_command_id::text,'-','');

  insert into public.billing_checkout_sessions(
    tenant_id,plan_code,requested_by_user_id,billing_email,provider,reference,
    status,checkout_kind,command_id,commercial_order_id,installment_obligation_id,
    installment_schedule_id,amount,currency,created_at,updated_at
  ) values (
    p_tenant_id,v_plan_code,p_actor_user_id,v_email,'paystack',v_reference,
    'preparing','installment',p_command_id,v_order.id,v_obligation.id,
    v_schedule.id,v_next_amount,v_obligation.currency,now(),now()
  ) returning * into v_session;

  return jsonb_build_object(
    'sessionId',v_session.id,'status',v_session.status,'reference',v_session.reference,
    'authorizationUrl',v_session.authorization_url,
    'installmentScheduleId',v_session.installment_schedule_id,'amount',v_session.amount,
    'currency',v_session.currency,'planCode',v_session.plan_code,
    'needsProviderInitialization',true
  );
end;
$$;

create or replace function public.begin_sellertray_installment_checkout_initialization(
  p_session_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_session public.billing_checkout_sessions%rowtype;
begin
  if p_session_id is null then
    raise exception 'Installment checkout session is required' using errcode='22023';
  end if;

  perform public.lock_sellertray_commercial_order(b.tenant_id,b.commercial_order_id) from public.billing_checkout_sessions b where b.id=p_session_id;
  select s.* into strict v_session
  from public.billing_checkout_sessions s
  where s.id=p_session_id and s.checkout_kind='installment';
  perform public.supersede_sellertray_stale_installment_checkouts(v_session.tenant_id,v_session.commercial_order_id);

  select s.* into strict v_session
  from public.billing_checkout_sessions s
  where s.id=p_session_id and s.checkout_kind='installment'
  for update;

  if v_session.status='initialized' and v_session.authorization_url is not null then
    return jsonb_build_object('started',false,'status','initialized','reference',v_session.reference,
      'authorizationUrl',v_session.authorization_url,'startedAt',v_session.provider_initialization_started_at);
  end if;
  if v_session.status in ('failed','superseded') then
    return jsonb_build_object('started',false,'status',v_session.status,'reference',v_session.reference,
      'authorizationUrl',v_session.authorization_url,'startedAt',v_session.provider_initialization_started_at);
  end if;
  if v_session.status<>'preparing' then
    raise exception 'Installment checkout cannot begin provider initialization from its current state'
      using errcode='23514';
  end if;
  if v_session.authorization_url is not null then
    raise exception 'Preparing installment checkout cannot already have a provider authorization URL'
      using errcode='23505';
  end if;
  if v_session.provider_initialization_started_at is not null then
    return jsonb_build_object('started',false,'status','in_progress','reference',v_session.reference,
      'authorizationUrl',null,'startedAt',v_session.provider_initialization_started_at);
  end if;

  update public.billing_checkout_sessions
  set provider_initialization_started_at=now(),updated_at=now()
  where id=v_session.id
  returning * into v_session;

  return jsonb_build_object('started',true,'status','in_progress','reference',v_session.reference,
    'authorizationUrl',null,'startedAt',v_session.provider_initialization_started_at);
end;
$$;

create or replace function public.complete_sellertray_installment_checkout_initialization(
  p_session_id uuid,
  p_provider_reference text,
  p_authorization_url text
)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_session public.billing_checkout_sessions%rowtype;
  v_reference text := btrim(coalesce(p_provider_reference,''));
  v_url text := btrim(coalesce(p_authorization_url,''));
begin
  perform public.lock_sellertray_commercial_order(b.tenant_id,b.commercial_order_id) from public.billing_checkout_sessions b where b.id=p_session_id;
  select s.* into strict v_session
  from public.billing_checkout_sessions s
  where s.id=p_session_id and s.checkout_kind='installment';
  perform public.supersede_sellertray_stale_installment_checkouts(v_session.tenant_id,v_session.commercial_order_id);

  select s.* into strict v_session
  from public.billing_checkout_sessions s
  where s.id=p_session_id and s.checkout_kind='installment'
  for update;

  if v_session.status='superseded' then
    raise exception 'Installment checkout was superseded by newer commercial settlement facts'
      using errcode='23514';
  end if;
  if v_reference<>v_session.reference then
    raise exception 'Billing provider reference does not match reserved installment checkout'
      using errcode='23514';
  end if;
  if char_length(v_url) not between 1 and 4000 then
    raise exception 'Billing provider returned no checkout URL' using errcode='22023';
  end if;

  if v_session.status='initialized' then
    if v_session.authorization_url is distinct from v_url then
      raise exception 'Installment checkout was already initialized with different provider facts'
        using errcode='23505';
    end if;
  elsif v_session.status='preparing' then
    if v_session.provider_initialization_started_at is null then
      raise exception 'Installment checkout provider initialization was not begun'
        using errcode='23514';
    end if;
    update public.billing_checkout_sessions
    set authorization_url=v_url,status='initialized',updated_at=now()
    where id=v_session.id;
  else
    raise exception 'Installment checkout cannot be initialized from its current state'
      using errcode='23514';
  end if;

  return jsonb_build_object('sessionId',v_session.id,'reference',v_session.reference,
    'authorizationUrl',v_url,'status','initialized');
end;
$$;

create or replace function public.confirm_sellertray_installment_payment_from_checkout(
  p_checkout_session_id uuid,
  p_provider_reference text,
  p_provider_transaction_ref text,
  p_amount numeric,
  p_currency text,
  p_paid_at timestamptz,
  p_provider_event_fingerprint text
)
returns uuid
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_session public.billing_checkout_sessions%rowtype;
  v_existing public.sellertray_commercial_installment_payment_confirmations%rowtype;
  v_state jsonb;
  v_next_schedule_id uuid;
  v_next_amount numeric(18,2);
  v_id uuid;
  v_provider_reference text := btrim(coalesce(p_provider_reference,''));
  v_transaction_ref text := nullif(btrim(coalesce(p_provider_transaction_ref,'')),'');
  v_currency text := upper(btrim(coalesce(p_currency,'')));
  v_fingerprint text := btrim(coalesce(p_provider_event_fingerprint,''));
begin
  if p_checkout_session_id is null or p_amount is null or p_paid_at is null then
    raise exception 'Installment checkout, amount and payment time are required' using errcode='22023';
  end if;

  perform public.lock_sellertray_commercial_order(b.tenant_id,b.commercial_order_id) from public.billing_checkout_sessions b where b.id=p_checkout_session_id;
  select s.* into strict v_session
  from public.billing_checkout_sessions s
  where s.id=p_checkout_session_id and s.checkout_kind='installment'
  for update;

  if v_provider_reference<>v_session.reference
     or v_currency<>v_session.currency
     or abs(p_amount-v_session.amount)>=0.005 then
    raise exception 'Confirmed installment payment does not match the reserved amount, currency and reference'
      using errcode='23514';
  end if;
  if char_length(v_fingerprint) not between 16 and 256 then
    raise exception 'Verified provider event fingerprint is required' using errcode='22023';
  end if;

  select pc.* into v_existing
  from public.sellertray_commercial_installment_payment_confirmations pc
  where pc.billing_checkout_session_id=v_session.id;
  if found then
    if v_existing.provider_reference<>v_provider_reference
       or v_existing.provider_transaction_ref is distinct from v_transaction_ref
       or v_existing.provider_event_fingerprint<>v_fingerprint
       or abs(v_existing.amount-p_amount)>=0.005
       or v_existing.currency<>v_currency
       or v_existing.paid_at<>p_paid_at then
      raise exception 'Installment payment checkout is already confirmed with different provider facts'
        using errcode='23505';
    end if;
    return v_existing.id;
  end if;

  perform public.supersede_sellertray_stale_installment_checkouts(
    v_session.tenant_id,v_session.commercial_order_id
  );
  select s.* into strict v_session
  from public.billing_checkout_sessions s
  where s.id=p_checkout_session_id
  for update;

  if v_session.status not in ('preparing','initialized') then
    raise exception 'Installment checkout cannot be confirmed from its current state'
      using errcode='23514';
  end if;
  if v_session.provider_initialization_started_at is null then
    raise exception 'Installment checkout provider initialization was not begun'
      using errcode='23514';
  end if;

  v_state := public.get_sellertray_commercial_settlement_state(
    v_session.tenant_id,v_session.commercial_order_id
  );
  v_next_schedule_id := nullif(v_state->>'nextInstallmentScheduleId','')::uuid;
  v_next_amount := coalesce((v_state->>'nextPayableAmount')::numeric,0);
  if v_next_schedule_id is distinct from v_session.installment_schedule_id
     or abs(v_next_amount-v_session.amount)>=0.005 then
    update public.billing_checkout_sessions set status='superseded',updated_at=now()
    where id=v_session.id;
    raise exception 'Installment checkout was superseded by newer commercial settlement facts'
      using errcode='23514';
  end if;

  if exists (
    select 1 from public.sellertray_commercial_installment_payment_confirmations pc
    where pc.tenant_id=v_session.tenant_id
      and pc.installment_schedule_id=v_session.installment_schedule_id
  ) then
    raise exception 'SellerTray installment is already paid by another provider transaction'
      using errcode='23505';
  end if;

  insert into public.sellertray_commercial_installment_payment_confirmations(
    tenant_id,commercial_order_id,installment_obligation_id,installment_schedule_id,
    billing_checkout_session_id,provider,provider_reference,provider_transaction_ref,
    provider_event_fingerprint,amount,currency,paid_at,recorded_at
  ) values (
    v_session.tenant_id,v_session.commercial_order_id,v_session.installment_obligation_id,
    v_session.installment_schedule_id,v_session.id,v_session.provider,v_provider_reference,
    v_transaction_ref,v_fingerprint,p_amount,v_currency,p_paid_at,now()
  ) returning id into v_id;

  update public.billing_checkout_sessions
  set status='paid',updated_at=now()
  where id=v_session.id;

  return v_id;
end;
$$;

create or replace function public.get_sellertray_commercial_agreement_center(
  p_tenant_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path=''
as $$
declare
  v_role text;
  v_can_accept boolean;
  v_agreements jsonb;
begin
  if p_tenant_id is null or p_actor_user_id is null then
    raise exception 'Business and user are required' using errcode='22023';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;

  if coalesce(v_role,'') not in ('owner','manager') then
    raise exception 'Merchant agreement access requires an Owner or Manager' using errcode='42501';
  end if;

  v_can_accept := public.sellertray_user_has_capability(
    p_tenant_id,p_actor_user_id,'can_accept_commercial_agreements'
  );

  select coalesce(jsonb_agg(row_value order by is_current desc,issued_at desc,agreement_id),'[]'::jsonb)
  into v_agreements
  from (
    select
      a.id as agreement_id,
      a.issued_at,
      not exists (
        select 1
        from public.sellertray_commercial_agreements replacement
        where replacement.tenant_id=a.tenant_id
          and replacement.supersedes_agreement_id=a.id
      ) as is_current,
      jsonb_build_object(
        'id',a.id,
        'reference',a.agreement_reference,
        'family',a.agreement_family,
        'title',t.title,
        'templateVersion',a.template_version_code,
        'templateContentSha256',a.template_content_sha256,
        'contentSha256',a.content_sha256,
        'renderedContent',a.rendered_content,
        'commercialSnapshot',a.commercial_snapshot,
        'commercialOrderId',a.commercial_order_id,
        'installmentObligationId',a.installment_obligation_id,
        'supersedesAgreementId',a.supersedes_agreement_id,
        'isCurrent',not exists (
          select 1
          from public.sellertray_commercial_agreements replacement
          where replacement.tenant_id=a.tenant_id
            and replacement.supersedes_agreement_id=a.id
        ),
        'termsCurrent',public.sellertray_commercial_agreement_terms_current(a.id),
        'issuedAt',a.issued_at,
        'acceptance',case when ac.id is null then null else jsonb_build_object(
          'id',ac.id,
          'acceptedAt',ac.accepted_at,
          'acceptedLegalName',ac.accepted_legal_name,
          'acceptedRole',ac.accepted_role,
          'acceptedByCurrentUser',ac.accepted_by_user_id=p_actor_user_id,
          'agreementContentSha256',ac.agreement_content_sha256,
          'templateContentSha256',ac.template_content_sha256
        ) end
      ) as row_value
    from public.sellertray_commercial_agreements a
    join public.sellertray_commercial_agreement_template_versions t
      on t.id=a.template_version_id
    left join public.sellertray_commercial_agreement_acceptances ac
      on ac.tenant_id=a.tenant_id and ac.agreement_id=a.id
    where a.tenant_id=p_tenant_id
  ) projected;

  return jsonb_build_object(
    'tenantId',p_tenant_id,
    'actorRole',v_role,
    'canAccept',v_can_accept,
    'agreements',v_agreements
  );
end;
$$;

create or replace function public.get_sellertray_commercial_agreement_admin(
  p_actor_user_id uuid,
  p_tenant_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path=''
as $$
declare
  v_role text;
  v_templates jsonb;
  v_orders jsonb;
  v_agreements jsonb;
begin
  if p_actor_user_id is null then
    raise exception 'Administrator user is required' using errcode='22023';
  end if;

  select pa.role into v_role
  from public.platform_admins pa
  where pa.user_id=p_actor_user_id;

  if coalesce(v_role,'') not in ('admin','support') then
    raise exception 'Platform administrator access required' using errcode='42501';
  end if;

  if p_tenant_id is not null and not exists (
    select 1 from public.tenants t where t.id=p_tenant_id
  ) then
    raise exception 'SellerTray business not found' using errcode='P0002';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',t.id,
    'family',t.agreement_family,
    'versionCode',t.version_code,
    'title',t.title,
    'contentBody',t.content_body,
    'contentSha256',t.content_sha256,
    'effectiveFrom',t.effective_from,
    'publishedAt',t.published_at,
    'publishedByUserId',t.published_by_user_id
  ) order by t.agreement_family,t.effective_from desc,t.created_at desc),'[]'::jsonb)
  into v_templates
  from public.sellertray_commercial_agreement_template_versions t;

  if p_tenant_id is null then
    v_orders := '[]'::jsonb;
    v_agreements := '[]'::jsonb;
  else
    select coalesce(jsonb_agg(order_value order by ordered_at desc,order_id),'[]'::jsonb)
    into v_orders
    from (
      select
        o.id as order_id,
        o.ordered_at,
        jsonb_build_object(
          'id',o.id,
          'reference',o.order_reference,
          'currency',o.currency,
          'totalGrossAmount',o.total_gross_amount,
          'orderedAt',o.ordered_at,
          'priceSnapshots',coalesce((
            select jsonb_agg(jsonb_build_object(
              'id',s.id,
              'lineNo',s.line_no,
              'lineType',s.line_type,
              'sourcePriceVersionId',s.source_price_version_id,
              'planCode',s.plan_code,
              'branchId',s.branch_id,
              'billingCycle',s.billing_cycle,
              'description',s.description_snapshot,
              'quantity',s.quantity,
              'currency',s.currency,
              'unitGrossAmount',s.unit_gross_amount,
              'grossAmount',s.gross_amount,
              'netAmount',s.net_amount,
              'taxRatePercent',s.tax_rate_percent,
              'taxAmount',s.tax_amount
            ) order by s.line_no)
            from public.sellertray_commercial_order_price_snapshots s
            where s.tenant_id=o.tenant_id and s.commercial_order_id=o.id
          ),'[]'::jsonb),
          'installmentObligations',coalesce((
            select jsonb_agg(jsonb_build_object(
              'id',io.id,
              'structureCode',io.structure_code,
              'currency',io.currency,
              'obligatedAmount',io.obligated_amount,
              'createdAt',io.created_at,
              'schedule',coalesce((
                select jsonb_agg(jsonb_build_object(
                  'sequenceNo',sch.sequence_no,
                  'percentage',sch.percentage,
                  'amountDue',sch.amount_due,
                  'dueAt',sch.due_at
                ) order by sch.sequence_no)
                from public.sellertray_commercial_installment_schedule sch
                where sch.tenant_id=io.tenant_id
                  and sch.installment_obligation_id=io.id
              ),'[]'::jsonb)
            ) order by io.created_at,io.id)
            from public.sellertray_commercial_installment_obligations io
            where io.tenant_id=o.tenant_id and io.commercial_order_id=o.id
          ),'[]'::jsonb)
        ) as order_value
      from public.sellertray_commercial_orders o
      where o.tenant_id=p_tenant_id
    ) projected_orders;

    select coalesce(jsonb_agg(agreement_value order by is_current desc,issued_at desc,agreement_id),'[]'::jsonb)
    into v_agreements
    from (
      select
        a.id as agreement_id,
        a.issued_at,
        not exists (
          select 1 from public.sellertray_commercial_agreements replacement
          where replacement.tenant_id=a.tenant_id
            and replacement.supersedes_agreement_id=a.id
        ) as is_current,
        jsonb_build_object(
          'id',a.id,
          'reference',a.agreement_reference,
          'family',a.agreement_family,
          'title',t.title,
          'templateVersionId',a.template_version_id,
          'templateVersion',a.template_version_code,
          'templateContentSha256',a.template_content_sha256,
          'contentSha256',a.content_sha256,
          'renderedContent',a.rendered_content,
          'commercialSnapshot',a.commercial_snapshot,
          'commercialOrderId',a.commercial_order_id,
          'installmentObligationId',a.installment_obligation_id,
          'supersedesAgreementId',a.supersedes_agreement_id,
          'isCurrent',not exists (
            select 1 from public.sellertray_commercial_agreements replacement
            where replacement.tenant_id=a.tenant_id
              and replacement.supersedes_agreement_id=a.id
          ),
          'termsCurrent',public.sellertray_commercial_agreement_terms_current(a.id),
        'issuedAt',a.issued_at,
          'issuedByUserId',a.issued_by_user_id,
          'acceptance',case when ac.id is null then null else jsonb_build_object(
            'id',ac.id,
            'acceptedAt',ac.accepted_at,
            'acceptedLegalName',ac.accepted_legal_name,
            'acceptedRole',ac.accepted_role,
            'acceptedByUserId',ac.accepted_by_user_id,
            'agreementContentSha256',ac.agreement_content_sha256,
            'templateContentSha256',ac.template_content_sha256
          ) end
        ) as agreement_value
      from public.sellertray_commercial_agreements a
      join public.sellertray_commercial_agreement_template_versions t
        on t.id=a.template_version_id
      left join public.sellertray_commercial_agreement_acceptances ac
        on ac.tenant_id=a.tenant_id and ac.agreement_id=a.id
      where a.tenant_id=p_tenant_id
    ) projected_agreements;
  end if;

  return jsonb_build_object(
    'actorRole',v_role,
    'canManage',v_role='admin',
    'tenantId',p_tenant_id,
    'templates',v_templates,
    'commercialOrders',v_orders,
    'agreements',v_agreements
  );
end;
$$;

commit;
