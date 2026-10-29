begin;

create or replace function public.get_sellertray_customer_management_list(
  p_tenant_id uuid,
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
  if p_tenant_id is null then
    raise exception 'Business is required' using errcode='22023';
  end if;
  if not exists(
    select 1
    from public.tenant_members tm
    where tm.tenant_id=p_tenant_id
      and tm.user_id=v_user_id
      and tm.role in ('owner','manager')
  ) then
    raise exception 'Owner or Manager access is required to manage customers' using errcode='42501';
  end if;

  with customer_base as (
    select
      c.id,
      coalesce(nullif(btrim(c.display_name),''),nullif(btrim(c.phone),''),'Customer') as display_name,
      c.phone,
      c.email,
      c.created_at,
      (
        select max(o.created_at)
        from public.orders o
        where o.tenant_id=c.tenant_id
          and o.customer_id=c.id
          and o.deleted_at is null
      ) as last_order_at
    from public.customers c
    where c.tenant_id=p_tenant_id
      and coalesce(c.wa_id,'')<>'pos:walk-in'
      and (
        v_search is null
        or lower(coalesce(c.display_name,'')) like '%'||lower(v_search)||'%'
        or lower(coalesce(c.phone,'')) like '%'||lower(v_search)||'%'
        or lower(coalesce(c.email,'')) like '%'||lower(v_search)||'%'
      )
  ),
  paged as (
    select *
    from customer_base
    order by last_order_at desc nulls last,created_at desc,id desc
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'items',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',p.id,
          'displayName',p.display_name,
          'phone',p.phone,
          'email',p.email,
          'lastOrderAt',p.last_order_at,
          'createdAt',p.created_at
        )
        order by p.last_order_at desc nulls last,p.created_at desc,p.id desc
      )
      from paged p
    ),'[]'::jsonb),
    'totalCount',(select count(*) from customer_base),
    'limit',v_limit,
    'offset',v_offset
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.get_sellertray_customer_management_detail(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_order_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_limit integer := greatest(1,least(coalesce(p_order_limit,100),500));
  v_customer jsonb;
  v_summary jsonb;
  v_orders jsonb;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if p_tenant_id is null or p_customer_id is null then
    raise exception 'Business and customer are required' using errcode='22023';
  end if;
  if not exists(
    select 1
    from public.tenant_members tm
    where tm.tenant_id=p_tenant_id
      and tm.user_id=v_user_id
      and tm.role in ('owner','manager')
  ) then
    raise exception 'Owner or Manager access is required to manage customers' using errcode='42501';
  end if;

  select jsonb_build_object(
    'id',c.id,
    'displayName',coalesce(nullif(btrim(c.display_name),''),nullif(btrim(c.phone),''),'Customer'),
    'phone',c.phone,
    'email',c.email,
    'whatsappLinked',(
      c.wa_id is not null
      and c.wa_id<>'pos:walk-in'
      and c.wa_id not like 'manual:%'
      and c.wa_id not like 'pos:%'
    ),
    'lastOrderAt',(
      select max(o.created_at)
      from public.orders o
      where o.tenant_id=c.tenant_id
        and o.customer_id=c.id
        and o.deleted_at is null
    ),
    'createdAt',c.created_at
  ) into v_customer
  from public.customers c
  where c.tenant_id=p_tenant_id
    and c.id=p_customer_id
    and coalesce(c.wa_id,'')<>'pos:walk-in';

  if v_customer is null then
    raise exception 'Customer not found' using errcode='P0002';
  end if;

  select jsonb_build_object(
    'completedOrderCount',count(*) filter(where o.status='completed'),
    'totalSales',coalesce(sum(coalesce(o.total_amount,0)) filter(where o.status='completed'),0),
    'collected',coalesce(sum(coalesce(o.amount_paid,0)) filter(where o.status='completed'),0),
    'outstanding',coalesce(sum(
      greatest(coalesce(o.total_amount,0)-coalesce(o.amount_paid,0),0)
    ) filter(where o.status in ('accepted','processing','ready','completed')),0)
  ) into v_summary
  from public.orders o
  where o.tenant_id=p_tenant_id
    and o.customer_id=p_customer_id
    and o.deleted_at is null;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',q.id,
      'publicOrderId',q.public_order_id,
      'source',q.source,
      'status',q.status,
      'paymentStatus',q.payment_status,
      'totalAmount',coalesce(q.total_amount,0),
      'amountPaid',coalesce(q.amount_paid,0),
      'outstandingBalance',case
        when q.status in ('accepted','processing','ready','completed')
          then greatest(coalesce(q.total_amount,0)-coalesce(q.amount_paid,0),0)
        else 0
      end,
      'createdAt',q.created_at
    ) order by q.created_at desc,q.id desc
  ),'[]'::jsonb) into v_orders
  from (
    select o.id,o.public_order_id,o.source,o.status,o.payment_status,o.total_amount,o.amount_paid,o.created_at
    from public.orders o
    where o.tenant_id=p_tenant_id
      and o.customer_id=p_customer_id
      and o.deleted_at is null
    order by o.created_at desc,o.id desc
    limit v_limit
  ) q;

  return jsonb_build_object(
    'customer',v_customer,
    'summary',v_summary,
    'orders',v_orders
  );
end;
$$;

revoke all on function public.get_sellertray_customer_management_list(uuid,text,integer,integer)
  from public,anon;
revoke all on function public.get_sellertray_customer_management_detail(uuid,uuid,integer)
  from public,anon;

grant execute on function public.get_sellertray_customer_management_list(uuid,text,integer,integer)
  to authenticated,service_role;
grant execute on function public.get_sellertray_customer_management_detail(uuid,uuid,integer)
  to authenticated,service_role;

commit;
