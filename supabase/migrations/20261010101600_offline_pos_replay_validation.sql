begin;

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
  if p_client_reference is null then
    raise exception 'Sale reference is required' using errcode='22023';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items)<1
     or jsonb_array_length(p_items)>100 then
    raise exception 'Add between 1 and 100 products' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_tenant_id::text),
    hashtext(p_client_reference::text)
  );

  v_fingerprint := md5(jsonb_build_object(
    'branchId',p_branch_id,
    'customerName',p_customer_name,
    'customerPhone',p_customer_phone,
    'note',p_note,
    'items',p_items
  )::text);

  select r.order_id,r.payload_fingerprint
  into v_existing_order_id,v_existing_fingerprint
  from public.sellertray_pos_draft_requests r
  where r.tenant_id=p_tenant_id
    and r.client_reference=p_client_reference;

  if v_existing_order_id is not null then
    if v_existing_fingerprint is distinct from v_fingerprint then
      raise exception 'Sale reference was reused with different details'
        using errcode='23505';
    end if;
    return v_existing_order_id;
  end if;

  -- Queued sales carry the product/UOM values the cashier actually saw. Replay
  -- must fail for review when those commercial facts have changed; SellerTray
  -- never silently adopts a new price or conversion for an offline-held sale.
  with requested as (
    select x.catalog_item_id,x.uom_id,x.quantity,
           x.expected_selling_price,x.expected_conversion_factor
    from jsonb_to_recordset(p_items) as x(
      catalog_item_id uuid,
      uom_id uuid,
      quantity numeric,
      expected_selling_price numeric,
      expected_conversion_factor numeric
    )
  )
  select count(*)::int into v_item_count
  from requested r
  join public.catalog_items ci
    on ci.tenant_id=p_tenant_id
   and ci.id=r.catalog_item_id
   and ci.is_active=true
  join public.catalog_item_uoms u
    on u.tenant_id=p_tenant_id
   and u.catalog_item_id=ci.id
   and u.id=r.uom_id
  where r.quantity>0
    and r.quantity<=9999
    and r.expected_selling_price is not null
    and r.expected_conversion_factor is not null
    and u.selling_price is not null
    and u.selling_price=r.expected_selling_price
    and u.conversion_factor=r.expected_conversion_factor
    and (u.allow_fractional or r.quantity=trunc(r.quantity));

  if v_item_count<>jsonb_array_length(p_items) then
    raise exception 'Queued sale needs review because a product price or unit changed'
      using errcode='23514';
  end if;

  if not exists(
    select 1 from public.branches b
    where b.tenant_id=p_tenant_id
      and b.id=p_branch_id
      and b.is_active=true
  ) then
    raise exception 'Queued sale needs review because the Branch is no longer available'
      using errcode='23514';
  end if;

  if exists(
    with requested as (
      select x.catalog_item_id,
             sum(x.quantity*u.conversion_factor)::numeric as required_stock
      from jsonb_to_recordset(p_items) as x(
        catalog_item_id uuid,
        uom_id uuid,
        quantity numeric,
        expected_selling_price numeric,
        expected_conversion_factor numeric
      )
      join public.catalog_item_uoms u
        on u.tenant_id=p_tenant_id
       and u.catalog_item_id=x.catalog_item_id
       and u.id=x.uom_id
      group by x.catalog_item_id
    )
    select 1
    from requested r
    where r.required_stock > coalesce((
      select sum(im.quantity_delta)
      from public.inventory_movements im
      where im.tenant_id=p_tenant_id
        and im.branch_id=p_branch_id
        and im.catalog_item_id=r.catalog_item_id
    ),0)
  ) then
    raise exception 'Queued sale needs review because Branch stock is no longer sufficient'
      using errcode='23514';
  end if;

  v_order_id := public.create_sellertray_pos_order_atomic(
    p_tenant_id,
    p_branch_id,
    p_customer_name,
    p_customer_phone,
    p_note,
    p_items
  );

  insert into public.sellertray_pos_draft_requests(
    tenant_id,client_reference,order_id,payload_fingerprint
  ) values(
    p_tenant_id,p_client_reference,v_order_id,v_fingerprint
  );

  return v_order_id;
end;
$$;

revoke all on function public.create_sellertray_pos_order_idempotent(
  uuid,uuid,text,text,text,jsonb,uuid
) from public,anon,authenticated;
grant execute on function public.create_sellertray_pos_order_idempotent(
  uuid,uuid,text,text,text,jsonb,uuid
) to service_role;

commit;