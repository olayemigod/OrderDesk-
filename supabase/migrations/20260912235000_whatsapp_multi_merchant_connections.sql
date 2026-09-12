-- SellerTray: secure multi-merchant WhatsApp connection and credential ownership.
-- Safe connection metadata is tenant-readable. Provider credentials remain server-only
-- in sellertray_private and are never exposed through the Android/Data API surface.

begin;

create table public.tenant_whatsapp_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants(id) on delete cascade,
  meta_business_id text,
  waba_id text,
  phone_number_id text unique,
  display_phone_number text,
  verified_name text,
  connection_status text not null default 'pending',
  onboarding_method text not null default 'manual',
  credential_mode text not null default 'platform_system_user',
  webhook_subscription_status text not null default 'unknown',
  connected_at timestamptz,
  last_verified_at timestamptz,
  disconnected_at timestamptz,
  last_error_code text,
  last_error_message text,
  created_by_user_id uuid references auth.users(id) on delete set null,
  updated_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_whatsapp_connections_tenant_id_id_key unique (tenant_id,id),
  constraint tenant_whatsapp_connections_status_check
    check (connection_status in ('not_connected','pending','connected','error','disconnected')),
  constraint tenant_whatsapp_connections_onboarding_check
    check (onboarding_method in ('manual','embedded_signup','coexistence')),
  constraint tenant_whatsapp_connections_credential_mode_check
    check (credential_mode in ('platform_system_user','business_integration_system_user')),
  constraint tenant_whatsapp_connections_webhook_status_check
    check (webhook_subscription_status in ('unknown','pending','subscribed','error')),
  constraint tenant_whatsapp_connections_phone_state_check
    check (
      phone_number_id is not null
      or connection_status in ('not_connected','disconnected','error')
    ),
  constraint tenant_whatsapp_connections_error_message_check
    check (last_error_message is null or char_length(last_error_message) <= 500)
);

create index tenant_whatsapp_connections_waba_idx
  on public.tenant_whatsapp_connections(waba_id)
  where waba_id is not null;

alter table public.tenant_whatsapp_connections enable row level security;
revoke all on table public.tenant_whatsapp_connections from public,anon,authenticated;
grant select on table public.tenant_whatsapp_connections to authenticated;
grant all on table public.tenant_whatsapp_connections to service_role;

create policy tenant_whatsapp_connections_select_member
on public.tenant_whatsapp_connections
for select to authenticated
using (
  exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id=tenant_whatsapp_connections.tenant_id
      and tm.user_id=(select auth.uid())
  )
);

create table sellertray_private.whatsapp_connection_credentials (
  connection_id uuid primary key,
  tenant_id uuid not null,
  credential_type text not null,
  credentials_ciphertext text not null,
  credentials_iv text not null,
  encryption_key_version integer not null default 1,
  credential_fingerprint text not null,
  expires_at timestamptz,
  updated_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_connection_credentials_connection_same_tenant
    foreign key (tenant_id,connection_id)
    references public.tenant_whatsapp_connections(tenant_id,id)
    on delete cascade,
  constraint whatsapp_connection_credentials_type_check
    check (credential_type='business_integration_system_user'),
  constraint whatsapp_connection_credentials_key_version_check
    check (encryption_key_version>=1),
  constraint whatsapp_connection_credentials_fingerprint_check
    check (credential_fingerprint ~ '^[A-F0-9]{12}$')
);

revoke all on table sellertray_private.whatsapp_connection_credentials
  from public,anon,authenticated;
grant all on table sellertray_private.whatsapp_connection_credentials
  to service_role;

-- Preserve already-configured tenant mappings as platform-managed connections.
-- No provider secret is copied into the database.
insert into public.tenant_whatsapp_connections (
  tenant_id,
  phone_number_id,
  connection_status,
  onboarding_method,
  credential_mode,
  webhook_subscription_status,
  connected_at,
  last_verified_at
)
select
  t.id,
  t.whatsapp_phone_number_id,
  case
    when t.whatsapp_connection_status='connected' then 'connected'
    when t.whatsapp_connection_status='pending' then 'pending'
    when t.whatsapp_connection_status='error' then 'error'
    else 'not_connected'
  end,
  'manual',
  'platform_system_user',
  'unknown',
  case when t.whatsapp_connection_status='connected' then t.updated_at else null end,
  case when t.whatsapp_connection_status='connected' then t.updated_at else null end
from public.tenants t
where t.whatsapp_phone_number_id is not null
on conflict (tenant_id) do nothing;

