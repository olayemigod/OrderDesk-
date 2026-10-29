begin;

-- A completed sale stays completed. Returns are compensating commercial facts
-- with their own immutable stock and refund evidence.
alter table public.orders
  add column if not exists return_status text not null default 'none',
  add column if not exists returned_amount numeric(18,2) not null default 0,
  add column if not exists returned_at timestamptz,
  add constraint orders_return_status_check
    check (return_status in ('none','returned')),
  add constraint orders_returned_amount_nonnegative
    check (returned_amount >= 0);

create table public.sale_returns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  order_id uuid not null,
  original_payment_id uuid not null,
  return_type text not null default 'full' check (return_type='full'),
  status text not null default 'completed' check (status='completed'),
  amount numeric(18,2) not null check (amount > 0),
  currency text not null check (nullif(btrim(currency),'') is not null),
  reason text not null check (nullif(btrim(reason),'') is not null),
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,order_id),
  constraint sale_returns_order_same_tenant
    foreign key (tenant_id,order_id)
    references public.orders(tenant_id,id)
    on delete restrict,
  constraint sale_returns_branch_same_tenant
    foreign key (tenant_id,branch_id)
    references public.branches(tenant_id,id)
    on delete restrict,
  constraint sale_returns_payment_same_tenant
    foreign key (tenant_id,original_payment_id)
    references public.order_payments(tenant_id,id)
    on delete restrict
);

create index sale_returns_branch_created_idx
  on public.sale_returns(tenant_id,branch_id,created_at desc);

create table public.sale_return_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  sale_return_id uuid not null,
  order_item_id uuid not null,
  catalog_item_id uuid not null,
  product_name text not null,
  selected_uom text not null,
  quantity numeric(18,6) not null check (quantity > 0),
  conversion_factor numeric(18,6) not null check (conversion_factor > 0),
  stock_quantity numeric(18,6) not null check (stock_quantity > 0),
  unit_price numeric(18,2) not null check (unit_price >= 0),
  line_total numeric(18,2) not null check (line_total >= 0),
  created_at timestamptz not null default now(),
  unique (tenant_id,sale_return_id,order_item_id),
  constraint sale_return_items_return_same_tenant
    foreign key (tenant_id,sale_return_id)
    references public.sale_returns(tenant_id,id)
    on delete restrict,
  constraint sale_return_items_order_item_same_tenant
    foreign key (tenant_id,order_item_id)
    references public.order_items(tenant_id,id)
    on delete restrict,
  constraint sale_return_items_catalog_same_tenant
    foreign key (tenant_id,catalog_item_id)
    references public.catalog_items(tenant_id,id)
    on delete restrict
);

create table public.payment_refunds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  order_id uuid not null,
  original_payment_id uuid not null,
  sale_return_id uuid not null,
  method_type text not null check (method_type='cash'),
  provider text not null check (provider='pos_cash'),
  status text not null check (status='confirmed'),
  amount numeric(18,2) not null check (amount > 0),
  currency text not null check (nullif(btrim(currency),'') is not null),
  reason text not null check (nullif(btrim(reason),'') is not null),
  actor_user_id uuid references auth.users(id) on delete set null,
  idempotency_key text not null check (nullif(btrim(idempotency_key),'') is not null),
  created_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,sale_return_id),
  unique (tenant_id,idempotency_key),
  constraint payment_refunds_order_same_tenant
    foreign key (tenant_id,order_id)
    references public.orders(tenant_id,id)
    on delete restrict,
  constraint payment_refunds_original_same_tenant
    foreign key (tenant_id,original_payment_id)
    references public.order_payments(tenant_id,id)
    on delete restrict,
  constraint payment_refunds_return_same_tenant
    foreign key (tenant_id,sale_return_id)
    references public.sale_returns(tenant_id,id)
    on delete restrict
);

alter table public.sale_returns enable row level security;
alter table public.sale_return_items enable row level security;
alter table public.payment_refunds enable row level security;
revoke all on public.sale_returns from public,anon,authenticated;
revoke all on public.sale_return_items from public,anon,authenticated;
revoke all on public.payment_refunds from public,anon,authenticated;
grant all on public.sale_returns to service_role;
grant all on public.sale_return_items to service_role;
grant all on public.payment_refunds to service_role;

create or replace function public.prevent_sellertray_return_mutation()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  raise exception 'SellerTray return and refund records are immutable' using errcode='55000';
end;
$$;

revoke all on function public.prevent_sellertray_return_mutation()
  from public,anon,authenticated;

create trigger prevent_sale_returns_update
before update or delete on public.sale_returns
for each row execute function public.prevent_sellertray_return_mutation();
create trigger prevent_sale_return_items_update
before update or delete on public.sale_return_items
for each row execute function public.prevent_sellertray_return_mutation();
create trigger prevent_payment_refunds_update
before update or delete on public.payment_refunds
for each row execute function public.prevent_sellertray_return_mutation();

