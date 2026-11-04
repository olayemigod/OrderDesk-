-- Approved 04/11/2026 UOM pricing fallback: explicitly configured unit price wins;
-- otherwise calculate from the current Stock UOM selling price times the
-- selected unit's conversion factor. Do not materialise calculated values
-- into catalog_item_uoms.selling_price or rewrite historical orders.
-- Applies to POS creation, queued/offline price validation, draft edits and
-- barcode resolution. Preserve Branch, permission, payment and stock gates.
begin;

create or replace function public.sellertray_effective_uom_selling_price(
  p_tenant_id uuid,
  p_catalog_item_id uuid,
  p_uom_id uuid
)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(u.selling_price, round(ci.price_ngn * u.conversion_factor, 2))
  from public.catalog_item_uoms u
  join public.catalog_items ci
    on ci.tenant_id = u.tenant_id and ci.id = u.catalog_item_id
  where u.tenant_id = p_tenant_id
    and u.catalog_item_id = p_catalog_item_id
    and u.id = p_uom_id;
$$;

revoke all on function public.sellertray_effective_uom_selling_price(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.sellertray_effective_uom_selling_price(uuid,uuid,uuid)
  to service_role;

CREATE OR REPLACE FUNCTION public.create_sellertray_pos_order_atomic(p_tenant_id uuid, p_branch_id uuid, p_customer_id uuid, p_customer_name text, p_customer_phone text, p_note text, p_items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  join public.catalog_item_uoms u on u.id=r.uom_id and u.tenant_id=p_tenant_id and u.catalog_item_id=ci.id and public.sellertray_effective_uom_selling_price(p_tenant_id,ci.id,u.id) is not null
  where r.quantity>0 and r.quantity<=9999 and (u.allow_fractional or r.quantity=trunc(r.quantity));

  if v_item_count<>jsonb_array_length(p_items) then
    raise exception 'One selected product or unit is unavailable, unpriced or has an invalid quantity' using errcode='23514';
  end if;

  v_customer_id := public.resolve_sellertray_pos_customer(p_tenant_id,p_customer_id,p_customer_name,p_customer_phone);

  with requested as (
    select x.catalog_item_id,x.uom_id,x.quantity
    from jsonb_to_recordset(p_items) as x(catalog_item_id uuid,uom_id uuid,quantity numeric)
  )
  select sum(public.sellertray_effective_uom_selling_price(p_tenant_id,r.catalog_item_id,r.uom_id)*r.quantity)::numeric(14,2) into v_total
  from requested r
  join public.catalog_item_uoms u on u.id=r.uom_id and u.tenant_id=p_tenant_id and u.catalog_item_id=r.catalog_item_id;

  insert into public.orders(tenant_id,branch_id,customer_id,status,source,customer_note,parser_source,parser_version,parser_confidence,review_reasons,currency,total_amount)
  values(p_tenant_id,p_branch_id,v_customer_id,'draft','pos',nullif(btrim(coalesce(p_note,'')),''),'manual',null,null,'{}'::text[],v_currency,v_total)
  returning id into v_order_id;

  insert into public.order_items(tenant_id,order_id,catalog_item_id,item_name,original_item_name,quantity,selected_uom,conversion_factor,stock_quantity,unit_price,match_source,match_confidence)
  select p_tenant_id,v_order_id,ci.id,ci.name,ci.name,r.quantity,u.uom_name,u.conversion_factor,r.quantity*u.conversion_factor,public.sellertray_effective_uom_selling_price(p_tenant_id,ci.id,u.id),'manual',1
  from jsonb_to_recordset(p_items) as r(catalog_item_id uuid,uom_id uuid,quantity numeric)
  join public.catalog_items ci on ci.id=r.catalog_item_id and ci.tenant_id=p_tenant_id
  join public.catalog_item_uoms u on u.id=r.uom_id and u.tenant_id=p_tenant_id and u.catalog_item_id=ci.id;

  return v_order_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_sellertray_pos_order_idempotent(p_tenant_id uuid, p_branch_id uuid, p_customer_id uuid, p_customer_name text, p_customer_phone text, p_note text, p_items jsonb, p_client_reference uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
    and public.sellertray_effective_uom_selling_price(p_tenant_id,ci.id,u.id)=r.expected_selling_price
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
$function$;

-- Patch the currently installed draft editor rather than replacing it with a
-- historical version: Production and the clean migration replay have different
-- authorised hold/resume capabilities. Preserve their existing actor, Branch,
-- add-product, price-override and payment/stock denial rules exactly.
do $sellertray_uom_price_editor$
declare
  v_definition text;
  v_filter text := 'u[.]selling_price[[:space:]]+is[[:space:]]+not[[:space:]]+null[[:space:]]+and[[:space:]]+u[.]selling_price[[:space:]]*>=[[:space:]]*0';
  v_count integer;
begin
  select pg_get_functiondef('public.update_sellertray_pos_draft_items(uuid,uuid,jsonb)'::regprocedure)
    into v_definition;
  -- The installed Production editor and the newer additive-resume editor
  -- format their guards differently. Match whitespace without changing logic.
  select count(*)::int into v_count from regexp_matches(v_definition,v_filter,'g');
  if v_count not in (1,2)
     or position('v_effective_price:=v_uom.selling_price;' in v_definition)=0
     or position('abs(v_requested_price-v_uom.selling_price)>0.004' in v_definition)=0 then
    raise exception 'Unexpected POS draft editor version; manual governed migration review required' using errcode='23514';
  end if;

  v_definition := regexp_replace(
    v_definition,v_filter,
    'public.sellertray_effective_uom_selling_price(p_tenant_id,u.catalog_item_id,u.id) is not null','g'
  );
  v_definition := replace(
    v_definition,'v_effective_price:=v_uom.selling_price;',
    'v_effective_price:=public.sellertray_effective_uom_selling_price(p_tenant_id,v_uom.catalog_item_id,v_uom.id);'
  );
  v_definition := replace(
    v_definition,'abs(v_requested_price-v_uom.selling_price)>0.004',
    'abs(v_requested_price-v_effective_price)>0.004'
  );
  execute v_definition;
end;
$sellertray_uom_price_editor$;

CREATE OR REPLACE FUNCTION public.resolve_sellertray_product_barcode(p_tenant_id uuid, p_barcode text)
 RETURNS TABLE(product_id uuid, uom_id uuid, product_name text, sku text, category text, stock_uom text, uom_name text, conversion_factor numeric, selling_price numeric, allow_fractional boolean, item_active boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_barcode text := nullif(btrim(coalesce(p_barcode,'')),'');
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;

  if not exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id=p_tenant_id
      and tm.user_id=v_user_id
  ) then
    raise exception 'Business access denied' using errcode='42501';
  end if;

  if v_barcode is null then
    raise exception 'Scan or enter a barcode' using errcode='22023';
  end if;

  return query
  select
    ci.id,
    u.id,
    ci.name,
    ci.sku,
    ci.category,
    ci.stock_uom,
    u.uom_name,
    u.conversion_factor,
    public.sellertray_effective_uom_selling_price(p_tenant_id,ci.id,u.id),
    u.allow_fractional,
    ci.is_active
  from public.catalog_item_uoms u
  join public.catalog_items ci
    on ci.tenant_id=u.tenant_id
   and ci.id=u.catalog_item_id
  where u.tenant_id=p_tenant_id
    and btrim(u.barcode)=v_barcode
  limit 1;
end;
$function$;

commit;
