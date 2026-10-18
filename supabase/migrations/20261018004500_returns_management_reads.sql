begin;

create or replace function public.get_sellertray_returns_management_list(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_search text := nullif(btrim(coalesce(p_search,'')),'');
  v_limit integer := greatest(1,least(coalesce(p_limit,50),100));
  v_offset integer := greatest(coalesce(p_offset,0),0);
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if p_tenant_id is null or p_branch_id is null then
    raise exception 'Business and Branch are required' using errcode='22023';
  end if;
  if not exists(
    select 1 from public.tenant_members tm
    where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id and tm.role in ('owner','manager')
  ) then
    raise exception 'Owner or Manager access is required to manage returns' using errcode='42501';
  end if;
  if not exists(
    select 1 from public.branches b
    where b.tenant_id=p_tenant_id and b.id=p_branch_id
  ) then
    raise exception 'Branch not found' using errcode='P0002';
  end if;

  with filtered as materialized (
    select
      r.id,
      r.order_id,
      o.public_order_id,
      r.reason,
      r.amount as returned_amount,
      r.currency,
      coalesce(nullif(btrim(c.display_name),''),nullif(btrim(c.phone),''),'Walk-in customer') as customer_name,
      r.created_at,
      coalesce((
        select count(*)
        from public.sale_return_items ri
        where ri.tenant_id=r.tenant_id and ri.sale_return_id=r.id
      ),0) as line_count
    from public.sale_returns r
    join public.orders o
      on o.tenant_id=r.tenant_id and o.id=r.order_id
    left join public.customers c
      on c.tenant_id=o.tenant_id and c.id=o.customer_id
    where r.tenant_id=p_tenant_id
      and r.branch_id=p_branch_id
      and r.status='completed'
      and o.branch_id=p_branch_id
      and o.deleted_at is null
      and o.status = 'completed'
      and (
        v_search is null
        or lower(coalesce(o.public_order_id,'')) like '%'||lower(v_search)||'%'
        or lower(coalesce(c.display_name,'')) like '%'||lower(v_search)||'%'
        or lower(coalesce(c.phone,'')) like '%'||lower(v_search)||'%'
        or lower(coalesce(r.reason,'')) like '%'||lower(v_search)||'%'
        or exists(
          select 1 from public.sale_return_items ri
          where ri.tenant_id=r.tenant_id
            and ri.sale_return_id=r.id
            and lower(coalesce(ri.product_name,'')) like '%'||lower(v_search)||'%'
        )
      )
  ), paged as (
    select * from filtered order by created_at desc,id desc limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'id',p.id,
      'orderId',p.order_id,
      'publicOrderId',p.public_order_id,
      'customerName',p.customer_name,
      'reason',p.reason,
      'returnedAmount',p.returned_amount,
      'currency',p.currency,
      'lineCount',p.line_count,
      'createdAt',p.created_at
    ) order by p.created_at desc,p.id desc) from paged p),'[]'::jsonb),
    'totalCount',(select count(*) from filtered),
    'returnedAmount',coalesce((select sum(f.returned_amount) from filtered f),0),
    'returnedLines',coalesce((select sum(f.line_count) from filtered f),0),
    'currency',coalesce((select f.currency from filtered f order by f.created_at desc,f.id desc limit 1),'NGN'),
    'limit',v_limit,
    'offset',v_offset
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.get_sellertray_return_management_detail(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_return_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_return jsonb;
  v_items jsonb;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if p_tenant_id is null or p_branch_id is null or p_return_id is null then
    raise exception 'Business, Branch and return are required' using errcode='22023';
  end if;
  if not exists(
    select 1 from public.tenant_members tm
    where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id and tm.role in ('owner','manager')
  ) then
    raise exception 'Owner or Manager access is required to manage returns' using errcode='42501';
  end if;
  if not exists(
    select 1 from public.branches b
    where b.tenant_id=p_tenant_id and b.id=p_branch_id
  ) then
    raise exception 'Branch not found' using errcode='P0002';
  end if;

  select jsonb_build_object(
    'id',r.id,
    'orderId',r.order_id,
    'publicOrderId',o.public_order_id,
    'customerName',coalesce(nullif(btrim(c.display_name),''),nullif(btrim(c.phone),''),'Walk-in customer'),
    'reason',r.reason,
    'returnedAmount',r.amount,
    'currency',r.currency,
    'createdAt',r.created_at
  ) into v_return
  from public.sale_returns r
  join public.orders o on o.tenant_id=r.tenant_id and o.id=r.order_id
  left join public.customers c on c.tenant_id=o.tenant_id and c.id=o.customer_id
  where r.tenant_id=p_tenant_id
    and r.branch_id=p_branch_id
    and r.status='completed'
    and o.branch_id=p_branch_id
    and r.id=p_return_id
    and o.deleted_at is null
    and o.status = 'completed';

  if v_return is null then
    raise exception 'Return not found' using errcode='P0002';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',ri.id,
    'orderItemId',ri.order_item_id,
    'itemName',ri.product_name,
    'selectedUom',ri.selected_uom,
    'returnedQuantity',ri.quantity,
    'returnedStockQuantity',ri.stock_quantity,
    'conversionFactor',ri.conversion_factor,
    'unitPrice',ri.unit_price,
    'lineAmount',ri.line_total
  ) order by ri.created_at,ri.id),'[]'::jsonb) into v_items
  from public.sale_return_items ri
  where ri.tenant_id=p_tenant_id
    and ri.sale_return_id=p_return_id;

  return v_return||jsonb_build_object('items',v_items);
end;
$$;

revoke all on function public.get_sellertray_returns_management_list(uuid,uuid,text,integer,integer) from public,anon;
revoke all on function public.get_sellertray_return_management_detail(uuid,uuid,uuid) from public,anon;
grant execute on function public.get_sellertray_returns_management_list(uuid,uuid,text,integer,integer) to authenticated,service_role;
grant execute on function public.get_sellertray_return_management_detail(uuid,uuid,uuid) to authenticated,service_role;

commit;