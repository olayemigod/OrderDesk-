begin;

-- OA3 uses this named capability, but the grant vocabulary previously omitted
-- it. Permit explicit scoped assignments without changing default Support power.
alter table public.platform_admin_capability_grant_versions drop constraint platform_admin_capability_code_check;
alter table public.platform_admin_capability_grant_versions add constraint platform_admin_capability_code_check
  check (capability_code in ('admin.pricing.manage','admin.payments.reconcile','admin.installments.manage','admin.branch_setup.manage'));

-- OA4 extends immutable appointment evidence and the existing entitlement authority.
-- No new setup/activation status is persisted. Historical readiness is preserved.
create or replace function public.assert_sellertray_setup_completion_evidence(p_evidence jsonb)
returns void language plpgsql immutable set search_path='' as $$
declare v_item jsonb; v_key text;
begin
  if jsonb_typeof(p_evidence) is distinct from 'object' or p_evidence->'schemaVersion' is distinct from '1'::jsonb then
    raise exception 'Structured setup completion evidence version 1 is required' using errcode='22023';
  end if;
  foreach v_key in array array['branchConfigured','merchantWalkthrough'] loop
    if p_evidence->'checklist'->v_key is distinct from 'true'::jsonb then
      raise exception 'Complete every required setup checklist item' using errcode='22023';
    end if;
  end loop;
  foreach v_key in array array['receivedBy','acknowledgement'] loop
    if jsonb_typeof(p_evidence->v_key) is distinct from 'string' or char_length(btrim(p_evidence->>v_key)) not between 2 and 2000 then
      raise exception 'Merchant representative and acknowledgement evidence are required' using errcode='22023';
    end if;
  end loop;
  if jsonb_typeof(p_evidence->'equipment') is distinct from 'array' then
    raise exception 'Bluetooth printer handover evidence is required' using errcode='22023';
  end if;
  if jsonb_array_length(p_evidence->'equipment') not between 1 and 20 or not exists (
    select 1 from jsonb_array_elements(p_evidence->'equipment') e where e->>'kind'='bluetooth_printer'
  ) then raise exception 'Bluetooth printer handover evidence is required' using errcode='22023'; end if;
  for v_item in select value from jsonb_array_elements(p_evidence->'equipment') loop
    if jsonb_typeof(v_item) is distinct from 'object'
       or coalesce(v_item->>'provisioning','') not in ('supplied','configured')
       or v_item->'pairingTestResult' is distinct from '"passed"'::jsonb
       or v_item->'testReceiptPrinted' is distinct from 'true'::jsonb then
      raise exception 'Each supplied/configured device must pass pairing and a test print' using errcode='22023';
    end if;
    foreach v_key in array array['kind','identifier','handoverCondition'] loop
      if jsonb_typeof(v_item->v_key) is distinct from 'string' or char_length(btrim(v_item->>v_key)) not between 2 and 500 then
        raise exception 'Equipment identity and handover condition are required' using errcode='22023';
      end if;
    end loop;
  end loop;
end;
$$;
revoke all on function public.assert_sellertray_setup_completion_evidence(jsonb) from public,anon,authenticated;
grant execute on function public.assert_sellertray_setup_completion_evidence(jsonb) to service_role;

