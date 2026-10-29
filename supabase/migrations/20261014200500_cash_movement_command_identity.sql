begin;

alter table public.sellertray_shift_cash_movements
  add column command_id_hash text;

alter table public.sellertray_shift_cash_movements
  add constraint sellertray_shift_cash_movements_command_hash_check
  check (command_id_hash is null or command_id_hash ~ '^[0-9a-f]{32}$');

create unique index sellertray_shift_cash_movements_command_unique
  on public.sellertray_shift_cash_movements(tenant_id,command_id_hash)
  where command_id_hash is not null;

create or replace function public.record_sellertray_shift_cash_movement(
  p_tenant_id uuid,
  p_shift_id uuid,
  p_movement_type text,
  p_amount numeric,
  p_reference text,
  p_reason text,
  p_expense_category text,
  p_command_id text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_shift public.sellertray_cash_shifts%rowtype;
  v_role text;
  v_type text := lower(btrim(coalesce(p_movement_type,'')));
  v_reference text := nullif(btrim(coalesce(p_reference,'')),'');
  v_reason text := nullif(btrim(coalesce(p_reason,'')),'');
  v_category text := nullif(btrim(coalesce(p_expense_category,'')),'');
  v_command_id text := nullif(btrim(coalesce(p_command_id,'')),'');
  v_command_hash text;
  v_required_capability text;
  v_existing public.sellertray_shift_cash_movements%rowtype;
  v_movement_id uuid;
  v_expected numeric(18,2);
begin
  if p_tenant_id is null or p_shift_id is null or p_actor_user_id is null
     or p_amount is null or p_amount<=0 or v_reference is null or v_reason is null
     or v_type not in ('cash_in','cash_out','expense') then
    raise exception 'Shift, movement, amount, reference, reason and operator are required'
      using errcode='22023';
  end if;
  if v_command_id is null
     or char_length(v_command_id)<8
     or char_length(v_command_id)>160
     or v_command_id !~ '^[A-Za-z0-9][A-Za-z0-9:_-]*$' then
    raise exception 'Cash activity retry identity is invalid' using errcode='22023';
  end if;
  if char_length(v_reference)>160 or char_length(v_reason)>500
     or (v_category is not null and char_length(v_category)>120) then
    raise exception 'Cash movement details are too long' using errcode='22023';
  end if;
  if v_type='expense' and v_category is null then
    raise exception 'Expense category is required' using errcode='22023';
  end if;
  if v_type<>'expense' then v_category := null; end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  select * into v_shift
  from public.sellertray_cash_shifts s
  where s.tenant_id=p_tenant_id and s.id=p_shift_id
  for update;
  if not found then raise exception 'Cashier shift not found' using errcode='22023'; end if;
  if v_shift.status<>'open' then
    raise exception 'Cash movements can only be recorded in an open shift' using errcode='23514';
  end if;
  if not public.sellertray_user_can_operate_branch(p_tenant_id,v_shift.branch_id,p_actor_user_id) then
    raise exception 'You do not have access to this cashier shift' using errcode='42501';
  end if;

  v_required_capability := case when v_type='expense' then 'can_record_expense' else 'can_record_cash_movement' end;
  if not public.sellertray_user_has_capability(p_tenant_id,p_actor_user_id,v_required_capability) then
    raise exception 'You do not have permission to record this cash activity' using errcode='42501';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;
  if v_role='staff' and v_shift.opened_by_user_id<>p_actor_user_id then
    raise exception 'Staff can record cash activity only in their own open shift' using errcode='42501';
  end if;

  v_command_hash := pg_catalog.md5(p_tenant_id::text||'|'||v_command_id);

  select * into v_existing
  from public.sellertray_shift_cash_movements m
  where m.tenant_id=p_tenant_id
    and m.command_id_hash=v_command_hash
  limit 1;

  if found then
    if v_existing.shift_id<>p_shift_id
       or v_existing.branch_id<>v_shift.branch_id
       or v_existing.register_id<>v_shift.register_id
       or v_existing.movement_type<>v_type
       or v_existing.amount<>round(p_amount::numeric,2)
       or lower(btrim(v_existing.reference))<>lower(v_reference)
       or v_existing.reason<>v_reason
       or v_existing.expense_category is distinct from v_category
       or v_existing.actor_user_id<>p_actor_user_id then
      raise exception 'Cash activity retry identity is already used for different facts'
        using errcode='23505';
    end if;
    select t.expected_cash into v_expected
    from public.sellertray_cash_shift_totals(p_tenant_id,p_shift_id) t;
    return jsonb_build_object(
      'movementId',v_existing.id,'shiftId',p_shift_id,'movementType',v_type,
      'amount',v_existing.amount,'currency',v_existing.currency,
      'expectedCash',v_expected,'idempotentReplay',true
    );
  end if;

  select * into v_existing
  from public.sellertray_shift_cash_movements m
  where m.tenant_id=p_tenant_id
    and m.shift_id=p_shift_id
    and m.movement_type=v_type
    and lower(btrim(m.reference))=lower(v_reference)
  limit 1;

  if found then
    if v_existing.amount<>round(p_amount::numeric,2)
       or v_existing.reason<>v_reason
       or v_existing.expense_category is distinct from v_category then
      raise exception 'This cash reference is already used for different facts' using errcode='23505';
    end if;
    select t.expected_cash into v_expected
    from public.sellertray_cash_shift_totals(p_tenant_id,p_shift_id) t;
    return jsonb_build_object(
      'movementId',v_existing.id,'shiftId',p_shift_id,'movementType',v_type,
      'amount',v_existing.amount,'currency',v_existing.currency,
      'expectedCash',v_expected,'idempotentReplay',true
    );
  end if;

  select t.expected_cash into v_expected
  from public.sellertray_cash_shift_totals(p_tenant_id,p_shift_id) t;

  if v_type in ('cash_out','expense')
     and round(p_amount::numeric,2)>v_expected then
    raise exception 'Cash activity cannot take expected drawer cash below zero'
      using errcode='23514';
  end if;

  insert into public.sellertray_shift_cash_movements(
    tenant_id,branch_id,register_id,shift_id,movement_type,amount,currency,
    reference,reason,expense_category,actor_user_id,command_id_hash
  ) values(
    p_tenant_id,v_shift.branch_id,v_shift.register_id,p_shift_id,v_type,
    round(p_amount::numeric,2),v_shift.currency,v_reference,v_reason,v_category,
    p_actor_user_id,v_command_hash
  ) returning id into v_movement_id;

  select t.expected_cash into v_expected
  from public.sellertray_cash_shift_totals(p_tenant_id,p_shift_id) t;

  return jsonb_build_object(
    'movementId',v_movement_id,'shiftId',p_shift_id,'movementType',v_type,
    'amount',round(p_amount::numeric,2),'currency',v_shift.currency,
    'expectedCash',v_expected,'idempotentReplay',false
  );
end;
$$;

create or replace function public.record_sellertray_shift_cash_movement(
  p_tenant_id uuid,
  p_shift_id uuid,
  p_movement_type text,
  p_amount numeric,
  p_reference text,
  p_reason text,
  p_expense_category text,
  p_actor_user_id uuid
)
returns jsonb
language sql
security definer
set search_path=''
as $$
  select public.record_sellertray_shift_cash_movement(
    p_tenant_id,
    p_shift_id,
    p_movement_type,
    p_amount,
    p_reference,
    p_reason,
    p_expense_category,
    'internal:' || pg_catalog.md5(pg_catalog.concat_ws(
      '|',
      p_tenant_id::text,
      p_shift_id::text,
      lower(btrim(coalesce(p_movement_type,''))),
      round(coalesce(p_amount,0)::numeric,2)::text,
      btrim(coalesce(p_reference,'')),
      btrim(coalesce(p_reason,'')),
      btrim(coalesce(p_expense_category,'')),
      coalesce(p_actor_user_id::text,'')
    )),
    p_actor_user_id
  );
$$;

revoke all on function public.record_sellertray_shift_cash_movement(
  uuid,uuid,text,numeric,text,text,text,text,uuid
) from public,anon,authenticated;
grant execute on function public.record_sellertray_shift_cash_movement(
  uuid,uuid,text,numeric,text,text,text,text,uuid
) to service_role;

revoke all on function public.record_sellertray_shift_cash_movement(
  uuid,uuid,text,numeric,text,text,text,uuid
) from public,anon,authenticated;
grant execute on function public.record_sellertray_shift_cash_movement(
  uuid,uuid,text,numeric,text,text,text,uuid
) to service_role;

commit;
