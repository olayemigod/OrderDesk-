create table if not exists public.tenant_whatsapp_catalog_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  catalog_id text not null,
  catalog_name text,
  sync_mode text not null default 'manual_mapping' check (sync_mode in ('manual_mapping','import_from_meta')),
  is_enabled boolean not null default true,
  last_sync_at timestamptz,
  last_sync_status text not null default 'never' check (last_sync_status in ('never','success','error')),
  last_sync_error text,
  created_by uuid not null,
  updated_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tenant_whatsapp_catalog_settings enable row level security;
revoke all on public.tenant_whatsapp_catalog_settings from anon, authenticated;
grant select on public.tenant_whatsapp_catalog_settings to authenticated;

drop policy if exists tenant_whatsapp_catalog_settings_select_member on public.tenant_whatsapp_catalog_settings;
create policy tenant_whatsapp_catalog_settings_select_member
on public.tenant_whatsapp_catalog_settings for select to authenticated
using (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=tenant_whatsapp_catalog_settings.tenant_id
      and tm.user_id=(select auth.uid())
  )
);

alter table public.catalog_items
  add column if not exists whatsapp_catalog_id text,
  add column if not exists whatsapp_product_retailer_id text,
  add column if not exists whatsapp_mapping_source text,
  add column if not exists whatsapp_last_synced_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.catalog_items'::regclass
      and conname='catalog_items_whatsapp_mapping_source_check'
  ) then
    alter table public.catalog_items
      add constraint catalog_items_whatsapp_mapping_source_check
      check (whatsapp_mapping_source is null or whatsapp_mapping_source in ('manual','meta_import'));
  end if;
end $$;

create unique index if not exists catalog_items_whatsapp_product_unique_idx
  on public.catalog_items(tenant_id,whatsapp_catalog_id,whatsapp_product_retailer_id)
  where whatsapp_catalog_id is not null and whatsapp_product_retailer_id is not null;

create index if not exists catalog_items_whatsapp_lookup_idx
  on public.catalog_items(tenant_id,whatsapp_catalog_id,whatsapp_product_retailer_id)
  where is_active=true and whatsapp_catalog_id is not null and whatsapp_product_retailer_id is not null;

alter table public.orders drop constraint if exists orders_parser_source_check;
alter table public.orders add constraint orders_parser_source_check
check (parser_source = any(array['legacy'::text,'external'::text,'fallback'::text,'manual'::text,'native_catalog'::text]));

alter table public.order_items drop constraint if exists order_items_match_source_check;
alter table public.order_items add constraint order_items_match_source_check
check (match_source = any(array[
  'legacy'::text,'catalogue_name'::text,'catalogue_alias'::text,'normalized_name'::text,
  'normalized_alias'::text,'unmatched'::text,'manual'::text,'whatsapp_catalog'::text
]));

create or replace function public.resolve_sellertray_whatsapp_catalog_items(
  p_tenant_id uuid,p_catalog_id text,p_retailer_ids text[]
) returns table(retailer_id text,catalog_item_id uuid,item_name text,price_ngn numeric)
language sql stable security invoker set search_path=public
as $$
  select ci.whatsapp_product_retailer_id,ci.id,ci.name,ci.price_ngn
  from public.catalog_items ci
  where ci.tenant_id=p_tenant_id and ci.is_active
    and ci.whatsapp_catalog_id=p_catalog_id
    and ci.whatsapp_product_retailer_id=any(coalesce(p_retailer_ids,'{}'::text[]));
$$;
revoke all on function public.resolve_sellertray_whatsapp_catalog_items(uuid,text,text[]) from public,anon,authenticated;
grant execute on function public.resolve_sellertray_whatsapp_catalog_items(uuid,text,text[]) to service_role;

