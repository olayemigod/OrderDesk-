-- SellerTray P0 audit hardening: manual money confirmation is a management action.

create or replace function public.confirm_sellertray_offline_payment(
  p_payment_id uuid,
  p_actor_user_id uuid,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_payment public.order_payments%rowtype;
  v_actor_role text;
begin
  select * into v_payment
  from public.order_payments p
  where p.id=p_payment_id
  for update;

  if not found then
    raise exception 'SellerTray payment not found' using errcode='22023';
  end if;

  if v_payment.method_type not in ('bank_transfer','cash_on_delivery','pay_on_pickup') then
    raise exception 'Only offline SellerTray payments can be confirmed manually' using errcode='23514';
  end if;

  if v_payment.status not in ('initiated','pending_verification') then
    raise exception 'SellerTray payment is not awaiting confirmation' using errcode='23514';
  end if;

  select tm.role into v_actor_role
  from public.tenant_members tm
  where tm.tenant_id=v_payment.tenant_id
    and tm.user_id=p_actor_user_id;

  if v_actor_role not in ('owner','manager') then
    raise exception 'Owner or Manager permission is required to confirm an offline payment' using errcode='42501';
  end if;

  perform public.transition_sellertray_order_payment(
    p_payment_id,
    'confirmed',
    'merchant',
    p_actor_user_id,
    null,
    null
  );

  perform public.record_sellertray_payment_event(
    v_payment.tenant_id,
    v_payment.order_id,
    v_payment.id,
    v_payment.provider,
    'merchant:' || v_payment.id::text || ':' || p_actor_user_id::text,
    'manual_confirmation',
    'merchant',
    'verified',
    null,
    null,
    null,
    jsonb_build_object(
      'note', left(coalesce(p_note,''),500),
      'actor_role', v_actor_role
    )
  );

  return p_payment_id;
end;
$function$;

revoke all on function public.confirm_sellertray_offline_payment(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.confirm_sellertray_offline_payment(uuid,uuid,text) to service_role;
