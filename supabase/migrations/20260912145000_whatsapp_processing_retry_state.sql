-- SellerTray Phase 1 hardening: make inbound WhatsApp processing retry-safe.
-- A provider retry can reclaim a failed/stale message instead of being discarded
-- merely because provider_message_id was already persisted.

alter table public.inbound_messages
  add column if not exists processing_status text not null default 'received',
  add column if not exists processing_attempts integer not null default 0,
  add column if not exists processing_started_at timestamptz,
  add column if not exists processing_completed_at timestamptz,
  add column if not exists processing_error text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.inbound_messages
  drop constraint if exists inbound_messages_processing_status_check,
  add constraint inbound_messages_processing_status_check
    check (processing_status in ('received','processing','completed','failed')),
  drop constraint if exists inbound_messages_processing_attempts_check,
  add constraint inbound_messages_processing_attempts_check
    check (processing_attempts >= 0);

update public.inbound_messages
set processing_status = 'completed',
    processing_completed_at = coalesce(processing_completed_at, received_at, now()),
    updated_at = now()
where processing_status = 'received';

create index if not exists inbound_messages_processing_queue_idx
  on public.inbound_messages (processing_status, processing_started_at, received_at)
  where processing_status in ('received','processing','failed');

create unique index if not exists orders_source_message_unique
  on public.orders (source_message_id)
  where source_message_id is not null;

create or replace function public.claim_sellertray_inbound_message(p_message_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_rows integer := 0;
begin
  update public.inbound_messages im
  set processing_status = 'processing',
      processing_attempts = im.processing_attempts + 1,
      processing_started_at = now(),
      processing_completed_at = null,
      processing_error = null,
      updated_at = now()
  where im.id = p_message_id
    and (
      im.processing_status in ('received','failed')
      or (
        im.processing_status = 'processing'
        and (
          im.processing_started_at is null
          or im.processing_started_at <= now() - interval '10 minutes'
        )
      )
    );

  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

revoke all on function public.claim_sellertray_inbound_message(uuid)
  from public, anon, authenticated;
grant execute on function public.claim_sellertray_inbound_message(uuid)
  to service_role;

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

  select o.id into v_order_id
  from public.orders o
  where o.source_message_id = p_source_message_id
    and o.tenant_id = p_tenant_id
  limit 1;

  if v_order_id is not null then
    return v_order_id;
  end if;

  if p_parser_source not in ('external', 'fallback') then
    raise exception 'Unsupported WhatsApp parser source' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) is distinct from 'array'
     or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 40 then
    raise exception 'WhatsApp order items are invalid' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.customers c
    where c.id = p_customer_id and c.tenant_id = p_tenant_id
  ) then
    raise exception 'Customer does not belong to this business' using errcode = '23503';
  end if;

  if not exists (
    select 1 from public.inbound_messages im
    where im.id = p_source_message_id
      and im.tenant_id = p_tenant_id
      and im.customer_id = p_customer_id
  ) then
    raise exception 'Source message does not belong to this customer/business' using errcode = '23503';
  end if;

  insert into public.orders (
    tenant_id, customer_id, source_message_id, status, source, customer_note,
    parser_confidence, parser_source, parser_version, review_reasons, currency
  ) values (
    p_tenant_id, p_customer_id, p_source_message_id, 'needs_review', 'whatsapp', p_customer_note,
    p_parser_confidence, p_parser_source, p_parser_version,
    coalesce(p_review_reasons, '{}'::text[]),
    coalesce(nullif(btrim(p_currency), ''), 'NGN')
  )
  returning id into v_order_id;

  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 0 then
    insert into public.order_items (
      tenant_id, order_id, catalog_item_id, item_name, original_item_name,
      quantity, unit_price, match_source, match_confidence
    )
    select
      p_tenant_id, v_order_id, x.catalog_item_id, x.item_name, x.original_item_name,
      x.quantity, x.unit_price, x.match_source, x.match_confidence
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
  where oi.tenant_id = p_tenant_id and oi.order_id = v_order_id;

  update public.orders
  set total_amount = v_total, updated_at = now()
  where id = v_order_id and tenant_id = p_tenant_id;

  return v_order_id;
exception
  when unique_violation then
    select o.id into v_order_id
    from public.orders o
    where o.source_message_id = p_source_message_id
      and o.tenant_id = p_tenant_id
    limit 1;
    if v_order_id is not null then
      return v_order_id;
    end if;
    raise;
end;
$$;

revoke all on function public.create_sellertray_whatsapp_order_atomic(uuid,uuid,uuid,text,numeric,text,text,text[],text,jsonb)
  from public, anon, authenticated;
grant execute on function public.create_sellertray_whatsapp_order_atomic(uuid,uuid,uuid,text,numeric,text,text,text[],text,jsonb)
  to service_role;
