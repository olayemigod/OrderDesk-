-- Remove a legacy tenant-wide notification read policy that can survive on
-- older SellerTray databases and bypass Branch-scoped notification RLS through
-- PostgreSQL's permissive-policy OR semantics.
--
-- Current installations do not create this policy, so this is intentionally
-- idempotent and only repairs historical schema drift.
drop policy if exists merchant_notifications_member_read
on public.merchant_notifications;
