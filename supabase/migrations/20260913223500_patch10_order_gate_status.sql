-- SellerTray Patch 10: expose read-only order gate decisions to authenticated tenant members.

create or replace function public.sellertray_order_gate_status(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_tenant_id uuid;
  v_payment_status text;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select o.tenant_id, o.payment_status
  into v_tenant_id, v_payment_status
  from public.orders o
  where o.id = p_order_id;

  if v_tenant_id is null then
    raise exception 'Order not found';
  end if;

  if not exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = v_tenant_id
      and tm.user_id = v_user_id
  ) then
    raise exception 'SellerTray business membership required';
  end if;

  return jsonb_build_object(
    'orderId', p_order_id,
    'paymentStatus', v_payment_status,
    'processing', public.sellertray_payment_gate_decision(p_order_id, 'processing'),
    'ready', public.sellertray_payment_gate_decision(p_order_id, 'ready'),
    'dispatch', public.sellertray_payment_gate_decision(p_order_id, 'dispatch'),
    'complete', public.sellertray_payment_gate_decision(p_order_id, 'complete')
  );
end;
$$;

revoke all on function public.sellertray_order_gate_status(uuid) from public, anon;
grant execute on function public.sellertray_order_gate_status(uuid)
to authenticated, service_role;
