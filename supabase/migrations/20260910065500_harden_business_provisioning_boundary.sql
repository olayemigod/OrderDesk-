revoke all on function public.create_my_business(text, text, text, text) from authenticated;
drop function if exists public.create_my_business(text, text, text, text);

create or replace function public.provision_business_for_user(
  p_user_id uuid,
  p_name text,
  p_business_email text default null,
  p_business_phone text default null,
  p_business_type text default null
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
begin
  if p_user_id is null or not exists (
    select 1 from auth.users u where u.id = p_user_id
  ) then
    raise exception 'Valid user is required' using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.tenant_members tm
    where tm.user_id = p_user_id
  ) then
    raise exception 'Initial business provisioning is only available when no workspace exists' using errcode = '23514';
  end if;

  if nullif(btrim(p_name), '') is null then
    raise exception 'Business name is required' using errcode = '23514';
  end if;

  v_slug_base := trim(both '-' from regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '-', 'g'));
  if v_slug_base = '' then
    v_slug_base := 'business';
  end if;
  v_slug := left(v_slug_base, 48) || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);

  insert into public.tenants (
    name,
    slug,
    business_email,
    business_phone,
    business_type,
    currency,
    timezone,
    onboarding_status,
    subscription_status,
    whatsapp_connection_status
  ) values (
    btrim(p_name),
    v_slug,
    nullif(btrim(p_business_email), ''),
    nullif(btrim(p_business_phone), ''),
    nullif(btrim(p_business_type), ''),
    'NGN',
    'Africa/Lagos',
    'catalogue',
    'trial',
    'not_connected'
  )
  returning id into v_tenant_id;

  insert into public.tenant_members (tenant_id, user_id, role)
  values (v_tenant_id, p_user_id, 'owner');

  return v_tenant_id;
end;
$$;

revoke all on function public.provision_business_for_user(uuid, text, text, text, text) from public;
revoke all on function public.provision_business_for_user(uuid, text, text, text, text) from anon;
revoke all on function public.provision_business_for_user(uuid, text, text, text, text) from authenticated;
grant execute on function public.provision_business_for_user(uuid, text, text, text, text) to service_role;
