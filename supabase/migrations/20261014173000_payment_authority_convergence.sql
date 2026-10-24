begin;

create or replace function public.upsert_sellertray_payment_method(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_method_id uuid,
  p_method_type text,
  p_display_name text,
  p_is_enabled boolean,
  p_is_default boolean,
  p_sort_order integer,
  p_mode text,
  p_bank_name text,
  p_bank_account_name text,
  p_bank_account_number text,
  p_bank_code text,
  p_instructions text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_role text;
  v_id uuid;
  v_existing public.merchant_payment_methods%rowtype;
  v_status text;
  v_row public.merchant_payment_methods%rowtype;
begin
  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;

  if not public.sellertray_user_has_capability(p_tenant_id,p_actor_user_id,'can_manage_payments') then
    raise exception 'You do not have permission to manage payment methods' using errcode='42501';
  end if;

  -- Gateway credentials remain an Owner-only security boundary even when
  -- operational payment management is delegated.
  if p_method_type in ('paystack','flutterwave') and v_role<>'owner' then
    raise exception 'Only the business Owner can change gateway payment methods' using errcode='42501';
  end if;

  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  if p_method_id is not null then
    select * into v_existing
    from public.merchant_payment_methods m
    where m.id=p_method_id and m.tenant_id=p_tenant_id;

    if not found then
      raise exception 'SellerTray payment method not found' using errcode='22023';
    end if;

    if v_existing.method_type<>p_method_type then
      raise exception 'SellerTray payment method type is immutable' using errcode='23514';
    end if;

    v_status := v_existing.configuration_status;
    v_id := v_existing.id;
  else
    v_status := case when p_method_type in ('paystack','flutterwave') then 'credentials_required' else 'ready' end;
    v_id := gen_random_uuid();
  end if;

  if p_method_type='bank_transfer' then
    if nullif(btrim(coalesce(p_bank_name,'')),'') is null
       or nullif(btrim(coalesce(p_bank_account_name,'')),'') is null
       or nullif(btrim(coalesce(p_bank_account_number,'')),'') is null then
      raise exception 'Bank name, account name and account number are required' using errcode='22023';
    end if;
  end if;

  if p_method_type in ('paystack','flutterwave')
     and coalesce(p_is_enabled,false)
     and v_status<>'configured' then
    raise exception 'Connect gateway credentials before enabling this payment method' using errcode='23514';
  end if;

  if coalesce(p_is_default,false) then
    update public.merchant_payment_methods
    set is_default=false,updated_at=now(),updated_by_user_id=p_actor_user_id
    where tenant_id=p_tenant_id and id<>v_id and is_default=true;
  end if;

  insert into public.merchant_payment_methods (
    id,tenant_id,method_type,display_name,is_enabled,is_default,sort_order,mode,
    configuration_status,bank_name,bank_account_name,bank_account_number,bank_code,
    instructions,created_by_user_id,updated_by_user_id
  ) values (
    v_id,p_tenant_id,p_method_type,btrim(p_display_name),coalesce(p_is_enabled,false),
    coalesce(p_is_default,false),coalesce(p_sort_order,100)::smallint,coalesce(p_mode,'live'),
    v_status,
    case when p_method_type='bank_transfer' then nullif(btrim(p_bank_name),'') else null end,
    case when p_method_type='bank_transfer' then nullif(btrim(p_bank_account_name),'') else null end,
    case when p_method_type='bank_transfer' then nullif(btrim(p_bank_account_number),'') else null end,
    case when p_method_type='bank_transfer' then nullif(btrim(p_bank_code),'') else null end,
    nullif(btrim(p_instructions),''),p_actor_user_id,p_actor_user_id
  )
  on conflict (id) do update
  set display_name=excluded.display_name,
      is_enabled=excluded.is_enabled,
      is_default=excluded.is_default,
      sort_order=excluded.sort_order,
      mode=excluded.mode,
      bank_name=excluded.bank_name,
      bank_account_name=excluded.bank_account_name,
      bank_account_number=excluded.bank_account_number,
      bank_code=excluded.bank_code,
      instructions=excluded.instructions,
      updated_by_user_id=excluded.updated_by_user_id,
      updated_at=now()
  returning * into v_row;

  return jsonb_build_object(
    'id',v_row.id,'tenantId',v_row.tenant_id,'methodType',v_row.method_type,
    'displayName',v_row.display_name,'isEnabled',v_row.is_enabled,
    'isDefault',v_row.is_default,'sortOrder',v_row.sort_order,'mode',v_row.mode,
    'configurationStatus',v_row.configuration_status
  );
end;
$$;

create or replace function public.set_sellertray_payment_method_branches(
  p_tenant_id uuid,
  p_payment_method_id uuid,
  p_branch_ids uuid[],
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_branch_ids uuid[] := coalesce(p_branch_ids,array[]::uuid[]);
  v_invalid_count integer;
begin
  if p_tenant_id is null or p_payment_method_id is null or p_actor_user_id is null then
    raise exception 'Business, payment method and operator are required' using errcode='22023';
  end if;

  if not public.sellertray_user_has_capability(p_tenant_id,p_actor_user_id,'can_manage_payments') then
    raise exception 'You do not have permission to manage payment methods' using errcode='42501';
  end if;

  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  if not exists(
    select 1 from public.merchant_payment_methods m
    where m.tenant_id=p_tenant_id and m.id=p_payment_method_id
  ) then
    raise exception 'SellerTray payment method not found' using errcode='22023';
  end if;

  select count(*)::integer into v_invalid_count
  from unnest(v_branch_ids) branch_id
  where not exists(
    select 1 from public.branches b
    where b.tenant_id=p_tenant_id and b.id=branch_id and b.is_active=true
  );
  if v_invalid_count>0 then
    raise exception 'One or more selected branches are unavailable for this business' using errcode='23514';
  end if;

  update public.sellertray_branch_payment_methods
  set is_enabled=false,assigned_by_user_id=p_actor_user_id,updated_at=now()
  where tenant_id=p_tenant_id and payment_method_id=p_payment_method_id and is_enabled=true;

  insert into public.sellertray_branch_payment_methods(
    tenant_id,branch_id,payment_method_id,is_enabled,assigned_by_user_id,updated_at
  )
  select p_tenant_id,branch_id,p_payment_method_id,true,p_actor_user_id,now()
  from unnest(v_branch_ids) branch_id
  on conflict (tenant_id,branch_id,payment_method_id) do update
    set is_enabled=true,assigned_by_user_id=excluded.assigned_by_user_id,updated_at=now();

  return jsonb_build_object(
    'paymentMethodId',p_payment_method_id,
    'branchIds',coalesce((
      select jsonb_agg(x.branch_id order by x.branch_id)
      from public.sellertray_branch_payment_methods x
      where x.tenant_id=p_tenant_id and x.payment_method_id=p_payment_method_id and x.is_enabled=true
    ),'[]'::jsonb)
  );
end;
$$;

create or replace function public.confirm_sellertray_offline_payment(
  p_payment_id uuid,
  p_actor_user_id uuid,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_payment public.order_payments%rowtype;
  v_order public.orders%rowtype;
begin
  select * into v_payment
  from public.order_payments p
  where p.id=p_payment_id
  for update;

  if not found then
    raise exception 'SellerTray payment not found' using errcode='22023';
  end if;
  if v_payment.method_type not in ('bank_transfer','card_terminal','cash_on_delivery','pay_on_pickup','cash') then
    raise exception 'Only offline SellerTray payments can be confirmed manually' using errcode='23514';
  end if;
  if v_payment.status not in ('initiated','pending_verification') then
    raise exception 'SellerTray payment is not awaiting confirmation' using errcode='23514';
  end if;

  select * into v_order
  from public.orders o
  where o.tenant_id=v_payment.tenant_id and o.id=v_payment.order_id;
  if not found then
    raise exception 'SellerTray order not found' using errcode='22023';
  end if;

  if v_order.source='pos' then
    if v_order.branch_id is null
       or not public.sellertray_user_can_operate_branch(v_payment.tenant_id,v_order.branch_id,p_actor_user_id) then
      raise exception 'You do not have access to confirm this Branch payment' using errcode='42501';
    end if;
  elsif not public.sellertray_user_has_capability(v_payment.tenant_id,p_actor_user_id,'can_manage_payments') then
    raise exception 'You do not have permission to confirm this payment' using errcode='42501';
  end if;

  if not public.orderdesk_subscription_can_write(v_payment.tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  perform public.transition_sellertray_order_payment(
    p_payment_id,'confirmed','staff',p_actor_user_id,null,null
  );
  perform public.record_sellertray_payment_event(
    v_payment.tenant_id,v_payment.order_id,v_payment.id,v_payment.provider,
    'staff:' || v_payment.id::text || ':' || p_actor_user_id::text,
    'manual_confirmation','staff','verified',null,null,null,
    jsonb_build_object('note',left(coalesce(p_note,''),500))
  );
  return p_payment_id;
end;
$$;

revoke all on function public.upsert_sellertray_payment_method(uuid,uuid,uuid,text,text,boolean,boolean,integer,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.upsert_sellertray_payment_method(uuid,uuid,uuid,text,text,boolean,boolean,integer,text,text,text,text,text,text) to service_role;
revoke all on function public.set_sellertray_payment_method_branches(uuid,uuid,uuid[],uuid) from public,anon,authenticated;
grant execute on function public.set_sellertray_payment_method_branches(uuid,uuid,uuid[],uuid) to service_role;
revoke all on function public.confirm_sellertray_offline_payment(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.confirm_sellertray_offline_payment(uuid,uuid,text) to service_role;

commit;