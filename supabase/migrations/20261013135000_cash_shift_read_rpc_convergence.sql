begin;

-- Restore the governed historical Branch read authority used by cash/shift audit reads
-- without changing active-Branch mutation authority.
create or replace function public.sellertray_user_can_read_branch(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists (
    select 1
    from public.tenant_members tm
    join public.branches b
      on b.tenant_id = tm.tenant_id
     and b.id = p_branch_id
    where tm.tenant_id = p_tenant_id
      and tm.user_id = p_user_id
      and (
        tm.role in ('owner','manager')
        or exists (
          select 1
          from public.branch_user_access bua
          where bua.tenant_id = p_tenant_id
            and bua.branch_id = p_branch_id
            and bua.user_id = p_user_id
            and bua.can_operate = true
        )
        or (
          tm.role = 'staff'
          and b.is_default = true
          and not exists (
            select 1
            from public.branch_user_access any_bua
            where any_bua.tenant_id = p_tenant_id
              and any_bua.user_id = p_user_id
          )
        )
      )
  );
$$;

revoke all on function public.sellertray_user_can_read_branch(uuid,uuid,uuid)
  from public,anon;
grant execute on function public.sellertray_user_can_read_branch(uuid,uuid,uuid)
  to authenticated,service_role;

create or replace function public.get_sellertray_cash_capabilities(
  p_tenant_id uuid,
  p_branch_id uuid
)
returns table(
  can_open_shift boolean,
  can_record_cash_movement boolean,
  can_record_expense boolean,
  can_close_shift boolean,
  can_review_shift boolean
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_branch_allowed boolean;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;

  v_branch_allowed := public.sellertray_user_can_operate_branch(
    p_tenant_id,p_branch_id,v_user_id
  );

  return query select
    v_branch_allowed and public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_open_shift'),
    v_branch_allowed and public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_record_cash_movement'),
    v_branch_allowed and public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_record_expense'),
    v_branch_allowed and public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_close_shift'),
    v_branch_allowed and public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_review_shift');
end;
$$;

revoke all on function public.get_sellertray_cash_capabilities(uuid,uuid)
  from public,anon;
grant execute on function public.get_sellertray_cash_capabilities(uuid,uuid)
  to authenticated;

-- Shift detail is historical evidence. Mutations and the active shift lookup remain
-- governed by active Branch operation.
create or replace function public.get_sellertray_cash_shift(
  p_tenant_id uuid,
  p_shift_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_role text;
  v_shift public.sellertray_cash_shifts%rowtype;
  v_register_name text;
  v_totals record;
  v_movements jsonb;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;

  select * into v_shift
  from public.sellertray_cash_shifts s
  where s.tenant_id=p_tenant_id and s.id=p_shift_id;
  if not found then return null; end if;

  if not public.sellertray_user_can_read_branch(
    p_tenant_id,v_shift.branch_id,v_user_id
  ) then
    raise exception 'You do not have access to this cashier shift' using errcode='42501';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;
  if v_role='staff' and v_shift.opened_by_user_id<>v_user_id then
    raise exception 'Staff can view only their own cashier shifts' using errcode='42501';
  end if;

  select r.name into v_register_name
  from public.sellertray_registers r
  where r.tenant_id=p_tenant_id and r.id=v_shift.register_id;

  select * into v_totals
  from public.sellertray_cash_shift_totals(p_tenant_id,p_shift_id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'movementId',m.id,
    'movementType',m.movement_type,
    'amount',m.amount,
    'currency',m.currency,
    'reference',m.reference,
    'reason',m.reason,
    'expenseCategory',m.expense_category,
    'actorUserId',m.actor_user_id,
    'createdAt',m.created_at
  ) order by m.created_at desc,m.id desc),'[]'::jsonb)
  into v_movements
  from public.sellertray_shift_cash_movements m
  where m.tenant_id=p_tenant_id and m.shift_id=p_shift_id;

  return jsonb_build_object(
    'shiftId',v_shift.id,
    'branchId',v_shift.branch_id,
    'registerId',v_shift.register_id,
    'registerName',v_register_name,
    'status',v_shift.status,
    'currency',v_shift.currency,
    'openingCash',v_totals.opening_cash,
    'cashSales',v_totals.cash_sales,
    'cashRefunds',v_totals.cash_refunds,
    'cashIn',v_totals.cash_in,
    'cashOut',v_totals.cash_out,
    'expenses',v_totals.expenses,
    'expectedCash',case when v_shift.status='open' then v_totals.expected_cash else v_shift.expected_cash end,
    'declaredCash',v_shift.declared_cash,
    'variance',v_shift.variance,
    'closeNote',v_shift.close_note,
    'reviewDecision',v_shift.review_decision,
    'reviewNote',v_shift.review_note,
    'openedByUserId',v_shift.opened_by_user_id,
    'openedAt',v_shift.opened_at,
    'closedAt',v_shift.closed_at,
    'reviewedAt',v_shift.reviewed_at,
    'movements',v_movements
  );
end;
$$;

revoke all on function public.get_sellertray_cash_shift(uuid,uuid)
  from public,anon;
grant execute on function public.get_sellertray_cash_shift(uuid,uuid)
  to authenticated;

create or replace function public.get_sellertray_active_cash_shift(
  p_tenant_id uuid,
  p_branch_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_shift_id uuid;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if not public.sellertray_user_can_operate_branch(p_tenant_id,p_branch_id,v_user_id) then
    raise exception 'You do not have access to cashier shifts in this branch' using errcode='42501';
  end if;

  select s.id into v_shift_id
  from public.sellertray_cash_shifts s
  where s.tenant_id=p_tenant_id
    and s.branch_id=p_branch_id
    and s.opened_by_user_id=v_user_id
    and s.status='open'
  order by s.opened_at desc,s.id
  limit 1;

  if v_shift_id is null then return null; end if;
  return public.get_sellertray_cash_shift(p_tenant_id,v_shift_id);
end;
$$;

revoke all on function public.get_sellertray_active_cash_shift(uuid,uuid)
  from public,anon;
grant execute on function public.get_sellertray_active_cash_shift(uuid,uuid)
  to authenticated;

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
  if not public.sellertray_user_can_read_branch(p_tenant_id,p_branch_id,v_user_id) then
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
