begin;

-- OA5B — server-owned onboarding/commercial reporting.
--
-- This is a read-only observability layer over the existing governed authorities.
-- It does not create a second lifecycle state machine and it does not move the
-- pre-C2 Business-scoped compatibility runtime to Branch ownership.
create or replace function public.platform_admin_onboarding_commercial_report(
  p_actor_user_id uuid,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security invoker
set search_path=''
as $$
declare
  v_now timestamptz := now();
  v_result jsonb;
begin
  if not exists (
    select 1
    from public.platform_admins pa
    where pa.user_id=p_actor_user_id
      and pa.role in ('admin','support')
  ) then
    raise exception 'Platform administrator access required' using errcode='42501';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'Onboarding report limit must be between 1 and 100' using errcode='22023';
  end if;

  with states as materialized (
    select
      t.id as tenant_id,
      t.name as business_name,
      t.merchant_code,
      t.created_at as business_created_at,
      public.get_sellertray_onboarding_state_core(t.id) as state
    from public.tenants t
  ),
  enriched as materialized (
    select
      s.*,
      coalesce(s.state->>'currentStage','business_setup') as current_stage,
      (s.state->'commercialOrder'->>'id')::uuid as commercial_order_id,
      (s.state->'commercialOrder'->>'orderedAt')::timestamptz as commercial_order_at,
      (s.state->'agreement'->>'acceptedAt')::timestamptz as agreement_accepted_at,
      coalesce(
        (s.state->'settlement'->>'firstPaidAt')::timestamptz,
        (
          select max(f.event_at)
          from (
            select pc.paid_at as event_at
            from public.sellertray_commercial_installment_payment_confirmations pc
            where pc.tenant_id=s.tenant_id
              and pc.commercial_order_id=(s.state->'commercialOrder'->>'id')::uuid
            union all
            select dp.paid_at
            from public.sellertray_commercial_direct_payment_confirmations dp
            where dp.tenant_id=s.tenant_id
              and dp.commercial_order_id=(s.state->'commercialOrder'->>'id')::uuid
            union all
            select a.approved_at
            from public.sellertray_commercial_adjustments a
            where a.tenant_id=s.tenant_id
              and a.commercial_order_id=(s.state->'commercialOrder'->>'id')::uuid
          ) f
        )
      ) as qualifying_settlement_at,
      (s.state->'activation'->>'effectiveFrom')::timestamptz as activation_at,
      (
        select min(b.created_at)
        from public.branches b
        where b.tenant_id=s.tenant_id
          and b.is_active
      ) as first_active_branch_at,
      (
        select min(a.created_at)
        from public.sellertray_commercial_setup_appointments a
        where a.tenant_id=s.tenant_id
          and a.commercial_order_id=(s.state->'commercialOrder'->>'id')::uuid
      ) as first_setup_booked_at,
      (
        select min(a.scheduled_start_at)
        from public.sellertray_commercial_setup_appointments a
        where a.tenant_id=s.tenant_id
          and a.commercial_order_id=(s.state->'commercialOrder'->>'id')::uuid
      ) as first_setup_scheduled_at,
      (
        select max(r.ready_at)
        from public.sellertray_commercial_branch_setup_readiness r
        where r.tenant_id=s.tenant_id
          and r.commercial_order_id=(s.state->'commercialOrder'->>'id')::uuid
      ) as last_branch_ready_at,
      (
        select case
          when count(*) > 0 and count(r.id)=count(*) then max(r.ready_at)
          else null
        end
        from public.sellertray_commercial_order_price_snapshots ps
        left join public.sellertray_commercial_branch_setup_readiness r
          on r.tenant_id=ps.tenant_id
         and r.commercial_order_id=ps.commercial_order_id
         and r.branch_id=ps.branch_id
        where ps.tenant_id=s.tenant_id
          and ps.commercial_order_id=(s.state->'commercialOrder'->>'id')::uuid
          and ps.line_type='branch_setup'
      ) as all_branches_ready_at,
      (
        select max(e.recorded_at)
        from public.sellertray_commercial_entitlement_events e
        where e.tenant_id=s.tenant_id
          and e.commercial_order_id=(s.state->'commercialOrder'->>'id')::uuid
          and e.event_type in (
            'installment.provisional_activated',
            'installment.full_entitlement_released'
          )
      ) as activation_recorded_at,
      coalesce((s.state->'branchSetup'->>'requiredCount')::integer,0) as setup_required_count,
      coalesce((s.state->'branchSetup'->>'readyCount')::integer,0) as setup_ready_count
    from states s
  ),
  staged as materialized (
    select
      e.*,
      case e.current_stage
        when 'active' then coalesce(
          e.activation_at,
          e.activation_recorded_at,
          e.all_branches_ready_at,
          e.last_branch_ready_at,
          e.qualifying_settlement_at,
          e.agreement_accepted_at,
          e.commercial_order_at,
          e.business_created_at
        )
        when 'activation' then coalesce(
          e.all_branches_ready_at,
          e.last_branch_ready_at,
          e.qualifying_settlement_at,
          e.agreement_accepted_at,
          e.commercial_order_at,
          e.business_created_at
        )
        when 'setup' then coalesce(
          e.qualifying_settlement_at,
          e.agreement_accepted_at,
          e.commercial_order_at,
          e.business_created_at
        )
        when 'settlement' then coalesce(
          e.agreement_accepted_at,
          e.commercial_order_at,
          e.business_created_at
        )
        when 'agreement' then coalesce(
          e.commercial_order_at,
          e.business_created_at
        )
        when 'commercial_order' then coalesce(
          e.first_active_branch_at,
          e.business_created_at
        )
        else e.business_created_at
      end as stage_entered_at
    from enriched e
  ),
  aged as materialized (
    select
      s.*,
      greatest(
        extract(epoch from (v_now-s.stage_entered_at)),
        0
      )::bigint as time_in_stage_seconds
    from staged s
  )
  select jsonb_build_object(
    'generatedAt',v_now,
    'funnel',jsonb_build_object(
      'totalBusinesses',(select count(*) from aged),
      'withCommercialOrder',(select count(*) from aged where commercial_order_id is not null),
      'agreementAccepted',(select count(*) from aged where commercial_order_id is not null and coalesce((state->'agreement'->>'accepted')::boolean,false)),
      'qualifyingSettlement',(select count(*) from aged where commercial_order_id is not null and coalesce((state->'settlement'->>'qualifyingSettlementSatisfied')::boolean,false)),
      'setupReady',(select count(*) from aged where setup_required_count>0 and setup_ready_count>=setup_required_count),
      'activated',(select count(*) from aged where coalesce(state->'activation'->>'entitlementState','not_active') in ('provisional','full'))
    ),
    'stageMetrics',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'stage',m.current_stage,
          'businessCount',m.business_count,
          'averageTimeInStageSeconds',m.average_time_in_stage_seconds,
          'longestTimeInStageSeconds',m.longest_time_in_stage_seconds
        )
        order by m.stage_order,m.current_stage
      )
      from (
        select
          a.current_stage,
          case a.current_stage
            when 'business_setup' then 1
            when 'commercial_order' then 2
            when 'agreement' then 3
            when 'settlement' then 4
            when 'setup' then 5
            when 'activation' then 6
            when 'active' then 7
            else 99
          end as stage_order,
          count(*)::integer as business_count,
          round(avg(a.time_in_stage_seconds))::bigint as average_time_in_stage_seconds,
          max(a.time_in_stage_seconds)::bigint as longest_time_in_stage_seconds
        from aged a
        group by a.current_stage
      ) m
    ),'[]'::jsonb),
    'items',coalesce((
      select jsonb_agg(
        q.item
        order by q.time_in_stage_seconds desc,q.business_name,q.tenant_id
      )
      from (
        select
          a.tenant_id,
          a.business_name,
          a.time_in_stage_seconds,
          jsonb_build_object(
            'tenantId',a.tenant_id,
            'businessName',a.business_name,
            'merchantCode',a.merchant_code,
            'businessCreatedAt',a.business_created_at,
            'currentStage',a.current_stage,
            'stageEnteredAt',a.stage_entered_at,
            'timeInStageSeconds',a.time_in_stage_seconds,
            'blockers',coalesce(a.state->'blockers','[]'::jsonb),
            'nextAction',a.state->'nextAction',
            'commercialOrder',a.state->'commercialOrder',
            'commercialOrderActorUserId',(
              select o.created_by_user_id
              from public.sellertray_commercial_orders o
              where o.id=a.commercial_order_id
                and o.tenant_id=a.tenant_id
            ),
            'agreement',jsonb_build_object(
              'required',coalesce((a.state->'agreement'->>'required')::boolean,false),
              'published',coalesce((a.state->'agreement'->>'published')::boolean,false),
              'accepted',coalesce((a.state->'agreement'->>'accepted')::boolean,false),
              'acceptedAt',a.state->'agreement'->>'acceptedAt',
              'currentVersion',case
                when jsonb_typeof(a.state->'agreement'->'currentVersion')='object'
                  then (a.state->'agreement'->'currentVersion')-'contentBody'
                else null
              end,
              'acceptedByUserId',(
                select ma.accepted_by_user_id
                from public.sellertray_master_agreement_acceptances ma
                where ma.tenant_id=a.tenant_id
                  and ma.agreement_version_id=public.resolve_sellertray_master_agreement_version_id(v_now)
                limit 1
              ),
              'acceptedRole',(
                select ma.accepted_role
                from public.sellertray_master_agreement_acceptances ma
                where ma.tenant_id=a.tenant_id
                  and ma.agreement_version_id=public.resolve_sellertray_master_agreement_version_id(v_now)
                limit 1
              )
            ),
            'settlement',a.state->'settlement',
            'branchSetup',a.state->'branchSetup',
            'activation',a.state->'activation',
            'progression',jsonb_build_object(
              'businessCreatedAt',a.business_created_at,
              'firstActiveBranchAt',a.first_active_branch_at,
              'commercialOrderAt',a.commercial_order_at,
              'agreementAcceptedAt',a.agreement_accepted_at,
              'qualifyingSettlementAt',a.qualifying_settlement_at,
              'firstSetupBookedAt',a.first_setup_booked_at,
              'firstSetupScheduledAt',a.first_setup_scheduled_at,
              'lastBranchReadyAt',a.last_branch_ready_at,
              'allBranchesReadyAt',a.all_branches_ready_at,
              'activationAt',a.activation_at,
              'activationRecordedAt',a.activation_recorded_at
            ),
            'branches',(
              select coalesce(
                jsonb_agg(
                  jsonb_build_object(
                    'branchId',b.id,
                    'branchCode',b.code,
                    'branchName',b.name,
                    'active',b.is_active,
                    'default',b.is_default,
                    'createdAt',b.created_at,
                    'setupRequired',coalesce(scope.setup_required,false),
                    'setupState',case
                      when r.id is not null then 'ready'
                      when not coalesce(scope.setup_required,false) then 'not_required'
                      when ap.status is not null then ap.status
                      else 'not_scheduled'
                    end,
                    'setupAppointment',case when ap.id is null then null else jsonb_build_object(
                      'id',ap.id,
                      'status',ap.status,
                      'scheduledStartAt',ap.scheduled_start_at,
                      'scheduledEndAt',ap.scheduled_end_at,
                      'createdAt',ap.created_at,
                      'completedAt',ap.completed_at,
                      'workerId',ap.worker_id
                    ) end,
                    'readiness',case when r.id is null then null else jsonb_build_object(
                      'id',r.id,
                      'readyAt',r.ready_at,
                      'recordedAt',r.recorded_at,
                      'actorUserId',r.actor_user_id,
                      'reason',r.reason
                    ) end,
                    'latestProcessEdgeSetupEvent',case when pe.id is null then null else jsonb_build_object(
                      'eventType',pe.event_type,
                      'actorUserId',pe.actor_user_id,
                      'reason',pe.reason,
                      'occurredAt',pe.occurred_at
                    ) end
                  )
                  order by b.is_default desc,b.name,b.id
                ),
                '[]'::jsonb
              )
              from public.branches b
              left join lateral (
                select coalesce(bool_or(ps.line_type='branch_setup'),false) as setup_required
                from public.sellertray_commercial_order_price_snapshots ps
                where ps.tenant_id=a.tenant_id
                  and ps.commercial_order_id=a.commercial_order_id
                  and ps.branch_id=b.id
              ) scope on true
              left join lateral (
                select x.*
                from public.sellertray_commercial_setup_appointments x
                where x.tenant_id=a.tenant_id
                  and x.commercial_order_id=a.commercial_order_id
                  and x.branch_id=b.id
                order by x.created_at desc,x.id desc
                limit 1
              ) ap on true
              left join public.sellertray_commercial_branch_setup_readiness r
                on r.tenant_id=a.tenant_id
               and r.commercial_order_id=a.commercial_order_id
               and r.branch_id=b.id
              left join lateral (
                select ev.*
                from public.sellertray_commercial_setup_appointment_events ev
                where ev.appointment_id=ap.id
                  and ev.tenant_id=a.tenant_id
                  and ev.actor_kind='platform'
                order by ev.occurred_at desc,ev.id desc
                limit 1
              ) pe on true
              where b.tenant_id=a.tenant_id
            ),
            'activationEvidence',(
              select jsonb_build_object(
                'eventType',e.event_type,
                'effectiveFrom',e.effective_from,
                'effectiveUntil',e.effective_until,
                'recordedAt',e.recorded_at,
                'actorUserId',e.actor_user_id,
                'reason',e.reason
              )
              from public.sellertray_commercial_entitlement_events e
              where e.tenant_id=a.tenant_id
                and e.commercial_order_id=a.commercial_order_id
                and e.event_type in (
                  'installment.provisional_activated',
                  'installment.full_entitlement_released'
                )
              order by
                case e.event_type
                  when 'installment.full_entitlement_released' then 0
                  else 1
                end,
                e.recorded_at desc,e.id desc
              limit 1
            ),
            'privilegedInterventions',(
              select coalesce(
                jsonb_agg(
                  jsonb_build_object(
                    'action',x.action,
                    'actorUserId',x.actor_user_id,
                    'createdAt',x.created_at,
                    'detail',x.detail
                  )
                  order by x.created_at desc,x.id desc
                ),
                '[]'::jsonb
              )
              from (
                select pa.id,pa.action,pa.actor_user_id,pa.created_at,pa.detail
                from public.platform_admin_audit pa
                where pa.tenant_id=a.tenant_id
                  and (
                    pa.action like 'sellertray_%'
                    or pa.action like 'commercial_%'
                    or pa.action like 'branch_setup_%'
                    or pa.action like 'setup_%'
                    or pa.action like 'installment_%'
                  )
                order by pa.created_at desc,pa.id desc
                limit 20
              ) x
            )
          ) as item
        from aged a
        order by a.time_in_stage_seconds desc,a.business_name,a.tenant_id
        limit p_limit
      ) q
    ),'[]'::jsonb),
    'coverage',jsonb_build_object(
      'authority','Read-only composition of governed onboarding, commercial, Master Agreement, settlement, Branch setup/readiness, entitlement and platform audit facts.',
      'stageClock','Time in stage is derived on the server from authoritative milestone timestamps; no additional lifecycle state is persisted.',
      'branchScope','Branch setup/readiness is reported per Branch while the pre-C2 runtime compatibility subscription remains Business-scoped.',
      'agreement','Agreement status uses the current universal SellerTray Master Agreement version, not retired order-bound agreement evidence.',
      'revenue','This is an onboarding/operations funnel. It does not redefine ProcessEdge Revenue Dashboard accounting semantics.',
      'sourceAttribution','No acquisition/source attribution is reported because no governed source-attribution fact exists.'
    )
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.platform_admin_onboarding_commercial_report(uuid,integer)
  from public,anon,authenticated;
