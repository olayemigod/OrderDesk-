-- SellerTray admin portal safety: platform merchant broadcasts are high-impact writes.
-- A client retry after a network timeout must return the original campaign instead
-- of creating a second notification campaign.

alter table public.platform_merchant_campaigns
  add column if not exists request_id uuid;

create unique index if not exists platform_merchant_campaigns_actor_request_uidx
  on public.platform_merchant_campaigns (created_by, request_id)
  where request_id is not null;

drop function if exists public.platform_admin_publish_merchant_message(
  uuid,text,text,text,text,uuid[],text[],text,text,timestamptz
);

create function public.platform_admin_publish_merchant_message(
  p_actor_user_id uuid,
  p_message_type text,
  p_severity text,
  p_title text,
  p_body text,
  p_target_tenant_ids uuid[] default null,
  p_audience_roles text[] default null,
  p_action_label text default null,
  p_action_url text default null,
  p_expires_at timestamptz default null,
  p_request_id uuid default null
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
  v_existing public.platform_merchant_campaigns%rowtype;
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
  if p_message_type='promotion' and p_severity='urgent' then
    raise exception 'Promotional messages cannot be marked urgent' using errcode='22023';
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
  if (v_action_label is null) <> (v_action_url is null) then
    raise exception 'Action label and action URL must be supplied together' using errcode='22023';
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

  -- Return an already committed campaign for the same actor/request UUID. Check
  -- the payload too, so a reused request UUID can never silently point at a
  -- different broadcast.
  if p_request_id is not null then
    select * into v_existing
    from public.platform_merchant_campaigns c
    where c.created_by=p_actor_user_id
      and c.request_id=p_request_id;

    if found then
      if row(
        v_existing.message_type,v_existing.severity,v_existing.title,v_existing.body,
        v_existing.action_label,v_existing.action_url,v_existing.audience_roles,
        v_existing.target_tenant_ids,v_existing.expires_at
      ) is distinct from row(
        p_message_type,p_severity,v_title,v_body,
        v_action_label,v_action_url,p_audience_roles,
        p_target_tenant_ids,p_expires_at
      ) then
        raise exception 'Publish request identifier was already used for a different merchant message'
          using errcode='22023';
      end if;

      select count(*)::integer into v_inserted
      from public.merchant_notifications n
      where n.campaign_id=v_existing.id;

      return jsonb_build_object(
        'campaignId',v_existing.id,
        'notificationCount',v_inserted,
        'idempotentReplay',true
      );
    end if;
  end if;

  v_event_key := case p_message_type
    when 'update' then 'platform_update'
    when 'service' then 'platform_service'
    when 'information' then 'platform_information'
    when 'promotion' then 'platform_promotion'
  end;

  begin
    insert into public.platform_merchant_campaigns(
      created_by,message_type,severity,title,body,action_label,action_url,
      audience_roles,target_tenant_ids,expires_at,request_id
    ) values (
      p_actor_user_id,p_message_type,p_severity,v_title,v_body,v_action_label,v_action_url,
      p_audience_roles,p_target_tenant_ids,p_expires_at,p_request_id
    ) returning id into v_campaign_id;
  exception when unique_violation then
    -- A concurrent retry with the same request UUID won the race. Return that
    -- campaign rather than creating a second broadcast.
    if p_request_id is null then raise; end if;

    select * into v_existing
    from public.platform_merchant_campaigns c
    where c.created_by=p_actor_user_id
      and c.request_id=p_request_id;

    if not found then raise; end if;

    if row(
      v_existing.message_type,v_existing.severity,v_existing.title,v_existing.body,
      v_existing.action_label,v_existing.action_url,v_existing.audience_roles,
      v_existing.target_tenant_ids,v_existing.expires_at
    ) is distinct from row(
      p_message_type,p_severity,v_title,v_body,
      v_action_label,v_action_url,p_audience_roles,
      p_target_tenant_ids,p_expires_at
    ) then
      raise exception 'Publish request identifier was already used for a different merchant message'
        using errcode='22023';
    end if;

    select count(*)::integer into v_inserted
    from public.merchant_notifications n
    where n.campaign_id=v_existing.id;

    return jsonb_build_object(
      'campaignId',v_existing.id,
      'notificationCount',v_inserted,
      'idempotentReplay',true
    );
  end;

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
      'request_id',p_request_id,
      'message_type',p_message_type,
      'severity',p_severity,
      'target_tenant_ids',p_target_tenant_ids,
      'audience_roles',p_audience_roles,
      'notification_count',v_inserted
    )
  );

  return jsonb_build_object(
    'campaignId',v_campaign_id,
    'notificationCount',v_inserted,
    'idempotentReplay',false
  );
end;
$function$;

revoke all on function public.platform_admin_publish_merchant_message(
  uuid,text,text,text,text,uuid[],text[],text,text,timestamptz,uuid
) from public;
revoke all on function public.platform_admin_publish_merchant_message(
  uuid,text,text,text,text,uuid[],text[],text,text,timestamptz,uuid
) from anon;
revoke all on function public.platform_admin_publish_merchant_message(
  uuid,text,text,text,text,uuid[],text[],text,text,timestamptz,uuid
) from authenticated;
grant execute on function public.platform_admin_publish_merchant_message(
  uuid,text,text,text,text,uuid[],text[],text,text,timestamptz,uuid
) to service_role;
