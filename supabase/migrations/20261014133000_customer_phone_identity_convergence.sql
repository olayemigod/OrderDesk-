begin;

-- Customer identity is shared across POS and WhatsApp. Normalise only superficial
-- phone formatting (for example an optional leading '+'); do not infer country
-- codes or rewrite local numbers into international numbers.
create or replace function public.resolve_sellertray_pos_customer(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_customer_name text,
  p_customer_phone text
)
returns uuid
language plpgsql
security invoker
set search_path=''
as $$
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

  if (v_customer_name is null) <> (v_customer_phone is null) then
    raise exception 'Enter both customer name and phone, or leave both blank for a walk-in sale' using errcode='22023';
  end if;

  if v_customer_phone is null then
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
$$;

revoke all on function public.resolve_sellertray_pos_customer(uuid,uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.resolve_sellertray_pos_customer(uuid,uuid,text,text)
  to service_role;

-- Resolve a WhatsApp sender through the same Customer truth. If the number was
-- first entered at POS, upgrade that manual Customer in place so its history and
-- orders remain attached to the same Customer ID.
create or replace function public.resolve_sellertray_whatsapp_customer(
  p_tenant_id uuid,
  p_wa_id text,
  p_display_name text default null
)
returns uuid
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_wa_id text := nullif(btrim(coalesce(p_wa_id,'')),'');
  v_display_name text := nullif(btrim(coalesce(p_display_name,'')),'');
  v_customer_id uuid;
  v_match_count integer;
begin
  if p_tenant_id is null then
    raise exception 'Business is required' using errcode='22023';
  end if;
  if v_wa_id is null or v_wa_id !~ '^[0-9]{7,15}$' then
    raise exception 'WhatsApp customer phone is invalid' using errcode='22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_tenant_id::text),
    pg_catalog.hashtext(v_wa_id)
  );

  select c.id into v_customer_id
  from public.customers c
  where c.tenant_id=p_tenant_id and c.wa_id=v_wa_id
  limit 1;

  if v_customer_id is not null then
    update public.customers
    set display_name=coalesce(v_display_name,display_name),
        phone=v_wa_id,
        updated_at=now()
    where tenant_id=p_tenant_id and id=v_customer_id;
    return v_customer_id;
  end if;

  select count(*)::integer
  into v_match_count
  from public.customers c
  where c.tenant_id=p_tenant_id
    and c.wa_id like 'manual:%'
    and (
      regexp_replace(coalesce(c.phone,''),'[^0-9]','','g')=v_wa_id
      or regexp_replace(substr(c.wa_id,8),'[^0-9]','','g')=v_wa_id
    );

  if v_match_count=1 then
    select c.id into v_customer_id
    from public.customers c
    where c.tenant_id=p_tenant_id
      and c.wa_id like 'manual:%'
      and (
        regexp_replace(coalesce(c.phone,''),'[^0-9]','','g')=v_wa_id
        or regexp_replace(substr(c.wa_id,8),'[^0-9]','','g')=v_wa_id
      )
    order by c.created_at,c.id
    limit 1;

    begin
      update public.customers
      set wa_id=v_wa_id,
          display_name=coalesce(v_display_name,display_name),
          phone=v_wa_id,
          updated_at=now()
      where tenant_id=p_tenant_id and id=v_customer_id;
      return v_customer_id;
    exception when unique_violation then
      select c.id into v_customer_id
      from public.customers c
      where c.tenant_id=p_tenant_id and c.wa_id=v_wa_id
      limit 1;
      if v_customer_id is not null then return v_customer_id; end if;
      raise;
    end;
  end if;

  if v_match_count>1 then
    raise warning 'SellerTray found multiple manual customers matching WhatsApp sender % in business %; preserving them for explicit reconciliation',v_wa_id,p_tenant_id;
  end if;

  insert into public.customers(tenant_id,wa_id,display_name,phone,updated_at)
  values(p_tenant_id,v_wa_id,coalesce(v_display_name,v_wa_id),v_wa_id,now())
  on conflict (tenant_id,wa_id) do update
    set display_name=coalesce(excluded.display_name,public.customers.display_name),
        phone=excluded.phone,
        updated_at=now()
  returning id into v_customer_id;

  return v_customer_id;
end;
$$;

revoke all on function public.resolve_sellertray_whatsapp_customer(uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.resolve_sellertray_whatsapp_customer(uuid,text,text)
  to service_role;

commit;
