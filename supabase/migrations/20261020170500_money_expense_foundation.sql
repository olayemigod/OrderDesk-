begin;

-- SellerTray Money Foundation.
-- sellertray_shift_cash_movements remains the only drawer ledger. Typed Cash Out
-- and Business Expense classification lives beside that immutable ledger so
-- clients cannot create a competing cash-balance truth.

create table public.sellertray_business_expenses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null,
  funding_source text not null,
  payment_method_id uuid,
  cash_register_id uuid,
  cash_shift_id uuid,
  expense_category text not null,
  amount numeric(18,2) not null,
  currency text not null,
  reference text not null,
  reason text not null,
  actor_user_id uuid not null,
  command_id_hash text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id,id),
  constraint sellertray_business_expenses_branch_same_tenant
    foreign key (tenant_id,branch_id)
    references public.branches(tenant_id,id)
    on delete cascade,
  constraint sellertray_business_expenses_bank_same_tenant
    foreign key (tenant_id,payment_method_id)
    references public.merchant_payment_methods(tenant_id,id)
    on delete restrict,
  constraint sellertray_business_expenses_cash_shift_same_drawer
    foreign key (tenant_id,branch_id,cash_register_id,cash_shift_id)
    references public.sellertray_cash_shifts(tenant_id,branch_id,register_id,id)
    on delete cascade,
  constraint sellertray_business_expenses_funding_source_check
    check (funding_source in ('cash','bank')),
  constraint sellertray_business_expenses_funding_shape_check
    check (
      (funding_source='cash'
        and payment_method_id is null
        and cash_register_id is not null
        and cash_shift_id is not null)
      or
      (funding_source='bank'
        and payment_method_id is not null
        and cash_register_id is null
        and cash_shift_id is null)
    ),
  constraint sellertray_business_expenses_amount_check check (amount>0),
  constraint sellertray_business_expenses_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint sellertray_business_expenses_category_check
    check (char_length(btrim(expense_category)) between 1 and 120),
  constraint sellertray_business_expenses_reference_check
    check (char_length(btrim(reference)) between 1 and 160),
  constraint sellertray_business_expenses_reason_check
    check (char_length(btrim(reason)) between 1 and 500),
  constraint sellertray_business_expenses_command_hash_check
    check (command_id_hash ~ '^[0-9a-f]{32}$')
);

create unique index sellertray_business_expenses_command_unique
  on public.sellertray_business_expenses(tenant_id,command_id_hash);
create unique index sellertray_business_expenses_reference_unique
  on public.sellertray_business_expenses(tenant_id,lower(btrim(reference)));
create index sellertray_business_expenses_branch_created_idx
  on public.sellertray_business_expenses(tenant_id,branch_id,created_at desc);
create index sellertray_business_expenses_payment_method_idx
  on public.sellertray_business_expenses(tenant_id,payment_method_id)
  where payment_method_id is not null;

alter table public.sellertray_business_expenses enable row level security;
revoke all on table public.sellertray_business_expenses from public,anon,authenticated;
grant all on table public.sellertray_business_expenses to service_role;

create table public.sellertray_cash_movement_classifications (
  tenant_id uuid not null,
  movement_id uuid not null,
  activity_classification text not null,
  bank_payment_method_id uuid,
  business_expense_id uuid,
  created_at timestamptz not null default now(),
  primary key (tenant_id,movement_id),
  constraint sellertray_cash_movement_classifications_movement_same_tenant
    foreign key (tenant_id,movement_id)
    references public.sellertray_shift_cash_movements(tenant_id,id)
    on delete cascade,
  constraint sellertray_cash_movement_classifications_bank_same_tenant
    foreign key (tenant_id,bank_payment_method_id)
    references public.merchant_payment_methods(tenant_id,id)
    on delete restrict,
  constraint sellertray_cash_movement_classifications_expense_same_tenant
    foreign key (tenant_id,business_expense_id)
    references public.sellertray_business_expenses(tenant_id,id)
    on delete cascade,
  constraint sellertray_cash_movement_classifications_type_check
    check (activity_classification in ('bank_deposit','owner_withdrawal','business_expense')),
  constraint sellertray_cash_movement_classifications_shape_check
    check (
      (activity_classification='bank_deposit'
        and bank_payment_method_id is not null
        and business_expense_id is null)
      or
      (activity_classification='owner_withdrawal'
        and bank_payment_method_id is null
        and business_expense_id is null)
      or
      (activity_classification='business_expense'
        and bank_payment_method_id is null
        and business_expense_id is not null)
    )
);

