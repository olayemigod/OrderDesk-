-- OA5 agreement/payment convergence.
-- New governed commercial orders must have their current Order Form confirmed
-- before SellerTray creates a new installment checkout. Existing checkout
-- sessions remain replayable and obligations with no Order Form nor agreement
-- orchestration record remain legacy-compatible until the C2 cutover.

create or replace function public.reserve_sellertray_installment_checkout(
  p_tenant_id uuid,
  p_installment_schedule_id uuid,
  p_command_id uuid,
  p_actor_user_id uuid,
  p_billing_email text
)
returns jsonb
language plpgsql
set search_path to ''
as $function$
declare
  v_role text;
  v_email text := lower(btrim(coalesce(p_billing_email,'')));
  v_schedule public.sellertray_commercial_installment_schedule%rowtype;
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_order public.sellertray_commercial_orders%rowtype;
  v_plan_code text;
  v_state jsonb;
  v_next_schedule_id uuid;
  v_next_amount numeric(18,2);
  v_existing public.billing_checkout_sessions%rowtype;
  v_reference text;
  v_session public.billing_checkout_sessions%rowtype;
  v_order_form_id uuid;
  v_order_form_confirmed boolean := false;
  v_agreement_processing_exists boolean := false;
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

  -- Preserve exact retry/idempotency facts committed before this convergence.
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

  -- Existing active checkout sessions are immutable payment facts. Reuse them
  -- before applying the new-order confirmation gate.
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

  select f.id into v_order_form_id
  from public.sellertray_commercial_order_forms f
  where f.tenant_id=p_tenant_id
    and f.commercial_order_id=v_order.id
    and not exists (
      select 1 from public.sellertray_commercial_order_forms replacement
      where replacement.tenant_id=f.tenant_id
        and replacement.supersedes_order_form_id=f.id
    )
  order by f.issued_at desc, f.created_at desc
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
  else
    select exists(
      select 1
      from public.sellertray_agreement_package_processing p
      where p.tenant_id=p_tenant_id
        and (
          p.commercial_order_id=v_order.id
          or p.installment_obligation_id=v_obligation.id
          or (p.subject_kind='installment_obligation' and p.subject_id=v_obligation.id)
        )
    ) into v_agreement_processing_exists;
    if v_agreement_processing_exists then
      raise exception 'SellerTray is preparing the Order Form for this purchase. Review and confirm it before payment'
        using errcode='23514';
    end if;
    -- No Order Form and no orchestration record is the structural legacy
    -- compatibility case. C2 will retire this exception deliberately.
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
$function$;

comment on function public.reserve_sellertray_installment_checkout(uuid,uuid,uuid,uuid,text) is
  'Reserves idempotent SellerTray installment checkout. New governed orders require current Order Form confirmation; existing checkout facts and structurally legacy obligations remain compatible until C2.';
