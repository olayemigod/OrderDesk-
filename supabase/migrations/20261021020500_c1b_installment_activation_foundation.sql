begin;

-- SellerTray C1B Installment Activation Foundation
--
-- C1B consumes the immutable C1 commercial order/installment schedule and the
-- C1A current-agreement acceptance fact. Payment confirmation, setup readiness,
-- agreement acceptance and entitlement remain separate authorities.
--
-- Runtime compatibility continues through public.tenant_subscriptions until C2.
-- C1B may extend an existing compatible runtime period only through governed,
-- append-only entitlement events. It does not retire legacy trial semantics.
--
-- Exact installment due dates, grace duration and suspension timing are not yet
-- approved. Due/past-due state below is therefore informational only and does
-- not automatically downgrade runtime access.

alter table public.billing_checkout_sessions
  add column if not exists checkout_kind text not null default 'legacy_subscription',
  add column if not exists command_id uuid,
  add column if not exists commercial_order_id uuid,
  add column if not exists installment_obligation_id uuid,
  add column if not exists installment_schedule_id uuid,
  add column if not exists amount numeric(18,2),
  add column if not exists currency text;

alter table public.billing_checkout_sessions
  drop constraint if exists billing_checkout_sessions_status_check,
  add constraint billing_checkout_sessions_status_check
    check (status in ('preparing','initialized','paid','failed','expired')),
  add constraint billing_checkout_sessions_checkout_kind_check
    check (checkout_kind in ('legacy_subscription','installment')),
  add constraint billing_checkout_sessions_commercial_subject_check
    check (
      (
        checkout_kind='legacy_subscription'
        and command_id is null
        and commercial_order_id is null
        and installment_obligation_id is null
        and installment_schedule_id is null
        and amount is null
        and currency is null
      )
      or
      (
        checkout_kind='installment'
        and command_id is not null
        and commercial_order_id is not null
        and installment_obligation_id is not null
        and installment_schedule_id is not null
        and amount is not null and amount > 0
        and currency is not null and currency ~ '^[A-Z]{3}$'
      )
    );

alter table public.billing_checkout_sessions
  add constraint billing_checkout_sessions_commercial_order_same_tenant
    foreign key (tenant_id,commercial_order_id)
    references public.sellertray_commercial_orders(tenant_id,id)
    on delete restrict,
  add constraint billing_checkout_sessions_installment_obligation_same_tenant
    foreign key (tenant_id,installment_obligation_id)
    references public.sellertray_commercial_installment_obligations(tenant_id,id)
    on delete restrict,
  add constraint billing_checkout_sessions_installment_schedule_same_tenant
    foreign key (tenant_id,installment_schedule_id)
    references public.sellertray_commercial_installment_schedule(tenant_id,id)
    on delete restrict;

create unique index if not exists billing_checkout_sessions_installment_command_key
  on public.billing_checkout_sessions(tenant_id,command_id)
  where checkout_kind='installment' and command_id is not null;

create unique index if not exists billing_checkout_sessions_installment_active_key
  on public.billing_checkout_sessions(tenant_id,installment_schedule_id)
  where checkout_kind='installment' and status in ('preparing','initialized','paid');

create index if not exists billing_checkout_sessions_commercial_order_idx
  on public.billing_checkout_sessions(tenant_id,commercial_order_id,created_at desc)
  where checkout_kind='installment';

create table public.sellertray_commercial_branch_setup_readiness (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  commercial_order_id uuid not null,
  branch_id uuid not null,
  command_id uuid not null,
  evidence jsonb not null default '{}'::jsonb,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  reason text not null,
  ready_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,commercial_order_id,branch_id),
  unique (tenant_id,command_id),
  constraint sellertray_commercial_setup_readiness_order_same_tenant
    foreign key (tenant_id,commercial_order_id)
    references public.sellertray_commercial_orders(tenant_id,id)
    on delete restrict,
  constraint sellertray_commercial_setup_readiness_branch_same_tenant
    foreign key (tenant_id,branch_id)
    references public.branches(tenant_id,id)
    on delete restrict,
  constraint sellertray_commercial_setup_readiness_evidence_check
    check (jsonb_typeof(evidence)='object'),
  constraint sellertray_commercial_setup_readiness_reason_check
    check (char_length(btrim(reason)) between 1 and 1000),
  constraint sellertray_commercial_setup_readiness_time_check
    check (ready_at <= recorded_at + interval '5 minutes')
);