grant execute on function public.platform_admin_onboarding_commercial_report(uuid,integer)
  to service_role;

comment on function public.platform_admin_onboarding_commercial_report(uuid,integer) is
  'OA5B ProcessEdge onboarding/commercial operations report. Read-only, Branch-aware and explicitly pre-C2 compatibility-safe.';

-- Keep the existing Edge Function action and dashboard contract stable by
-- extending the existing server summary instead of adding a browser-owned join.
alter function public.platform_admin_business_summary(uuid,integer)
  rename to platform_admin_business_summary_pre_oa5b;

revoke all on function public.platform_admin_business_summary_pre_oa5b(uuid,integer)
  from public,anon,authenticated;
grant execute on function public.platform_admin_business_summary_pre_oa5b(uuid,integer)
  to service_role;

create or replace function public.platform_admin_business_summary(
  p_actor_user_id uuid,
  p_days integer default 30
)
returns jsonb
language plpgsql
stable
security invoker
set search_path=''
as $$
declare
  v_summary jsonb;
begin
  v_summary := public.platform_admin_business_summary_pre_oa5b(
    p_actor_user_id,
    p_days
  );

  return v_summary || jsonb_build_object(
    'onboardingCommercial',
    public.platform_admin_onboarding_commercial_report(p_actor_user_id,50)
  );
end;
$$;

revoke all on function public.platform_admin_business_summary(uuid,integer)
  from public,anon,authenticated;
grant execute on function public.platform_admin_business_summary(uuid,integer)
  to service_role;

comment on function public.platform_admin_business_summary(uuid,integer) is
  'ProcessEdge business summary extended by OA5B with server-governed onboarding/commercial funnel reporting.';

commit;
