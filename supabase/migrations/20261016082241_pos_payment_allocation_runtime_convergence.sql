begin;

alter table public.orders
  add column if not exists pos_payment_terms text,
  add column if not exists pos_checkout_command_id uuid,
  add column if not exists pos_checkout_request_hash text;

alter table public.orders
  drop constraint if exists orders_pos_payment_terms_check,
  drop constraint if exists orders_pos_checkout_command_pair_check;

alter table public.orders
  add constraint orders_pos_payment_terms_check
    check (
      pos_payment_terms is null
      or (source='pos' and pos_payment_terms in ('immediate','partial','pay_later'))
    ),
  add constraint orders_pos_checkout_command_pair_check
    check (
      (pos_checkout_command_id is null and pos_checkout_request_hash is null)
      or (
        source='pos'
        and pos_checkout_command_id is not null
        and pos_checkout_request_hash ~ '^[0-9a-f]{32}$'
      )
    );

create or replace function public.guard_sellertray_payment_transition()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_invoice public.order_financial_documents%rowtype;
  v_order_payment_status text;
  v_reserved numeric(14,2):=0;
begin
  select * into v_invoice
  from public.order_financial_documents d
  where d.id=new.invoice_document_id
    and d.tenant_id=new.tenant_id
    and d.order_id=new.order_id
    and d.document_type='invoice';

  if not found then
    raise exception 'SellerTray invoice not found for payment' using errcode='23503';
  end if;
  if v_invoice.status<>'issued' then
    raise exception 'SellerTray invoice is not payable' using errcode='23514';
  end if;
  if new.currency<>v_invoice.currency or new.amount<=0 or new.amount>v_invoice.amount then
    raise exception 'SellerTray payment amount must be positive, use invoice currency and not exceed the invoice amount'
      using errcode='23514';
  end if;

  select coalesce(sum(p.amount),0)::numeric(14,2)
  into v_reserved
  from public.order_payments p
  where p.tenant_id=new.tenant_id
    and p.order_id=new.order_id
    and p.id<>new.id
    and p.status in ('initiated','pending_verification','confirmed');

  if new.status in ('initiated','pending_verification','confirmed')
     and v_reserved+new.amount>v_invoice.amount+0.005 then
    raise exception 'SellerTray payment allocations exceed the invoice amount' using errcode='23514';
  end if;

  select o.payment_status into v_order_payment_status
  from public.orders o
  where o.id=new.order_id and o.tenant_id=new.tenant_id;

  if v_order_payment_status in ('paid','payment_issue') then
    if tg_op='INSERT' then
      raise exception 'SellerTray order already has settled or exceptional payment value' using errcode='23514';
    end if;
    if tg_op='UPDATE'
       and old.status<>'confirmed'
       and new.status not in ('cancelled','expired') then
      raise exception 'SellerTray order already has settled or exceptional payment value' using errcode='23514';
    end if;
  end if;

  if tg_op='UPDATE' then
    if new.tenant_id is distinct from old.tenant_id
       or new.order_id is distinct from old.order_id
       or new.invoice_document_id is distinct from old.invoice_document_id
       or new.method_type is distinct from old.method_type
       or new.provider is distinct from old.provider
       or new.amount is distinct from old.amount
       or new.currency is distinct from old.currency
       or new.idempotency_key is distinct from old.idempotency_key
       or new.created_at is distinct from old.created_at then
      raise exception 'SellerTray payment identity is immutable' using errcode='23514';
    end if;

    if old.provider_reference is not null
       and new.provider_reference is distinct from old.provider_reference then
      raise exception 'SellerTray provider reference is immutable once recorded' using errcode='23514';
    end if;

    if old.status in ('confirmed','failed','cancelled','expired')
       and new.status is distinct from old.status then
      raise exception 'SellerTray payment status % is terminal',old.status using errcode='23514';
    end if;

    if new.status is distinct from old.status then
      if old.status='initiated'
         and new.status not in ('pending_verification','confirmed','failed','cancelled','expired') then
        raise exception 'Invalid SellerTray payment transition: % -> %',old.status,new.status using errcode='23514';
      end if;
      if old.status='pending_verification'
         and new.status not in ('confirmed','failed','cancelled','expired') then
        raise exception 'Invalid SellerTray payment transition: % -> %',old.status,new.status using errcode='23514';
      end if;
    end if;
  end if;

  if new.status='confirmed' then
    new.confirmed_at:=coalesce(new.confirmed_at,now());
    if new.confirmation_source is null then
      raise exception 'Confirmed SellerTray payment requires confirmation source' using errcode='23514';
    end if;
    if new.confirmation_source='staff' and new.confirmed_by_user_id is null then
      raise exception 'Staff-confirmed SellerTray payment requires staff user' using errcode='23514';
    end if;
  else
    new.confirmed_at:=null;
    new.confirmation_source:=null;
    new.confirmed_by_user_id:=null;
  end if;

  new.updated_at:=now();
  return new;
end;
$$;