create index sellertray_commercial_setup_readiness_order_idx
  on public.sellertray_commercial_branch_setup_readiness(tenant_id,commercial_order_id,ready_at desc);
create index sellertray_commercial_setup_readiness_actor_idx
  on public.sellertray_commercial_branch_setup_readiness(actor_user_id,ready_at desc);

create table public.sellertray_commercial_installment_payment_confirmations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  commercial_order_id uuid not null,
  installment_obligation_id uuid not null,
  installment_schedule_id uuid not null,
  billing_checkout_session_id uuid not null references public.billing_checkout_sessions(id) on delete restrict,
  provider text not null,
  provider_reference text not null,
  provider_transaction_ref text,
  provider_event_fingerprint text not null,
  amount numeric(18,2) not null,
  currency text not null,
  paid_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,installment_schedule_id),
  unique (billing_checkout_session_id),
  unique (provider,provider_reference),
  unique (provider_event_fingerprint),
  constraint sellertray_commercial_installment_payments_order_same_tenant
    foreign key (tenant_id,commercial_order_id)
    references public.sellertray_commercial_orders(tenant_id,id)
    on delete restrict,
  constraint sellertray_commercial_installment_payments_obligation_same_tenant
    foreign key (tenant_id,installment_obligation_id)
    references public.sellertray_commercial_installment_obligations(tenant_id,id)
    on delete restrict,
  constraint sellertray_commercial_installment_payments_schedule_same_tenant
    foreign key (tenant_id,installment_schedule_id)
    references public.sellertray_commercial_installment_schedule(tenant_id,id)
    on delete restrict,
  constraint sellertray_commercial_installment_payments_provider_check
    check (provider ~ '^[a-z][a-z0-9_-]{0,31}$'),
  constraint sellertray_commercial_installment_payments_reference_check
    check (char_length(btrim(provider_reference)) between 1 and 160),
  constraint sellertray_commercial_installment_payments_fingerprint_check
    check (char_length(btrim(provider_event_fingerprint)) between 16 and 256),
  constraint sellertray_commercial_installment_payments_amount_check
    check (amount > 0),
  constraint sellertray_commercial_installment_payments_currency_check
    check (currency ~ '^[A-Z]{3}$'),
  constraint sellertray_commercial_installment_payments_time_check
    check (paid_at <= recorded_at + interval '5 minutes')
);

create unique index sellertray_commercial_installment_payment_transaction_key
  on public.sellertray_commercial_installment_payment_confirmations(provider,provider_transaction_ref)
  where provider_transaction_ref is not null;
create index sellertray_commercial_installment_payments_obligation_idx
  on public.sellertray_commercial_installment_payment_confirmations(
    tenant_id,installment_obligation_id,paid_at
  );

create trigger prevent_sellertray_commercial_setup_readiness_mutation
before update or delete on public.sellertray_commercial_branch_setup_readiness
for each row execute function public.prevent_sellertray_commercial_history_mutation();

create trigger prevent_sellertray_commercial_installment_payment_mutation
before update or delete on public.sellertray_commercial_installment_payment_confirmations
for each row execute function public.prevent_sellertray_commercial_history_mutation();

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
  v_plan_code text;
  v_billing_cycle text;
  v_agreement_accepted_at timestamptz;
  v_setup_required integer := 0;
  v_setup_ready integer := 0;
  v_setup_ready_at timestamptz;
  v_paid_count integer := 0;
  v_schedule_count integer := 0;
  v_first_paid_at timestamptz;
  v_provisional public.sellertray_commercial_entitlement_events%rowtype;
  v_full public.sellertray_commercial_entitlement_events%rowtype;
  v_schedule jsonb;
  v_next_schedule_id uuid;
  v_state text := 'pending';