create or replace function public.platform_admin_transition_branch_setup(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_appointment_id uuid,
  p_target_status text,
  p_command_id uuid,
  p_reason text,
  p_evidence jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_appointment public.sellertray_commercial_setup_appointments%rowtype;
  v_existing_event public.sellertray_commercial_setup_appointment_events%rowtype;
  v_target text:=lower(btrim(coalesce(p_target_status,'')));
  v_expected_event_type text:=case when lower(btrim(coalesce(p_target_status,'')))='in_progress' then 'started' else lower(btrim(coalesce(p_target_status,''))) end;
  v_reason text:=btrim(coalesce(p_reason,''));
  v_readiness_id uuid;
  v_obligation_id uuid;
  v_state jsonb;
  v_reconciliation jsonb := null;
begin
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.branch_setup.manage',p_tenant_id,now()) then raise exception 'Branch setup management capability required' using errcode='42501'; end if;
  if p_command_id is null or char_length(v_reason)<6 or jsonb_typeof(coalesce(p_evidence,'{}'::jsonb))<>'object' then raise exception 'Transition command, reason and evidence are required' using errcode='22023'; end if;
  if v_target not in ('in_progress','completed','cancelled','no_show') then raise exception 'Unsupported setup appointment transition' using errcode='22023'; end if;

  -- Serialize command retries, including concurrent requests.
  perform pg_advisory_xact_lock(hashtextextended(p_command_id::text,0));
  select e.* into v_existing_event from public.sellertray_commercial_setup_appointment_events e where e.command_id=p_command_id;
  if found then
    if v_existing_event.tenant_id<>p_tenant_id or v_existing_event.appointment_id<>p_appointment_id or v_existing_event.event_type<>v_expected_event_type
      or v_existing_event.actor_user_id<>p_actor_user_id or v_existing_event.reason<>v_reason
      or v_existing_event.details->'evidence' is distinct from coalesce(p_evidence,'{}'::jsonb) then raise exception 'Setup transition command is already used for different facts' using errcode='23505'; end if;
    select jsonb_build_object('appointmentId',a.id,'status',a.status,'readinessId',r.id)
      into v_state
    from public.sellertray_commercial_setup_appointments a
    left join public.sellertray_commercial_branch_setup_readiness r on r.tenant_id=a.tenant_id and r.commercial_order_id=a.commercial_order_id and r.branch_id=a.branch_id
    where a.id=p_appointment_id;
    return v_state;
  end if;

  -- Same order lock as settlement/reconciliation, before appointment row locks.
  perform public.lock_sellertray_commercial_order(a.tenant_id,a.commercial_order_id)
  from public.sellertray_commercial_setup_appointments a where a.id=p_appointment_id and a.tenant_id=p_tenant_id;
  select a.* into strict v_appointment from public.sellertray_commercial_setup_appointments a where a.id=p_appointment_id and a.tenant_id=p_tenant_id for update;
  if v_target='in_progress' and v_appointment.status<>'scheduled' then raise exception 'Only a scheduled setup can start' using errcode='23514'; end if;
  if v_target in ('completed','no_show') and v_appointment.status not in ('scheduled','in_progress') then raise exception 'Only an active setup appointment can finish' using errcode='23514'; end if;
  if v_target='cancelled' and v_appointment.status<>'scheduled' then raise exception 'Only a scheduled setup appointment can be cancelled' using errcode='23514'; end if;

  if v_target='completed' then
    perform public.assert_sellertray_setup_completion_evidence(p_evidence);
  end if;

  update public.sellertray_commercial_setup_appointments
  set status=v_target,updated_at=now(),completed_at=case when v_target='completed' then now() else completed_at end,cancelled_at=case when v_target='cancelled' then now() else cancelled_at end
  where id=p_appointment_id;

  insert into public.sellertray_commercial_setup_appointment_events(
    appointment_id,tenant_id,commercial_order_id,branch_id,command_id,event_type,actor_user_id,actor_kind,reason,details
  ) values (
    p_appointment_id,p_tenant_id,v_appointment.commercial_order_id,v_appointment.branch_id,p_command_id,
    v_expected_event_type,p_actor_user_id,'platform',v_reason,
    jsonb_build_object('fromStatus',v_appointment.status,'toStatus',v_target,'evidence',coalesce(p_evidence,'{}'::jsonb),'workerId',v_appointment.worker_id,'completedAt',case when v_target='completed' then now() else null end,'actorUserId',p_actor_user_id)
  );

  if v_target='completed' then
    v_readiness_id:=public.mark_sellertray_commercial_branch_setup_ready(
      p_tenant_id,v_appointment.commercial_order_id,v_appointment.branch_id,p_command_id,
      coalesce(p_evidence,'{}'::jsonb)||jsonb_build_object('source','oa3_setup_appointment','appointmentId',p_appointment_id),
      v_reason,now(),p_actor_user_id
    );
    select io.id into v_obligation_id from public.sellertray_commercial_installment_obligations io
    where io.tenant_id=p_tenant_id and io.commercial_order_id=v_appointment.commercial_order_id order by io.created_at,io.id limit 1;
    if v_obligation_id is not null then
      -- A failed entitlement attempt must not erase valid completion/readiness.
      begin
        v_reconciliation:=public.reconcile_sellertray_installment_entitlement(p_tenant_id,v_obligation_id);
      exception when others then
        v_reconciliation:=jsonb_build_object('retryRequired',true);
        insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
        values(p_actor_user_id,p_tenant_id,'setup_activation_reconciliation_failed',jsonb_build_object('appointmentId',p_appointment_id,'obligationId',v_obligation_id,'sqlstate',sqlstate));
      end;
    end if;
  end if;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(p_actor_user_id,p_tenant_id,'branch_setup_'||v_target,jsonb_build_object('appointmentId',p_appointment_id,'commercialOrderId',v_appointment.commercial_order_id,'branchId',v_appointment.branch_id,'commandId',p_command_id));

  return jsonb_build_object('appointmentId',p_appointment_id,'status',v_target,'readinessId',v_readiness_id,'reconciliation',v_reconciliation);
end;
$$;

create or replace function public.mark_sellertray_commercial_branch_setup_ready(
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_branch_id uuid,
  p_command_id uuid,
  p_evidence jsonb,
  p_reason text,
  p_ready_at timestamptz,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_evidence jsonb := coalesce(p_evidence,'{}'::jsonb);
  v_reason text := btrim(coalesce(p_reason,''));
  v_existing public.sellertray_commercial_branch_setup_readiness%rowtype;
  v_id uuid;
  v_database_owner_session boolean := session_user in ('postgres','supabase_admin');
begin
  if p_tenant_id is null or p_commercial_order_id is null or p_branch_id is null
     or p_command_id is null or p_ready_at is null or p_actor_user_id is null then
    raise exception 'Business, commercial order, Branch, command, setup time and actor are required' using errcode='22023';
  end if;
  if jsonb_typeof(v_evidence)<>'object' then
    raise exception 'Setup readiness evidence must be an object' using errcode='22023';
  end if;
  if char_length(v_reason) not between 1 and 1000 then
    raise exception 'Setup readiness reason is required' using errcode='22023';
  end if;
  if p_ready_at>now()+interval '5 minutes' then
    raise exception 'Setup readiness time cannot be in the future' using errcode='22023';
  end if;
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.branch_setup.manage',p_tenant_id,now()) then
    raise exception 'Branch setup management capability required' using errcode='42501';
  end if;

  perform public.assert_sellertray_setup_subject(p_tenant_id,p_commercial_order_id,p_branch_id);

  -- Preserve idempotent replay of readiness facts that already existed before
  -- OA3. Only creation of a new readiness fact requires appointment completion.
  select r.* into v_existing
  from public.sellertray_commercial_branch_setup_readiness r
  where r.tenant_id=p_tenant_id and r.command_id=p_command_id;

  if not found then
    select r.* into v_existing
    from public.sellertray_commercial_branch_setup_readiness r
    where r.tenant_id=p_tenant_id
      and r.commercial_order_id=p_commercial_order_id
      and r.branch_id=p_branch_id;
  end if;

  if found then
    if v_existing.commercial_order_id<>p_commercial_order_id
       or v_existing.branch_id<>p_branch_id
       or v_existing.evidence is distinct from v_evidence
       or v_existing.actor_user_id<>p_actor_user_id
       or v_existing.reason<>v_reason
       or v_existing.ready_at<>p_ready_at then
      raise exception 'SellerTray setup readiness is already recorded with different facts' using errcode='23505';
    end if;
    return v_existing.id;
  end if;

  if not v_database_owner_session then
    perform public.assert_sellertray_setup_completion_evidence(v_evidence);
  end if;
  if not v_database_owner_session and not exists (
    select 1
    from public.sellertray_commercial_setup_appointment_events e
    join public.sellertray_commercial_setup_appointments a
      on a.id=e.appointment_id
     and a.tenant_id=e.tenant_id
     and a.commercial_order_id=e.commercial_order_id
     and a.branch_id=e.branch_id
    where e.tenant_id=p_tenant_id
      and e.commercial_order_id=p_commercial_order_id
      and e.branch_id=p_branch_id
      and e.command_id=p_command_id
      and e.event_type='completed'
      and e.actor_user_id=p_actor_user_id
      and a.status='completed'
      and v_evidence = (e.details->'evidence') || jsonb_build_object('source','oa3_setup_appointment','appointmentId',a.id)
      and p_ready_at=a.completed_at
  ) then
    raise exception 'Branch setup readiness must come from a completed governed setup appointment' using errcode='23514';
  end if;

  insert into public.sellertray_commercial_branch_setup_readiness(
    tenant_id,commercial_order_id,branch_id,command_id,evidence,
    actor_user_id,reason,ready_at,recorded_at
  ) values (
    p_tenant_id,p_commercial_order_id,p_branch_id,p_command_id,v_evidence,
    p_actor_user_id,v_reason,p_ready_at,now()
  )
  on conflict do nothing
  returning id into v_id;

  if v_id is not null then return v_id; end if;

  select r.* into v_existing
  from public.sellertray_commercial_branch_setup_readiness r
  where r.tenant_id=p_tenant_id and r.command_id=p_command_id;

  if not found then
    select r.* into strict v_existing
    from public.sellertray_commercial_branch_setup_readiness r
    where r.tenant_id=p_tenant_id and r.commercial_order_id=p_commercial_order_id and r.branch_id=p_branch_id;
  end if;

  if v_existing.commercial_order_id<>p_commercial_order_id
     or v_existing.branch_id<>p_branch_id
     or v_existing.evidence is distinct from v_evidence
     or v_existing.actor_user_id<>p_actor_user_id
     or v_existing.reason<>v_reason
     or v_existing.ready_at<>p_ready_at then
    raise exception 'SellerTray setup readiness is already recorded with different facts' using errcode='23505';
  end if;
  return v_existing.id;
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
            'readyAt',r.ready_at,
            'setupStatus',case when r.id is not null then 'Setup complete' when ap.status='completed' then 'Completion needs review' when ap.status='in_progress' then 'Setup in progress' when ap.status='scheduled' then 'Setup scheduled' when ap.status='no_show' then 'Setup missed' when ap.status='cancelled' then 'Setup cancelled' else 'Setup not scheduled' end,
            'scheduledStartAt',ap.scheduled_start_at
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
    left join lateral (
      select a.status,a.scheduled_start_at from public.sellertray_commercial_setup_appointments a
      where a.tenant_id=ps.tenant_id and a.commercial_order_id=ps.commercial_order_id and a.branch_id=ps.branch_id
      order by a.created_at desc,a.id desc limit 1
    ) ap on true
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

  -- Report every blocking Branch even when agreement/payment is also pending.
  if v_entitlement_state='not_active' and v_setup_required_count>v_setup_ready_count then
    v_blockers := coalesce((select jsonb_agg(b) from jsonb_array_elements(v_blockers) b where b->>'code'<>'branch_setup_incomplete'),'[]'::jsonb)
      || coalesce((select jsonb_agg(jsonb_build_object('code','branch_setup_incomplete','branchId',b->>'branchId','message',(b->>'branchName') || ' — ' || (b->>'setupStatus') || '. Activation is waiting for this Branch.','surface','admin_web')) from jsonb_array_elements(v_setup_branches) b where not (b->>'ready')::boolean),'[]'::jsonb);
  end if;
  return jsonb_build_object(
    'readModelVersion','oa4-v1',
    'generatedAt',now(),
    'tenantId',p_tenant_id,
    'currentStage',v_current_stage,
    'blockers',v_blockers,
    'nextAction',v_next_action,
    'accessEnforcement','governed_runtime',
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
      'effectiveFrom',v_entitlement_effective_from,'guaranteeStart',v_entitlement_effective_from,'guaranteeEnd',v_entitlement_effective_from+interval '1 month',
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

create or replace function public.platform_admin_setup_scheduling_center(
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
  v_result jsonb;
begin
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.branch_setup.manage',p_tenant_id,now()) then
    raise exception 'Branch setup management capability required' using errcode='42501';
  end if;

  select jsonb_build_object(
    'canManage',true,
    'canManagePlatformMasters',public.platform_admin_has_capability(
      p_actor_user_id,'admin.branch_setup.manage',null,now()
    ),
    'serviceAreas',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',a.id,'code',a.code,'name',a.name,'active',a.active
      ) order by a.name)
      from public.sellertray_setup_service_areas a
    ),'[]'::jsonb),
    'workers',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',w.id,
        'code',w.worker_code,
        'name',w.display_name,
        'active',w.active,
        'maxConcurrentSetups',w.max_concurrent_setups,
        'travelBufferMinutes',w.travel_buffer_minutes,
        'serviceAreaIds',coalesce((
          select jsonb_agg(c.service_area_id order by c.service_area_id)
          from public.sellertray_setup_worker_service_areas c
          where c.worker_id=w.id
        ),'[]'::jsonb)
      ) order by w.display_name)
      from public.sellertray_setup_workers w
    ),'[]'::jsonb),
    'branchAreas',coalesce((
      select jsonb_agg(jsonb_build_object(
        'branchId',b.id,
        'branchCode',b.code,
        'branchName',b.name,
        'serviceAreaId',ba.service_area_id
      ) order by b.name)
      from public.branches b
      left join public.sellertray_setup_branch_service_areas ba
        on ba.tenant_id=b.tenant_id and ba.branch_id=b.id
      where b.tenant_id=p_tenant_id and b.is_active
    ),'[]'::jsonb),
    'appointments',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',a.id,
        'commercialOrderId',a.commercial_order_id,
        'branchId',a.branch_id,
        'branchName',b.name,
        'workerId',a.worker_id,
        'workerName',w.display_name,
        'serviceAreaId',a.service_area_id,
        'serviceAreaName',sa.name,
        'scheduledStartAt',a.scheduled_start_at,
        'scheduledEndAt',a.scheduled_end_at,
        'status',a.status,
        'merchantNote',a.merchant_note,
        'internalNote',a.internal_note,
        'createdAt',a.created_at,
        'completedAt',a.completed_at
      ) order by a.scheduled_start_at desc)
      from public.sellertray_commercial_setup_appointments a
      join public.branches b on b.id=a.branch_id
      join public.sellertray_setup_workers w on w.id=a.worker_id
      join public.sellertray_setup_service_areas sa on sa.id=a.service_area_id
      where a.tenant_id=p_tenant_id
    ),'[]'::jsonb),
    'pendingRequests',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',r.id,
        'appointmentId',r.appointment_id,
        'branchId',r.branch_id,
        'requestedStartAt',r.requested_start_at,
        'requestedEndAt',r.requested_end_at,
        'merchantNote',r.merchant_note,
        'requestedAt',r.requested_at,
        'requestedByUserId',r.requested_by_user_id
      ) order by r.requested_at)
      from public.sellertray_setup_reschedule_requests r
      where r.tenant_id=p_tenant_id and r.status='pending'
    ),'[]'::jsonb),
    'onboarding',public.get_sellertray_onboarding_state_core(p_tenant_id),
    'setupSubjects',coalesce((
      select jsonb_agg(jsonb_build_object(
        'commercialOrderId',s.commercial_order_id,
        'branchId',s.branch_id,
        'branchCode',b.code,
        'branchName',b.name,
        'ready',rr.id is not null,
        'readyAt',rr.ready_at,'completionEvidence',rr.evidence,
        'serviceAreaId',ba.service_area_id
      ) order by s.line_no)
      from public.sellertray_commercial_order_price_snapshots s
      join public.branches b on b.id=s.branch_id and b.tenant_id=s.tenant_id
      left join public.sellertray_commercial_branch_setup_readiness rr
        on rr.tenant_id=s.tenant_id
       and rr.commercial_order_id=s.commercial_order_id
       and rr.branch_id=s.branch_id
      left join public.sellertray_setup_branch_service_areas ba
        on ba.tenant_id=s.tenant_id and ba.branch_id=s.branch_id
      where s.tenant_id=p_tenant_id and s.line_type='branch_setup'
    ),'[]'::jsonb),
    'generatedAt',now()
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.ensure_orderdesk_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trial_days integer := 14;
begin
  select coalesce(p.trial_days, 14)
  into v_trial_days
  from public.subscription_plans p
  where p.code = 'business';

  insert into public.tenant_subscriptions (
    tenant_id,
    plan_code,
    status,
    trial_started_at,
    trial_ends_at
  ) values (
    new.id,
    'business',
    'trial',
    now(),
    now()
  )
  on conflict (tenant_id) do nothing;

  return new;
