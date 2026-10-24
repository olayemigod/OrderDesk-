begin;

create or replace function public.get_sellertray_order_management_list(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_view text default 'open',
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
  v_view text := lower(btrim(coalesce(p_view,'open')));
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
    select 1
    from public.tenant_members tm
    where tm.tenant_id=p_tenant_id
      and tm.user_id=v_user_id
      and tm.role in ('owner','manager')
  ) then
    raise exception 'Owner or Manager access is required to manage orders' using errcode='42501';
  end if;
  if not exists(
    select 1 from public.branches b
    where b.tenant_id=p_tenant_id and b.id=p_branch_id
  ) then
    raise exception 'Branch not found' using errcode='P0002';
  end if;
  if v_view not in ('open','draft','awaiting_payment','cancelled','all') then
    raise exception 'Unsupported order view' using errcode='22023';
  end if;

  with filtered as materialized (
    select
      o.id,
      o.public_order_id,
      o.status,
      o.payment_status,
      o.source,
      coalesce(o.amount_paid,0) as amount_paid,
      coalesce(o.total_amount,0) as total_amount,
      o.currency,
      coalesce(nullif(btrim(c.display_name),''),nullif(btrim(c.phone),''),'Walk-in customer') as customer_name,
      o.created_at
    from public.orders o
    left join public.customers c
      on c.tenant_id=o.tenant_id and c.id=o.customer_id
    where o.tenant_id=p_tenant_id
      and o.branch_id=p_branch_id
      and o.deleted_at is null
      and (
        v_view='all'
        or (v_view='open' and o.status not in ('completed','rejected','cancelled'))
        or (v_view='draft' and o.status='draft')
        or (
          v_view='awaiting_payment'
          and o.status not in ('completed','rejected','cancelled')
          and o.payment_status in ('unpaid','pending','verification_required','payment_issue')
        )
        or (v_view='cancelled' and o.status='cancelled')
      )
      and (
        v_search is null
        or lower(coalesce(o.public_order_id,'')) like '%'||lower(v_search)||'%'
        or lower(coalesce(o.status,'')) like '%'||lower(v_search)||'%'
        or lower(coalesce(o.payment_status,'')) like '%'||lower(v_search)||'%'
        or lower(coalesce(o.source,'')) like '%'||lower(v_search)||'%'
        or lower(coalesce(c.display_name,'')) like '%'||lower(v_search)||'%'
        or lower(coalesce(c.phone,'')) like '%'||lower(v_search)||'%'
        or exists(
          select 1
          from public.order_items oi
          where oi.tenant_id=o.tenant_id
            and oi.order_id=o.id
            and lower(coalesce(oi.item_name,'')) like '%'||lower(v_search)||'%'
        )
      )
  ),
  paged as (
    select *
    from filtered
    order by created_at desc,id desc
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'items',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',p.id,
          'publicOrderId',p.public_order_id,
          'status',p.status,
          'paymentStatus',p.payment_status,
          'source',p.source,
          'amountPaid',p.amount_paid,
          'totalAmount',p.total_amount,
          'currency',p.currency,
          'customerName',p.customer_name,
          'createdAt',p.created_at
        ) order by p.created_at desc,p.id desc
      )
      from paged p
    ),'[]'::jsonb),
    'totalCount',(select count(*) from filtered),
    'limit',v_limit,
    'offset',v_offset
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.get_sellertray_order_management_detail(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_order_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_order jsonb;
  v_items jsonb;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if p_tenant_id is null or p_branch_id is null or p_order_id is null then
    raise exception 'Business, Branch and order are required' using errcode='22023';
  end if;
  if not exists(
    select 1
    from public.tenant_members tm
    where tm.tenant_id=p_tenant_id
      and tm.user_id=v_user_id
      and tm.role in ('owner','manager')
  ) then
    raise exception 'Owner or Manager access is required to manage orders' using errcode='42501';
  end if;
  if not exists(
    select 1 from public.branches b
    where b.tenant_id=p_tenant_id and b.id=p_branch_id
  ) then
    raise exception 'Branch not found' using errcode='P0002';
  end if;

  select jsonb_build_object(
    'id',o.id,
    'publicOrderId',o.public_order_id,
    'status',o.status,
    'paymentStatus',o.payment_status,
    'source',o.source,
    'amountPaid',coalesce(o.amount_paid,0),
    'totalAmount',coalesce(o.total_amount,0),
    'currency',o.currency,
    'customerName',coalesce(nullif(btrim(c.display_name),''),nullif(btrim(c.phone),''),'Walk-in customer'),
    'customerNote',o.customer_note,
    'returnStatus',o.return_status,
    'returnedAmount',coalesce(o.returned_amount,0),
    'createdAt',o.created_at
  ) into v_order
  from public.orders o
  left join public.customers c
    on c.tenant_id=o.tenant_id and c.id=o.customer_id
  where o.tenant_id=p_tenant_id
    and o.branch_id=p_branch_id
    and o.id=p_order_id
    and o.deleted_at is null;

  if v_order is null then
    raise exception 'Order not found' using errcode='P0002';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',oi.id,
      'itemName',oi.item_name,
      'quantity',oi.quantity,
      'selectedUom',oi.selected_uom,
      'unitPrice',oi.unit_price,
      'stockQuantity',oi.stock_quantity
    ) order by oi.created_at,oi.id
  ),'[]'::jsonb) into v_items
  from public.order_items oi
  where oi.tenant_id=p_tenant_id
    and oi.order_id=p_order_id;

  return v_order||jsonb_build_object('items',v_items);