begin
  select o.* into strict v_obligation
  from public.sellertray_commercial_installment_obligations o
  where o.tenant_id=p_tenant_id and o.id=p_installment_obligation_id;

  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.tenant_id=p_tenant_id and o.id=v_obligation.commercial_order_id;

  select s.plan_code,s.billing_cycle
    into strict v_plan_code,v_billing_cycle
  from public.sellertray_commercial_order_price_snapshots s
  where s.tenant_id=p_tenant_id
    and s.commercial_order_id=v_order.id
    and s.line_type='subscription';

  select ac.accepted_at
    into v_agreement_accepted_at
  from public.sellertray_commercial_agreements a
  join public.sellertray_commercial_agreement_acceptances ac
    on ac.tenant_id=a.tenant_id and ac.agreement_id=a.id
  where a.tenant_id=p_tenant_id
    and a.commercial_order_id=v_order.id
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

  select count(*)::integer,
         count(r.id)::integer,
         max(r.ready_at)
    into v_setup_required,v_setup_ready,v_setup_ready_at
  from public.sellertray_commercial_order_price_snapshots s
  left join public.sellertray_commercial_branch_setup_readiness r
    on r.tenant_id=s.tenant_id
   and r.commercial_order_id=s.commercial_order_id
   and r.branch_id=s.branch_id
  where s.tenant_id=p_tenant_id
    and s.commercial_order_id=v_order.id
    and s.line_type='branch_setup';

  select count(*)::integer,
         count(pc.id)::integer,
         max(pc.paid_at) filter (where sch.sequence_no=1)
    into v_schedule_count,v_paid_count,v_first_paid_at
  from public.sellertray_commercial_installment_schedule sch
  left join public.sellertray_commercial_installment_payment_confirmations pc
    on pc.tenant_id=sch.tenant_id and pc.installment_schedule_id=sch.id
  where sch.tenant_id=p_tenant_id
    and sch.installment_obligation_id=v_obligation.id;

  select e.* into v_provisional
  from public.sellertray_commercial_entitlement_events e
  where e.tenant_id=p_tenant_id
    and e.installment_obligation_id=v_obligation.id
    and e.event_type='installment.provisional_activated'
  order by e.recorded_at desc
  limit 1;

  select e.* into v_full
  from public.sellertray_commercial_entitlement_events e
  where e.tenant_id=p_tenant_id
    and e.installment_obligation_id=v_obligation.id
    and e.event_type='installment.full_entitlement_released'
  order by e.recorded_at desc
  limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',sch.id,
    'sequenceNo',sch.sequence_no,
    'percentage',sch.percentage,
    'amountDue',sch.amount_due,
    'dueAt',sch.due_at,
    'paymentStatus',case when pc.id is not null then 'paid' else 'unpaid' end,
    'dueState',case
      when pc.id is not null then 'paid'
      when sch.due_at is null then 'unscheduled'
      when sch.due_at <= now() then 'past_due'
      else 'scheduled'
    end,
    'paidAt',pc.paid_at,
    'provider',pc.provider,
    'providerReference',pc.provider_reference
  ) order by sch.sequence_no),'[]'::jsonb)
  into v_schedule
  from public.sellertray_commercial_installment_schedule sch
  left join public.sellertray_commercial_installment_payment_confirmations pc
    on pc.tenant_id=sch.tenant_id and pc.installment_schedule_id=sch.id
  where sch.tenant_id=p_tenant_id
    and sch.installment_obligation_id=v_obligation.id;

  select sch.id into v_next_schedule_id
  from public.sellertray_commercial_installment_schedule sch
  where sch.tenant_id=p_tenant_id
    and sch.installment_obligation_id=v_obligation.id
    and not exists (
      select 1 from public.sellertray_commercial_installment_payment_confirmations pc
      where pc.tenant_id=sch.tenant_id and pc.installment_schedule_id=sch.id
    )
    and not exists (
      select 1
      from public.sellertray_commercial_installment_schedule prior
      where prior.tenant_id=sch.tenant_id
        and prior.installment_obligation_id=sch.installment_obligation_id
        and prior.sequence_no<sch.sequence_no
        and not exists (
          select 1 from public.sellertray_commercial_installment_payment_confirmations prior_pc
          where prior_pc.tenant_id=prior.tenant_id
            and prior_pc.installment_schedule_id=prior.id
        )
    )
  order by sch.sequence_no
  limit 1;

  if v_full.id is not null then
    v_state := 'full';
  elsif v_provisional.id is not null then
    v_state := 'provisional';
  elsif v_agreement_accepted_at is null then
    v_state := 'pending_agreement';
  elsif v_setup_required=0 or v_setup_ready<v_setup_required then
    v_state := 'pending_setup';
  elsif v_first_paid_at is null then
    v_state := 'awaiting_first_payment';
  else
    v_state := 'ready_for_activation';
  end if;

  return jsonb_build_object(
    'tenantId',p_tenant_id,
    'commercialOrderId',v_order.id,
    'installmentObligationId',v_obligation.id,
    'structureCode',v_obligation.structure_code,
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
    'paidInstallmentCount',v_paid_count,
    'installmentCount',v_schedule_count,
    'fullyPaid',v_schedule_count>0 and v_paid_count=v_schedule_count,
    'firstPaidAt',v_first_paid_at,
    'entitlementState',v_state,
    'activationAt',coalesce(v_provisional.effective_from,v_full.effective_from),
    'provisionalUntil',v_provisional.effective_until,
    'fullTermUntil',v_full.effective_until,
    'nextPayableScheduleId',v_next_schedule_id,
    'schedule',v_schedule,
    'dueEnforcementMode','informational_only'
  );
