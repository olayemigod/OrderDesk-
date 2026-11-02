begin;

-- SellerTray C2-4/C2-5 review convergence.
--
-- Keep every Branch Subscription lifecycle/add-on command on one lock order:
-- command identity -> immutable Branch lookup -> Branch advisory lock -> row lock.
-- This prevents the transition/add-on deadlock where one path held the row lock
-- and waited for the Branch lock while the other held the Branch lock and needed
-- a foreign-key KEY SHARE lock on the same subscription row.
--
-- Also preserve the distinction between provisional and full entitlement while a
-- term is suspended. A suspended provisional term may resume as provisional, or
-- may later receive governed full activation to its allowed full-term boundary.

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
  v_branch_id uuid;
  v_subscription public.sellertray_branch_subscriptions%rowtype;
  v_existing_event public.sellertray_branch_subscription_events%rowtype;
  v_event_type text;
  v_new_period_end timestamptz;
  v_expected_end timestamptz;
  v_suspended_from text;
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

  -- Branch identity is immutable. Read it without a row lock, then acquire the
  -- same Branch advisory lock used by add-on registration before taking FOR UPDATE.
  select s.branch_id into strict v_branch_id
  from public.sellertray_branch_subscriptions s
  where s.tenant_id=p_tenant_id and s.id=p_branch_subscription_id;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'sellertray-branch-subscription|'||p_tenant_id::text||'|'||v_branch_id::text,0
  ));

  select s.* into strict v_subscription
  from public.sellertray_branch_subscriptions s
  where s.tenant_id=p_tenant_id and s.id=p_branch_subscription_id
  for update;

  if v_subscription.lifecycle_status='suspended' then
    select nullif(e.details->>'previousStatus','') into v_suspended_from
    from public.sellertray_branch_subscription_events e
    where e.tenant_id=p_tenant_id
      and e.branch_subscription_id=p_branch_subscription_id
      and e.event_type='suspended'
    order by e.effective_at desc,e.lifecycle_sequence desc
    limit 1;

    if v_suspended_from not in ('provisional','active') then
      raise exception 'Suspended Branch Subscription is missing its prior entitlement state' using errcode='23514';
    end if;
  end if;

  if v_subscription.lifecycle_status in ('expired','cancelled') then
    raise exception 'Expired or cancelled Branch Subscription terms are terminal' using errcode='23514';
  end if;

  if v_target='provisional' then
    if v_subscription.lifecycle_status='pending' then
      if p_entitlement_period_end is null or p_entitlement_period_end<=p_effective_at
         or p_expected_full_term_end is null or p_expected_full_term_end<p_entitlement_period_end then
        raise exception 'Provisional activation requires a valid provisional and expected full-term window' using errcode='22023';
      end if;
    elsif v_subscription.lifecycle_status='suspended' and v_suspended_from='provisional' then
      if v_subscription.entitlement_period_end is null or p_effective_at>=v_subscription.entitlement_period_end then
        raise exception 'An expired provisional Branch Subscription term cannot be resumed' using errcode='23514';
      end if;
      if p_entitlement_period_end is not null
         and p_entitlement_period_end is distinct from v_subscription.entitlement_period_end then
        raise exception 'Provisional resume cannot rewrite the governed provisional boundary' using errcode='23514';
      end if;
      if p_expected_full_term_end is not null
         and p_expected_full_term_end is distinct from v_subscription.expected_full_term_end then
        raise exception 'Provisional resume cannot rewrite the governed full-term boundary' using errcode='23514';
      end if;
    else
      raise exception 'Only a pending or provisionally suspended Branch Subscription can become provisional' using errcode='23514';
    end if;
  elsif v_target='active' then
    if v_subscription.lifecycle_status not in ('pending','provisional','suspended') then
      raise exception 'Only pending, provisional or suspended Branch Subscription may become active' using errcode='23514';
    end if;
    if v_subscription.lifecycle_status='pending'
       and (p_entitlement_period_end is null or p_entitlement_period_end<=p_effective_at) then
      raise exception 'Activation requires a valid Branch entitlement period' using errcode='22023';
    end if;
    if v_subscription.lifecycle_status='suspended'
       and v_subscription.entitlement_period_end is not null
       and p_effective_at>=v_subscription.entitlement_period_end then
      raise exception 'An expired Branch Subscription term cannot be resumed or fully activated' using errcode='23514';
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

  if v_target='provisional' and v_subscription.lifecycle_status='pending' then
    v_new_period_end:=p_entitlement_period_end;
    v_expected_end:=p_expected_full_term_end;
  elsif v_target='provisional' and v_subscription.lifecycle_status='suspended' and v_suspended_from='provisional' then
    v_new_period_end:=v_subscription.entitlement_period_end;
    v_expected_end:=v_subscription.expected_full_term_end;
  elsif v_target='active' and v_subscription.lifecycle_status='pending' then
    v_new_period_end:=p_entitlement_period_end;
    v_expected_end:=coalesce(p_expected_full_term_end,p_entitlement_period_end);
  elsif v_target='active' and (
    v_subscription.lifecycle_status='provisional'
    or (v_subscription.lifecycle_status='suspended' and v_suspended_from='provisional')
  ) then
    v_new_period_end:=coalesce(p_entitlement_period_end,v_subscription.expected_full_term_end);
    v_expected_end:=coalesce(v_subscription.expected_full_term_end,p_expected_full_term_end,v_new_period_end);
    if v_new_period_end is null or v_new_period_end<v_subscription.entitlement_period_end
       or (v_subscription.expected_full_term_end is not null and v_new_period_end>v_subscription.expected_full_term_end) then
      raise exception 'Full activation must preserve or extend provisional entitlement only to the governed full-term boundary' using errcode='23514';
    end if;
  elsif v_target='active' and v_subscription.lifecycle_status='suspended' and v_suspended_from='active' then
    if p_entitlement_period_end is not null
       and p_entitlement_period_end is distinct from v_subscription.entitlement_period_end then
      raise exception 'Active resume cannot rewrite the governed entitlement boundary' using errcode='23514';
    end if;
    if p_expected_full_term_end is not null
       and p_expected_full_term_end is distinct from v_subscription.expected_full_term_end then
      raise exception 'Active resume cannot rewrite the governed full-term boundary' using errcode='23514';
    end if;
    v_new_period_end:=v_subscription.entitlement_period_end;
    v_expected_end:=v_subscription.expected_full_term_end;
  else
    v_new_period_end:=v_subscription.entitlement_period_end;
    v_expected_end:=v_subscription.expected_full_term_end;
  end if;

  if v_target in ('provisional','active') then
    -- Pending/provisional resume may carry add-ons through the expected full term;
    -- once full active entitlement is being set, assignments must fit the actual
    -- resulting active term.
    perform public.assert_sellertray_branch_subscription_addons_fit_term(
      p_tenant_id,
      p_branch_subscription_id,
      coalesce(v_subscription.entitlement_period_start,p_effective_at),
      case when v_target='provisional' then coalesce(v_expected_end,v_new_period_end) else v_new_period_end end
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
    when v_target='provisional' and v_subscription.lifecycle_status='suspended' then 'resumed'
    when v_target='provisional' then 'provisional_activated'
    when v_target='active' and v_subscription.lifecycle_status='suspended' and v_suspended_from='active' then 'resumed'
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
      'suspendedFrom',v_suspended_from,
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

-- A resumed event may restore either the provisional or active lifecycle. The
-- target status is immutable event detail, so as-of resolution remains exact.
create or replace function public.sellertray_branch_subscription_effective_status(
  p_branch_subscription_id uuid,
  p_as_of timestamptz
)
returns text
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  v_subscription public.sellertray_branch_subscriptions%rowtype;
  v_event public.sellertray_branch_subscription_events%rowtype;
  v_status text;
  v_event_period_end timestamptz;
begin
  if p_branch_subscription_id is null or p_as_of is null then
    return null;
  end if;

  select s.* into v_subscription
  from public.sellertray_branch_subscriptions s
  where s.id=p_branch_subscription_id;
  if not found then return null; end if;

  select e.* into v_event
  from public.sellertray_branch_subscription_events e
  where e.branch_subscription_id=p_branch_subscription_id
    and e.effective_at<=p_as_of
  order by e.effective_at desc,e.lifecycle_sequence desc
  limit 1;

  if not found then return 'not_started'; end if;

  v_status:=case v_event.event_type
    when 'created' then 'pending'
    when 'provisional_activated' then 'provisional'
    when 'activated' then 'active'
    when 'resumed' then case
      when v_event.details->>'targetStatus'='provisional' then 'provisional'
      else 'active'
    end
    when 'suspended' then 'suspended'
    when 'expired' then 'expired'
    when 'cancelled' then 'cancelled'
    else 'pending'
  end;

  v_event_period_end:=nullif(v_event.details->>'entitlementPeriodEnd','')::timestamptz;

  if v_status in ('provisional','active','suspended') then
    if v_subscription.entitlement_period_start is not null
       and p_as_of<v_subscription.entitlement_period_start then
      return 'not_started';
    end if;
    if v_event_period_end is not null and p_as_of>=v_event_period_end then
      return 'expired';
    end if;
  end if;

  return v_status;
end;
$function$;

revoke all on function public.sellertray_branch_subscription_effective_status(uuid,timestamptz)
  from public,anon,authenticated;
grant execute on function public.sellertray_branch_subscription_effective_status(uuid,timestamptz)
  to service_role;

commit;
