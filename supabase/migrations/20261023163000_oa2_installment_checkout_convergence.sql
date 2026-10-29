begin;

-- SellerTray OA2 installment checkout convergence
--
-- New/unaccepted commerce follows current effective installment policy.
-- Accepted installment agreements remain governed contracts even when a later
-- global policy disables new installment offers. Every provider transition is
-- revalidated against the shared settlement projection so a stale checkout can
-- never be revived by initialization retries or delayed provider callbacks.

-- ---------------------------------------------------------------------------
-- Contract/policy projection
-- ---------------------------------------------------------------------------

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

revoke all on function public.get_sellertray_installment_contract_checkout_policy(uuid,uuid,timestamptz)
  from public,anon,authenticated;
grant execute on function public.get_sellertray_installment_contract_checkout_policy(uuid,uuid,timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- Server-owned obligation materialization from current effective policy
-- ---------------------------------------------------------------------------

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
  );

  return v_obligation_id;
end;
$$;

revoke all on function public.materialize_sellertray_installment_obligation_internal(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.materialize_sellertray_installment_obligation_internal(uuid,uuid,uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- Checkout insert guard: accepted contract + current settlement, no annual-only
-- or initial-purchase stereotype.
-- ---------------------------------------------------------------------------

create or replace function public.guard_sellertray_initial_purchase_installment_checkout()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_order public.sellertray_commercial_orders%rowtype;
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_schedule public.sellertray_commercial_installment_schedule%rowtype;
  v_plan_code text;
  v_contract jsonb;
  v_settlement jsonb;
  v_next_schedule_id uuid;
  v_next_amount numeric(18,2);
  v_expected_reference text;
begin
  if new.checkout_kind is distinct from 'installment' then
    return new;
  end if;

  if new.tenant_id is null or new.command_id is null or new.commercial_order_id is null
     or new.installment_obligation_id is null or new.installment_schedule_id is null
     or new.amount is null or new.currency is null then
    raise exception 'Installment checkout requires governed commercial order, obligation, schedule and money identity'
      using errcode='23514';
  end if;
  if new.provider<>'paystack' or new.status<>'preparing'
     or new.authorization_url is not null
     or new.provider_customer_ref is not null
     or new.provider_subscription_ref is not null then
    raise exception 'Installment checkout must begin as an uninitialized Paystack reservation'
      using errcode='23514';
  end if;
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=new.tenant_id and tm.user_id=new.requested_by_user_id and tm.role='owner'
  ) then
    raise exception 'Only the business Owner can create an installment checkout reservation'
      using errcode='42501';
  end if;

  v_expected_reference := 'sti-'||substr(replace(new.tenant_id::text,'-',''),1,8)
    ||'-'||replace(new.command_id::text,'-','');
  if new.reference<>v_expected_reference then
    raise exception 'Installment checkout reference must match the governed command identity'
      using errcode='23514';
  end if;

  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.tenant_id=new.tenant_id and o.id=new.commercial_order_id;
  select o.* into strict v_obligation
  from public.sellertray_commercial_installment_obligations o
  where o.tenant_id=new.tenant_id and o.id=new.installment_obligation_id
    and o.commercial_order_id=v_order.id;
  select s.* into strict v_schedule
  from public.sellertray_commercial_installment_schedule s
  where s.tenant_id=new.tenant_id and s.id=new.installment_schedule_id
    and s.installment_obligation_id=v_obligation.id;
  select s.plan_code into strict v_plan_code
  from public.sellertray_commercial_order_price_snapshots s
  where s.tenant_id=new.tenant_id and s.commercial_order_id=v_order.id
    and s.line_type='subscription';

  v_contract := public.get_sellertray_installment_contract_checkout_policy(
    new.tenant_id,v_obligation.id,now()
  );
  if not coalesce((v_contract->>'agreementAccepted')::boolean,false) then
    raise exception 'The current installment agreement must be accepted before checkout'
      using errcode='23514';
  end if;

  v_settlement := public.get_sellertray_commercial_settlement_state(new.tenant_id,v_order.id);
  v_next_schedule_id := nullif(v_settlement->>'nextInstallmentScheduleId','')::uuid;
  v_next_amount := coalesce((v_settlement->>'nextPayableAmount')::numeric,0);

  if v_next_schedule_id is null or v_next_amount < 0.005 then
    raise exception 'Commercial order is already settled' using errcode='23514';
  end if;
  if new.installment_schedule_id<>v_next_schedule_id
     or new.plan_code is distinct from v_plan_code
     or new.currency is distinct from v_obligation.currency
     or abs(new.amount-v_next_amount)>=0.005 then
    raise exception 'Installment checkout must match the current authoritative payable schedule and amount'
      using errcode='23514';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_sellertray_initial_purchase_installment_checkout()
  from public,anon,authenticated;

-- Existing trigger keeps its name and now executes the converged function.

-- ---------------------------------------------------------------------------
-- Reservation authority
-- ---------------------------------------------------------------------------

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
  if v_next_schedule_id is distinct from p_installment_schedule_id then
    raise exception 'Selected installment is not the current authoritative payable schedule'
      using errcode='23514';
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

revoke all on function public.reserve_sellertray_installment_checkout(uuid,uuid,uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.reserve_sellertray_installment_checkout(uuid,uuid,uuid,uuid,text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Provider initialization transitions re-check settlement freshness.
-- ---------------------------------------------------------------------------

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

revoke all on function public.begin_sellertray_installment_checkout_initialization(uuid)
  from public,anon,authenticated;
grant execute on function public.begin_sellertray_installment_checkout_initialization(uuid)
  to service_role;

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

revoke all on function public.complete_sellertray_installment_checkout_initialization(uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.complete_sellertray_installment_checkout_initialization(uuid,text,text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Provider confirmation: idempotent duplicates survive, stale new callbacks do
-- not. Amount may be the authoritative residual of a schedule line after an
-- approved adjustment/direct payment, not necessarily the original full line.
-- ---------------------------------------------------------------------------

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

revoke all on function public.confirm_sellertray_installment_payment_from_checkout(uuid,text,text,numeric,text,timestamptz,text)
  from public,anon,authenticated;
grant execute on function public.confirm_sellertray_installment_payment_from_checkout(uuid,text,text,numeric,text,timestamptz,text)
  to service_role;

commit;
