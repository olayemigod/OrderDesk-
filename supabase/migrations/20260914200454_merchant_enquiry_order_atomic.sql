-- SellerTray QA hardening: merchant-controlled conversion of customer enquiries
-- into catalogue-backed orders in one database transaction.

create or replace function public.create_sellertray_enquiry_order_atomic(
  p_tenant_id uuid,
  p_enquiry_id uuid,
  p_quantity numeric
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_enquiry public.customer_enquiries%rowtype;
  v_item public.catalog_items%rowtype;
  v_order_id uuid;
begin
  if p_tenant_id is null or p_enquiry_id is null then
    raise exception 'Business and enquiry are required' using errcode = '22023';
  end if;

  if p_quantity is null or p_quantity <= 0 or p_quantity > 9999 then
    raise exception 'Quantity must be between 1 and 9999' using errcode = '22023';
  end if;

  select *
  into v_enquiry
  from public.customer_enquiries e
  where e.id = p_enquiry_id
    and e.tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'Enquiry not found' using errcode = 'P0002';
  end if;

  if v_enquiry.converted_order_id is not null or v_enquiry.status = 'converted' then
    raise exception 'This enquiry is already linked to an order' using errcode = '23514';
  end if;

  if v_enquiry.status = 'dismissed' then
    raise exception 'Dismissed enquiries cannot be converted to orders' using errcode = '23514';
  end if;

  if v_enquiry.matched_catalog_item_id is null then
    raise exception 'Resolve this enquiry to a catalogue product before creating an order' using errcode = '23514';
  end if;

  select *
  into v_item
  from public.catalog_items ci
  where ci.id = v_enquiry.matched_catalog_item_id
    and ci.tenant_id = p_tenant_id
    and ci.is_active = true
    and ci.price_ngn is not null
    and ci.price_ngn >= 0;

  if not found then
    raise exception 'The matched catalogue product is unavailable or unpriced' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.customers c
    where c.id = v_enquiry.customer_id
      and c.tenant_id = p_tenant_id
  ) then
    raise exception 'Customer does not belong to this business' using errcode = '23503';
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
    currency,
    total_amount
  ) values (
    p_tenant_id,
    v_enquiry.customer_id,
    v_enquiry.source_inbound_message_id,
    'needs_review',
    'manual',
    v_enquiry.original_text,
    null,
    'manual',
    'merchant-enquiry-v1',
    '{}'::text[],
    v_enquiry.currency,
    (v_item.price_ngn * p_quantity)::numeric(14,2)
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
  ) values (
    p_tenant_id,
    v_order_id,
    v_item.id,
    v_item.name,
    coalesce(v_enquiry.matched_item_name, v_item.name),
    p_quantity,
    v_item.price_ngn,
    'manual',
    1
  );

  update public.customer_enquiries
  set status = 'converted',
      converted_order_id = v_order_id,
      converted_at = now(),
      updated_at = now()
  where id = p_enquiry_id
    and tenant_id = p_tenant_id;

  return v_order_id;
end;
$$;

revoke all on function public.create_sellertray_enquiry_order_atomic(uuid,uuid,numeric)
  from public, anon, authenticated;

grant execute on function public.create_sellertray_enquiry_order_atomic(uuid,uuid,numeric)
  to service_role;
