-- Forward-only pre-C2 optional customer phone repair.
-- Preserve tenant/auth/subscription limits, explicit phone matching, WhatsApp
-- linked identity and the existing anonymous walk-in singleton.
begin;

-- create_sellertray_customer
CREATE OR REPLACE FUNCTION public.create_sellertray_customer(p_tenant_id uuid, p_display_name text, p_phone text, p_email text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_name text := nullif(btrim(coalesce(p_display_name, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_customer_id uuid;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode = '42501';
  end if;
  if p_tenant_id is null then
    raise exception 'Business is required' using errcode = '22023';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode = '42501';
  end if;
  if v_name is null or char_length(v_name) > 120 then
    raise exception 'Customer name is required and must be 120 characters or fewer' using errcode = '22023';
  end if;
  if v_phone is not null and v_phone !~ '^\+?[0-9]{7,15}$' then
    raise exception 'Customer phone is invalid' using errcode = '22023';
  end if;
  if v_email is not null and (
    char_length(v_email) > 254
    or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  ) then
    raise exception 'Customer email is invalid' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = p_tenant_id
      and tm.user_id = v_user_id
      and tm.role in ('owner', 'manager')
  ) then
    raise exception 'Owner or Manager access is required to manage customers' using errcode = '42501';
  end if;

  v_customer_id := public.resolve_sellertray_pos_customer(
    p_tenant_id,
    null,
    v_name,
    v_phone
  );

  update public.customers c
  set display_name = v_name,
      email = v_email,
      updated_at = now()
  where c.tenant_id = p_tenant_id
    and c.id = v_customer_id;

  return v_customer_id;
end;
$function$;


-- resolve_sellertray_pos_customer
CREATE OR REPLACE FUNCTION public.resolve_sellertray_pos_customer(p_tenant_id uuid, p_customer_id uuid, p_customer_name text, p_customer_phone text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_customer_id uuid;
  v_customer_name text := nullif(btrim(coalesce(p_customer_name,'')),'');
  v_customer_phone text := nullif(btrim(coalesce(p_customer_phone,'')),'');
  v_phone_digits text;
  v_match_count integer;
begin
  if p_tenant_id is null then
    raise exception 'Business is required' using errcode='22023';
  end if;

  if p_customer_id is not null then
    select c.id into v_customer_id
    from public.customers c
    where c.tenant_id=p_tenant_id and c.id=p_customer_id;
    if v_customer_id is null then
      raise exception 'Selected customer is unavailable for this business' using errcode='23514';
    end if;
    return v_customer_id;
  end if;

  if v_customer_name is null and v_customer_phone is not null then
    raise exception 'Enter customer name when providing a phone' using errcode='22023';
  end if;

  if v_customer_phone is null then
    -- A named, phone-less Customer is distinct from the shared walk-in.
    -- Generate a stable reserved non-WhatsApp identity for each new Customer.
    if v_customer_name is not null then
      insert into public.customers(tenant_id,wa_id,display_name,phone,updated_at)
      values(p_tenant_id,'manual:unlinked:'||pg_catalog.gen_random_uuid()::text,left(v_customer_name,120),null,now())
      returning id into v_customer_id;
      return v_customer_id;
    end if;
    insert into public.customers(tenant_id,wa_id,display_name,phone,updated_at)
    values(p_tenant_id,'pos:walk-in','Walk-in Customer',null,now())
    on conflict (tenant_id,wa_id) do update
      set display_name='Walk-in Customer',updated_at=now()
    returning id into v_customer_id;
    return v_customer_id;
  end if;

  if v_customer_phone !~ '^\+?[0-9]{7,15}$' then
    raise exception 'Customer phone is invalid' using errcode='22023';
  end if;

  v_phone_digits := regexp_replace(v_customer_phone,'[^0-9]','','g');

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_tenant_id::text),
    pg_catalog.hashtext(v_phone_digits)
  );

  select count(*)::integer
  into v_match_count
  from public.customers c
  where c.tenant_id=p_tenant_id
    and (
      c.wa_id=v_phone_digits
      or c.wa_id='manual:'||v_customer_phone
      or c.wa_id='manual:'||v_phone_digits
      or regexp_replace(coalesce(c.phone,''),'[^0-9]','','g')=v_phone_digits
    );

  if v_match_count>1 then
    raise exception 'Multiple customer records use this phone. Select the customer from search.' using errcode='23514';
  end if;

  if v_match_count=1 then
    select c.id into v_customer_id
    from public.customers c
    where c.tenant_id=p_tenant_id
      and (
        c.wa_id=v_phone_digits
        or c.wa_id='manual:'||v_customer_phone
        or c.wa_id='manual:'||v_phone_digits
        or regexp_replace(coalesce(c.phone,''),'[^0-9]','','g')=v_phone_digits
      )
    order by c.created_at,c.id
    limit 1;
    return v_customer_id;
  end if;

  insert into public.customers(tenant_id,wa_id,display_name,phone,updated_at)
  values(p_tenant_id,'manual:'||v_customer_phone,left(v_customer_name,120),v_customer_phone,now())
  on conflict (tenant_id,wa_id) do update
    set display_name=excluded.display_name,phone=excluded.phone,updated_at=now()
  returning id into v_customer_id;

  return v_customer_id;
end;
$function$;

commit;