create or replace function public.upsert_sellertray_whatsapp_catalog_settings(
  p_tenant_id uuid,p_actor_user_id uuid,p_catalog_id text,p_catalog_name text default null,
  p_sync_mode text default 'manual_mapping',p_is_enabled boolean default true
) returns uuid language plpgsql security invoker set search_path=public
as $$
declare v_role text;
begin
  select role into v_role from public.tenant_members
  where tenant_id=p_tenant_id and user_id=p_actor_user_id;
  if v_role is null or v_role not in ('owner','manager') then
    raise exception 'Only the business Owner or Manager can configure the WhatsApp catalogue';
  end if;
  if nullif(btrim(p_catalog_id),'') is null then raise exception 'WhatsApp catalogue id is required'; end if;
  if p_sync_mode not in ('manual_mapping','import_from_meta') then raise exception 'Unsupported WhatsApp catalogue sync mode'; end if;

  insert into public.tenant_whatsapp_catalog_settings(
    tenant_id,catalog_id,catalog_name,sync_mode,is_enabled,created_by,updated_by
  ) values (
    p_tenant_id,btrim(p_catalog_id),nullif(btrim(p_catalog_name),''),
    p_sync_mode,coalesce(p_is_enabled,true),p_actor_user_id,p_actor_user_id
  )
  on conflict(tenant_id) do update set
    catalog_id=excluded.catalog_id,catalog_name=excluded.catalog_name,
    sync_mode=excluded.sync_mode,is_enabled=excluded.is_enabled,
    updated_by=excluded.updated_by,updated_at=now();
  return p_tenant_id;
