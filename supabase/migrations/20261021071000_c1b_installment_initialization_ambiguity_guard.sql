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

commit;