create or replace function public.upsert_sellertray_whatsapp_connection(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_meta_business_id text,
  p_waba_id text,
  p_phone_number_id text,
  p_display_phone_number text,
  p_verified_name text,
  p_onboarding_method text,
  p_credential_mode text,
  p_webhook_subscription_status text,
  p_credentials_ciphertext text,
  p_credentials_iv text,
  p_credential_fingerprint text,
  p_encryption_key_version integer,
  p_credential_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_role text;
  v_connection public.tenant_whatsapp_connections%rowtype;
  v_phone text := nullif(btrim(coalesce(p_phone_number_id,'')),'');
  v_waba text := nullif(btrim(coalesce(p_waba_id,'')),'');
  v_onboarding text := coalesce(nullif(btrim(p_onboarding_method),''),'embedded_signup');
  v_mode text := coalesce(nullif(btrim(p_credential_mode),''),'business_integration_system_user');
  v_webhook text := coalesce(nullif(btrim(p_webhook_subscription_status),''),'subscribed');
begin
  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;

  if v_role<>'owner' then
    raise exception 'Only the business Owner can connect WhatsApp' using errcode='42501';
  end if;

  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  if v_phone is null or v_phone !~ '^[0-9]{5,40}$' then
    raise exception 'A valid Meta Phone Number ID is required' using errcode='22023';
  end if;
  if v_waba is null or v_waba !~ '^[0-9]{5,40}$' then
    raise exception 'A valid WhatsApp Business Account ID is required' using errcode='22023';
  end if;
  if v_onboarding not in ('manual','embedded_signup','coexistence') then
    raise exception 'Unsupported WhatsApp onboarding method' using errcode='22023';
  end if;
  if v_mode not in ('platform_system_user','business_integration_system_user') then
    raise exception 'Unsupported WhatsApp credential mode' using errcode='22023';
  end if;
  if v_webhook<>'subscribed' then
    raise exception 'WhatsApp webhook subscription must be verified before connection activation' using errcode='23514';
  end if;

  insert into public.tenant_whatsapp_connections (
    tenant_id,meta_business_id,waba_id,phone_number_id,display_phone_number,verified_name,
    connection_status,onboarding_method,credential_mode,webhook_subscription_status,
    connected_at,last_verified_at,disconnected_at,last_error_code,last_error_message,
    created_by_user_id,updated_by_user_id
  ) values (
    p_tenant_id,
    nullif(btrim(coalesce(p_meta_business_id,'')),''),
    v_waba,
    v_phone,
    nullif(btrim(coalesce(p_display_phone_number,'')),''),
    nullif(btrim(coalesce(p_verified_name,'')),''),
    'connected',
    v_onboarding,
    v_mode,
    'subscribed',
    now(),
    now(),
    null,
    null,
    null,
    p_actor_user_id,
    p_actor_user_id
  )
  on conflict (tenant_id) do update
  set meta_business_id=excluded.meta_business_id,
      waba_id=excluded.waba_id,
      phone_number_id=excluded.phone_number_id,
      display_phone_number=excluded.display_phone_number,
      verified_name=excluded.verified_name,
      connection_status='connected',
      onboarding_method=excluded.onboarding_method,
      credential_mode=excluded.credential_mode,
      webhook_subscription_status='subscribed',
      connected_at=coalesce(public.tenant_whatsapp_connections.connected_at,now()),
      last_verified_at=now(),
      disconnected_at=null,
      last_error_code=null,
      last_error_message=null,
      updated_by_user_id=p_actor_user_id,
      updated_at=now()
  returning * into v_connection;

  if v_mode='business_integration_system_user' then
    if nullif(btrim(coalesce(p_credentials_ciphertext,'')),'') is null
       or nullif(btrim(coalesce(p_credentials_iv,'')),'') is null
       or nullif(btrim(coalesce(p_credential_fingerprint,'')),'') is null
       or coalesce(p_encryption_key_version,0)<1 then
      raise exception 'Encrypted WhatsApp business credential is required' using errcode='22023';
    end if;

    insert into sellertray_private.whatsapp_connection_credentials (
      connection_id,tenant_id,credential_type,credentials_ciphertext,credentials_iv,
      encryption_key_version,credential_fingerprint,expires_at,updated_by_user_id
    ) values (
      v_connection.id,p_tenant_id,'business_integration_system_user',
      p_credentials_ciphertext,p_credentials_iv,p_encryption_key_version,
      p_credential_fingerprint,p_credential_expires_at,p_actor_user_id
    )
    on conflict (connection_id) do update
    set credentials_ciphertext=excluded.credentials_ciphertext,
        credentials_iv=excluded.credentials_iv,
        encryption_key_version=excluded.encryption_key_version,
        credential_fingerprint=excluded.credential_fingerprint,
        expires_at=excluded.expires_at,
        updated_by_user_id=excluded.updated_by_user_id,
        updated_at=now();
  else
    delete from sellertray_private.whatsapp_connection_credentials
    where connection_id=v_connection.id and tenant_id=p_tenant_id;
  end if;

  update public.tenants
  set whatsapp_phone_number_id=v_phone,
      whatsapp_connection_status='connected',
      onboarding_status=case when onboarding_status='whatsapp' then 'test_order' else onboarding_status end,
      updated_at=now()
  where id=p_tenant_id;

  return jsonb_build_object(
    'id',v_connection.id,
    'tenantId',v_connection.tenant_id,
    'metaBusinessId',v_connection.meta_business_id,
    'wabaId',v_connection.waba_id,
    'phoneNumberId',v_connection.phone_number_id,
    'displayPhoneNumber',v_connection.display_phone_number,
    'verifiedName',v_connection.verified_name,
    'connectionStatus','connected',
    'onboardingMethod',v_connection.onboarding_method,
    'credentialMode',v_connection.credential_mode,
    'webhookSubscriptionStatus','subscribed',
    'connectedAt',coalesce(v_connection.connected_at,now()),
    'lastVerifiedAt',now()
  );
exception
  when unique_violation then
    raise exception 'This WhatsApp Phone Number ID is already connected to another SellerTray business'
      using errcode='23505';
end;
$$;

revoke all on function public.upsert_sellertray_whatsapp_connection(
  uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,integer,timestamptz
) from public,anon,authenticated;
grant execute on function public.upsert_sellertray_whatsapp_connection(
  uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,integer,timestamptz
) to service_role;

create or replace function public.get_sellertray_whatsapp_runtime_credential_by_phone(
  p_phone_number_id text
)
returns table(
  tenant_id uuid,
  connection_id uuid,
  waba_id text,
  phone_number_id text,
  credential_mode text,
  credentials_ciphertext text,
  credentials_iv text,
  encryption_key_version integer,
  credential_fingerprint text,
  credential_expires_at timestamptz
)
language sql
security definer
set search_path=''
as $$
  select
    c.tenant_id,
    c.id,
    c.waba_id,
    c.phone_number_id,
    c.credential_mode,
    s.credentials_ciphertext,
    s.credentials_iv,
    s.encryption_key_version,
    s.credential_fingerprint,
    s.expires_at
  from public.tenant_whatsapp_connections c
  left join sellertray_private.whatsapp_connection_credentials s
    on s.connection_id=c.id and s.tenant_id=c.tenant_id
  where c.phone_number_id=nullif(btrim(p_phone_number_id),'')
    and c.connection_status='connected'
  limit 1;
$$;

revoke all on function public.get_sellertray_whatsapp_runtime_credential_by_phone(text)
  from public,anon,authenticated;
grant execute on function public.get_sellertray_whatsapp_runtime_credential_by_phone(text)
  to service_role;

create or replace function public.get_sellertray_whatsapp_runtime_credential_by_tenant(
  p_tenant_id uuid
)
returns table(
  tenant_id uuid,
  connection_id uuid,
  waba_id text,
  phone_number_id text,
  credential_mode text,
  credentials_ciphertext text,
  credentials_iv text,
  encryption_key_version integer,
  credential_fingerprint text,
  credential_expires_at timestamptz
)
language sql
security definer
set search_path=''
as $$
  select
    c.tenant_id,
    c.id,
    c.waba_id,
    c.phone_number_id,
    c.credential_mode,
    s.credentials_ciphertext,
    s.credentials_iv,
    s.encryption_key_version,
    s.credential_fingerprint,
    s.expires_at
  from public.tenant_whatsapp_connections c
  left join sellertray_private.whatsapp_connection_credentials s
    on s.connection_id=c.id and s.tenant_id=c.tenant_id
  where c.tenant_id=p_tenant_id
    and c.connection_status='connected'
  limit 1;
$$;

revoke all on function public.get_sellertray_whatsapp_runtime_credential_by_tenant(uuid)
  from public,anon,authenticated;
grant execute on function public.get_sellertray_whatsapp_runtime_credential_by_tenant(uuid)
  to service_role;

create or replace function public.disconnect_sellertray_whatsapp_connection(
  p_tenant_id uuid,
  p_actor_user_id uuid
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_role text;
  v_connection_id uuid;
begin
  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;

  if v_role<>'owner' then
    raise exception 'Only the business Owner can disconnect WhatsApp' using errcode='42501';
  end if;

  select c.id into v_connection_id
  from public.tenant_whatsapp_connections c
  where c.tenant_id=p_tenant_id;

  if v_connection_id is not null then
    delete from sellertray_private.whatsapp_connection_credentials
    where connection_id=v_connection_id and tenant_id=p_tenant_id;

    update public.tenant_whatsapp_connections
    set phone_number_id=null,
        display_phone_number=null,
        connection_status='disconnected',
        webhook_subscription_status='unknown',
        disconnected_at=now(),
        last_verified_at=null,
        updated_by_user_id=p_actor_user_id,
        updated_at=now()
    where id=v_connection_id and tenant_id=p_tenant_id;
  end if;

  update public.tenants
  set whatsapp_phone_number_id=null,
      whatsapp_connection_status='not_connected',
      onboarding_status=case when onboarding_status in ('test_order','ready') then 'whatsapp' else onboarding_status end,
      updated_at=now()
  where id=p_tenant_id;
end;
$$;

revoke all on function public.disconnect_sellertray_whatsapp_connection(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.disconnect_sellertray_whatsapp_connection(uuid,uuid)
  to service_role;

commit;
