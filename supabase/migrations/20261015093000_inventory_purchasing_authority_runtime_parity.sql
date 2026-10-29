begin;

revoke all privileges on table public.catalog_items from anon,authenticated;
grant select on table public.catalog_items to authenticated;
revoke all privileges on table public.catalog_item_uoms from anon,authenticated;
grant select on table public.catalog_item_uoms to authenticated;

drop policy if exists catalog_items_insert_member on public.catalog_items;
drop policy if exists catalog_items_update_member on public.catalog_items;
drop policy if exists catalog_items_insert_owner_manager on public.catalog_items;
drop policy if exists catalog_items_update_owner_manager on public.catalog_items;
drop policy if exists catalog_item_uoms_manage_management on public.catalog_item_uoms;

revoke all privileges on table public.inventory_movements from anon,authenticated;
grant select on table public.inventory_movements to authenticated;
grant all privileges on table public.inventory_movements to service_role;

drop policy if exists inventory_movements_select_branch_member on public.inventory_movements;
create policy inventory_movements_select_branch_member
on public.inventory_movements
for select to authenticated
using (
  public.sellertray_current_user_can_read_branch(
    inventory_movements.tenant_id,
    inventory_movements.branch_id
  )
);

alter table public.sellertray_purchase_receipts
  add column if not exists items_fingerprint text;

update public.sellertray_purchase_receipts r
set items_fingerprint=coalesce((
  select pg_catalog.md5(pg_catalog.string_agg(
    ri.purchase_order_item_id::text || ':' || round(ri.received_quantity::numeric,6)::text,
    '|' order by ri.purchase_order_item_id
  ))
  from public.sellertray_purchase_receipt_items ri
  where ri.tenant_id=r.tenant_id and ri.receipt_id=r.id
),pg_catalog.md5(''))
where r.items_fingerprint is null;

alter table public.sellertray_purchase_receipts
  alter column items_fingerprint set not null;

