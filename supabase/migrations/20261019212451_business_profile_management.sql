begin;

create or replace function public.get_sellertray_business_profile(
  p_tenant_id uuid
)
returns table(
  name text,
  merchant_code text,
  business_email text,
  business_phone text,
  business_type text,
  logo_url text,
  currency text,
  timezone text,
  subscription_status text,
  whatsapp_connection_status text
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;

  if not exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id=p_tenant_id
      and tm.user_id=v_user_id
      and tm.role in ('owner','manager')
  ) then
    raise exception 'Merchant Web business settings are available to Owners and Managers' using errcode='42501';
  end if;

  return query
  select
    t.name,
    t.merchant_code,
    t.business_email,
    t.business_phone,
    t.business_type,
    t.logo_url,
    upper(t.currency),
    coalesce(nullif(t.timezone,''),'Africa/Lagos'),
    t.subscription_status,
    t.whatsapp_connection_status
  from public.tenants t
  where t.id=p_tenant_id;

  if not found then
    raise exception 'Business not found' using errcode='P0002';
  end if;
end;
$$;

create or replace function public.save_sellertray_business_profile(
  p_tenant_id uuid,
  p_name text,
  p_business_email text default null,
  p_business_phone text default null,
  p_business_type text default null,
  p_logo_url text default null,
  p_currency text default 'NGN',
  p_timezone text default 'Africa/Lagos'
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text := nullif(btrim(coalesce(p_name,'')),'');
  v_email text := nullif(lower(btrim(coalesce(p_business_email,''))),'');
  v_phone text := nullif(btrim(coalesce(p_business_phone,'')),'');
  v_type text := nullif(btrim(coalesce(p_business_type,'')),'');
  v_logo text := nullif(btrim(coalesce(p_logo_url,'')),'');
  v_currency text := upper(nullif(btrim(coalesce(p_currency,'')),''));
  v_timezone text := nullif(btrim(coalesce(p_timezone,'')),'');
  v_row public.tenants%rowtype;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;

  if not exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id=p_tenant_id
      and tm.user_id=v_user_id
      and tm.role in ('owner','manager')
  ) then
    raise exception 'Only business Owners and Managers can update business settings' using errcode='42501';
  end if;

  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  if v_name is null then
    raise exception 'Business name is required' using errcode='22023';
  end if;
  if char_length(v_name)>160 then
    raise exception 'Business name is too long' using errcode='22023';
  end if;
  if v_email is not null and (char_length(v_email)>320 or position('@' in v_email)<=1) then
    raise exception 'Business email is invalid' using errcode='22023';
  end if;
  if v_phone is not null and char_length(v_phone)>60 then
    raise exception 'Business phone is too long' using errcode='22023';
  end if;
  if v_type is not null and char_length(v_type)>120 then
    raise exception 'Business type is too long' using errcode='22023';
  end if;
  if v_logo is not null and (char_length(v_logo)>1000 or v_logo !~* '^https://') then
    raise exception 'Logo URL must be a valid HTTPS URL' using errcode='22023';
  end if;
  if v_currency is null or v_currency !~ '^[A-Z]{3}$' then
    raise exception 'Currency must be a 3-letter code' using errcode='22023';
  end if;
  if v_timezone is null or not exists (
    select 1 from pg_catalog.pg_timezone_names tz where tz.name=v_timezone
  ) then
    raise exception 'Timezone is invalid' using errcode='22023';
  end if;

  update public.tenants t
  set name=v_name,
      business_email=v_email,
      business_phone=v_phone,
      business_type=v_type,
      logo_url=v_logo,
      currency=v_currency,
      timezone=v_timezone,
      updated_at=now()
  where t.id=p_tenant_id
  returning t.* into v_row;

  if not found then
    raise exception 'Business not found' using errcode='P0002';
  end if;

  return jsonb_build_object(
    'name',v_row.name,
    'merchantCode',v_row.merchant_code,
    'businessEmail',v_row.business_email,
    'businessPhone',v_row.business_phone,
    'businessType',v_row.business_type,
    'logoUrl',v_row.logo_url,
    'currency',upper(v_row.currency),
    'timezone',coalesce(nullif(v_row.timezone,''),'Africa/Lagos'),
    'subscriptionStatus',v_row.subscription_status,
    'whatsappConnectionStatus',v_row.whatsapp_connection_status
  );
end;
$$;

revoke all on function public.get_sellertray_business_profile(uuid) from public,anon;
grant execute on function public.get_sellertray_business_profile(uuid) to authenticated,service_role;

revoke all on function public.save_sellertray_business_profile(uuid,text,text,text,text,text,text,text) from public,anon;
grant execute on function public.save_sellertray_business_profile(uuid,text,text,text,text,text,text,text) to authenticated,service_role;

commit;
