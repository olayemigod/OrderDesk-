begin;

alter table public.purchase_orders
  add constraint purchase_orders_supplier_identity_unique
  unique (tenant_id,id,supplier_id);

create table public.supplier_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  supplier_id uuid not null,
  purchase_order_id uuid not null,
  payment_date date not null default current_date,
  amount numeric(18,2) not null check (amount>0),
  currency text not null default 'NGN' check (char_length(btrim(currency))=3),
  method text not null check (method in ('bank_transfer','card','other')),
  reference text not null check (nullif(btrim(reference),'') is not null),
  notes text,
  recorded_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id,id),
  constraint supplier_payments_supplier_same_tenant
    foreign key (tenant_id,supplier_id)
    references public.suppliers(tenant_id,id)
    on delete cascade,
  constraint supplier_payments_order_supplier_same_tenant
    foreign key (tenant_id,purchase_order_id,supplier_id)
    references public.purchase_orders(tenant_id,id,supplier_id)
    on delete cascade
);

create unique index supplier_payments_reference_uidx
  on public.supplier_payments(tenant_id,supplier_id,lower(btrim(reference)));
create index supplier_payments_order_date_idx
  on public.supplier_payments(tenant_id,purchase_order_id,payment_date desc,created_at desc);
create index supplier_payments_supplier_date_idx
  on public.supplier_payments(tenant_id,supplier_id,payment_date desc,created_at desc);

alter table public.supplier_payments enable row level security;
revoke all on table public.supplier_payments from public,anon,authenticated;
grant all on table public.supplier_payments to service_role;

create or replace function public.sellertray_purchase_order_received_value(
  p_tenant_id uuid,
  p_purchase_order_id uuid
)
returns numeric
language sql
stable
security definer
set search_path=''
as $$
  select coalesce(sum(pri.source_quantity*pri.unit_cost_snapshot),0)::numeric(18,2)
  from public.purchase_receipt_items pri
  join public.purchase_receipts pr
    on pr.tenant_id=pri.tenant_id and pr.id=pri.purchase_receipt_id
  where pri.tenant_id=p_tenant_id
    and pr.purchase_order_id=p_purchase_order_id;
$$;

