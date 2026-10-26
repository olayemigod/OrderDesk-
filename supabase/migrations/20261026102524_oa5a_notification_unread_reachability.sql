-- OA5A acceptance convergence: keep unread notification facts reachable through
-- the existing bounded inbox on every surface without introducing client-owned
-- unread truth or an unbounded notification query.
create or replace function public.sellertray_list_merchant_notifications(
  p_tenant_id uuid,
  p_limit integer default 50
)
returns table(
  id uuid,
  event_key text,
  severity text,
  title text,
  body text,
  order_id uuid,
  change_request_id uuid,
  source_inbound_message_id uuid,
  is_read boolean,
  created_at timestamptz,
  message_type text,
  action_label text,
  action_url text,
  campaign_id uuid
)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid:=auth.uid();
  v_role text;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;

  if v_role is null then raise exception 'SellerTray business membership required'; end if;

  return query
  select
    n.id,n.event_key,n.severity,n.title,n.body,
    n.order_id,n.change_request_id,n.source_inbound_message_id,
    exists (
      select 1 from public.merchant_notification_reads r
      where r.notification_id=n.id and r.user_id=v_user_id
    ) as is_read,
    n.created_at,n.message_type,n.action_label,n.action_url,n.campaign_id
  from public.merchant_notifications n
  where n.tenant_id=p_tenant_id
    and public.sellertray_current_user_can_access_notification_scope(n.tenant_id,n.branch_id)
    and (n.expires_at is null or n.expires_at>now())
    and (n.audience_roles is null or v_role=any(n.audience_roles))
  order by is_read asc,n.created_at desc,n.id desc
  limit greatest(1,least(coalesce(p_limit,50),200));
end;
$$;

revoke all on function public.sellertray_list_merchant_notifications(uuid,integer) from public,anon;
grant execute on function public.sellertray_list_merchant_notifications(uuid,integer) to authenticated,service_role;

comment on function public.sellertray_list_merchant_notifications(uuid,integer) is
  'Merchant notification inbox. Governed unread-first ordering keeps every unread notice reachable through the existing bounded list as read facts advance the window.';