end;
$$;

create or replace function public.sellertray_has_governed_subscription_purchase(p_tenant_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
begin
  if coalesce(auth.role(),'')<>'service_role' and not exists (
    select 1 from public.tenant_members tm where tm.tenant_id=p_tenant_id and tm.user_id=auth.uid()
  ) and session_user not in ('postgres','supabase_admin') then return false; end if;
  return exists(select 1 from public.sellertray_commercial_order_price_snapshots ps where ps.tenant_id=p_tenant_id and ps.line_type='subscription');
end;
$$;
revoke all on function public.sellertray_has_governed_subscription_purchase(uuid) from public,anon;
grant execute on function public.sellertray_has_governed_subscription_purchase(uuid) to authenticated,service_role;
create or replace function public.orderdesk_subscription_can_write(p_tenant_id uuid)
returns boolean
language sql
stable
set search_path=''
as $$
  select coalesce(
    (
      select case
        when public.sellertray_c1b_runtime_period_state(s.tenant_id) in (
          'provisional_expired','full_term_expired'
        ) then false
        when s.status = 'active' then true
        when s.status = 'trial' and public.sellertray_has_governed_subscription_purchase(s.tenant_id) then false
        when s.status = 'trial' then s.trial_ends_at is null or s.trial_ends_at > now()
        when s.status = 'grace' then s.grace_ends_at is null or s.grace_ends_at > now()
        else false
      end
      from public.tenant_subscriptions s
      where s.tenant_id = p_tenant_id
    ),
    false
  );
$$;

create or replace function public.get_orderdesk_subscription_access(p_tenant_id uuid)
returns jsonb
language sql
stable
set search_path=''
as $$
  select jsonb_build_object(
    'planCode', s.plan_code,
    'planName', p.name,
    'baseStatus', s.status,
    'effectiveStatus', case
      when s.status='trial' and not public.orderdesk_subscription_can_write(s.tenant_id) then 'pending_setup'
      when public.sellertray_c1b_runtime_period_state(s.tenant_id)='provisional_expired' then 'past_due'
      when public.sellertray_c1b_runtime_period_state(s.tenant_id)='full_term_expired' then 'past_due'
      when s.status = 'trial' and s.trial_ends_at is not null and s.trial_ends_at <= now() then 'trial_expired'
      when s.status = 'grace' and s.grace_ends_at is not null and s.grace_ends_at <= now() then 'grace_expired'
      else s.status
    end,
    'accessMode', case
      when not public.orderdesk_subscription_can_write(s.tenant_id) then 'read_only'
      when public.sellertray_c1b_runtime_period_state(s.tenant_id) in (
        'provisional_expired','full_term_expired'
      ) then 'read_only'
      when s.status = 'active' then 'full'
      when s.status = 'trial' and (s.trial_ends_at is null or s.trial_ends_at > now()) then 'full'
      when s.status = 'grace' and (s.grace_ends_at is null or s.grace_ends_at > now()) then 'full'
      else 'read_only'
    end,
     'offlineWriteAllowedUntil',case
      when s.status='trial' then s.trial_ends_at
      when s.status='grace' then s.grace_ends_at
      when public.sellertray_c1b_runtime_period_state(s.tenant_id)<>'legacy' then s.current_period_end
      else null end,
    'commercialEntitlementState', public.sellertray_c1b_runtime_period_state(s.tenant_id),
    'trialStartedAt', s.trial_started_at,
    'trialEndsAt', s.trial_ends_at,
    'currentPeriodStart', s.current_period_start,
    'currentPeriodEnd', s.current_period_end,
    'graceEndsAt', s.grace_ends_at,
    'cancelAtPeriodEnd', s.cancel_at_period_end,
    'currency', p.currency,
    'priceAmount', p.price_amount,
    'billingInterval', p.billing_interval,
    'checkoutReady', (
      p.is_active = true
      and p.provider = 'paystack'
      and p.provider_plan_ref is not null
      and p.price_amount is not null
      and p.price_amount > 0
    ),
    'usageEventCode', p.usage_event_code,
    'usageUnitPrice', p.usage_unit_price,
    'usagePricingActive', (p.usage_unit_price is not null and p.usage_unit_price > 0),
    'usageBillableNow', (
      public.orderdesk_subscription_can_write(s.tenant_id)
      and s.status in ('active', 'grace')
      and p.usage_unit_price is not null
      and p.usage_unit_price > 0
    ),
    'usageUnitsThisPeriod', coalesce((
      select sum(u.quantity)
      from public.usage_events u
      where u.tenant_id = s.tenant_id
        and u.event_code = p.usage_event_code
        and u.occurred_at >= coalesce(s.current_period_start, s.trial_started_at, date_trunc('month', now()))
        and u.occurred_at < coalesce(s.current_period_end, s.trial_ends_at, date_trunc('month', now()) + interval '1 month')
    ), 0),
    'usageAmountThisPeriod', coalesce((
      select sum(u.amount)
      from public.usage_events u
      where u.tenant_id = s.tenant_id
        and u.event_code = p.usage_event_code
        and u.occurred_at >= coalesce(s.current_period_start, s.trial_started_at, date_trunc('month', now()))
        and u.occurred_at < coalesce(s.current_period_end, s.trial_ends_at, date_trunc('month', now()) + interval '1 month')
    ), 0)
  )
  from public.tenant_subscriptions s
  join public.subscription_plans p on p.code = s.plan_code
  where s.tenant_id = p_tenant_id;
$$;

-- Preparation is a bounded exception for profile/Branch setup only. It is
-- not an operational write entitlement and cannot revive a previously activated Business.
create or replace function public.sellertray_business_is_preparing(p_tenant_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.tenant_subscriptions s where s.tenant_id=p_tenant_id and s.status='trial' and s.current_period_start is null and s.current_period_end is null)
    and not exists(select 1 from public.sellertray_commercial_entitlement_events e where e.tenant_id=p_tenant_id and e.event_type in ('installment.provisional_activated','installment.full_entitlement_released'));
$$;
revoke all on function public.sellertray_business_is_preparing(uuid) from public,anon,authenticated;
grant execute on function public.sellertray_business_is_preparing(uuid) to service_role;
create or replace function public.save_sellertray_branch(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_code text,
  p_name text,
  p_is_default boolean,
  p_is_active boolean
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_branch_id uuid := p_branch_id;
  v_code text := upper(nullif(btrim(coalesce(p_code,'')),''));
  v_name text := nullif(btrim(coalesce(p_name,'')),'');
  v_existing public.branches%rowtype;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=p_tenant_id
      and tm.user_id=v_user_id
      and tm.role in ('owner','manager')
  ) then
    raise exception 'Only business Owners and Managers can manage Branches' using errcode='42501';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) and not public.sellertray_business_is_preparing(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;
  if v_code is null or v_name is null then
    raise exception 'Branch code and name are required' using errcode='22023';
  end if;
  if char_length(v_code)>40 or char_length(v_name)>120 then
    raise exception 'Branch code or name is too long' using errcode='22023';
  end if;
  if coalesce(p_is_default,false) and not coalesce(p_is_active,true) then
    raise exception 'The default Branch must remain active' using errcode='23514';
  end if;

  if v_branch_id is not null then
    select * into v_existing
    from public.branches b
    where b.tenant_id=p_tenant_id and b.id=v_branch_id
    for update;
    if not found then raise exception 'Branch not found' using errcode='22023'; end if;
    if v_existing.is_default and not coalesce(p_is_default,false) then
      raise exception 'Choose another default Branch before clearing this one' using errcode='23514';
    end if;
    if v_existing.is_default and not coalesce(p_is_active,true) then
      raise exception 'Choose another default Branch before archiving this one' using errcode='23514';
    end if;
  end if;

  if coalesce(p_is_default,false) then
    update public.branches b
    set is_default=false,updated_at=now()
    where b.tenant_id=p_tenant_id
      and (v_branch_id is null or b.id<>v_branch_id)
      and b.is_default=true;
  end if;

  if v_branch_id is null then
    insert into public.branches(tenant_id,code,name,is_default,is_active)
    values(p_tenant_id,v_code,v_name,coalesce(p_is_default,false),coalesce(p_is_active,true))
    returning id into v_branch_id;
  else
    update public.branches b
    set code=v_code,
        name=v_name,
        is_default=coalesce(p_is_default,false),
        is_active=coalesce(p_is_active,true),
        updated_at=now()
    where b.tenant_id=p_tenant_id and b.id=v_branch_id;
  end if;

  return v_branch_id;
end;
$$;



create or replace function public.save_sellertray_business_profile(
  p_tenant_id uuid,
  p_name text,
  p_business_email text default null,
  p_business_phone text default null,
  p_business_type text default null,
  p_logo_url text default null,
  p_currency text default 'NGN',
  p_timezone text default 'Africa/Lagos'
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_name text := nullif(btrim(coalesce(p_name,'')),'');
  v_email text := nullif(lower(btrim(coalesce(p_business_email,''))),'');
  v_phone text := nullif(btrim(coalesce(p_business_phone,'')),'');
  v_type text := nullif(btrim(coalesce(p_business_type,'')),'');
  v_logo text := nullif(btrim(coalesce(p_logo_url,'')),'');
  v_currency text := upper(nullif(btrim(coalesce(p_currency,'')),''));
  v_timezone text := nullif(btrim(coalesce(p_timezone,'')),'');
  v_issuer text;
  v_logo_prefix text;
  v_logo_object_name text;
  v_row public.tenants%rowtype;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;

  if not exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id=p_tenant_id
      and tm.user_id=v_user_id
      and tm.role in ('owner','manager')
  ) then
    raise exception 'Only business Owners and Managers can update business settings' using errcode='42501';
  end if;

  if not public.orderdesk_subscription_can_write(p_tenant_id) and not public.sellertray_business_is_preparing(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  if v_name is null then
    raise exception 'Business name is required' using errcode='22023';
  end if;
  if char_length(v_name)>160 then
    raise exception 'Business name is too long' using errcode='22023';
  end if;
  if v_email is not null and (char_length(v_email)>320 or position('@' in v_email)<=1) then
    raise exception 'Business email is invalid' using errcode='22023';
  end if;
  if v_phone is not null and char_length(v_phone)>60 then
    raise exception 'Business phone is too long' using errcode='22023';
  end if;
  if v_type is not null and char_length(v_type)>120 then
    raise exception 'Business type is too long' using errcode='22023';
  end if;

  if v_logo is not null then
    v_issuer := nullif(auth.jwt()->>'iss','');
    if v_issuer is null or v_issuer !~* '^https://' then
      raise exception 'SellerTray could not verify the logo storage origin' using errcode='22023';
    end if;

    v_logo_prefix := regexp_replace(v_issuer, '/auth/v1/?$', '')
      || '/storage/v1/object/public/business-logos/';

    if v_logo not like v_logo_prefix || p_tenant_id::text || '/%' then
      raise exception 'Business logo must use the governed SellerTray logo store' using errcode='22023';
    end if;

    v_logo_object_name := substring(v_logo from char_length(v_logo_prefix) + 1);
    if v_logo_object_name is null
      or position('?' in v_logo_object_name) > 0
      or position('#' in v_logo_object_name) > 0
      or split_part(v_logo_object_name, '/', 1) <> p_tenant_id::text
      or v_logo_object_name !~* ('^' || p_tenant_id::text || '/business-logo-[A-Za-z0-9-]+\.(png|jpg|jpeg|webp)$')
      or not exists (
        select 1
        from storage.objects so
        where so.bucket_id='business-logos'
          and so.name=v_logo_object_name
      )
    then
      raise exception 'Business logo is not a valid SellerTray-managed image' using errcode='22023';
    end if;
  end if;

  if v_currency is null or v_currency !~ '^[A-Z]{3}$' then
    raise exception 'Currency must be a 3-letter code' using errcode='22023';
  end if;
  if v_timezone is null or not exists (
    select 1 from pg_catalog.pg_timezone_names tz where tz.name=v_timezone
  ) then
    raise exception 'Timezone is invalid' using errcode='22023';
  end if;

  update public.tenants t
  set name=v_name,
      business_email=v_email,
      business_phone=v_phone,
      business_type=v_type,
      logo_url=v_logo,
      currency=v_currency,
      timezone=v_timezone,
      updated_at=now()
  where t.id=p_tenant_id
  returning t.* into v_row;

  if not found then
    raise exception 'Business not found' using errcode='P0002';
  end if;

  return jsonb_build_object(
    'name',v_row.name,
    'merchantCode',v_row.merchant_code,
    'businessEmail',v_row.business_email,
    'businessPhone',v_row.business_phone,
    'businessType',v_row.business_type,
    'logoUrl',v_row.logo_url,
    'currency',upper(v_row.currency),
    'timezone',coalesce(nullif(v_row.timezone,''),'Africa/Lagos'),
    'subscriptionStatus',v_row.subscription_status,
    'whatsappConnectionStatus',v_row.whatsapp_connection_status
  );
end;
$function$;

create or replace function public.platform_admin_retry_setup_activation(
  p_actor_user_id uuid,p_tenant_id uuid,p_installment_obligation_id uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.branch_setup.manage',p_tenant_id,now()) then
    raise exception 'Branch setup management capability required' using errcode='42501';
  end if;
  if p_tenant_id is null or p_installment_obligation_id is null or char_length(btrim(coalesce(p_reason,''))) not between 6 and 1000 then
    raise exception 'Business, obligation and recovery reason are required' using errcode='22023';
  end if;
  -- Existing entitlement authority revalidates all prerequisites and runtime ownership.
  begin
    v_result:=public.reconcile_sellertray_installment_entitlement(p_tenant_id,p_installment_obligation_id);
  exception when others then
    v_result:=jsonb_build_object('retryRequired',true);
  end;
  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(p_actor_user_id,p_tenant_id,'setup_activation_reconciliation_retry',jsonb_build_object('obligationId',p_installment_obligation_id,'reason',btrim(p_reason),'result',v_result));
  return v_result;
end;
$$;
revoke all on function public.platform_admin_retry_setup_activation(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.platform_admin_retry_setup_activation(uuid,uuid,uuid,text) to service_role;

commit;
