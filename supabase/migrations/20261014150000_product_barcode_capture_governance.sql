begin;

-- Product catalogue authority can be delegated without creating a separate
-- mobile truth. Owners and Managers retain the permission by default; Staff
-- receive it only through an explicit capability grant.
alter table public.tenant_member_capabilities
  drop constraint if exists tenant_member_capabilities_capability_check,
  add constraint tenant_member_capabilities_capability_check
    check (capability in (
      'can_receive_stock','can_adjust_stock','can_count_stock','can_apply_stock_count',
      'can_transfer_stock','can_open_shift','can_record_cash_movement','can_record_expense',
      'can_close_shift','can_review_shift','can_print_receipt','can_manage_devices',
      'can_manage_orders','can_manage_products'
    ));

alter table public.tenant_member_capability_events
  drop constraint if exists tenant_member_capability_events_capability_check,
  add constraint tenant_member_capability_events_capability_check
    check (capability in (
      'can_receive_stock','can_adjust_stock','can_count_stock','can_apply_stock_count',
      'can_transfer_stock','can_open_shift','can_record_cash_movement','can_record_expense',
      'can_close_shift','can_review_shift','can_print_receipt','can_manage_devices',
      'can_manage_orders','can_manage_products'
    ));

create or replace function public.sellertray_user_has_capability(
  p_tenant_id uuid,
  p_user_id uuid,
  p_capability text
)
returns boolean
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_role text;
  v_override boolean;
begin
  if p_tenant_id is null or p_user_id is null
     or p_capability not in (
       'can_receive_stock','can_adjust_stock','can_count_stock','can_apply_stock_count',
       'can_transfer_stock','can_open_shift','can_record_cash_movement','can_record_expense',
       'can_close_shift','can_review_shift','can_print_receipt','can_manage_devices',
       'can_manage_orders','can_manage_products'
     ) then
    return false;
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_user_id;

  if v_role is null then return false; end if;
  if v_role='owner' then return true; end if;

  select c.allowed into v_override
  from public.tenant_member_capabilities c
  where c.tenant_id=p_tenant_id
    and c.user_id=p_user_id
    and c.capability=p_capability;
  if found then return v_override; end if;

  if v_role='manager' then return true; end if;
  if v_role='staff' then
    return p_capability in (
      'can_open_shift','can_record_cash_movement','can_record_expense',
      'can_close_shift','can_print_receipt'
    );
  end if;
  return false;
end;
$$;

