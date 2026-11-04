begin;

-- C2-4/C2-5 hardening before any runtime cutover.
-- 1) Same-tenant evidence links must also refer to the exact same commercial
--    commitment / Branch / Master version when present.
-- 2) As-of lifecycle resolution must use the entitlement window recorded by the
--    latest lifecycle event rather than a later-expanded current-state row.
-- 3) Any add-on registered before activation must fit the eventual Branch term.

create or replace function public.validate_sellertray_branch_subscription_evidence()
returns trigger
language plpgsql
set search_path=''
as $function$
declare
  v_line public.sellertray_commercial_order_price_snapshots%rowtype;
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_readiness public.sellertray_commercial_branch_setup_readiness%rowtype;
  v_acceptance public.sellertray_master_agreement_acceptances%rowtype;
  v_order_form public.sellertray_commercial_order_forms%rowtype;
begin
  if new.commercial_order_line_id is not null then
    select l.* into strict v_line
    from public.sellertray_commercial_order_price_snapshots l
    where l.tenant_id=new.tenant_id and l.id=new.commercial_order_line_id;
    if new.commercial_order_id is null or v_line.commercial_order_id<>new.commercial_order_id then
      raise exception 'Branch Subscription commercial order line must belong to its commercial order' using errcode='23514';
    end if;
  end if;

  if new.installment_obligation_id is not null then
    select o.* into strict v_obligation
    from public.sellertray_commercial_installment_obligations o
    where o.tenant_id=new.tenant_id and o.id=new.installment_obligation_id;
    if new.commercial_order_id is null or v_obligation.commercial_order_id<>new.commercial_order_id then
      raise exception 'Branch Subscription installment obligation must belong to its commercial order' using errcode='23514';
    end if;
  end if;

  if new.setup_readiness_id is not null then
    if not new.setup_required then
      raise exception 'Branch setup readiness cannot be attached when setup is not required' using errcode='23514';
    end if;
    select r.* into strict v_readiness
    from public.sellertray_commercial_branch_setup_readiness r
    where r.tenant_id=new.tenant_id and r.id=new.setup_readiness_id;
    if v_readiness.branch_id<>new.branch_id then
      raise exception 'Branch setup readiness must belong to the Branch Subscription Branch' using errcode='23514';
    end if;
    if new.commercial_order_id is not null and v_readiness.commercial_order_id<>new.commercial_order_id then
      raise exception 'Branch setup readiness must belong to the Branch Subscription commercial order' using errcode='23514';
    end if;
  end if;

  if new.master_agreement_acceptance_id is not null then
    if new.required_master_agreement_version_id is null then
      raise exception 'Master Agreement acceptance requires an explicit required Master Agreement version' using errcode='23514';
    end if;
    select a.* into strict v_acceptance
    from public.sellertray_master_agreement_acceptances a
    where a.tenant_id=new.tenant_id and a.id=new.master_agreement_acceptance_id;
    if v_acceptance.agreement_version_id<>new.required_master_agreement_version_id then
      raise exception 'Master Agreement acceptance must match the Branch Subscription required version' using errcode='23514';
    end if;
  end if;

  if new.order_form_id is not null then
    select f.* into strict v_order_form
    from public.sellertray_commercial_order_forms f
    where f.tenant_id=new.tenant_id and f.id=new.order_form_id;
    if new.commercial_order_id is null or v_order_form.commercial_order_id<>new.commercial_order_id then
      raise exception 'Merchant Order Form must belong to the Branch Subscription commercial order' using errcode='23514';
    end if;
    if new.installment_obligation_id is not null
       and v_order_form.installment_obligation_id is not null
       and v_order_form.installment_obligation_id<>new.installment_obligation_id then
      raise exception 'Merchant Order Form installment evidence conflicts with the Branch Subscription obligation' using errcode='23514';
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function public.validate_sellertray_branch_subscription_evidence()
  from public,anon,authenticated;

drop trigger if exists validate_sellertray_branch_subscription_evidence
  on public.sellertray_branch_subscriptions;
create trigger validate_sellertray_branch_subscription_evidence
before insert or update on public.sellertray_branch_subscriptions
for each row execute function public.validate_sellertray_branch_subscription_evidence();

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
  order by e.effective_at desc,e.recorded_at desc,e.id desc
  limit 1;

  if not found then return 'not_started'; end if;

  v_status:=case v_event.event_type
    when 'created' then 'pending'
    when 'provisional_activated' then 'provisional'
    when 'activated' then 'active'
    when 'resumed' then 'active'
    when 'suspended' then 'suspended'
    when 'expired' then 'expired'
    when 'cancelled' then 'cancelled'
    else 'pending'
  end;

  -- Each lifecycle event snapshots the period end that was authoritative for
  -- that transition. This prevents a later full activation from extending what
  -- an earlier as-of query sees for the provisional period.
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

create or replace function public.assert_sellertray_branch_subscription_addons_fit_term(
  p_tenant_id uuid,
  p_branch_subscription_id uuid,
  p_term_start timestamptz,
  p_term_end timestamptz
)
returns void
language plpgsql
stable
security definer
set search_path=''
as $function$
begin
  if p_term_start is null or p_term_end is null or p_term_end<=p_term_start then
    raise exception 'A valid Branch Subscription term is required for add-on validation' using errcode='22023';
  end if;

  if exists(
    select 1
    from public.sellertray_branch_subscription_addons a
    where a.tenant_id=p_tenant_id
      and a.branch_subscription_id=p_branch_subscription_id
      and (a.entitlement_from<p_term_start or a.entitlement_until>p_term_end)
  ) then
    raise exception 'Branch add-on entitlement falls outside the governed Branch Subscription term' using errcode='23514';
  end if;
end;
$function$;

revoke all on function public.assert_sellertray_branch_subscription_addons_fit_term(uuid,uuid,timestamptz,timestamptz)
  from public,anon,authenticated;
grant execute on function public.assert_sellertray_branch_subscription_addons_fit_term(uuid,uuid,timestamptz,timestamptz)
  to service_role;

-- Replace only the lifecycle authority so pending add-ons are validated against
-- the term at first activation and historical/as-of event windows stay honest.
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
       and (v_existing_event.details->>'entitlementPeriodEnd')::timestamptz is not distinct from p_entitlement_period_end
       and (v_existing_event.details->>'expectedFullTermEnd')::timestamptz is not distinct from p_expected_full_term_end then
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
