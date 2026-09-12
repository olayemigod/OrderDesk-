-- The order total sync routine is a trigger implementation detail.
-- It is SECURITY DEFINER so it can keep orders.total_amount aligned with order_items,
-- but it must never be exposed as a callable Data API RPC.

revoke all on function public.sync_sellertray_order_total_from_items()
from public, anon, authenticated, service_role;
