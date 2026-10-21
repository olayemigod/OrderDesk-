begin;

-- SellerTray installments are approved only for the initial annual purchase.
-- Enforce qualification and exact commercial subject at the shared checkout
-- persistence boundary so no service caller or future channel can bypass the
-- governed reservation authority with mismatched order/payment facts.
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
  v_billing_cycle text;
  v_subscription_status text;
  v_same_order_runtime_owned boolean := false;
  v_expected_reference text;
begin
  if new.checkout_kind is distinct from 'installment' then
    return new;
  end if;

  if new.tenant_id is null
     or new.command_id is null
     or new.commercial_order_id is null
     or new.installment_obligation_id is null
     or new.installment_schedule_id is null
     or new.amount is null
     or new.currency is null then
    raise exception 'Installment checkout requires governed commercial order, obligation, schedule and money identity'
      using errcode='23514';
  end if;

  if new.provider<>'paystack'
     or new.status<>'preparing'
     or new.authorization_url is not null
     or new.provider_customer_ref is not null
     or new.provider_subscription_ref is not null then
    raise exception 'Installment checkout must begin as an uninitialized Paystack reservation'
      using errcode='23514';
  end if;

  if not exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id=new.tenant_id
      and tm.user_id=new.requested_by_user_id
      and tm.role='owner'
  ) then
    raise exception 'Only the business Owner can create an installment checkout reservation'
      using errcode='42501';
  end if;

  v_expected_reference := 'sti-'
    ||substr(replace(new.tenant_id::text,'-',''),1,8)
    ||'-'||replace(new.command_id::text,'-','');
  if new.reference<>v_expected_reference then
    raise exception 'Installment checkout reference must match the governed command identity'
      using errcode='23514';
  end if;

  select o.* into v_order
  from public.sellertray_commercial_orders o
  where o.tenant_id=new.tenant_id and o.id=new.commercial_order_id;
  if not found then
    raise exception 'Installment checkout commercial order is not governed for this Business'
      using errcode='23514';
  end if;

  select o.* into v_obligation
  from public.sellertray_commercial_installment_obligations o
  where o.tenant_id=new.tenant_id
    and o.id=new.installment_obligation_id
    and o.commercial_order_id=v_order.id;
  if not found then
    raise exception 'Installment checkout obligation does not belong to the governed commercial order'
      using errcode='23514';
  end if;

  select s.* into v_schedule
  from public.sellertray_commercial_installment_schedule s
  where s.tenant_id=new.tenant_id
    and s.id=new.installment_schedule_id
    and s.installment_obligation_id=v_obligation.id;
  if not found then
    raise exception 'Installment checkout schedule does not belong to the governed commercial obligation'
      using errcode='23514';
  end if;

  select s.plan_code,s.billing_cycle into v_plan_code,v_billing_cycle
  from public.sellertray_commercial_order_price_snapshots s
  where s.tenant_id=new.tenant_id
    and s.commercial_order_id=v_order.id
    and s.line_type='subscription';
  if not found then
    raise exception 'Installment checkout requires a governed subscription purchase line'
      using errcode='23514';
  end if;

  if v_billing_cycle<>'yearly' then
    raise exception 'SellerTray installments are available only for the initial annual purchase'
      using errcode='23514';
  end if;

  if new.plan_code is distinct from v_plan_code
     or new.currency is distinct from v_obligation.currency
     or abs(new.amount-v_schedule.amount_due)>=0.005 then
    raise exception 'Installment checkout plan, amount and currency must match the immutable commercial schedule'
      using errcode='23514';
  end if;

  -- Any other subscription order at or before this order means this order cannot
  -- be proven to be the initial purchase. Equal timestamps are deliberately
  -- treated as ambiguous and fail closed rather than inventing ordering by UUID.
  if exists (
    select 1
    from public.sellertray_commercial_orders prior_order
    join public.sellertray_commercial_order_price_snapshots prior_line
      on prior_line.tenant_id=prior_order.tenant_id
     and prior_line.commercial_order_id=prior_order.id
     and prior_line.line_type='subscription'
    where prior_order.tenant_id=new.tenant_id
      and prior_order.id<>v_order.id
      and prior_order.ordered_at<=v_order.ordered_at
  ) then
    raise exception 'SellerTray installments are available only for the initial annual purchase'
      using errcode='23514';
  end if;

  select s.status into v_subscription_status
  from public.tenant_subscriptions s
  where s.tenant_id=new.tenant_id;

  if not found then
    raise exception 'SellerTray runtime subscription record is required for installment checkout'
      using errcode='23514';
  end if;

  if v_subscription_status='trial' then
    return new;
  end if;

  -- After the first installment is reconciled, the compatibility subscription
  -- becomes active. Later schedule lines on that SAME initial order remain
  -- eligible only when C1B entitlement history proves this order owns runtime.
  select exists (
    select 1
    from public.sellertray_commercial_entitlement_events e
    where e.tenant_id=new.tenant_id
      and e.commercial_order_id=v_order.id
      and e.event_type in (
        'installment.provisional_activated',
        'installment.full_entitlement_released'
      )
  ) into v_same_order_runtime_owned;

  if not v_same_order_runtime_owned then
    raise exception 'SellerTray installments are available only for the initial annual purchase'
      using errcode='23514';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_sellertray_initial_purchase_installment_checkout()
  from public,anon,authenticated;

drop trigger if exists guard_sellertray_initial_purchase_installment_checkout
  on public.billing_checkout_sessions;
create trigger guard_sellertray_initial_purchase_installment_checkout
before insert on public.billing_checkout_sessions
for each row execute function public.guard_sellertray_initial_purchase_installment_checkout();

commit;
