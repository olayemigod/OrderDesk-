create table if not exists public.order_item_catalogue_candidates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid not null,
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  source_inbound_message_id uuid references public.inbound_messages(id) on delete set null,
  customer_wording text not null,
  status text not null default 'pending'
    check (status in ('pending','matched_existing','created_product','one_off','dismissed')),
  resolution_catalog_item_id uuid references public.catalog_items(id) on delete set null,
  learned_alias text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id,order_item_id),
  foreign key (tenant_id,order_id) references public.orders(tenant_id,id) on delete cascade
);

alter table public.order_item_catalogue_candidates enable row level security;
revoke all on public.order_item_catalogue_candidates from public,anon,authenticated;
grant all on public.order_item_catalogue_candidates to service_role;

create index if not exists order_item_catalogue_candidates_order_idx
  on public.order_item_catalogue_candidates(tenant_id,order_id,status,created_at);
create index if not exists order_item_catalogue_candidates_customer_idx
  on public.order_item_catalogue_candidates(customer_id,created_at desc);
create index if not exists order_item_catalogue_candidates_source_idx
  on public.order_item_catalogue_candidates(source_inbound_message_id)
  where source_inbound_message_id is not null;
create index if not exists order_item_catalogue_candidates_resolution_idx
  on public.order_item_catalogue_candidates(resolution_catalog_item_id)
  where resolution_catalog_item_id is not null;

alter table public.order_items
  drop constraint if exists order_items_match_source_check;

alter table public.order_items
  add constraint order_items_match_source_check
  check (match_source = any(array[
    'legacy'::text,
    'catalogue_name'::text,
    'catalogue_alias'::text,
    'normalized_name'::text,
    'normalized_alias'::text,
    'unmatched'::text,
    'manual'::text,
    'whatsapp_catalog'::text,
    'merchant_match'::text,
    'one_off'::text
  ]));