create or replace function public.sync_sellertray_order_payment_state()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order_id uuid;
  v_tenant_id uuid;
  v_amount_paid numeric(14,2);
  v_confirmed_at timestamptz;
  v_payment_status text;
  v_invoice public.order_financial_documents%rowtype;
  v_settlement_payment_id uuid;
  v_has_exception boolean;
  v_has_pending_verification boolean;
  v_has_initiated boolean;
begin
  if tg_op='DELETE' then
    v_order_id:=old.order_id;
    v_tenant_id:=old.tenant_id;
  else
    v_order_id:=new.order_id;
    v_tenant_id:=new.tenant_id;
  end if;

  select * into v_invoice
  from public.order_financial_documents d
  where d.tenant_id=v_tenant_id
    and d.order_id=v_order_id
    and d.document_type='invoice'
    and d.status='issued';

  select
    coalesce(sum(p.amount) filter(
      where p.status='confirmed' and p.exception_state='none'
    ),0)::numeric(14,2),
    max(p.confirmed_at) filter(
      where p.status='confirmed' and p.exception_state='none'
    ),
    coalesce(bool_or(p.exception_state<>'none'),false),
    coalesce(bool_or(p.status='pending_verification'),false),
    coalesce(bool_or(p.status='initiated'),false)
  into
    v_amount_paid,v_confirmed_at,v_has_exception,
    v_has_pending_verification,v_has_initiated
  from public.order_payments p
  where p.tenant_id=v_tenant_id and p.order_id=v_order_id;

  v_payment_status:=case
    when v_has_exception then 'payment_issue'
    when v_invoice.id is not null and v_amount_paid>=v_invoice.amount-0.005 then 'paid'
    when v_has_pending_verification then 'verification_required'
    when v_amount_paid>0 or v_has_initiated then 'pending'
    else 'unpaid'
  end;

  update public.orders
  set payment_status=v_payment_status,
      amount_paid=v_amount_paid,
      payment_confirmed_at=v_confirmed_at,
      updated_at=now()
  where id=v_order_id and tenant_id=v_tenant_id;

  if v_payment_status='paid' then
    if v_invoice.id is null then
      raise exception 'Paid SellerTray order is missing issued invoice' using errcode='23514';
    end if;

    select p.id into v_settlement_payment_id
    from public.order_payments p
    where p.tenant_id=v_tenant_id
      and p.order_id=v_order_id
      and p.status='confirmed'
      and p.exception_state='none'
    order by p.confirmed_at desc,p.id desc
    limit 1;

    insert into public.order_financial_documents(
      tenant_id,order_id,document_type,document_reference,currency,amount,status,payment_id
    ) values(
      v_tenant_id,v_order_id,'receipt','',v_invoice.currency,v_invoice.amount,'issued',v_settlement_payment_id
    )
    on conflict(order_id,document_type) do nothing;
  end if;

  return null;
end;
$$;

create or replace function public.cancel_sellertray_competing_payment_attempts()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_paid boolean:=false;
begin
  if new.status='confirmed'
     and (tg_op='INSERT' or old.status is distinct from new.status) then
    select o.payment_status='paid'
    into v_paid
    from public.orders o
    where o.tenant_id=new.tenant_id and o.id=new.order_id;

    if coalesce(v_paid,false) then
      update public.order_payments p
      set status='cancelled',
          failure_reason='Superseded after invoice was fully paid by payment '||new.id::text,
          updated_at=now()
      where p.tenant_id=new.tenant_id
        and p.order_id=new.order_id
        and p.id<>new.id
        and p.status in ('initiated','pending_verification');
    end if;
  end if;
  return null;
end;
$$;

create or replace function public.queue_sellertray_payment_confirmation()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_business_name text;
  v_phone_number_id text;
  v_customer_wa_id text;
  v_customer_id uuid;
  v_order_ref text;
  v_receipt_ref text;
  v_currency text;
  v_amount numeric(14,2);
  v_last_inbound timestamptz;
  v_window_expires timestamptz;
  v_initial_status text;
  v_formatted_amount text;
  v_order_payment_status text;
