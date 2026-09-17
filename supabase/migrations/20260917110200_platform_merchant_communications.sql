-- SellerTray platform-to-merchant communications.
-- Reuses the existing merchant notification inbox, per-user read state, push queue,
-- retries, badges and Expo delivery worker.

create table if not exists public.platform_merchant_campaigns (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete restrict,
  message_type text not null check (message_type in ('update','service','information','promotion')),
  severity text not null default 'info' check (severity in ('info','attention','urgent')),
  title text not null check (char_length(title) between 1 and 160),
  body text not null check (char_length(body) between 1 and 1000),
  action_label text null check (action_label is null or char_length(action_label) between 1 and 60),
  action_url text null check (
    action_url is null or
    action_url ~ '^https://[^[:space:]]+$' or
    action_url ~ '^sellertray://[A-Za-z0-9/_?=&.%-]+$'
  ),
  audience_roles text[] null check (
    audience_roles is null or
    (cardinality(audience_roles)>0 and audience_roles <@ array['owner','manager','staff']::text[])
  ),
  target_tenant_ids uuid[] null,
  expires_at timestamptz null,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.platform_merchant_campaigns enable row level security;
revoke all on public.platform_merchant_campaigns from public, anon, authenticated;
grant select,insert on public.platform_merchant_campaigns to service_role;

alter table public.merchant_notifications
  add column if not exists campaign_id uuid null references public.platform_merchant_campaigns(id) on delete set null,
  add column if not exists message_type text not null default 'operational',
  add column if not exists action_label text null,
  add column if not exists action_url text null,
  add column if not exists audience_roles text[] null,
  add column if not exists expires_at timestamptz null;

alter table public.merchant_notifications drop constraint if exists merchant_notifications_event_check;
alter table public.merchant_notifications add constraint merchant_notifications_event_check check (
  event_key = any(array[
    'new_whatsapp_order','order_change_request','new_whatsapp_message',
    'payment_verification_required','payment_confirmed','payment_failed','payment_exception','payment_gate_blocked',
    'customer_complaint','refund_request','catalogue_enquiry','customer_enquiry','workflow_clarification',
    'platform_update','platform_service','platform_information','platform_promotion'
  ]::text[])
);

alter table public.merchant_notifications drop constraint if exists merchant_notifications_message_type_check;
alter table public.merchant_notifications add constraint merchant_notifications_message_type_check check (
  message_type in ('operational','update','service','information','promotion')
);

alter table public.merchant_notifications drop constraint if exists merchant_notifications_action_label_check;
alter table public.merchant_notifications add constraint merchant_notifications_action_label_check check (
  action_label is null or char_length(action_label) between 1 and 60
);

alter table public.merchant_notifications drop constraint if exists merchant_notifications_action_url_check;
alter table public.merchant_notifications add constraint merchant_notifications_action_url_check check (
  action_url is null or
  action_url ~ '^https://[^[:space:]]+$' or
  action_url ~ '^sellertray://[A-Za-z0-9/_?=&.%-]+$'
);

alter table public.merchant_notifications drop constraint if exists merchant_notifications_audience_roles_check;
alter table public.merchant_notifications add constraint merchant_notifications_audience_roles_check check (
  audience_roles is null or
  (cardinality(audience_roles)>0 and audience_roles <@ array['owner','manager','staff']::text[])
);

create index if not exists merchant_notifications_campaign_idx
  on public.merchant_notifications(campaign_id)
  where campaign_id is not null;

create or replace function public.queue_sellertray_merchant_push_dispatches()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  insert into public.merchant_push_dispatches(tenant_id,notification_id,user_id)
  select new.tenant_id,new.id,tm.user_id
  from public.tenant_members tm
  where tm.tenant_id=new.tenant_id
    and (new.audience_roles is null or tm.role=any(new.audience_roles))
    and (new.expires_at is null or new.expires_at>now())
  on conflict do nothing;
  return new;
end;
$function$;

create or replace function public.sellertray_unread_notification_count_for_user(p_user_id uuid)
returns integer
language sql
security definer
set search_path to ''
as $function$
  select count(*)::integer
  from public.merchant_notifications n
  join public.tenant_members tm
    on tm.tenant_id=n.tenant_id
   and tm.user_id=p_user_id
  where (n.expires_at is null or n.expires_at>now())
    and (n.audience_roles is null or tm.role=any(n.audience_roles))
    and not exists (
      select 1
      from public.merchant_notification_reads r
      where r.notification_id=n.id
        and r.user_id=p_user_id
    );
$function$;

-- The return shape is intentionally extended, so recreate rather than replace.
drop function if exists public.sellertray_list_merchant_notifications(uuid,integer);

create function public.sellertray_list_merchant_notifications(
  p_tenant_id uuid,
  p_limit integer default 50
)
returns table(
  id uuid,event_key text,severity text,title text,body text,
  order_id uuid,change_request_id uuid,source_inbound_message_id uuid,
  is_read boolean,created_at timestamptz,
  message_type text,action_label text,action_url text,campaign_id uuid
)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_role text;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;

  if v_role is null then
    raise exception 'SellerTray business membership required';
  end if;

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
    and (n.expires_at is null or n.expires_at>now())
    and (n.audience_roles is null or v_role=any(n.audience_roles))
  order by n.created_at desc
  limit greatest(1,least(coalesce(p_limit,50),200));
end;
$function$;

create or replace function public.sellertray_mark_merchant_notification_read(p_notification_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_tenant_id uuid;
  v_roles text[];
  v_expires_at timestamptz;
  v_role text;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;

  select n.tenant_id,n.audience_roles,n.expires_at
  into v_tenant_id,v_roles,v_expires_at
  from public.merchant_notifications n
  where n.id=p_notification_id;

  if v_tenant_id is null then raise exception 'Notification not found'; end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=v_tenant_id and tm.user_id=v_user_id;

  if v_role is null then raise exception 'SellerTray business membership required'; end if;
  if v_roles is not null and not (v_role=any(v_roles)) then raise exception 'Notification not available to this user'; end if;
  if v_expires_at is not null and v_expires_at<=now() then raise exception 'Notification has expired'; end if;

  insert into public.merchant_notification_reads(notification_id,tenant_id,user_id,read_at)
  values (p_notification_id,v_tenant_id,v_user_id,now())
  on conflict (notification_id,user_id) do update set read_at=excluded.read_at;
end;
$function$;

create or replace function public.sellertray_mark_all_merchant_notifications_read(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_role text;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;

  if v_role is null then raise exception 'SellerTray business membership required'; end if;

  insert into public.merchant_notification_reads(notification_id,tenant_id,user_id,read_at)
  select n.id,n.tenant_id,v_user_id,now()
  from public.merchant_notifications n
  where n.tenant_id=p_tenant_id
    and (n.expires_at is null or n.expires_at>now())
    and (n.audience_roles is null or v_role=any(n.audience_roles))
  on conflict (notification_id,user_id) do update set read_at=excluded.read_at;
end;
$function$;

revoke all on function public.sellertray_list_merchant_notifications(uuid,integer) from public,anon;
revoke all on function public.sellertray_mark_merchant_notification_read(uuid) from public,anon;
revoke all on function public.sellertray_mark_all_merchant_notifications_read(uuid) from public,anon;
grant execute on function public.sellertray_list_merchant_notifications(uuid,integer) to authenticated;
grant execute on function public.sellertray_mark_merchant_notification_read(uuid) to authenticated;
grant execute on function public.sellertray_mark_all_merchant_notifications_read(uuid) to authenticated;

create or replace function public.platform_admin_publish_merchant_message(
  p_actor_user_id uuid,
  p_message_type text,
  p_severity text,
  p_title text,
  p_body text,
  p_target_tenant_ids uuid[] default null,
  p_audience_roles text[] default null,
  p_action_label text default null,
  p_action_url text default null,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_admin_role text;
  v_campaign_id uuid;
  v_event_key text;
  v_inserted integer := 0;
  v_title text := nullif(btrim(p_title),'');
  v_body text := nullif(btrim(p_body),'');
  v_action_label text := nullif(btrim(p_action_label),'');
  v_action_url text := nullif(btrim(p_action_url),'');
begin
  select pa.role into v_admin_role
  from public.platform_admins pa
  where pa.user_id=p_actor_user_id;

  if v_admin_role <> 'admin' then
    raise exception 'Platform administrator permission required' using errcode='42501';
  end if;

  if p_message_type not in ('update','service','information','promotion') then
    raise exception 'Invalid merchant message type' using errcode='22023';
  end if;
  if p_severity not in ('info','attention','urgent') then
    raise exception 'Invalid merchant message severity' using errcode='22023';
  end if;
  if v_title is null or char_length(v_title)>160 then
    raise exception 'Merchant message title must contain 1 to 160 characters' using errcode='22023';
  end if;
  if v_body is null or char_length(v_body)>1000 then
    raise exception 'Merchant message body must contain 1 to 1000 characters' using errcode='22023';
  end if;
  if v_action_label is not null and char_length(v_action_label)>60 then
    raise exception 'Action label is too long' using errcode='22023';
  end if;
  if v_action_url is not null and not (
    v_action_url ~ '^https://[^[:space:]]+$' or
    v_action_url ~ '^sellertray://[A-Za-z0-9/_?=&.%-]+$'
  ) then
    raise exception 'Action URL must use https or a SellerTray app link' using errcode='22023';
  end if;
  if p_audience_roles is not null and not (
    cardinality(p_audience_roles)>0 and p_audience_roles <@ array['owner','manager','staff']::text[]
  ) then
    raise exception 'Invalid merchant audience roles' using errcode='22023';
  end if;
  if p_target_tenant_ids is not null and cardinality(p_target_tenant_ids)=0 then
    raise exception 'Target tenant list cannot be empty' using errcode='22023';
  end if;
  if p_expires_at is not null and p_expires_at<=now() then
    raise exception 'Message expiry must be in the future' using errcode='22023';
  end if;

  v_event_key := case p_message_type
    when 'update' then 'platform_update'
    when 'service' then 'platform_service'
    when 'information' then 'platform_information'
    when 'promotion' then 'platform_promotion'
  end;

  insert into public.platform_merchant_campaigns(
    created_by,message_type,severity,title,body,action_label,action_url,
    audience_roles,target_tenant_ids,expires_at
  ) values (
    p_actor_user_id,p_message_type,p_severity,v_title,v_body,v_action_label,v_action_url,
    p_audience_roles,p_target_tenant_ids,p_expires_at
  ) returning id into v_campaign_id;

  insert into public.merchant_notifications(
    tenant_id,event_key,severity,title,body,message_type,
    campaign_id,action_label,action_url,audience_roles,expires_at
  )
  select
    t.id,v_event_key,p_severity,v_title,v_body,p_message_type,
    v_campaign_id,v_action_label,v_action_url,p_audience_roles,p_expires_at
  from public.tenants t
  where p_target_tenant_ids is null or t.id=any(p_target_tenant_ids);

  get diagnostics v_inserted = row_count;

  if v_inserted=0 then
    raise exception 'No SellerTray businesses matched this audience' using errcode='22023';
  end if;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values (
    p_actor_user_id,
    null,
    'merchant_message_published',
    jsonb_build_object(
      'campaign_id',v_campaign_id,
      'message_type',p_message_type,
      'severity',p_severity,
      'target_tenant_ids',p_target_tenant_ids,
      'audience_roles',p_audience_roles,
      'notification_count',v_inserted
    )
  );

  return jsonb_build_object('campaignId',v_campaign_id,'notificationCount',v_inserted);
end;
$function$;

revoke all on function public.platform_admin_publish_merchant_message(uuid,text,text,text,text,uuid[],text[],text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.platform_admin_publish_merchant_message(uuid,text,text,text,text,uuid[],text[],text,text,timestamptz) to service_role;