end;
$$;

revoke all on function public.get_sellertray_installment_billing_state(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.get_sellertray_installment_billing_state(uuid,uuid)
  to service_role;

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
  v_subscription public.tenant_subscriptions%rowtype;
  v_plan_code text;
  v_billing_cycle text;
  v_agreement_accepted_at timestamptz;
  v_setup_required integer := 0;
  v_setup_ready integer := 0;
  v_setup_ready_at timestamptz;
  v_schedule_count integer := 0;
  v_paid_count integer := 0;
  v_first_paid_at timestamptz;
  v_activation_at timestamptz;
  v_provisional_months integer;
  v_provisional_until timestamptz;
  v_full_until timestamptz;
  v_provisional_id uuid;
  v_full_id uuid;
  v_existing_provisional public.sellertray_commercial_entitlement_events%rowtype;
  v_runtime_owned boolean := false;
begin
  select o.* into strict v_obligation
  from public.sellertray_commercial_installment_obligations o
  where o.tenant_id=p_tenant_id and o.id=p_installment_obligation_id;

  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.tenant_id=p_tenant_id and o.id=v_obligation.commercial_order_id;

  select s.plan_code,s.billing_cycle
    into strict v_plan_code,v_billing_cycle
  from public.sellertray_commercial_order_price_snapshots s
  where s.tenant_id=p_tenant_id
    and s.commercial_order_id=v_order.id
    and s.line_type='subscription';

  if v_billing_cycle<>'yearly' then
    raise exception 'SellerTray installments require an annual subscription purchase'
      using errcode='23514';
  end if;

  select e.* into v_existing_provisional
  from public.sellertray_commercial_entitlement_events e
  where e.tenant_id=p_tenant_id
    and e.installment_obligation_id=v_obligation.id
    and e.event_type='installment.provisional_activated'
  order by e.recorded_at desc
  limit 1;

  select ac.accepted_at
    into v_agreement_accepted_at
  from public.sellertray_commercial_agreements a
  join public.sellertray_commercial_agreement_acceptances ac
    on ac.tenant_id=a.tenant_id and ac.agreement_id=a.id
  where a.tenant_id=p_tenant_id
    and a.commercial_order_id=v_order.id
    and a.installment_obligation_id=v_obligation.id
    and a.agreement_family='installment_agreement'
    and not exists (
      select 1 from public.sellertray_commercial_agreements replacement
      where replacement.tenant_id=a.tenant_id
        and replacement.supersedes_agreement_id=a.id
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

  select count(*)::integer,count(pc.id)::integer,
         max(pc.paid_at) filter (where sch.sequence_no=1)
    into v_schedule_count,v_paid_count,v_first_paid_at
  from public.sellertray_commercial_installment_schedule sch
  left join public.sellertray_commercial_installment_payment_confirmations pc
    on pc.tenant_id=sch.tenant_id and pc.installment_schedule_id=sch.id
  where sch.tenant_id=p_tenant_id
    and sch.installment_obligation_id=v_obligation.id;

  -- Missing prerequisites are ordinary commercial states, not errors. This lets
  -- agreement, setup and payment facts commit independently and in any order.
  if v_agreement_accepted_at is null
     or v_setup_required=0
     or v_setup_ready<v_setup_required
     or v_first_paid_at is null then
    return public.get_sellertray_installment_billing_state(
      p_tenant_id,p_installment_obligation_id
    );
  end if;

  if v_existing_provisional.id is not null then
    v_activation_at := v_existing_provisional.effective_from;
  else
    v_activation_at := greatest(v_agreement_accepted_at,v_setup_ready_at,v_first_paid_at);
  end if;

  if v_obligation.structure_code='two_installment_70_30' then
    v_provisional_months := 2;
  elsif v_obligation.structure_code='three_installment_60_20_20' then
    v_provisional_months := 3;
  else
    raise exception 'Unsupported SellerTray installment structure' using errcode='23514';
  end if;

  v_provisional_until := v_activation_at + make_interval(months=>v_provisional_months);
  v_full_until := v_activation_at + interval '12 months';

  v_provisional_id := public.append_sellertray_commercial_entitlement_event(
    p_tenant_id,v_plan_code,v_order.id,v_obligation.id,
    'installment.provisional_activated',
    'c1b:provisional:'||v_obligation.id::text,
    v_activation_at,v_provisional_until,
    jsonb_build_object(
      'structure_code',v_obligation.structure_code,
      'provisional_months',v_provisional_months,
      'activation_at',v_activation_at,
      'full_term_until',v_full_until
    ),
    null,
    'Governed C1B installment provisional entitlement'
  );

  if v_schedule_count>0 and v_paid_count=v_schedule_count then
    v_full_id := public.append_sellertray_commercial_entitlement_event(
      p_tenant_id,v_plan_code,v_order.id,v_obligation.id,
      'installment.full_entitlement_released',
      'c1b:full:'||v_obligation.id::text,
      v_activation_at,v_full_until,
      jsonb_build_object(
        'structure_code',v_obligation.structure_code,
        'term_months',12,
        'activation_at',v_activation_at,
        'released_after_installments',v_schedule_count
      ),
      null,
      'Governed C1B full-settlement entitlement release'
    );
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
        and e.event_type in (
          'installment.provisional_activated',
          'installment.full_entitlement_released'
        )
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
      current_period_end=case when v_full_id is null then v_provisional_until else v_full_until end,
      grace_ends_at=null,
      cancel_at_period_end=false,
      updated_at=now()
  where tenant_id=p_tenant_id;

  return public.get_sellertray_installment_billing_state(
    p_tenant_id,p_installment_obligation_id
  );
end;
$$;

revoke all on function public.reconcile_sellertray_installment_entitlement(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.reconcile_sellertray_installment_entitlement(uuid,uuid)
  to service_role;

create or replace function public.reconcile_sellertray_installment_entitlements_for_tenant(
  p_tenant_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_obligation record;
  v_results jsonb := '[]'::jsonb;
begin
  for v_obligation in
    select o.id
    from public.sellertray_commercial_installment_obligations o
    where o.tenant_id=p_tenant_id
    order by o.created_at,o.id
  loop
    v_results := v_results || jsonb_build_array(
      public.reconcile_sellertray_installment_entitlement(p_tenant_id,v_obligation.id)
    );
  end loop;
  return v_results;
end;
$$;

revoke all on function public.reconcile_sellertray_installment_entitlements_for_tenant(uuid)
  from public,anon,authenticated;
grant execute on function public.reconcile_sellertray_installment_entitlements_for_tenant(uuid)
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
  v_billing_cycle text;
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
  if v_role<>'owner' then
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

  select s.plan_code,s.billing_cycle
    into strict v_plan_code,v_billing_cycle
  from public.sellertray_commercial_order_price_snapshots s
  where s.tenant_id=p_tenant_id
    and s.commercial_order_id=v_order.id
    and s.line_type='subscription';

  if v_billing_cycle<>'yearly' then
    raise exception 'SellerTray installments are available only for annual first purchases'
      using errcode='23514';
  end if;

  if exists (
    select 1
    from public.sellertray_commercial_installment_schedule prior
    where prior.tenant_id=p_tenant_id
      and prior.installment_obligation_id=v_obligation.id
      and prior.sequence_no<v_schedule.sequence_no
      and not exists (
        select 1 from public.sellertray_commercial_installment_payment_confirmations pc
        where pc.tenant_id=p_tenant_id and pc.installment_schedule_id=prior.id
      )
  ) then
    raise exception 'Earlier SellerTray installments must be confirmed first' using errcode='23514';
  end if;

  if exists (
    select 1 from public.sellertray_commercial_installment_payment_confirmations pc
    where pc.tenant_id=p_tenant_id and pc.installment_schedule_id=v_schedule.id
  ) then
    return jsonb_build_object(
      'status','paid',
      'installmentScheduleId',v_schedule.id,
      'amount',v_schedule.amount_due,
      'currency',v_obligation.currency,
      'planCode',v_plan_code,
      'needsProviderInitialization',false
    );
  end if;

  select s.* into v_existing
  from public.billing_checkout_sessions s
  where s.tenant_id=p_tenant_id
    and s.checkout_kind='installment'
    and s.command_id=p_command_id;

  if found then
    if v_existing.installment_schedule_id<>v_schedule.id
       or v_existing.requested_by_user_id<>p_actor_user_id
       or lower(v_existing.billing_email)<>v_email then
      raise exception 'Installment checkout command is already used for different facts'
        using errcode='23505';
    end if;
    return jsonb_build_object(
      'sessionId',v_existing.id,
      'status',v_existing.status,
      'reference',v_existing.reference,
      'authorizationUrl',v_existing.authorization_url,
      'installmentScheduleId',v_existing.installment_schedule_id,
      'amount',v_existing.amount,
      'currency',v_existing.currency,
      'planCode',v_existing.plan_code,
      'needsProviderInitialization',v_existing.status='preparing' and v_existing.authorization_url is null
    );
  end if;

  select s.* into v_existing
  from public.billing_checkout_sessions s
  where s.tenant_id=p_tenant_id
    and s.checkout_kind='installment'
    and s.installment_schedule_id=v_schedule.id
    and s.status in ('preparing','initialized','paid')
  order by s.created_at desc
  limit 1;

  if found then
    return jsonb_build_object(
      'sessionId',v_existing.id,
      'status',v_existing.status,
      'reference',v_existing.reference,
      'authorizationUrl',v_existing.authorization_url,
      'installmentScheduleId',v_existing.installment_schedule_id,
      'amount',v_existing.amount,
      'currency',v_existing.currency,
      'planCode',v_existing.plan_code,
      'needsProviderInitialization',false
    );
  end if;

  v_reference := 'sti-'||substr(replace(p_tenant_id::text,'-',''),1,8)||'-'||replace(p_command_id::text,'-','');

  insert into public.billing_checkout_sessions(
    tenant_id,plan_code,requested_by_user_id,billing_email,provider,reference,
    status,checkout_kind,command_id,commercial_order_id,installment_obligation_id,
    installment_schedule_id,amount,currency,created_at,updated_at
  ) values (
    p_tenant_id,v_plan_code,p_actor_user_id,v_email,'paystack',v_reference,
    'preparing','installment',p_command_id,v_order.id,v_obligation.id,
    v_schedule.id,v_schedule.amount_due,v_obligation.currency,now(),now()
  )
  returning * into v_session;

  return jsonb_build_object(
    'sessionId',v_session.id,
    'status',v_session.status,
    'reference',v_session.reference,
    'authorizationUrl',v_session.authorization_url,
    'installmentScheduleId',v_session.installment_schedule_id,
    'amount',v_session.amount,
    'currency',v_session.currency,
    'planCode',v_session.plan_code,
    'needsProviderInitialization',true
  );
end;
$$;

revoke all on function public.reserve_sellertray_installment_checkout(uuid,uuid,uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.reserve_sellertray_installment_checkout(uuid,uuid,uuid,uuid,text)
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
  where s.id=p_session_id and s.checkout_kind='installment'
  for update;

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
    update public.billing_checkout_sessions
    set authorization_url=v_url,status='initialized',updated_at=now()
    where id=v_session.id;
  else
    raise exception 'Installment checkout cannot be initialized from its current state'
      using errcode='23514';
  end if;

  return jsonb_build_object(
    'sessionId',v_session.id,
    'reference',v_session.reference,
    'authorizationUrl',v_url,
    'status','initialized'
  );
end;
$$;

revoke all on function public.complete_sellertray_installment_checkout_initialization(uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.complete_sellertray_installment_checkout_initialization(uuid,text,text)
  to service_role;

create or replace function public.fail_sellertray_installment_checkout_initialization(
  p_session_id uuid
)
returns void
language plpgsql
security invoker
set search_path=''
as $$
begin
  update public.billing_checkout_sessions
  set status='failed',updated_at=now()
  where id=p_session_id
    and checkout_kind='installment'
    and status='preparing';
end;
$$;

revoke all on function public.fail_sellertray_installment_checkout_initialization(uuid)
  from public,anon,authenticated;
grant execute on function public.fail_sellertray_installment_checkout_initialization(uuid)
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
security invoker
set search_path=''
as $$
declare
  v_session public.billing_checkout_sessions%rowtype;
  v_schedule public.sellertray_commercial_installment_schedule%rowtype;
  v_existing public.sellertray_commercial_installment_payment_confirmations%rowtype;
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

  if v_session.provider_reference is not null then
    null;
  end if;
  if v_provider_reference<>v_session.reference
     or v_currency<>v_session.currency
     or abs(p_amount-v_session.amount)>=0.005 then
    raise exception 'Confirmed installment payment does not match the reserved amount, currency and reference'
      using errcode='23514';
  end if;
  if char_length(v_fingerprint) not between 16 and 256 then
    raise exception 'Verified provider event fingerprint is required' using errcode='22023';
  end if;

  select sch.* into strict v_schedule
  from public.sellertray_commercial_installment_schedule sch
  where sch.tenant_id=v_session.tenant_id and sch.id=v_session.installment_schedule_id;

  if abs(v_schedule.amount_due-v_session.amount)>=0.005 then
    raise exception 'Reserved installment amount no longer matches the immutable schedule'
      using errcode='23514';
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
  v_role text;
  v_evidence jsonb := coalesce(p_evidence,'{}'::jsonb);
  v_reason text := btrim(coalesce(p_reason,''));
  v_existing public.sellertray_commercial_branch_setup_readiness%rowtype;
  v_id uuid;
begin
  if p_tenant_id is null or p_commercial_order_id is null or p_branch_id is null
     or p_command_id is null or p_ready_at is null or p_actor_user_id is null then
    raise exception 'Business, commercial order, Branch, command, setup time and actor are required'
      using errcode='22023';
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

  select pa.role into v_role
  from public.platform_admins pa
  where pa.user_id=p_actor_user_id;
  if v_role<>'admin' then
    raise exception 'Platform administrator access required' using errcode='42501';
  end if;

  if not exists (
    select 1
    from public.sellertray_commercial_order_price_snapshots s
    where s.tenant_id=p_tenant_id
      and s.commercial_order_id=p_commercial_order_id
      and s.line_type='branch_setup'
      and s.branch_id=p_branch_id
  ) then
    raise exception 'Branch is not part of this governed SellerTray setup purchase'
      using errcode='23514';
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

  if v_id is not null then
    return v_id;
  end if;

  select r.* into v_existing
  from public.sellertray_commercial_branch_setup_readiness r
  where r.tenant_id=p_tenant_id and r.command_id=p_command_id;

  if not found then
    select r.* into strict v_existing
    from public.sellertray_commercial_branch_setup_readiness r
    where r.tenant_id=p_tenant_id
      and r.commercial_order_id=p_commercial_order_id
      and r.branch_id=p_branch_id;
  end if;

  if v_existing.commercial_order_id<>p_commercial_order_id
     or v_existing.branch_id<>p_branch_id
     or v_existing.evidence is distinct from v_evidence
     or v_existing.actor_user_id<>p_actor_user_id
     or v_existing.reason<>v_reason
     or v_existing.ready_at<>p_ready_at then
    raise exception 'SellerTray setup readiness is already recorded with different facts'
      using errcode='23505';
  end if;

  return v_existing.id;
end;
$$;

revoke all on function public.mark_sellertray_commercial_branch_setup_ready(uuid,uuid,uuid,uuid,jsonb,text,timestamptz,uuid)
  from public,anon,authenticated;
grant execute on function public.mark_sellertray_commercial_branch_setup_ready(uuid,uuid,uuid,uuid,jsonb,text,timestamptz,uuid)
  to service_role;

alter table public.sellertray_commercial_branch_setup_readiness enable row level security;
alter table public.sellertray_commercial_installment_payment_confirmations enable row level security;

revoke all on table public.sellertray_commercial_branch_setup_readiness from public,anon,authenticated;
revoke all on table public.sellertray_commercial_installment_payment_confirmations from public,anon,authenticated;
grant all on table public.sellertray_commercial_branch_setup_readiness to service_role;
grant all on table public.sellertray_commercial_installment_payment_confirmations to service_role;

commit;
