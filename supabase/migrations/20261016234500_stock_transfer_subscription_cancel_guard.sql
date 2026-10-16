-- Keep every stock-transfer mutation behind the same writable-subscription boundary.
-- Create, dispatch and receive already enforce this rule; cancellation must not become a
-- mutation bypass while a business is read-only.

create or replace function public.cancel_sellertray_stock_transfer(
  p_tenant_id uuid,
  p_stock_transfer_id uuid,
  p_reason text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_transfer public.stock_transfers%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason,'')),'');
begin
  if p_tenant_id is null or p_stock_transfer_id is null or p_actor_user_id is null
     or v_reason is null then
    raise exception 'Business, stock transfer, reason and operator are required'
      using errcode='22023';
  end if;
  if char_length(v_reason)>500 then
    raise exception 'Cancellation reason is too long' using errcode='22023';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  select * into v_transfer
  from public.stock_transfers st
  where st.tenant_id=p_tenant_id and st.id=p_stock_transfer_id
  for update;
  if not found then raise exception 'Stock transfer not found' using errcode='22023'; end if;

  if not public.sellertray_user_has_capability(
    p_tenant_id,p_actor_user_id,'can_transfer_stock'
  ) or not public.sellertray_user_can_operate_branch(
    p_tenant_id,v_transfer.source_branch_id,p_actor_user_id
  ) then
    raise exception 'You do not have permission to cancel this stock transfer'
      using errcode='42501';
  end if;

  if v_transfer.status='cancelled' then
    return jsonb_build_object(
      'transferId',p_stock_transfer_id,'status','cancelled','idempotentReplay',true
    );
  end if;
  if v_transfer.status<>'draft' then
    raise exception 'Only a draft stock transfer can be cancelled. Receive dispatched stock before creating a return transfer.'
      using errcode='23514';
  end if;

  update public.stock_transfers
  set status='cancelled',cancelled_by_user_id=p_actor_user_id,
      cancelled_at=now(),cancel_reason=v_reason,updated_at=now()
  where tenant_id=p_tenant_id and id=p_stock_transfer_id;

  return jsonb_build_object(
    'transferId',p_stock_transfer_id,'status','cancelled','idempotentReplay',false
  );
end;
$$;

revoke all on function public.cancel_sellertray_stock_transfer(uuid,uuid,text,uuid)
  from public,anon,authenticated;
grant execute on function public.cancel_sellertray_stock_transfer(uuid,uuid,text,uuid)
  to service_role;
