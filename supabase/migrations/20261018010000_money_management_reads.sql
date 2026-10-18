begin;

create or replace function public.get_sellertray_payment_management_list(
  p_tenant_id uuid,
  p_branch_id uuid default null,
  p_search text default null,
  p_state text default 'attention',
  p_method_type text default null,
  p_date_from date default null,
  p_date_to date default null,
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
  v_state text := lower(btrim(coalesce(p_state,'attention')));
  v_method_type text := nullif(lower(btrim(coalesce(p_method_type,''))),'');
  v_limit integer := greatest(1,least(coalesce(p_limit,50),100));
  v_offset integer := greatest(coalesce(p_offset,0),0);
  v_timezone text;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if p_tenant_id is null then
    raise exception 'Business is required' using errcode='22023';
  end if;
  if not public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_view_reports') then
    raise exception 'You do not have permission to review payments' using errcode='42501';
  end if;
  if p_branch_id is not null then
    if not exists(select 1 from public.branches b where b.tenant_id=p_tenant_id and b.id=p_branch_id) then
      raise exception 'Branch not found' using errcode='P0002';
    end if;
    if not public.sellertray_user_can_read_report_branch(p_tenant_id,p_branch_id,v_user_id) then
      raise exception 'You do not have access to payment reporting for this Branch' using errcode='42501';
    end if;
  end if;
  if v_state='' or v_state='all' then v_state:='all'; end if;
  if v_state not in ('attention','confirmed','all') then
    raise exception 'Unsupported payment reconciliation view' using errcode='22023';
  end if;
  if v_method_type='all' then v_method_type:=null; end if;
  if v_method_type is not null and v_method_type not in (
    'cash','bank_transfer','card_terminal','paystack','flutterwave','cash_on_delivery','pay_on_pickup'
  ) then
    raise exception 'Unsupported payment method' using errcode='22023';
  end if;
  if p_date_from is not null and p_date_to is not null and p_date_from>p_date_to then
    raise exception 'Payment date range is invalid' using errcode='22023';
  end if;

  select coalesce(nullif(t.timezone,''),'Africa/Lagos') into v_timezone
  from public.tenants t where t.id=p_tenant_id;
  if v_timezone is null then
    raise exception 'Business not found' using errcode='P0002';
  end if;
  if p_date_from is not null then
    v_start_at := p_date_from::timestamp at time zone v_timezone;
  end if;
  if p_date_to is not null then
    v_end_at := (p_date_to+1)::timestamp at time zone v_timezone;
  end if;

  with base_filtered as materialized (
    select
      p.id,
      p.order_id,
      o.public_order_id,
      o.branch_id,
      b.name as branch_name,
      coalesce(c.display_name,c.phone,'Customer') as customer_name,
      p.method_type,
      p.provider,
      p.status,
      coalesce(p.exception_state,'none') as exception_state,
      p.exception_reason,
      p.amount,
      p.currency,
      p.provider_reference,
      p.created_at,
      (p.status in ('pending_verification','failed') or coalesce(p.exception_state,'none')<>'none') as needs_attention
    from public.order_payments p
    join public.orders o on o.tenant_id=p.tenant_id and o.id=p.order_id
    join public.branches b on b.tenant_id=o.tenant_id and b.id=o.branch_id
    left join public.customers c on c.tenant_id=o.tenant_id and c.id=o.customer_id
    where p.tenant_id=p_tenant_id
      and o.deleted_at is null
      and public.sellertray_user_can_read_report_branch(p_tenant_id,o.branch_id,v_user_id)
      and (p_branch_id is null or o.branch_id=p_branch_id)
      and (v_method_type is null or p.method_type=v_method_type)
      and (v_start_at is null or p.created_at>=v_start_at)
      and (v_end_at is null or p.created_at<v_end_at)
      and (
        v_search is null
        or lower(coalesce(o.public_order_id,'')) like '%'||lower(v_search)||'%'
        or lower(coalesce(c.display_name,'')) like '%'||lower(v_search)||'%'
        or lower(coalesce(c.phone,'')) like '%'||lower(v_search)||'%'
        or lower(coalesce(p.provider_reference,'')) like '%'||lower(v_search)||'%'
        or lower(coalesce(p.provider,'')) like '%'||lower(v_search)||'%'
        or lower(coalesce(p.method_type,'')) like '%'||lower(v_search)||'%'
        or lower(coalesce(b.name,'')) like '%'||lower(v_search)||'%'
      )
  ),
  filtered as materialized (
    select * from base_filtered
    where v_state='all'
       or (v_state='attention' and needs_attention)
       or (v_state='confirmed' and status='confirmed' and not needs_attention)
  ),
  paged as (
    select * from filtered
    order by case when needs_attention then 0 else 1 end,created_at desc,id desc
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'items',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',x.id,
        'orderId',x.order_id,
        'publicOrderId',x.public_order_id,
        'branchId',x.branch_id,
        'branchName',x.branch_name,
        'customerName',x.customer_name,
        'methodType',x.method_type,
        'provider',x.provider,
        'status',x.status,
        'exceptionState',x.exception_state,
        'exceptionReason',x.exception_reason,
        'amount',x.amount,
        'currency',x.currency,
        'providerReference',x.provider_reference,
        'createdAt',x.created_at
      ) order by case when x.needs_attention then 0 else 1 end,x.created_at desc,x.id desc)
      from paged x
    ),'[]'::jsonb),
    'totalCount',(select count(*) from filtered),
    'totalAmount',coalesce((select sum(amount) from filtered),0),
    'attentionCount',(select count(*) from base_filtered where needs_attention),
    'attentionAmount',coalesce((select sum(amount) from base_filtered where needs_attention),0),
    'confirmedAmount',coalesce((select sum(amount) from base_filtered where status='confirmed' and not needs_attention),0),
    'currency',(select case when count(distinct currency)=1 then min(currency) else null end from base_filtered),
    'limit',v_limit,
    'offset',v_offset
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.get_sellertray_receivables_management_list(
  p_tenant_id uuid,
  p_branch_id uuid default null,
  p_search text default null,
  p_date_from date default null,
  p_date_to date default null,
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
  v_timezone text;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if p_tenant_id is null then
    raise exception 'Business is required' using errcode='22023';
  end if;
  if not public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_view_reports') then
    raise exception 'You do not have permission to view customer balances' using errcode='42501';
  end if;
  if p_branch_id is not null then
    if not exists(select 1 from public.branches b where b.tenant_id=p_tenant_id and b.id=p_branch_id) then
      raise exception 'Branch not found' using errcode='P0002';
    end if;
    if not public.sellertray_user_can_read_report_branch(p_tenant_id,p_branch_id,v_user_id) then
      raise exception 'You do not have access to receivables for this Branch' using errcode='42501';
    end if;
  end if;
  if p_date_from is not null and p_date_to is not null and p_date_from>p_date_to then
    raise exception 'Receivables date range is invalid' using errcode='22023';
  end if;

  select coalesce(nullif(t.timezone,''),'Africa/Lagos') into v_timezone
  from public.tenants t where t.id=p_tenant_id;
  if v_timezone is null then
    raise exception 'Business not found' using errcode='P0002';
  end if;
  if p_date_from is not null then
    v_start_at := p_date_from::timestamp at time zone v_timezone;
  end if;
  if p_date_to is not null then
    v_end_at := (p_date_to+1)::timestamp at time zone v_timezone;
  end if;

  with filtered as materialized (
    select
      o.id as order_id,
      o.public_order_id,
      o.branch_id,
      b.name as branch_name,
      o.customer_id,
      coalesce(c.display_name,c.phone,'Customer') as customer_name,
      c.phone as customer_phone,
      o.source,
      o.currency,
      coalesce(o.total_amount,0) as total_amount,
      coalesce(o.returned_amount,0) as returned_amount,
      greatest(coalesce(o.total_amount,0)-coalesce(o.returned_amount,0),0) as net_amount_due,
      coalesce(o.amount_paid,0) as amount_paid,
      greatest(coalesce(o.total_amount,0)-coalesce(o.returned_amount,0)-coalesce(o.amount_paid,0),0) as outstanding_amount,
      o.created_at
    from public.orders o
    join public.branches b on b.tenant_id=o.tenant_id and b.id=o.branch_id
    join public.customers c on c.tenant_id=o.tenant_id and c.id=o.customer_id
    where o.tenant_id=p_tenant_id
      and o.deleted_at is null
      and o.status='completed'
      and o.customer_id is not null
      and greatest(coalesce(o.total_amount,0)-coalesce(o.returned_amount,0)-coalesce(o.amount_paid,0),0)>0
      and public.sellertray_user_can_read_report_branch(p_tenant_id,o.branch_id,v_user_id)
      and (p_branch_id is null or o.branch_id=p_branch_id)
      and (v_start_at is null or o.created_at>=v_start_at)
      and (v_end_at is null or o.created_at<v_end_at)
      and (
        v_search is null
        or lower(coalesce(o.public_order_id,'')) like '%'||lower(v_search)||'%'
        or lower(coalesce(c.display_name,'')) like '%'||lower(v_search)||'%'
        or lower(coalesce(c.phone,'')) like '%'||lower(v_search)||'%'
        or lower(coalesce(b.name,'')) like '%'||lower(v_search)||'%'
      )
  ),
  paged as (
    select * from filtered order by created_at desc,order_id desc limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'items',coalesce((
      select jsonb_agg(jsonb_build_object(
        'orderId',x.order_id,
        'publicOrderId',x.public_order_id,
        'branchId',x.branch_id,
        'branchName',x.branch_name,
        'customerId',x.customer_id,
        'customerName',x.customer_name,
        'customerPhone',x.customer_phone,
        'source',x.source,
        'currency',x.currency,
        'totalAmount',x.total_amount,
        'returnedAmount',x.returned_amount,
        'netAmountDue',x.net_amount_due,
        'amountPaid',x.amount_paid,
        'outstandingAmount',x.outstanding_amount,
        'createdAt',x.created_at
      ) order by x.created_at desc,x.order_id desc) from paged x
    ),'[]'::jsonb),
    'totalCount',(select count(*) from filtered),
    'customerCount',(select count(distinct customer_id) from filtered),
    'outstandingAmount',coalesce((select sum(outstanding_amount) from filtered),0),
    'currency',(select case when count(distinct currency)=1 then min(currency) else null end from filtered),
    'limit',v_limit,
    'offset',v_offset
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.get_sellertray_payment_methods_management(
  p_tenant_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if p_tenant_id is null then
    raise exception 'Business is required' using errcode='22023';
  end if;
  if not public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_manage_payments') then
    raise exception 'You do not have permission to manage payment methods' using errcode='42501';
  end if;

  with methods as materialized (
    select
      m.id,m.method_type,m.display_name,m.is_enabled,m.is_default,m.sort_order,m.mode,
      m.configuration_status,m.bank_name,m.bank_account_name,m.bank_account_number,m.bank_code,
      m.instructions,m.created_at,
      coalesce((
        select jsonb_agg(bpm.branch_id order by bpm.branch_id)
        from public.sellertray_branch_payment_methods bpm
        join public.branches b on b.tenant_id=bpm.tenant_id and b.id=bpm.branch_id
        where bpm.tenant_id=m.tenant_id
          and bpm.payment_method_id=m.id
          and bpm.is_enabled=true
          and b.is_active=true
      ),'[]'::jsonb) as branch_ids
    from public.merchant_payment_methods m
    where m.tenant_id=p_tenant_id
  )
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'id',x.id,
      'methodType',x.method_type,
      'displayName',x.display_name,
      'isEnabled',x.is_enabled,
      'isDefault',x.is_default,
      'sortOrder',x.sort_order,
      'mode',x.mode,
      'configurationStatus',x.configuration_status,
      'bankName',x.bank_name,
      'bankAccountName',x.bank_account_name,
      'bankAccountNumber',x.bank_account_number,
      'bankCode',x.bank_code,
      'instructions',x.instructions,
      'branchIds',x.branch_ids
    ) order by x.sort_order,x.created_at,x.id) from methods x),'[]'::jsonb),
    'totalCount',(select count(*) from methods)
  ) into v_result;

  return v_result;
