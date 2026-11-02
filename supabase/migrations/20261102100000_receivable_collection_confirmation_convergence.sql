begin;

-- Correct the receivable orchestrator; the shared allocator still rejects an
-- initially confirmed allocation. No historical payment or invoice is rewritten.
create or replace function public.collect_sellertray_customer_receivable(
  p_tenant_id uuid,
  p_order_id uuid,
  p_payment_method_id uuid,
  p_amount numeric,
  p_command_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid:=auth.uid();
  v_order public.orders%rowtype;
  v_method text;
  v_status text;
  v_payment public.order_payments%rowtype;
  v_payment_id uuid;
  v_amount numeric:=round(coalesce(p_amount,0),2);
  v_outstanding numeric;
  v_reserved numeric;
begin
  if v_user_id is null then raise exception 'SellerTray authentication required' using errcode='42501'; end if;
  if p_command_id is null then raise exception 'Payment command identity is required' using errcode='22023'; end if;
  if v_amount<=0 or v_amount::text in ('NaN','Infinity','-Infinity') then raise exception 'Payment amount must be greater than zero' using errcode='22023'; end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then raise exception 'SellerTray subscription is read-only' using errcode='42501'; end if;

  select * into v_order
  from public.orders o
  where o.tenant_id=p_tenant_id and o.id=p_order_id and o.deleted_at is null
  for update;
  if not found then raise exception 'Sale not found' using errcode='P0002'; end if;
  if v_order.status<>'completed' or v_order.customer_id is null then
    raise exception 'Only a completed named-customer sale can receive a balance payment' using errcode='23514';
  end if;
  if not public.sellertray_user_can_manage_order_payment(p_tenant_id,v_order.id,v_user_id) then
    raise exception 'You do not have permission to collect this customer balance' using errcode='42501';
  end if;

  -- Serialize both first execution and replay on the sale before inspecting
  -- the command. Authorization above also applies to an existing command.
  select * into v_payment
  from public.order_payments p
  where p.tenant_id=p_tenant_id and p.idempotency_key='receivable:'||p_command_id::text;
  if found then
    if v_payment.order_id<>p_order_id
       or v_payment.payment_method_id is distinct from p_payment_method_id
       or v_payment.amount<>v_amount then
      raise exception 'SellerTray payment command conflicts with an existing allocation' using errcode='23505';
    end if;
    return jsonb_build_object(
      'paymentId',v_payment.id,'orderId',p_order_id,'amount',v_payment.amount,
      'methodType',v_payment.method_type,'status',v_payment.status,'idempotentReplay',true
    );
  end if;

  v_outstanding:=greatest(
    coalesce(v_order.total_amount,0)-coalesce(v_order.returned_amount,0)-coalesce(v_order.amount_paid,0),
    0
  );
  if v_amount>v_outstanding+0.005 then
    raise exception 'Payment exceeds the outstanding customer balance' using errcode='23514';
  end if;

  -- Pending attempts reserve money as well, including earlier Bank collections.
  -- Keep the net-of-returns receivable authoritative, not the original invoice.
  select coalesce(sum(p.amount),0) into v_reserved
  from public.order_payments p
  where p.tenant_id=p_tenant_id and p.order_id=p_order_id
    and p.status in ('initiated','pending_verification');
  if v_amount+v_reserved>v_outstanding+0.005 then
    raise exception 'Payment exceeds the unreserved customer balance' using errcode='23514';
  end if;

  if p_payment_method_id is null then
    v_method:='cash';
    v_status:='initiated';
  else
    select m.method_type into v_method
    from public.sellertray_branch_payment_methods bpm
    join public.merchant_payment_methods m on m.tenant_id=bpm.tenant_id and m.id=bpm.payment_method_id
    where bpm.tenant_id=p_tenant_id
      and bpm.branch_id=v_order.branch_id
      and bpm.payment_method_id=p_payment_method_id
      and bpm.is_enabled=true
      and m.is_enabled=true
      and m.method_type in('bank_transfer','card_terminal');
    if not found then raise exception 'Payment method is not enabled for this Branch' using errcode='23514'; end if;
    v_status:=case when v_method='bank_transfer' then 'pending_verification' else 'initiated' end;
  end if;

  v_payment_id:=public.sellertray_record_pos_payment_allocation(
    p_tenant_id,p_order_id,p_payment_method_id,v_amount,v_status,v_user_id,'receivable:'||p_command_id::text
  );
  if v_status='initiated' then
    -- Reuse the existing confirmation authority, including manual Terminal
    -- permission, canonical payment event and duplicate-safe POS finalization.
    perform public.confirm_sellertray_offline_payment(v_payment_id,v_user_id,null);
  end if;

  select * into strict v_payment
  from public.order_payments p
  where p.tenant_id=p_tenant_id and p.id=v_payment_id;
  return jsonb_build_object(
    'paymentId',v_payment.id,'orderId',p_order_id,'amount',v_payment.amount,
    'methodType',v_payment.method_type,'status',v_payment.status,'idempotentReplay',false
  );
end;
$$;

revoke all on function public.collect_sellertray_customer_receivable(uuid,uuid,uuid,numeric,uuid) from public,anon;
grant execute on function public.collect_sellertray_customer_receivable(uuid,uuid,uuid,numeric,uuid) to authenticated,service_role;

commit;
