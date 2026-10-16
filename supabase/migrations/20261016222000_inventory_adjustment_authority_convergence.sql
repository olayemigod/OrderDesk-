-- Browser and mobile inventory corrections use a narrower adjustment command.
-- The authoritative service-only inventory command remains available to governed server
-- workflows such as Purchase Receiving, while the public inventory Edge Function no longer
-- exposes a generic supplier-receipt action.

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

-- Preserve the established internal server authority, but never grant it to browser clients.
revoke all on function public.apply_sellertray_inventory_operation(uuid, uuid, uuid, uuid, text, numeric, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.apply_sellertray_inventory_operation(uuid, uuid, uuid, uuid, text, numeric, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.apply_sellertray_inventory_operation(uuid, uuid, uuid, uuid, text, numeric, text, text, text, uuid) to service_role;
grant execute on function public.apply_sellertray_inventory_operation(uuid, uuid, uuid, uuid, text, numeric, text, text, text, text, uuid) to service_role;
