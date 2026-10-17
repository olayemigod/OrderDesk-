create table if not exists public.legal_policy_versions (
  policy_key text not null,
  version text not null,
  effective_at timestamptz not null,
  is_current boolean not null default false,
  summary text not null,
  created_at timestamptz not null default now(),
  primary key (policy_key, version),
  check (policy_key in ('terms','privacy','whatsapp_data_processing'))
);

create unique index if not exists legal_policy_versions_one_current_idx
  on public.legal_policy_versions (policy_key)
  where is_current;

insert into public.legal_policy_versions(policy_key, version, effective_at, is_current, summary)
values
  ('terms','2026-09-11','2026-09-11 00:00:00+00',true,
   'SellerTray Terms of Use governing merchant access to the service.'),
  ('privacy','2026-09-11','2026-09-11 00:00:00+00',true,
   'SellerTray Privacy Notice governing personal-data handling in the service.'),
  ('whatsapp_data_processing','2026-09-12','2026-09-12 00:00:00+00',true,
   'SellerTray may receive and process WhatsApp message content and metadata delivered through the connected business webhook only for order detection and fulfilment, customer and order records, payment and status assistance, merchant-approved notifications, and merchant-initiated catalogue capture from chat images. Message content is not authorized for unrelated advertising use.')
on conflict (policy_key, version) do update
set effective_at = excluded.effective_at,
    is_current = excluded.is_current,
    summary = excluded.summary;

create table if not exists public.tenant_channel_consents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  channel text not null check (channel in ('whatsapp')),
  policy_version text not null,
  document_versions jsonb not null,
  scopes jsonb not null,
  accepted_by_user_id uuid not null,
  accepted_via text not null,
  accepted_at timestamptz not null default now(),
  revoked_by_user_id uuid,
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(document_versions) = 'object'),
  check (jsonb_typeof(scopes) = 'array'),
  check (
    (revoked_at is null and revoked_by_user_id is null)
    or
    (revoked_at is not null and revoked_by_user_id is not null)
  )
);

create unique index if not exists tenant_channel_consents_one_active_idx
  on public.tenant_channel_consents (tenant_id, channel)
  where revoked_at is null;

create index if not exists tenant_channel_consents_tenant_history_idx
  on public.tenant_channel_consents (tenant_id, channel, accepted_at desc);

alter table public.legal_policy_versions enable row level security;
alter table public.tenant_channel_consents enable row level security;

revoke all on public.legal_policy_versions from anon, authenticated;
grant select on public.legal_policy_versions to authenticated;
revoke all on public.tenant_channel_consents from anon, authenticated;
grant select on public.tenant_channel_consents to authenticated;

drop policy if exists legal_policy_versions_select_authenticated on public.legal_policy_versions;
create policy legal_policy_versions_select_authenticated
on public.legal_policy_versions
for select
to authenticated
using (true);

drop policy if exists tenant_channel_consents_select_member on public.tenant_channel_consents;
create policy tenant_channel_consents_select_member
on public.tenant_channel_consents
for select
to authenticated
using (
  exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = tenant_channel_consents.tenant_id
      and tm.user_id = (select auth.uid())
  )
);

create or replace function public.accept_sellertray_whatsapp_consent(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_accepted_via text default 'sellertray_mobile'
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_role text;
  v_terms_version text;
  v_privacy_version text;
  v_whatsapp_version text;
  v_existing_id uuid;
  v_id uuid;
begin
  select role into v_role
  from public.tenant_members
  where tenant_id = p_tenant_id
    and user_id = p_actor_user_id;

  if v_role is distinct from 'owner' then
    raise exception 'Only the business Owner can accept WhatsApp data-processing terms';
  end if;

  select version into v_terms_version
  from public.legal_policy_versions
  where policy_key = 'terms' and is_current
  limit 1;

  select version into v_privacy_version
  from public.legal_policy_versions
  where policy_key = 'privacy' and is_current
  limit 1;

  select version into v_whatsapp_version
  from public.legal_policy_versions
  where policy_key = 'whatsapp_data_processing' and is_current
  limit 1;

  if v_terms_version is null or v_privacy_version is null or v_whatsapp_version is null then
    raise exception 'Current SellerTray legal policy versions are not configured';
  end if;

  if not exists (
    select 1
    from public.user_legal_acceptances ula
    where ula.user_id = p_actor_user_id
      and ula.terms_version = v_terms_version
      and ula.privacy_version = v_privacy_version
  ) then
    raise exception 'Current SellerTray Terms and Privacy Notice must be accepted first';
  end if;

  select id into v_existing_id
  from public.tenant_channel_consents
  where tenant_id = p_tenant_id
    and channel = 'whatsapp'
    and revoked_at is null
    and policy_version = v_whatsapp_version
  limit 1;

  if v_existing_id is not null then
    return v_existing_id;
  end if;

  update public.tenant_channel_consents
  set revoked_at = now(),
      revoked_by_user_id = p_actor_user_id,
      revocation_reason = 'superseded_by_new_policy_acceptance'
  where tenant_id = p_tenant_id
    and channel = 'whatsapp'
    and revoked_at is null;

  insert into public.tenant_channel_consents (
    tenant_id, channel, policy_version, document_versions, scopes,
    accepted_by_user_id, accepted_via
  ) values (
    p_tenant_id,
    'whatsapp',
    v_whatsapp_version,
    jsonb_build_object(
      'terms', v_terms_version,
      'privacy', v_privacy_version,
      'whatsapp_data_processing', v_whatsapp_version
    ),
    jsonb_build_array(
      'message_content',
      'message_metadata',
      'order_detection',
      'customer_record',
      'order_status_notifications',
      'payment_conversation_assistance',
      'catalogue_capture_from_chat_images'
    ),
    p_actor_user_id,
    coalesce(nullif(btrim(p_accepted_via), ''), 'sellertray_mobile')
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.accept_sellertray_whatsapp_consent(uuid,uuid,text)
from public, anon, authenticated;
grant execute on function public.accept_sellertray_whatsapp_consent(uuid,uuid,text)
to service_role;

create or replace function public.revoke_sellertray_whatsapp_consent(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_reason text default null
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_role text;
begin
  select role into v_role
  from public.tenant_members
  where tenant_id = p_tenant_id
    and user_id = p_actor_user_id;

  if v_role is distinct from 'owner' then
    raise exception 'Only the business Owner can revoke WhatsApp data-processing consent';
  end if;

  update public.tenant_channel_consents
  set revoked_at = now(),
      revoked_by_user_id = p_actor_user_id,
      revocation_reason = coalesce(nullif(btrim(p_reason), ''), 'owner_revoked')
  where tenant_id = p_tenant_id
    and channel = 'whatsapp'
    and revoked_at is null;
end;
$$;

revoke all on function public.revoke_sellertray_whatsapp_consent(uuid,uuid,text)
from public, anon, authenticated;
grant execute on function public.revoke_sellertray_whatsapp_consent(uuid,uuid,text)
to service_role;

create or replace function public.sellertray_whatsapp_consent_active(
  p_tenant_id uuid
) returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1
    from public.tenant_channel_consents c
    join public.legal_policy_versions p
      on p.policy_key = 'whatsapp_data_processing'
     and p.version = c.policy_version
     and p.is_current
    where c.tenant_id = p_tenant_id
      and c.channel = 'whatsapp'
      and c.revoked_at is null
  );
$$;

revoke all on function public.sellertray_whatsapp_consent_active(uuid)
from public, anon, authenticated;
grant execute on function public.sellertray_whatsapp_consent_active(uuid)
to service_role;
