begin;

-- Preserve the current capability engine (including later capabilities such as
-- refunds) and only repair stale helper RPCs that historical environments may
-- still have from the earlier Owner/Manager-only implementations.
create or replace function public.sellertray_purchase_management_role(
  p_tenant_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select public.sellertray_user_has_capability(
    p_tenant_id,
    p_user_id,
    'can_manage_purchasing'
  );
$$;

revoke all on function public.sellertray_purchase_management_role(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.sellertray_purchase_management_role(uuid,uuid)
  to service_role;

create or replace function public.sellertray_user_can_manage_products(
  p_tenant_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select public.sellertray_user_has_capability(
    p_tenant_id,
    p_user_id,
    'can_manage_products'
  );
$$;

revoke all on function public.sellertray_user_can_manage_products(uuid,uuid)
  from public,anon;
grant execute on function public.sellertray_user_can_manage_products(uuid,uuid)
  to authenticated,service_role;

commit;
