begin;

-- SellerTray C2-6 review hardening.
--
-- Preserve the latest OA2 concurrency and settlement semantics while extending
-- the existing checkout/payment pipeline to Branch-scoped Commercial V2
-- obligations. This remains parallel authority only; tenant_subscriptions and
-- operational runtime access are intentionally untouched.

-- ---------------------------------------------------------------------------
-- 1. Preserve the latest safe trigger-table dispatch while supporting fixed
--    installment allocations introduced by Commercial V2.
-- ---------------------------------------------------------------------------

create or replace function public.validate_sellertray_commercial_installment_schedule()
returns trigger
language plpgsql
set search_path=''
as $function$
declare
  v_obligation_id uuid;
  v_tenant_id uuid;
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_count integer;
  v_percentage_count integer;
  v_fixed_count integer;
  v_percent numeric;
  v_amount numeric;
  v_first numeric;
  v_second numeric;
  v_third numeric;
begin
  if tg_table_name='sellertray_commercial_installment_obligations' then
    v_obligation_id:=new.id;
    v_tenant_id:=new.tenant_id;
  elsif tg_table_name='sellertray_commercial_installment_schedule' then
    v_obligation_id:=new.installment_obligation_id;
    v_tenant_id:=new.tenant_id;
  else
    raise exception 'Unexpected SellerTray installment trigger table: %',tg_table_name
      using errcode='55000';
  end if;

  select o.* into v_obligation
  from public.sellertray_commercial_installment_obligations o
  where o.id=v_obligation_id and o.tenant_id=v_tenant_id;
  if not found then return new; end if;

  select count(*)::integer,
         count(*) filter(where s.allocation_mode='percentage')::integer,
         count(*) filter(where s.allocation_mode='fixed')::integer,
         coalesce(sum(s.percentage),0),
         coalesce(sum(s.amount_due),0),
         max(s.amount_due) filter(where s.sequence_no=1),
         max(s.amount_due) filter(where s.sequence_no=2),
         max(s.amount_due) filter(where s.sequence_no=3)
    into v_count,v_percentage_count,v_fixed_count,v_percent,v_amount,v_first,v_second,v_third
  from public.sellertray_commercial_installment_schedule s
  where s.installment_obligation_id=v_obligation.id
    and s.tenant_id=v_obligation.tenant_id;

  if v_count=0 or abs(v_amount-v_obligation.obligated_amount)>=0.005 then
    raise exception 'SellerTray installment schedule must reconcile to the commercial obligation'
      using errcode='23514';
  end if;
  if v_percentage_count not in (0,v_count) or v_fixed_count not in (0,v_count) then
    raise exception 'SellerTray installment schedule cannot mix percentage and fixed allocations'
      using errcode='23514';
  end if;
  if v_percentage_count=v_count and abs(v_percent-100)>=0.0001 then
    raise exception 'SellerTray percentage installment schedule must reconcile to 100 percent'
      using errcode='23514';
  end if;
  if v_fixed_count=v_count and exists(
    select 1
    from public.sellertray_commercial_installment_schedule s
    where s.tenant_id=v_obligation.tenant_id
      and s.installment_obligation_id=v_obligation.id
      and abs(s.amount_due-s.fixed_amount_snapshot)>=0.005
  ) then
    raise exception 'SellerTray fixed installment schedule must preserve its snapshotted fixed amounts'
      using errcode='23514';
  end if;

  -- Historical C1 accepted structures retain their exact arithmetic contract.
  if v_obligation.structure_code='two_installment_70_30' then
    if v_count<>2 or v_percentage_count<>2
       or not exists(select 1 from public.sellertray_commercial_installment_schedule s where s.installment_obligation_id=v_obligation.id and s.sequence_no=1 and s.percentage=70)
       or not exists(select 1 from public.sellertray_commercial_installment_schedule s where s.installment_obligation_id=v_obligation.id and s.sequence_no=2 and s.percentage=30)
       or abs(v_first-round((v_obligation.obligated_amount*0.70)::numeric,2))>=0.005
       or abs(v_second-(v_obligation.obligated_amount-v_first))>=0.005 then
      raise exception 'SellerTray two-installment schedule must preserve the approved 70:30 structure'
        using errcode='23514';
    end if;
  elsif v_obligation.structure_code='three_installment_60_20_20' then
    if v_count<>3 or v_percentage_count<>3
       or not exists(select 1 from public.sellertray_commercial_installment_schedule s where s.installment_obligation_id=v_obligation.id and s.sequence_no=1 and s.percentage=60)
       or not exists(select 1 from public.sellertray_commercial_installment_schedule s where s.installment_obligation_id=v_obligation.id and s.sequence_no=2 and s.percentage=20)
       or not exists(select 1 from public.sellertray_commercial_installment_schedule s where s.installment_obligation_id=v_obligation.id and s.sequence_no=3 and s.percentage=20)
       or abs(v_first-round((v_obligation.obligated_amount*0.60)::numeric,2))>=0.005
       or abs(v_second-round((v_obligation.obligated_amount*0.20)::numeric,2))>=0.005
       or abs(v_third-(v_obligation.obligated_amount-v_first-v_second))>=0.005 then
      raise exception 'SellerTray three-installment schedule must preserve the approved 60:20:20 structure'
        using errcode='23514';
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function public.validate_sellertray_commercial_installment_schedule()
  from public,anon,authenticated;

-- ---------------------------------------------------------------------------
-- 2. Branch setup is derived/validated from historical commercial evidence.
--    A caller cannot waive a first setup charge or charge setup again on a
--    Branch that already has governed setup history.
-- ---------------------------------------------------------------------------

