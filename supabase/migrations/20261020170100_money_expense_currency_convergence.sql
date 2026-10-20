begin;

-- Converge bank-funded Business Expense currency on the authoritative Business
-- currency stored on tenants. The immediately preceding foundation intentionally
-- keeps the command signature stable; this migration only repairs the runtime
-- source used by that command.
create or replace function public.record_sellertray_business_expense(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_funding_source text,
  p_payment_method_id uuid,
  p_cash_shift_id uuid,
  p_expense_category text,
  p_amount numeric,
  p_reference text,
  p_reason text,
  p_command_id text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_role text;
  v_source text := lower(btrim(coalesce(p_funding_source,'')));
  v_category text := nullif(btrim(coalesce(p_expense_category,'')),'');
  v_reference text := nullif(btrim(coalesce(p_reference,'')),'');
  v_reason text := nullif(btrim(coalesce(p_reason,'')),'');
  v_command_id text := nullif(btrim(coalesce(p_command_id,'')),'');
  v_command_hash text;
  v_existing public.sellertray_business_expenses%rowtype;
  v_shift public.sellertray_cash_shifts%rowtype;
  v_bank public.merchant_payment_methods%rowtype;
  v_currency text;
  v_expense_id uuid := gen_random_uuid();
  v_movement jsonb;
  v_movement_id uuid;
  v_child_command text;
  v_effective_amount numeric(18,2);
  v_effective_movement_id uuid;
begin
  if p_tenant_id is null or p_branch_id is null or p_actor_user_id is null
     or v_source not in ('cash','bank') or p_amount is null or p_amount<=0
     or v_category is null or v_reference is null or v_reason is null then
    raise exception 'Business, Branch, funding source, category, amount, reference, reason and operator are required' using errcode='22023';
  end if;
  if char_length(v_category)>120 or char_length(v_reference)>160 or char_length(v_reason)>500 then
    raise exception 'Business Expense details are too long' using errcode='22023';
  end if;
  if v_command_id is null or char_length(v_command_id)<8 or char_length(v_command_id)>160
     or v_command_id !~ '^[A-Za-z0-9][A-Za-z0-9:_-]*$' then
    raise exception 'Business Expense retry identity is invalid' using errcode='22023';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;
  if v_role not in ('owner','manager') then
    raise exception 'Only the Business Owner or Manager can record Business Expenses' using errcode='42501';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;
  if not public.sellertray_user_can_operate_branch(p_tenant_id,p_branch_id,p_actor_user_id) then
    raise exception 'You do not have access to record a Business Expense in this Branch' using errcode='42501';
  end if;

  v_command_hash := pg_catalog.md5(p_tenant_id::text||'|business-expense|'||v_command_id);
  select * into v_existing
  from public.sellertray_business_expenses e
  where e.tenant_id=p_tenant_id and e.command_id_hash=v_command_hash;
  if found then
    if v_existing.branch_id<>p_branch_id
       or v_existing.funding_source<>v_source
       or v_existing.payment_method_id is distinct from p_payment_method_id
       or v_existing.cash_shift_id is distinct from p_cash_shift_id
       or v_existing.expense_category<>v_category
       or v_existing.amount<>round(p_amount::numeric,2)
       or lower(btrim(v_existing.reference))<>lower(v_reference)
       or v_existing.reason<>v_reason
       or v_existing.actor_user_id<>p_actor_user_id then
      raise exception 'Business Expense retry identity is already used for different facts' using errcode='23505';
    end if;
    select m.id,m.amount into v_effective_movement_id,v_effective_amount
    from public.sellertray_cash_movement_classifications c
    join public.sellertray_shift_cash_movements m
      on m.tenant_id=c.tenant_id and m.id=c.movement_id and m.superseded_at is null
    where c.tenant_id=p_tenant_id and c.business_expense_id=v_existing.id
    order by m.created_at desc,m.id desc limit 1;
    return jsonb_build_object(
      'expenseId',v_existing.id,'fundingSource',v_existing.funding_source,
      'amount',case when v_existing.funding_source='cash' then coalesce(v_effective_amount,0) else v_existing.amount end,
      'currency',v_existing.currency,'cashMovementId',v_effective_movement_id,
      'idempotentReplay',true
    );
  end if;

  select * into v_existing
  from public.sellertray_business_expenses e
  where e.tenant_id=p_tenant_id and lower(btrim(e.reference))=lower(v_reference)
  limit 1;
  if found then
    raise exception 'This Business Expense reference is already in use' using errcode='23505';
  end if;

  if v_source='bank' then
    if p_payment_method_id is null or p_cash_shift_id is not null then
      raise exception 'Bank-funded Business Expense requires a bank account and no cash drawer' using errcode='22023';
    end if;
    select * into v_bank
    from public.merchant_payment_methods m
    where m.tenant_id=p_tenant_id and m.id=p_payment_method_id;
    if not found then
      raise exception 'Selected bank account does not belong to this Business' using errcode='42501';
    end if;
    if v_bank.method_type<>'bank_transfer' or not v_bank.is_enabled then
      raise exception 'Choose an enabled Business bank account' using errcode='23514';
    end if;
    select upper(coalesce(nullif(btrim(t.currency),''),'NGN')) into v_currency
    from public.tenants t where t.id=p_tenant_id;
    if v_currency is null then raise exception 'SellerTray Business not found' using errcode='22023'; end if;
    insert into public.sellertray_business_expenses(
      id,tenant_id,branch_id,funding_source,payment_method_id,cash_register_id,cash_shift_id,
      expense_category,amount,currency,reference,reason,actor_user_id,command_id_hash
    ) values (
      v_expense_id,p_tenant_id,p_branch_id,'bank',p_payment_method_id,null,null,
      v_category,round(p_amount::numeric,2),v_currency,v_reference,v_reason,p_actor_user_id,v_command_hash
    );
    return jsonb_build_object(
      'expenseId',v_expense_id,'fundingSource','bank','amount',round(p_amount::numeric,2),
      'currency',v_currency,'cashMovementId',null,'idempotentReplay',false
    );
  end if;

  if p_payment_method_id is not null or p_cash_shift_id is null then
    raise exception 'Cash-funded Business Expense requires an open cash drawer and no bank account' using errcode='22023';
  end if;
  select * into v_shift
  from public.sellertray_cash_shifts s
  where s.tenant_id=p_tenant_id and s.id=p_cash_shift_id
  for update;
  if not found then raise exception 'Cashier shift not found' using errcode='22023'; end if;
  if v_shift.branch_id<>p_branch_id then
    raise exception 'Selected cash drawer belongs to a different Branch' using errcode='42501';
  end if;
  if v_shift.status<>'open' then
    raise exception 'Cash-funded Business Expense requires an open cash drawer' using errcode='23514';
  end if;

  v_child_command := 'business-expense:' || pg_catalog.md5(p_tenant_id::text||'|'||v_command_id);
  v_movement := public.record_sellertray_shift_cash_movement(
    p_tenant_id,p_cash_shift_id,'expense',p_amount,v_reference,v_reason,v_category,
    v_child_command,p_actor_user_id
  );
  v_movement_id := nullif(v_movement->>'movementId','')::uuid;
  v_currency := coalesce(v_movement->>'currency',v_shift.currency);

  insert into public.sellertray_business_expenses(
    id,tenant_id,branch_id,funding_source,payment_method_id,cash_register_id,cash_shift_id,
    expense_category,amount,currency,reference,reason,actor_user_id,command_id_hash
  ) values (
    v_expense_id,p_tenant_id,p_branch_id,'cash',null,v_shift.register_id,p_cash_shift_id,
    v_category,round(p_amount::numeric,2),v_currency,v_reference,v_reason,p_actor_user_id,v_command_hash
  );
  insert into public.sellertray_cash_movement_classifications(
    tenant_id,movement_id,activity_classification,business_expense_id
  ) values (p_tenant_id,v_movement_id,'business_expense',v_expense_id);

  return jsonb_build_object(
    'expenseId',v_expense_id,'fundingSource','cash','amount',round(p_amount::numeric,2),
    'currency',v_currency,'cashMovementId',v_movement_id,
    'expectedCash',v_movement->'expectedCash','idempotentReplay',false
  );
end;
$$;

revoke all on function public.record_sellertray_business_expense(uuid,uuid,text,uuid,uuid,text,numeric,text,text,text,uuid)
  from public,anon,authenticated;
grant execute on function public.record_sellertray_business_expense(uuid,uuid,text,uuid,uuid,text,numeric,text,text,text,uuid)
  to service_role;

commit;
