begin;

-- Human payment mutations must satisfy both payment capability and current
-- operational Branch authority. Customer/webhook payment lifecycle paths do
-- not use this helper and therefore keep their existing self-service contract.
create or replace function public.sellertray_user_can_manage_order_payment(
  p_tenant_id uuid,
  p_order_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists(
    select 1
    from public.orders o
    where o.tenant_id=p_tenant_id
      and o.id=p_order_id
      and o.branch_id is not null
      and public.sellertray_user_has_capability(
        p_tenant_id,
        p_user_id,
        'can_manage_payments'
      )
      and public.sellertray_user_can_operate_branch(
        p_tenant_id,
        o.branch_id,
        p_user_id
      )
  );
$$;

revoke all on function public.sellertray_user_can_manage_order_payment(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.sellertray_user_can_manage_order_payment(uuid,uuid,uuid)
  to service_role;

-- Supersede the POS settlement version without changing its settlement
-- behaviour. The only authority change is that every human manual confirmation
-- must pass both payment capability and operational Branch scope.
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
  if not public.orderdesk_subscription_can_write(v_payment.tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  select * into v_order
  from public.orders o
  where o.tenant_id=v_payment.tenant_id
    and o.id=v_payment.order_id;

  if not found then
    raise exception 'SellerTray order not found' using errcode='22023';
  end if;

  if not public.sellertray_user_can_manage_order_payment(
    v_payment.tenant_id,
    v_order.id,
    p_actor_user_id
  ) then
    raise exception 'Payment management permission and Branch access are required' using errcode='42501';
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

  if v_order.source='pos' and v_payment.method_type='bank_transfer' then
    perform public.finalize_sellertray_pos_confirmed_payment(
      p_payment_id,
      p_actor_user_id
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