create or replace function public.receive_sellertray_purchase_order(
  p_tenant_id uuid,
  p_purchase_order_id uuid,
  p_reference text,
  p_notes text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_reference text := nullif(btrim(coalesce(p_reference,'')),'');
  v_notes text := nullif(btrim(coalesce(p_notes,'')),'');
  v_items_fingerprint text;
  v_input_count integer;
  v_distinct_count integer;
  v_po public.sellertray_purchase_orders%rowtype;
  v_supplier_name text;
  v_existing_receipt public.sellertray_purchase_receipts%rowtype;
  v_existing_item_count integer;
  v_receipt_id uuid;
  v_row jsonb;
  v_item_id uuid;
  v_quantity numeric(18,6);
  v_item public.sellertray_purchase_order_items%rowtype;
  v_current_factor numeric(18,6);
  v_current_uom text;
  v_result jsonb;
  v_movement_id uuid;
  v_stock_quantity numeric(18,6);
  v_count integer := 0;
  v_complete boolean;
begin
  if v_user_id is null then raise exception 'SellerTray authentication required' using errcode='42501'; end if;
  if v_reference is null then raise exception 'Receipt reference is required' using errcode='22023'; end if;
  if char_length(v_reference)>120 then raise exception 'Receipt reference is too long' using errcode='22023'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 or jsonb_array_length(p_items)>200 then
    raise exception 'Receipt must contain between 1 and 200 items' using errcode='22023';
  end if;

  begin
    with normalized as (
      select
        nullif(value->>'purchaseOrderItemId','')::uuid as item_id,
        round(nullif(value->>'quantity','')::numeric,6) as quantity
      from jsonb_array_elements(p_items)
    )
    select
      count(*)::integer,
      count(distinct item_id)::integer,
      pg_catalog.md5(pg_catalog.string_agg(
        item_id::text || ':' || quantity::text,
        '|' order by item_id
      ))
    into v_input_count,v_distinct_count,v_items_fingerprint
    from normalized
    where item_id is not null and quantity is not null and quantity>0;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'Receipt contains an invalid purchase item or quantity' using errcode='22023';
  end;

  if v_input_count<>jsonb_array_length(p_items) or v_items_fingerprint is null then
    raise exception 'Every receipt item requires a valid purchase item and positive quantity' using errcode='22023';
  end if;
  if v_distinct_count<>v_input_count then
    raise exception 'Each purchase item can appear only once in a receipt' using errcode='22023';
  end if;

  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  select * into v_po
  from public.sellertray_purchase_orders po
  where po.tenant_id=p_tenant_id and po.id=p_purchase_order_id
  for update;
  if not found then raise exception 'Purchase order not found' using errcode='P0002'; end if;

  select s.name into v_supplier_name
  from public.sellertray_suppliers s
  where s.tenant_id=p_tenant_id and s.id=v_po.supplier_id;
  if not found then raise exception 'Purchase order supplier is unavailable' using errcode='P0002'; end if;

  if not public.sellertray_user_can_operate_branch(p_tenant_id,v_po.branch_id,v_user_id) then
    raise exception 'You do not have access to receive stock for this Branch' using errcode='42501';
  end if;
  if not public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_receive_stock') then
    raise exception 'You do not have permission to receive stock' using errcode='42501';
  end if;

  select * into v_existing_receipt
  from public.sellertray_purchase_receipts r
  where r.tenant_id=p_tenant_id and lower(btrim(r.reference))=lower(v_reference)
  limit 1;
  if found then
    if v_existing_receipt.purchase_order_id<>p_purchase_order_id then
      raise exception 'Receipt reference is already used for another purchase' using errcode='23505';
    end if;
    if v_existing_receipt.items_fingerprint<>v_items_fingerprint
       or coalesce(btrim(v_existing_receipt.notes),'')<>coalesce(v_notes,'') then
      raise exception 'Receipt reference is already used for different receiving facts' using errcode='23505';
    end if;
    select count(*)::integer into v_existing_item_count
    from public.sellertray_purchase_receipt_items ri
    where ri.tenant_id=p_tenant_id and ri.receipt_id=v_existing_receipt.id;
    return jsonb_build_object(
      'receiptId',v_existing_receipt.id,'purchaseOrderId',v_existing_receipt.purchase_order_id,
      'reference',v_existing_receipt.reference,'status',v_po.status,
      'itemCount',v_existing_item_count,'idempotentReplay',true
    );
  end if;

  if v_po.status not in ('ordered','partially_received') then
    raise exception 'Only an ordered purchase can receive stock' using errcode='23514';
  end if;

  v_receipt_id := gen_random_uuid();
  insert into public.sellertray_purchase_receipts(
    id,tenant_id,purchase_order_id,branch_id,supplier_id,reference,notes,items_fingerprint,
    received_by,received_at,created_at
  ) values(
    v_receipt_id,p_tenant_id,v_po.id,v_po.branch_id,v_po.supplier_id,v_reference,v_notes,
    v_items_fingerprint,v_user_id,now(),now()
  );

  for v_row in select value from jsonb_array_elements(p_items)
  loop
    v_count := v_count + 1;
    begin
      v_item_id := nullif(v_row->>'purchaseOrderItemId','')::uuid;
      v_quantity := round(nullif(v_row->>'quantity','')::numeric,6);
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Receipt item % has an invalid purchase item or quantity',v_count using errcode='22023';
    end;
    if v_item_id is null or v_quantity is null or v_quantity<=0 then
      raise exception 'Receipt item % requires a positive quantity',v_count using errcode='22023';
    end if;

    select * into v_item
    from public.sellertray_purchase_order_items i
    where i.tenant_id=p_tenant_id and i.purchase_order_id=v_po.id and i.id=v_item_id
    for update;
    if not found then raise exception 'Receipt item % is not part of this purchase order',v_count using errcode='23503'; end if;
    if v_item.received_quantity+v_quantity>v_item.ordered_quantity then
      raise exception 'Receipt quantity for % exceeds the remaining ordered quantity',v_item.product_name using errcode='23514';
    end if;

    select u.conversion_factor,u.uom_name into v_current_factor,v_current_uom
    from public.catalog_item_uoms u
    where u.tenant_id=p_tenant_id and u.catalog_item_id=v_item.catalog_item_id and u.id=v_item.uom_id;
    if not found then
      raise exception 'The purchase unit for % is no longer available',v_item.product_name using errcode='23514';
    end if;
    if v_current_factor<>v_item.conversion_factor or lower(v_current_uom)<>lower(v_item.selected_uom) then
      raise exception 'The unit conversion for % changed after this purchase was placed; review the purchase before receiving stock',v_item.product_name using errcode='23514';
    end if;

    v_result := public.apply_sellertray_inventory_operation(
      p_tenant_id,
      v_po.branch_id,
      v_item.catalog_item_id,
      v_item.uom_id,
      'receive',
      v_quantity,
      null,
      left(v_reference || '/' || v_item.id::text,160),
      left('Purchase receipt ' || v_reference || ' from ' || coalesce(v_supplier_name,'supplier'),500),
      v_user_id
    );

    begin
      v_movement_id := nullif(v_result->>'movementId','')::uuid;
    exception when invalid_text_representation then
      v_movement_id := null;
    end;
    v_stock_quantity := round((v_quantity*v_item.conversion_factor)::numeric,6);
    if v_movement_id is null
       or abs(coalesce((v_result->>'quantityDelta')::numeric,0)-v_stock_quantity)>0.000001 then
      raise exception 'SellerTray could not confirm the stock movement for %',v_item.product_name using errcode='23514';
    end if;

    insert into public.sellertray_purchase_receipt_items(
      tenant_id,receipt_id,purchase_order_item_id,catalog_item_id,uom_id,selected_uom,
      conversion_factor,received_quantity,received_stock_quantity,inventory_movement_id,created_at
    ) values(
      p_tenant_id,v_receipt_id,v_item.id,v_item.catalog_item_id,v_item.uom_id,v_item.selected_uom,
      v_item.conversion_factor,v_quantity,v_stock_quantity,v_movement_id,now()
    );

    update public.sellertray_purchase_order_items
    set received_quantity=received_quantity+v_quantity,
        received_stock_quantity=received_stock_quantity+v_stock_quantity
    where tenant_id=p_tenant_id and id=v_item.id;
  end loop;

  select not exists(
    select 1 from public.sellertray_purchase_order_items i
    where i.tenant_id=p_tenant_id and i.purchase_order_id=v_po.id
      and i.received_quantity<i.ordered_quantity
  ) into v_complete;

  update public.sellertray_purchase_orders
  set status=case when v_complete then 'received' else 'partially_received' end,
      received_at=case when v_complete then coalesce(received_at,now()) else received_at end,
      updated_at=now()
  where tenant_id=p_tenant_id and id=v_po.id
  returning * into v_po;

  return jsonb_build_object(
    'receiptId',v_receipt_id,'purchaseOrderId',v_po.id,'reference',v_reference,
    'status',v_po.status,'itemCount',v_count,'idempotentReplay',false
  );
end;
$$;

revoke all on function public.receive_sellertray_purchase_order(uuid,uuid,text,text,jsonb)
  from public,anon;
grant execute on function public.receive_sellertray_purchase_order(uuid,uuid,text,text,jsonb)
  to authenticated;

create table if not exists public.sellertray_supplier_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  purchase_order_id uuid not null,
  branch_id uuid not null,
  supplier_id uuid not null,
  reference text not null check (char_length(btrim(reference)) between 1 and 120),
  method text not null check (method in ('bank_transfer','cash','card','other')),
  amount numeric(14,2) not null check (amount > 0),
  currency text not null check (char_length(btrim(currency)) = 3),
  paid_at timestamptz not null,
  notes text,
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id,id),
  constraint sellertray_supplier_payments_order_same_tenant
    foreign key (tenant_id,purchase_order_id)
    references public.sellertray_purchase_orders(tenant_id,id)
    on delete cascade,
  constraint sellertray_supplier_payments_branch_same_tenant
    foreign key (tenant_id,branch_id)
    references public.branches(tenant_id,id)
    on delete cascade,
  constraint sellertray_supplier_payments_supplier_same_tenant
    foreign key (tenant_id,supplier_id)
    references public.sellertray_suppliers(tenant_id,id)
    on delete cascade
);

