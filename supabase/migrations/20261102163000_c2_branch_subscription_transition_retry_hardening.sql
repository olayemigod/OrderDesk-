begin;

-- Lifecycle events snapshot derived period boundaries for as-of reads, but
-- idempotency must compare the caller's requested transition facts. Keep both
-- values so suspend/expire/cancel retries do not conflict merely because their
-- event snapshot includes an existing entitlement-period end.
create or replace function public.transition_sellertray_branch_subscription(
  p_tenant_id uuid,
  p_branch_subscription_id uuid,
  p_target_status text,
  p_effective_at timestamptz,
  p_entitlement_period_end timestamptz,
  p_expected_full_term_end timestamptz,
  p_command_id uuid,
  p_reason text,
  p_actor_kind text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_target text:=lower(btrim(coalesce(p_target_status,'')));
  v_actor_kind text:=lower(btrim(coalesce(p_actor_kind,'')));
  v_reason text:=btrim(coalesce(p_reason,''));
  v_subscription public.sellertray_branch_subscriptions%rowtype;
  v_existing_event public.sellertray_branch_subscription_events%rowtype;
  v_event_type text;
  v_new_period_end timestamptz;
  v_expected_end timestamptz;
begin
  if p_tenant_id is null or p_branch_subscription_id is null or p_command_id is null
     or p_effective_at is null or v_target not in ('provisional','active','suspended','expired','cancelled')
     or v_actor_kind not in ('system','merchant','platform_admin')
     or char_length(v_reason) not between 6 and 1000 then
    raise exception 'Valid Branch Subscription transition facts are required' using errcode='22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'sellertray-branch-subscription-command|'||p_command_id::text,0
  ));

  select e.* into v_existing_event
  from public.sellertray_branch_subscription_events e
  where e.tenant_id=p_tenant_id and e.command_id=p_command_id;

  if found then
    if v_existing_event.branch_subscription_id=p_branch_subscription_id
       and v_existing_event.effective_at=p_effective_at
       and v_existing_event.actor_kind=v_actor_kind
       and v_existing_event.actor_user_id is not distinct from p_actor_user_id
       and v_existing_event.reason=v_reason
       and v_existing_event.details->>'targetStatus'=v_target
       and nullif(v_existing_event.details->>'requestedEntitlementPeriodEnd','')::timestamptz is not distinct from p_entitlement_period_end
       and nullif(v_existing_event.details->>'requestedExpectedFullTermEnd','')::timestamptz is not distinct from p_expected_full_term_end then
      return jsonb_build_object(
        'branchSubscriptionId',p_branch_subscription_id,
        'status',(select lifecycle_status from public.sellertray_branch_subscriptions where tenant_id=p_tenant_id and id=p_branch_subscription_id),
        'alreadyApplied',true
      );
    end if;
    raise exception 'Branch Subscription lifecycle command is already used for different facts' using errcode='23505';
  end if;

  select s.* into strict v_subscription
  from public.sellertray_branch_subscriptions s
  where s.tenant_id=p_tenant_id and s.id=p_branch_subscription_id
  for update;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'sellertray-branch-subscription|'||p_tenant_id::text||'|'||v_subscription.branch_id::text,0
  ));

  if v_subscription.lifecycle_status in ('expired','cancelled') then
    raise exception 'Expired or cancelled Branch Subscription terms are terminal' using errcode='23514';
  end if;

  if v_target='provisional' then
    if v_subscription.lifecycle_status<>'pending' then
      raise exception 'Only a pending Branch Subscription can become provisional' using errcode='23514';
    end if;
    if p_entitlement_period_end is null or p_entitlement_period_end<=p_effective_at
       or p_expected_full_term_end is null or p_expected_full_term_end<p_entitlement_period_end then
      raise exception 'Provisional activation requires a valid provisional and expected full-term window' using errcode='22023';
    end if;
  elsif v_target='active' then
    if v_subscription.lifecycle_status not in ('pending','provisional','suspended') then
      raise exception 'Only pending, provisional or suspended Branch Subscription may become active' using errcode='23514';
    end if;
    if v_subscription.lifecycle_status='pending' and (p_entitlement_period_end is null or p_entitlement_period_end<=p_effective_at) then
      raise exception 'Activation requires a valid Branch entitlement period' using errcode='22023';
    end if;
    if v_subscription.lifecycle_status='suspended'
       and v_subscription.entitlement_period_end is not null
       and p_effective_at>=v_subscription.entitlement_period_end then
      raise exception 'An expired Branch Subscription term cannot be resumed' using errcode='23514';
    end if;
  elsif v_target='suspended' then
    if v_subscription.lifecycle_status not in ('provisional','active') then
      raise exception 'Only an entitled Branch Subscription may be suspended' using errcode='23514';
    end if;
    if v_subscription.entitlement_period_end is not null and p_effective_at>=v_subscription.entitlement_period_end then
      raise exception 'An expired Branch Subscription term cannot be suspended' using errcode='23514';
    end if;
  elsif v_target='expired' then
    if v_subscription.lifecycle_status not in ('provisional','active','suspended') then
      raise exception 'Only an activated Branch Subscription may expire' using errcode='23514';
    end if;
  elsif v_target='cancelled' then
    if v_subscription.lifecycle_status not in ('pending','provisional','active','suspended') then
      raise exception 'Branch Subscription cannot be cancelled from its current state' using errcode='23514';
    end if;
  end if;

  if v_target in ('provisional','active') and v_subscription.lifecycle_status='pending'
     and v_subscription.provenance_kind='commercial_order' then
    if v_subscription.commercial_order_id is null or v_subscription.commercial_order_line_id is null
       or v_subscription.settlement_qualified_at is null
       or (v_subscription.setup_required and v_subscription.setup_readiness_id is null)
       or (v_subscription.required_master_agreement_version_id is not null and v_subscription.master_agreement_acceptance_id is null) then
      raise exception 'Native Branch Subscription prerequisites are incomplete' using errcode='23514';
    end if;
  end if;

  if v_target in ('provisional','active') and v_subscription.lifecycle_status='pending' then
    if exists(
      select 1
      from public.sellertray_branch_subscriptions other
      where other.tenant_id=p_tenant_id
        and other.branch_id=v_subscription.branch_id
        and other.id<>v_subscription.id
        and other.lifecycle_status in ('provisional','active','suspended')
        and other.entitlement_period_start is not null
        and other.entitlement_period_end is not null
        and tstzrange(other.entitlement_period_start,other.entitlement_period_end,'[)')
            && tstzrange(p_effective_at,p_entitlement_period_end,'[)')
    ) then
      raise exception 'Branch Subscription entitlement periods cannot overlap' using errcode='23P01';
    end if;
  end if;

  if v_target='provisional' then
    v_new_period_end:=p_entitlement_period_end;
    v_expected_end:=p_expected_full_term_end;
  elsif v_target='active' and v_subscription.lifecycle_status='pending' then
    v_new_period_end:=p_entitlement_period_end;
    v_expected_end:=coalesce(p_expected_full_term_end,p_entitlement_period_end);
  elsif v_target='active' and v_subscription.lifecycle_status='provisional' then
    v_new_period_end:=coalesce(p_entitlement_period_end,v_subscription.expected_full_term_end);
    v_expected_end:=coalesce(v_subscription.expected_full_term_end,p_expected_full_term_end,v_new_period_end);
    if v_new_period_end is null or v_new_period_end<v_subscription.entitlement_period_end
       or (v_subscription.expected_full_term_end is not null and v_new_period_end>v_subscription.expected_full_term_end) then
      raise exception 'Full activation must preserve or extend provisional entitlement only to the governed full-term boundary' using errcode='23514';
    end if;
  else
    v_new_period_end:=v_subscription.entitlement_period_end;
    v_expected_end:=v_subscription.expected_full_term_end;
  end if;

  if v_target in ('provisional','active') and v_subscription.lifecycle_status='pending' then
    perform public.assert_sellertray_branch_subscription_addons_fit_term(
      p_tenant_id,p_branch_subscription_id,p_effective_at,coalesce(v_expected_end,v_new_period_end)
    );
  end if;

  perform set_config('sellertray.branch_subscription_mutation','governed',true);

  update public.sellertray_branch_subscriptions
  set lifecycle_status=v_target,
      activated_at=case
        when lifecycle_status='pending' and v_target in ('provisional','active') then p_effective_at
        else activated_at
      end,
      entitlement_period_start=case
        when lifecycle_status='pending' and v_target in ('provisional','active') then p_effective_at
        else entitlement_period_start
      end,
      entitlement_period_end=case
        when v_target in ('provisional','active') then v_new_period_end
        else entitlement_period_end
      end,
      expected_full_term_end=case
        when v_target in ('provisional','active') then v_expected_end
        else expected_full_term_end
      end,
      updated_at=now()
  where tenant_id=p_tenant_id and id=p_branch_subscription_id;

  v_event_type:=case
    when v_target='provisional' then 'provisional_activated'
    when v_target='active' and v_subscription.lifecycle_status='suspended' then 'resumed'
    when v_target='active' then 'activated'
    else v_target
  end;

  insert into public.sellertray_branch_subscription_events(
    tenant_id,branch_subscription_id,branch_id,command_id,event_type,effective_at,
    actor_kind,actor_user_id,reason,details
  ) values (
    p_tenant_id,p_branch_subscription_id,v_subscription.branch_id,p_command_id,v_event_type,p_effective_at,
    v_actor_kind,p_actor_user_id,v_reason,
    jsonb_build_object(
      'previousStatus',v_subscription.lifecycle_status,
      'targetStatus',v_target,
      'requestedEntitlementPeriodEnd',p_entitlement_period_end,
      'requestedExpectedFullTermEnd',p_expected_full_term_end,
      'entitlementPeriodEnd',case when v_target in ('provisional','active') then v_new_period_end else v_subscription.entitlement_period_end end,
      'expectedFullTermEnd',case when v_target in ('provisional','active') then v_expected_end else v_subscription.expected_full_term_end end
    )
  );

  return jsonb_build_object(
    'branchSubscriptionId',p_branch_subscription_id,
    'branchId',v_subscription.branch_id,
    'previousStatus',v_subscription.lifecycle_status,
    'status',v_target,
    'alreadyApplied',false,
    'entitlementPeriodStart',(select entitlement_period_start from public.sellertray_branch_subscriptions where id=p_branch_subscription_id),
    'entitlementPeriodEnd',(select entitlement_period_end from public.sellertray_branch_subscriptions where id=p_branch_subscription_id),
    'expectedFullTermEnd',(select expected_full_term_end from public.sellertray_branch_subscriptions where id=p_branch_subscription_id)
  );
end;
$function$;

revoke all on function public.transition_sellertray_branch_subscription(
  uuid,uuid,text,timestamptz,timestamptz,timestamptz,uuid,text,text,uuid
) from public,anon,authenticated;
grant execute on function public.transition_sellertray_branch_subscription(
  uuid,uuid,text,timestamptz,timestamptz,timestamptz,uuid,text,text,uuid
) to service_role;

commit;