-- POS drafts may be cancelled because they have no committed payment or stock
-- effect. Paid/active order cancellation rules remain unchanged.
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
    if not exists(select 1 from public.order_items oi where oi.tenant_id=new.tenant_id and oi.order_id=new.id) then
      raise exception 'Order must contain at least one item before acceptance' using errcode='23514';
    end if;
    if exists(select 1 from public.order_items oi where oi.tenant_id=new.tenant_id and oi.order_id=new.id and oi.unit_price is null) then
      raise exception 'All order items must be priced before acceptance' using errcode='23514';
    end if;
    if exists(
      select 1 from public.order_items oi
      where oi.tenant_id=new.tenant_id and oi.order_id=new.id
        and oi.catalog_item_id is null and oi.match_source='unmatched'
    ) then
      raise exception 'Resolve unmatched catalogue items or explicitly keep them as one-off before acceptance' using errcode='23514';
    end if;
    return new;
  end if;

  if new.status='rejected' and old.status in ('draft','needs_review') then return new; end if;

  if new.status='cancelled' and old.status='draft' and old.source='pos' then
    if coalesce(old.amount_paid,0)<>0 or old.payment_status<>'unpaid'
       or exists(select 1 from public.order_payments p where p.tenant_id=old.tenant_id and p.order_id=old.id)
       or exists(
         select 1 from public.inventory_movements im
         where im.tenant_id=old.tenant_id
           and im.reference_type='order'
           and im.reference_id=old.id::text
       ) then
      raise exception 'POS draft with payment or stock activity cannot be voided' using errcode='23514';
    end if;
    return new;
  end if;

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
    if new.fulfillment_method in ('merchant_delivery','third_party_delivery') and new.fulfillment_status<>'delivered' then
      raise exception 'Delivery fulfillment must complete as delivered' using errcode='23514';
    end if;
    v_decision := public.sellertray_payment_gate_decision(new.id,'complete');
    if coalesce((v_decision->>'allowed')::boolean,false) is not true then
      raise exception '%',coalesce(v_decision->>'reason','Payment policy blocks completion') using errcode='23514';
    end if;
    return new;
  end if;

  if new.status='cancelled' and old.status in ('accepted','processing','ready') then
    if coalesce(old.amount_paid,0) > 0
       or old.payment_status in ('paid','verification_required','payment_issue') then
      raise exception 'Resolve the existing payment, verification, refund or reversal before cancelling this order' using errcode='23514';
    end if;
    return new;
  end if;

  raise exception 'Invalid order status transition: % -> %',old.status,new.status using errcode='23514';
end;
$$;

