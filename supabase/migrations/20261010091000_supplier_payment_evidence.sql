begin;

create table public.sellertray_supplier_payments (
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

create unique index sellertray_supplier_payments_reference_unique
  on public.sellertray_supplier_payments(tenant_id,lower(btrim(reference)));
create index sellertray_supplier_payments_order_paid_idx
  on public.sellertray_supplier_payments(tenant_id,purchase_order_id,paid_at desc,id);
create index sellertray_supplier_payments_supplier_paid_idx
  on public.sellertray_supplier_payments(tenant_id,supplier_id,paid_at desc,id);

create table public.sellertray_supplier_payment_reversals (
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

create index sellertray_supplier_payment_reversals_order_idx
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

revoke all on function public.prevent_sellertray_supplier_payment_mutation()
  from public,anon,authenticated;

drop trigger if exists prevent_sellertray_supplier_payment_mutation
  on public.sellertray_supplier_payments;
create trigger prevent_sellertray_supplier_payment_mutation
before update or delete on public.sellertray_supplier_payments
for each row execute function public.prevent_sellertray_supplier_payment_mutation();

drop trigger if exists prevent_sellertray_supplier_payment_reversal_mutation
  on public.sellertray_supplier_payment_reversals;
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

revoke all on function public.sellertray_purchase_paid_amount(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.sellertray_purchase_paid_amount(uuid,uuid)
  to service_role;

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
       or v_existing.currency<>v_po.currency then
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
    v_paid_at,nullif(btrim(coalesce(p_notes,'')),''),v_user_id,now()
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

revoke all on function public.record_sellertray_supplier_payment(uuid,uuid,text,text,numeric,timestamptz,text)
  from public,anon;
grant execute on function public.record_sellertray_supplier_payment(uuid,uuid,text,text,numeric,timestamptz,text)
  to authenticated;

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

revoke all on function public.reverse_sellertray_supplier_payment(uuid,uuid,text)
  from public,anon;
grant execute on function public.reverse_sellertray_supplier_payment(uuid,uuid,text)
  to authenticated;

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

revoke all on function public.get_sellertray_purchase_payment_summary(uuid,uuid)
  from public,anon;
grant execute on function public.get_sellertray_purchase_payment_summary(uuid,uuid)
  to authenticated;

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
  order by outstanding_amount desc,s.name,s.id;
end;
$$;

revoke all on function public.get_sellertray_supplier_outstanding_summary(uuid)
  from public,anon;
grant execute on function public.get_sellertray_supplier_outstanding_summary(uuid)
  to authenticated;

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

revoke all on function public.guard_sellertray_purchase_cancellation_with_payment()
  from public,anon,authenticated;

drop trigger if exists guard_sellertray_purchase_cancellation_with_payment
  on public.sellertray_purchase_orders;
create trigger guard_sellertray_purchase_cancellation_with_payment
before update of status on public.sellertray_purchase_orders
for each row execute function public.guard_sellertray_purchase_cancellation_with_payment();

commit;
