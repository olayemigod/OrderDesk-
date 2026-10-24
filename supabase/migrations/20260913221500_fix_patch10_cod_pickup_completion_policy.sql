-- SellerTray Patch 10: make COD/pickup completion switches authoritative.

create or replace function public.sellertray_payment_gate_decision(
  p_order_id uuid,
  p_stage text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_payment_status text;
  v_method text;
  v_policy public.merchant_operational_policies%rowtype;
  v_gate text := 'before_fulfillment';
  v_allow_cod_dispatch boolean := true;
  v_require_cod_complete boolean := true;
  v_allow_pickup_ready boolean := true;
  v_require_pickup_complete boolean := true;
begin
  select o.tenant_id, o.payment_status
  into v_tenant_id, v_payment_status
  from public.orders o
  where o.id = p_order_id;

  if v_tenant_id is null then
    return jsonb_build_object('allowed', false, 'reason', 'Order not found', 'paymentMethod', null);
  end if;

  select p.* into v_policy
  from public.merchant_operational_policies p
  where p.tenant_id = v_tenant_id;

  if found then
    v_gate := v_policy.payment_gate;
    v_allow_cod_dispatch := v_policy.allow_cod_dispatch_unpaid;
    v_require_cod_complete := v_policy.require_cod_payment_before_completion;
    v_allow_pickup_ready := v_policy.allow_pickup_ready_unpaid;
    v_require_pickup_complete := v_policy.require_pickup_payment_before_completion;
  end if;

  select op.method_type into v_method
  from public.order_payments op
  where op.tenant_id = v_tenant_id
    and op.order_id = p_order_id
    and op.status <> 'failed'
  order by op.created_at desc
  limit 1;

  if v_payment_status = 'paid' then
    return jsonb_build_object('allowed', true, 'reason', null, 'paymentMethod', v_method);
  end if;

  if p_stage = 'processing' then
    if v_gate = 'before_processing'
       and coalesce(v_method,'') not in ('cash_on_delivery','pay_on_pickup') then
      return jsonb_build_object(
        'allowed', false,
        'reason', 'Payment must be confirmed before this order can start processing.',
        'paymentMethod', v_method
      );
    end if;
    return jsonb_build_object('allowed', true, 'reason', null, 'paymentMethod', v_method);
  end if;

  if p_stage = 'ready' then
    if v_gate in ('before_processing','before_ready')
       and not (
         v_method = 'cash_on_delivery'
         or (v_method = 'pay_on_pickup' and v_allow_pickup_ready)
       ) then
      return jsonb_build_object(
        'allowed', false,
        'reason', 'Payment must be confirmed before this order can be marked ready.',
        'paymentMethod', v_method
      );
    end if;
    return jsonb_build_object('allowed', true, 'reason', null, 'paymentMethod', v_method);
  end if;

  if p_stage = 'dispatch' then
    if v_gate = 'none' then
      return jsonb_build_object('allowed', true, 'reason', null, 'paymentMethod', v_method);
    end if;

    if v_method = 'cash_on_delivery' then
      if v_allow_cod_dispatch then
        return jsonb_build_object('allowed', true, 'reason', null, 'paymentMethod', v_method);
      end if;
      return jsonb_build_object(
        'allowed', false,
        'reason', 'Cash-on-delivery dispatch is disabled by merchant policy.',
        'paymentMethod', v_method
      );
    end if;

    return jsonb_build_object(
      'allowed', false,
      'reason', 'Payment policy blocks dispatch until payment is confirmed.',
      'paymentMethod', v_method
    );
  end if;

  if p_stage = 'complete' then
    if v_method = 'cash_on_delivery' then
      if v_require_cod_complete then
        return jsonb_build_object(
          'allowed', false,
          'reason', 'Confirm cash-on-delivery payment before completing this order.',
          'paymentMethod', v_method
        );
      end if;
      return jsonb_build_object('allowed', true, 'reason', null, 'paymentMethod', v_method);
    end if;

    if v_method = 'pay_on_pickup' then
      if v_require_pickup_complete then
        return jsonb_build_object(
          'allowed', false,
          'reason', 'Confirm pickup payment before completing this order.',
          'paymentMethod', v_method
        );
      end if;
      return jsonb_build_object('allowed', true, 'reason', null, 'paymentMethod', v_method);
    end if;

    if v_gate <> 'none' then
      return jsonb_build_object(
        'allowed', false,
        'reason', 'Payment policy blocks completion until payment is confirmed.',
        'paymentMethod', v_method
      );
    end if;

    return jsonb_build_object('allowed', true, 'reason', null, 'paymentMethod', v_method);
  end if;

  return jsonb_build_object('allowed', true, 'reason', null, 'paymentMethod', v_method);
end;
$$;

revoke all on function public.sellertray_payment_gate_decision(uuid,text)
from public, anon, authenticated;
grant execute on function public.sellertray_payment_gate_decision(uuid,text)
to service_role;