create index sellertray_cash_movement_classifications_expense_idx
  on public.sellertray_cash_movement_classifications(tenant_id,business_expense_id)
  where business_expense_id is not null;

alter table public.sellertray_cash_movement_classifications enable row level security;
revoke all on table public.sellertray_cash_movement_classifications from public,anon,authenticated;
grant all on table public.sellertray_cash_movement_classifications to service_role;

create or replace function public.prevent_sellertray_money_history_mutation()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if tg_op='DELETE'
     and not exists (select 1 from public.tenants t where t.id=old.tenant_id) then
    return old;
  end if;
  raise exception 'SellerTray money history is immutable' using errcode='55000';
end;
$$;
revoke all on function public.prevent_sellertray_money_history_mutation()
  from public,anon,authenticated;

create trigger prevent_sellertray_business_expense_mutation
before update or delete on public.sellertray_business_expenses
for each row execute function public.prevent_sellertray_money_history_mutation();

create trigger prevent_sellertray_cash_classification_mutation
before update or delete on public.sellertray_cash_movement_classifications
for each row execute function public.prevent_sellertray_money_history_mutation();

create or replace function public.record_sellertray_typed_cash_out(
  p_tenant_id uuid,
  p_shift_id uuid,
  p_cash_out_type text,
  p_bank_payment_method_id uuid,
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
  v_type text := lower(btrim(coalesce(p_cash_out_type,'')));
  v_command_id text := nullif(btrim(coalesce(p_command_id,'')),'');
  v_bank public.merchant_payment_methods%rowtype;
  v_result jsonb;
  v_movement_id uuid;
  v_existing public.sellertray_cash_movement_classifications%rowtype;
  v_child_command text;
begin
  if v_type not in ('bank_deposit','owner_withdrawal') then
    raise exception 'Choose Bank Deposit or Owner Withdrawal' using errcode='22023';
  end if;
  if v_command_id is null
     or char_length(v_command_id)<8
     or char_length(v_command_id)>160
     or v_command_id !~ '^[A-Za-z0-9][A-Za-z0-9:_-]*$' then
    raise exception 'Cash Out retry identity is invalid' using errcode='22023';
  end if;

  if v_type='bank_deposit' then
    if p_bank_payment_method_id is null then
      raise exception 'Destination Business bank account is required' using errcode='22023';
    end if;
    select * into v_bank
    from public.merchant_payment_methods m
    where m.tenant_id=p_tenant_id and m.id=p_bank_payment_method_id;
    if not found then
      raise exception 'Destination bank account does not belong to this Business' using errcode='42501';
    end if;
    if v_bank.method_type<>'bank_transfer' or not v_bank.is_enabled then
      raise exception 'Choose an enabled Business bank account' using errcode='23514';
    end if;
  elsif p_bank_payment_method_id is not null then
    raise exception 'Owner Withdrawal does not use a destination Business bank account' using errcode='22023';
  end if;

  v_child_command := 'typed-cash-out:' || pg_catalog.md5(p_tenant_id::text||'|'||v_command_id);
  v_result := public.record_sellertray_shift_cash_movement(
    p_tenant_id,p_shift_id,'cash_out',p_amount,p_reference,p_reason,null,
    v_child_command,p_actor_user_id
  );
  v_movement_id := nullif(v_result->>'movementId','')::uuid;

  select * into v_existing
  from public.sellertray_cash_movement_classifications c
  where c.tenant_id=p_tenant_id and c.movement_id=v_movement_id;
  if found then
    if v_existing.activity_classification<>v_type
       or v_existing.bank_payment_method_id is distinct from p_bank_payment_method_id then
      raise exception 'Cash Out retry identity is already used for different facts' using errcode='23505';
    end if;
  else
    if coalesce((v_result->>'idempotentReplay')::boolean,false) then
      raise exception 'Cash Out retry identity is already used outside the typed Cash Out command' using errcode='23505';
    end if;
    insert into public.sellertray_cash_movement_classifications(
      tenant_id,movement_id,activity_classification,bank_payment_method_id
    ) values (p_tenant_id,v_movement_id,v_type,p_bank_payment_method_id);
  end if;

  return v_result || jsonb_build_object(
    'cashOutType',v_type,
    'bankPaymentMethodId',p_bank_payment_method_id
  );
end;
$$;

revoke all on function public.record_sellertray_typed_cash_out(
  uuid,uuid,text,uuid,numeric,text,text,text,uuid
) from public,anon,authenticated;
grant execute on function public.record_sellertray_typed_cash_out(
  uuid,uuid,text,uuid,numeric,text,text,text,uuid
) to service_role;

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
  if p_tenant_id is null
     or p_branch_id is null
     or p_actor_user_id is null
     or v_source not in ('cash','bank')
     or p_amount is null
     or p_amount<=0
     or v_category is null
     or v_reference is null
     or v_reason is null then
    raise exception 'Business, Branch, funding source, category, amount, reference, reason and operator are required'
      using errcode='22023';
  end if;
  if char_length(v_category)>120
     or char_length(v_reference)>160
     or char_length(v_reason)>500 then
    raise exception 'Business Expense details are too long' using errcode='22023';
  end if;
  if v_command_id is null
     or char_length(v_command_id)<8
     or char_length(v_command_id)>160
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
      on m.tenant_id=c.tenant_id
     and m.id=c.movement_id
     and m.superseded_at is null
    where c.tenant_id=p_tenant_id and c.business_expense_id=v_existing.id
    order by m.created_at desc,m.id desc
    limit 1;
    return jsonb_build_object(
      'expenseId',v_existing.id,
      'fundingSource',v_existing.funding_source,
      'amount',case when v_existing.funding_source='cash' then coalesce(v_effective_amount,0) else v_existing.amount end,
      'currency',v_existing.currency,
      'cashMovementId',v_effective_movement_id,
      'idempotentReplay',true
    );
  end if;

  select * into v_existing
  from public.sellertray_business_expenses e
  where e.tenant_id=p_tenant_id
    and lower(btrim(e.reference))=lower(v_reference)
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
    from public.tenants t
    where t.id=p_tenant_id;
    if v_currency is null then
      raise exception 'SellerTray Business not found' using errcode='22023';
    end if;
    insert into public.sellertray_business_expenses(
      id,tenant_id,branch_id,funding_source,payment_method_id,cash_register_id,cash_shift_id,
      expense_category,amount,currency,reference,reason,actor_user_id,command_id_hash
    ) values (
      v_expense_id,p_tenant_id,p_branch_id,'bank',p_payment_method_id,null,null,
      v_category,round(p_amount::numeric,2),v_currency,v_reference,v_reason,p_actor_user_id,v_command_hash
    );
    return jsonb_build_object(
      'expenseId',v_expense_id,
      'fundingSource','bank',
      'amount',round(p_amount::numeric,2),
      'currency',v_currency,
      'cashMovementId',null,
      'idempotentReplay',false
    );
  end if;

  if p_payment_method_id is not null or p_cash_shift_id is null then
    raise exception 'Cash-funded Business Expense requires an open cash drawer and no bank account' using errcode='22023';
  end if;
  select * into v_shift
  from public.sellertray_cash_shifts s
  where s.tenant_id=p_tenant_id and s.id=p_cash_shift_id
  for update;
  if not found then
    raise exception 'Cashier shift not found' using errcode='22023';
  end if;
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
  ) values (
    p_tenant_id,v_movement_id,'business_expense',v_expense_id
  );

  return jsonb_build_object(
    'expenseId',v_expense_id,
    'fundingSource','cash',
    'amount',round(p_amount::numeric,2),
    'currency',v_currency,
    'cashMovementId',v_movement_id,
    'expectedCash',v_movement->'expectedCash',
    'idempotentReplay',false
  );
