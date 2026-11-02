-- SellerTray agreement package processing is an internal server-side queue/state table.
-- The original hosted self-healing migration enabled RLS, created no client policies,
-- and revoked all direct table privileges, including service_role. commercial-billing
-- reads this table after governed RPCs to report package-processing state, so the
-- server-side read is rejected before the runtime can return Billing state.
--
-- Preserve the internal-only boundary: browser roles remain denied and service_role
-- receives only the SELECT privilege required by the current server read path.

revoke all on table public.sellertray_agreement_package_processing from anon, authenticated;
grant select on table public.sellertray_agreement_package_processing to service_role;
