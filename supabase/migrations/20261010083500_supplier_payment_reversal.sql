begin;

create table public.supplier_payment_reversals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  supplier_payment_id uuid not null,
  supplier_id uuid not null,
  purchase_order_id uuid not null,
  amount numeric(18,2) not null check (amount>0),
  reason text not null check (nullif(btrim(reason),'') is not null),
  reversed_by_user_id uuid references auth.users(id) on delete set null,
  reversed_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,supplier_payment_id),
  constraint supplier_payment_reversals_payment_same_tenant
    foreign key (tenant_id,supplier_payment_id)
    references public.supplier_payments(tenant_id,id)
    on delete cascade,
  constraint supplier_payment_reversals_supplier_same_tenant
    foreign key (tenant_id,supplier_id)
    references public.suppliers(tenant_id,id)
    on delete cascade,
  constraint supplier_payment_reversals_order_same_tenant
    foreign key (tenant_id,purchase_order_id)
    references public.purchase_orders(tenant_id,id)
    on delete cascade
);

create index supplier_payment_reversals_order_idx
  on public.supplier_payment_reversals(tenant_id,purchase_order_id,reversed_at desc);

alter table public.supplier_payment_reversals enable row level security;
revoke all on table public.supplier_payment_reversals from public,anon,authenticated;
grant all on table public.supplier_payment_reversals to service_role;

create or replace function public.sellertray_supplier_paid_amount(
  p_tenant_id uuid,
  p_purchase_order_id uuid
)
returns numeric
language sql
stable
security definer
set search_path=''
as $$
  select greatest(
    coalesce((
      select sum(sp.amount)
      from public.supplier_payments sp
      where sp.tenant_id=p_tenant_id and sp.purchase_order_id=p_purchase_order_id
    ),0)
    - coalesce((
      select sum(spr.amount)
      from public.supplier_payment_reversals spr
      where spr.tenant_id=p_tenant_id and spr.purchase_order_id=p_purchase_order_id
    ),0),
    0
  )::numeric(18,2);
$$;

revoke all on function public.sellertray_supplier_paid_amount(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.sellertray_supplier_paid_amount(uuid,uuid)
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
  v_reversed boolean;
begin
  if v_user_id is null or not public.sellertray_user_can_manage_purchasing(p_tenant_id,v_user_id) then
    raise exception 'Only business Owners and Managers can record Supplier payments' using errcode='42501';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;
  if v_amount<=0 then raise exception 'Supplier payment amount must be greater than zero' using errcode='22023'; end if;
  if v_payment_date>current_date then raise exception 'Supplier payment date cannot be in the future' using errcode='22023'; end if;
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
      v_received:=public.sellertray_purchase_order_received_value(p_tenant_id,p_purchase_order_id);
      v_paid:=public.sellertray_supplier_paid_amount(p_tenant_id,p_purchase_order_id);
      select exists(
        select 1 from public.supplier_payment_reversals spr
        where spr.tenant_id=p_tenant_id and spr.supplier_payment_id=v_existing.id
      ) into v_reversed;
      return jsonb_build_object(
        'paymentId',v_existing.id,'purchaseOrderId',p_purchase_order_id,
        'supplierId',v_order.supplier_id,'amount',v_existing.amount,
        'receivedValue',v_received,'paidAmount',v_paid,
        'outstandingAmount',greatest(v_received-v_paid,0),
        'reversed',v_reversed,'idempotentReplay',true
      );
    end if;
    raise exception 'This Supplier payment reference was already used with different payment details' using errcode='23505';
  end if;

  v_received:=public.sellertray_purchase_order_received_value(p_tenant_id,p_purchase_order_id);
  v_paid:=public.sellertray_supplier_paid_amount(p_tenant_id,p_purchase_order_id);
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
    'outstandingAmount',greatest(v_received-(v_paid+v_amount),0),
    'reversed',false,'idempotentReplay',false
  );
end;
$$;

create or replace function public.reverse_sellertray_supplier_payment(
  p_tenant_id uuid,
  p_supplier_payment_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_payment public.supplier_payments%rowtype;
  v_existing public.supplier_payment_reversals%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason,'')),'');
  v_reversal_id uuid;
  v_received numeric(18,2);
  v_paid numeric(18,2);
