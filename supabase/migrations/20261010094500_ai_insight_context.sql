begin;

create table public.sellertray_ai_insight_attempts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  provider text not null default 'openai' check (provider='openai'),
  model text,
  outcome text not null check (
    outcome in ('success','provider_error','invalid_output','network_error','rate_limited','context_error')
  ),
  provider_http_status integer check (
    provider_http_status is null or provider_http_status between 100 and 599
  ),
  context_days integer not null check (context_days between 1 and 365),
  question_length integer not null check (question_length between 1 and 1200),
  input_tokens integer check (input_tokens is null or input_tokens>=0),
  cached_input_tokens integer check (cached_input_tokens is null or cached_input_tokens>=0),
  output_tokens integer check (output_tokens is null or output_tokens>=0),
  reasoning_tokens integer check (reasoning_tokens is null or reasoning_tokens>=0),
  total_tokens integer check (total_tokens is null or total_tokens>=0),
  latency_ms integer check (latency_ms is null or latency_ms>=0),
  created_at timestamptz not null default now()
);

create index sellertray_ai_insight_attempts_tenant_created_idx
  on public.sellertray_ai_insight_attempts(tenant_id,created_at desc);
create index sellertray_ai_insight_attempts_actor_created_idx
  on public.sellertray_ai_insight_attempts(actor_user_id,created_at desc)
  where actor_user_id is not null;

alter table public.sellertray_ai_insight_attempts enable row level security;
revoke all on table public.sellertray_ai_insight_attempts from public,anon,authenticated;
grant all on table public.sellertray_ai_insight_attempts to service_role;

create or replace function public.sellertray_ai_insight_context(
  p_tenant_id uuid,
  p_days integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_days integer := greatest(1,least(coalesce(p_days,30),365));
  v_since timestamptz;
  v_business_name text;
  v_report jsonb;
  v_top_products jsonb;
  v_low_stock jsonb;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;

  select tm.role,t.name
  into v_role,v_business_name
  from public.tenant_members tm
  join public.tenants t on t.id=tm.tenant_id
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;

  if v_role not in ('owner','manager') then
    raise exception 'Owner or Manager access is required for SellerTray AI insights'
      using errcode='42501';
  end if;

  v_since := now()-make_interval(days=>v_days);
  v_report := public.sellertray_report_center(p_tenant_id,v_days);

  select coalesce(jsonb_agg(jsonb_build_object(
    'productId',x.catalog_item_id,
    'productName',x.product_name,
    'sku',x.sku,
    'stockUom',x.stock_uom,
    'confirmedOrders',x.confirmed_orders,
    'stockQuantitySold',x.stock_quantity_sold,
    'salesValue',x.sales_value
  ) order by x.stock_quantity_sold desc,x.sales_value desc,x.product_name),'[]'::jsonb)
  into v_top_products
  from (
    select
      oi.catalog_item_id,
      coalesce(ci.name,max(oi.item_name),'Product') as product_name,
      ci.sku,
      coalesce(ci.stock_uom,max(oi.selected_uom),'Each') as stock_uom,
      count(distinct o.id)::int as confirmed_orders,
      coalesce(sum(oi.stock_quantity),0)::numeric as stock_quantity_sold,
      coalesce(sum(oi.line_total),0)::numeric as sales_value
    from public.order_items oi
    join public.orders o
      on o.tenant_id=oi.tenant_id and o.id=oi.order_id
    left join public.catalog_items ci
      on ci.tenant_id=oi.tenant_id and ci.id=oi.catalog_item_id
    where oi.tenant_id=p_tenant_id
      and oi.catalog_item_id is not null
      and o.created_at>=v_since
      and o.status in ('accepted','processing','ready','completed')
    group by oi.catalog_item_id,ci.name,ci.sku,ci.stock_uom
    order by stock_quantity_sold desc,sales_value desc,product_name
    limit 20
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
    'branchId',x.branch_id,
    'branchName',x.branch_name,
    'productId',x.catalog_item_id,
    'productName',x.item_name,
    'sku',x.sku,
    'stockUom',x.stock_uom,
    'quantityOnHand',x.quantity_on_hand,
    'lowStockThreshold',x.low_stock_threshold,
    'reorderTarget',x.reorder_target,
    'suggestedReorderQuantity',x.suggested_reorder_quantity,
    'isOutOfStock',x.is_out_of_stock
  ) order by x.is_out_of_stock desc,
             (x.low_stock_threshold-x.quantity_on_hand) desc,
             x.branch_name,x.item_name),'[]'::jsonb)
  into v_low_stock
  from (
    select
      b.id as branch_id,
      b.name as branch_name,
      l.catalog_item_id,
      l.item_name,
      l.sku,
      l.stock_uom,
      l.quantity_on_hand,
      l.low_stock_threshold,
      l.reorder_target,
      l.suggested_reorder_quantity,
      l.is_out_of_stock
    from public.branches b
    cross join lateral public.get_sellertray_low_stock(p_tenant_id,b.id) l
    where b.tenant_id=p_tenant_id and b.is_active=true
    order by l.is_out_of_stock desc,
             (l.low_stock_threshold-l.quantity_on_hand) desc,
             b.name,l.item_name
    limit 50
  ) x;

  return jsonb_build_object(
    'businessId',p_tenant_id,
    'businessName',v_business_name,
    'generatedAt',now(),
    'days',v_days,
    'report',v_report,
    'topProducts',v_top_products,
    'lowStock',v_low_stock,
    'notes',jsonb_build_array(
      'Top product quantities are confirmed gross sold quantities expressed in each product Stock UOM.',
      'Low-stock context includes active Branches only; historical Branch activity remains available in Report Center.'
    )
  );
