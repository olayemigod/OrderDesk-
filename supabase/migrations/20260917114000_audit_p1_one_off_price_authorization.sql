-- SellerTray P1 audit hardening: arbitrary one-off selling prices are a management
-- exception, not a normal staff order-edit capability.

create or replace function public.sellertray_keep_order_item_one_off(
  p_tenant_id uuid,
  p_order_item_id uuid,
  p_price numeric,
  p_name text default null
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_order_id uuid;
  v_order_status text;
  v_original text;
  v_final_name text;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id = p_tenant_id
    and tm.user_id = v_user_id;

  if v_role is null then
    raise exception 'SellerTray business membership required';
  end if;

  if v_role not in ('owner','manager') then
    raise exception 'Only an Owner or Manager can approve a one-off selling price'
      using errcode = '42501';
  end if;

  if p_price is null or p_price < 0 then
    raise exception 'A valid selling price is required';
  end if;

  select oi.order_id,
         o.status,
         coalesce(nullif(btrim(oi.original_item_name),''),oi.item_name),
         coalesce(nullif(btrim(p_name),''),oi.item_name)
  into v_order_id,
       v_order_status,
       v_original,
       v_final_name
  from public.order_items oi
  join public.orders o
    on o.id = oi.order_id
   and o.tenant_id = oi.tenant_id
  where oi.id = p_order_item_id
    and oi.tenant_id = p_tenant_id
  for update of oi;

  if v_order_id is null then
    raise exception 'Order item not found';
  end if;

  if v_order_status not in ('draft','needs_review') then
    raise exception 'One-off resolution is only available before order acceptance';
  end if;

  update public.order_items
  set catalog_item_id = null,
      item_name = v_final_name,
      unit_price = p_price,
      match_source = 'one_off',
      match_confidence = 1
  where id = p_order_item_id
    and tenant_id = p_tenant_id;

  update public.order_item_catalogue_candidates
  set status = 'one_off',
      resolution_catalog_item_id = null,
      learned_alias = null,
      reviewed_by = v_user_id,
      reviewed_at = now(),
      updated_at = now()
  where tenant_id = p_tenant_id
    and order_item_id = p_order_item_id;

  perform public.refresh_sellertray_order_review_reasons(v_order_id);

  insert into public.commercial_action_ledger(
    tenant_id,
    action_key,
    channel,
    customer_id,
    target_order_id,
    action_type,
    risk_class,
    requested_by,
    policy_result,
    action_status,
    metadata,
    applied_at
  )
  select
    p_tenant_id,
    'catalogue-one-off:' || p_order_item_id::text,
    'merchant_app',
    o.customer_id,
    v_order_id,
    'order_item_kept_one_off',
    'medium',
    'merchant',
    'allowed',
    'applied',
    jsonb_build_object(
      'order_item_id', p_order_item_id,
      'customer_wording', v_original,
      'final_name', v_final_name,
      'unit_price', p_price,
      'actor_role', v_role
    ),
    now()
  from public.orders o
  where o.id = v_order_id
  on conflict(tenant_id,action_key) do nothing;
end;
$function$;

revoke all on function public.sellertray_keep_order_item_one_off(uuid,uuid,numeric,text) from public;
revoke all on function public.sellertray_keep_order_item_one_off(uuid,uuid,numeric,text) from anon;
grant execute on function public.sellertray_keep_order_item_one_off(uuid,uuid,numeric,text) to authenticated;
grant execute on function public.sellertray_keep_order_item_one_off(uuid,uuid,numeric,text) to service_role;