end;
$$;

revoke all on function public.record_sellertray_business_expense(
  uuid,uuid,text,uuid,uuid,text,numeric,text,text,text,uuid
) from public,anon,authenticated;
grant execute on function public.record_sellertray_business_expense(
  uuid,uuid,text,uuid,uuid,text,numeric,text,text,text,uuid
) to service_role;

-- Preserve typed meaning across the existing immutable correction graph.
create or replace function public.validate_sellertray_money_correction_classification()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_class public.sellertray_cash_movement_classifications%rowtype;
  v_replacement_type text;
begin
  if new.replacement_movement_id is null then
    return new;
  end if;
  select * into v_class
  from public.sellertray_cash_movement_classifications c
  where c.tenant_id=new.tenant_id
    and c.movement_id=new.original_movement_id;
  if not found then
    return new;
  end if;
  select m.movement_type into v_replacement_type
  from public.sellertray_shift_cash_movements m
  where m.tenant_id=new.tenant_id and m.id=new.replacement_movement_id;
  if v_class.activity_classification in ('bank_deposit','owner_withdrawal')
     and v_replacement_type<>'cash_out' then
    raise exception 'Typed Cash Out corrections must remain Cash Out activity' using errcode='23514';
  end if;
  if v_class.activity_classification='business_expense'
     and v_replacement_type<>'expense' then
    raise exception 'Cash-funded Business Expense corrections must remain expense activity' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_sellertray_money_correction_classification()
  from public,anon,authenticated;

