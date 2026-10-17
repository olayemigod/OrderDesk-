-- SellerTray POS foundation: create a branch-attributed, UOM-snapshotted
-- draft order without pretending that payment or stock posting has happened.
-- Completion, payment, receipt and inventory effects remain separate governed
-- commands in later slices.

create or replace function public.create_sellertray_pos_order_atomic(
  p_tenant_id uuid,
  p_branch_id uuid,
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
  v_customer_name text;
  v_customer_phone text;
begin
  if p_tenant_id is null then
    raise exception 'Business is required' using errcode = '22023';
  end if;
  if p_branch_id is null then
    raise exception 'Branch is required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) < 1
     or jsonb_array_length(p_items) > 100 then
    raise exception 'Add between 1 and 100 products' using errcode = '22023';
  end if;

  select t.currency into v_currency
  from public.tenants t
  where t.id = p_tenant_id;

  if v_currency is null then
    raise exception 'Business not found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.branches b
    where b.tenant_id = p_tenant_id
      and b.id = p_branch_id
      and b.is_active = true
  ) then
    raise exception 'Selected branch is unavailable for this business' using errcode = '23514';
  end if;

  with requested as (
    select x.catalog_item_id, x.uom_id, x.quantity
    from jsonb_to_recordset(p_items)
      as x(catalog_item_id uuid, uom_id uuid, quantity numeric)
  )
  select count(*)::int
  into v_item_count
  from requested r
  join public.catalog_items ci
    on ci.id = r.catalog_item_id
   and ci.tenant_id = p_tenant_id
   and ci.is_active = true
  join public.catalog_item_uoms u
    on u.id = r.uom_id
   and u.tenant_id = p_tenant_id
   and u.catalog_item_id = ci.id
   and u.selling_price is not null
   and u.selling_price >= 0
  where r.quantity > 0
    and r.quantity <= 9999
    and (u.allow_fractional or r.quantity = trunc(r.quantity));

  if v_item_count <> jsonb_array_length(p_items) then
    raise exception 'One selected product or unit is unavailable, unpriced or has an invalid quantity'
      using errcode = '23514';
  end if;

  v_customer_name := nullif(btrim(coalesce(p_customer_name, '')), '');
  v_customer_phone := nullif(btrim(coalesce(p_customer_phone, '')), '');

  if (v_customer_name is null) <> (v_customer_phone is null) then
    raise exception 'Enter both customer name and phone, or leave both blank for a walk-in sale'
      using errcode = '22023';
  end if;

  if v_customer_phone is not null and v_customer_phone !~ '^\\+?[0-9]{7,15}$' then
    raise exception 'Customer phone is invalid' using errcode = '22023';
  end if;

  if v_customer_phone is null then
    insert into public.customers (
      tenant_id,
      wa_id,
      display_name,
      phone,
      updated_at
    ) values (
      p_tenant_id,
      'pos:walk-in',
      'Walk-in Customer',
      null,
      now()
    )
    on conflict (tenant_id, wa_id) do update
    set display_name = 'Walk-in Customer',
        updated_at = now()
    returning id into v_customer_id;
  else
    insert into public.customers (
      tenant_id,
      wa_id,
      display_name,
      phone,
      updated_at
    ) values (
      p_tenant_id,
      'manual:' || v_customer_phone,
      left(v_customer_name, 120),
      v_customer_phone,
      now()
    )
    on conflict (tenant_id, wa_id) do update
    set display_name = excluded.display_name,
        phone = excluded.phone,
        updated_at = now()
    returning id into v_customer_id;
  end if;

  with requested as (
    select x.catalog_item_id, x.uom_id, x.quantity
    from jsonb_to_recordset(p_items)
      as x(catalog_item_id uuid, uom_id uuid, quantity numeric)
  )
  select sum(u.selling_price * r.quantity)::numeric(14,2)
  into v_total
  from requested r
  join public.catalog_item_uoms u
    on u.id = r.uom_id
   and u.tenant_id = p_tenant_id
   and u.catalog_item_id = r.catalog_item_id;

  insert into public.orders (
    tenant_id,
    branch_id,
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
    p_branch_id,
    v_customer_id,
    'draft',
    'pos',
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
    selected_uom,
    conversion_factor,
    stock_quantity,
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
    u.uom_name,
    u.conversion_factor,
    r.quantity * u.conversion_factor,
    u.selling_price,
    'manual',
    1
  from jsonb_to_recordset(p_items)
    as r(catalog_item_id uuid, uom_id uuid, quantity numeric)
  join public.catalog_items ci
    on ci.id = r.catalog_item_id
   and ci.tenant_id = p_tenant_id
  join public.catalog_item_uoms u
    on u.id = r.uom_id
   and u.tenant_id = p_tenant_id
   and u.catalog_item_id = ci.id;

  return v_order_id;
end;
$$;

revoke all on function public.create_sellertray_pos_order_atomic(uuid, uuid, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_sellertray_pos_order_atomic(uuid, uuid, text, text, text, jsonb)
  to service_role;