create unique index if not exists sellertray_supplier_payments_reference_unique
  on public.sellertray_supplier_payments(tenant_id,lower(btrim(reference)));
create index if not exists sellertray_supplier_payments_order_paid_idx
  on public.sellertray_supplier_payments(tenant_id,purchase_order_id,paid_at desc,id);
create index if not exists sellertray_supplier_payments_supplier_paid_idx
  on public.sellertray_supplier_payments(tenant_id,supplier_id,paid_at desc,id);

create table if not exists public.sellertray_supplier_payment_reversals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  payment_id uuid not null,
  purchase_order_id uuid not null,
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  reversed_by uuid references auth.users(id) on delete set null,
  reversed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,payment_id),
  constraint sellertray_supplier_payment_reversals_payment_same_tenant
    foreign key (tenant_id,payment_id)
    references public.sellertray_supplier_payments(tenant_id,id)
    on delete cascade,
  constraint sellertray_supplier_payment_reversals_order_same_tenant
    foreign key (tenant_id,purchase_order_id)
    references public.sellertray_purchase_orders(tenant_id,id)
    on delete cascade
);

create index if not exists sellertray_supplier_payment_reversals_order_idx
  on public.sellertray_supplier_payment_reversals(tenant_id,purchase_order_id,reversed_at desc,id);

