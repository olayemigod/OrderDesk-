begin;

create or replace function public.capture_sellertray_shift_cash_sale()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order public.orders%rowtype;
  v_shift public.sellertray_cash_shifts%rowtype;
begin
  if new.status<>'confirmed' or new.method_type<>'cash' or new.provider<>'pos_cash'
     or new.confirmed_by_user_id is null then
    return new;
  end if;
  if tg_op='UPDATE' and old.status='confirmed' then
    return new;
  end if;

  select * into v_order
  from public.orders o
  where o.tenant_id=new.tenant_id and o.id=new.order_id;

  if not found or v_order.source<>'pos' or v_order.branch_id is null then
    raise exception 'Counter cash payment is not attached to a valid POS Branch'
      using errcode='23514';
  end if;

  if not public.sellertray_user_can_operate_branch(
    new.tenant_id,v_order.branch_id,new.confirmed_by_user_id
  ) then
    raise exception 'You do not have access to take cash payments in this Branch'
      using errcode='42501';
  end if;

  select * into v_shift
  from public.sellertray_cash_shifts s
  where s.tenant_id=new.tenant_id
    and s.branch_id=v_order.branch_id
    and s.opened_by_user_id=new.confirmed_by_user_id
    and s.status='open'
  order by s.opened_at desc,s.id
  limit 1
  for update;

  if not found then
    raise exception 'Open a cashier shift in this Branch before taking counter cash payments'
      using errcode='23514';
  end if;

  if v_shift.currency<>new.currency then
    raise exception 'Cash sale currency does not match the open cashier shift'
      using errcode='23514';
  end if;

  insert into public.sellertray_shift_cash_sales(
    tenant_id,branch_id,register_id,shift_id,order_id,payment_id,
    amount,currency,actor_user_id,business_at
  ) values(
    new.tenant_id,v_order.branch_id,v_shift.register_id,v_shift.id,new.order_id,new.id,
    new.amount,new.currency,new.confirmed_by_user_id,coalesce(new.confirmed_at,now())
  ) on conflict(tenant_id,payment_id) do nothing;

  return new;
end;
$$;

revoke all on function public.capture_sellertray_shift_cash_sale()
  from public,anon,authenticated;

create or replace function public.capture_sellertray_shift_cash_refund()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_branch_id uuid;
  v_shift public.sellertray_cash_shifts%rowtype;
  v_available_cash numeric(18,2);
begin
  if new.status<>'confirmed' or new.method_type<>'cash' or new.provider<>'pos_cash'
     or new.actor_user_id is null then
    return new;
  end if;

  select sr.branch_id into v_branch_id
  from public.sale_returns sr
  where sr.tenant_id=new.tenant_id and sr.id=new.sale_return_id;

  if v_branch_id is null then
    raise exception 'Cash refund is not attached to a valid POS return'
      using errcode='23514';
  end if;

  if not public.sellertray_user_can_operate_branch(
    new.tenant_id,v_branch_id,new.actor_user_id
  ) then
    raise exception 'You do not have access to pay cash refunds in this Branch'
      using errcode='42501';
  end if;

  select * into v_shift
  from public.sellertray_cash_shifts s
  where s.tenant_id=new.tenant_id
    and s.branch_id=v_branch_id
    and s.opened_by_user_id=new.actor_user_id
    and s.status='open'
  order by s.opened_at desc,s.id
  limit 1
  for update;

  if not found then
    raise exception 'Open a cashier shift in this Branch before paying a cash refund'
      using errcode='23514';
  end if;

  if v_shift.currency<>new.currency then
    raise exception 'Cash refund currency does not match the open cashier shift'
      using errcode='23514';
  end if;

  select t.expected_cash into v_available_cash
  from public.sellertray_cash_shift_totals(new.tenant_id,v_shift.id) t;

  if coalesce(v_available_cash,0)<new.amount then
    raise exception 'Cash refund cannot take expected drawer cash below zero'
      using errcode='23514';
  end if;

  insert into public.sellertray_shift_cash_refunds(
    tenant_id,branch_id,register_id,shift_id,refund_id,amount,currency,
    actor_user_id,business_at
  ) values(
    new.tenant_id,v_branch_id,v_shift.register_id,v_shift.id,new.id,new.amount,new.currency,
    new.actor_user_id,new.created_at
  ) on conflict(tenant_id,refund_id) do nothing;

  return new;
end;
$$;

revoke all on function public.capture_sellertray_shift_cash_refund()
  from public,anon,authenticated;

commit;