revoke all on function public.sellertray_user_has_capability(uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.sellertray_user_has_capability(uuid,uuid,text)
  to service_role;

create or replace function public.set_sellertray_member_capability(
  p_tenant_id uuid,
  p_target_user_id uuid,
  p_capability text,
  p_allowed boolean,
  p_actor_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor_role text;
  v_target_role text;
  v_capability text := lower(btrim(coalesce(p_capability,'')));
  v_previous_override boolean;
  v_previous_effective boolean;
  v_changed boolean := false;
begin
  if p_tenant_id is null or p_target_user_id is null or p_actor_user_id is null or p_allowed is null then
    raise exception 'Business, staff member, permission and decision are required' using errcode='22023';
  end if;
  if v_capability not in (
    'can_receive_stock','can_adjust_stock','can_count_stock','can_apply_stock_count',
    'can_transfer_stock','can_open_shift','can_record_cash_movement','can_record_expense',
    'can_close_shift','can_review_shift','can_print_receipt','can_manage_devices',
    'can_manage_orders','can_manage_products'
  ) then
    raise exception 'Unknown SellerTray permission' using errcode='22023';
  end if;

  select tm.role into v_actor_role from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;
  select tm.role into v_target_role from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_target_user_id;

  if v_actor_role not in ('owner','manager') then
    raise exception 'Only an Owner or Manager can change staff permissions' using errcode='42501';
  end if;
  if v_target_role is null then
    raise exception 'Staff member does not belong to this business' using errcode='23503';
  end if;
  if v_target_role='owner' then
    raise exception 'Owner authority cannot be changed here' using errcode='42501';
  end if;
  if v_actor_role='manager' and v_target_role<>'staff' then
    raise exception 'Managers can change permissions for Staff only' using errcode='42501';
  end if;

  v_previous_effective := public.sellertray_user_has_capability(
    p_tenant_id,p_target_user_id,v_capability
  );
  select c.allowed into v_previous_override
  from public.tenant_member_capabilities c
  where c.tenant_id=p_tenant_id and c.user_id=p_target_user_id and c.capability=v_capability;
  if not found or v_previous_override is distinct from p_allowed then v_changed := true; end if;

  insert into public.tenant_member_capabilities(
    tenant_id,user_id,capability,allowed,granted_by,created_at,updated_at
  ) values(
    p_tenant_id,p_target_user_id,v_capability,p_allowed,p_actor_user_id,now(),now()
  )
  on conflict(tenant_id,user_id,capability) do update set
    allowed=excluded.allowed,granted_by=excluded.granted_by,updated_at=now();

  if v_changed then
    insert into public.tenant_member_capability_events(
      tenant_id,user_id,capability,previous_allowed,new_allowed,actor_user_id
    ) values(
      p_tenant_id,p_target_user_id,v_capability,v_previous_effective,p_allowed,p_actor_user_id
    );
  end if;
  return p_allowed;
end;
$$;

revoke all on function public.set_sellertray_member_capability(uuid,uuid,text,boolean,uuid)
  from public,anon,authenticated;
grant execute on function public.set_sellertray_member_capability(uuid,uuid,text,boolean,uuid)
  to service_role;

create or replace function public.get_sellertray_team_access_matrix(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_result jsonb;
begin
  if v_user_id is null then raise exception 'SellerTray authentication required' using errcode='42501'; end if;
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id and tm.role in ('owner','manager')
  ) then
    raise exception 'Only business Owners and Managers can review Team access' using errcode='42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'userId',tm.user_id,
    'role',tm.role,
    'usesDefaultBranchFallback',tm.role='staff' and not exists(
      select 1 from public.branch_user_access bua0
      where bua0.tenant_id=tm.tenant_id and bua0.user_id=tm.user_id
    ),
    'branchAccess',coalesce((
      select jsonb_object_agg(bua.branch_id::text,bua.can_operate)
      from public.branch_user_access bua
      where bua.tenant_id=tm.tenant_id and bua.user_id=tm.user_id
    ),'{}'::jsonb),
    'capabilities',jsonb_build_object(
      'can_manage_orders',public.sellertray_user_has_capability(tm.tenant_id,tm.user_id,'can_manage_orders'),
      'can_manage_products',public.sellertray_user_has_capability(tm.tenant_id,tm.user_id,'can_manage_products'),
      'can_receive_stock',public.sellertray_user_has_capability(tm.tenant_id,tm.user_id,'can_receive_stock'),
      'can_adjust_stock',public.sellertray_user_has_capability(tm.tenant_id,tm.user_id,'can_adjust_stock'),
      'can_count_stock',public.sellertray_user_has_capability(tm.tenant_id,tm.user_id,'can_count_stock'),
      'can_apply_stock_count',public.sellertray_user_has_capability(tm.tenant_id,tm.user_id,'can_apply_stock_count'),
      'can_transfer_stock',public.sellertray_user_has_capability(tm.tenant_id,tm.user_id,'can_transfer_stock'),
      'can_open_shift',public.sellertray_user_has_capability(tm.tenant_id,tm.user_id,'can_open_shift'),
      'can_record_cash_movement',public.sellertray_user_has_capability(tm.tenant_id,tm.user_id,'can_record_cash_movement'),
      'can_record_expense',public.sellertray_user_has_capability(tm.tenant_id,tm.user_id,'can_record_expense'),
      'can_close_shift',public.sellertray_user_has_capability(tm.tenant_id,tm.user_id,'can_close_shift'),
      'can_review_shift',public.sellertray_user_has_capability(tm.tenant_id,tm.user_id,'can_review_shift'),
      'can_print_receipt',public.sellertray_user_has_capability(tm.tenant_id,tm.user_id,'can_print_receipt'),
      'can_manage_devices',public.sellertray_user_has_capability(tm.tenant_id,tm.user_id,'can_manage_devices')
    )
  ) order by case tm.role when 'owner' then 0 when 'manager' then 1 else 2 end,tm.created_at,tm.user_id),'[]'::jsonb)
  into v_result
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id;
  return v_result;
