begin;

-- Final C1B payment-confirmation definition. Keep the payment fact independent
-- from entitlement reconciliation, but only accept a provider-confirmed payment
-- for an active installment checkout reservation.

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
