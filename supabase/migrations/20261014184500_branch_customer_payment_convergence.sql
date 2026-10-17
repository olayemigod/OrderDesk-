begin;

create or replace function public.sellertray_branch_customer_payment_methods(
  p_tenant_id uuid,
  p_branch_id uuid
)
returns table(
  id uuid,
  tenant_id uuid,
  method_type text,
  display_name text,
  is_enabled boolean,
  is_default boolean,
  sort_order integer,
  mode text,
  configuration_status text,
  bank_name text,
  bank_account_name text,
  bank_account_number text,
  bank_code text,
  instructions text,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path=''
as $$
  select
    m.id,
    m.tenant_id,
    m.method_type,
    m.display_name,
    m.is_enabled,
    m.is_default,
    m.sort_order::integer,
    m.mode,
    m.configuration_status,
    m.bank_name,
    m.bank_account_name,
    m.bank_account_number,
    m.bank_code,
    m.instructions,
    m.updated_at
  from public.branches b
  join public.sellertray_branch_payment_methods bpm
    on bpm.tenant_id=b.tenant_id
   and bpm.branch_id=b.id
   and bpm.is_enabled=true
  join public.merchant_payment_methods m
    on m.tenant_id=bpm.tenant_id
   and m.id=bpm.payment_method_id
   and m.is_enabled=true
  where b.tenant_id=p_tenant_id
    and b.id=p_branch_id
    and b.is_active=true
    and m.method_type in (
      'bank_transfer','paystack','flutterwave','cash_on_delivery','pay_on_pickup'
    )
    and (
      m.method_type not in ('paystack','flutterwave')
      or m.configuration_status='configured'
    )
  order by m.is_default desc,m.sort_order,m.created_at,m.id;
$$;

revoke all on function public.sellertray_branch_customer_payment_methods(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.sellertray_branch_customer_payment_methods(uuid,uuid)
  to service_role;

create or replace function public.get_sellertray_branch_customer_payment_methods(
  p_tenant_id uuid,
  p_branch_id uuid
)
returns table(
  id uuid,
  tenant_id uuid,
  method_type text,
  display_name text,
  is_enabled boolean,
  is_default boolean,
  sort_order integer,
  mode text,
  configuration_status text,
  bank_name text,
  bank_account_name text,
  bank_account_number text,
  bank_code text,
  instructions text,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;

  if not public.sellertray_user_can_read_branch(p_tenant_id,p_branch_id,v_user_id) then
    raise exception 'You do not have access to payment methods for this Branch' using errcode='42501';
  end if;

  return query
  select *
  from public.sellertray_branch_customer_payment_methods(p_tenant_id,p_branch_id);
end;
$$;

revoke all on function public.get_sellertray_branch_customer_payment_methods(uuid,uuid)
  from public,anon;
grant execute on function public.get_sellertray_branch_customer_payment_methods(uuid,uuid)
  to authenticated;

create or replace function public.create_sellertray_order_payment_for_method(
  p_tenant_id uuid,
  p_order_id uuid,
  p_payment_method_id uuid,
  p_status text default 'initiated',
  p_provider_reference text default null,
  p_idempotency_key text default null,
  p_customer_claimed_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_method public.merchant_payment_methods%rowtype;
  v_order public.orders%rowtype;
  v_invoice public.order_financial_documents%rowtype;
  v_payment_id uuid;
  v_existing public.order_payments%rowtype;
  v_idempotency_key text := nullif(btrim(p_idempotency_key),'');
begin
  if p_status not in ('initiated','pending_verification') then
    raise exception 'New SellerTray payment must start as initiated or pending verification' using errcode='22023';
  end if;

  select * into v_method
  from public.merchant_payment_methods m
  where m.id=p_payment_method_id
    and m.tenant_id=p_tenant_id
    and m.is_enabled=true;

  if not found then
    raise exception 'SellerTray payment method is not enabled' using errcode='23514';
  end if;

  if v_method.method_type in ('paystack','flutterwave')
     and v_method.configuration_status<>'configured' then
    raise exception 'SellerTray payment gateway is not configured' using errcode='23514';
  end if;

  if v_idempotency_key is not null then
    select * into v_existing
    from public.order_payments p
    where p.tenant_id=p_tenant_id
      and p.idempotency_key=v_idempotency_key;

    if found then
      if v_existing.order_id<>p_order_id
         or v_existing.payment_method_id<>p_payment_method_id then
        raise exception 'SellerTray payment idempotency key conflicts with another payment' using errcode='23505';
      end if;
      return v_existing.id;
    end if;
  end if;

  select * into v_order
  from public.orders o
  where o.id=p_order_id
    and o.tenant_id=p_tenant_id;

  if not found then
    raise exception 'SellerTray order not found' using errcode='22023';
  end if;
  if v_order.branch_id is null then
    raise exception 'SellerTray order requires a Branch before payment' using errcode='23514';
  end if;
  if v_order.payment_status='paid' then
    raise exception 'SellerTray order is already paid' using errcode='23514';
  end if;

  if not exists(
    select 1
    from public.branches b
    join public.sellertray_branch_payment_methods bpm
      on bpm.tenant_id=b.tenant_id
     and bpm.branch_id=b.id
     and bpm.is_enabled=true
    where b.tenant_id=p_tenant_id
      and b.id=v_order.branch_id
      and b.is_active=true
      and bpm.payment_method_id=p_payment_method_id
  ) then
    raise exception 'SellerTray payment method is not available for this Branch' using errcode='23514';
  end if;

  select * into v_invoice
  from public.order_financial_documents d
  where d.tenant_id=p_tenant_id
    and d.order_id=p_order_id
    and d.document_type='invoice'
    and d.status='issued';

  if not found or v_invoice.amount<=0 then
    raise exception 'SellerTray order has no payable invoice' using errcode='23514';
  end if;

  insert into public.order_payments (
    tenant_id,order_id,invoice_document_id,payment_method_id,
    method_type,provider,status,amount,currency,provider_reference,
    idempotency_key,customer_claimed_at
  ) values (
    p_tenant_id,p_order_id,v_invoice.id,p_payment_method_id,
    v_method.method_type,
    case
      when v_method.method_type in ('paystack','flutterwave') then v_method.method_type
      when v_method.method_type='bank_transfer' then 'manual_bank'
      when v_method.method_type='card_terminal' then 'manual_card'
      else 'merchant'
    end,
    p_status,v_invoice.amount,v_invoice.currency,nullif(btrim(p_provider_reference),''),
    v_idempotency_key,
    case when p_status='pending_verification' then coalesce(p_customer_claimed_at,now())
         else p_customer_claimed_at end
  )
  returning id into v_payment_id;

  return v_payment_id;
end;
$$;

revoke all on function public.create_sellertray_order_payment_for_method(uuid,uuid,uuid,text,text,text,timestamptz)
  from public,anon,authenticated;
grant execute on function public.create_sellertray_order_payment_for_method(uuid,uuid,uuid,text,text,text,timestamptz)
  to service_role;

commit;