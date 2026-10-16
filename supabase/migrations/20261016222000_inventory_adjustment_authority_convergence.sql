-- Generic stock receipt must not bypass Purchase Receiving or Stock Transfer receiving.
-- Keep controlled corrections available through a narrower service-only adjustment command.

create or replace function public.apply_sellertray_stock_adjustment(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_catalog_item_id uuid,
  p_uom_id uuid,
  p_quantity numeric,
  p_adjustment_direction text,
  p_reference text,
  p_reason text,
  p_command_id text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.apply_sellertray_inventory_operation(
    p_tenant_id,
    p_branch_id,
    p_catalog_item_id,
    p_uom_id,
    'adjust',
    p_quantity,
    p_adjustment_direction,
    p_reference,
    p_reason,
    p_command_id,
    p_actor_user_id
  );
end;
$$;

revoke all on function public.apply_sellertray_stock_adjustment(uuid, uuid, uuid, uuid, numeric, text, text, text, text, uuid) from public;
revoke all on function public.apply_sellertray_stock_adjustment(uuid, uuid, uuid, uuid, numeric, text, text, text, text, uuid) from anon;
revoke all on function public.apply_sellertray_stock_adjustment(uuid, uuid, uuid, uuid, numeric, text, text, text, text, uuid) from authenticated;
grant execute on function public.apply_sellertray_stock_adjustment(uuid, uuid, uuid, uuid, numeric, text, text, text, text, uuid) to service_role;

-- Retire both generic operation overloads from runtime callers. The narrower wrapper above
-- remains able to invoke the owned function for controlled adjustments only.
revoke execute on function public.apply_sellertray_inventory_operation(uuid, uuid, uuid, uuid, text, numeric, text, text, text, uuid) from service_role;
revoke execute on function public.apply_sellertray_inventory_operation(uuid, uuid, uuid, uuid, text, numeric, text, text, text, text, uuid) from service_role;
revoke all on function public.apply_sellertray_inventory_operation(uuid, uuid, uuid, uuid, text, numeric, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.apply_sellertray_inventory_operation(uuid, uuid, uuid, uuid, text, numeric, text, text, text, text, uuid) from public, anon, authenticated;