revoke all on function public.sellertray_purchase_order_received_value(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.sellertray_purchase_order_received_value(uuid,uuid)
  to service_role;

create or replace function public.record_sellertray_supplier_payment(
  p_tenant_id uuid,
  p_purchase_order_id uuid,
  p_amount numeric,
  p_method text,
  p_reference text,
  p_payment_date date,
  p_notes text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_order public.purchase_orders%rowtype;
  v_method text := lower(btrim(coalesce(p_method,'')));
  v_reference text := nullif(btrim(coalesce(p_reference,'')),'');
  v_amount numeric(18,2) := round(coalesce(p_amount,0)::numeric,2);
  v_payment_date date := coalesce(p_payment_date,current_date);
  v_received numeric(18,2);
  v_paid numeric(18,2);
  v_outstanding numeric(18,2);
  v_existing public.supplier_payments%rowtype;
  v_payment_id uuid;
begin
  if v_user_id is null or not public.sellertray_user_can_manage_purchasing(p_tenant_id,v_user_id) then
    raise exception 'Only business Owners and Managers can record Supplier payments' using errcode='42501';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;
  if v_amount<=0 then raise exception 'Supplier payment amount must be greater than zero' using errcode='22023'; end if;
  if v_method not in ('bank_transfer','card','other') then
    raise exception 'Supplier payment method must be Bank Transfer, Card or Other' using errcode='22023';
  end if;
  if v_reference is null or char_length(v_reference)>160 then
    raise exception 'Supplier payment reference is required and must be 160 characters or fewer' using errcode='22023';
  end if;
  if char_length(coalesce(p_notes,''))>2000 then
    raise exception 'Supplier payment notes are too long' using errcode='22023';
  end if;

  select * into v_order
  from public.purchase_orders po
  where po.tenant_id=p_tenant_id and po.id=p_purchase_order_id
  for update;
  if not found then raise exception 'Purchase Order not found' using errcode='P0002'; end if;
  if v_order.status not in ('partially_received','received') then
    raise exception 'Supplier payments can be recorded only after stock has been received' using errcode='23514';
  end if;

  select * into v_existing
  from public.supplier_payments sp
  where sp.tenant_id=p_tenant_id
    and sp.supplier_id=v_order.supplier_id
    and lower(btrim(sp.reference))=lower(v_reference)
  limit 1;

  if found then
    if v_existing.purchase_order_id=p_purchase_order_id
       and v_existing.amount=v_amount
       and v_existing.method=v_method
       and v_existing.payment_date=v_payment_date
       and coalesce(v_existing.notes,'')=coalesce(nullif(btrim(coalesce(p_notes,'')),''),'') then
      return jsonb_build_object(
        'paymentId',v_existing.id,'purchaseOrderId',p_purchase_order_id,
        'supplierId',v_order.supplier_id,'amount',v_existing.amount,
        'receivedValue',public.sellertray_purchase_order_received_value(p_tenant_id,p_purchase_order_id),
        'paidAmount',(select coalesce(sum(sp.amount),0) from public.supplier_payments sp where sp.tenant_id=p_tenant_id and sp.purchase_order_id=p_purchase_order_id),
        'idempotentReplay',true
      );
    end if;
    raise exception 'This Supplier payment reference was already used with different payment details' using errcode='23505';
  end if;

  v_received:=public.sellertray_purchase_order_received_value(p_tenant_id,p_purchase_order_id);
  select coalesce(sum(sp.amount),0)::numeric(18,2) into v_paid
  from public.supplier_payments sp
  where sp.tenant_id=p_tenant_id and sp.purchase_order_id=p_purchase_order_id;
  v_outstanding:=greatest(v_received-v_paid,0);

  if v_received<=0 then
    raise exception 'No received Purchase value is available for payment' using errcode='23514';
  end if;
  if v_amount>v_outstanding then
    raise exception 'Supplier payment exceeds the outstanding received Purchase value' using errcode='23514';
  end if;

  insert into public.supplier_payments(
    tenant_id,supplier_id,purchase_order_id,payment_date,amount,currency,method,reference,notes,recorded_by_user_id
  ) values(
    p_tenant_id,v_order.supplier_id,p_purchase_order_id,v_payment_date,v_amount,v_order.currency,
    v_method,v_reference,nullif(btrim(coalesce(p_notes,'')),''),v_user_id
  ) returning id into v_payment_id;

  return jsonb_build_object(
    'paymentId',v_payment_id,'purchaseOrderId',p_purchase_order_id,'supplierId',v_order.supplier_id,
    'amount',v_amount,'receivedValue',v_received,'paidAmount',v_paid+v_amount,
    'outstandingAmount',greatest(v_received-(v_paid+v_amount),0),'idempotentReplay',false
  );
end;
$$;

revoke all on function public.record_sellertray_supplier_payment(uuid,uuid,numeric,text,text,date,text)
  from public,anon;
grant execute on function public.record_sellertray_supplier_payment(uuid,uuid,numeric,text,text,date,text)
  to authenticated;

create or replace function public.get_sellertray_supplier_payment_summary(
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
  v_order public.purchase_orders%rowtype;
  v_received numeric(18,2);
  v_paid numeric(18,2);
  v_payments jsonb;
begin
  if v_user_id is null or not public.sellertray_user_can_manage_purchasing(p_tenant_id,v_user_id) then
    raise exception 'Only business Owners and Managers can view Supplier payment details' using errcode='42501';
  end if;

  select * into v_order
  from public.purchase_orders po
  where po.tenant_id=p_tenant_id and po.id=p_purchase_order_id;
  if not found then raise exception 'Purchase Order not found' using errcode='P0002'; end if;

  v_received:=public.sellertray_purchase_order_received_value(p_tenant_id,p_purchase_order_id);
  select coalesce(sum(sp.amount),0)::numeric(18,2),
         coalesce(jsonb_agg(jsonb_build_object(
           'id',sp.id,'amount',sp.amount,'currency',sp.currency,'method',sp.method,
           'reference',sp.reference,'paymentDate',sp.payment_date,'notes',sp.notes,
           'createdAt',sp.created_at
         ) order by sp.payment_date desc,sp.created_at desc),'[]'::jsonb)
  into v_paid,v_payments
  from public.supplier_payments sp
  where sp.tenant_id=p_tenant_id and sp.purchase_order_id=p_purchase_order_id;

  return jsonb_build_object(
    'purchaseOrderId',p_purchase_order_id,'supplierId',v_order.supplier_id,
    'receivedValue',v_received,'paidAmount',v_paid,
    'outstandingAmount',greatest(v_received-v_paid,0),'payments',coalesce(v_payments,'[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_sellertray_supplier_payment_summary(uuid,uuid) from public,anon;
grant execute on function public.get_sellertray_supplier_payment_summary(uuid,uuid) to authenticated;

create or replace function public.get_sellertray_supplier_balances(p_tenant_id uuid)
returns table(
  supplier_id uuid,
  supplier_name text,
  is_active boolean,
  received_value numeric,
  paid_amount numeric,
  outstanding_amount numeric,
  last_payment_date date
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null or not public.sellertray_user_can_manage_purchasing(p_tenant_id,v_user_id) then
    raise exception 'Only business Owners and Managers can view Supplier balances' using errcode='42501';
  end if;

  return query
  with received as (
    select pr.supplier_id,
           coalesce(sum(pri.source_quantity*pri.unit_cost_snapshot),0)::numeric(18,2) as received_value
    from public.purchase_receipts pr
    join public.purchase_receipt_items pri
      on pri.tenant_id=pr.tenant_id and pri.purchase_receipt_id=pr.id
    where pr.tenant_id=p_tenant_id
    group by pr.supplier_id
  ), paid as (
    select sp.supplier_id,coalesce(sum(sp.amount),0)::numeric(18,2) as paid_amount,max(sp.payment_date) as last_payment_date
    from public.supplier_payments sp
    where sp.tenant_id=p_tenant_id
    group by sp.supplier_id
  )
  select s.id,s.name,s.is_active,
         coalesce(r.received_value,0),coalesce(p.paid_amount,0),
         greatest(coalesce(r.received_value,0)-coalesce(p.paid_amount,0),0)::numeric(18,2),
         p.last_payment_date
  from public.suppliers s
  left join received r on r.supplier_id=s.id
  left join paid p on p.supplier_id=s.id
  where s.tenant_id=p_tenant_id
  order by greatest(coalesce(r.received_value,0)-coalesce(p.paid_amount,0),0) desc,lower(s.name);
end;
$$;

revoke all on function public.get_sellertray_supplier_balances(uuid) from public,anon;
grant execute on function public.get_sellertray_supplier_balances(uuid) to authenticated;

create or replace function public.prevent_supplier_payment_mutation()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if tg_op='DELETE' and not exists(select 1 from public.tenants t where t.id=old.tenant_id) then
    return old;
  end if;
  raise exception 'Supplier payment history is immutable' using errcode='55000';
end;
$$;

revoke all on function public.prevent_supplier_payment_mutation() from public,anon,authenticated;

drop trigger if exists prevent_supplier_payment_update on public.supplier_payments;
create trigger prevent_supplier_payment_update
before update on public.supplier_payments
for each row execute function public.prevent_supplier_payment_mutation();

drop trigger if exists prevent_supplier_payment_delete on public.supplier_payments;
create trigger prevent_supplier_payment_delete
before delete on public.supplier_payments
for each row execute function public.prevent_supplier_payment_mutation();

commit;