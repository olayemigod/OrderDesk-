begin;

-- Closed/reviewed shift detail is audit history. The active-shift lookup and every
-- shift mutation remain tied to sellertray_user_can_operate_branch.
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

commit;
