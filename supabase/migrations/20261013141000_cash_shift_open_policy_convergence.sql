begin;

-- Re-converge the cashier open-shift command to the governed SellerTray
-- authorization and subscription semantics from the authoritative cashier
-- foundation. Earlier hosted convergence collapsed subscription, branch and
-- capability failures into one misleading permission error.
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

  if exists(
    select 1 from public.sellertray_cash_shifts s
    where s.tenant_id=p_tenant_id and s.register_id=p_register_id and s.status='open'
  ) then
    raise exception 'This register already has an open shift' using errcode='23514';
  end if;
  if exists(
    select 1 from public.sellertray_cash_shifts s
    where s.tenant_id=p_tenant_id and s.opened_by_user_id=p_actor_user_id and s.status='open'
  ) then
    raise exception 'You already have an open cashier shift' using errcode='23514';
  end if;

  insert into public.sellertray_cash_shifts(
    tenant_id,branch_id,register_id,status,currency,opening_cash,
    opened_by_user_id,opened_at
  ) values(
    p_tenant_id,p_branch_id,p_register_id,'open',v_currency,
    round(p_opening_cash::numeric,2),p_actor_user_id,now()
  ) returning id into v_shift_id;

  return jsonb_build_object(
    'shiftId',v_shift_id,
    'status','open',
    'branchId',p_branch_id,
    'registerId',p_register_id,
    'currency',v_currency,
    'openingCash',round(p_opening_cash::numeric,2),
    'expectedCash',round(p_opening_cash::numeric,2)
  );
end;
$$;

revoke all on function public.open_sellertray_cash_shift(uuid,uuid,uuid,numeric,uuid)
  from public,anon,authenticated;
grant execute on function public.open_sellertray_cash_shift(uuid,uuid,uuid,numeric,uuid)
  to service_role;

commit;
