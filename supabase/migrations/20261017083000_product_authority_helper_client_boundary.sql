-- Keep product capability evaluation internal to governed SellerTray commands.
-- Authenticated clients must use public management commands/read models rather
-- than evaluating another member's capability by supplying an arbitrary user ID.

revoke all on function public.sellertray_user_can_manage_products(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.sellertray_user_can_manage_products(uuid, uuid)
  to service_role;
