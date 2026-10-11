begin;

-- Merchant management writes use shared database commands so mobile/web clients
-- do not own UOM invariants. Product reads remain RLS-backed; UOM writes are
-- command-only to protect the Stock UOM and default selling/purchase choices.

create or replace function public.save_sellertray_product(
  p_tenant_id uuid,
  p_product_id uuid,
  p_name text,
  p_sku text,
  p_category text,
  p_stock_uom text,
  p_allow_fractional_stock boolean,
  p_selling_price numeric
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_product_id uuid := p_product_id;
  v_name text := nullif(btrim(coalesce(p_name,'')),'');
  v_sku text := nullif(btrim(coalesce(p_sku,'')),'');
  v_category text := nullif(btrim(coalesce(p_category,'')),'');
  v_stock_uom text := nullif(btrim(coalesce(p_stock_uom,'')),'');
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=p_tenant_id
      and tm.user_id=v_user_id
      and tm.role in ('owner','manager')
  ) then
    raise exception 'Only business Owners and Managers can manage products' using errcode='42501';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;
  if v_name is null or v_stock_uom is null or p_selling_price is null or p_selling_price<0 then
    raise exception 'Product name, Stock UOM and a valid selling price are required' using errcode='22023';
  end if;
  if char_length(v_name)>160 or char_length(v_stock_uom)>80
     or char_length(coalesce(v_sku,''))>120 or char_length(coalesce(v_category,''))>120 then
    raise exception 'Product details are too long' using errcode='22023';
  end if;

  if v_product_id is null then
    insert into public.catalog_items(
      tenant_id,name,sku,category,price_ngn,stock_uom,allow_fractional_stock,is_active
    ) values(
      p_tenant_id,v_name,v_sku,v_category,round(p_selling_price::numeric,2),
      v_stock_uom,coalesce(p_allow_fractional_stock,true),true
    ) returning id into v_product_id;
  else
    update public.catalog_items ci
    set name=v_name,
        sku=v_sku,
        category=v_category,
        price_ngn=round(p_selling_price::numeric,2),
        stock_uom=v_stock_uom,
        allow_fractional_stock=coalesce(p_allow_fractional_stock,true),
        updated_at=now()
    where ci.tenant_id=p_tenant_id and ci.id=v_product_id;
    if not found then
      raise exception 'Product not found' using errcode='22023';
    end if;
  end if;

  return v_product_id;
end;
$$;

revoke all on function public.save_sellertray_product(uuid,uuid,text,text,text,text,boolean,numeric)
  from public,anon;
grant execute on function public.save_sellertray_product(uuid,uuid,text,text,text,text,boolean,numeric)
  to authenticated;

create or replace function public.set_sellertray_product_active(
  p_tenant_id uuid,
  p_product_id uuid,
  p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=p_tenant_id
      and tm.user_id=v_user_id
      and tm.role in ('owner','manager')
  ) then
    raise exception 'Only business Owners and Managers can manage products' using errcode='42501';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  update public.catalog_items ci
  set is_active=coalesce(p_is_active,false),updated_at=now()
  where ci.tenant_id=p_tenant_id and ci.id=p_product_id;
  if not found then raise exception 'Product not found' using errcode='22023'; end if;
end;
$$;

revoke all on function public.set_sellertray_product_active(uuid,uuid,boolean)
  from public,anon;
grant execute on function public.set_sellertray_product_active(uuid,uuid,boolean)
  to authenticated;

