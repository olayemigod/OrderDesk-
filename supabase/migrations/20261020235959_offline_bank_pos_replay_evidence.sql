begin;

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
  v_provider_reference text;
  v_offline_captured_at_raw text;
  v_offline_captured_at timestamptz;
  v_existing_provider_reference text;
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
    v_provider_reference:=nullif(btrim(coalesce(v_row->>'providerReference','')),'');
    v_offline_captured_at_raw:=nullif(btrim(coalesce(v_row->>'offlineCapturedAt','')),'');
    v_offline_captured_at:=null;

    if (v_provider_reference is null)<>(v_offline_captured_at_raw is null) then
      raise exception 'Offline Bank evidence requires both transfer reference and captured time' using errcode='22023';
    end if;
    if v_provider_reference is not null then
      if length(v_provider_reference)>128
         or v_provider_reference!~'^[A-Za-z0-9._:-]+$' then
        raise exception 'Enter a valid Bank transfer reference' using errcode='22023';
      end if;
      begin
        v_offline_captured_at:=v_offline_captured_at_raw::timestamptz;
      exception when others then
        raise exception 'Offline Bank evidence has an invalid captured time' using errcode='22023';
      end;
      if v_offline_captured_at>now()+interval '5 minutes' then
        raise exception 'Offline Bank evidence captured time cannot be in the future' using errcode='22023';
      end if;
    end if;

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

    if v_provider_reference is not null then
      if v_method_type<>'bank_transfer' or v_confirm_now then
        raise exception 'Offline Bank evidence can only be recorded for an unconfirmed Bank payment' using errcode='23514';
      end if;
    end if;

    v_payment_id:=public.sellertray_record_pos_payment_allocation(
      p_tenant_id,p_order_id,v_method_id,v_amount,v_start_status,p_actor_user_id,
      'pos-allocation:'||p_command_id::text||':'||v_index::text
    );

    if v_provider_reference is not null then
      select p.provider_reference into v_existing_provider_reference
      from public.order_payments p
      where p.tenant_id=p_tenant_id and p.id=v_payment_id
      for update;

      if v_existing_provider_reference is not null
         and v_existing_provider_reference<>v_provider_reference then
        raise exception 'SellerTray provider reference conflicts with the existing payment evidence' using errcode='23505';
      end if;

      if v_existing_provider_reference is null then
        update public.order_payments
        set provider_reference=v_provider_reference,
            customer_claimed_at=v_offline_captured_at,
            updated_at=now()
        where tenant_id=p_tenant_id and id=v_payment_id;
      end if;

      perform public.record_sellertray_payment_event(
        p_tenant_id,p_order_id,v_payment_id,'manual_bank',
        'offline-bank-evidence:'||p_command_id::text||':'||v_index::text,
        'offline_bank_evidence','staff','received',null,null,null,
        jsonb_build_object(
          'checkout_command_id',p_command_id,
          'allocation_index',v_index,
          'provider_reference',v_provider_reference,
          'captured_at',v_offline_captured_at,
          'payment_method_id',v_method_id,
          'source','mobile_offline_pos'
        )
      );
    end if;

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

commit;