begin
  if new.status<>'confirmed' or old.status is not distinct from new.status then
    return new;
  end if;

  select o.payment_status into v_order_payment_status
  from public.orders o
  where o.id=new.order_id and o.tenant_id=new.tenant_id;
  if v_order_payment_status<>'paid' then
    return new;
  end if;

  select t.name,t.whatsapp_phone_number_id,c.wa_id,c.id,o.public_order_id
  into v_business_name,v_phone_number_id,v_customer_wa_id,v_customer_id,v_order_ref
  from public.orders o
  join public.tenants t on t.id=o.tenant_id
  join public.customers c on c.id=o.customer_id and c.tenant_id=o.tenant_id
  where o.id=new.order_id and o.tenant_id=new.tenant_id;

  if v_phone_number_id is null or v_customer_wa_id is null or v_customer_wa_id like 'manual:%' then
    return new;
  end if;

  select d.document_reference,d.currency,d.amount
  into v_receipt_ref,v_currency,v_amount
  from public.order_financial_documents d
  where d.tenant_id=new.tenant_id
    and d.order_id=new.order_id
    and d.document_type='receipt'
    and d.status='issued';

  if v_receipt_ref is null then
    raise exception 'SellerTray fully paid order is missing financial receipt' using errcode='23514';
  end if;

  select max(im.received_at) into v_last_inbound
  from public.inbound_messages im
  where im.tenant_id=new.tenant_id and im.customer_id=v_customer_id;

  if v_last_inbound is not null then
    v_window_expires:=v_last_inbound+interval '24 hours';
  end if;
  v_initial_status:=case
    when v_window_expires is null or v_window_expires<=now() then 'template_required'
    else 'pending'
  end;
  v_currency:=coalesce(v_currency,new.currency,'NGN');
  v_formatted_amount:=case
    when v_currency='NGN' then '₦'||trim(to_char(coalesce(v_amount,new.amount),'FM999,999,999,990.00'))
    else v_currency||' '||trim(to_char(coalesce(v_amount,new.amount),'FM999,999,999,990.00'))
  end;

  insert into public.outbound_notifications(
    tenant_id,order_id,customer_id,event_key,delivery_status,
    from_phone_number_id,to_wa_id,message_body,conversation_window_expires_at
  ) values(
    new.tenant_id,new.order_id,v_customer_id,'payment_confirmed',v_initial_status,
    v_phone_number_id,v_customer_wa_id,
    format(
      'Payment confirmed for order %s with %s. Amount: %s. Receipt: %s. You can ask for your payment receipt anytime.',
      v_order_ref,v_business_name,v_formatted_amount,v_receipt_ref
    ),
    v_window_expires
  )
  on conflict do nothing;

  return new;
end;
$$;

