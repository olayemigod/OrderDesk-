begin;

-- POS payment settlement is part of the in-person sale command and already
-- requires current operational Branch authority. Preserve that approved cashier
-- boundary while requiring the payment-management capability for customer-order
-- payment mutations outside POS.
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
      and public.sellertray_user_can_operate_branch(
        p_tenant_id,
        o.branch_id,
        p_user_id
      )
      and (
        o.source='pos'
        or public.sellertray_user_has_capability(
          p_tenant_id,
          p_user_id,
          'can_manage_payments'
        )
      )
  );
$$;

revoke all on function public.sellertray_user_can_manage_order_payment(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.sellertray_user_can_manage_order_payment(uuid,uuid,uuid)
  to service_role;

commit;