create or replace function public.refresh_sellertray_order_review_reasons(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_reasons text[];
  v_tenant_id uuid;
begin
  select o.tenant_id,o.review_reasons
  into v_tenant_id,v_reasons
  from public.orders o
  where o.id=p_order_id
  for update;

  if v_tenant_id is null then return; end if;

  v_reasons := coalesce(v_reasons,'{}'::text[]);
  v_reasons := array_remove(v_reasons,'no_items');
  v_reasons := array_remove(v_reasons,'unmatched_catalogue_item');
  v_reasons := array_remove(v_reasons,'missing_price');

  if not exists(
    select 1 from public.order_items oi
    where oi.tenant_id=v_tenant_id and oi.order_id=p_order_id
  ) then
    v_reasons := array_append(v_reasons,'no_items');
  else
    if exists(
      select 1 from public.order_items oi
      where oi.tenant_id=v_tenant_id and oi.order_id=p_order_id
        and oi.catalog_item_id is null
        and oi.match_source='unmatched'
    ) then
      v_reasons := array_append(v_reasons,'unmatched_catalogue_item');
    end if;

    if exists(
      select 1 from public.order_items oi
      where oi.tenant_id=v_tenant_id and oi.order_id=p_order_id
        and oi.unit_price is null
    ) then
      v_reasons := array_append(v_reasons,'missing_price');
    end if;
  end if;

  update public.orders
  set review_reasons=(
        select coalesce(array_agg(distinct x order by x),'{}'::text[])
        from unnest(v_reasons) x
      ),
      updated_at=now()
  where id=p_order_id;
end;
$$;

revoke all on function public.refresh_sellertray_order_review_reasons(uuid)
from public,anon,authenticated;
grant execute on function public.refresh_sellertray_order_review_reasons(uuid)
to service_role;

create or replace function public.queue_sellertray_order_item_catalogue_candidate()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_customer_id uuid;
  v_source_message_id uuid;
  v_wording text;
begin
  if new.catalog_item_id is not null or new.match_source <> 'unmatched' then
    return new;
  end if;

  select o.customer_id,o.source_message_id
  into v_customer_id,v_source_message_id
  from public.orders o
  where o.id=new.order_id and o.tenant_id=new.tenant_id;

  if v_customer_id is null then return new; end if;

  v_wording := coalesce(
    nullif(btrim(new.original_item_name),''),
    nullif(btrim(new.item_name),''),
    'Unknown item'
  );

  insert into public.order_item_catalogue_candidates(
    tenant_id,order_id,order_item_id,customer_id,source_inbound_message_id,
    customer_wording,status,created_at,updated_at
  )
  values(
    new.tenant_id,new.order_id,new.id,v_customer_id,v_source_message_id,
    v_wording,'pending',now(),now()
  )
  on conflict(tenant_id,order_item_id) do update
  set customer_wording=excluded.customer_wording,
      source_inbound_message_id=excluded.source_inbound_message_id,
      status='pending',
      resolution_catalog_item_id=null,
      learned_alias=null,
      reviewed_by=null,
      reviewed_at=null,
      updated_at=now();

  return new;
end;
$$;

revoke all on function public.queue_sellertray_order_item_catalogue_candidate()
from public,anon,authenticated;

drop trigger if exists queue_sellertray_order_item_catalogue_candidate on public.order_items;
create trigger queue_sellertray_order_item_catalogue_candidate
after insert or update of catalog_item_id,match_source,item_name,original_item_name
on public.order_items
for each row execute function public.queue_sellertray_order_item_catalogue_candidate();

create or replace function public.refresh_sellertray_order_review_reasons_trigger()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order_id uuid;
begin
  v_order_id := case when tg_op='DELETE' then old.order_id else new.order_id end;
  perform public.refresh_sellertray_order_review_reasons(v_order_id);

  if tg_op='UPDATE' and old.order_id is distinct from new.order_id then
    perform public.refresh_sellertray_order_review_reasons(old.order_id);
  end if;

  return coalesce(new,old);
end;
$$;

revoke all on function public.refresh_sellertray_order_review_reasons_trigger()
from public,anon,authenticated;

drop trigger if exists refresh_sellertray_order_review_reasons on public.order_items;
create trigger refresh_sellertray_order_review_reasons
after insert or delete or update of catalog_item_id,match_source,unit_price,order_id
on public.order_items
for each row execute function public.refresh_sellertray_order_review_reasons_trigger();

insert into public.order_item_catalogue_candidates(
  tenant_id,order_id,order_item_id,customer_id,source_inbound_message_id,
  customer_wording,status,created_at,updated_at
)
select
  oi.tenant_id,oi.order_id,oi.id,o.customer_id,o.source_message_id,
  coalesce(nullif(btrim(oi.original_item_name),''),oi.item_name),
  'pending',now(),now()
from public.order_items oi
join public.orders o on o.id=oi.order_id and o.tenant_id=oi.tenant_id
where oi.catalog_item_id is null
  and oi.match_source='unmatched'
on conflict(tenant_id,order_item_id) do nothing;

create or replace function public.sellertray_list_order_item_catalogue_candidates(
  p_tenant_id uuid,
  p_order_id uuid
)
returns table(
  id uuid,
  order_item_id uuid,
  customer_wording text,
  status text,
  resolution_catalog_item_id uuid,
  learned_alias text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;

  if not exists(
    select 1 from public.tenant_members tm
    where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id
  ) then
    raise exception 'SellerTray business membership required';
  end if;

  return query
  select
    c.id,c.order_item_id,c.customer_wording,c.status,
    c.resolution_catalog_item_id,c.learned_alias,c.created_at
  from public.order_item_catalogue_candidates c
  where c.tenant_id=p_tenant_id
    and c.order_id=p_order_id
  order by c.created_at asc;
end;
$$;

revoke all on function public.sellertray_list_order_item_catalogue_candidates(uuid,uuid)
from public,anon;
grant execute on function public.sellertray_list_order_item_catalogue_candidates(uuid,uuid)
to authenticated,service_role;

create or replace function public.sellertray_match_order_item_to_catalogue(
  p_tenant_id uuid,
  p_order_item_id uuid,
  p_catalog_item_id uuid,
  p_learn_alias boolean default true
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_order_id uuid;
  v_order_status text;
  v_original text;
  v_item_name text;
  v_price numeric;
  v_alias text;
  v_alias_learned boolean := false;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;

  if v_role is null then raise exception 'SellerTray business membership required'; end if;

  select oi.order_id,o.status,
         coalesce(nullif(btrim(oi.original_item_name),''),oi.item_name)
  into v_order_id,v_order_status,v_original
  from public.order_items oi
  join public.orders o on o.id=oi.order_id and o.tenant_id=oi.tenant_id
  where oi.id=p_order_item_id and oi.tenant_id=p_tenant_id
  for update of oi;

  if v_order_id is null then raise exception 'Order item not found'; end if;
  if v_order_status not in ('draft','needs_review') then
    raise exception 'Catalogue resolution is only available before order acceptance';
  end if;

  select ci.name,ci.price_ngn
  into v_item_name,v_price
  from public.catalog_items ci
  where ci.id=p_catalog_item_id and ci.tenant_id=p_tenant_id and ci.is_active=true;

  if v_item_name is null then raise exception 'Active catalogue item not found'; end if;
  if v_price is null then raise exception 'Catalogue item needs a selling price before it can resolve this order'; end if;

  update public.order_items
  set catalog_item_id=p_catalog_item_id,
      item_name=v_item_name,
      unit_price=v_price,
      match_source='merchant_match',
      match_confidence=1
  where id=p_order_item_id and tenant_id=p_tenant_id;

  v_alias := nullif(btrim(v_original),'');
  if coalesce(p_learn_alias,true)
     and v_role in ('owner','manager')
     and v_alias is not null
     and lower(v_alias) <> lower(btrim(v_item_name))
     and not exists(
       select 1 from public.catalog_item_aliases a
       where a.tenant_id=p_tenant_id
         and lower(btrim(a.alias))=lower(v_alias)
     )
  then
    insert into public.catalog_item_aliases(tenant_id,catalog_item_id,alias)
    values(p_tenant_id,p_catalog_item_id,v_alias);
    v_alias_learned := true;
  end if;

  update public.order_item_catalogue_candidates
  set status='matched_existing',
      resolution_catalog_item_id=p_catalog_item_id,
      learned_alias=case when v_alias_learned then v_alias else null end,
      reviewed_by=v_user_id,
      reviewed_at=now(),
      updated_at=now()
  where tenant_id=p_tenant_id and order_item_id=p_order_item_id;

  perform public.refresh_sellertray_order_review_reasons(v_order_id);

  insert into public.commercial_action_ledger(
    tenant_id,action_key,channel,customer_id,target_order_id,
    action_type,risk_class,requested_by,policy_result,action_status,metadata,applied_at
  )
  select
    p_tenant_id,
    'catalogue-match:'||p_order_item_id::text||':'||p_catalog_item_id::text,
    'merchant_app',o.customer_id,v_order_id,
    'order_item_matched_to_catalogue','medium',
    case when v_role='staff' then 'staff' else 'merchant' end,
    'allowed','applied',
    jsonb_build_object(
      'order_item_id',p_order_item_id,
      'catalog_item_id',p_catalog_item_id,
      'customer_wording',v_original,
      'learned_alias',case when v_alias_learned then v_alias else null end
    ),
    now()
  from public.orders o where o.id=v_order_id
  on conflict(tenant_id,action_key) do nothing;
end;
$$;

revoke all on function public.sellertray_match_order_item_to_catalogue(uuid,uuid,uuid,boolean)
from public,anon;
grant execute on function public.sellertray_match_order_item_to_catalogue(uuid,uuid,uuid,boolean)
to authenticated,service_role;

create or replace function public.sellertray_create_catalogue_from_order_item(
  p_tenant_id uuid,
  p_order_item_id uuid,
  p_name text,
  p_price numeric,
  p_sku text default null,
  p_category text default null,
  p_learn_alias boolean default true
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_order_id uuid;
  v_order_status text;
  v_original text;
  v_item_id uuid;
  v_alias text;
  v_alias_learned boolean := false;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;

  if v_role not in ('owner','manager') then
    raise exception 'Owner or Manager access is required to create catalogue products';
  end if;

  if nullif(btrim(p_name),'') is null then raise exception 'Product name is required'; end if;
  if p_price is null or p_price < 0 then raise exception 'A valid selling price is required'; end if;

  select oi.order_id,o.status,
         coalesce(nullif(btrim(oi.original_item_name),''),oi.item_name)
  into v_order_id,v_order_status,v_original
  from public.order_items oi
  join public.orders o on o.id=oi.order_id and o.tenant_id=oi.tenant_id
  where oi.id=p_order_item_id and oi.tenant_id=p_tenant_id
  for update of oi;

  if v_order_id is null then raise exception 'Order item not found'; end if;
  if v_order_status not in ('draft','needs_review') then
    raise exception 'Catalogue resolution is only available before order acceptance';
  end if;

  insert into public.catalog_items(
    tenant_id,name,sku,price_ngn,is_active,category
  )
  values(
    p_tenant_id,btrim(p_name),nullif(btrim(p_sku),''),
    p_price,true,nullif(btrim(p_category),'')
  )
  returning id into v_item_id;

  v_alias := nullif(btrim(v_original),'');
  if coalesce(p_learn_alias,true)
     and v_alias is not null
     and lower(v_alias) <> lower(btrim(p_name))
     and not exists(
       select 1 from public.catalog_item_aliases a
       where a.tenant_id=p_tenant_id
         and lower(btrim(a.alias))=lower(v_alias)
     )
  then
    insert into public.catalog_item_aliases(tenant_id,catalog_item_id,alias)
    values(p_tenant_id,v_item_id,v_alias);
    v_alias_learned := true;
  end if;

  update public.order_items
  set catalog_item_id=v_item_id,
      item_name=btrim(p_name),
      unit_price=p_price,
      match_source='merchant_match',
      match_confidence=1
  where id=p_order_item_id and tenant_id=p_tenant_id;

  update public.order_item_catalogue_candidates
  set status='created_product',
      resolution_catalog_item_id=v_item_id,
      learned_alias=case when v_alias_learned then v_alias else null end,
      reviewed_by=v_user_id,
      reviewed_at=now(),
      updated_at=now()
  where tenant_id=p_tenant_id and order_item_id=p_order_item_id;

  perform public.refresh_sellertray_order_review_reasons(v_order_id);

  insert into public.commercial_action_ledger(
    tenant_id,action_key,channel,customer_id,target_order_id,
    action_type,risk_class,requested_by,policy_result,action_status,metadata,applied_at
  )
  select
    p_tenant_id,
    'catalogue-create:'||p_order_item_id::text||':'||v_item_id::text,
    'merchant_app',o.customer_id,v_order_id,
    'catalogue_item_created_from_order','medium','merchant',
    'allowed','applied',
    jsonb_build_object(
      'order_item_id',p_order_item_id,
      'catalog_item_id',v_item_id,
      'customer_wording',v_original,
      'catalogue_name',btrim(p_name),
      'learned_alias',case when v_alias_learned then v_alias else null end
    ),
    now()
  from public.orders o where o.id=v_order_id
  on conflict(tenant_id,action_key) do nothing;

  return v_item_id;
end;
$$;

revoke all on function public.sellertray_create_catalogue_from_order_item(uuid,uuid,text,numeric,text,text,boolean)
from public,anon;
grant execute on function public.sellertray_create_catalogue_from_order_item(uuid,uuid,text,numeric,text,text,boolean)
to authenticated,service_role;

create or replace function public.sellertray_keep_order_item_one_off(
  p_tenant_id uuid,
  p_order_item_id uuid,
  p_price numeric,
  p_name text default null
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_order_id uuid;
  v_order_status text;
  v_original text;
  v_final_name text;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;

  if v_role is null then raise exception 'SellerTray business membership required'; end if;
  if p_price is null or p_price < 0 then raise exception 'A valid selling price is required'; end if;

  select oi.order_id,o.status,
         coalesce(nullif(btrim(oi.original_item_name),''),oi.item_name),
         coalesce(nullif(btrim(p_name),''),oi.item_name)
  into v_order_id,v_order_status,v_original,v_final_name
  from public.order_items oi
  join public.orders o on o.id=oi.order_id and o.tenant_id=oi.tenant_id
  where oi.id=p_order_item_id and oi.tenant_id=p_tenant_id
  for update of oi;

  if v_order_id is null then raise exception 'Order item not found'; end if;
  if v_order_status not in ('draft','needs_review') then
    raise exception 'One-off resolution is only available before order acceptance';
  end if;

  update public.order_items
  set catalog_item_id=null,
      item_name=v_final_name,
      unit_price=p_price,
      match_source='one_off',
      match_confidence=1
  where id=p_order_item_id and tenant_id=p_tenant_id;

  update public.order_item_catalogue_candidates
  set status='one_off',
      resolution_catalog_item_id=null,
      learned_alias=null,
      reviewed_by=v_user_id,
      reviewed_at=now(),
      updated_at=now()
  where tenant_id=p_tenant_id and order_item_id=p_order_item_id;

  perform public.refresh_sellertray_order_review_reasons(v_order_id);

  insert into public.commercial_action_ledger(
    tenant_id,action_key,channel,customer_id,target_order_id,
    action_type,risk_class,requested_by,policy_result,action_status,metadata,applied_at
  )
  select
    p_tenant_id,
    'catalogue-one-off:'||p_order_item_id::text,
    'merchant_app',o.customer_id,v_order_id,
    'order_item_kept_one_off','medium',
    case when v_role='staff' then 'staff' else 'merchant' end,
    'allowed','applied',
    jsonb_build_object(
      'order_item_id',p_order_item_id,
      'customer_wording',v_original,
      'final_name',v_final_name,
      'unit_price',p_price
    ),
    now()
  from public.orders o where o.id=v_order_id
  on conflict(tenant_id,action_key) do nothing;
end;
$$;

revoke all on function public.sellertray_keep_order_item_one_off(uuid,uuid,numeric,text)
from public,anon;
grant execute on function public.sellertray_keep_order_item_one_off(uuid,uuid,numeric,text)
to authenticated,service_role;

create or replace function public.guard_order_status_transition()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_decision jsonb;
begin
  if new.status = old.status then return new; end if;

  if old.status in ('completed','rejected','cancelled') then
    raise exception 'Order status % is terminal',old.status using errcode='23514';
  end if;

  if new.status='accepted' then
    if old.status not in ('draft','needs_review') then
      raise exception 'Order cannot move from % to accepted',old.status using errcode='23514';
    end if;

    if not exists(
      select 1 from public.order_items oi
      where oi.tenant_id=new.tenant_id and oi.order_id=new.id
    ) then
      raise exception 'Order must contain at least one item before acceptance' using errcode='23514';
    end if;

    if exists(
      select 1 from public.order_items oi
      where oi.tenant_id=new.tenant_id and oi.order_id=new.id and oi.unit_price is null
    ) then
      raise exception 'All order items must be priced before acceptance' using errcode='23514';
    end if;

    if exists(
      select 1 from public.order_items oi
      where oi.tenant_id=new.tenant_id and oi.order_id=new.id
        and oi.catalog_item_id is null
        and oi.match_source='unmatched'
    ) then
      raise exception 'Resolve unmatched catalogue items or explicitly keep them as one-off before acceptance' using errcode='23514';
    end if;

    return new;
  end if;

  if new.status='rejected' and old.status in ('draft','needs_review') then return new; end if;

  if new.status='processing' and old.status='accepted' then
    v_decision := public.sellertray_payment_gate_decision(new.id,'processing');
    if coalesce((v_decision->>'allowed')::boolean,false) is not true then
      raise exception '%',coalesce(v_decision->>'reason','Payment policy blocks processing') using errcode='23514';
    end if;
    return new;
  end if;

  if new.status='ready' and old.status='processing' then
    v_decision := public.sellertray_payment_gate_decision(new.id,'ready');
    if coalesce((v_decision->>'allowed')::boolean,false) is not true then
      raise exception '%',coalesce(v_decision->>'reason','Payment policy blocks ready status') using errcode='23514';
    end if;
    return new;
  end if;

  if new.status='completed' and old.status='ready' then
    if new.fulfillment_method is null
       or new.fulfillment_status not in ('delivered','collected')
       or new.fulfilled_at is null
       or new.fulfillment_confirmed_by not in ('merchant','customer_whatsapp') then
      raise exception 'Completed SellerTray orders require governed fulfillment evidence' using errcode='23514';
    end if;

    if new.fulfillment_method='customer_pickup' and new.fulfillment_status<>'collected' then
      raise exception 'Customer pickup must complete as collected' using errcode='23514';
    end if;

    if new.fulfillment_method in ('merchant_delivery','third_party_delivery')
       and new.fulfillment_status<>'delivered' then
      raise exception 'Delivery fulfillment must complete as delivered' using errcode='23514';
    end if;

    v_decision := public.sellertray_payment_gate_decision(new.id,'complete');
    if coalesce((v_decision->>'allowed')::boolean,false) is not true then
      raise exception '%',coalesce(v_decision->>'reason','Payment policy blocks completion') using errcode='23514';
    end if;

    return new;
  end if;

  if new.status='cancelled' and old.status in ('accepted','processing','ready') then return new; end if;

  raise exception 'Invalid order status transition: % -> %',old.status,new.status using errcode='23514';
end;
$$;
