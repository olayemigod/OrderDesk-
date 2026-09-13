-- SellerTray Phase 1 hardening: create order aggregates transactionally so a
-- late item/constraint failure cannot leave a partial commercial order behind.

create or replace function public.create_sellertray_manual_order_atomic(
  p_tenant_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_note text,
  p_items jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_customer_id uuid;
  v_order_id uuid;
  v_currency text;
  v_total numeric(14,2);
  v_item_count integer;
begin
  if p_tenant_id is null then
    raise exception 'Business is required' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_customer_name, '')), '') is null then
    raise exception 'Customer name is required' using errcode = '22023';
  end if;
  if p_customer_phone is null or p_customer_phone !~ '^\\+?[0-9]{7,15}$' then
    raise exception 'Customer phone is invalid' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) < 1
     or jsonb_array_length(p_items) > 50 then
    raise exception 'Add between 1 and 50 products' using errcode = '22023';
  end if;

  select t.currency into v_currency
  from public.tenants t
  where t.id = p_tenant_id;

  if v_currency is null then
    raise exception 'Business not found' using errcode = 'P0002';
  end if;

  with requested as (
    select x.catalog_item_id, x.quantity
    from jsonb_to_recordset(p_items) as x(catalog_item_id uuid, quantity numeric)
  )
  select count(*)::int
  into v_item_count
  from requested r
  join public.catalog_items ci
    on ci.id = r.catalog_item_id
   and ci.tenant_id = p_tenant_id
   and ci.is_active = true
   and ci.price_ngn is not null
   and ci.price_ngn >= 0
  where r.quantity > 0 and r.quantity <= 9999;

  if v_item_count <> jsonb_array_length(p_items) then
    raise exception 'One selected product is unavailable, unpriced or has an invalid quantity'
      using errcode = '23514';
  end if;

  insert into public.customers (
    tenant_id,
    wa_id,
    display_name,
    phone,
    updated_at
  ) values (
    p_tenant_id,
    'manual:' || p_customer_phone,
    left(btrim(p_customer_name), 120),
    p_customer_phone,
    now()
  )
  on conflict (tenant_id, wa_id) do update
  set display_name = excluded.display_name,
      phone = excluded.phone,
      updated_at = now()
  returning id into v_customer_id;

  with requested as (
    select x.catalog_item_id, x.quantity
    from jsonb_to_recordset(p_items) as x(catalog_item_id uuid, quantity numeric)
  )
  select sum(ci.price_ngn * r.quantity)::numeric(14,2)
  into v_total
  from requested r
  join public.catalog_items ci
    on ci.id = r.catalog_item_id
   and ci.tenant_id = p_tenant_id;

  insert into public.orders (
    tenant_id,
    customer_id,
    status,
    source,
    customer_note,
    parser_source,
    parser_version,
    parser_confidence,
    review_reasons,
    currency,
    total_amount
  ) values (
    p_tenant_id,
    v_customer_id,
    'needs_review',
    'manual',
    nullif(btrim(coalesce(p_note, '')), ''),
    'manual',
    null,
    null,
    '{}'::text[],
    v_currency,
    v_total
  )
  returning id into v_order_id;

  insert into public.order_items (
    tenant_id,
    order_id,
    catalog_item_id,
    item_name,
    original_item_name,
    quantity,
    unit_price,
    match_source,
    match_confidence
  )
  select
    p_tenant_id,
    v_order_id,
    ci.id,
    ci.name,
    ci.name,
    r.quantity,
    ci.price_ngn,
    'manual',
    1
  from jsonb_to_recordset(p_items) as r(catalog_item_id uuid, quantity numeric)
  join public.catalog_items ci
    on ci.id = r.catalog_item_id
   and ci.tenant_id = p_tenant_id;

  return v_order_id;
end;
$$;

create or replace function public.create_sellertray_whatsapp_order_atomic(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_source_message_id uuid,
  p_customer_note text,
  p_parser_confidence numeric,
  p_parser_source text,
  p_parser_version text,
  p_review_reasons text[],
  p_currency text,
  p_items jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_total numeric(14,2);
begin
  if p_tenant_id is null or p_customer_id is null or p_source_message_id is null then
    raise exception 'Tenant, customer and source message are required' using errcode = '22023';
  end if;
  if p_parser_source not in ('external', 'fallback') then
    raise exception 'Unsupported WhatsApp parser source' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) is distinct from 'array'
     or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 40 then
    raise exception 'WhatsApp order items are invalid' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.customers c
    where c.id = p_customer_id
      and c.tenant_id = p_tenant_id
  ) then
    raise exception 'Customer does not belong to this business' using errcode = '23503';
  end if;

  if not exists (
    select 1
    from public.inbound_messages im
    where im.id = p_source_message_id
      and im.tenant_id = p_tenant_id
      and im.customer_id = p_customer_id
  ) then
    raise exception 'Source message does not belong to this customer/business' using errcode = '23503';
  end if;

  insert into public.orders (
    tenant_id,
    customer_id,
    source_message_id,
    status,
    source,
    customer_note,
    parser_confidence,
    parser_source,
    parser_version,
    review_reasons,
    currency
  ) values (
    p_tenant_id,
    p_customer_id,
    p_source_message_id,
    'needs_review',
    'whatsapp',
    p_customer_note,
    p_parser_confidence,
    p_parser_source,
    p_parser_version,
    coalesce(p_review_reasons, '{}'::text[]),
    coalesce(nullif(btrim(p_currency), ''), 'NGN')
  )
  returning id into v_order_id;

  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 0 then
    insert into public.order_items (
      tenant_id,
      order_id,
      catalog_item_id,
      item_name,
      original_item_name,
      quantity,
      unit_price,
      match_source,
      match_confidence
    )
    select
      p_tenant_id,
      v_order_id,
      x.catalog_item_id,
      x.item_name,
      x.original_item_name,
      x.quantity,
      x.unit_price,
      x.match_source,
      x.match_confidence
    from jsonb_to_recordset(p_items) as x(
      catalog_item_id uuid,
      item_name text,
      original_item_name text,
      quantity numeric,
      unit_price numeric,
      match_source text,
      match_confidence numeric
    );
  end if;

  select case
    when count(*) = 0 then null
    when count(*) = count(oi.unit_price) then sum(oi.line_total)::numeric(14,2)
    else null
  end
  into v_total
  from public.order_items oi
  where oi.tenant_id = p_tenant_id
    and oi.order_id = v_order_id;

  update public.orders
  set total_amount = v_total,
      updated_at = now()
  where id = v_order_id
    and tenant_id = p_tenant_id;

  return v_order_id;
end;
$$;

revoke all on function public.create_sellertray_manual_order_atomic(uuid,text,text,text,jsonb)
  from public, anon, authenticated;
revoke all on function public.create_sellertray_whatsapp_order_atomic(uuid,uuid,uuid,text,numeric,text,text,text[],text,jsonb)
  from public, anon, authenticated;

grant execute on function public.create_sellertray_manual_order_atomic(uuid,text,text,text,jsonb)
  to service_role;
grant execute on function public.create_sellertray_whatsapp_order_atomic(uuid,uuid,uuid,text,numeric,text,text,text[],text,jsonb)
  to service_role;
