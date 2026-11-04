begin;

-- Forward-only Commercial V2 checkout trigger dispatch: native Branch
-- reservations do not have the legacy C1 'subscription' line. Preserve the
-- exact original OA2 C1 guard below its new Branch-only dispatch.
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
  v_plan_profile_version_id uuid;
  v_payment_method_version_id uuid;
  v_order_form_id uuid;
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
  -- C2 Branch payment reservations have a separate immutable Branch price
  -- line and Branch-specific settlement projection. Never dispatch them into
  -- the legacy single-subscription C1 lookup below.
  if v_obligation.obligation_scope='branch_subscription' then
    if v_order.order_kind<>'branch_commercial_v2'
       or v_obligation.branch_id is null
       or new.plan_code is not null
       or new.plan_profile_version_id is null
       or new.commercial_payment_method_version_id is null then
      raise exception 'Native Branch checkout requires a governed Branch plan and payment method'
        using errcode='23514';
    end if;

    select s.plan_profile_version_id into strict v_plan_profile_version_id
    from public.sellertray_commercial_order_price_snapshots s
    where s.tenant_id=new.tenant_id
      and s.commercial_order_id=v_order.id
      and s.id=v_obligation.commercial_order_line_id
      and s.branch_id=v_obligation.branch_id
      and s.line_type='branch_subscription';
    if new.plan_profile_version_id is distinct from v_plan_profile_version_id then
      raise exception 'Branch checkout plan must match the immutable commercial order line'
        using errcode='23514';
    end if;

    -- Re-check the most recent method first, never a historical Paystack
    -- selection. This also protects direct service-role session inserts.
    select latest.payment_method_version_id into v_payment_method_version_id
    from (
      select sel.payment_method_version_id
      from public.sellertray_commercial_payment_method_selections sel
      where sel.tenant_id=new.tenant_id
        and sel.installment_obligation_id=v_obligation.id
      order by sel.selected_at desc,sel.created_at desc,sel.id desc limit 1
    ) latest
    join public.sellertray_commercial_payment_method_versions mv
      on mv.id=latest.payment_method_version_id
    join public.sellertray_commercial_payment_methods m
      on m.id=mv.payment_method_id
    where m.status='active' and m.code='paystack'
      and mv.method_type='paystack' and mv.confirmation_mode='automatic'
      and mv.effective_from<=now()
      and (mv.effective_until is null or mv.effective_until>now());
    if new.commercial_payment_method_version_id is distinct from v_payment_method_version_id
       or v_payment_method_version_id is null then
      raise exception 'Branch checkout must use the currently selected automatic Paystack method'
        using errcode='23514';
    end if;

    select f.id into v_order_form_id
    from public.sellertray_commercial_order_forms f
    join public.sellertray_order_form_confirmations c
      on c.tenant_id=f.tenant_id and c.order_form_id=f.id
    join public.sellertray_master_agreement_acceptances a
      on a.tenant_id=f.tenant_id and a.agreement_version_id=f.required_master_agreement_version_id
    where f.tenant_id=new.tenant_id
      and f.commercial_order_id=v_order.id
      and f.required_master_agreement_version_id is not null
      and not exists(
        select 1 from public.sellertray_commercial_order_forms replacement
        where replacement.tenant_id=f.tenant_id and replacement.supersedes_order_form_id=f.id
      )
    order by f.issued_at desc,f.id desc limit 1;
    if v_order_form_id is null then
      raise exception 'Confirm the Branch Order Form and its accepted Master Agreement before payment'
        using errcode='23514';
    end if;

    v_settlement:=public.get_sellertray_commercial_obligation_settlement_state(
      new.tenant_id,v_obligation.id
    );
    v_next_schedule_id:=nullif(v_settlement->>'nextInstallmentScheduleId','')::uuid;
    v_next_amount:=coalesce((v_settlement->>'nextPayableAmount')::numeric,0);
    if v_next_schedule_id is null or v_next_amount<0.005 then
      raise exception 'Branch commercial obligation is already settled' using errcode='23514';
    end if;
    if new.installment_schedule_id is distinct from v_next_schedule_id
       or new.currency is distinct from v_obligation.currency
       or abs(new.amount-v_next_amount)>=0.005 then
      raise exception 'Branch checkout must match its current payable installment and currency'
        using errcode='23514';
    end if;
    return new;
  elsif v_obligation.obligation_scope<>'commercial_order' then
    raise exception 'Unsupported installment checkout obligation scope' using errcode='23514';
  end if;

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

comment on function public.guard_sellertray_initial_purchase_installment_checkout() is
  'Retains OA2 C1 subscription checkout invariants and independently validates native C2 Branch payable schedule, latest selected Paystack method, confirmed Order Form and pinned Master acceptance.';

commit;
