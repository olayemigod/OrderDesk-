-- Govern SellerTray business identity images through tenant-scoped storage.
-- Merchant Web remains the management surface, while tenants.logo_url remains
-- the shared identity consumed by Mobile, WhatsApp and receipt/invoice surfaces.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'business-logos',
  'business-logos',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp']::text[]
)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "SellerTray business logo upload" on storage.objects;
create policy "SellerTray business logo upload"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'business-logos'
  and exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id::text = (storage.foldername(name))[1]
      and tm.user_id = auth.uid()
      and tm.role = any (array['owner'::text, 'manager'::text])
      and public.orderdesk_subscription_can_write(tm.tenant_id)
  )
);

drop policy if exists "SellerTray business logo update" on storage.objects;
create policy "SellerTray business logo update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'business-logos'
  and exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id::text = (storage.foldername(name))[1]
      and tm.user_id = auth.uid()
      and tm.role = any (array['owner'::text, 'manager'::text])
      and public.orderdesk_subscription_can_write(tm.tenant_id)
  )
)
with check (
  bucket_id = 'business-logos'
  and exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id::text = (storage.foldername(name))[1]
      and tm.user_id = auth.uid()
      and tm.role = any (array['owner'::text, 'manager'::text])
      and public.orderdesk_subscription_can_write(tm.tenant_id)
  )
);

drop policy if exists "SellerTray business logo delete" on storage.objects;
create policy "SellerTray business logo delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'business-logos'
  and exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id::text = (storage.foldername(name))[1]
      and tm.user_id = auth.uid()
      and tm.role = any (array['owner'::text, 'manager'::text])
      and public.orderdesk_subscription_can_write(tm.tenant_id)
  )
);

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
set search_path to ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_name text := nullif(btrim(coalesce(p_name,'')),'');
  v_email text := nullif(lower(btrim(coalesce(p_business_email,''))),'');
  v_phone text := nullif(btrim(coalesce(p_business_phone,'')),'');
  v_type text := nullif(btrim(coalesce(p_business_type,'')),'');
  v_logo text := nullif(btrim(coalesce(p_logo_url,'')),'');
  v_currency text := upper(nullif(btrim(coalesce(p_currency,'')),''));
  v_timezone text := nullif(btrim(coalesce(p_timezone,'')),'');
  v_issuer text;
  v_logo_prefix text;
  v_logo_object_name text;
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

  if v_logo is not null then
    v_issuer := nullif(auth.jwt()->>'iss','');
    if v_issuer is null or v_issuer !~* '^https://' then
      raise exception 'SellerTray could not verify the logo storage origin' using errcode='22023';
    end if;

    v_logo_prefix := regexp_replace(v_issuer, '/auth/v1/?$', '')
      || '/storage/v1/object/public/business-logos/';

    if v_logo not like v_logo_prefix || p_tenant_id::text || '/%' then
      raise exception 'Business logo must use the governed SellerTray logo store' using errcode='22023';
    end if;

    v_logo_object_name := substring(v_logo from char_length(v_logo_prefix) + 1);
    if v_logo_object_name is null
      or position('?' in v_logo_object_name) > 0
      or position('#' in v_logo_object_name) > 0
      or split_part(v_logo_object_name, '/', 1) <> p_tenant_id::text
      or v_logo_object_name !~* ('^' || p_tenant_id::text || '/business-logo-[A-Za-z0-9-]+\.(png|jpg|jpeg|webp)$')
      or not exists (
        select 1
        from storage.objects so
        where so.bucket_id='business-logos'
          and so.name=v_logo_object_name
      )
    then
      raise exception 'Business logo is not a valid SellerTray-managed image' using errcode='22023';
    end if;
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
$function$;

comment on function public.save_sellertray_business_profile(uuid,text,text,text,text,text,text,text)
is 'Updates governed SellerTray business identity. Non-null logos must reference an existing tenant-owned object in the public business-logos bucket.';
