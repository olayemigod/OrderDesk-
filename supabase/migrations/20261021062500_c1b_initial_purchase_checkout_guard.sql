begin;

-- SellerTray installments are approved only for the initial annual purchase.
-- Enforce that qualification at the shared checkout persistence boundary so
-- Merchant Web, Admin/service callers and any future channel cannot create a
-- renewal/legacy installment session by bypassing the governed reservation RPC.
create or replace function public.guard_sellertray_initial_purchase_installment_checkout()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_order public.sellertray_commercial_orders%rowtype;
  v_billing_cycle text;
  v_subscription_status text;
  v_same_order_runtime_owned boolean := false;
begin
  if new.checkout_kind is distinct from 'installment' then
    return new;
  end if;

  if new.tenant_id is null
     or new.commercial_order_id is null
     or new.installment_obligation_id is null
     or new.installment_schedule_id is null then
    raise exception 'Installment checkout requires governed commercial order, obligation and schedule identity'
      using errcode='23514';
  end if;

  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.tenant_id=new.tenant_id and o.id=new.commercial_order_id;

  select s.billing_cycle into strict v_billing_cycle
  from public.sellertray_commercial_order_price_snapshots s
  where s.tenant_id=new.tenant_id
    and s.commercial_order_id=v_order.id
    and s.line_type='subscription';

  if v_billing_cycle<>'yearly' then
    raise exception 'SellerTray installments are available only for the initial annual purchase'
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
