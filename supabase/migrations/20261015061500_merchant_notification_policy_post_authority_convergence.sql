begin;

-- The internal-authority hardening migration intentionally rewrites notification
-- RLS to current-user wrappers. Re-apply the richer communications predicates
-- afterwards so Branch authority, audience targeting and expiry all remain true
-- at the final migration head on both clean and historically drifted databases.
drop policy if exists merchant_notifications_member_read on public.merchant_notifications;
drop policy if exists merchant_notifications_select_member on public.merchant_notifications;
drop policy if exists merchant_notifications_update_member on public.merchant_notifications;

create policy merchant_notifications_select_member
on public.merchant_notifications
for select to authenticated
using (
  public.sellertray_current_user_can_access_notification_scope(
    merchant_notifications.tenant_id,
    merchant_notifications.branch_id
  )
  and (merchant_notifications.expires_at is null or merchant_notifications.expires_at > now())
  and exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = merchant_notifications.tenant_id
      and tm.user_id = (select auth.uid())
      and (
        merchant_notifications.audience_roles is null
        or tm.role = any(merchant_notifications.audience_roles)
      )
  )
);

create policy merchant_notifications_update_member
on public.merchant_notifications
for update to authenticated
using (
  public.sellertray_current_user_can_access_notification_scope(
    merchant_notifications.tenant_id,
    merchant_notifications.branch_id
  )
  and (merchant_notifications.expires_at is null or merchant_notifications.expires_at > now())
  and exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = merchant_notifications.tenant_id
      and tm.user_id = (select auth.uid())
      and (
        merchant_notifications.audience_roles is null
        or tm.role = any(merchant_notifications.audience_roles)
      )
  )
)
with check (
  public.sellertray_current_user_can_access_notification_scope(
    merchant_notifications.tenant_id,
    merchant_notifications.branch_id
  )
  and (merchant_notifications.expires_at is null or merchant_notifications.expires_at > now())
  and exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = merchant_notifications.tenant_id
      and tm.user_id = (select auth.uid())
      and (
        merchant_notifications.audience_roles is null
        or tm.role = any(merchant_notifications.audience_roles)
      )
  )
);

drop policy if exists merchant_notification_reads_own on public.merchant_notification_reads;
create policy merchant_notification_reads_own
on public.merchant_notification_reads
for all to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.merchant_notifications n
    join public.tenant_members tm
      on tm.tenant_id = n.tenant_id
     and tm.user_id = (select auth.uid())
    where n.id = merchant_notification_reads.notification_id
      and n.tenant_id = merchant_notification_reads.tenant_id
      and public.sellertray_current_user_can_access_notification_scope(
        n.tenant_id,
        n.branch_id
      )
      and (n.expires_at is null or n.expires_at > now())
      and (n.audience_roles is null or tm.role = any(n.audience_roles))
  )
)
with check (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.merchant_notifications n
    join public.tenant_members tm
      on tm.tenant_id = n.tenant_id
     and tm.user_id = (select auth.uid())
    where n.id = merchant_notification_reads.notification_id
      and n.tenant_id = merchant_notification_reads.tenant_id
      and public.sellertray_current_user_can_access_notification_scope(
        n.tenant_id,
        n.branch_id
      )
      and (n.expires_at is null or n.expires_at > now())
      and (n.audience_roles is null or tm.role = any(n.audience_roles))
  )
);

commit;
