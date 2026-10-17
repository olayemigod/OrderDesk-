begin;

-- POS customer selection must reuse the shared Customer truth used by WhatsApp.
-- An exact selected customer ID wins. Name/phone entry reuses a single matching
-- customer and fails closed when the phone is ambiguous rather than creating a
-- second manual identity.
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

  select count(*)::integer,min(c.id)
  into v_match_count,v_customer_id
  from public.customers c
  where c.tenant_id=p_tenant_id and c.phone=v_customer_phone;

  if v_match_count>1 then
    raise exception 'Multiple customer records use this phone. Select the customer from search.' using errcode='23514';
  end if;
  if v_match_count=1 then
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

revoke all on function public.resolve_sellertray_pos_customer(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.resolve_sellertray_pos_customer(uuid,uuid,text,text) to service_role;

create or replace function public.create_sellertray_pos_order_atomic(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_customer_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_note text,
  p_items jsonb
)
returns uuid
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_customer_id uuid;
  v_order_id uuid;
  v_currency text;
  v_total numeric(14,2);
  v_item_count integer;
begin
  if p_tenant_id is null then raise exception 'Business is required' using errcode='22023'; end if;
  if p_branch_id is null then raise exception 'Branch is required' using errcode='22023'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>100 then
    raise exception 'Add between 1 and 100 products' using errcode='22023';
  end if;

  select t.currency into v_currency from public.tenants t where t.id=p_tenant_id;
  if v_currency is null then raise exception 'Business not found' using errcode='P0002'; end if;
  if not exists(select 1 from public.branches b where b.tenant_id=p_tenant_id and b.id=p_branch_id and b.is_active=true) then
    raise exception 'Selected branch is unavailable for this business' using errcode='23514';
  end if;

  with requested as (
    select x.catalog_item_id,x.uom_id,x.quantity
    from jsonb_to_recordset(p_items) as x(catalog_item_id uuid,uom_id uuid,quantity numeric)
  )
  select count(*)::int into v_item_count
  from requested r
  join public.catalog_items ci on ci.id=r.catalog_item_id and ci.tenant_id=p_tenant_id and ci.is_active=true
  join public.catalog_item_uoms u on u.id=r.uom_id and u.tenant_id=p_tenant_id and u.catalog_item_id=ci.id and u.selling_price is not null and u.selling_price>=0
  where r.quantity>0 and r.quantity<=9999 and (u.allow_fractional or r.quantity=trunc(r.quantity));

  if v_item_count<>jsonb_array_length(p_items) then
    raise exception 'One selected product or unit is unavailable, unpriced or has an invalid quantity' using errcode='23514';
  end if;

  v_customer_id := public.resolve_sellertray_pos_customer(p_tenant_id,p_customer_id,p_customer_name,p_customer_phone);

  with requested as (
    select x.catalog_item_id,x.uom_id,x.quantity
    from jsonb_to_recordset(p_items) as x(catalog_item_id uuid,uom_id uuid,quantity numeric)
  )
  select sum(u.selling_price*r.quantity)::numeric(14,2) into v_total
  from requested r
  join public.catalog_item_uoms u on u.id=r.uom_id and u.tenant_id=p_tenant_id and u.catalog_item_id=r.catalog_item_id;

  insert into public.orders(tenant_id,branch_id,customer_id,status,source,customer_note,parser_source,parser_version,parser_confidence,review_reasons,currency,total_amount)
  values(p_tenant_id,p_branch_id,v_customer_id,'draft','pos',nullif(btrim(coalesce(p_note,'')),''),'manual',null,null,'{}'::text[],v_currency,v_total)
  returning id into v_order_id;

  insert into public.order_items(tenant_id,order_id,catalog_item_id,item_name,original_item_name,quantity,selected_uom,conversion_factor,stock_quantity,unit_price,match_source,match_confidence)
  select p_tenant_id,v_order_id,ci.id,ci.name,ci.name,r.quantity,u.uom_name,u.conversion_factor,r.quantity*u.conversion_factor,u.selling_price,'manual',1
  from jsonb_to_recordset(p_items) as r(catalog_item_id uuid,uom_id uuid,quantity numeric)
  join public.catalog_items ci on ci.id=r.catalog_item_id and ci.tenant_id=p_tenant_id
  join public.catalog_item_uoms u on u.id=r.uom_id and u.tenant_id=p_tenant_id and u.catalog_item_id=ci.id;

  return v_order_id;
end;
$$;

revoke all on function public.create_sellertray_pos_order_atomic(uuid,uuid,uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.create_sellertray_pos_order_atomic(uuid,uuid,uuid,text,text,text,jsonb) to service_role;

-- Preserve the existing command contract for older clients.
create or replace function public.create_sellertray_pos_order_atomic(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_note text,
  p_items jsonb
)
returns uuid
language sql
security invoker
set search_path=''
as $$
  select public.create_sellertray_pos_order_atomic(
    p_tenant_id,p_branch_id,null::uuid,p_customer_name,p_customer_phone,p_note,p_items
  );
$$;

revoke all on function public.create_sellertray_pos_order_atomic(uuid,uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.create_sellertray_pos_order_atomic(uuid,uuid,text,text,text,jsonb) to service_role;

create or replace function public.create_sellertray_pos_order_idempotent(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_customer_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_note text,
  p_items jsonb,
  p_client_reference uuid
)
returns uuid
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_fingerprint text;
  v_existing_order_id uuid;
  v_existing_fingerprint text;
  v_order_id uuid;
  v_item_count integer;
begin
  if p_client_reference is null then raise exception 'Sale reference is required' using errcode='22023'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>100 then
    raise exception 'Add between 1 and 100 products' using errcode='22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_tenant_id::text),pg_catalog.hashtext(p_client_reference::text));

  v_fingerprint := md5(jsonb_build_object(
    'branchId',p_branch_id,
    'customerId',p_customer_id,
    'customerName',p_customer_name,
    'customerPhone',p_customer_phone,
    'note',p_note,
    'items',p_items
  )::text);

  select r.order_id,r.payload_fingerprint into v_existing_order_id,v_existing_fingerprint
  from public.sellertray_pos_draft_requests r
  where r.tenant_id=p_tenant_id and r.client_reference=p_client_reference;

  if v_existing_order_id is not null then
    if v_existing_fingerprint is distinct from v_fingerprint then
      raise exception 'Sale reference was reused with different details' using errcode='23505';
    end if;
    return v_existing_order_id;
  end if;

  with requested as (
    select x.catalog_item_id,x.uom_id,x.quantity,x.expected_selling_price,x.expected_conversion_factor
    from jsonb_to_recordset(p_items) as x(catalog_item_id uuid,uom_id uuid,quantity numeric,expected_selling_price numeric,expected_conversion_factor numeric)
  )
  select count(*)::int into v_item_count
  from requested r
  join public.catalog_items ci on ci.tenant_id=p_tenant_id and ci.id=r.catalog_item_id and ci.is_active=true
  join public.catalog_item_uoms u on u.tenant_id=p_tenant_id and u.catalog_item_id=ci.id and u.id=r.uom_id
  where r.quantity>0 and r.quantity<=9999
    and r.expected_selling_price is not null and r.expected_conversion_factor is not null
    and u.selling_price is not null and u.selling_price=r.expected_selling_price
    and u.conversion_factor=r.expected_conversion_factor
    and (u.allow_fractional or r.quantity=trunc(r.quantity));

  if v_item_count<>jsonb_array_length(p_items) then
    raise exception 'Queued sale needs review because a product price or unit changed' using errcode='23514';
  end if;

  if not exists(select 1 from public.branches b where b.tenant_id=p_tenant_id and b.id=p_branch_id and b.is_active=true) then
    raise exception 'Queued sale needs review because the Branch is no longer available' using errcode='23514';
  end if;

  if exists(
    with requested as (
      select x.catalog_item_id,sum(x.quantity*u.conversion_factor)::numeric as required_stock
      from jsonb_to_recordset(p_items) as x(catalog_item_id uuid,uom_id uuid,quantity numeric,expected_selling_price numeric,expected_conversion_factor numeric)
      join public.catalog_item_uoms u on u.tenant_id=p_tenant_id and u.catalog_item_id=x.catalog_item_id and u.id=x.uom_id
      group by x.catalog_item_id
    )
    select 1 from requested r
    where r.required_stock>coalesce((select sum(im.quantity_delta) from public.inventory_movements im where im.tenant_id=p_tenant_id and im.branch_id=p_branch_id and im.catalog_item_id=r.catalog_item_id),0)
  ) then
    raise exception 'Queued sale needs review because Branch stock is no longer sufficient' using errcode='23514';
  end if;

  v_order_id := public.create_sellertray_pos_order_atomic(
    p_tenant_id,p_branch_id,p_customer_id,p_customer_name,p_customer_phone,p_note,p_items
  );

  insert into public.sellertray_pos_draft_requests(tenant_id,client_reference,order_id,payload_fingerprint)
  values(p_tenant_id,p_client_reference,v_order_id,v_fingerprint);

  return v_order_id;
end;
$$;

revoke all on function public.create_sellertray_pos_order_idempotent(uuid,uuid,uuid,text,text,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.create_sellertray_pos_order_idempotent(uuid,uuid,uuid,text,text,text,jsonb,uuid) to service_role;

-- Preserve the old idempotent replay command for existing clients and queued v1 sales.
create or replace function public.create_sellertray_pos_order_idempotent(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_note text,
  p_items jsonb,
  p_client_reference uuid
)
returns uuid
language sql
security invoker
set search_path=''
as $$
  select public.create_sellertray_pos_order_idempotent(
    p_tenant_id,p_branch_id,null::uuid,p_customer_name,p_customer_phone,p_note,p_items,p_client_reference
  );
$$;

revoke all on function public.create_sellertray_pos_order_idempotent(uuid,uuid,text,text,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.create_sellertray_pos_order_idempotent(uuid,uuid,text,text,text,jsonb,uuid) to service_role;

commit;
