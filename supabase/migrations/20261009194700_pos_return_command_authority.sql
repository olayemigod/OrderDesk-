-- Keep the implementation private and expose a management-authorized wrapper.
-- This ensures even an idempotent replay rechecks return authority before
-- returning return/refund identifiers.

alter function public.return_sellertray_pos_cash_sale(uuid,uuid,uuid,text)
  rename to apply_sellertray_pos_cash_return_internal;

revoke all on function public.apply_sellertray_pos_cash_return_internal(uuid,uuid,uuid,text)
  from public,anon,authenticated,service_role;

create or replace function public.return_sellertray_pos_cash_sale(
  p_tenant_id uuid,
  p_order_id uuid,
  p_actor_user_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_role text;
begin
  if p_tenant_id is null or p_order_id is null or p_actor_user_id is null then
    raise exception 'Business, sale and operator are required' using errcode='22023';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id
    and tm.user_id=p_actor_user_id;

  if v_role not in ('owner','manager') then
    raise exception 'Owner or manager approval is required to return a completed sale'
      using errcode='42501';
  end if;

  return public.apply_sellertray_pos_cash_return_internal(
    p_tenant_id,p_order_id,p_actor_user_id,p_reason
  );
end;
$$;

revoke all on function public.return_sellertray_pos_cash_sale(uuid,uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.return_sellertray_pos_cash_sale(uuid,uuid,uuid,text)
  to service_role;