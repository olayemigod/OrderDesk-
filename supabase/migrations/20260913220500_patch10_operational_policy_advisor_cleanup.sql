-- SellerTray Patch 10 advisor cleanup: stabilize auth RLS planning and cover new foreign keys.

drop policy if exists merchant_operational_policies_member_read
on public.merchant_operational_policies;

create policy merchant_operational_policies_member_read
on public.merchant_operational_policies
for select
to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = merchant_operational_policies.tenant_id
      and tm.user_id = (select auth.uid())
  )
);

create index if not exists merchant_notifications_payment_idx
  on public.merchant_notifications(payment_id)
  where payment_id is not null;

create index if not exists merchant_operational_policies_updated_by_idx
  on public.merchant_operational_policies(updated_by_user_id)
  where updated_by_user_id is not null;
