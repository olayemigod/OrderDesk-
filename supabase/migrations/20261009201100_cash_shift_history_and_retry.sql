begin;

create or replace function public.open_sellertray_cash_shift(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_register_id uuid,
  p_opening_cash numeric,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_shift public.sellertray_cash_shifts%rowtype;
  v_shift_id uuid;
  v_currency text;
begin
  if p_tenant_id is null or p_branch_id is null or p_register_id is null
     or p_actor_user_id is null or p_opening_cash is null or p_opening_cash<0 then
    raise exception 'Business, branch, register, operator and opening cash are required'
      using errcode='22023';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;
  if not public.sellertray_user_can_operate_branch(p_tenant_id,p_branch_id,p_actor_user_id) then
    raise exception 'You do not have access to open a shift in this branch' using errcode='42501';
  end if;
  if not public.sellertray_user_has_capability(p_tenant_id,p_actor_user_id,'can_open_shift') then
    raise exception 'You do not have permission to open a cashier shift' using errcode='42501';
  end if;

  if not exists(
    select 1 from public.sellertray_registers r
    where r.tenant_id=p_tenant_id and r.branch_id=p_branch_id
      and r.id=p_register_id and r.is_active=true
  ) then
    raise exception 'Selected register is unavailable for this branch' using errcode='23514';
  end if;

  select t.currency into v_currency
  from public.tenants t where t.id=p_tenant_id;
  if v_currency is null then
    raise exception 'Business not found' using errcode='22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_tenant_id::text||':cash-shift:'||p_register_id::text,0)
  );

  select * into v_shift
  from public.sellertray_cash_shifts s
  where s.tenant_id=p_tenant_id
    and s.opened_by_user_id=p_actor_user_id
    and s.status='open'
  order by s.opened_at desc,s.id
  limit 1;

  if found then
    if v_shift.branch_id=p_branch_id
       and v_shift.register_id=p_register_id
       and v_shift.currency=v_currency
       and v_shift.opening_cash=round(p_opening_cash::numeric,2) then
      return jsonb_build_object(
        'shiftId',v_shift.id,'status','open','branchId',v_shift.branch_id,
        'registerId',v_shift.register_id,'currency',v_shift.currency,
        'openingCash',v_shift.opening_cash,
        'expectedCash',(select t.expected_cash from public.sellertray_cash_shift_totals(p_tenant_id,v_shift.id) t),
        'idempotentReplay',true
      );
    end if;
    raise exception 'You already have an open cashier shift' using errcode='23514';
  end if;

  if exists(
    select 1 from public.sellertray_cash_shifts s
    where s.tenant_id=p_tenant_id and s.register_id=p_register_id and s.status='open'
  ) then
    raise exception 'This register already has an open shift' using errcode='23514';
  end if;

  insert into public.sellertray_cash_shifts(
    tenant_id,branch_id,register_id,status,currency,opening_cash,
    opened_by_user_id,opened_at
  ) values(
    p_tenant_id,p_branch_id,p_register_id,'open',v_currency,
    round(p_opening_cash::numeric,2),p_actor_user_id,now()
  ) returning id into v_shift_id;

  return jsonb_build_object(
    'shiftId',v_shift_id,'status','open','branchId',p_branch_id,
    'registerId',p_register_id,'currency',v_currency,
    'openingCash',round(p_opening_cash::numeric,2),
    'expectedCash',round(p_opening_cash::numeric,2),
    'idempotentReplay',false
  );
end;
$$;

revoke all on function public.open_sellertray_cash_shift(uuid,uuid,uuid,numeric,uuid)
  from public,anon,authenticated;
grant execute on function public.open_sellertray_cash_shift(uuid,uuid,uuid,numeric,uuid)
  to service_role;

create or replace function public.get_sellertray_cash_shift_history(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_limit integer default 50
)
returns table(
  shift_id uuid,
  register_id uuid,
  register_name text,
  status text,
  currency text,
  opening_cash numeric,
  expected_cash numeric,
  declared_cash numeric,
  variance numeric,
  opened_by_user_id uuid,
  opened_at timestamptz,
  closed_at timestamptz,
  review_decision text,
  reviewed_at timestamptz
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_role text;
  v_limit integer := least(greatest(coalesce(p_limit,50),1),100);
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if not public.sellertray_user_can_operate_branch(p_tenant_id,p_branch_id,v_user_id) then
    raise exception 'You do not have access to cashier shifts in this branch' using errcode='42501';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;
  if v_role is null then
    raise exception 'SellerTray tenant membership required' using errcode='42501';
  end if;

  return query
  select
    s.id,
    s.register_id,
    r.name,
    s.status,
    s.currency,
    s.opening_cash,
    case when s.status='open'
      then (select t.expected_cash from public.sellertray_cash_shift_totals(s.tenant_id,s.id) t)
      else s.expected_cash
    end,
    s.declared_cash,
    s.variance,
    s.opened_by_user_id,
    s.opened_at,
    s.closed_at,
    s.review_decision,
    s.reviewed_at
  from public.sellertray_cash_shifts s
  join public.sellertray_registers r
    on r.tenant_id=s.tenant_id and r.id=s.register_id
  where s.tenant_id=p_tenant_id
    and s.branch_id=p_branch_id
    and (v_role in ('owner','manager') or s.opened_by_user_id=v_user_id)
  order by s.opened_at desc,s.id desc
  limit v_limit;
end;
$$;

revoke all on function public.get_sellertray_cash_shift_history(uuid,uuid,integer)
  from public,anon;
grant execute on function public.get_sellertray_cash_shift_history(uuid,uuid,integer)
  to authenticated;

commit;