end;
$$;

revoke all on function public.sellertray_ai_insight_context(uuid,integer)
  from public,anon;
grant execute on function public.sellertray_ai_insight_context(uuid,integer)
  to authenticated;

create or replace function public.record_sellertray_ai_insight_attempt(
  p_request_id uuid,
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_model text,
  p_outcome text,
  p_provider_http_status integer,
  p_context_days integer,
  p_question_length integer,
  p_input_tokens integer,
  p_cached_input_tokens integer,
  p_output_tokens integer,
  p_reasoning_tokens integer,
  p_total_tokens integer,
  p_latency_ms integer
)
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  if p_request_id is null or p_tenant_id is null or p_actor_user_id is null then
    raise exception 'AI insight telemetry identifiers are required' using errcode='22023';
  end if;
  if not exists(
    select 1 from public.tenant_members tm
    where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id
  ) then
    raise exception 'SellerTray business membership required' using errcode='42501';
  end if;

  insert into public.sellertray_ai_insight_attempts(
    request_id,tenant_id,actor_user_id,model,outcome,provider_http_status,
    context_days,question_length,input_tokens,cached_input_tokens,output_tokens,
    reasoning_tokens,total_tokens,latency_ms
  ) values(
    p_request_id,p_tenant_id,p_actor_user_id,nullif(btrim(coalesce(p_model,'')),''),
    p_outcome,p_provider_http_status,greatest(1,least(coalesce(p_context_days,30),365)),
    greatest(1,least(coalesce(p_question_length,1),1200)),p_input_tokens,
    p_cached_input_tokens,p_output_tokens,p_reasoning_tokens,p_total_tokens,p_latency_ms
  )
  on conflict(request_id) do nothing;
end;
$$;

revoke all on function public.record_sellertray_ai_insight_attempt(
  uuid,uuid,uuid,text,text,integer,integer,integer,integer,integer,integer,integer,integer,integer
) from public,anon,authenticated;
grant execute on function public.record_sellertray_ai_insight_attempt(
  uuid,uuid,uuid,text,text,integer,integer,integer,integer,integer,integer,integer,integer,integer
) to service_role;

commit;