end;
$$;
revoke all on function public.upsert_sellertray_whatsapp_catalog_settings(uuid,uuid,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.upsert_sellertray_whatsapp_catalog_settings(uuid,uuid,text,text,text,boolean) to service_role;

create or replace function public.set_sellertray_whatsapp_catalog_item_mapping(
  p_tenant_id uuid,p_actor_user_id uuid,p_catalog_item_id uuid,p_catalog_id text,
  p_product_retailer_id text,p_mapping_source text default 'manual'
) returns uuid language plpgsql security invoker set search_path=public
as $$
declare v_role text;
begin
  select role into v_role from public.tenant_members where tenant_id=p_tenant_id and user_id=p_actor_user_id;
  if v_role is null or v_role not in ('owner','manager') then
    raise exception 'Only the business Owner or Manager can map WhatsApp catalogue items';
  end if;
  if p_mapping_source not in ('manual','meta_import') then raise exception 'Unsupported WhatsApp catalogue mapping source'; end if;

  update public.catalog_items set
    whatsapp_catalog_id=nullif(btrim(p_catalog_id),''),
    whatsapp_product_retailer_id=nullif(btrim(p_product_retailer_id),''),
    whatsapp_mapping_source=p_mapping_source,
    whatsapp_last_synced_at=case when p_mapping_source='meta_import' then now() else whatsapp_last_synced_at end,
    updated_at=now()
  where id=p_catalog_item_id and tenant_id=p_tenant_id;
  if not found then raise exception 'SellerTray catalogue item not found'; end if;
  return p_catalog_item_id;
end;
$$;
revoke all on function public.set_sellertray_whatsapp_catalog_item_mapping(uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.set_sellertray_whatsapp_catalog_item_mapping(uuid,uuid,uuid,text,text,text) to service_role;

create or replace function public.clear_sellertray_whatsapp_catalog_item_mapping(
  p_tenant_id uuid,p_actor_user_id uuid,p_catalog_item_id uuid
) returns uuid language plpgsql security invoker set search_path=public
as $$
declare v_role text;
begin
  select role into v_role from public.tenant_members where tenant_id=p_tenant_id and user_id=p_actor_user_id;
  if v_role is null or v_role not in ('owner','manager') then
    raise exception 'Only the business Owner or Manager can unmap WhatsApp catalogue items';
  end if;
  update public.catalog_items set
    whatsapp_catalog_id=null,whatsapp_product_retailer_id=null,
    whatsapp_mapping_source=null,whatsapp_last_synced_at=null,updated_at=now()
  where id=p_catalog_item_id and tenant_id=p_tenant_id;
  if not found then raise exception 'SellerTray catalogue item not found'; end if;
  return p_catalog_item_id;
end;
$$;
revoke all on function public.clear_sellertray_whatsapp_catalog_item_mapping(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.clear_sellertray_whatsapp_catalog_item_mapping(uuid,uuid,uuid) to service_role;

create or replace function public.create_sellertray_whatsapp_order_atomic(
  p_tenant_id uuid,p_customer_id uuid,p_source_message_id uuid,p_customer_note text,
  p_parser_confidence numeric,p_parser_source text,p_parser_version text,
  p_review_reasons text[],p_currency text,p_items jsonb
) returns uuid language plpgsql set search_path to ''
as $$
declare v_order_id uuid; v_total numeric(14,2);
begin
  if p_tenant_id is null or p_customer_id is null or p_source_message_id is null then
    raise exception 'Tenant, customer and source message are required' using errcode='22023';
  end if;
  select o.id into v_order_id from public.orders o
  where o.source_message_id=p_source_message_id and o.tenant_id=p_tenant_id limit 1;
  if v_order_id is not null then return v_order_id; end if;
  if p_parser_source not in ('external','fallback','native_catalog') then
    raise exception 'Unsupported WhatsApp parser source' using errcode='22023';
  end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb)) is distinct from 'array'
     or jsonb_array_length(coalesce(p_items,'[]'::jsonb))>40 then
    raise exception 'WhatsApp order items are invalid' using errcode='22023';
  end if;
  if not exists(select 1 from public.customers c where c.id=p_customer_id and c.tenant_id=p_tenant_id) then
    raise exception 'Customer does not belong to this business' using errcode='23503';
  end if;
  if not exists(select 1 from public.inbound_messages im where im.id=p_source_message_id and im.tenant_id=p_tenant_id and im.customer_id=p_customer_id) then
    raise exception 'Source message does not belong to this customer/business' using errcode='23503';
  end if;

  insert into public.orders(
    tenant_id,customer_id,source_message_id,status,source,customer_note,
    parser_confidence,parser_source,parser_version,review_reasons,currency
  ) values (
    p_tenant_id,p_customer_id,p_source_message_id,'needs_review','whatsapp',p_customer_note,
    p_parser_confidence,p_parser_source,p_parser_version,coalesce(p_review_reasons,'{}'::text[]),
    coalesce(nullif(btrim(p_currency),''),'NGN')
  ) returning id into v_order_id;

  if jsonb_array_length(coalesce(p_items,'[]'::jsonb))>0 then
    insert into public.order_items(
      tenant_id,order_id,catalog_item_id,item_name,original_item_name,quantity,unit_price,match_source,match_confidence
    )
    select p_tenant_id,v_order_id,x.catalog_item_id,x.item_name,x.original_item_name,x.quantity,x.unit_price,x.match_source,x.match_confidence
    from jsonb_to_recordset(p_items) as x(
      catalog_item_id uuid,item_name text,original_item_name text,quantity numeric,
      unit_price numeric,match_source text,match_confidence numeric
    );
  end if;

  select case when count(*)=0 then null
              when count(*)=count(oi.unit_price) then sum(oi.line_total)::numeric(14,2)
              else null end
  into v_total from public.order_items oi
  where oi.tenant_id=p_tenant_id and oi.order_id=v_order_id;

  update public.orders set total_amount=v_total,updated_at=now()
  where id=v_order_id and tenant_id=p_tenant_id;
  return v_order_id;
exception when unique_violation then
  select o.id into v_order_id from public.orders o
  where o.source_message_id=p_source_message_id and o.tenant_id=p_tenant_id limit 1;
  if v_order_id is not null then return v_order_id; end if;
  raise;
end;
$$;