create trigger validate_sellertray_money_correction_classification
before insert on public.sellertray_shift_cash_movement_corrections
for each row execute function public.validate_sellertray_money_correction_classification();

create or replace function public.copy_sellertray_money_correction_classification()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if new.replacement_movement_id is not null then
    insert into public.sellertray_cash_movement_classifications(
      tenant_id,movement_id,activity_classification,bank_payment_method_id,business_expense_id,created_at
    )
    select c.tenant_id,new.replacement_movement_id,c.activity_classification,
      c.bank_payment_method_id,c.business_expense_id,now()
    from public.sellertray_cash_movement_classifications c
    where c.tenant_id=new.tenant_id and c.movement_id=new.original_movement_id;
  end if;
  return new;
end;
$$;
revoke all on function public.copy_sellertray_money_correction_classification()
  from public,anon,authenticated;

create trigger copy_sellertray_money_correction_classification
after insert on public.sellertray_shift_cash_movement_corrections
for each row execute function public.copy_sellertray_money_correction_classification();

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

  return jsonb_build_object(
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
        'expectedCash',(select t.expected_cash from public.sellertray_cash_shift_totals(s.tenant_id,s.id) t)
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

create or replace function public.get_sellertray_cash_movement_classifications(
  p_tenant_id uuid,
  p_shift_id uuid
)
returns table(
  movement_id uuid,
  activity_classification text,
  bank_payment_method_id uuid,
  bank_display_name text,
  business_expense_id uuid
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_shift public.sellertray_cash_shifts%rowtype;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  select * into v_shift
  from public.sellertray_cash_shifts s
  where s.tenant_id=p_tenant_id and s.id=p_shift_id;
  if not found then return; end if;
  if not public.sellertray_user_can_read_branch(p_tenant_id,v_shift.branch_id,v_user_id) then
    raise exception 'You do not have access to this cashier shift' using errcode='42501';
  end if;
  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;
  if v_role='staff' and v_shift.opened_by_user_id<>v_user_id then
    raise exception 'Staff can view only their own cashier shifts' using errcode='42501';
  end if;
  return query
  select c.movement_id,c.activity_classification,c.bank_payment_method_id,
    case when c.bank_payment_method_id is null then null
      else concat_ws(' · ',m.display_name,m.bank_name,m.bank_account_number) end,
    c.business_expense_id
  from public.sellertray_cash_movement_classifications c
  left join public.merchant_payment_methods m
    on m.tenant_id=c.tenant_id and m.id=c.bank_payment_method_id
  join public.sellertray_shift_cash_movements sm
    on sm.tenant_id=c.tenant_id and sm.id=c.movement_id
  where c.tenant_id=p_tenant_id and sm.shift_id=p_shift_id;
end;
$$;
revoke all on function public.get_sellertray_cash_movement_classifications(uuid,uuid)
  from public,anon;
grant execute on function public.get_sellertray_cash_movement_classifications(uuid,uuid)
  to authenticated,service_role;

create or replace function public.get_sellertray_business_expense_management_list(
  p_tenant_id uuid,
  p_branch_id uuid default null,
  p_funding_source text default 'all',
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
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
  v_source text := lower(btrim(coalesce(p_funding_source,'all')));
  v_search text := nullif(btrim(coalesce(p_search,'')),'');
  v_limit integer := least(greatest(coalesce(p_limit,50),1),100);
  v_offset integer := greatest(coalesce(p_offset,0),0);
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;
  if v_role not in ('owner','manager') then
    raise exception 'Business Expense management is available to Owners and Managers' using errcode='42501';
  end if;
  if v_source not in ('all','cash','bank') then
    raise exception 'Unsupported funding source' using errcode='22023';
  end if;
  if p_branch_id is not null
     and not public.sellertray_user_can_read_branch(p_tenant_id,p_branch_id,v_user_id) then
    raise exception 'You do not have access to this Branch' using errcode='42501';
  end if;

  with scoped as (
    select
      e.id,e.branch_id,b.name as branch_name,e.funding_source,e.payment_method_id,
      case when e.payment_method_id is null then null
        else concat_ws(' · ',pm.display_name,pm.bank_name,pm.bank_account_number) end as bank_account,
      e.cash_shift_id,e.expense_category,e.amount as original_amount,e.currency,e.reference,e.reason,
      e.actor_user_id,e.created_at,
      em.id as effective_movement_id,
      em.amount as effective_cash_amount,
      em.reference as effective_reference,
      em.reason as effective_reason,
      em.expense_category as effective_category,
      case when e.funding_source='bank' then e.amount
           when em.id is not null then em.amount
           else 0 end::numeric(18,2) as effective_amount,
      case when e.funding_source='bank' or em.id is not null then 'effective' else 'removed' end as status
    from public.sellertray_business_expenses e
    join public.branches b
      on b.tenant_id=e.tenant_id and b.id=e.branch_id
    left join public.merchant_payment_methods pm
      on pm.tenant_id=e.tenant_id and pm.id=e.payment_method_id
    left join lateral (
      select m.*
      from public.sellertray_cash_movement_classifications c
      join public.sellertray_shift_cash_movements m
        on m.tenant_id=c.tenant_id
       and m.id=c.movement_id
       and m.superseded_at is null
      where c.tenant_id=e.tenant_id and c.business_expense_id=e.id
      order by m.created_at desc,m.id desc
      limit 1
    ) em on true
    where e.tenant_id=p_tenant_id
      and public.sellertray_user_can_read_branch(p_tenant_id,e.branch_id,v_user_id)
      and (p_branch_id is null or e.branch_id=p_branch_id)
      and (v_source='all' or e.funding_source=v_source)
      and (
        v_search is null
        or e.reference ilike '%'||v_search||'%'
        or e.reason ilike '%'||v_search||'%'
        or e.expense_category ilike '%'||v_search||'%'
      )
  ), paged as (
    select * from scoped
    order by created_at desc,id desc
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'expenseId',x.id,
      'branchId',x.branch_id,
      'branchName',x.branch_name,
      'fundingSource',x.funding_source,
      'paymentMethodId',x.payment_method_id,
      'bankAccount',x.bank_account,
      'cashShiftId',x.cash_shift_id,
      'expenseCategory',coalesce(x.effective_category,x.expense_category),
      'originalAmount',x.original_amount,
      'amount',x.effective_amount,
      'currency',x.currency,
      'reference',coalesce(x.effective_reference,x.reference),
      'reason',coalesce(x.effective_reason,x.reason),
      'actorUserId',x.actor_user_id,
      'status',x.status,
      'cashMovementId',x.effective_movement_id,
      'createdAt',x.created_at
    ) order by x.created_at desc,x.id desc) from paged x),'[]'::jsonb),
    'totalCount',(select count(*) from scoped),
    'totalAmount',coalesce((select sum(effective_amount) from scoped),0),
    'currency',(select case when count(distinct currency)=1 then min(currency) else null end from scoped),
    'limit',v_limit,
    'offset',v_offset
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.get_sellertray_business_expense_management_list(
  uuid,uuid,text,text,integer,integer
) from public,anon;
grant execute on function public.get_sellertray_business_expense_management_list(
  uuid,uuid,text,text,integer,integer
) to authenticated,service_role;

commit;