end;
$$;

-- Receivable collection remains an append-only payment allocation command. The
-- outstanding guard now uses the same net-of-completed-returns balance as the
-- management read so returned goods cannot remain collectible.
create or replace function public.collect_sellertray_customer_receivable(
  p_tenant_id uuid,
  p_order_id uuid,
  p_payment_method_id uuid,
  p_amount numeric,
  p_command_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid:=auth.uid();
  v_order public.orders%rowtype;
  v_method text;
  v_status text;
  v_result jsonb;
  v_amount numeric:=round(coalesce(p_amount,0),2);
  v_outstanding numeric;
begin
  if v_user_id is null then raise exception 'SellerTray authentication required' using errcode='42501'; end if;
  if p_command_id is null then raise exception 'Payment command identity is required' using errcode='22023'; end if;
  if v_amount<=0 then raise exception 'Payment amount must be greater than zero' using errcode='22023'; end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then raise exception 'SellerTray subscription is read-only' using errcode='42501'; end if;

  select * into v_order
  from public.orders o
  where o.tenant_id=p_tenant_id and o.id=p_order_id and o.deleted_at is null
  for update;
  if not found then raise exception 'Sale not found' using errcode='P0002'; end if;
  if v_order.status<>'completed' or v_order.customer_id is null then
    raise exception 'Only a completed named-customer sale can receive a balance payment' using errcode='23514';
  end if;
  if not public.sellertray_user_can_manage_order_payment(p_tenant_id,v_order.id,v_user_id) then
    raise exception 'You do not have permission to collect this customer balance' using errcode='42501';
  end if;

  v_outstanding:=greatest(
    coalesce(v_order.total_amount,0)-coalesce(v_order.returned_amount,0)-coalesce(v_order.amount_paid,0),
    0
  );
  if v_amount>v_outstanding+0.005 then
    raise exception 'Payment exceeds the outstanding customer balance' using errcode='23514';
  end if;

  if p_payment_method_id is null then
    v_method:='cash';
    v_status:='confirmed';
  else
    select m.method_type into v_method
    from public.sellertray_branch_payment_methods bpm
    join public.merchant_payment_methods m on m.tenant_id=bpm.tenant_id and m.id=bpm.payment_method_id
    where bpm.tenant_id=p_tenant_id
      and bpm.branch_id=v_order.branch_id
      and bpm.payment_method_id=p_payment_method_id
      and bpm.is_enabled=true
      and m.is_enabled=true
      and m.method_type in('bank_transfer','card_terminal');
    if not found then raise exception 'Payment method is not enabled for this Branch' using errcode='23514'; end if;
    v_status:=case when v_method='bank_transfer' then 'pending_verification' else 'confirmed' end;
  end if;

  v_result:=public.sellertray_record_pos_payment_allocation(
    p_tenant_id,p_order_id,p_payment_method_id,v_amount,v_status,v_user_id,'receivable:'||p_command_id::text
  );
  return coalesce(v_result,'{}'::jsonb)||jsonb_build_object(
    'orderId',p_order_id,'amount',v_amount,'methodType',v_method,'status',v_status
  );
end;
$$;

revoke all on function public.get_sellertray_payment_management_list(uuid,uuid,text,text,text,date,date,integer,integer) from public,anon;
grant execute on function public.get_sellertray_payment_management_list(uuid,uuid,text,text,text,date,date,integer,integer) to authenticated,service_role;
revoke all on function public.get_sellertray_receivables_management_list(uuid,uuid,text,date,date,integer,integer) from public,anon;
grant execute on function public.get_sellertray_receivables_management_list(uuid,uuid,text,date,date,integer,integer) to authenticated,service_role;
revoke all on function public.get_sellertray_payment_methods_management(uuid) from public,anon;
grant execute on function public.get_sellertray_payment_methods_management(uuid) to authenticated,service_role;
revoke all on function public.collect_sellertray_customer_receivable(uuid,uuid,uuid,numeric,uuid) from public,anon;
grant execute on function public.collect_sellertray_customer_receivable(uuid,uuid,uuid,numeric,uuid) to authenticated,service_role;

commit;