create or replace function public.void_sellertray_pos_draft(
  p_tenant_id uuid,
  p_order_id uuid,
  p_actor_user_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order public.orders%rowtype;
  v_role text;
  v_branch_is_default boolean;
  v_reason text := nullif(btrim(coalesce(p_reason,'')),'');
begin
  if p_tenant_id is null or p_order_id is null or p_actor_user_id is null or v_reason is null then
    raise exception 'Business, sale, operator and reason are required' using errcode='22023';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  select * into v_order from public.orders o
  where o.tenant_id=p_tenant_id and o.id=p_order_id for update;
  if not found or v_order.source<>'pos' then
    raise exception 'SellerTray POS draft not found' using errcode='22023';
  end if;

  if v_order.status='cancelled' then
    return jsonb_build_object('orderId',p_order_id,'status','cancelled','idempotentReplay',true);
  end if;
  if v_order.status<>'draft' then
    raise exception 'Only an unpaid POS draft can be voided' using errcode='23514';
  end if;

  select tm.role into v_role from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;
  if v_role is null then raise exception 'SellerTray tenant membership required' using errcode='42501'; end if;

  select b.is_default into v_branch_is_default from public.branches b
  where b.tenant_id=p_tenant_id and b.id=v_order.branch_id and b.is_active=true;
  if not found then raise exception 'Selected POS branch is unavailable' using errcode='23514'; end if;

  if v_role='staff' then
    if exists(select 1 from public.branch_user_access a where a.tenant_id=p_tenant_id and a.user_id=p_actor_user_id) then
      if not exists(
        select 1 from public.branch_user_access a
        where a.tenant_id=p_tenant_id and a.branch_id=v_order.branch_id
          and a.user_id=p_actor_user_id and a.can_operate=true
      ) then raise exception 'You do not have access to void sales from this branch' using errcode='42501'; end if;
    elsif v_branch_is_default is distinct from true then
      raise exception 'You do not have access to void sales from this branch' using errcode='42501';
    end if;
  elsif v_role not in ('owner','manager') then
    raise exception 'Your SellerTray role cannot void POS sales' using errcode='42501';
  end if;

  update public.orders
  set status='cancelled',status_reason=left(v_reason,500),updated_at=now()
  where tenant_id=p_tenant_id and id=p_order_id;

  return jsonb_build_object('orderId',p_order_id,'status','cancelled','idempotentReplay',false);
end;
$$;

revoke all on function public.void_sellertray_pos_draft(uuid,uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.void_sellertray_pos_draft(uuid,uuid,uuid,text)
  to service_role;

create or replace function public.return_sellertray_pos_cash_sale(
  p_tenant_id uuid,
  p_order_id uuid,
  p_actor_user_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order public.orders%rowtype;
  v_role text;
  v_branch_is_default boolean;
  v_reason text := nullif(btrim(coalesce(p_reason,'')),'');
  v_payment public.order_payments%rowtype;
  v_return_id uuid;
  v_refund_id uuid;
  v_stock_location_id uuid;
  v_existing_movement_count integer;
  v_item_count integer;
  v_line record;
begin
  if p_tenant_id is null or p_order_id is null or p_actor_user_id is null or v_reason is null then
    raise exception 'Business, sale, operator and return reason are required' using errcode='22023';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  select * into v_order from public.orders o
  where o.tenant_id=p_tenant_id and o.id=p_order_id for update;
  if not found or v_order.source<>'pos' then
    raise exception 'SellerTray POS sale not found' using errcode='22023';
  end if;

  select sr.id into v_return_id
  from public.sale_returns sr
  where sr.tenant_id=p_tenant_id and sr.order_id=p_order_id;
  if found then
    select pr.id into v_refund_id from public.payment_refunds pr
    where pr.tenant_id=p_tenant_id and pr.sale_return_id=v_return_id;
    return jsonb_build_object(
      'orderId',p_order_id,'returnId',v_return_id,'refundId',v_refund_id,
      'returnStatus','returned','idempotentReplay',true
    );
  end if;

  if v_order.status<>'completed'
     or v_order.payment_status<>'paid'
     or v_order.fulfillment_status<>'collected'
     or v_order.return_status<>'none'
     or coalesce(v_order.returned_amount,0)<>0 then
    raise exception 'Only a completed, paid and unreturned counter sale can be returned' using errcode='23514';
  end if;

  select * into v_payment from public.order_payments p
  where p.tenant_id=p_tenant_id and p.order_id=p_order_id
    and p.method_type='cash' and p.provider='pos_cash' and p.status='confirmed'
  order by p.confirmed_at,p.id limit 1;
  if not found then raise exception 'Completed POS sale has no confirmed counter cash payment' using errcode='23514'; end if;
  if v_payment.amount<>v_order.total_amount or v_payment.currency<>v_order.currency then
    raise exception 'Completed POS cash value does not match the sale total' using errcode='23514';
  end if;

  select tm.role into v_role from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;
  if v_role is null then raise exception 'SellerTray tenant membership required' using errcode='42501'; end if;
  select b.is_default into v_branch_is_default from public.branches b
  where b.tenant_id=p_tenant_id and b.id=v_order.branch_id and b.is_active=true;
  if not found then raise exception 'Selected POS branch is unavailable' using errcode='23514'; end if;

  if v_role='staff' then
    if exists(select 1 from public.branch_user_access a where a.tenant_id=p_tenant_id and a.user_id=p_actor_user_id) then
      if not exists(
        select 1 from public.branch_user_access a
        where a.tenant_id=p_tenant_id and a.branch_id=v_order.branch_id
          and a.user_id=p_actor_user_id and a.can_operate=true
      ) then raise exception 'You do not have access to return sales from this branch' using errcode='42501'; end if;
    elsif v_branch_is_default is distinct from true then
      raise exception 'You do not have access to return sales from this branch' using errcode='42501';
    end if;
  elsif v_role not in ('owner','manager') then
    raise exception 'Your SellerTray role cannot return POS sales' using errcode='42501';
  end if;

  select sl.id into v_stock_location_id from public.stock_locations sl
  where sl.tenant_id=p_tenant_id and sl.branch_id=v_order.branch_id
    and sl.is_default=true and sl.is_active=true
  order by sl.created_at,sl.id limit 1;
  if v_stock_location_id is null then raise exception 'POS branch has no active default stock location' using errcode='23514'; end if;

  select count(*)::integer into v_item_count from public.order_items oi
  where oi.tenant_id=p_tenant_id and oi.order_id=p_order_id;
  if v_item_count<1 then raise exception 'POS sale has no returnable items' using errcode='23514'; end if;

  select count(*)::integer into v_existing_movement_count
  from public.inventory_movements im
  where im.tenant_id=p_tenant_id and im.reference_type='order'
    and im.reference_id=p_order_id::text and im.movement_type='sale';
  if v_existing_movement_count<>v_item_count then
    raise exception 'POS sale stock history is incomplete and cannot be returned automatically' using errcode='23514';
  end if;

  insert into public.sale_returns(
    tenant_id,branch_id,order_id,original_payment_id,amount,currency,reason,actor_user_id
  ) values(
    p_tenant_id,v_order.branch_id,p_order_id,v_payment.id,v_payment.amount,v_payment.currency,
    left(v_reason,500),p_actor_user_id
  ) returning id into v_return_id;

  for v_line in
    select oi.id,oi.catalog_item_id,ci.name as product_name,
      oi.selected_uom,oi.quantity,oi.conversion_factor,oi.stock_quantity,
      oi.unit_price,oi.line_total
    from public.order_items oi
    join public.catalog_items ci on ci.tenant_id=oi.tenant_id and ci.id=oi.catalog_item_id
    where oi.tenant_id=p_tenant_id and oi.order_id=p_order_id
    order by oi.id
  loop
    if v_line.catalog_item_id is null or v_line.selected_uom is null
       or v_line.quantity is null or v_line.quantity<=0
       or v_line.conversion_factor is null or v_line.conversion_factor<=0
       or v_line.stock_quantity is null or v_line.stock_quantity<=0 then
      raise exception 'POS sale line has incomplete return snapshot' using errcode='23514';
    end if;

    insert into public.sale_return_items(
      tenant_id,sale_return_id,order_item_id,catalog_item_id,product_name,
      selected_uom,quantity,conversion_factor,stock_quantity,unit_price,line_total
    ) values(
      p_tenant_id,v_return_id,v_line.id,v_line.catalog_item_id,v_line.product_name,
      v_line.selected_uom,v_line.quantity,v_line.conversion_factor,v_line.stock_quantity,
      v_line.unit_price,v_line.line_total
    );

    perform public.record_sellertray_inventory_movement(
      p_tenant_id,v_order.branch_id,v_stock_location_id,v_line.catalog_item_id,
      'sale_return',v_line.stock_quantity,v_line.selected_uom,v_line.quantity,
      v_line.conversion_factor,'sale_return',v_return_id::text,
      'pos-return:'||v_return_id::text||':'||v_line.id::text,
      now(),p_actor_user_id,left(v_reason,500),
      jsonb_build_object(
        'return_id',v_return_id,'order_id',p_order_id,'public_order_id',v_order.public_order_id,
        'order_item_id',v_line.id,'original_payment_id',v_payment.id
      ),null
    );
  end loop;

  insert into public.payment_refunds(
    tenant_id,order_id,original_payment_id,sale_return_id,method_type,provider,status,
    amount,currency,reason,actor_user_id,idempotency_key
  ) values(
    p_tenant_id,p_order_id,v_payment.id,v_return_id,'cash','pos_cash','confirmed',
    v_payment.amount,v_payment.currency,left(v_reason,500),p_actor_user_id,
    'pos-cash-return:'||p_order_id::text
  ) returning id into v_refund_id;

  update public.orders
  set return_status='returned',returned_amount=v_payment.amount,returned_at=now(),updated_at=now()
  where tenant_id=p_tenant_id and id=p_order_id;

  insert into public.commercial_action_ledger(
    tenant_id,action_key,channel,customer_id,target_order_id,action_type,risk_class,
    requested_by,actor_user_id,policy_result,action_status,financial_impact,currency,
    before_state,after_state,metadata,applied_at
  ) values(
    p_tenant_id,'pos-return:'||p_order_id::text,'merchant_app',v_order.customer_id,p_order_id,
    'sale_returned','high',public.sellertray_commercial_actor_kind(p_tenant_id,p_actor_user_id),
    p_actor_user_id,'allowed','applied',-v_payment.amount,v_payment.currency,
    jsonb_build_object('return_status','none','returned_amount',0,'payment_status',v_order.payment_status),
    jsonb_build_object('return_status','returned','returned_amount',v_payment.amount,'payment_status',v_order.payment_status),
    jsonb_build_object('return_id',v_return_id,'refund_id',v_refund_id,'original_payment_id',v_payment.id,'reason',left(v_reason,500)),
    now()
  ) on conflict(tenant_id,action_key) do nothing;

  return jsonb_build_object(
    'orderId',p_order_id,'returnId',v_return_id,'refundId',v_refund_id,
    'returnStatus','returned','refundedAmount',v_payment.amount,
    'currency',v_payment.currency,'idempotentReplay',false
  );
end;
$$;

revoke all on function public.return_sellertray_pos_cash_sale(uuid,uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.return_sellertray_pos_cash_sale(uuid,uuid,uuid,text)
  to service_role;

commit;