alter table public.sellertray_supplier_payments enable row level security;
alter table public.sellertray_supplier_payment_reversals enable row level security;
revoke all on table public.sellertray_supplier_payments from public,anon,authenticated;
revoke all on table public.sellertray_supplier_payment_reversals from public,anon,authenticated;
grant all on table public.sellertray_supplier_payments to service_role;
grant all on table public.sellertray_supplier_payment_reversals to service_role;

create or replace function public.prevent_sellertray_supplier_payment_mutation()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if tg_op='DELETE'
     and not exists(select 1 from public.tenants t where t.id=old.tenant_id) then
    return old;
  end if;
  raise exception 'Supplier payment evidence is immutable; record a reversal instead' using errcode='55000';
end;
$$;
revoke all on function public.prevent_sellertray_supplier_payment_mutation() from public,anon,authenticated;

drop trigger if exists prevent_sellertray_supplier_payment_mutation on public.sellertray_supplier_payments;
create trigger prevent_sellertray_supplier_payment_mutation
before update or delete on public.sellertray_supplier_payments
for each row execute function public.prevent_sellertray_supplier_payment_mutation();

drop trigger if exists prevent_sellertray_supplier_payment_reversal_mutation on public.sellertray_supplier_payment_reversals;
create trigger prevent_sellertray_supplier_payment_reversal_mutation
before update or delete on public.sellertray_supplier_payment_reversals
for each row execute function public.prevent_sellertray_supplier_payment_mutation();

create or replace function public.sellertray_purchase_paid_amount(
  p_tenant_id uuid,
  p_purchase_order_id uuid
)
returns numeric
language sql
stable
security definer
set search_path=''
as $$
  select coalesce(sum(p.amount),0)::numeric(14,2)
  from public.sellertray_supplier_payments p
  where p.tenant_id=p_tenant_id
    and p.purchase_order_id=p_purchase_order_id
    and not exists(
      select 1
      from public.sellertray_supplier_payment_reversals r
      where r.tenant_id=p.tenant_id and r.payment_id=p.id
    );
$$;
revoke all on function public.sellertray_purchase_paid_amount(uuid,uuid) from public,anon,authenticated;
grant execute on function public.sellertray_purchase_paid_amount(uuid,uuid) to service_role;

