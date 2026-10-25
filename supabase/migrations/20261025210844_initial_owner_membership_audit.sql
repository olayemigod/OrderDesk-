-- Close the remaining SellerTray membership-audit gap: initial Business provisioning creates the
-- first Owner membership, so it must emit the same append-only membership evidence as later team
-- mutations. Keep the already-applied membership-governance migrations immutable.

alter table public.sellertray_membership_events
  drop constraint if exists sellertray_membership_events_event_type_check;

alter table public.sellertray_membership_events
  add constraint sellertray_membership_events_event_type_check
  check (event_type = any (array[
    'legacy_membership_observed'::text,
    'legacy_invitation_observed'::text,
    'initial_owner_assigned'::text,
    'invitation_created'::text,
    'invitation_refreshed'::text,
    'invitation_accepted'::text,
    'invitation_declined'::text,
    'invitation_cancelled'::text,
    'invitation_expired'::text,
    'member_role_changed'::text,
    'member_removed'::text,
    'ownership_transferred'::text
  ]));

create or replace function public.provision_business_for_user(
  p_user_id uuid,
  p_name text,
  p_business_email text default null,
  p_business_phone text default null,
  p_business_type text default null,
  p_merchant_code text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_slug_base text;
  v_slug text;
  v_code text;
  v_compact text;
  v_try integer;
  v_user_chosen boolean := nullif(btrim(coalesce(p_merchant_code,'')),'') is not null;
  v_owner_email text;
begin
  if p_user_id is null or not exists (
    select 1 from auth.users u where u.id=p_user_id
  ) then
    raise exception 'Valid user is required' using errcode='42501';
  end if;

  select lower(u.email) into v_owner_email
  from auth.users u
  where u.id = p_user_id;

  if exists (
    select 1 from public.tenant_members tm where tm.user_id=p_user_id
  ) then
    raise exception 'Initial business provisioning is only available when no workspace exists' using errcode='23514';
  end if;

  if nullif(btrim(p_name),'') is null then
    raise exception 'Business name is required' using errcode='23514';
  end if;

  if v_user_chosen then
    v_code := upper(btrim(p_merchant_code));
    if v_code !~ '^[A-Z0-9]{3}$' then
      raise exception 'Merchant ID must be exactly 3 letters or numbers' using errcode='22023';
    end if;
    perform pg_advisory_xact_lock(hashtext('sellertray-merchant-code:' || v_code));
    if exists (select 1 from public.tenants t where t.merchant_code=v_code) then
      raise exception 'Merchant ID % is already in use. Choose another 3-character ID.', v_code using errcode='23505';
    end if;
  else
    v_compact := upper(regexp_replace(btrim(p_name), '[^A-Za-z0-9]', '', 'g'));
    v_code := rpad(substr(v_compact,1,3),3,'X');

    perform pg_advisory_xact_lock(hashtext('sellertray-merchant-code:' || v_code));
    if exists (select 1 from public.tenants t where t.merchant_code=v_code) then
      for v_try in 0..4095 loop
        v_code := upper(substr(md5(p_user_id::text || ':' || p_name || ':' || v_try::text),1,3));
        perform pg_advisory_xact_lock(hashtext('sellertray-merchant-code:' || v_code));
        exit when not exists (select 1 from public.tenants t where t.merchant_code=v_code);
      end loop;
    end if;

    if exists (select 1 from public.tenants t where t.merchant_code=v_code) then
      raise exception 'Unable to allocate merchant ID. Choose a 3-character ID.' using errcode='23505';
    end if;
  end if;

  v_slug_base := trim(both '-' from regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '-', 'g'));
  if v_slug_base='' then v_slug_base := 'business'; end if;
  v_slug := left(v_slug_base,48) || '-' || substr(replace(gen_random_uuid()::text,'-',''),1,6);

  insert into public.tenants (
    name,slug,merchant_code,business_email,business_phone,business_type,
    currency,timezone,onboarding_status,subscription_status,whatsapp_connection_status
  ) values (
    btrim(p_name),v_slug,v_code,
    nullif(btrim(p_business_email),''),
    nullif(btrim(p_business_phone),''),
    nullif(btrim(p_business_type),''),
    'NGN','Africa/Lagos','catalogue','trial','not_connected'
  )
  returning id into v_tenant_id;

  insert into public.tenant_members (tenant_id,user_id,role)
  values (v_tenant_id,p_user_id,'owner');

  insert into public.sellertray_membership_events (
    tenant_id,
    event_type,
    subject_user_id,
    subject_email,
    new_role,
    actor_user_id,
    actor_kind,
    reason,
    detail
  ) values (
    v_tenant_id,
    'initial_owner_assigned',
    p_user_id,
    v_owner_email,
    'owner',
    p_user_id,
    'merchant_member',
    'Initial Business provisioning',
    jsonb_build_object(
      'source', 'provision_business_for_user',
      'merchantCode', v_code,
      'businessContactEmail', nullif(btrim(p_business_email),''),
      'ownerIdentityDerivedFromAuthenticatedUser', true
    )
  );

  return v_tenant_id;
end;
$$;

revoke all on function public.provision_business_for_user(uuid,text,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.provision_business_for_user(uuid,text,text,text,text,text)
  to service_role;