end;
$$;

revoke all on function public.get_sellertray_team_access_matrix(uuid) from public,anon;
grant execute on function public.get_sellertray_team_access_matrix(uuid) to authenticated;

-- Product CRUD uses the shared capability rather than a client-specific role check.
create or replace function public.save_sellertray_product(
  p_tenant_id uuid,p_product_id uuid,p_name text,p_sku text,p_category text,
  p_stock_uom text,p_allow_fractional_stock boolean,p_selling_price numeric
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
  if v_user_id is null then raise exception 'SellerTray authentication required' using errcode='42501'; end if;
  if not public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_manage_products') then
    raise exception 'You do not have permission to manage products' using errcode='42501';
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
    insert into public.catalog_items(tenant_id,name,sku,category,price_ngn,stock_uom,allow_fractional_stock,is_active)
    values(p_tenant_id,v_name,v_sku,v_category,round(p_selling_price::numeric,2),v_stock_uom,coalesce(p_allow_fractional_stock,true),true)
    returning id into v_product_id;
  else
    update public.catalog_items ci
    set name=v_name,sku=v_sku,category=v_category,price_ngn=round(p_selling_price::numeric,2),
        stock_uom=v_stock_uom,allow_fractional_stock=coalesce(p_allow_fractional_stock,true),updated_at=now()
    where ci.tenant_id=p_tenant_id and ci.id=v_product_id;
    if not found then raise exception 'Product not found' using errcode='22023'; end if;
  end if;
  return v_product_id;
end;
$$;

revoke all on function public.save_sellertray_product(uuid,uuid,text,text,text,text,boolean,numeric) from public,anon;
grant execute on function public.save_sellertray_product(uuid,uuid,text,text,text,text,boolean,numeric) to authenticated;

create or replace function public.set_sellertray_product_active(p_tenant_id uuid,p_product_id uuid,p_is_active boolean)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then raise exception 'SellerTray authentication required' using errcode='42501'; end if;
  if not public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_manage_products') then
    raise exception 'You do not have permission to manage products' using errcode='42501';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then raise exception 'SellerTray subscription is read-only' using errcode='42501'; end if;
  update public.catalog_items ci set is_active=coalesce(p_is_active,false),updated_at=now()
  where ci.tenant_id=p_tenant_id and ci.id=p_product_id;
  if not found then raise exception 'Product not found' using errcode='22023'; end if;
end;
$$;

revoke all on function public.set_sellertray_product_active(uuid,uuid,boolean) from public,anon;
grant execute on function public.set_sellertray_product_active(uuid,uuid,boolean) to authenticated;

create or replace function public.save_sellertray_product_uom(
  p_tenant_id uuid,p_product_id uuid,p_uom_id uuid,p_uom_name text,p_conversion_factor numeric,
  p_selling_price numeric,p_barcode text,p_allow_fractional boolean,p_is_default_selling boolean,p_is_default_purchase boolean
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
  if v_user_id is null then raise exception 'SellerTray authentication required' using errcode='42501'; end if;
  if not public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_manage_products') then
    raise exception 'You do not have permission to manage product units' using errcode='42501';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then raise exception 'SellerTray subscription is read-only' using errcode='42501'; end if;
  if v_name is null or p_conversion_factor is null or p_conversion_factor<=0 or (p_selling_price is not null and p_selling_price<0) then
    raise exception 'Unit name, positive conversion factor and valid price are required' using errcode='22023';
  end if;
  if char_length(v_name)>80 or char_length(coalesce(v_barcode,''))>160 then raise exception 'Unit name or barcode is too long' using errcode='22023'; end if;

  select ci.stock_uom into v_stock_uom from public.catalog_items ci
  where ci.tenant_id=p_tenant_id and ci.id=p_product_id;
  if v_stock_uom is null then raise exception 'Product not found' using errcode='22023'; end if;

  if v_uom_id is not null then
    select * into v_existing from public.catalog_item_uoms u
    where u.tenant_id=p_tenant_id and u.catalog_item_id=p_product_id and u.id=v_uom_id;
    if not found then raise exception 'Product unit not found' using errcode='22023'; end if;
    if lower(btrim(v_existing.uom_name))=lower(btrim(v_stock_uom)) and lower(v_name)<>lower(btrim(v_stock_uom)) then
      raise exception 'Stock UOM cannot be renamed from the unit editor' using errcode='23514';
    end if;
    if v_existing.is_default_selling and not coalesce(p_is_default_selling,false) and not exists (
      select 1 from public.catalog_item_uoms u where u.tenant_id=p_tenant_id and u.catalog_item_id=p_product_id and u.id<>v_uom_id and u.is_default_selling=true
    ) then raise exception 'Choose another default selling unit before clearing this one' using errcode='23514'; end if;
    if v_existing.is_default_purchase and not coalesce(p_is_default_purchase,false) and not exists (
      select 1 from public.catalog_item_uoms u where u.tenant_id=p_tenant_id and u.catalog_item_id=p_product_id and u.id<>v_uom_id and u.is_default_purchase=true
    ) then raise exception 'Choose another default purchase unit before clearing this one' using errcode='23514'; end if;
  end if;

  if lower(v_name)=lower(btrim(v_stock_uom)) and p_conversion_factor<>1 then
    raise exception 'Stock UOM conversion factor must be 1' using errcode='23514';
  end if;
  if coalesce(p_is_default_selling,false) then
    update public.catalog_item_uoms u set is_default_selling=false,updated_at=now()
    where u.tenant_id=p_tenant_id and u.catalog_item_id=p_product_id and (v_uom_id is null or u.id<>v_uom_id) and u.is_default_selling=true;
  end if;
  if coalesce(p_is_default_purchase,false) then
    update public.catalog_item_uoms u set is_default_purchase=false,updated_at=now()
    where u.tenant_id=p_tenant_id and u.catalog_item_id=p_product_id and (v_uom_id is null or u.id<>v_uom_id) and u.is_default_purchase=true;
  end if;

  if v_uom_id is null then
    insert into public.catalog_item_uoms(tenant_id,catalog_item_id,uom_name,conversion_factor,selling_price,barcode,allow_fractional,is_default_selling,is_default_purchase)
    values(p_tenant_id,p_product_id,v_name,p_conversion_factor,case when p_selling_price is null then null else round(p_selling_price::numeric,2) end,
      v_barcode,coalesce(p_allow_fractional,true),coalesce(p_is_default_selling,false),coalesce(p_is_default_purchase,false))
    returning id into v_uom_id;
  else
    update public.catalog_item_uoms u set uom_name=v_name,conversion_factor=p_conversion_factor,
      selling_price=case when p_selling_price is null then null else round(p_selling_price::numeric,2) end,
      barcode=v_barcode,allow_fractional=coalesce(p_allow_fractional,true),
      is_default_selling=coalesce(p_is_default_selling,false),is_default_purchase=coalesce(p_is_default_purchase,false),updated_at=now()
    where u.tenant_id=p_tenant_id and u.catalog_item_id=p_product_id and u.id=v_uom_id;
  end if;
  return v_uom_id;
end;
$$;

revoke all on function public.save_sellertray_product_uom(uuid,uuid,uuid,text,numeric,numeric,text,boolean,boolean,boolean) from public,anon;
grant execute on function public.save_sellertray_product_uom(uuid,uuid,uuid,text,numeric,numeric,text,boolean,boolean,boolean) to authenticated;

create or replace function public.delete_sellertray_product_uom(p_tenant_id uuid,p_product_id uuid,p_uom_id uuid)
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
  if v_user_id is null then raise exception 'SellerTray authentication required' using errcode='42501'; end if;
  if not public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_manage_products') then
    raise exception 'You do not have permission to manage product units' using errcode='42501';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then raise exception 'SellerTray subscription is read-only' using errcode='42501'; end if;

  select ci.stock_uom into v_stock_uom from public.catalog_items ci
  where ci.tenant_id=p_tenant_id and ci.id=p_product_id;
  if v_stock_uom is null then raise exception 'Product not found' using errcode='22023'; end if;
  select * into v_uom from public.catalog_item_uoms u
  where u.tenant_id=p_tenant_id and u.catalog_item_id=p_product_id and u.id=p_uom_id;
  if not found then raise exception 'Product unit not found' using errcode='22023'; end if;
  if lower(btrim(v_uom.uom_name))=lower(btrim(v_stock_uom)) then raise exception 'Stock UOM cannot be deleted' using errcode='23514'; end if;

  delete from public.catalog_item_uoms u
  where u.tenant_id=p_tenant_id and u.catalog_item_id=p_product_id and u.id=p_uom_id;
  if v_uom.is_default_selling then
    update public.catalog_item_uoms u set is_default_selling=true,updated_at=now()
    where u.tenant_id=p_tenant_id and u.catalog_item_id=p_product_id and lower(btrim(u.uom_name))=lower(btrim(v_stock_uom));
  end if;
  if v_uom.is_default_purchase then
    update public.catalog_item_uoms u set is_default_purchase=true,updated_at=now()
    where u.tenant_id=p_tenant_id and u.catalog_item_id=p_product_id and lower(btrim(u.uom_name))=lower(btrim(v_stock_uom));
  end if;
end;
$$;

revoke all on function public.delete_sellertray_product_uom(uuid,uuid,uuid) from public,anon;
grant execute on function public.delete_sellertray_product_uom(uuid,uuid,uuid) to authenticated;

create or replace function public.get_sellertray_product_capabilities(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'SellerTray authentication required' using errcode='42501'; end if;
  if not exists(select 1 from public.tenant_members tm where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id) then
    raise exception 'Business access denied' using errcode='42501';
  end if;
  return jsonb_build_object(
    'canManageProducts',public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_manage_products')
  );
end;
$$;

revoke all on function public.get_sellertray_product_capabilities(uuid) from public,anon;
grant execute on function public.get_sellertray_product_capabilities(uuid) to authenticated;

create or replace function public.resolve_sellertray_product_barcode(p_tenant_id uuid,p_barcode text)
returns table(
  product_id uuid,
  uom_id uuid,
  product_name text,
  sku text,
  category text,
  stock_uom text,
  uom_name text,
  conversion_factor numeric,
  selling_price numeric,
  allow_fractional boolean,
  item_active boolean
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_barcode text := nullif(btrim(coalesce(p_barcode,'')),'');
begin
  if v_user_id is null then raise exception 'SellerTray authentication required' using errcode='42501'; end if;
  if not exists(select 1 from public.tenant_members tm where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id) then
    raise exception 'Business access denied' using errcode='42501';
  end if;
  if v_barcode is null then raise exception 'Scan or enter a barcode' using errcode='22023'; end if;

  return query
  select ci.id,u.id,ci.name,ci.sku,ci.category,ci.stock_uom,u.uom_name,u.conversion_factor,
         u.selling_price,u.allow_fractional,ci.is_active
  from public.catalog_item_uoms u
  join public.catalog_items ci on ci.tenant_id=u.tenant_id and ci.id=u.catalog_item_id
  where u.tenant_id=p_tenant_id and btrim(u.barcode)=v_barcode
  limit 1;
end;
$$;

revoke all on function public.resolve_sellertray_product_barcode(uuid,text) from public,anon;
grant execute on function public.resolve_sellertray_product_barcode(uuid,text) to authenticated;

create or replace function public.create_sellertray_product_from_barcode(
  p_tenant_id uuid,
  p_name text,
  p_sku text,
  p_category text,
  p_stock_uom text,
  p_selling_price numeric,
  p_barcode text,
  p_allow_fractional_stock boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text := nullif(btrim(coalesce(p_name,'')),'');
  v_sku text := nullif(btrim(coalesce(p_sku,'')),'');
  v_category text := nullif(btrim(coalesce(p_category,'')),'');
  v_stock_uom text := nullif(btrim(coalesce(p_stock_uom,'')),'');
  v_barcode text := nullif(btrim(coalesce(p_barcode,'')),'');
  v_product_id uuid;
  v_uom_id uuid;
begin
  if v_user_id is null then raise exception 'SellerTray authentication required' using errcode='42501'; end if;
  if not public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_manage_products') then
    raise exception 'You do not have permission to add products' using errcode='42501';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then raise exception 'SellerTray subscription is read-only' using errcode='42501'; end if;
  if v_name is null or v_stock_uom is null or v_barcode is null or p_selling_price is null or p_selling_price<0 then
    raise exception 'Product name, Stock UOM, barcode and a valid selling price are required' using errcode='22023';
  end if;
  if char_length(v_name)>160 or char_length(v_stock_uom)>80 or char_length(v_barcode)>160
     or char_length(coalesce(v_sku,''))>120 or char_length(coalesce(v_category,''))>120 then
    raise exception 'Product details are too long' using errcode='22023';
  end if;
  if exists(select 1 from public.catalog_item_uoms u where u.tenant_id=p_tenant_id and btrim(u.barcode)=v_barcode) then
    raise exception 'This barcode is already assigned to a product. Open the existing product instead.' using errcode='23505';
  end if;

  insert into public.catalog_items(tenant_id,name,sku,category,price_ngn,stock_uom,allow_fractional_stock,is_active)
  values(p_tenant_id,v_name,v_sku,v_category,round(p_selling_price::numeric,2),v_stock_uom,coalesce(p_allow_fractional_stock,false),true)
  returning id into v_product_id;

  select u.id into v_uom_id
  from public.catalog_item_uoms u
  where u.tenant_id=p_tenant_id and u.catalog_item_id=v_product_id
    and lower(btrim(u.uom_name))=lower(v_stock_uom)
  order by u.created_at,u.id
  limit 1
  for update;

  if v_uom_id is null then
    raise exception 'SellerTray could not initialise the Stock UOM' using errcode='55000';
  end if;

  update public.catalog_item_uoms u
  set barcode=v_barcode,
      selling_price=round(p_selling_price::numeric,2),
      allow_fractional=coalesce(p_allow_fractional_stock,false),
      is_default_selling=true,
      is_default_purchase=true,
      updated_at=now()
  where u.tenant_id=p_tenant_id and u.id=v_uom_id;

  return jsonb_build_object('productId',v_product_id,'uomId',v_uom_id,'barcode',v_barcode);
exception
  when unique_violation then
    raise exception 'This SKU or barcode is already used by another product' using errcode='23505';
end;
$$;

revoke all on function public.create_sellertray_product_from_barcode(uuid,text,text,text,text,numeric,text,boolean) from public,anon;
grant execute on function public.create_sellertray_product_from_barcode(uuid,text,text,text,text,numeric,text,boolean) to authenticated;

commit;
