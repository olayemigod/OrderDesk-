begin;

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
  v_is_allocation boolean:=coalesce(new.idempotency_key,'') like 'pos-allocation:%';
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

  if v_is_allocation and new.status in ('initiated','pending_verification','confirmed') then
    select coalesce(sum(p.amount),0)::numeric(14,2)
    into v_reserved
    from public.order_payments p
    where p.tenant_id=new.tenant_id
      and p.order_id=new.order_id
      and p.id<>new.id
      and p.idempotency_key like 'pos-allocation:%'
      and p.status in ('initiated','pending_verification','confirmed');

    if v_reserved+new.amount>v_invoice.amount+0.005 then
      raise exception 'SellerTray payment allocations exceed the invoice amount' using errcode='23514';
    end if;
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

  if v_order.source='pos' and v_order.pos_checkout_command_id is null then
    if v_payment.method_type='bank_transfer' then
      perform public.finalize_sellertray_pos_confirmed_payment(
        p_payment_id,p_actor_user_id
      );
    end if;
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