create or replace function public.save_sellertray_product_uom(
  p_tenant_id uuid,
  p_product_id uuid,
  p_uom_id uuid,
  p_uom_name text,
  p_conversion_factor numeric,
  p_selling_price numeric,
  p_barcode text,
  p_allow_fractional boolean,
  p_is_default_selling boolean,
  p_is_default_purchase boolean
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_uom_id uuid := p_uom_id;
  v_name text := nullif(btrim(coalesce(p_uom_name,'')),'');
  v_barcode text := nullif(btrim(coalesce(p_barcode,'')),'');
  v_stock_uom text;
  v_existing public.catalog_item_uoms%rowtype;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=p_tenant_id
      and tm.user_id=v_user_id
      and tm.role in ('owner','manager')
  ) then
    raise exception 'Only business Owners and Managers can manage product units' using errcode='42501';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;
  if v_name is null or p_conversion_factor is null or p_conversion_factor<=0
     or (p_selling_price is not null and p_selling_price<0) then
    raise exception 'Unit name, positive conversion factor and valid price are required' using errcode='22023';
  end if;
  if char_length(v_name)>80 or char_length(coalesce(v_barcode,''))>160 then
    raise exception 'Unit name or barcode is too long' using errcode='22023';
  end if;

  select ci.stock_uom into v_stock_uom
  from public.catalog_items ci
  where ci.tenant_id=p_tenant_id and ci.id=p_product_id;
  if v_stock_uom is null then raise exception 'Product not found' using errcode='22023'; end if;

  if v_uom_id is not null then
    select * into v_existing
    from public.catalog_item_uoms u
    where u.tenant_id=p_tenant_id and u.catalog_item_id=p_product_id and u.id=v_uom_id;
    if not found then raise exception 'Product unit not found' using errcode='22023'; end if;

    if lower(btrim(v_existing.uom_name))=lower(btrim(v_stock_uom))
       and lower(v_name)<>lower(btrim(v_stock_uom)) then
      raise exception 'Stock UOM cannot be renamed from the unit editor' using errcode='23514';
    end if;
    if v_existing.is_default_selling and not coalesce(p_is_default_selling,false)
       and not exists (
         select 1 from public.catalog_item_uoms u
         where u.tenant_id=p_tenant_id and u.catalog_item_id=p_product_id
           and u.id<>v_uom_id and u.is_default_selling=true
       ) then
      raise exception 'Choose another default selling unit before clearing this one' using errcode='23514';
    end if;
    if v_existing.is_default_purchase and not coalesce(p_is_default_purchase,false)
       and not exists (
         select 1 from public.catalog_item_uoms u
         where u.tenant_id=p_tenant_id and u.catalog_item_id=p_product_id
           and u.id<>v_uom_id and u.is_default_purchase=true
       ) then
      raise exception 'Choose another default purchase unit before clearing this one' using errcode='23514';
    end if;
  end if;

  if lower(v_name)=lower(btrim(v_stock_uom)) and p_conversion_factor<>1 then
    raise exception 'Stock UOM conversion factor must be 1' using errcode='23514';
  end if;

  if coalesce(p_is_default_selling,false) then
    update public.catalog_item_uoms u
    set is_default_selling=false,updated_at=now()
    where u.tenant_id=p_tenant_id and u.catalog_item_id=p_product_id
      and (v_uom_id is null or u.id<>v_uom_id)
      and u.is_default_selling=true;
  end if;
  if coalesce(p_is_default_purchase,false) then
    update public.catalog_item_uoms u
    set is_default_purchase=false,updated_at=now()
    where u.tenant_id=p_tenant_id and u.catalog_item_id=p_product_id
      and (v_uom_id is null or u.id<>v_uom_id)
      and u.is_default_purchase=true;
  end if;

  if v_uom_id is null then
    insert into public.catalog_item_uoms(
      tenant_id,catalog_item_id,uom_name,conversion_factor,selling_price,barcode,
      allow_fractional,is_default_selling,is_default_purchase
    ) values(
      p_tenant_id,p_product_id,v_name,p_conversion_factor,
      case when p_selling_price is null then null else round(p_selling_price::numeric,2) end,
      v_barcode,coalesce(p_allow_fractional,true),
      coalesce(p_is_default_selling,false),coalesce(p_is_default_purchase,false)
    ) returning id into v_uom_id;
  else
    update public.catalog_item_uoms u
    set uom_name=v_name,
        conversion_factor=p_conversion_factor,
        selling_price=case when p_selling_price is null then null else round(p_selling_price::numeric,2) end,
        barcode=v_barcode,
        allow_fractional=coalesce(p_allow_fractional,true),
        is_default_selling=coalesce(p_is_default_selling,false),
        is_default_purchase=coalesce(p_is_default_purchase,false),
        updated_at=now()
    where u.tenant_id=p_tenant_id and u.catalog_item_id=p_product_id and u.id=v_uom_id;
  end if;

  return v_uom_id;
end;
$$;

revoke all on function public.save_sellertray_product_uom(uuid,uuid,uuid,text,numeric,numeric,text,boolean,boolean,boolean)
  from public,anon;
grant execute on function public.save_sellertray_product_uom(uuid,uuid,uuid,text,numeric,numeric,text,boolean,boolean,boolean)
  to authenticated;

create or replace function public.delete_sellertray_product_uom(
  p_tenant_id uuid,
  p_product_id uuid,
  p_uom_id uuid
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_uom public.catalog_item_uoms%rowtype;
  v_stock_uom text;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=p_tenant_id
      and tm.user_id=v_user_id
      and tm.role in ('owner','manager')
  ) then
    raise exception 'Only business Owners and Managers can manage product units' using errcode='42501';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  select ci.stock_uom into v_stock_uom
  from public.catalog_items ci
  where ci.tenant_id=p_tenant_id and ci.id=p_product_id;
  if v_stock_uom is null then raise exception 'Product not found' using errcode='22023'; end if;

  select * into v_uom
  from public.catalog_item_uoms u
  where u.tenant_id=p_tenant_id and u.catalog_item_id=p_product_id and u.id=p_uom_id;
  if not found then raise exception 'Product unit not found' using errcode='22023'; end if;
  if lower(btrim(v_uom.uom_name))=lower(btrim(v_stock_uom)) then
    raise exception 'Stock UOM cannot be deleted' using errcode='23514';
  end if;

  delete from public.catalog_item_uoms u
  where u.tenant_id=p_tenant_id and u.catalog_item_id=p_product_id and u.id=p_uom_id;

  if v_uom.is_default_selling then
    update public.catalog_item_uoms u
    set is_default_selling=true,updated_at=now()
    where u.tenant_id=p_tenant_id and u.catalog_item_id=p_product_id
      and lower(btrim(u.uom_name))=lower(btrim(v_stock_uom));
  end if;
  if v_uom.is_default_purchase then
    update public.catalog_item_uoms u
    set is_default_purchase=true,updated_at=now()
    where u.tenant_id=p_tenant_id and u.catalog_item_id=p_product_id
      and lower(btrim(u.uom_name))=lower(btrim(v_stock_uom));
  end if;
end;
$$;

revoke all on function public.delete_sellertray_product_uom(uuid,uuid,uuid)
  from public,anon;
grant execute on function public.delete_sellertray_product_uom(uuid,uuid,uuid)
  to authenticated;

-- UOM writes are command-only. Reads remain available through the existing RLS
-- policy to authenticated members.
revoke insert,update,delete on table public.catalog_item_uoms from authenticated;
grant select on table public.catalog_item_uoms to authenticated;

commit;
