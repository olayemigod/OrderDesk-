-- SellerTray P0 audit hardening:
-- 1) owner/manager-only manual money confirmation
-- 2) catalogue-governed order amendments/additions
-- 3) governed platform-to-merchant app/push communications

-- ---------------------------------------------------------------------------
-- Payment authorization: manual recording/confirmation is a management action.
-- ---------------------------------------------------------------------------
create or replace function public.confirm_sellertray_offline_payment(
  p_payment_id uuid,
  p_actor_user_id uuid,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_payment public.order_payments%rowtype;
  v_actor_role text;
begin
  select * into v_payment
  from public.order_payments p
  where p.id=p_payment_id
  for update;

  if not found then
    raise exception 'SellerTray payment not found' using errcode='22023';
  end if;

  if v_payment.method_type not in ('bank_transfer','cash_on_delivery','pay_on_pickup') then
    raise exception 'Only offline SellerTray payments can be confirmed manually' using errcode='23514';
  end if;

  if v_payment.status not in ('initiated','pending_verification') then
    raise exception 'SellerTray payment is not awaiting confirmation' using errcode='23514';
  end if;

  select tm.role into v_actor_role
  from public.tenant_members tm
  where tm.tenant_id=v_payment.tenant_id
    and tm.user_id=p_actor_user_id;

  if v_actor_role not in ('owner','manager') then
    raise exception 'Owner or Manager permission is required to confirm an offline payment' using errcode='42501';
  end if;

  perform public.transition_sellertray_order_payment(
    p_payment_id,
    'confirmed',
    'merchant',
    p_actor_user_id,
    null,
    null
  );

  perform public.record_sellertray_payment_event(
    v_payment.tenant_id,
    v_payment.order_id,
    v_payment.id,
    v_payment.provider,
    'merchant:' || v_payment.id::text || ':' || p_actor_user_id::text,
    'manual_confirmation',
    'merchant',
    'verified',
    null,
    null,
    null,
    jsonb_build_object('note',left(coalesce(p_note,''),500),'actor_role',v_actor_role)
  );

  return p_payment_id;
end;
$function$;

revoke all on function public.confirm_sellertray_offline_payment(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.confirm_sellertray_offline_payment(uuid,uuid,text) to service_role;

-- ---------------------------------------------------------------------------
-- Catalogue-governed order item creation and correction.
-- ---------------------------------------------------------------------------
create or replace function public.sellertray_add_catalogue_order_item(
  p_tenant_id uuid,
  p_order_id uuid,
  p_catalog_item_id uuid,
  p_quantity numeric default 1
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_order public.orders%rowtype;
  v_item public.catalog_items%rowtype;
  v_order_item_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;

  if v_role is null then
    raise exception 'SellerTray business membership required' using errcode='42501';
  end if;

  if p_quantity is null or p_quantity <= 0 or p_quantity > 9999 then
    raise exception 'Enter a valid quantity' using errcode='22023';
  end if;

  select * into v_order
  from public.orders o
  where o.id=p_order_id and o.tenant_id=p_tenant_id
  for update;

  if not found then
    raise exception 'Order not found' using errcode='22023';
  end if;

  if v_order.status not in ('draft','needs_review','accepted') then
    raise exception 'Products can only be changed before fulfilment starts' using errcode='23514';
  end if;

  select * into v_item
  from public.catalog_items ci
  where ci.id=p_catalog_item_id
    and ci.tenant_id=p_tenant_id
    and ci.is_active=true;

  if not found then
    raise exception 'Active catalogue item not found' using errcode='22023';
  end if;

  if v_item.price_ngn is null then
    raise exception 'Catalogue item needs a selling price before it can be ordered' using errcode='23514';
  end if;

  insert into public.order_items(
    tenant_id,order_id,catalog_item_id,item_name,original_item_name,
    quantity,unit_price,match_source,match_confidence
  ) values (
    p_tenant_id,p_order_id,p_catalog_item_id,v_item.name,null,
    p_quantity,v_item.price_ngn,'merchant_match',1
  ) returning id into v_order_item_id;

  perform public.refresh_sellertray_order_review_reasons(p_order_id);

  insert into public.commercial_action_ledger(
    tenant_id,action_key,channel,customer_id,target_order_id,
    action_type,risk_class,requested_by,policy_result,action_status,metadata,applied_at
  ) values (
    p_tenant_id,
    'catalogue-add:'||v_order_item_id::text,
    'merchant_app',
    v_order.customer_id,
    p_order_id,
    'catalogue_item_added_to_order',
    'medium',
    case when v_role='staff' then 'staff' else 'merchant' end,
    'allowed','applied',
    jsonb_build_object(
      'order_item_id',v_order_item_id,
      'catalog_item_id',p_catalog_item_id,
      'catalogue_name',v_item.name,
      'quantity',p_quantity,
      'unit_price',v_item.price_ngn,
      'actor_role',v_role
    ),
    now()
  ) on conflict(tenant_id,action_key) do nothing;

  return v_order_item_id;
end;
$function$;

revoke all on function public.sellertray_add_catalogue_order_item(uuid,uuid,uuid,numeric) from public, anon;
grant execute on function public.sellertray_add_catalogue_order_item(uuid,uuid,uuid,numeric) to authenticated;

create or replace function public.sellertray_match_order_item_to_catalogue(
  p_tenant_id uuid,
  p_order_item_id uuid,
  p_catalog_item_id uuid,
  p_learn_alias boolean default true
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_order_id uuid;
  v_order_status text;
  v_customer_id uuid;
  v_original text;
  v_previous_name text;
  v_previous_catalog_item_id uuid;
  v_previous_price numeric;
  v_item_name text;
  v_price numeric;
  v_alias text;
  v_alias_learned boolean := false;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;

  if v_role is null then raise exception 'SellerTray business membership required'; end if;

  select oi.order_id,o.status,o.customer_id,
         coalesce(nullif(btrim(oi.original_item_name),''),oi.item_name),
         oi.item_name,oi.catalog_item_id,oi.unit_price
  into v_order_id,v_order_status,v_customer_id,v_original,
       v_previous_name,v_previous_catalog_item_id,v_previous_price
  from public.order_items oi
  join public.orders o on o.id=oi.order_id and o.tenant_id=oi.tenant_id
  where oi.id=p_order_item_id and oi.tenant_id=p_tenant_id
  for update of oi;

  if v_order_id is null then raise exception 'Order item not found'; end if;
  if v_order_status not in ('draft','needs_review','accepted') then
    raise exception 'Product correction is only available before fulfilment starts';
  end if;

  select ci.name,ci.price_ngn
  into v_item_name,v_price
  from public.catalog_items ci
  where ci.id=p_catalog_item_id and ci.tenant_id=p_tenant_id and ci.is_active=true;

  if v_item_name is null then raise exception 'Active catalogue item not found'; end if;
  if v_price is null then raise exception 'Catalogue item needs a selling price before it can resolve this order'; end if;

  update public.order_items
  set catalog_item_id=p_catalog_item_id,
      item_name=v_item_name,
      unit_price=v_price,
      match_source='merchant_match',
      match_confidence=1
  where id=p_order_item_id and tenant_id=p_tenant_id;

  v_alias := nullif(btrim(v_original),'');
  if coalesce(p_learn_alias,true)
     and v_role in ('owner','manager')
     and v_alias is not null
     and lower(v_alias) <> lower(btrim(v_item_name))
     and not exists(
       select 1 from public.catalog_item_aliases a
       where a.tenant_id=p_tenant_id
         and lower(btrim(a.alias))=lower(v_alias)
     )
  then
    insert into public.catalog_item_aliases(tenant_id,catalog_item_id,alias)
    values(p_tenant_id,p_catalog_item_id,v_alias);
    v_alias_learned := true;
  end if;

  update public.order_item_catalogue_candidates
  set status='matched_existing',
      resolution_catalog_item_id=p_catalog_item_id,
      learned_alias=case when v_alias_learned then v_alias else null end,
      reviewed_by=v_user_id,
      reviewed_at=now(),
      updated_at=now()
  where tenant_id=p_tenant_id and order_item_id=p_order_item_id;

  perform public.refresh_sellertray_order_review_reasons(v_order_id);

  insert into public.commercial_action_ledger(
    tenant_id,action_key,channel,customer_id,target_order_id,
    action_type,risk_class,requested_by,policy_result,action_status,metadata,applied_at
  ) values (
    p_tenant_id,
    'catalogue-match:'||p_order_item_id::text||':'||p_catalog_item_id::text||':'||extract(epoch from now())::bigint::text,
    'merchant_app',v_customer_id,v_order_id,
    'order_item_matched_to_catalogue','medium',
    case when v_role='staff' then 'staff' else 'merchant' end,
    'allowed','applied',
    jsonb_build_object(
      'order_item_id',p_order_item_id,
      'catalog_item_id',p_catalog_item_id,
      'customer_wording',v_original,
      'previous_name',v_previous_name,
      'previous_catalog_item_id',v_previous_catalog_item_id,
      'previous_unit_price',v_previous_price,
      'new_name',v_item_name,
      'new_unit_price',v_price,
      'learned_alias',case when v_alias_learned then v_alias else null end,
      'actor_role',v_role
    ),
    now()
  ) on conflict(tenant_id,action_key) do nothing;
end;
$function$;

revoke all on function public.sellertray_match_order_item_to_catalogue(uuid,uuid,uuid,boolean) from public, anon;
grant execute on function public.sellertray_match_order_item_to_catalogue(uuid,uuid,uuid,boolean) to authenticated;

-- Clients may change quantity or delete a governed line, but may no longer insert
-- arbitrary item names/prices or overwrite canonical catalogue prices directly.
revoke insert on public.order_items from authenticated;
revoke update(item_name,unit_price) on public.order_items from authenticated;
grant update(quantity) on public.order_items to authenticated;

-- ---------------------------------------------------------------------------
-- Platform-to-merchant communications. Reuse existing notification + push queue.
-- ---------------------------------------------------------------------------
create table if not exists public.platform_merchant_campaigns (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null,
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

create or replace function public.sellertray_list_merchant_notifications(
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

  insert into public.platform_admin_audit_log(actor_user_id,action_type,target_tenant_id,payload)
  values (
    p_actor_user_id,
    'merchant_message_published',
    null,
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