create or replace function public.sellertray_payment_gate_decision(
  p_order_id uuid,
  p_stage text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order public.orders%rowtype;
  v_method text;
  v_policy public.merchant_operational_policies%rowtype;
  v_gate text:='before_fulfillment';
  v_allow_cod_dispatch boolean:=true;
  v_require_cod_complete boolean:=true;
  v_allow_pickup_ready boolean:=true;
  v_require_pickup_complete boolean:=true;
  v_allow_partial boolean:=false;
  v_allow_pay_later boolean:=false;
  v_actor_user_id uuid:=auth.uid();
  v_actor_role text:=coalesce(auth.jwt()->>'role','');
begin
  select * into v_order
  from public.orders o
  where o.id=p_order_id;
  if not found then
    return jsonb_build_object('allowed',false,'reason','Order not found','paymentMethod',null);
  end if;

  if v_actor_role<>'service_role' then
    if v_actor_user_id is null or not exists(
      select 1 from public.tenant_members tm
      where tm.tenant_id=v_order.tenant_id and tm.user_id=v_actor_user_id
    ) then
      raise exception 'Not authorized for this order' using errcode='42501';
    end if;
  end if;

  select * into v_policy
  from public.merchant_operational_policies p
  where p.tenant_id=v_order.tenant_id;
  if found then
    v_gate:=v_policy.payment_gate;
    v_allow_cod_dispatch:=v_policy.allow_cod_dispatch_unpaid;
    v_require_cod_complete:=v_policy.require_cod_payment_before_completion;
    v_allow_pickup_ready:=v_policy.allow_pickup_ready_unpaid;
    v_require_pickup_complete:=v_policy.require_pickup_payment_before_completion;
    v_allow_partial:=v_policy.allow_pos_partial_payments;
    v_allow_pay_later:=v_policy.allow_pos_pay_later;
  end if;

  select op.method_type into v_method
  from public.order_payments op
  where op.tenant_id=v_order.tenant_id
    and op.order_id=p_order_id
    and op.status<>'failed'
  order by op.created_at desc
  limit 1;

  if v_order.payment_status='paid' then
    return jsonb_build_object('allowed',true,'reason',null,'paymentMethod',v_method);
  end if;

  if v_order.source='pos' then
    if v_order.pos_payment_terms='partial'
       and v_allow_partial
       and coalesce(v_order.amount_paid,0)>0 then
      return jsonb_build_object('allowed',true,'reason',null,'paymentMethod',v_method);
    end if;
    if v_order.pos_payment_terms='pay_later' and v_allow_pay_later then
      return jsonb_build_object('allowed',true,'reason',null,'paymentMethod',v_method);
    end if;
  end if;

  if p_stage='processing' then
    if v_gate='before_processing'
       and coalesce(v_method,'') not in ('cash_on_delivery','pay_on_pickup') then
      return jsonb_build_object(
        'allowed',false,
        'reason','Payment must be confirmed before this order can start processing.',
        'paymentMethod',v_method
      );
    end if;
    return jsonb_build_object('allowed',true,'reason',null,'paymentMethod',v_method);
  end if;

  if p_stage='ready' then
    if v_gate in ('before_processing','before_ready')
       and not(
         v_method='cash_on_delivery'
         or (v_method='pay_on_pickup' and v_allow_pickup_ready)
       ) then
      return jsonb_build_object(
        'allowed',false,
        'reason','Payment must be confirmed before this order can be marked ready.',
        'paymentMethod',v_method
      );
    end if;
    return jsonb_build_object('allowed',true,'reason',null,'paymentMethod',v_method);
  end if;

  if p_stage='dispatch' then
    if v_gate='none' then
      return jsonb_build_object('allowed',true,'reason',null,'paymentMethod',v_method);
    end if;
    if v_method='cash_on_delivery' then
      if v_allow_cod_dispatch then
        return jsonb_build_object('allowed',true,'reason',null,'paymentMethod',v_method);
      end if;
      return jsonb_build_object(
        'allowed',false,
        'reason','Cash-on-delivery dispatch is disabled by merchant policy.',
        'paymentMethod',v_method
      );
    end if;
    return jsonb_build_object(
      'allowed',false,
      'reason','Payment policy blocks dispatch until payment is confirmed.',
      'paymentMethod',v_method
    );
  end if;

  if p_stage='complete' then
    if v_method='cash_on_delivery' then
      if v_require_cod_complete then
        return jsonb_build_object(
          'allowed',false,
          'reason','Confirm cash-on-delivery payment before completing this order.',
          'paymentMethod',v_method
        );
      end if;
      return jsonb_build_object('allowed',true,'reason',null,'paymentMethod',v_method);
    end if;
    if v_method='pay_on_pickup' then
      if v_require_pickup_complete then
        return jsonb_build_object(
          'allowed',false,
          'reason','Confirm pickup payment before completing this order.',
          'paymentMethod',v_method
        );
      end if;
      return jsonb_build_object('allowed',true,'reason',null,'paymentMethod',v_method);
    end if;
    if v_gate<>'none' then
      return jsonb_build_object(
        'allowed',false,
        'reason','Payment policy blocks completion until payment is confirmed.',
        'paymentMethod',v_method
      );
    end if;
    return jsonb_build_object('allowed',true,'reason',null,'paymentMethod',v_method);
  end if;

  return jsonb_build_object('allowed',true,'reason',null,'paymentMethod',v_method);
end;
$$;

create or replace function public.sellertray_record_pos_payment_allocation(
  p_tenant_id uuid,
  p_order_id uuid,
  p_payment_method_id uuid,
  p_amount numeric,
  p_status text,
  p_actor_user_id uuid,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order public.orders%rowtype;
  v_invoice public.order_financial_documents%rowtype;
  v_method public.merchant_payment_methods%rowtype;
  v_existing public.order_payments%rowtype;
  v_payment_id uuid;
  v_method_type text;
  v_provider text;
  v_key text:=nullif(btrim(p_idempotency_key),'');
begin
  if p_tenant_id is null or p_order_id is null or p_actor_user_id is null
     or p_amount is null or p_amount<=0 or v_key is null then
    raise exception 'Sale, payment amount, operator and payment command are required' using errcode='22023';
  end if;
  if p_status not in ('initiated','pending_verification') then
    raise exception 'Invalid POS payment start state' using errcode='22023';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  select * into v_existing
  from public.order_payments p
  where p.tenant_id=p_tenant_id and p.idempotency_key=v_key;
  if found then
    if v_existing.order_id<>p_order_id
       or v_existing.payment_method_id is distinct from p_payment_method_id
       or abs(v_existing.amount-p_amount)>0.005 then
      raise exception 'SellerTray payment command conflicts with an existing allocation' using errcode='23505';
    end if;
    return v_existing.id;
  end if;

  select * into v_order
  from public.orders o
  where o.tenant_id=p_tenant_id and o.id=p_order_id
  for update;
  if not found or v_order.source<>'pos' or v_order.branch_id is null then
    raise exception 'SellerTray POS sale not found' using errcode='22023';
  end if;
  if not public.sellertray_user_can_operate_branch(
    p_tenant_id,v_order.branch_id,p_actor_user_id
  ) then
    raise exception 'You do not have access to take payments in this Branch' using errcode='42501';
  end if;
  if v_order.payment_status='paid' then
    raise exception 'SellerTray order is already paid' using errcode='23514';
  end if;

  select * into v_invoice
  from public.order_financial_documents d
  where d.tenant_id=p_tenant_id
    and d.order_id=p_order_id
    and d.document_type='invoice'
    and d.status='issued';
  if not found then
    raise exception 'SellerTray order has no payable invoice' using errcode='23514';
  end if;

  if p_payment_method_id is null then
    v_method_type:='cash';
    v_provider:='pos_cash';
  else
    select * into v_method
    from public.merchant_payment_methods m
    where m.tenant_id=p_tenant_id
      and m.id=p_payment_method_id
      and m.is_enabled=true;
    if not found or v_method.method_type not in ('bank_transfer','card_terminal') then
      raise exception 'Selected payment method is not available for POS allocation' using errcode='23514';
    end if;
    if not exists(
      select 1 from public.sellertray_branch_payment_methods bpm
      where bpm.tenant_id=p_tenant_id
        and bpm.branch_id=v_order.branch_id
        and bpm.payment_method_id=p_payment_method_id
        and bpm.is_enabled=true
    ) then
      raise exception 'Selected payment method is not assigned to this Branch' using errcode='23514';
    end if;
    v_method_type:=v_method.method_type;
    v_provider:=case
      when v_method_type='bank_transfer' then 'manual_bank'
      else 'manual_card'
    end;
  end if;

  insert into public.order_payments(
    tenant_id,order_id,invoice_document_id,payment_method_id,
    method_type,provider,status,amount,currency,idempotency_key,customer_claimed_at
  ) values(
    p_tenant_id,p_order_id,v_invoice.id,p_payment_method_id,
    v_method_type,v_provider,p_status,p_amount,v_invoice.currency,v_key,
    case when p_status='pending_verification' then now() else null end
  )
  returning id into v_payment_id;

  return v_payment_id;
end;
$$;

revoke all on function public.sellertray_record_pos_payment_allocation(
  uuid,uuid,uuid,numeric,text,uuid,text
) from public,anon,authenticated;
grant execute on function public.sellertray_record_pos_payment_allocation(
  uuid,uuid,uuid,numeric,text,uuid,text
) to service_role;

create or replace function public.sellertray_finalize_pos_order_if_allowed(
  p_tenant_id uuid,
  p_order_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order public.orders%rowtype;
  v_policy public.merchant_operational_policies%rowtype;
  v_stock_location_id uuid;
  v_existing integer;
  v_expected integer;
  v_on_hand numeric(18,6);
  v_item record;
  v_line record;
  v_count integer:=0;
  v_allowed boolean:=false;
  v_outstanding numeric(14,2);
begin
  select * into v_order
  from public.orders o
  where o.tenant_id=p_tenant_id and o.id=p_order_id
  for update;
  if not found or v_order.source<>'pos' or v_order.branch_id is null then
    raise exception 'SellerTray POS sale not found' using errcode='22023';
  end if;
  if not public.sellertray_user_can_operate_branch(
    p_tenant_id,v_order.branch_id,p_actor_user_id
  ) then
    raise exception 'You do not have access to complete sales from this Branch' using errcode='42501';
  end if;

  select * into v_policy
  from public.merchant_operational_policies p
  where p.tenant_id=p_tenant_id;

  v_outstanding:=greatest(
    coalesce(v_order.total_amount,0)-coalesce(v_order.amount_paid,0),0
  )::numeric(14,2);
  v_allowed:=v_order.payment_status='paid'
    or (
      v_order.pos_payment_terms='partial'
      and coalesce(v_policy.allow_pos_partial_payments,false)
      and coalesce(v_order.amount_paid,0)>0
    )
    or (
      v_order.pos_payment_terms='pay_later'
      and coalesce(v_policy.allow_pos_pay_later,false)
    );

  select count(*)::integer into v_expected
  from public.order_items oi
  where oi.tenant_id=p_tenant_id and oi.order_id=p_order_id;
  select count(*)::integer into v_existing
  from public.inventory_movements im
  where im.tenant_id=p_tenant_id
    and im.reference_type='order'
    and im.reference_id=p_order_id::text
    and im.movement_type='sale';

  if v_order.status='completed' then
    if v_order.fulfillment_status='collected' and v_existing=v_expected then
      return jsonb_build_object(
        'completed',true,
        'orderId',p_order_id,
        'status','completed',
        'paymentStatus',v_order.payment_status,
        'amountPaid',coalesce(v_order.amount_paid,0),
        'outstandingAmount',v_outstanding,
        'inventoryMovementCount',v_existing,
        'idempotentReplay',true
      );
    end if;
    raise exception 'Completed POS sale has inconsistent stock or fulfilment state' using errcode='23514';
  end if;

  if not v_allowed then
    return jsonb_build_object(
      'completed',false,
      'orderId',p_order_id,
      'status',v_order.status,
      'paymentStatus',v_order.payment_status,
      'amountPaid',coalesce(v_order.amount_paid,0),
      'outstandingAmount',v_outstanding,
      'inventoryMovementCount',0,
      'idempotentReplay',false
    );
  end if;
  if v_order.status<>'accepted' then
    raise exception 'POS sale is not ready for finalisation' using errcode='23514';
  end if;
  if v_expected<1 then
    raise exception 'POS sale has no items' using errcode='23514';
  end if;
  if v_existing>0 then
    raise exception 'POS sale already has stock activity' using errcode='23514';
  end if;

  select sl.id into v_stock_location_id
  from public.stock_locations sl
  where sl.tenant_id=p_tenant_id
    and sl.branch_id=v_order.branch_id
    and sl.is_default=true
    and sl.is_active=true
  order by sl.created_at,sl.id
  limit 1;
  if v_stock_location_id is null then
    raise exception 'POS Branch has no active default stock location' using errcode='23514';
  end if;

  for v_item in
    select oi.catalog_item_id,
           sum(oi.stock_quantity)::numeric(18,6) as required_quantity,
           max(ci.name) as product_name
    from public.order_items oi
    join public.catalog_items ci
      on ci.tenant_id=oi.tenant_id and ci.id=oi.catalog_item_id
    where oi.tenant_id=p_tenant_id and oi.order_id=p_order_id
    group by oi.catalog_item_id
    order by oi.catalog_item_id
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        p_tenant_id::text||':'||v_order.branch_id::text||':'||
        v_stock_location_id::text||':'||v_item.catalog_item_id::text,0
      )
    );
    select coalesce(sum(im.quantity_delta),0)::numeric(18,6)
    into v_on_hand
    from public.inventory_movements im
    where im.tenant_id=p_tenant_id
      and im.branch_id=v_order.branch_id
      and im.stock_location_id=v_stock_location_id
      and im.catalog_item_id=v_item.catalog_item_id;
    if v_on_hand<v_item.required_quantity then
      raise exception 'Insufficient stock for %: % available, % required',
        coalesce(v_item.product_name,'product'),v_on_hand,v_item.required_quantity
        using errcode='23514';
    end if;
  end loop;

  for v_line in
    select * from public.order_items oi
    where oi.tenant_id=p_tenant_id and oi.order_id=p_order_id
    order by oi.id
  loop
    if v_line.catalog_item_id is null
       or v_line.selected_uom is null
       or v_line.quantity<=0
       or v_line.conversion_factor<=0
       or v_line.stock_quantity<=0 then
      raise exception 'POS sale line has incomplete UOM stock snapshot' using errcode='23514';
    end if;

    perform public.record_sellertray_inventory_movement(
      p_tenant_id,v_order.branch_id,v_stock_location_id,v_line.catalog_item_id,
      'sale',-v_line.stock_quantity,v_line.selected_uom,v_line.quantity,
      v_line.conversion_factor,'order',p_order_id::text,
      'pos-sale:'||p_order_id::text||':'||v_line.id::text,
      now(),p_actor_user_id,'Counter sale',
      jsonb_build_object(
        'order_id',p_order_id,
        'public_order_id',v_order.public_order_id,
        'order_item_id',v_line.id,
        'payment_terms',v_order.pos_payment_terms,
        'amount_paid',v_order.amount_paid,
        'unit_price',v_line.unit_price
      ),
      null
    );
    v_count:=v_count+1;
  end loop;

  update public.orders
  set status='processing',updated_at=now()
  where tenant_id=p_tenant_id and id=p_order_id;
  update public.orders
  set status='ready',updated_at=now()
  where tenant_id=p_tenant_id and id=p_order_id;
  update public.orders
  set status='completed',
      fulfillment_method='customer_pickup',
      fulfillment_status='collected',
      fulfilled_at=now(),
      fulfillment_confirmed_by='merchant',
      updated_at=now()
  where tenant_id=p_tenant_id and id=p_order_id;

  select * into v_order
  from public.orders o
  where o.tenant_id=p_tenant_id and o.id=p_order_id;
  v_outstanding:=greatest(
    coalesce(v_order.total_amount,0)-coalesce(v_order.amount_paid,0),0
  )::numeric(14,2);

  return jsonb_build_object(
    'completed',true,
    'orderId',p_order_id,
    'status','completed',
    'paymentStatus',v_order.payment_status,
    'amountPaid',coalesce(v_order.amount_paid,0),
    'outstandingAmount',v_outstanding,
    'inventoryMovementCount',v_count,
    'idempotentReplay',false
  );
end;
$$;

revoke all on function public.sellertray_finalize_pos_order_if_allowed(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.sellertray_finalize_pos_order_if_allowed(uuid,uuid,uuid)
  to service_role;

create or replace function public.checkout_sellertray_pos_sale(
  p_tenant_id uuid,
  p_order_id uuid,
  p_allocations jsonb,
  p_pay_later boolean,
  p_actor_user_id uuid,
  p_command_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order public.orders%rowtype;
  v_policy public.merchant_operational_policies%rowtype;
  v_invoice_id uuid;
  v_invoice public.order_financial_documents%rowtype;
  v_hash text;
  v_existing_command uuid;
  v_existing_hash text;
  v_count integer;
  v_total_requested numeric(14,2):=0;
  v_row jsonb;
  v_amount numeric(14,2);
  v_method_id uuid;
  v_confirm_now boolean;
  v_method_type text;
  v_start_status text;
  v_payment_id uuid;
  v_index integer:=0;
  v_term text;
  v_final jsonb;
  v_payments jsonb;
  v_outstanding numeric(14,2);
begin
  if p_tenant_id is null or p_order_id is null
     or p_actor_user_id is null or p_command_id is null then
    raise exception 'Business, sale, operator and payment command are required' using errcode='22023';
  end if;
  if p_allocations is null or jsonb_typeof(p_allocations)<>'array'
     or jsonb_array_length(p_allocations)>10 then
    raise exception 'Payment allocations must be a list of up to 10 methods' using errcode='22023';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  v_hash:=md5(p_allocations::text||':'||coalesce(p_pay_later,false)::text);
  select * into v_order
  from public.orders o
  where o.tenant_id=p_tenant_id and o.id=p_order_id
  for update;
  if not found or v_order.source<>'pos' or v_order.branch_id is null then
    raise exception 'SellerTray POS sale not found' using errcode='22023';
  end if;
  if not public.sellertray_user_can_operate_branch(
    p_tenant_id,v_order.branch_id,p_actor_user_id
  ) then
    raise exception 'You do not have access to complete sales from this Branch' using errcode='42501';
  end if;

  v_existing_command:=v_order.pos_checkout_command_id;
  v_existing_hash:=v_order.pos_checkout_request_hash;
  if v_existing_command is not null then
    if v_existing_command<>p_command_id or v_existing_hash<>v_hash then
      raise exception 'This saved sale already has a different payment command' using errcode='23505';
    end if;
  elsif v_order.status<>'draft' then
    raise exception 'Only a draft POS sale can start checkout' using errcode='23514';
  end if;

  select * into v_policy
  from public.merchant_operational_policies p
  where p.tenant_id=p_tenant_id;
  v_count:=jsonb_array_length(p_allocations);
  if v_count>1 and not coalesce(v_policy.allow_pos_split_payments,true) then
    raise exception 'Split payment is disabled in SellerTray settings' using errcode='42501';
  end if;

  for v_row in select value from jsonb_array_elements(p_allocations)
  loop
    begin
      v_amount:=nullif(v_row->>'amount','')::numeric;
    exception when invalid_text_representation then
      raise exception 'Enter a valid payment amount' using errcode='22023';
    end;
    if v_amount is null or v_amount<=0 then
      raise exception 'Each payment allocation must be greater than zero' using errcode='22023';
    end if;
    v_total_requested:=v_total_requested+v_amount;
  end loop;

  if v_existing_command is null then
    update public.orders
    set pos_checkout_command_id=p_command_id,
        pos_checkout_request_hash=v_hash,
        updated_at=now()
    where tenant_id=p_tenant_id and id=p_order_id;
    update public.orders
    set status='accepted',updated_at=now()
    where tenant_id=p_tenant_id and id=p_order_id;
  end if;

  v_invoice_id:=public.ensure_sellertray_invoice_for_order(p_order_id);
  select * into v_invoice
  from public.order_financial_documents d
  where d.tenant_id=p_tenant_id and d.id=v_invoice_id and d.status='issued';
  if not found or v_invoice.amount<=0 then
    raise exception 'POS sale has no payable invoice' using errcode='23514';
  end if;
  if v_total_requested>v_invoice.amount+0.005 then
    raise exception 'Payment allocations exceed the amount due' using errcode='23514';
  end if;

  if v_total_requested<v_invoice.amount-0.005 then
    if v_count=0 then
      if not coalesce(p_pay_later,false)
         or not coalesce(v_policy.allow_pos_pay_later,false) then
        raise exception 'Pay later is disabled in SellerTray settings' using errcode='42501';
      end if;
      v_term:='pay_later';
    else
      if not coalesce(v_policy.allow_pos_partial_payments,false) then
        raise exception 'Partial payment is disabled in SellerTray settings' using errcode='42501';
      end if;
      v_term:='partial';
    end if;
  else
    if v_count=0 then
      raise exception 'Add a payment or choose Pay later' using errcode='22023';
    end if;
    v_term:='immediate';
  end if;

  if coalesce(p_pay_later,false)
     and v_total_requested>0
     and v_total_requested<v_invoice.amount-0.005 then
    if not coalesce(v_policy.allow_pos_partial_payments,false)
       or not coalesce(v_policy.allow_pos_pay_later,false) then
      raise exception 'A deposit with remaining balance requires Partial payment and Pay later to be enabled'
        using errcode='42501';
    end if;
    v_term:='partial';
  elsif coalesce(p_pay_later,false)
        and v_total_requested>=v_invoice.amount-0.005 then
    raise exception 'Pay later is unnecessary when the sale is fully allocated' using errcode='22023';
  end if;

  update public.orders
  set pos_payment_terms=v_term,updated_at=now()
  where tenant_id=p_tenant_id and id=p_order_id;

  for v_row in select value from jsonb_array_elements(p_allocations)
  loop
    v_index:=v_index+1;
    begin
      v_amount:=nullif(v_row->>'amount','')::numeric;
      v_method_id:=case
        when nullif(v_row->>'paymentMethodId','') is null then null
        else (v_row->>'paymentMethodId')::uuid
      end;
      v_confirm_now:=coalesce((v_row->>'confirmNow')::boolean,false);
    exception when invalid_text_representation then
      raise exception 'Payment allocation is invalid' using errcode='22023';
    end;

    if v_method_id is null then
      v_method_type:='cash';
      v_start_status:='initiated';
      v_confirm_now:=true;
    else
      select m.method_type into v_method_type
      from public.merchant_payment_methods m
      where m.tenant_id=p_tenant_id
        and m.id=v_method_id
        and m.is_enabled=true;
      if v_method_type not in ('bank_transfer','card_terminal') then
        raise exception 'Payment method is not available for POS' using errcode='23514';
      end if;
      if v_confirm_now
         and not public.sellertray_user_can_confirm_pos_manual_payment(
           p_tenant_id,p_order_id,p_actor_user_id
         ) then
        raise exception 'This payment requires confirmation by an authorised payment manager'
          using errcode='42501';
      end if;
      v_start_status:=case
        when v_confirm_now then 'initiated'
        else 'pending_verification'
      end;
    end if;

    v_payment_id:=public.sellertray_record_pos_payment_allocation(
      p_tenant_id,p_order_id,v_method_id,v_amount,v_start_status,p_actor_user_id,
      'pos-allocation:'||p_command_id::text||':'||v_index::text
    );

    if v_confirm_now then
      if exists(
        select 1 from public.order_payments p
        where p.id=v_payment_id and p.status in ('initiated','pending_verification')
      ) then
        perform public.transition_sellertray_order_payment(
          v_payment_id,'confirmed','staff',p_actor_user_id,null,null
        );
        perform public.record_sellertray_payment_event(
          p_tenant_id,p_order_id,v_payment_id,
          case
            when v_method_type='cash' then 'pos_cash'
            when v_method_type='bank_transfer' then 'manual_bank'
            else 'manual_card'
          end,
          'pos-allocation-confirm:'||p_command_id::text||':'||v_index::text,
          'manual_confirmation','staff','verified',null,null,null,
          jsonb_build_object(
            'checkout_command_id',p_command_id,
            'allocation_index',v_index
          )
        );
      end if;
    end if;
  end loop;

  v_final:=public.sellertray_finalize_pos_order_if_allowed(
    p_tenant_id,p_order_id,p_actor_user_id
  );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'paymentId',p.id,
        'paymentMethodId',p.payment_method_id,
        'methodType',p.method_type,
        'status',p.status,
        'amount',p.amount
      ) order by p.created_at,p.id
    ),
    '[]'::jsonb
  )
  into v_payments
  from public.order_payments p
  where p.tenant_id=p_tenant_id
    and p.order_id=p_order_id
    and p.idempotency_key like 'pos-allocation:'||p_command_id::text||':%';

  select * into v_order
  from public.orders o
  where o.tenant_id=p_tenant_id and o.id=p_order_id;
  v_outstanding:=greatest(
    coalesce(v_order.total_amount,0)-coalesce(v_order.amount_paid,0),0
  )::numeric(14,2);

  return jsonb_build_object(
    'orderId',p_order_id,
    'status',case
      when v_order.status='completed' then 'completed'
      else 'awaiting_payment_confirmation'
    end,
    'paymentStatus',v_order.payment_status,
    'fulfillmentStatus',v_order.fulfillment_status,
    'amountPaid',coalesce(v_order.amount_paid,0),
    'outstandingAmount',v_outstanding,
    'paymentTerms',v_order.pos_payment_terms,
    'payments',v_payments,
    'inventoryMovementCount',coalesce((v_final->>'inventoryMovementCount')::integer,0),
    'idempotentReplay',coalesce((v_final->>'idempotentReplay')::boolean,false)
  );
