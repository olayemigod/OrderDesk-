begin;

update public.legal_policy_versions
set is_current = false
where policy_key in ('terms','privacy')
  and is_current;

insert into public.legal_policy_versions (
  policy_key, version, effective_at, is_current, summary
) values
  (
    'terms',
    '2026-09-12',
    '2026-09-12 00:00:00+00',
    true,
    'SellerTray Terms of Service including explicit WhatsApp webhook processing, channel authorization, permitted conversation uses, and merchant-controlled catalogue capture from supported chat images.'
  ),
  (
    'privacy',
    '2026-09-12',
    '2026-09-12 00:00:00+00',
    true,
    'SellerTray Privacy Policy including WhatsApp webhook message content and metadata, supported product-image review, restricted processing purposes, revocation behavior, and temporary private media handling.'
  )
on conflict (policy_key, version) do update
set effective_at = excluded.effective_at,
    is_current = excluded.is_current,
    summary = excluded.summary;

create or replace function public.accept_sellertray_whatsapp_consent(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_accepted_via text default 'sellertray_mobile'
) returns uuid
language plpgsql
security invoker
set search_path = public
as $sellertray$
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
    and document_versions ->> 'terms' = v_terms_version
    and document_versions ->> 'privacy' = v_privacy_version
    and document_versions ->> 'whatsapp_data_processing' = v_whatsapp_version
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
    tenant_id,
    channel,
    policy_version,
    document_versions,
    scopes,
    accepted_by_user_id,
    accepted_via
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
$sellertray$;

revoke all on function public.accept_sellertray_whatsapp_consent(uuid,uuid,text)
from public, anon, authenticated;
grant execute on function public.accept_sellertray_whatsapp_consent(uuid,uuid,text)
to service_role;

create or replace function public.sellertray_whatsapp_consent_active(
  p_tenant_id uuid
) returns boolean
language sql
stable
security invoker
set search_path = public
as $sellertray$
  select exists (
    select 1
    from public.tenant_channel_consents c
    join public.legal_policy_versions wa
      on wa.policy_key = 'whatsapp_data_processing'
     and wa.version = c.policy_version
     and wa.is_current
    join public.legal_policy_versions terms
      on terms.policy_key = 'terms'
     and terms.is_current
     and c.document_versions ->> 'terms' = terms.version
    join public.legal_policy_versions privacy
      on privacy.policy_key = 'privacy'
     and privacy.is_current
     and c.document_versions ->> 'privacy' = privacy.version
    where c.tenant_id = p_tenant_id
      and c.channel = 'whatsapp'
      and c.revoked_at is null
      and c.document_versions ->> 'whatsapp_data_processing' = wa.version
  );
$sellertray$;

revoke all on function public.sellertray_whatsapp_consent_active(uuid)
from public, anon, authenticated;
grant execute on function public.sellertray_whatsapp_consent_active(uuid)
to service_role;

commit;