create or replace function public.record_sellertray_supplier_payment(
  p_tenant_id uuid,
  p_purchase_order_id uuid,
  p_reference text,
  p_method text,
  p_amount numeric,
  p_paid_at timestamptz,
  p_notes text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_reference text := nullif(btrim(coalesce(p_reference,'')),'');
  v_method text := lower(btrim(coalesce(p_method,'')));
  v_amount numeric(14,2) := round(coalesce(p_amount,0),2);
  v_paid_at timestamptz := coalesce(p_paid_at,now());
  v_notes text := nullif(btrim(coalesce(p_notes,'')),'');
  v_po public.sellertray_purchase_orders%rowtype;
  v_existing public.sellertray_supplier_payments%rowtype;
  v_payment public.sellertray_supplier_payments%rowtype;
  v_paid numeric(14,2);
  v_outstanding numeric(14,2);
  v_reversed boolean;
begin
  if v_user_id is null then raise exception 'SellerTray authentication required' using errcode='42501'; end if;
  if not public.sellertray_purchase_management_role(p_tenant_id,v_user_id) then
    raise exception 'Owner or Manager access is required to record supplier payments' using errcode='42501';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;
  if v_reference is null or char_length(v_reference)>120 then
    raise exception 'Supplier payment reference is required and must be 120 characters or fewer' using errcode='22023';
  end if;
  if v_method not in ('bank_transfer','cash','card','other') then
    raise exception 'Choose a supported supplier payment method' using errcode='22023';
  end if;
  if v_amount<=0 then raise exception 'Supplier payment amount must be greater than zero' using errcode='22023'; end if;
  if v_paid_at>now()+interval '5 minutes' then
    raise exception 'Supplier payment time cannot be in the future' using errcode='22023';
  end if;

  select * into v_po
  from public.sellertray_purchase_orders po
  where po.tenant_id=p_tenant_id and po.id=p_purchase_order_id
  for update;
  if not found then raise exception 'Purchase order not found' using errcode='P0002'; end if;

  select * into v_existing
  from public.sellertray_supplier_payments p
  where p.tenant_id=p_tenant_id and lower(btrim(p.reference))=lower(v_reference)
  limit 1;
  if found then
    if v_existing.purchase_order_id<>v_po.id
       or v_existing.amount<>v_amount
       or v_existing.method<>v_method
       or v_existing.currency<>v_po.currency
       or (p_paid_at is not null and v_existing.paid_at is distinct from p_paid_at)
       or coalesce(btrim(v_existing.notes),'')<>coalesce(v_notes,'') then
      raise exception 'Supplier payment reference is already used for different payment evidence' using errcode='23505';
    end if;
    select exists(
      select 1 from public.sellertray_supplier_payment_reversals r
      where r.tenant_id=p_tenant_id and r.payment_id=v_existing.id
    ) into v_reversed;
    v_paid := public.sellertray_purchase_paid_amount(p_tenant_id,v_po.id);
    v_outstanding := greatest(round(v_po.total_amount-v_paid,2),0);
    return jsonb_build_object(
      'paymentId',v_existing.id,'purchaseOrderId',v_po.id,'reference',v_existing.reference,
      'amount',v_existing.amount,'currency',v_existing.currency,'method',v_existing.method,
      'paidAmount',v_paid,'outstandingAmount',v_outstanding,'reversed',v_reversed,
      'idempotentReplay',true
    );
  end if;

  if v_po.status not in ('ordered','partially_received','received') then
    raise exception 'Supplier payments can be recorded only after a Purchase Order is placed' using errcode='23514';
  end if;

  v_paid := public.sellertray_purchase_paid_amount(p_tenant_id,v_po.id);
  v_outstanding := greatest(round(v_po.total_amount-v_paid,2),0);
  if v_amount>v_outstanding then
    raise exception 'Supplier payment exceeds the Purchase Order outstanding amount' using errcode='23514';
  end if;

  insert into public.sellertray_supplier_payments(
    tenant_id,purchase_order_id,branch_id,supplier_id,reference,method,amount,currency,
    paid_at,notes,recorded_by,created_at
  ) values(
    p_tenant_id,v_po.id,v_po.branch_id,v_po.supplier_id,v_reference,v_method,v_amount,v_po.currency,
    v_paid_at,v_notes,v_user_id,now()
  ) returning * into v_payment;

  v_paid := round(v_paid+v_payment.amount,2);
  v_outstanding := greatest(round(v_po.total_amount-v_paid,2),0);
  return jsonb_build_object(
    'paymentId',v_payment.id,'purchaseOrderId',v_po.id,'reference',v_payment.reference,
    'amount',v_payment.amount,'currency',v_payment.currency,'method',v_payment.method,
    'paidAmount',v_paid,'outstandingAmount',v_outstanding,'reversed',false,
    'idempotentReplay',false
  );
end;
$$;
revoke all on function public.record_sellertray_supplier_payment(uuid,uuid,text,text,numeric,timestamptz,text) from public,anon;
grant execute on function public.record_sellertray_supplier_payment(uuid,uuid,text,text,numeric,timestamptz,text) to authenticated;

create or replace function public.reverse_sellertray_supplier_payment(
  p_tenant_id uuid,
  p_payment_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_reason text := nullif(btrim(coalesce(p_reason,'')),'');
  v_payment public.sellertray_supplier_payments%rowtype;
  v_reversal public.sellertray_supplier_payment_reversals%rowtype;
  v_po public.sellertray_purchase_orders%rowtype;
  v_paid numeric(14,2);
  v_outstanding numeric(14,2);
begin
  if v_user_id is null then raise exception 'SellerTray authentication required' using errcode='42501'; end if;
  if not public.sellertray_purchase_management_role(p_tenant_id,v_user_id) then
    raise exception 'Owner or Manager access is required to reverse supplier payments' using errcode='42501';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;
  if v_reason is null then raise exception 'Supplier payment reversal reason is required' using errcode='22023'; end if;

  select * into v_payment
  from public.sellertray_supplier_payments p
  where p.tenant_id=p_tenant_id and p.id=p_payment_id
  for update;
  if not found then raise exception 'Supplier payment not found' using errcode='P0002'; end if;

  select * into v_po
  from public.sellertray_purchase_orders po
  where po.tenant_id=p_tenant_id and po.id=v_payment.purchase_order_id
  for update;
  if not found then raise exception 'Purchase order not found' using errcode='P0002'; end if;

  select * into v_reversal
  from public.sellertray_supplier_payment_reversals r
  where r.tenant_id=p_tenant_id and r.payment_id=v_payment.id
  limit 1;
  if found then
    v_paid := public.sellertray_purchase_paid_amount(p_tenant_id,v_po.id);
    v_outstanding := greatest(round(v_po.total_amount-v_paid,2),0);
    return jsonb_build_object(
      'reversalId',v_reversal.id,'paymentId',v_payment.id,'purchaseOrderId',v_po.id,
      'paidAmount',v_paid,'outstandingAmount',v_outstanding,'idempotentReplay',true
    );
  end if;

  insert into public.sellertray_supplier_payment_reversals(
    tenant_id,payment_id,purchase_order_id,reason,reversed_by,reversed_at,created_at
  ) values(
    p_tenant_id,v_payment.id,v_po.id,v_reason,v_user_id,now(),now()
  ) returning * into v_reversal;

  v_paid := public.sellertray_purchase_paid_amount(p_tenant_id,v_po.id);
  v_outstanding := greatest(round(v_po.total_amount-v_paid,2),0);
  return jsonb_build_object(
    'reversalId',v_reversal.id,'paymentId',v_payment.id,'purchaseOrderId',v_po.id,
    'paidAmount',v_paid,'outstandingAmount',v_outstanding,'idempotentReplay',false
  );
end;
$$;
revoke all on function public.reverse_sellertray_supplier_payment(uuid,uuid,text) from public,anon;
grant execute on function public.reverse_sellertray_supplier_payment(uuid,uuid,text) to authenticated;

create or replace function public.get_sellertray_purchase_payment_summary(
  p_tenant_id uuid,
  p_purchase_order_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_po public.sellertray_purchase_orders%rowtype;
  v_paid numeric(14,2);
  v_outstanding numeric(14,2);
  v_payments jsonb;
begin
  if v_user_id is null then raise exception 'SellerTray authentication required' using errcode='42501'; end if;
  if not public.sellertray_purchase_management_role(p_tenant_id,v_user_id) then
    raise exception 'Owner or Manager access is required to review supplier payments' using errcode='42501';
  end if;

  select * into v_po
  from public.sellertray_purchase_orders po
  where po.tenant_id=p_tenant_id and po.id=p_purchase_order_id;
  if not found then raise exception 'Purchase order not found' using errcode='P0002'; end if;

  v_paid := public.sellertray_purchase_paid_amount(p_tenant_id,v_po.id);
  v_outstanding := greatest(round(v_po.total_amount-v_paid,2),0);

  select coalesce(jsonb_agg(jsonb_build_object(
    'paymentId',p.id,'reference',p.reference,'method',p.method,'amount',p.amount,'currency',p.currency,
    'paidAt',p.paid_at,'notes',p.notes,'recordedBy',p.recorded_by,
    'reversed',r.id is not null,'reversalId',r.id,'reversalReason',r.reason,'reversedAt',r.reversed_at
  ) order by p.paid_at desc,p.id desc),'[]'::jsonb)
  into v_payments
  from public.sellertray_supplier_payments p
  left join public.sellertray_supplier_payment_reversals r
    on r.tenant_id=p.tenant_id and r.payment_id=p.id
  where p.tenant_id=p_tenant_id and p.purchase_order_id=v_po.id;

  return jsonb_build_object(
    'purchaseOrderId',v_po.id,'currency',v_po.currency,'totalAmount',v_po.total_amount,
    'paidAmount',v_paid,'outstandingAmount',v_outstanding,
    'paymentStatus',case when v_paid<=0 then 'unpaid' when v_outstanding<=0 then 'paid' else 'partially_paid' end,
    'payments',v_payments
  );
end;
$$;
revoke all on function public.get_sellertray_purchase_payment_summary(uuid,uuid) from public,anon;
grant execute on function public.get_sellertray_purchase_payment_summary(uuid,uuid) to authenticated;

create or replace function public.get_sellertray_supplier_outstanding_summary(
  p_tenant_id uuid
)
returns table(
  supplier_id uuid,
  supplier_name text,
  currency text,
  purchase_total numeric,
  paid_amount numeric,
  outstanding_amount numeric,
  purchase_count bigint
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'SellerTray authentication required' using errcode='42501'; end if;
  if not public.sellertray_purchase_management_role(p_tenant_id,v_user_id) then
    raise exception 'Owner or Manager access is required to review supplier outstanding state' using errcode='42501';
  end if;

  return query
  with per_purchase as (
    select po.supplier_id,po.currency,po.total_amount,
           public.sellertray_purchase_paid_amount(po.tenant_id,po.id) as paid
    from public.sellertray_purchase_orders po
    where po.tenant_id=p_tenant_id
      and po.status in ('ordered','partially_received','received')
  )
  select s.id,s.name,
         coalesce(max(pp.currency),(select t.currency from public.tenants t where t.id=p_tenant_id),'NGN')::text,
         coalesce(sum(pp.total_amount),0)::numeric(14,2),
         coalesce(sum(pp.paid),0)::numeric(14,2),
         coalesce(sum(greatest(pp.total_amount-pp.paid,0)),0)::numeric(14,2),
         count(pp.total_amount)
  from public.sellertray_suppliers s
  left join per_purchase pp on pp.supplier_id=s.id
  where s.tenant_id=p_tenant_id
  group by s.id,s.name
  order by 6 desc,s.name,s.id;
end;
$$;
revoke all on function public.get_sellertray_supplier_outstanding_summary(uuid) from public,anon;
grant execute on function public.get_sellertray_supplier_outstanding_summary(uuid) to authenticated;

create or replace function public.guard_sellertray_purchase_cancellation_with_payment()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if new.status='cancelled' and old.status is distinct from 'cancelled'
     and exists(
       select 1
       from public.sellertray_supplier_payments p
       where p.tenant_id=old.tenant_id
         and p.purchase_order_id=old.id
         and not exists(
           select 1
           from public.sellertray_supplier_payment_reversals r
           where r.tenant_id=p.tenant_id and r.payment_id=p.id
         )
     ) then
    raise exception 'Reverse supplier payments before cancelling this Purchase Order' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_sellertray_purchase_cancellation_with_payment() from public,anon,authenticated;

drop trigger if exists guard_sellertray_purchase_cancellation_with_payment on public.sellertray_purchase_orders;
create trigger guard_sellertray_purchase_cancellation_with_payment
before update of status on public.sellertray_purchase_orders
for each row execute function public.guard_sellertray_purchase_cancellation_with_payment();

commit;
