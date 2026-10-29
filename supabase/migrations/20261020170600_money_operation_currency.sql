begin;

create or replace function public.get_sellertray_money_operation_options(
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
  v_user_id uuid := auth.uid();
  v_role text;
  v_currency text;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;
  if v_role is null then
    raise exception 'SellerTray Business membership required' using errcode='42501';
  end if;
  if not public.sellertray_user_can_operate_branch(p_tenant_id,p_branch_id,v_user_id) then
    raise exception 'You do not have access to this Branch' using errcode='42501';
  end if;

  select upper(coalesce(nullif(btrim(t.currency),''),'NGN')) into v_currency
  from public.tenants t
  where t.id=p_tenant_id;
  if v_currency is null then
    raise exception 'SellerTray Business not found' using errcode='22023';
  end if;

  return jsonb_build_object(
    'currency',v_currency,
    'canRecordBusinessExpense',
      v_role in ('owner','manager') and public.orderdesk_subscription_can_write(p_tenant_id),
    'bankAccounts',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',m.id,
        'displayName',m.display_name,
        'bankName',m.bank_name,
        'accountName',m.bank_account_name,
        'accountNumber',m.bank_account_number
      ) order by m.sort_order,m.display_name,m.id)
      from public.merchant_payment_methods m
      where m.tenant_id=p_tenant_id
        and m.method_type='bank_transfer'
        and m.is_enabled=true
    ),'[]'::jsonb),
    'openCashDrawers',case when v_role in ('owner','manager') then coalesce((
      select jsonb_agg(jsonb_build_object(
        'shiftId',s.id,
        'registerId',s.register_id,
        'registerName',r.name,
        'cashierUserId',s.opened_by_user_id,
        'openedAt',s.opened_at,
        'expectedCash',(select x.expected_cash from public.sellertray_cash_shift_totals(s.tenant_id,s.id) x)
      ) order by s.opened_at desc,s.id desc)
      from public.sellertray_cash_shifts s
      join public.sellertray_registers r
        on r.tenant_id=s.tenant_id and r.id=s.register_id
      where s.tenant_id=p_tenant_id
        and s.branch_id=p_branch_id
        and s.status='open'
    ),'[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;

revoke all on function public.get_sellertray_money_operation_options(uuid,uuid)
  from public,anon;
grant execute on function public.get_sellertray_money_operation_options(uuid,uuid)
  to authenticated,service_role;

commit;
