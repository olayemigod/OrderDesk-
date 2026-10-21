begin;

-- Preserve one governed Paystack reference across ambiguous/crashed installment
-- initialization. A provider attempt is leased before the outbound request so a
-- retry cannot accidentally re-initialize the same reference and then retire a
-- real in-flight provider transaction as a duplicate-reference failure.
alter table public.billing_checkout_sessions
  add column if not exists provider_initialization_started_at timestamptz;

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
  where s.id=p_session_id and s.checkout_kind='installment'
  for update;

  if v_session.status='initialized' and v_session.authorization_url is not null then
    return jsonb_build_object(
      'started',false,
      'status','initialized',
      'reference',v_session.reference,
      'authorizationUrl',v_session.authorization_url,
      'startedAt',v_session.provider_initialization_started_at
    );
  end if;

  if v_session.status='failed' then
    return jsonb_build_object(
      'started',false,
      'status','failed',
      'reference',v_session.reference,
      'authorizationUrl',v_session.authorization_url,
      'startedAt',v_session.provider_initialization_started_at
    );
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
    return jsonb_build_object(
      'started',false,
      'status','in_progress',
      'reference',v_session.reference,
      'authorizationUrl',null,
      'startedAt',v_session.provider_initialization_started_at
    );
  end if;

  update public.billing_checkout_sessions
  set provider_initialization_started_at=now(),updated_at=now()
  where id=v_session.id
  returning * into v_session;

  return jsonb_build_object(
    'started',true,
    'status','in_progress',
    'reference',v_session.reference,
    'authorizationUrl',null,
    'startedAt',v_session.provider_initialization_started_at
  );
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
declare
  v_session public.billing_checkout_sessions%rowtype;
begin
  if p_session_id is null then
    raise exception 'Installment checkout session is required' using errcode='22023';
  end if;

  select s.* into strict v_session
  from public.billing_checkout_sessions s
  where s.id=p_session_id and s.checkout_kind='installment'
  for update;

  if v_session.status='failed' then
    return;
  end if;

  if v_session.status<>'preparing' then
    raise exception 'Installment checkout cannot fail provider initialization from its current state'
      using errcode='23514';
  end if;

  if v_session.provider_initialization_started_at is null then
    raise exception 'Installment checkout provider initialization was not begun'
      using errcode='23514';
  end if;

  update public.billing_checkout_sessions
  set status='failed',updated_at=now()
  where id=v_session.id;
end;
$$;

revoke all on function public.fail_sellertray_installment_checkout_initialization(uuid)
  from public,anon,authenticated;
grant execute on function public.fail_sellertray_installment_checkout_initialization(uuid)
  to service_role;

-- A signed provider event may legitimately arrive while the leased checkout is
-- still `preparing` if the Edge Function lost the initialization response. Keep
-- that path confirmable, but reject any reservation that never began a provider
-- attempt at all.
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

  if v_session.status not in ('preparing','initialized','paid') then
    raise exception 'Installment checkout cannot be confirmed from its current state'
      using errcode='23514';
  end if;
  if v_session.provider_initialization_started_at is null then
    raise exception 'Installment checkout provider initialization was not begun'
      using errcode='23514';
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
    select 1
    from public.sellertray_commercial_installment_payment_confirmations pc
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