end;
$$;

revoke all on function public.checkout_sellertray_pos_sale(
  uuid,uuid,jsonb,boolean,uuid,uuid
) from public,anon,authenticated;
grant execute on function public.checkout_sellertray_pos_sale(
  uuid,uuid,jsonb,boolean,uuid,uuid
) to service_role;

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
  if v_payment.method_type not in (
    'bank_transfer','card_terminal','cash_on_delivery','pay_on_pickup','cash'
  ) then
    raise exception 'Only offline SellerTray payments can be confirmed manually' using errcode='23514';
  end if;
  if v_payment.status not in ('initiated','pending_verification') then
    raise exception 'SellerTray payment is not awaiting confirmation' using errcode='23514';
  end if;
  if not public.orderdesk_subscription_can_write(v_payment.tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  select * into v_order
  from public.orders o
  where o.tenant_id=v_payment.tenant_id and o.id=v_payment.order_id;
  if not found then
    raise exception 'SellerTray order not found' using errcode='22023';
  end if;

  if v_order.source='pos' then
    if v_payment.method_type='cash' then
      if v_order.branch_id is null
         or not public.sellertray_user_can_operate_branch(
           v_payment.tenant_id,v_order.branch_id,p_actor_user_id
         ) then
        raise exception 'You do not have access to take cash payments in this Branch'
          using errcode='42501';
      end if;
    elsif not public.sellertray_user_can_confirm_pos_manual_payment(
      v_payment.tenant_id,v_order.id,p_actor_user_id
    ) then
      raise exception 'You do not have permission to confirm manual payments for this Branch'
        using errcode='42501';
    end if;
  elsif not public.sellertray_user_can_manage_order_payment(
    v_payment.tenant_id,v_order.id,p_actor_user_id
  ) then
    raise exception 'Payment management permission and Branch access are required'
      using errcode='42501';
  end if;

  perform public.transition_sellertray_order_payment(
    p_payment_id,'confirmed','staff',p_actor_user_id,null,null
  );
  perform public.record_sellertray_payment_event(
    v_payment.tenant_id,v_payment.order_id,v_payment.id,v_payment.provider,
    'staff:'||v_payment.id::text||':'||p_actor_user_id::text,
    'manual_confirmation','staff','verified',null,null,null,
    jsonb_build_object('note',left(coalesce(p_note,''),500))
  );

  if v_order.source='pos'
     and v_payment.method_type='bank_transfer'
     and v_order.pos_checkout_command_id is null then
    perform public.finalize_sellertray_pos_confirmed_payment(
      p_payment_id,p_actor_user_id
    );
  elsif v_order.source='pos' then
    perform public.sellertray_finalize_pos_order_if_allowed(
      v_payment.tenant_id,v_order.id,p_actor_user_id
    );
  end if;

  return p_payment_id;
end;
$$;

revoke all on function public.confirm_sellertray_offline_payment(uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.confirm_sellertray_offline_payment(uuid,uuid,text)
  to service_role;

commit;
