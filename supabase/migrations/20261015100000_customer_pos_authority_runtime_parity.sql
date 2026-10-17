begin;

-- Customer identity is shared by POS, WhatsApp and merchant order creation.
-- Serialize POS phone resolution on the same normalized identity used by the
-- WhatsApp resolver so concurrent +number / number requests cannot split one
-- customer into multiple records.
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
  v_phone_digits text;
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

  v_phone_digits := regexp_replace(v_customer_phone,'[^0-9]','','g');

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_tenant_id::text),
    pg_catalog.hashtext(v_phone_digits)
  );

  select count(*)::integer
  into v_match_count
  from public.customers c
  where c.tenant_id=p_tenant_id
    and (
      c.wa_id=v_phone_digits
      or c.wa_id='manual:'||v_customer_phone
      or c.wa_id='manual:'||v_phone_digits
      or regexp_replace(coalesce(c.phone,''),'[^0-9]','','g')=v_phone_digits
    );

  if v_match_count>1 then
    raise exception 'Multiple customer records use this phone. Select the customer from search.' using errcode='23514';
  end if;

  if v_match_count=1 then
    select c.id into v_customer_id
    from public.customers c
    where c.tenant_id=p_tenant_id
      and (
        c.wa_id=v_phone_digits
        or c.wa_id='manual:'||v_customer_phone
        or c.wa_id='manual:'||v_phone_digits
        or regexp_replace(coalesce(c.phone,''),'[^0-9]','','g')=v_phone_digits
      )
    order by c.created_at,c.id
    limit 1;
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

revoke all on function public.resolve_sellertray_pos_customer(uuid,uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.resolve_sellertray_pos_customer(uuid,uuid,text,text)
  to service_role;

-- Customer profile editing remains a tenant-management operation. Keep the
-- customer identity columns server-managed and make the RPC self-authorizing so
-- it does not depend on a direct authenticated UPDATE grant.
create or replace function public.update_sellertray_customer_profile(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_display_name text,
  p_email text default null
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text := nullif(btrim(coalesce(p_display_name,'')),'');
  v_email text := nullif(lower(btrim(coalesce(p_email,''))),'');
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if p_tenant_id is null or p_customer_id is null then
    raise exception 'Business and customer are required' using errcode='22023';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;
  if v_name is not null and char_length(v_name)>120 then
    raise exception 'Customer name is too long' using errcode='22023';
  end if;
  if v_email is not null and (
    char_length(v_email)>254
    or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  ) then
    raise exception 'Customer email is invalid' using errcode='22023';
  end if;

  if not exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id=p_tenant_id
      and tm.user_id=v_user_id
      and tm.role in ('owner','manager')
  ) then
    raise exception 'Owner or Manager access is required to edit customers' using errcode='42501';
  end if;

  update public.customers c
  set display_name=v_name,
      email=v_email,
      updated_at=now()
  where c.id=p_customer_id and c.tenant_id=p_tenant_id;

  if not found then
    raise exception 'Customer not found' using errcode='P0002';
  end if;
end;
$$;

revoke all on table public.customers from anon,authenticated;
grant select on table public.customers to authenticated;

do $$
declare
  v_policy record;
begin
  for v_policy in
    select p.policyname
    from pg_catalog.pg_policies p
    where p.schemaname='public'
      and p.tablename='customers'
      and p.cmd in ('ALL','INSERT','UPDATE','DELETE')
  loop
    execute format('drop policy if exists %I on public.customers',v_policy.policyname);
  end loop;
end
$$;

revoke all on function public.update_sellertray_customer_profile(uuid,uuid,text,text)
  from public,anon;
grant execute on function public.update_sellertray_customer_profile(uuid,uuid,text,text)
  to authenticated,service_role;

-- POS sale creation is a Branch operation, not an order-management action.
-- Put subscription and actor/Branch authority inside the database command so an
-- Edge Function or another service caller cannot create a sale outside the
-- governed commerce core.
create or replace function public.create_sellertray_pos_order_atomic(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_actor_user_id uuid,
  p_customer_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_note text,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
begin
  if p_tenant_id is null or p_branch_id is null or p_actor_user_id is null then
    raise exception 'Business, Branch and operator are required' using errcode='22023';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;
  if not public.sellertray_user_can_operate_branch(p_tenant_id,p_branch_id,p_actor_user_id) then
    raise exception 'You do not have access to sell from this Branch' using errcode='42501';
  end if;

  return public.create_sellertray_pos_order_atomic(
    p_tenant_id,p_branch_id,p_customer_id,p_customer_name,p_customer_phone,p_note,p_items
  );
end;
$$;

create or replace function public.create_sellertray_pos_order_idempotent(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_actor_user_id uuid,
  p_customer_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_note text,
  p_items jsonb,
  p_client_reference uuid
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
begin
  if p_tenant_id is null or p_branch_id is null or p_actor_user_id is null then
    raise exception 'Business, Branch and operator are required' using errcode='22023';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;
  if not public.sellertray_user_can_operate_branch(p_tenant_id,p_branch_id,p_actor_user_id) then
    raise exception 'You do not have access to sell from this Branch' using errcode='42501';
  end if;

  return public.create_sellertray_pos_order_idempotent(
    p_tenant_id,p_branch_id,p_customer_id,p_customer_name,p_customer_phone,p_note,p_items,p_client_reference
  );
end;
$$;

-- The legacy actor-less signatures remain as implementation helpers for the
-- guarded wrappers, but are no longer callable by the service role directly.
revoke all on function public.create_sellertray_pos_order_atomic(uuid,uuid,text,text,text,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.create_sellertray_pos_order_atomic(uuid,uuid,uuid,text,text,text,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.create_sellertray_pos_order_idempotent(uuid,uuid,text,text,text,jsonb,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.create_sellertray_pos_order_idempotent(uuid,uuid,uuid,text,text,text,jsonb,uuid)
  from public,anon,authenticated,service_role;

revoke all on function public.create_sellertray_pos_order_atomic(uuid,uuid,uuid,uuid,text,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.create_sellertray_pos_order_atomic(uuid,uuid,uuid,uuid,text,text,text,jsonb)
  to service_role;

revoke all on function public.create_sellertray_pos_order_idempotent(uuid,uuid,uuid,uuid,text,text,text,jsonb,uuid)
  from public,anon,authenticated;
grant execute on function public.create_sellertray_pos_order_idempotent(uuid,uuid,uuid,uuid,text,text,text,jsonb,uuid)
  to service_role;

commit;
