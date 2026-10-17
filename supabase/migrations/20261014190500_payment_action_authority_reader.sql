begin;

-- Authenticated clients need a read-only, current-user view of payment action
-- authority so the mobile UI can hide actions that the server would reject.
-- The internal predicate remains service-role only; this wrapper binds the
-- actor to auth.uid() and reveals only a boolean decision.
create or replace function public.get_sellertray_order_payment_authority(
  p_tenant_id uuid,
  p_order_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null or p_tenant_id is null or p_order_id is null then
    return false;
  end if;

  return public.sellertray_user_can_manage_order_payment(
    p_tenant_id,
    p_order_id,
    v_user_id
  );
end;
$$;

revoke all on function public.get_sellertray_order_payment_authority(uuid,uuid)
  from public,anon;
grant execute on function public.get_sellertray_order_payment_authority(uuid,uuid)
  to authenticated,service_role;

commit;
