begin;

-- OA5C is an acceptance-proof boundary, not a new lifecycle authority.
-- This verifier is intentionally read-only. It composes immutable commercial,
-- agreement, payment, setup/readiness, entitlement, notification and reporting
-- facts so a controlled real merchant run can be audited without inventing
-- payment, readiness or activation evidence.
create or replace function public.platform_admin_verify_oa5c_real_merchant_proof(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_commercial_order_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path=''
as $$
declare
  v_order public.sellertray_commercial_orders%rowtype;
  v_state jsonb;
  v_current_agreement_version_id uuid;
  v_active_branch_count integer := 0;
  v_active_branch_id uuid;
  v_price_line_count integer := 0;
  v_price_missing_source_count integer := 0;
  v_price_mismatch_count integer := 0;
  v_price_total numeric := 0;
  v_setup_scope_count integer := 0;
  v_agreement_acceptance_id uuid;
  v_agreement_acceptance_count integer := 0;
  v_agreement_evidence_ok boolean := false;
  v_gateway_payment_count integer := 0;
  v_direct_payment_count integer := 0;
  v_confirmed_payment_amount numeric := 0;
  v_payment_evidence_ok boolean := false;
  v_adjustment_count integer := 0;
  v_adjustment_evidence_ok boolean := true;
  v_appointment_id uuid;
  v_appointment_status text;
  v_completion_event_id uuid;
  v_completion_command_id uuid;
  v_completion_actor_user_id uuid;
  v_completion_reason text;
  v_completion_evidence jsonb;
  v_readiness_id uuid;
  v_readiness_command_id uuid;
  v_readiness_actor_user_id uuid;
  v_readiness_reason text;
  v_readiness_evidence jsonb;
  v_entitlement_event_id uuid;
  v_entitlement_event_type text;
  v_entitlement_idempotency_key text;
  v_entitlement_reason text;
  v_entitlement_payload jsonb;
  v_entitlement_recorded_at timestamptz;
  v_entitlement_event_count integer := 0;
  v_runtime_can_write boolean := false;
  v_order_notification_ok boolean := false;
  v_agreement_notification_ok boolean := false;
  v_payment_notification_ok boolean := false;
  v_setup_notification_ok boolean := false;
  v_entitlement_notification_ok boolean := false;
  v_admin_report jsonb;
  v_admin_item jsonb;
  v_retry_audit_count integer := 0;
  v_duplicate_payment_identity_count integer := 0;
  v_duplicate_setup_command_count integer := 0;
  v_duplicate_entitlement_key_count integer := 0;
  v_immutable_contracts_ok boolean := false;
  v_idempotency_contracts_ok boolean := false;
  v_order_scope_ok boolean := false;
  v_single_branch_ok boolean := false;
  v_pricing_ok boolean := false;
  v_agreement_ok boolean := false;
  v_genuine_payment_ok boolean := false;
  v_setup_ok boolean := false;
  v_activation_ok boolean := false;
  v_runtime_ok boolean := false;
  v_notifications_ok boolean := false;
  v_admin_reporting_ok boolean := false;
  v_privileged_audit_ok boolean := false;
  v_retry_ok boolean := false;
  v_automated_evidence_passed boolean := false;
begin
  if not exists (
    select 1
    from public.platform_admins pa
    where pa.user_id=p_actor_user_id
      and pa.role in ('admin','support')
  ) then
    raise exception 'Platform administrator access required' using errcode='42501';
  end if;

  select o.* into v_order
  from public.sellertray_commercial_orders o
  where o.id=p_commercial_order_id
    and o.tenant_id=p_tenant_id;

  if not found then
    raise exception 'SellerTray commercial order does not belong to this Business' using errcode='22023';
  end if;

  v_state := public.get_sellertray_onboarding_state_core(p_tenant_id);
  v_current_agreement_version_id := public.resolve_sellertray_master_agreement_version_id(now());

  select count(*)::integer,min(b.id::text)::uuid
    into v_active_branch_count,v_active_branch_id
  from public.branches b
  where b.tenant_id=p_tenant_id
    and b.is_active;

  select
    count(*)::integer,
    count(*) filter (where pv.id is null)::integer,
    count(*) filter (
      where pv.id is null
         or pv.price_kind<>ps.line_type
         or pv.currency<>ps.currency
         or abs(pv.gross_amount-ps.unit_gross_amount)>=0.005
         or abs(ps.gross_amount-(ps.unit_gross_amount*ps.quantity))>=0.005
         or (
           ps.net_amount is not null
           and ps.tax_amount is not null
           and abs(ps.gross_amount-(ps.net_amount+ps.tax_amount))>=0.005
         )
         or (
           ps.line_type='subscription'
           and (
             pv.plan_code is distinct from ps.plan_code
             or pv.billing_cycle is distinct from ps.billing_cycle
           )
         )
    )::integer,
    coalesce(sum(ps.gross_amount),0),
    count(*) filter (where ps.line_type='branch_setup')::integer
    into
      v_price_line_count,
      v_price_missing_source_count,
      v_price_mismatch_count,
      v_price_total,
      v_setup_scope_count
  from public.sellertray_commercial_order_price_snapshots ps
  left join public.sellertray_commercial_price_versions pv
    on pv.id=ps.source_price_version_id
  where ps.tenant_id=p_tenant_id
    and ps.commercial_order_id=p_commercial_order_id;

  select
    min(a.id::text)::uuid,
    count(*)::integer,
    coalesce(bool_and(
      a.accepted_by_user_id is not null
      and a.accepted_role in ('owner','manager')
      and nullif(btrim(a.accepted_legal_name),'') is not null
      and a.request_evidence<>'{}'::jsonb
      and a.command_id is not null
      and a.agreement_version_code=v.version_code
      and a.agreement_content_sha256=v.content_sha256
    ),false)
    into
      v_agreement_acceptance_id,
      v_agreement_acceptance_count,
      v_agreement_evidence_ok
  from public.sellertray_master_agreement_acceptances a
  join public.sellertray_master_agreement_versions v
    on v.id=a.agreement_version_id
  where a.tenant_id=p_tenant_id
    and a.agreement_version_id=v_current_agreement_version_id;

  select
    (select count(*)::integer
     from public.sellertray_commercial_installment_payment_confirmations p
     where p.tenant_id=p_tenant_id and p.commercial_order_id=p_commercial_order_id),
    (select count(*)::integer
     from public.sellertray_commercial_direct_payment_confirmations p
     where p.tenant_id=p_tenant_id and p.commercial_order_id=p_commercial_order_id),
    coalesce((select sum(p.amount)
     from public.sellertray_commercial_installment_payment_confirmations p
     where p.tenant_id=p_tenant_id and p.commercial_order_id=p_commercial_order_id),0)
    + coalesce((select sum(p.amount)
     from public.sellertray_commercial_direct_payment_confirmations p
     where p.tenant_id=p_tenant_id and p.commercial_order_id=p_commercial_order_id),0),
    (
      not exists (
        select 1
        from public.sellertray_commercial_installment_payment_confirmations p
        where p.tenant_id=p_tenant_id
          and p.commercial_order_id=p_commercial_order_id
          and (
            p.amount<=0
            or nullif(btrim(p.provider),'') is null
            or nullif(btrim(p.provider_reference),'') is null
            or nullif(btrim(p.provider_event_fingerprint),'') is null
          )
      )
      and not exists (
        select 1
        from public.sellertray_commercial_direct_payment_confirmations p
        where p.tenant_id=p_tenant_id
          and p.commercial_order_id=p_commercial_order_id
          and (
            p.amount<=0
            or nullif(btrim(p.payment_reference),'') is null
            or nullif(btrim(p.payment_method),'') is null
            or nullif(btrim(p.reason),'') is null
            or p.evidence='{}'::jsonb
            or p.actor_user_id is null
          )
      )
    )
    into
      v_gateway_payment_count,
      v_direct_payment_count,
      v_confirmed_payment_amount,
      v_payment_evidence_ok;

  select
    count(*)::integer,
    coalesce(bool_and(
      a.amount>0
      and nullif(btrim(a.reason),'') is not null
      and a.evidence<>'{}'::jsonb
      and a.actor_user_id is not null
      and a.command_id is not null
    ),true)
    into v_adjustment_count,v_adjustment_evidence_ok
  from public.sellertray_commercial_adjustments a
  where a.tenant_id=p_tenant_id
    and a.commercial_order_id=p_commercial_order_id;

  select a.id,a.status
    into v_appointment_id,v_appointment_status
  from public.sellertray_commercial_setup_appointments a
  where a.tenant_id=p_tenant_id
    and a.commercial_order_id=p_commercial_order_id
    and a.branch_id=v_active_branch_id
  order by a.created_at desc,a.id desc
  limit 1;

  select
    e.id,e.command_id,e.actor_user_id,e.reason,e.details->'evidence'
    into
      v_completion_event_id,
      v_completion_command_id,
      v_completion_actor_user_id,
      v_completion_reason,
      v_completion_evidence
  from public.sellertray_commercial_setup_appointment_events e
  where e.tenant_id=p_tenant_id
    and e.commercial_order_id=p_commercial_order_id
    and e.branch_id=v_active_branch_id
    and e.event_type='completed'
  order by e.occurred_at desc,e.id desc
  limit 1;

  select r.id,r.command_id,r.actor_user_id,r.reason,r.evidence
    into
      v_readiness_id,
      v_readiness_command_id,
      v_readiness_actor_user_id,
      v_readiness_reason,
      v_readiness_evidence
  from public.sellertray_commercial_branch_setup_readiness r
  where r.tenant_id=p_tenant_id
    and r.commercial_order_id=p_commercial_order_id
    and r.branch_id=v_active_branch_id
  limit 1;

  select
    e.id,e.event_type,e.idempotency_key,e.reason,e.payload,e.recorded_at
    into
      v_entitlement_event_id,
      v_entitlement_event_type,
      v_entitlement_idempotency_key,
      v_entitlement_reason,
      v_entitlement_payload,
      v_entitlement_recorded_at
  from public.sellertray_commercial_entitlement_events e
  where e.tenant_id=p_tenant_id
    and e.commercial_order_id=p_commercial_order_id
    and e.event_type in ('installment.provisional_activated','installment.full_entitlement_released')
  order by
    case e.event_type when 'installment.full_entitlement_released' then 0 else 1 end,
    e.recorded_at desc,e.id desc
  limit 1;

  select count(*)::integer into v_entitlement_event_count
  from public.sellertray_commercial_entitlement_events e
  where e.tenant_id=p_tenant_id
    and e.commercial_order_id=p_commercial_order_id
    and e.event_type in ('installment.provisional_activated','installment.full_entitlement_released');

  v_runtime_can_write := public.orderdesk_subscription_can_write(p_tenant_id);

  select exists (
    select 1 from public.merchant_notifications n
    where n.tenant_id=p_tenant_id
      and n.lifecycle_source_id=p_commercial_order_id
  ) into v_order_notification_ok;

  select v_agreement_acceptance_id is not null and exists (
    select 1 from public.merchant_notifications n
    where n.tenant_id=p_tenant_id
      and n.lifecycle_source_id=v_agreement_acceptance_id
  ) into v_agreement_notification_ok;

  select exists (
    select 1
    from public.merchant_notifications n
    where n.tenant_id=p_tenant_id
      and (
        exists (
          select 1
          from public.sellertray_commercial_installment_payment_confirmations p
          where p.tenant_id=p_tenant_id
            and p.commercial_order_id=p_commercial_order_id
            and p.id=n.lifecycle_source_id
        )
        or exists (
          select 1
          from public.sellertray_commercial_direct_payment_confirmations p
          where p.tenant_id=p_tenant_id
            and p.commercial_order_id=p_commercial_order_id
            and p.id=n.lifecycle_source_id
        )
      )
  ) into v_payment_notification_ok;

  select exists (
    select 1 from public.merchant_notifications n
    where n.tenant_id=p_tenant_id
      and n.lifecycle_source_id in (v_completion_event_id,v_readiness_id)
  ) into v_setup_notification_ok;

  select v_entitlement_event_id is not null and exists (
    select 1 from public.merchant_notifications n
    where n.tenant_id=p_tenant_id
      and n.lifecycle_source_id=v_entitlement_event_id
  ) into v_entitlement_notification_ok;

  v_admin_report := public.platform_admin_onboarding_commercial_report(p_actor_user_id,100);
  select item into v_admin_item
  from jsonb_array_elements(coalesce(v_admin_report->'items','[]'::jsonb)) item
  where item->>'tenantId'=p_tenant_id::text
  limit 1;

  select count(*)::integer into v_retry_audit_count
  from public.platform_admin_audit a
  where a.tenant_id=p_tenant_id
    and a.action='setup_activation_reconciliation_retry'
    and a.detail->>'obligationId'=coalesce(v_state->'commercialOrder'->>'installmentObligationId','')
    and coalesce((a.detail->'result'->>'retryRequired')::boolean,false)=false
    and (v_entitlement_recorded_at is null or a.created_at>=v_entitlement_recorded_at);

  select coalesce(sum(d.duplicate_count),0)::integer
    into v_duplicate_payment_identity_count
  from (
    select greatest(count(*)-1,0)::integer as duplicate_count
    from public.sellertray_commercial_direct_payment_confirmations p
    where p.tenant_id=p_tenant_id and p.commercial_order_id=p_commercial_order_id
    group by p.command_id
    having count(*)>1
    union all
    select greatest(count(*)-1,0)::integer
    from public.sellertray_commercial_installment_payment_confirmations p
    where p.tenant_id=p_tenant_id and p.commercial_order_id=p_commercial_order_id
    group by p.provider_reference
    having count(*)>1
    union all
    select greatest(count(*)-1,0)::integer
    from public.sellertray_commercial_installment_payment_confirmations p
    where p.tenant_id=p_tenant_id and p.commercial_order_id=p_commercial_order_id
    group by p.provider_event_fingerprint
    having count(*)>1
  ) d;

  select coalesce(sum(d.duplicate_count),0)::integer
    into v_duplicate_setup_command_count
  from (
    select greatest(count(*)-1,0)::integer as duplicate_count
    from public.sellertray_commercial_setup_appointment_events e
    where e.tenant_id=p_tenant_id and e.commercial_order_id=p_commercial_order_id
    group by e.command_id
    having count(*)>1
    union all
    select greatest(count(*)-1,0)::integer
    from public.sellertray_commercial_branch_setup_readiness r
    where r.tenant_id=p_tenant_id and r.commercial_order_id=p_commercial_order_id
    group by r.command_id
    having count(*)>1
  ) d;

  select coalesce(sum(d.duplicate_count),0)::integer
    into v_duplicate_entitlement_key_count
  from (
    select greatest(count(*)-1,0)::integer as duplicate_count
    from public.sellertray_commercial_entitlement_events e
    where e.tenant_id=p_tenant_id and e.commercial_order_id=p_commercial_order_id
    group by e.idempotency_key
    having count(*)>1
  ) d;

  select count(*)=7 into v_immutable_contracts_ok
  from (
    values
      ('sellertray_commercial_installment_payment_confirmations'::text),
      ('sellertray_commercial_direct_payment_confirmations'),
      ('sellertray_commercial_adjustments'),
      ('sellertray_master_agreement_acceptances'),
      ('sellertray_commercial_setup_appointment_events'),
      ('sellertray_commercial_branch_setup_readiness'),
      ('sellertray_commercial_entitlement_events')
  ) expected(table_name)
  where exists (
    select 1
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid=t.tgrelid
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname=expected.table_name
      and not t.tgisinternal
      and lower(pg_catalog.pg_get_triggerdef(t.oid)) like '%before delete or update%'
  );

  select
    exists (
      select 1 from pg_catalog.pg_constraint con
      where con.conrelid='public.sellertray_commercial_direct_payment_confirmations'::regclass
        and con.contype='u'
        and pg_catalog.pg_get_constraintdef(con.oid) ilike '%command_id%'
    )
    and exists (
      select 1 from pg_catalog.pg_constraint con
      where con.conrelid='public.sellertray_commercial_installment_payment_confirmations'::regclass
        and con.contype='u'
        and pg_catalog.pg_get_constraintdef(con.oid) ilike '%provider_reference%'
    )
    and exists (
      select 1 from pg_catalog.pg_constraint con
      where con.conrelid='public.sellertray_commercial_installment_payment_confirmations'::regclass
        and con.contype='u'
        and pg_catalog.pg_get_constraintdef(con.oid) ilike '%provider_event_fingerprint%'
    )
    and exists (
      select 1 from pg_catalog.pg_constraint con
      where con.conrelid='public.sellertray_commercial_setup_appointment_events'::regclass
        and con.contype='u'
        and pg_catalog.pg_get_constraintdef(con.oid) ilike '%command_id%'
    )
    and exists (
      select 1 from pg_catalog.pg_constraint con
      where con.conrelid='public.sellertray_commercial_branch_setup_readiness'::regclass
        and con.contype='u'
        and pg_catalog.pg_get_constraintdef(con.oid) ilike '%command_id%'
    )
    and exists (
      select 1 from pg_catalog.pg_constraint con
      where con.conrelid='public.sellertray_commercial_entitlement_events'::regclass
        and con.contype='u'
        and pg_catalog.pg_get_constraintdef(con.oid) ilike '%idempotency_key%'
    )
    into v_idempotency_contracts_ok;

  v_order_scope_ok := coalesce((v_state->'commercialOrder'->>'id')::uuid=p_commercial_order_id,false);
  v_single_branch_ok := v_active_branch_count=1;
  v_pricing_ok := v_price_line_count>0
    and v_price_missing_source_count=0
    and v_price_mismatch_count=0
    and abs(v_price_total-v_order.total_gross_amount)<0.005
    and v_setup_scope_count=1
    and exists (
      select 1
      from public.sellertray_commercial_order_price_snapshots ps
      where ps.tenant_id=p_tenant_id
        and ps.commercial_order_id=p_commercial_order_id
        and ps.line_type='branch_setup'
        and ps.branch_id=v_active_branch_id
    );
  v_agreement_ok := v_current_agreement_version_id is not null
    and v_agreement_acceptance_count=1
    and v_agreement_evidence_ok;
  v_genuine_payment_ok := coalesce((v_state->'settlement'->>'qualifyingSettlementSatisfied')::boolean,false)
    and (v_gateway_payment_count+v_direct_payment_count)>0
    and v_confirmed_payment_amount>0
    and v_payment_evidence_ok
    and v_adjustment_evidence_ok;
  v_setup_ok := v_setup_scope_count=1
    and v_appointment_id is not null
    and v_appointment_status='completed'
    and v_completion_event_id is not null
    and v_readiness_id is not null
    and v_completion_command_id=v_readiness_command_id
    and v_completion_actor_user_id=v_readiness_actor_user_id
    and nullif(btrim(coalesce(v_completion_reason,'')),'') is not null
    and nullif(btrim(coalesce(v_readiness_reason,'')),'') is not null
    and coalesce(v_completion_evidence,'{}'::jsonb)<>'{}'::jsonb
    and coalesce(v_readiness_evidence,'{}'::jsonb)<>'{}'::jsonb;
  v_activation_ok := v_entitlement_event_id is not null
    and v_entitlement_event_type in ('installment.provisional_activated','installment.full_entitlement_released')
    and nullif(btrim(coalesce(v_entitlement_idempotency_key,'')),'') is not null
    and nullif(btrim(coalesce(v_entitlement_reason,'')),'') is not null
    and coalesce(v_entitlement_payload,'{}'::jsonb)<>'{}'::jsonb
    and coalesce(v_state->'activation'->>'entitlementState','not_active') in ('provisional','full');
  v_runtime_ok := coalesce(
    v_activation_ok
    and coalesce((v_state->'activation'->>'operationallyActive')::boolean,false)
    and v_runtime_can_write,
    false
  );
  v_notifications_ok := v_order_notification_ok
    and v_agreement_notification_ok
    and v_payment_notification_ok
    and v_setup_notification_ok
    and v_entitlement_notification_ok;
  v_admin_reporting_ok := coalesce(
    v_admin_item is not null
    and v_admin_item->>'currentStage'=v_state->>'currentStage'
    and v_admin_item#>>'{activation,entitlementState}'=v_state#>>'{activation,entitlementState}'
    and coalesce((v_admin_item#>>'{branchSetup,requiredCount}')::integer,-1)=coalesce((v_state#>>'{branchSetup,requiredCount}')::integer,-2)
    and coalesce((v_admin_item#>>'{branchSetup,readyCount}')::integer,-1)=coalesce((v_state#>>'{branchSetup,readyCount}')::integer,-2),
    false
  );
  v_privileged_audit_ok := v_setup_ok
    and exists (
      select 1
      from public.platform_admin_audit a
      where a.tenant_id=p_tenant_id
        and a.actor_user_id=v_completion_actor_user_id
        and a.action='branch_setup_completed'
        and a.detail->>'appointmentId'=v_appointment_id::text
        and a.detail->>'commercialOrderId'=p_commercial_order_id::text
        and a.detail->>'commandId'=v_completion_command_id::text
    );
  v_retry_ok := v_retry_audit_count>0
    and v_duplicate_payment_identity_count=0
    and v_duplicate_setup_command_count=0
    and v_duplicate_entitlement_key_count=0
    and v_idempotency_contracts_ok;

  v_automated_evidence_passed := coalesce(
    v_order_scope_ok
    and v_single_branch_ok
    and v_pricing_ok
    and v_agreement_ok
    and v_genuine_payment_ok
    and v_setup_ok
    and v_activation_ok
    and v_runtime_ok
    and v_notifications_ok
    and v_admin_reporting_ok
    and v_privileged_audit_ok
    and v_retry_ok
    and v_immutable_contracts_ok,
    false
  );

  return jsonb_build_object(
    'proofVersion','oa5c-v1',
    'generatedAt',now(),
    'tenantId',p_tenant_id,
    'commercialOrderId',p_commercial_order_id,
    'automatedEvidencePassed',v_automated_evidence_passed,
    'oa5cAccepted',false,
    'acceptancePolicy',jsonb_build_object(
      'controlledRealMerchantRequired',true,
      'singleBranchDefault',true,
      'syntheticFixturesCannotSatisfyAcceptance',true,
      'manualSurfaceObservationRequired',true,
      'note','This verifier cannot infer whether a Business is a controlled real merchant or observe a human Mobile/Merchant Web session. Final OA5C acceptance remains explicit after automated gates pass and cross-surface observation is recorded outside this read-only function.'
    ),
    'gates',jsonb_build_object(
      'orderScope',jsonb_build_object('pass',v_order_scope_ok),
      'singleActiveBranch',jsonb_build_object('pass',v_single_branch_ok,'activeBranchCount',v_active_branch_count,'branchId',v_active_branch_id),
      'governedPricingAndTax',jsonb_build_object('pass',v_pricing_ok,'lineCount',v_price_line_count,'missingSourceCount',v_price_missing_source_count,'mismatchCount',v_price_mismatch_count,'snapshotGrossAmount',v_price_total,'orderGrossAmount',v_order.total_gross_amount,'setupScopeCount',v_setup_scope_count),
      'currentMasterAgreement',jsonb_build_object('pass',v_agreement_ok,'currentVersionId',v_current_agreement_version_id,'acceptanceCount',v_agreement_acceptance_count,'evidenceValid',v_agreement_evidence_ok),
      'genuineConfirmedSettlement',jsonb_build_object('pass',v_genuine_payment_ok,'qualifyingSettlement',coalesce((v_state->'settlement'->>'qualifyingSettlementSatisfied')::boolean,false),'gatewayPaymentCount',v_gateway_payment_count,'directPaymentCount',v_direct_payment_count,'confirmedPaymentAmount',v_confirmed_payment_amount,'adjustmentCount',v_adjustment_count,'paymentEvidenceValid',v_payment_evidence_ok,'adjustmentEvidenceValid',v_adjustment_evidence_ok),
      'governedSetupAndDerivedReadiness',jsonb_build_object('pass',v_setup_ok,'appointmentId',v_appointment_id,'appointmentStatus',v_appointment_status,'completionEventId',v_completion_event_id,'completionCommandId',v_completion_command_id,'readinessId',v_readiness_id,'readinessCommandId',v_readiness_command_id),
      'entitlementActivation',jsonb_build_object('pass',v_activation_ok,'eventId',v_entitlement_event_id,'eventType',v_entitlement_event_type,'eventCount',v_entitlement_event_count,'idempotencyKey',v_entitlement_idempotency_key,'state',v_state#>>'{activation,entitlementState}'),
      'compatibilityRuntime',jsonb_build_object('pass',v_runtime_ok,'operationallyActive',coalesce((v_state->'activation'->>'operationallyActive')::boolean,false),'legacyCanWrite',v_runtime_can_write),
      'lifecycleNotifications',jsonb_build_object('pass',v_notifications_ok,'order',v_order_notification_ok,'agreement',v_agreement_notification_ok,'payment',v_payment_notification_ok,'setup',v_setup_notification_ok,'entitlement',v_entitlement_notification_ok),
      'adminReportingParity',jsonb_build_object('pass',v_admin_reporting_ok,'sharedStage',v_state->>'currentStage','adminStage',v_admin_item->>'currentStage'),
      'privilegedAuditEvidence',jsonb_build_object('pass',v_privileged_audit_ok,'setupActorUserId',v_completion_actor_user_id,'reasonFromImmutableEvent',v_completion_reason),
      'retryAndIdempotency',jsonb_build_object('pass',v_retry_ok,'successfulActivationRetryAuditCount',v_retry_audit_count,'duplicatePaymentIdentityCount',v_duplicate_payment_identity_count,'duplicateSetupCommandCount',v_duplicate_setup_command_count,'duplicateEntitlementKeyCount',v_duplicate_entitlement_key_count,'schemaContractsPresent',v_idempotency_contracts_ok),
      'immutableEvidenceContracts',jsonb_build_object('pass',v_immutable_contracts_ok)
    ),
    'crossSurface',jsonb_build_object(
      'sharedOnboardingState',v_state,
      'adminReportItem',v_admin_item,
      'merchantWebObservationRequired',true,
      'mobileObservationRequired',true
    ),
    'remainingAcceptanceProof',case
      when v_automated_evidence_passed then jsonb_build_array(
        'Confirm this Business is the designated controlled real merchant, not a synthetic fixture.',
        'Observe the same active outcome in Merchant Web.',
        'Observe the same active outcome in Mobile.',
        'Record the controlled acceptance decision before C2 starts.'
      )
      else jsonb_build_array('Resolve every failed automated gate before performing the controlled cross-surface acceptance run.')
    end
  );
end;
$$;

revoke all on function public.platform_admin_verify_oa5c_real_merchant_proof(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.platform_admin_verify_oa5c_real_merchant_proof(uuid,uuid,uuid)
  to service_role;

comment on function public.platform_admin_verify_oa5c_real_merchant_proof(uuid,uuid,uuid) is
  'OA5C read-only controlled real-merchant proof verifier. It fails closed on synthetic/full-discount-only evidence and never writes lifecycle truth.';

commit;
