-- SellerTray agreement package processing is an internal server-side queue/state table.
-- The self-healing migration created a service_role-only RLS policy but also revoked
-- the underlying table privilege from service_role. commercial-billing reads this
-- table after governed RPCs to report package-processing state, so PostgreSQL rejects
-- the direct server-side read before RLS can authorize it.
--
-- Preserve the internal-only boundary: browser roles remain denied and service_role
-- receives only the SELECT privilege required by the current runtime read path.

revoke all on table public.sellertray_agreement_package_processing from anon, authenticated;
grant select on table public.sellertray_agreement_package_processing to service_role;