create or replace function public.sellertray_branch_requires_commercial_setup(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_excluding_commercial_order_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path=''
as $function$
  select not exists(
    select 1
    from public.sellertray_commercial_order_price_snapshots s
    where s.tenant_id=p_tenant_id
      and s.branch_id=p_branch_id
      and s.line_type='branch_setup'
      and (p_excluding_commercial_order_id is null or s.commercial_order_id<>p_excluding_commercial_order_id)
  );
$function$;

revoke all on function public.sellertray_branch_requires_commercial_setup(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.sellertray_branch_requires_commercial_setup(uuid,uuid,uuid)
  to service_role;

create or replace function public.validate_sellertray_branch_commercial_order_subject()
returns trigger
language plpgsql
set search_path=''
as $function$
declare
  v_subscription_line public.sellertray_commercial_order_price_snapshots%rowtype;
  v_setup_line public.sellertray_commercial_order_price_snapshots%rowtype;
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_expected_setup boolean;
begin
  select l.* into strict v_subscription_line
  from public.sellertray_commercial_order_price_snapshots l
  where l.tenant_id=new.tenant_id and l.id=new.branch_subscription_line_id;
  if v_subscription_line.commercial_order_id<>new.commercial_order_id
     or v_subscription_line.line_type<>'branch_subscription'
     or v_subscription_line.branch_id<>new.branch_id
     or v_subscription_line.plan_profile_version_id<>new.plan_profile_version_id
     or v_subscription_line.billing_cycle<>new.billing_cycle then
    raise exception 'Branch commercial subject does not match its subscription price snapshot'
      using errcode='23514';
  end if;

  v_expected_setup:=public.sellertray_branch_requires_commercial_setup(
    new.tenant_id,new.branch_id,new.commercial_order_id
  );
  if new.setup_required<>v_expected_setup then
    raise exception 'Branch setup requirement must be derived from governed historical setup evidence'
      using errcode='23514';
  end if;

  if new.setup_required then
    select l.* into strict v_setup_line
    from public.sellertray_commercial_order_price_snapshots l
    where l.tenant_id=new.tenant_id and l.id=new.branch_setup_line_id;
    if v_setup_line.commercial_order_id<>new.commercial_order_id
       or v_setup_line.line_type<>'branch_setup'
       or v_setup_line.branch_id<>new.branch_id then
      raise exception 'Branch commercial subject setup line does not match the Branch commitment'
        using errcode='23514';
    end if;
  end if;

  select o.* into strict v_obligation
  from public.sellertray_commercial_installment_obligations o
  where o.tenant_id=new.tenant_id and o.id=new.installment_obligation_id;
  if v_obligation.commercial_order_id<>new.commercial_order_id
     or v_obligation.commercial_order_line_id<>new.branch_subscription_line_id
     or v_obligation.branch_id<>new.branch_id
     or v_obligation.obligation_scope<>'branch_subscription' then
    raise exception 'Branch commercial subject settlement obligation does not match its Branch commitment'
      using errcode='23514';
  end if;
  return new;
end;
$function$;

revoke all on function public.validate_sellertray_branch_commercial_order_subject()
  from public,anon,authenticated;
create trigger validate_sellertray_branch_commercial_order_subject
before insert on public.sellertray_branch_commercial_order_subjects
for each row execute function public.validate_sellertray_branch_commercial_order_subject();

-- ---------------------------------------------------------------------------
-- 3. Preserve OA2 order locking when inserting any discount/direct payment.
--    Commercial V2 credits are scoped to one Branch obligation.
-- ---------------------------------------------------------------------------

create or replace function public.prepare_sellertray_commercial_credit_fact()
returns trigger
language plpgsql
set search_path=''
as $function$
declare
  v_order public.sellertray_commercial_orders%rowtype;
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_adjustments numeric(18,2);
  v_gateway numeric(18,2);
  v_direct numeric(18,2);
  v_ceiling numeric(18,2);
begin
  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.tenant_id=new.tenant_id and o.id=new.commercial_order_id
  for update;

  new.currency:=v_order.currency;
  new.reason:=btrim(new.reason);

  if new.installment_obligation_id is not null then
    select o.* into strict v_obligation
    from public.sellertray_commercial_installment_obligations o
    where o.tenant_id=new.tenant_id
      and o.commercial_order_id=new.commercial_order_id
      and o.id=new.installment_obligation_id;
    v_ceiling:=v_obligation.obligated_amount;

    select coalesce(sum(a.amount),0)::numeric(18,2) into v_adjustments
    from public.sellertray_commercial_adjustments a
    where a.tenant_id=new.tenant_id and a.commercial_order_id=new.commercial_order_id
      and a.installment_obligation_id=new.installment_obligation_id;
    select coalesce(sum(p.amount),0)::numeric(18,2) into v_gateway
    from public.sellertray_commercial_installment_payment_confirmations p
    where p.tenant_id=new.tenant_id and p.commercial_order_id=new.commercial_order_id
      and p.installment_obligation_id=new.installment_obligation_id;
    select coalesce(sum(p.amount),0)::numeric(18,2) into v_direct
    from public.sellertray_commercial_direct_payment_confirmations p
    where p.tenant_id=new.tenant_id and p.commercial_order_id=new.commercial_order_id
      and p.installment_obligation_id=new.installment_obligation_id;
  else
    if v_order.order_kind='branch_commercial_v2' then
      raise exception 'Commercial V2 Branch orders require obligation-scoped credits'
        using errcode='23514';
    end if;
    v_ceiling:=v_order.total_gross_amount;
    select coalesce(sum(a.amount),0)::numeric(18,2) into v_adjustments
    from public.sellertray_commercial_adjustments a
    where a.tenant_id=new.tenant_id and a.commercial_order_id=new.commercial_order_id;
    select coalesce(sum(p.amount),0)::numeric(18,2) into v_gateway
    from public.sellertray_commercial_installment_payment_confirmations p
    where p.tenant_id=new.tenant_id and p.commercial_order_id=new.commercial_order_id;
    select coalesce(sum(p.amount),0)::numeric(18,2) into v_direct
    from public.sellertray_commercial_direct_payment_confirmations p
    where p.tenant_id=new.tenant_id and p.commercial_order_id=new.commercial_order_id;
  end if;

  if v_adjustments+v_gateway+v_direct+new.amount>v_ceiling+0.004 then
    raise exception 'Commercial credits cannot exceed the governed obligation gross'
      using errcode='23514';
  end if;
  return new;
end;
$function$;

revoke all on function public.prepare_sellertray_commercial_credit_fact()
  from public,anon,authenticated;

-- ---------------------------------------------------------------------------
-- 4. Branch obligation settlement. Discounts reduce the payable contract first;
--    confirmed payments then settle that reduced payable schedule. Percentage
--    schedules rebase against net due (preserving existing OA2 semantics). Fixed
--    schedules retain earlier fixed installments and reduce later installments
--    first, deterministically, without mutating the accepted contract snapshot.
-- ---------------------------------------------------------------------------

create or replace function public.get_sellertray_commercial_obligation_settlement_state(
  p_tenant_id uuid,
  p_installment_obligation_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_order public.sellertray_commercial_orders%rowtype;
  v_line public.sellertray_commercial_order_price_snapshots%rowtype;
  v_adjustments numeric(18,2):=0;
  v_gateway numeric(18,2):=0;
  v_direct numeric(18,2):=0;
  v_net_due numeric(18,2):=0;
  v_total_paid numeric(18,2):=0;
  v_outstanding numeric(18,2):=0;
  v_credit numeric(18,2):=0;
  v_schedule jsonb:='[]'::jsonb;
  v_next_schedule_id uuid;
  v_next_payable numeric(18,2);
  v_status text;
  v_payment_selection jsonb;
begin
  select o.* into strict v_obligation
  from public.sellertray_commercial_installment_obligations o
  where o.tenant_id=p_tenant_id and o.id=p_installment_obligation_id;
  if v_obligation.obligation_scope<>'branch_subscription' then
    raise exception 'Branch obligation settlement requires a Commercial V2 Branch obligation'
      using errcode='23514';
  end if;

  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.tenant_id=p_tenant_id and o.id=v_obligation.commercial_order_id;
  select l.* into strict v_line
  from public.sellertray_commercial_order_price_snapshots l
  where l.tenant_id=p_tenant_id and l.id=v_obligation.commercial_order_line_id;

  select coalesce(sum(a.amount),0)::numeric(18,2) into v_adjustments
  from public.sellertray_commercial_adjustments a
  where a.tenant_id=p_tenant_id and a.commercial_order_id=v_order.id
    and a.installment_obligation_id=p_installment_obligation_id;
  select coalesce(sum(p.amount),0)::numeric(18,2) into v_gateway
  from public.sellertray_commercial_installment_payment_confirmations p
  where p.tenant_id=p_tenant_id and p.commercial_order_id=v_order.id
    and p.installment_obligation_id=p_installment_obligation_id;
  select coalesce(sum(p.amount),0)::numeric(18,2) into v_direct
  from public.sellertray_commercial_direct_payment_confirmations p
  where p.tenant_id=p_tenant_id and p.commercial_order_id=v_order.id
    and p.installment_obligation_id=p_installment_obligation_id;

  v_net_due:=greatest(v_obligation.obligated_amount-v_adjustments,0)::numeric(18,2);
  v_total_paid:=(v_gateway+v_direct)::numeric(18,2);
  v_outstanding:=greatest(v_net_due-v_total_paid,0)::numeric(18,2);
  v_credit:=least(v_total_paid,v_net_due)::numeric(18,2);

  with raw_lines as (
    select s.*,
           max(s.sequence_no) over() last_sequence,
           coalesce(sum(s.amount_due) over(
             order by s.sequence_no rows between unbounded preceding and 1 preceding
           ),0)::numeric(18,2) prior_contract_due,
           case when s.allocation_mode='percentage'
             then round((v_net_due*s.percentage/100)::numeric,2)
             else null end::numeric(18,2) rounded_due
    from public.sellertray_commercial_installment_schedule s
    where s.tenant_id=p_tenant_id and s.installment_obligation_id=p_installment_obligation_id
  ), payable_lines as (
    select r.id,r.sequence_no,r.allocation_mode,r.percentage,r.fixed_amount_snapshot,
           r.amount_due as contract_amount_due,r.due_at,
           case
             when r.allocation_mode='percentage' and r.sequence_no=r.last_sequence then
               greatest(v_net_due-coalesce(sum(r.rounded_due) over(
                 order by r.sequence_no rows between unbounded preceding and 1 preceding
               ),0),0)
             when r.allocation_mode='percentage' then r.rounded_due
             else least(r.amount_due,greatest(v_net_due-r.prior_contract_due,0))
           end::numeric(18,2) amount_due
    from raw_lines r
  ), lines as (
    select p.*,
           coalesce(sum(p.amount_due) over(
             order by p.sequence_no rows between unbounded preceding and 1 preceding
           ),0)::numeric(18,2) prior_due
    from payable_lines p
  ), allocated as (
    select l.*,
           least(l.amount_due,greatest(v_credit-l.prior_due,0))::numeric(18,2) settled_amount,
           greatest(l.amount_due-least(l.amount_due,greatest(v_credit-l.prior_due,0)),0)::numeric(18,2) remaining_amount
    from lines l
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'scheduleId',a.id,'sequenceNo',a.sequence_no,'allocationMode',a.allocation_mode,
           'percentage',a.percentage,'fixedAmount',a.fixed_amount_snapshot,
           'contractAmountDue',a.contract_amount_due,'amountDue',a.amount_due,
           'settledAmount',a.settled_amount,'remainingAmount',a.remaining_amount,
           'dueAt',a.due_at,'settled',a.remaining_amount<0.005
         ) order by a.sequence_no),'[]'::jsonb),
         (array_agg(a.id order by a.sequence_no) filter(where a.remaining_amount>=0.005))[1],
         (array_agg(least(a.remaining_amount,v_outstanding)::numeric(18,2) order by a.sequence_no)
            filter(where a.remaining_amount>=0.005))[1]
    into v_schedule,v_next_schedule_id,v_next_payable
  from allocated a;

  if v_outstanding<0.005 then
    v_status:='settled'; v_next_schedule_id:=null; v_next_payable:=0;
  elsif v_total_paid>0 or v_adjustments>0 then
    v_status:='partially_settled';
  else
    v_status:='unsettled';
  end if;

  select jsonb_build_object(
    'selectionId',s.id,'paymentMethodVersionId',s.payment_method_version_id,
    'selectedAt',s.selected_at,'methodCode',m.code,'displayName',v.display_name,
    'methodType',v.method_type,'confirmationMode',v.confirmation_mode
  ) into v_payment_selection
  from public.sellertray_commercial_payment_method_selections s
  join public.sellertray_commercial_payment_method_versions v on v.id=s.payment_method_version_id
  join public.sellertray_commercial_payment_methods m on m.id=v.payment_method_id
  where s.tenant_id=p_tenant_id and s.installment_obligation_id=p_installment_obligation_id
  order by s.selected_at desc,s.created_at desc,s.id desc
  limit 1;

  return jsonb_build_object(
    'tenantId',p_tenant_id,'commercialOrderId',v_order.id,
    'installmentObligationId',v_obligation.id,'obligationScope',v_obligation.obligation_scope,
    'branchId',v_obligation.branch_id,'commercialOrderLineId',v_obligation.commercial_order_line_id,
    'planProfileVersionId',v_line.plan_profile_version_id,'billingCycle',v_line.billing_cycle,
    'currency',v_obligation.currency,'grossAmount',v_obligation.obligated_amount,
    'approvedAdjustmentAmount',v_adjustments,'gatewayPaymentAmount',v_gateway,
    'directPaymentAmount',v_direct,'totalConfirmedPaymentAmount',v_total_paid,
    'netAmountDue',v_net_due,'outstandingAmount',v_outstanding,
    'overpaymentAmount',greatest(v_total_paid-v_net_due,0)::numeric(18,2),
    'settlementStatus',v_status,'schedule',v_schedule,
    'nextInstallmentScheduleId',v_next_schedule_id,
    'nextPayableAmount',coalesce(v_next_payable,v_outstanding),
    'paymentMethodSelection',v_payment_selection
  );
end;
$function$;

revoke all on function public.get_sellertray_commercial_obligation_settlement_state(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.get_sellertray_commercial_obligation_settlement_state(uuid,uuid)
  to service_role;

-- Aggregate C2 Branch obligations without manufacturing one Business renewal
-- lifecycle. Legacy C1 orders preserve the current exact settlement algorithm.
create or replace function public.get_sellertray_commercial_settlement_state(
  p_tenant_id uuid,
  p_commercial_order_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  v_order public.sellertray_commercial_orders%rowtype;
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_adjustments numeric(18,2):=0;
  v_gateway numeric(18,2):=0;
  v_direct numeric(18,2):=0;
  v_net_due numeric(18,2):=0;
  v_total_paid numeric(18,2):=0;
  v_outstanding numeric(18,2):=0;
  v_credit numeric(18,2):=0;
  v_schedule jsonb:='[]'::jsonb;
  v_next_schedule_id uuid;
  v_next_payable numeric(18,2);
  v_status text;
  v_obligations jsonb:='[]'::jsonb;
begin
  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.tenant_id=p_tenant_id and o.id=p_commercial_order_id;

  if v_order.order_kind='branch_commercial_v2' then
    select coalesce(jsonb_agg(x.state order by x.branch_id),'[]'::jsonb),
           coalesce(sum((x.state->>'approvedAdjustmentAmount')::numeric),0)::numeric(18,2),
           coalesce(sum((x.state->>'gatewayPaymentAmount')::numeric),0)::numeric(18,2),
           coalesce(sum((x.state->>'directPaymentAmount')::numeric),0)::numeric(18,2),
           coalesce(sum((x.state->>'netAmountDue')::numeric),0)::numeric(18,2),
           coalesce(sum((x.state->>'totalConfirmedPaymentAmount')::numeric),0)::numeric(18,2),
           coalesce(sum((x.state->>'outstandingAmount')::numeric),0)::numeric(18,2)
      into v_obligations,v_adjustments,v_gateway,v_direct,v_net_due,v_total_paid,v_outstanding
    from (
      select o.branch_id,public.get_sellertray_commercial_obligation_settlement_state(
        p_tenant_id,o.id
      ) state
      from public.sellertray_commercial_installment_obligations o
      where o.tenant_id=p_tenant_id
        and o.commercial_order_id=p_commercial_order_id
        and o.obligation_scope='branch_subscription'
    ) x;

    if jsonb_array_length(v_obligations)=0 then
      raise exception 'Commercial V2 Branch order has no settlement obligations' using errcode='23514';
    end if;
    if v_outstanding<0.005 then v_status:='settled';
    elsif v_total_paid>0 or v_adjustments>0 then v_status:='partially_settled';
    else v_status:='unsettled'; end if;

    return jsonb_build_object(
      'tenantId',p_tenant_id,'commercialOrderId',p_commercial_order_id,
      'currency',v_order.currency,'grossAmount',v_order.total_gross_amount,
      'approvedAdjustmentAmount',v_adjustments,'gatewayPaymentAmount',v_gateway,
      'directPaymentAmount',v_direct,'totalConfirmedPaymentAmount',v_total_paid,
      'netAmountDue',v_net_due,'outstandingAmount',v_outstanding,
      'overpaymentAmount',greatest(v_total_paid-v_net_due,0)::numeric(18,2),
      'settlementStatus',v_status,'installmentObligationId',null,
      'schedule','[]'::jsonb,'nextInstallmentScheduleId',null,
      'nextPayableAmount',null,'obligations',v_obligations
    );
  end if;

  -- Exact legacy OA2 behavior.
  select coalesce(sum(a.amount),0)::numeric(18,2) into v_adjustments
  from public.sellertray_commercial_adjustments a
  where a.tenant_id=p_tenant_id and a.commercial_order_id=p_commercial_order_id;
  select coalesce(sum(p.amount),0)::numeric(18,2) into v_gateway
  from public.sellertray_commercial_installment_payment_confirmations p
  where p.tenant_id=p_tenant_id and p.commercial_order_id=p_commercial_order_id;
  select coalesce(sum(p.amount),0)::numeric(18,2) into v_direct
  from public.sellertray_commercial_direct_payment_confirmations p
  where p.tenant_id=p_tenant_id and p.commercial_order_id=p_commercial_order_id;

  v_net_due:=greatest(v_order.total_gross_amount-v_adjustments,0)::numeric(18,2);
  v_total_paid:=(v_gateway+v_direct)::numeric(18,2);
  v_outstanding:=greatest(v_net_due-v_total_paid,0)::numeric(18,2);
  v_credit:=least(v_total_paid,v_net_due)::numeric(18,2);

  select o.* into v_obligation
  from public.sellertray_commercial_installment_obligations o
  where o.tenant_id=p_tenant_id and o.commercial_order_id=p_commercial_order_id
    and o.obligation_scope='commercial_order';

  if found then
    with raw_lines as (
      select s.*,max(s.sequence_no) over() last_sequence,
             round((v_net_due*s.percentage/100)::numeric,2)::numeric(18,2) rounded_due
      from public.sellertray_commercial_installment_schedule s
      where s.tenant_id=p_tenant_id and s.installment_obligation_id=v_obligation.id
    ), payable_lines as (
      select r.id,r.sequence_no,r.percentage,r.due_at,
        case when r.sequence_no=r.last_sequence then
          v_net_due-coalesce(sum(r.rounded_due) over(
            order by r.sequence_no rows between unbounded preceding and 1 preceding
          ),0)
        else r.rounded_due end::numeric(18,2) amount_due
      from raw_lines r
    ), lines as (
      select p.*,coalesce(sum(p.amount_due) over(
        order by p.sequence_no rows between unbounded preceding and 1 preceding
      ),0)::numeric(18,2) prior_due
      from payable_lines p
    ), allocated as (
      select l.*,
             least(l.amount_due,greatest(v_credit-l.prior_due,0))::numeric(18,2) settled_amount,
             greatest(l.amount_due-least(l.amount_due,greatest(v_credit-l.prior_due,0)),0)::numeric(18,2) remaining_amount
      from lines l
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'scheduleId',a.id,'sequenceNo',a.sequence_no,'percentage',a.percentage,
             'amountDue',a.amount_due,'settledAmount',a.settled_amount,
             'remainingAmount',a.remaining_amount,'dueAt',a.due_at,
             'settled',a.remaining_amount<0.005
           ) order by a.sequence_no),'[]'::jsonb),
           (array_agg(a.id order by a.sequence_no) filter(where a.remaining_amount>=0.005))[1],
           (array_agg(least(a.remaining_amount,v_outstanding)::numeric(18,2) order by a.sequence_no)
              filter(where a.remaining_amount>=0.005))[1]
      into v_schedule,v_next_schedule_id,v_next_payable
    from allocated a;
  end if;

  if v_outstanding<0.005 then
    v_status:='settled'; v_next_schedule_id:=null; v_next_payable:=0;
  elsif v_total_paid>0 or v_adjustments>0 then v_status:='partially_settled';
  else v_status:='unsettled'; end if;

  return jsonb_build_object(
    'tenantId',p_tenant_id,'commercialOrderId',p_commercial_order_id,
    'currency',v_order.currency,'grossAmount',v_order.total_gross_amount,
    'approvedAdjustmentAmount',v_adjustments,'gatewayPaymentAmount',v_gateway,
    'directPaymentAmount',v_direct,'totalConfirmedPaymentAmount',v_total_paid,
    'netAmountDue',v_net_due,'outstandingAmount',v_outstanding,
    'overpaymentAmount',greatest(v_total_paid-v_net_due,0)::numeric(18,2),
    'settlementStatus',v_status,'installmentObligationId',v_obligation.id,
    'schedule',v_schedule,'nextInstallmentScheduleId',v_next_schedule_id,
    'nextPayableAmount',coalesce(v_next_payable,v_outstanding)
  );
end;
$function$;

revoke all on function public.get_sellertray_commercial_settlement_state(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.get_sellertray_commercial_settlement_state(uuid,uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 5. Reuse the existing Paystack checkout/session pipeline with exact C2 Plan
--    and ProcessEdge payment-method evidence. Legacy checkout rows remain valid.
-- ---------------------------------------------------------------------------

alter table public.billing_checkout_sessions
  alter column plan_code drop not null,
  add column if not exists plan_profile_version_id uuid,
  add column if not exists commercial_payment_method_version_id uuid;

alter table public.billing_checkout_sessions
  add constraint billing_checkout_sessions_plan_profile_version_fkey
    foreign key (plan_profile_version_id)
    references public.sellertray_plan_profile_versions(id) on delete restrict,
  add constraint billing_checkout_sessions_commercial_payment_method_version_fkey
    foreign key (commercial_payment_method_version_id)
    references public.sellertray_commercial_payment_method_versions(id) on delete restrict,
  drop constraint billing_checkout_sessions_commercial_subject_check,
  add constraint billing_checkout_sessions_commercial_subject_check
    check (
      (
        checkout_kind='legacy_subscription'
        and plan_code is not null and plan_profile_version_id is null
        and commercial_payment_method_version_id is null
        and command_id is null and commercial_order_id is null
        and installment_obligation_id is null and installment_schedule_id is null
        and amount is null and currency is null
      )
      or
      (
        checkout_kind='installment'
        and command_id is not null and commercial_order_id is not null
        and installment_obligation_id is not null and installment_schedule_id is not null
        and amount is not null and amount>0 and currency is not null and currency~'^[A-Z]{3}$'
        and (
          (plan_code is not null and plan_profile_version_id is null and commercial_payment_method_version_id is null)
          or
          (plan_code is null and plan_profile_version_id is not null and commercial_payment_method_version_id is not null)
        )
      )
    );

alter table public.sellertray_commercial_installment_payment_confirmations
  add column if not exists commercial_payment_method_version_id uuid;

alter table public.sellertray_commercial_installment_payment_confirmations
  add constraint sellertray_installment_payments_commercial_method_version_fkey
    foreign key (commercial_payment_method_version_id)
    references public.sellertray_commercial_payment_method_versions(id) on delete restrict;

create or replace function public.supersede_sellertray_stale_installment_checkouts(
  p_tenant_id uuid,
  p_commercial_order_id uuid
)
returns integer
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_order public.sellertray_commercial_orders%rowtype;
  v_session public.billing_checkout_sessions%rowtype;
  v_state jsonb;
  v_next_schedule_id uuid;
  v_next_amount numeric(18,2);
  v_outstanding numeric(18,2);
  v_count integer:=0;
begin
  perform public.lock_sellertray_commercial_order(p_tenant_id,p_commercial_order_id);
  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.tenant_id=p_tenant_id and o.id=p_commercial_order_id;

  for v_session in
    select s.* from public.billing_checkout_sessions s
    where s.tenant_id=p_tenant_id
      and s.commercial_order_id=p_commercial_order_id
      and s.checkout_kind='installment'
      and s.status in ('preparing','initialized')
    order by s.created_at,s.id
  loop
    if v_order.order_kind='branch_commercial_v2' then
      v_state:=public.get_sellertray_commercial_obligation_settlement_state(
        p_tenant_id,v_session.installment_obligation_id
      );
    else
      v_state:=public.get_sellertray_commercial_settlement_state(
        p_tenant_id,p_commercial_order_id
      );
    end if;
    v_next_schedule_id:=nullif(v_state->>'nextInstallmentScheduleId','')::uuid;
    v_next_amount:=coalesce((v_state->>'nextPayableAmount')::numeric,0);
    v_outstanding:=coalesce((v_state->>'outstandingAmount')::numeric,0);

    if v_outstanding<0.005 or v_next_schedule_id is null
       or v_session.installment_schedule_id<>v_next_schedule_id
       or abs(coalesce(v_session.amount,0)-v_next_amount)>=0.005 then
      update public.billing_checkout_sessions set status='superseded',updated_at=now()
      where id=v_session.id and status in ('preparing','initialized');
      if found then v_count:=v_count+1; end if;
    end if;
  end loop;
  return v_count;
end;
$function$;

revoke all on function public.supersede_sellertray_stale_installment_checkouts(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.supersede_sellertray_stale_installment_checkouts(uuid,uuid)
  to service_role;

create or replace function public.reserve_sellertray_installment_checkout(
  p_tenant_id uuid,
  p_installment_schedule_id uuid,
  p_command_id uuid,
  p_actor_user_id uuid,
  p_billing_email text
)
returns jsonb
language plpgsql
set search_path=''
as $function$
declare
  v_role text;
  v_email text:=lower(btrim(coalesce(p_billing_email,'')));
  v_schedule public.sellertray_commercial_installment_schedule%rowtype;
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_order public.sellertray_commercial_orders%rowtype;
  v_plan_code text;
  v_plan_profile_version_id uuid;
  v_payment_method_version_id uuid;
  v_state jsonb;
  v_next_schedule_id uuid;
  v_next_amount numeric(18,2);
  v_existing public.billing_checkout_sessions%rowtype;
  v_reference text;
  v_session public.billing_checkout_sessions%rowtype;
  v_order_form_id uuid;
  v_order_form_confirmed boolean:=false;
  v_agreement_processing_exists boolean:=false;
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

  if v_obligation.obligation_scope='branch_subscription' then
    select s.plan_profile_version_id into strict v_plan_profile_version_id
    from public.sellertray_commercial_order_price_snapshots s
    where s.tenant_id=p_tenant_id and s.id=v_obligation.commercial_order_line_id
      and s.line_type='branch_subscription';

    select sel.payment_method_version_id into v_payment_method_version_id
    from public.sellertray_commercial_payment_method_selections sel
    join public.sellertray_commercial_payment_method_versions mv on mv.id=sel.payment_method_version_id
    join public.sellertray_commercial_payment_methods m on m.id=mv.payment_method_id
    where sel.tenant_id=p_tenant_id
      and sel.installment_obligation_id=v_obligation.id
      and m.code='paystack' and m.status='active'
      and mv.method_type='paystack' and mv.confirmation_mode='automatic'
      and mv.effective_from<=now() and (mv.effective_until is null or mv.effective_until>now())
    order by sel.selected_at desc,sel.created_at desc,sel.id desc
    limit 1;
    if v_payment_method_version_id is null then
      raise exception 'Select the available Paystack commercial payment method before starting checkout'
        using errcode='23514';
    end if;
  else
    select s.plan_code into strict v_plan_code
    from public.sellertray_commercial_order_price_snapshots s
    where s.tenant_id=p_tenant_id and s.commercial_order_id=v_order.id
      and s.line_type='subscription';
  end if;

  perform public.lock_sellertray_commercial_order(p_tenant_id,v_order.id);
  perform public.supersede_sellertray_stale_installment_checkouts(p_tenant_id,v_order.id);
  if v_obligation.obligation_scope='branch_subscription' then
    v_state:=public.get_sellertray_commercial_obligation_settlement_state(p_tenant_id,v_obligation.id);
  else
    v_state:=public.get_sellertray_commercial_settlement_state(p_tenant_id,v_order.id);
  end if;
  v_next_schedule_id:=nullif(v_state->>'nextInstallmentScheduleId','')::uuid;
  v_next_amount:=coalesce((v_state->>'nextPayableAmount')::numeric,0);

  if coalesce((v_state->>'outstandingAmount')::numeric,0)<0.005 then
    return jsonb_build_object(
      'status','paid','installmentScheduleId',p_installment_schedule_id,
      'amount',0,'currency',v_obligation.currency,'planCode',v_plan_code,
      'planProfileVersionId',v_plan_profile_version_id,
      'commercialPaymentMethodVersionId',v_payment_method_version_id,
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
      'planProfileVersionId',v_existing.plan_profile_version_id,
      'commercialPaymentMethodVersionId',v_existing.commercial_payment_method_version_id,
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
      'planProfileVersionId',v_existing.plan_profile_version_id,
      'commercialPaymentMethodVersionId',v_existing.commercial_payment_method_version_id,
      'needsProviderInitialization',false
    );
  end if;

  select f.id into v_order_form_id
  from public.sellertray_commercial_order_forms f
  where f.tenant_id=p_tenant_id and f.commercial_order_id=v_order.id
    and not exists(
      select 1 from public.sellertray_commercial_order_forms replacement
      where replacement.tenant_id=f.tenant_id and replacement.supersedes_order_form_id=f.id
    )
  order by f.issued_at desc,f.created_at desc
  limit 1;

  if v_order_form_id is not null then
    select exists(
      select 1 from public.sellertray_order_form_confirmations c
      where c.tenant_id=p_tenant_id and c.order_form_id=v_order_form_id
    ) into v_order_form_confirmed;
    if not v_order_form_confirmed then
      raise exception 'Review and confirm this SellerTray Order Form before payment'
        using errcode='23514';
    end if;
  elsif v_order.order_kind='branch_commercial_v2' then
    raise exception 'SellerTray Order Form must be issued and confirmed before Branch subscription payment'
      using errcode='23514';
  else
    if to_regclass('public.sellertray_agreement_package_processing') is not null then
      execute $sql$
        select exists(
          select 1 from public.sellertray_agreement_package_processing p
          where p.tenant_id=$1
            and (
              p.commercial_order_id=$2
              or p.installment_obligation_id=$3
              or (p.subject_kind='installment_obligation' and p.subject_id=$3)
            )
        )
      $sql$
      into v_agreement_processing_exists
      using p_tenant_id,v_order.id,v_obligation.id;
    end if;
    if v_agreement_processing_exists then
      raise exception 'SellerTray is preparing the Order Form for this purchase. Review and confirm it before payment'
        using errcode='23514';
    end if;
  end if;

  v_reference:='sti-'||substr(replace(p_tenant_id::text,'-',''),1,8)
    ||'-'||replace(p_command_id::text,'-','');

  insert into public.billing_checkout_sessions(
    tenant_id,plan_code,plan_profile_version_id,commercial_payment_method_version_id,
    requested_by_user_id,billing_email,provider,reference,status,checkout_kind,command_id,
    commercial_order_id,installment_obligation_id,installment_schedule_id,amount,currency,
    created_at,updated_at
  ) values(
    p_tenant_id,v_plan_code,v_plan_profile_version_id,v_payment_method_version_id,
    p_actor_user_id,v_email,'paystack',v_reference,'preparing','installment',p_command_id,
    v_order.id,v_obligation.id,v_schedule.id,v_next_amount,v_obligation.currency,now(),now()
  ) returning * into v_session;

  return jsonb_build_object(
    'sessionId',v_session.id,'status',v_session.status,'reference',v_session.reference,
    'authorizationUrl',v_session.authorization_url,
    'installmentScheduleId',v_session.installment_schedule_id,'amount',v_session.amount,
    'currency',v_session.currency,'planCode',v_session.plan_code,
    'planProfileVersionId',v_session.plan_profile_version_id,
    'commercialPaymentMethodVersionId',v_session.commercial_payment_method_version_id,
    'needsProviderInitialization',true
  );
end;
$function$;

revoke all on function public.reserve_sellertray_installment_checkout(uuid,uuid,uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.reserve_sellertray_installment_checkout(uuid,uuid,uuid,uuid,text)
  to service_role;

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
set search_path=''
as $function$
declare
  v_session public.billing_checkout_sessions%rowtype;
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_existing public.sellertray_commercial_installment_payment_confirmations%rowtype;
  v_state jsonb;
  v_next_schedule_id uuid;
  v_next_amount numeric(18,2);
  v_id uuid;
  v_provider_reference text:=btrim(coalesce(p_provider_reference,''));
  v_transaction_ref text:=nullif(btrim(coalesce(p_provider_transaction_ref,'')),'');
  v_currency text:=upper(btrim(coalesce(p_currency,'')));
  v_fingerprint text:=btrim(coalesce(p_provider_event_fingerprint,''));
begin
  if p_checkout_session_id is null or p_amount is null or p_paid_at is null then
    raise exception 'Installment checkout, amount and payment time are required' using errcode='22023';
  end if;

  perform public.lock_sellertray_commercial_order(b.tenant_id,b.commercial_order_id)
  from public.billing_checkout_sessions b where b.id=p_checkout_session_id;
  select s.* into strict v_session
  from public.billing_checkout_sessions s
  where s.id=p_checkout_session_id and s.checkout_kind='installment'
  for update;
  select o.* into strict v_obligation
  from public.sellertray_commercial_installment_obligations o
  where o.tenant_id=v_session.tenant_id and o.id=v_session.installment_obligation_id;

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
       or v_existing.paid_at<>p_paid_at
       or v_existing.commercial_payment_method_version_id is distinct from v_session.commercial_payment_method_version_id then
      raise exception 'Installment payment checkout is already confirmed with different provider facts'
        using errcode='23505';
    end if;
    return v_existing.id;
  end if;

  perform public.supersede_sellertray_stale_installment_checkouts(
    v_session.tenant_id,v_session.commercial_order_id
  );
  select s.* into strict v_session
  from public.billing_checkout_sessions s where s.id=p_checkout_session_id
  for update;

  if v_session.status not in ('preparing','initialized') then
    raise exception 'Installment checkout cannot be confirmed from its current state'
      using errcode='23514';
  end if;
  if v_session.provider_initialization_started_at is null then
    raise exception 'Installment checkout provider initialization was not begun'
      using errcode='23514';
  end if;

  if v_obligation.obligation_scope='branch_subscription' then
    v_state:=public.get_sellertray_commercial_obligation_settlement_state(
      v_session.tenant_id,v_session.installment_obligation_id
    );
  else
    v_state:=public.get_sellertray_commercial_settlement_state(
      v_session.tenant_id,v_session.commercial_order_id
    );
  end if;
  v_next_schedule_id:=nullif(v_state->>'nextInstallmentScheduleId','')::uuid;
  v_next_amount:=coalesce((v_state->>'nextPayableAmount')::numeric,0);
  if v_next_schedule_id is distinct from v_session.installment_schedule_id
     or abs(v_next_amount-v_session.amount)>=0.005 then
    update public.billing_checkout_sessions set status='superseded',updated_at=now()
    where id=v_session.id;
    raise exception 'Installment checkout was superseded by newer commercial settlement facts'
      using errcode='23514';
  end if;

  if exists(
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
    provider_event_fingerprint,amount,currency,paid_at,recorded_at,
    commercial_payment_method_version_id
  ) values(
    v_session.tenant_id,v_session.commercial_order_id,v_session.installment_obligation_id,
    v_session.installment_schedule_id,v_session.id,v_session.provider,v_provider_reference,
    v_transaction_ref,v_fingerprint,p_amount,v_currency,p_paid_at,now(),
    v_session.commercial_payment_method_version_id
  ) returning id into v_id;

  update public.billing_checkout_sessions set status='paid',updated_at=now()
  where id=v_session.id;
  return v_id;
end;
$function$;

revoke all on function public.confirm_sellertray_installment_payment_from_checkout(uuid,text,text,numeric,text,timestamptz,text)
  from public,anon,authenticated;
grant execute on function public.confirm_sellertray_installment_payment_from_checkout(uuid,text,text,numeric,text,timestamptz,text)
  to service_role;

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
as $function$
declare
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_snapshot public.sellertray_installment_contract_snapshots%rowtype;
  v_plan_code text;
  v_plan_profile_version_id uuid;
  v_billing_cycle text;
  v_policy jsonb;
  v_policy_enabled boolean:=false;
  v_policy_template_id uuid;
  v_master jsonb;
  v_order_form_id uuid;
  v_order_form_confirmed boolean:=false;
begin
  select o.* into strict v_obligation
  from public.sellertray_commercial_installment_obligations o
  where o.tenant_id=p_tenant_id and o.id=p_installment_obligation_id;
  select s.* into strict v_snapshot
  from public.sellertray_installment_contract_snapshots s
  where s.tenant_id=p_tenant_id and s.installment_obligation_id=v_obligation.id;

  if v_obligation.obligation_scope='branch_subscription' then
    select s.plan_profile_version_id,s.billing_cycle
      into strict v_plan_profile_version_id,v_billing_cycle
    from public.sellertray_commercial_order_price_snapshots s
    where s.tenant_id=p_tenant_id and s.id=v_obligation.commercial_order_line_id
      and s.line_type='branch_subscription';
    v_policy:=public.resolve_sellertray_installment_policy_v2(
      p_tenant_id,v_obligation.commercial_order_id,v_plan_profile_version_id,v_billing_cycle,p_as_of
    );
  else
    select s.plan_code,s.billing_cycle into strict v_plan_code,v_billing_cycle
    from public.sellertray_commercial_order_price_snapshots s
    where s.tenant_id=p_tenant_id and s.commercial_order_id=v_obligation.commercial_order_id
      and s.line_type='subscription';
    v_policy:=public.resolve_sellertray_installment_policy(
      p_tenant_id,v_obligation.commercial_order_id,v_plan_code,v_billing_cycle,p_as_of
    );
  end if;

  v_policy_enabled:=coalesce((v_policy->>'enabled')::boolean,false);
  v_policy_template_id:=nullif(v_policy->>'defaultTemplateId','')::uuid;
  v_master:=public.get_sellertray_master_agreement_state(p_tenant_id,p_as_of);

  select f.id into v_order_form_id
  from public.sellertray_commercial_order_forms f
  where f.tenant_id=p_tenant_id and f.commercial_order_id=v_obligation.commercial_order_id
    and not exists(
      select 1 from public.sellertray_commercial_order_forms r
      where r.tenant_id=f.tenant_id and r.supersedes_order_form_id=f.id
    )
  order by f.issued_at desc,f.created_at desc limit 1;
  if v_order_form_id is not null then
    select exists(
      select 1 from public.sellertray_order_form_confirmations c
      where c.tenant_id=p_tenant_id and c.order_form_id=v_order_form_id
    ) into v_order_form_confirmed;
  end if;

  return jsonb_build_object(
    'tenantId',p_tenant_id,'commercialOrderId',v_obligation.commercial_order_id,
    'installmentObligationId',v_obligation.id,'planCode',v_plan_code,
    'planProfileVersionId',v_plan_profile_version_id,'billingCycle',v_billing_cycle,
    'agreementAccepted',true,'agreementAcceptedAt',null,
    'masterAgreementPublished',coalesce((v_master->>'published')::boolean,false),
    'masterAgreementAccepted',coalesce((v_master->>'accepted')::boolean,false),
    'masterAgreementAcceptedAt',v_master->'acceptance'->>'acceptedAt',
    'contractTemplateId',v_snapshot.template_id,'contractTemplateCode',v_snapshot.template_code,
    'contractTemplateVersion',v_snapshot.template_version,'currentPolicy',v_policy,
    'draftEligible',case
      when v_obligation.obligation_scope='branch_subscription' and v_snapshot.template_code='full_payment_100' then true
      else v_policy_enabled and v_policy_template_id=v_snapshot.template_id end,
    'orderFormId',v_order_form_id,'orderFormConfirmed',v_order_form_confirmed,
    'checkoutEligible',case
      when v_obligation.obligation_scope='branch_subscription' then v_order_form_confirmed
      else true end
  );
end;
$function$;

revoke all on function public.get_sellertray_installment_contract_checkout_policy(uuid,uuid,timestamptz)
  from public,anon,authenticated;
grant execute on function public.get_sellertray_installment_contract_checkout_policy(uuid,uuid,timestamptz)
  to service_role;

commit;