begin
  if v_user_id is null or not public.sellertray_user_can_manage_purchasing(p_tenant_id,v_user_id) then
    raise exception 'Only business Owners and Managers can reverse Supplier payments' using errcode='42501';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;
  if v_reason is null or char_length(v_reason)>500 then
    raise exception 'A reversal reason is required and must be 500 characters or fewer' using errcode='22023';
  end if;

  select * into v_payment
  from public.supplier_payments sp
  where sp.tenant_id=p_tenant_id and sp.id=p_supplier_payment_id
  for update;
  if not found then raise exception 'Supplier payment not found' using errcode='P0002'; end if;

  select * into v_existing
  from public.supplier_payment_reversals spr
  where spr.tenant_id=p_tenant_id and spr.supplier_payment_id=p_supplier_payment_id;
  if found then
    if v_existing.reason=v_reason then
      v_received:=public.sellertray_purchase_order_received_value(p_tenant_id,v_payment.purchase_order_id);
      v_paid:=public.sellertray_supplier_paid_amount(p_tenant_id,v_payment.purchase_order_id);
      return jsonb_build_object(
        'reversalId',v_existing.id,'paymentId',p_supplier_payment_id,
        'purchaseOrderId',v_payment.purchase_order_id,'receivedValue',v_received,
        'paidAmount',v_paid,'outstandingAmount',greatest(v_received-v_paid,0),
        'idempotentReplay',true
      );
    end if;
    raise exception 'This Supplier payment was already reversed with a different reason' using errcode='23505';
  end if;

  insert into public.supplier_payment_reversals(
    tenant_id,supplier_payment_id,supplier_id,purchase_order_id,amount,reason,reversed_by_user_id
  ) values(
    p_tenant_id,v_payment.id,v_payment.supplier_id,v_payment.purchase_order_id,
    v_payment.amount,v_reason,v_user_id
  ) returning id into v_reversal_id;

  v_received:=public.sellertray_purchase_order_received_value(p_tenant_id,v_payment.purchase_order_id);
  v_paid:=public.sellertray_supplier_paid_amount(p_tenant_id,v_payment.purchase_order_id);

  return jsonb_build_object(
    'reversalId',v_reversal_id,'paymentId',p_supplier_payment_id,
    'purchaseOrderId',v_payment.purchase_order_id,'receivedValue',v_received,
    'paidAmount',v_paid,'outstandingAmount',greatest(v_received-v_paid,0),
    'idempotentReplay',false
  );
end;
$$;

revoke all on function public.reverse_sellertray_supplier_payment(uuid,uuid,text) from public,anon;
grant execute on function public.reverse_sellertray_supplier_payment(uuid,uuid,text) to authenticated;

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
  v_paid:=public.sellertray_supplier_paid_amount(p_tenant_id,p_purchase_order_id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',sp.id,'amount',sp.amount,'currency',sp.currency,'method',sp.method,
    'reference',sp.reference,'paymentDate',sp.payment_date,'notes',sp.notes,
    'createdAt',sp.created_at,'reversed',spr.id is not null,
    'reversalId',spr.id,'reversalReason',spr.reason,'reversedAt',spr.reversed_at
  ) order by sp.payment_date desc,sp.created_at desc),'[]'::jsonb)
  into v_payments
  from public.supplier_payments sp
  left join public.supplier_payment_reversals spr
    on spr.tenant_id=sp.tenant_id and spr.supplier_payment_id=sp.id
  where sp.tenant_id=p_tenant_id and sp.purchase_order_id=p_purchase_order_id;

  return jsonb_build_object(
    'purchaseOrderId',p_purchase_order_id,'supplierId',v_order.supplier_id,
    'receivedValue',v_received,'paidAmount',v_paid,
    'outstandingAmount',greatest(v_received-v_paid,0),'payments',coalesce(v_payments,'[]'::jsonb)
  );
end;
$$;

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
    select sp.supplier_id,
           (coalesce(sum(sp.amount),0)-coalesce(sum(spr.amount),0))::numeric(18,2) as paid_amount,
           max(sp.payment_date) filter (where spr.id is null) as last_payment_date
    from public.supplier_payments sp
    left join public.supplier_payment_reversals spr
      on spr.tenant_id=sp.tenant_id and spr.supplier_payment_id=sp.id
    where sp.tenant_id=p_tenant_id
    group by sp.supplier_id
  )
  select s.id,s.name,s.is_active,
         coalesce(r.received_value,0),greatest(coalesce(p.paid_amount,0),0)::numeric(18,2),
         greatest(coalesce(r.received_value,0)-greatest(coalesce(p.paid_amount,0),0),0)::numeric(18,2),
         p.last_payment_date
  from public.suppliers s
  left join received r on r.supplier_id=s.id
  left join paid p on p.supplier_id=s.id
  where s.tenant_id=p_tenant_id
  order by greatest(coalesce(r.received_value,0)-greatest(coalesce(p.paid_amount,0),0),0) desc,lower(s.name);
end;
$$;

create or replace function public.prevent_supplier_payment_reversal_mutation()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if tg_op='DELETE' and not exists(select 1 from public.tenants t where t.id=old.tenant_id) then
    return old;
  end if;
  raise exception 'Supplier payment reversal history is immutable' using errcode='55000';
end;
$$;

revoke all on function public.prevent_supplier_payment_reversal_mutation() from public,anon,authenticated;

drop trigger if exists prevent_supplier_payment_reversal_update on public.supplier_payment_reversals;
create trigger prevent_supplier_payment_reversal_update
before update on public.supplier_payment_reversals
for each row execute function public.prevent_supplier_payment_reversal_mutation();

drop trigger if exists prevent_supplier_payment_reversal_delete on public.supplier_payment_reversals;
create trigger prevent_supplier_payment_reversal_delete
before delete on public.supplier_payment_reversals
for each row execute function public.prevent_supplier_payment_reversal_mutation();

commit;