end;
$$;

create or replace function public.get_sellertray_sales_management_list(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_search text default null,
  p_source text default null,
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
  v_source text := nullif(lower(btrim(coalesce(p_source,''))),'');
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
    select 1
    from public.tenant_members tm
    where tm.tenant_id=p_tenant_id
      and tm.user_id=v_user_id
      and tm.role in ('owner','manager')
  ) then
    raise exception 'Owner or Manager access is required to manage sales' using errcode='42501';
  end if;
  if not exists(
    select 1 from public.branches b
    where b.tenant_id=p_tenant_id and b.id=p_branch_id
  ) then
    raise exception 'Branch not found' using errcode='P0002';
  end if;
  if v_source='all' then v_source:=null; end if;
  if v_source is not null and v_source not in ('pos','whatsapp','manual') then
    raise exception 'Unsupported sales channel' using errcode='22023';
  end if;

  with filtered as materialized (
    select
      o.id,
      o.public_order_id,
      o.source,
      o.payment_status,
      coalesce(o.amount_paid,0) as amount_paid,
      o.currency,
      o.return_status,
      coalesce(o.returned_amount,0) as returned_amount,
      coalesce(nullif(btrim(c.display_name),''),nullif(btrim(c.phone),''),'Walk-in customer') as customer_name,
      o.created_at
    from public.orders o
    left join public.customers c
      on c.tenant_id=o.tenant_id and c.id=o.customer_id
    where o.tenant_id=p_tenant_id
      and o.branch_id=p_branch_id
      and o.deleted_at is null
      and o.status='completed'
      and (v_source is null or o.source=v_source)
      and (
        v_search is null
        or lower(coalesce(o.public_order_id,'')) like '%'||lower(v_search)||'%'
        or lower(coalesce(c.display_name,'')) like '%'||lower(v_search)||'%'
        or lower(coalesce(c.phone,'')) like '%'||lower(v_search)||'%'
        or exists(
          select 1
          from public.order_items oi
          where oi.tenant_id=o.tenant_id
            and oi.order_id=o.id
            and lower(coalesce(oi.item_name,'')) like '%'||lower(v_search)||'%'
        )
      )
  ),
  paged as (
    select *
    from filtered
    order by created_at desc,id desc
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'items',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',p.id,
          'publicOrderId',p.public_order_id,
          'source',p.source,
          'paymentStatus',p.payment_status,
          'amountPaid',p.amount_paid,
          'currency',p.currency,
          'returnStatus',p.return_status,
          'returnedAmount',p.returned_amount,
          'customerName',p.customer_name,
          'createdAt',p.created_at
        ) order by p.created_at desc,p.id desc
      )
      from paged p
    ),'[]'::jsonb),
    'totalCount',(select count(*) from filtered),
    'collected',coalesce((select sum(f.amount_paid) from filtered f),0),
    'returned',coalesce((select sum(f.returned_amount) from filtered f),0),
    'currency',coalesce((select f.currency from filtered f order by f.created_at desc,f.id desc limit 1),'NGN'),
    'limit',v_limit,
    'offset',v_offset
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_sellertray_order_management_list(uuid,uuid,text,text,integer,integer)
  from public,anon;
revoke all on function public.get_sellertray_order_management_detail(uuid,uuid,uuid)
  from public,anon;
revoke all on function public.get_sellertray_sales_management_list(uuid,uuid,text,text,integer,integer)
  from public,anon;

grant execute on function public.get_sellertray_order_management_list(uuid,uuid,text,text,integer,integer)
  to authenticated,service_role;
grant execute on function public.get_sellertray_order_management_detail(uuid,uuid,uuid)
  to authenticated,service_role;
grant execute on function public.get_sellertray_sales_management_list(uuid,uuid,text,text,integer,integer)
  to authenticated,service_role;

commit;
