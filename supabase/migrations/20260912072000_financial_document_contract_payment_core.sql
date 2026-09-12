-- SellerTray Build 7: P0 financial document contract + provider-neutral Payment Core.
-- Additive: existing order, WhatsApp, fulfilment, Merchant ID, PDF receipt and release contracts remain intact.

begin;

alter table public.orders
  add column if not exists payment_status text not null default 'unpaid',
  add column if not exists amount_paid numeric(14,2) not null default 0,
  add column if not exists payment_confirmed_at timestamptz;

alter table public.orders
  add constraint orders_payment_status_check
    check (payment_status = any (array['unpaid'::text,'pending'::text,'verification_required'::text,'paid'::text])),
  add constraint orders_amount_paid_check
    check (amount_paid >= 0);

create table public.order_financial_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  order_id uuid not null,
  document_type text not null,
  document_reference text not null unique,
  currency text not null,
  amount numeric(14,2) not null,
  status text not null default 'issued',
  payment_id uuid,
  issued_at timestamptz not null default now(),
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_financial_documents_order_same_tenant
    foreign key (tenant_id, order_id)
    references public.orders(tenant_id, id)
    on delete cascade,
  constraint order_financial_documents_tenant_id_id_key unique (tenant_id, id),
  constraint order_financial_documents_tenant_order_id_id_key unique (tenant_id, order_id, id),
  constraint order_financial_documents_order_type_key unique (order_id, document_type),
  constraint order_financial_documents_type_check
    check (document_type = any (array['invoice'::text,'receipt'::text])),
  constraint order_financial_documents_currency_check
    check (currency ~ '^[A-Z]{3}$'),
  constraint order_financial_documents_amount_check
    check (amount >= 0),
  constraint order_financial_documents_status_check
    check (
      (document_type='invoice' and status = any (array['issued'::text,'void'::text]))
      or (document_type='receipt' and status='issued')
    ),
  constraint order_financial_documents_voided_at_check
    check (
      (status='void' and voided_at is not null)
      or (status<>'void' and voided_at is null)
    )
);

create table public.order_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  order_id uuid not null,
  invoice_document_id uuid not null,
  method_type text not null,
  provider text not null,
  status text not null default 'initiated',
  amount numeric(14,2) not null,
  currency text not null,
  provider_reference text,
  idempotency_key text,
  customer_claimed_at timestamptz,
  confirmed_at timestamptz,
  confirmed_by_user_id uuid references auth.users(id) on delete set null,
  confirmation_source text,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_payments_tenant_id_id_key unique (tenant_id, id),
  constraint order_payments_tenant_order_id_id_key unique (tenant_id, order_id, id),
  constraint order_payments_order_same_tenant
    foreign key (tenant_id, order_id)
    references public.orders(tenant_id, id)
    on delete cascade,
  constraint order_payments_invoice_same_order
    foreign key (tenant_id, order_id, invoice_document_id)
    references public.order_financial_documents(tenant_id, order_id, id)
    on delete restrict,
  constraint order_payments_method_type_check
    check (method_type = any (array[
      'bank_transfer'::text,'paystack'::text,'flutterwave'::text,
      'cash_on_delivery'::text,'pay_on_pickup'::text
    ])),
  constraint order_payments_provider_check
    check (provider ~ '^[a-z0-9][a-z0-9_.:-]{0,63}$'),
  constraint order_payments_status_check
    check (status = any (array[
      'initiated'::text,'pending_verification'::text,'confirmed'::text,
      'failed'::text,'cancelled'::text,'expired'::text
    ])),
  constraint order_payments_amount_check check (amount > 0),
  constraint order_payments_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint order_payments_provider_reference_check
    check (
      provider_reference is null
      or (
        char_length(provider_reference) between 1 and 128
        and provider_reference !~ '/'
        and provider_reference ~ '^[A-Za-z0-9._:-]+$'
      )
    ),
  constraint order_payments_idempotency_key_check
    check (idempotency_key is null or char_length(idempotency_key) between 1 and 128),
  constraint order_payments_confirmation_source_check
    check (
      confirmation_source is null
      or confirmation_source = any (array[
        'staff'::text,'provider_webhook'::text,'provider_verify'::text,'system'::text
      ])
    ),
  constraint order_payments_failure_reason_check
    check (failure_reason is null or char_length(btrim(failure_reason)) between 1 and 500),
  constraint order_payments_confirmation_fields_check
    check (
      (
        status='confirmed'
        and confirmed_at is not null
        and confirmation_source is not null
        and (confirmation_source <> 'staff' or confirmed_by_user_id is not null)
      )
      or
      (
        status<>'confirmed'
        and confirmed_at is null
        and confirmation_source is null
        and confirmed_by_user_id is null
      )
    )
);

alter table public.order_financial_documents
  add constraint order_financial_documents_payment_same_order
  foreign key (tenant_id, order_id, payment_id)
  references public.order_payments(tenant_id, order_id, id)
  on delete restrict,
  add constraint order_financial_documents_payment_contract_check
  check (
    (document_type='invoice' and payment_id is null)
    or (document_type='receipt' and payment_id is not null)
  );

create unique index order_payments_provider_reference_key
  on public.order_payments(tenant_id, provider, provider_reference)
  where provider_reference is not null;

create unique index order_payments_tenant_idempotency_key
  on public.order_payments(tenant_id, idempotency_key)
  where idempotency_key is not null;

create unique index order_payments_one_confirmed_per_order
  on public.order_payments(order_id)
  where status='confirmed';

create index order_payments_order_created_idx
  on public.order_payments(order_id, created_at desc);

alter table public.order_financial_documents enable row level security;
alter table public.order_payments enable row level security;

revoke all on table public.order_financial_documents from public, anon, authenticated;
revoke all on table public.order_payments from public, anon, authenticated;
grant select on table public.order_financial_documents to authenticated;
grant select on table public.order_payments to authenticated;
grant all on table public.order_financial_documents to service_role;
grant all on table public.order_payments to service_role;

create policy order_financial_documents_select_member
on public.order_financial_documents
for select to authenticated
using (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=order_financial_documents.tenant_id
      and tm.user_id=(select auth.uid())
  )
);

create policy order_payments_select_member
on public.order_payments
for select to authenticated
using (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=order_payments.tenant_id
      and tm.user_id=(select auth.uid())
  )
);

create or replace function sellertray_private.assign_financial_document_reference()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order_ref text;
  v_kind text;
begin
  select o.public_order_id into v_order_ref
  from public.orders o
  where o.id=new.order_id and o.tenant_id=new.tenant_id;

  if v_order_ref is null or v_order_ref !~ '^[A-Z0-9]{3}/[0-9]{6,}$' then
    raise exception 'Invalid SellerTray order reference for financial document' using errcode='23514';
  end if;

  v_kind := case new.document_type when 'invoice' then 'INV' when 'receipt' then 'RCP' end;
  if v_kind is null then
    raise exception 'Invalid SellerTray financial document type' using errcode='23514';
  end if;

  new.document_reference :=
    'ST/' || split_part(v_order_ref,'/',1) || '/' || v_kind || '/' || split_part(v_order_ref,'/',2);
  return new;
end;
$$;

revoke all on function sellertray_private.assign_financial_document_reference() from public, anon, authenticated;

create trigger assign_sellertray_financial_document_reference
before insert on public.order_financial_documents
for each row execute function sellertray_private.assign_financial_document_reference();

create or replace function public.guard_sellertray_financial_document()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if new.tenant_id is distinct from old.tenant_id
     or new.order_id is distinct from old.order_id
     or new.document_type is distinct from old.document_type
     or new.document_reference is distinct from old.document_reference
     or new.currency is distinct from old.currency
     or new.amount is distinct from old.amount
     or new.payment_id is distinct from old.payment_id
     or new.issued_at is distinct from old.issued_at
     or new.created_at is distinct from old.created_at then
    raise exception 'SellerTray financial document identity is immutable' using errcode='23514';
  end if;

  if old.document_type='receipt' and new.status is distinct from old.status then
    raise exception 'SellerTray financial receipt is immutable' using errcode='23514';
  end if;

  if old.document_type='invoice' then
    if old.status='void' and new.status is distinct from old.status then
      raise exception 'Voided SellerTray invoice is terminal' using errcode='23514';
    end if;
    if new.status='void' then
      new.voided_at := coalesce(new.voided_at,now());
    elsif new.voided_at is not null then
      raise exception 'Issued SellerTray invoice cannot have void timestamp' using errcode='23514';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.guard_sellertray_financial_document() from public, anon, authenticated;

create trigger guard_sellertray_financial_document
before update on public.order_financial_documents
for each row execute function public.guard_sellertray_financial_document();

create or replace function public.guard_sellertray_payment_projection()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if (
    new.payment_status is distinct from old.payment_status
    or new.amount_paid is distinct from old.amount_paid
    or new.payment_confirmed_at is distinct from old.payment_confirmed_at
  ) and current_user in ('anon','authenticated') then
    raise exception 'SellerTray payment state is server-managed' using errcode='42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_sellertray_payment_projection() from public, anon, authenticated;

create trigger guard_sellertray_payment_projection
before update of payment_status, amount_paid, payment_confirmed_at on public.orders
for each row
when (
  old.payment_status is distinct from new.payment_status
  or old.amount_paid is distinct from new.amount_paid
  or old.payment_confirmed_at is distinct from new.payment_confirmed_at
)
execute function public.guard_sellertray_payment_projection();

create or replace function public.ensure_sellertray_invoice_for_order(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order public.orders%rowtype;
  v_amount numeric(14,2);
  v_document_id uuid;
begin
  select * into v_order from public.orders o where o.id=p_order_id;
  if not found then
    raise exception 'SellerTray order not found' using errcode='22023';
  end if;

  if v_order.status not in ('accepted','processing','ready','completed') then
    return null;
  end if;

  select coalesce(sum(oi.quantity*oi.unit_price),v_order.total_amount,0)::numeric(14,2)
    into v_amount
  from public.order_items oi
  where oi.tenant_id=v_order.tenant_id and oi.order_id=v_order.id;

  insert into public.order_financial_documents (
    tenant_id,order_id,document_type,document_reference,currency,amount,status
  ) values (
    v_order.tenant_id,v_order.id,'invoice','',coalesce(v_order.currency,'NGN'),v_amount,'issued'
  )
  on conflict (order_id,document_type) do nothing
  returning id into v_document_id;

  if v_document_id is null then
    select d.id into v_document_id
    from public.order_financial_documents d
    where d.order_id=v_order.id and d.document_type='invoice';
  end if;

  return v_document_id;
end;
$$;

revoke all on function public.ensure_sellertray_invoice_for_order(uuid) from public, anon, authenticated;
grant execute on function public.ensure_sellertray_invoice_for_order(uuid) to service_role;

create or replace function public.issue_sellertray_invoice_on_acceptance()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.status='accepted' and old.status is distinct from new.status then
    perform public.ensure_sellertray_invoice_for_order(new.id);
  end if;
  return new;
end;
$$;

revoke all on function public.issue_sellertray_invoice_on_acceptance() from public, anon, authenticated;

create trigger issue_sellertray_invoice_on_acceptance
after update of status on public.orders
for each row
when (old.status is distinct from new.status)
execute function public.issue_sellertray_invoice_on_acceptance();

create or replace function public.guard_invoiced_order_items()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_order_id uuid;
begin
  if tg_op='DELETE' then v_order_id := old.order_id; else v_order_id := new.order_id; end if;

  if exists (
    select 1 from public.order_financial_documents d
    where d.order_id=v_order_id and d.document_type='invoice'
  ) then
    raise exception 'SellerTray invoiced order items are financially locked' using errcode='23514';
  end if;

  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;

revoke all on function public.guard_invoiced_order_items() from public, anon, authenticated;

create trigger guard_invoiced_order_items
before insert or update or delete on public.order_items
for each row execute function public.guard_invoiced_order_items();

create or replace function public.guard_sellertray_payment_transition()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_invoice public.order_financial_documents%rowtype;
  v_order_payment_status text;
begin
  select * into v_invoice
  from public.order_financial_documents d
  where d.id=new.invoice_document_id
    and d.tenant_id=new.tenant_id
    and d.order_id=new.order_id
    and d.document_type='invoice';

  if not found then
    raise exception 'SellerTray invoice not found for payment' using errcode='23503';
  end if;

  if v_invoice.status<>'issued' then
    raise exception 'SellerTray invoice is not payable' using errcode='23514';
  end if;

  if new.amount<>v_invoice.amount or new.currency<>v_invoice.currency then
    raise exception 'SellerTray MVP payment must exactly match invoice amount and currency' using errcode='23514';
  end if;

  select o.payment_status into v_order_payment_status
  from public.orders o
  where o.id=new.order_id and o.tenant_id=new.tenant_id;

  if v_order_payment_status='paid' then
    if tg_op='INSERT' or (tg_op='UPDATE' and old.status<>'confirmed') then
      raise exception 'SellerTray order is already paid' using errcode='23514';
    end if;
  end if;

  if tg_op='UPDATE' then
    if new.tenant_id is distinct from old.tenant_id
       or new.order_id is distinct from old.order_id
       or new.invoice_document_id is distinct from old.invoice_document_id
       or new.method_type is distinct from old.method_type
       or new.provider is distinct from old.provider
       or new.amount is distinct from old.amount
       or new.currency is distinct from old.currency
       or new.idempotency_key is distinct from old.idempotency_key
       or new.created_at is distinct from old.created_at then
      raise exception 'SellerTray payment identity is immutable' using errcode='23514';
    end if;

    if old.provider_reference is not null
       and new.provider_reference is distinct from old.provider_reference then
      raise exception 'SellerTray provider reference is immutable once recorded' using errcode='23514';
    end if;

    if old.status in ('confirmed','failed','cancelled','expired')
       and new.status is distinct from old.status then
      raise exception 'SellerTray payment status % is terminal',old.status using errcode='23514';
    end if;

    if new.status is distinct from old.status then
      if old.status='initiated'
         and new.status not in ('pending_verification','confirmed','failed','cancelled','expired') then
        raise exception 'Invalid SellerTray payment transition: % -> %',old.status,new.status using errcode='23514';
      end if;
      if old.status='pending_verification'
         and new.status not in ('confirmed','failed','cancelled','expired') then
        raise exception 'Invalid SellerTray payment transition: % -> %',old.status,new.status using errcode='23514';
      end if;
    end if;
  end if;

  if new.status='confirmed' then
    new.confirmed_at := coalesce(new.confirmed_at,now());
    if new.confirmation_source is null then
      raise exception 'Confirmed SellerTray payment requires confirmation source' using errcode='23514';
    end if;
    if new.confirmation_source='staff' and new.confirmed_by_user_id is null then
      raise exception 'Staff-confirmed SellerTray payment requires staff user' using errcode='23514';
    end if;
  else
    new.confirmed_at := null;
    new.confirmation_source := null;
    new.confirmed_by_user_id := null;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.guard_sellertray_payment_transition() from public, anon, authenticated;

create trigger guard_sellertray_payment_transition
before insert or update on public.order_payments
for each row execute function public.guard_sellertray_payment_transition();

create or replace function public.sync_sellertray_order_payment_state()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order_id uuid;
  v_tenant_id uuid;
  v_amount_paid numeric(14,2);
  v_confirmed_at timestamptz;
  v_payment_status text;
  v_confirmed_payment_id uuid;
  v_invoice public.order_financial_documents%rowtype;
begin
  if tg_op='DELETE' then
    v_order_id := old.order_id;
    v_tenant_id := old.tenant_id;
  else
    v_order_id := new.order_id;
    v_tenant_id := new.tenant_id;
  end if;

  select
    coalesce(sum(p.amount) filter (where p.status='confirmed'),0)::numeric(14,2),
    max(p.confirmed_at) filter (where p.status='confirmed'),
    case
      when bool_or(p.status='confirmed') then 'paid'
      when bool_or(p.status='pending_verification') then 'verification_required'
      when bool_or(p.status='initiated') then 'pending'
      else 'unpaid'
    end
  into v_amount_paid,v_confirmed_at,v_payment_status
  from public.order_payments p
  where p.tenant_id=v_tenant_id and p.order_id=v_order_id;

  select p.id into v_confirmed_payment_id
  from public.order_payments p
  where p.tenant_id=v_tenant_id and p.order_id=v_order_id and p.status='confirmed'
  order by p.confirmed_at,p.id
  limit 1;

  update public.orders
  set payment_status=coalesce(v_payment_status,'unpaid'),
      amount_paid=coalesce(v_amount_paid,0),
      payment_confirmed_at=v_confirmed_at,
      updated_at=now()
  where id=v_order_id and tenant_id=v_tenant_id;

  if v_payment_status='paid' then
    select * into v_invoice
    from public.order_financial_documents d
    where d.tenant_id=v_tenant_id
      and d.order_id=v_order_id
      and d.document_type='invoice'
      and d.status='issued';

    if not found then
      raise exception 'Paid SellerTray order is missing issued invoice' using errcode='23514';
    end if;

    insert into public.order_financial_documents (
      tenant_id,order_id,document_type,document_reference,currency,amount,status,payment_id
    ) values (
      v_tenant_id,v_order_id,'receipt','',v_invoice.currency,v_invoice.amount,'issued',v_confirmed_payment_id
    )
    on conflict (order_id,document_type) do nothing;
  end if;

  return null;
end;
$$;

revoke all on function public.sync_sellertray_order_payment_state() from public, anon, authenticated;

create trigger sync_sellertray_order_payment_state
after insert or update or delete on public.order_payments
for each row execute function public.sync_sellertray_order_payment_state();

create or replace function public.create_sellertray_order_payment(
  p_tenant_id uuid,
  p_order_id uuid,
  p_method_type text,
  p_provider text,
  p_status text default 'initiated',
  p_provider_reference text default null,
  p_idempotency_key text default null,
  p_customer_claimed_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_invoice public.order_financial_documents%rowtype;
  v_payment_id uuid;
  v_existing public.order_payments%rowtype;
  v_idempotency_key text := nullif(btrim(p_idempotency_key),'');
  v_provider_reference text := nullif(btrim(p_provider_reference),'');
begin
  if p_status not in ('initiated','pending_verification') then
    raise exception 'New SellerTray payment must start as initiated or pending verification' using errcode='22023';
  end if;

  if v_idempotency_key is not null then
    select * into v_existing
    from public.order_payments p
    where p.tenant_id=p_tenant_id and p.idempotency_key=v_idempotency_key;

    if found then
      if v_existing.order_id<>p_order_id
         or v_existing.method_type<>p_method_type
         or v_existing.provider<>p_provider then
        raise exception 'SellerTray payment idempotency key conflicts with another payment' using errcode='23505';
      end if;
      return v_existing.id;
    end if;
  end if;

  if exists (
    select 1 from public.orders o
    where o.id=p_order_id and o.tenant_id=p_tenant_id and o.payment_status='paid'
  ) then
    raise exception 'SellerTray order is already paid' using errcode='23514';
  end if;

  select * into v_invoice
  from public.order_financial_documents d
  where d.tenant_id=p_tenant_id
    and d.order_id=p_order_id
    and d.document_type='invoice'
    and d.status='issued';

  if not found then
    raise exception 'SellerTray order has no payable invoice' using errcode='23514';
  end if;

  if v_invoice.amount<=0 then
    raise exception 'SellerTray zero-value invoice does not require payment' using errcode='23514';
  end if;

  insert into public.order_payments (
    tenant_id,order_id,invoice_document_id,method_type,provider,status,
    amount,currency,provider_reference,idempotency_key,customer_claimed_at
  ) values (
    p_tenant_id,p_order_id,v_invoice.id,p_method_type,p_provider,p_status,
    v_invoice.amount,v_invoice.currency,v_provider_reference,v_idempotency_key,
    case when p_status='pending_verification' then coalesce(p_customer_claimed_at,now())
         else p_customer_claimed_at end
  )
  returning id into v_payment_id;

  return v_payment_id;
end;
$$;

revoke all on function public.create_sellertray_order_payment(uuid,uuid,text,text,text,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.create_sellertray_order_payment(uuid,uuid,text,text,text,text,text,timestamptz) to service_role;

create or replace function public.transition_sellertray_order_payment(
  p_payment_id uuid,
  p_status text,
  p_confirmation_source text default null,
  p_confirmed_by_user_id uuid default null,
  p_provider_reference text default null,
  p_failure_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_payment public.order_payments%rowtype;
begin
  select * into v_payment from public.order_payments p where p.id=p_payment_id;
  if not found then
    raise exception 'SellerTray payment not found' using errcode='22023';
  end if;

  if p_status='confirmed' and p_confirmation_source='staff' then
    if p_confirmed_by_user_id is null or not exists (
      select 1 from public.tenant_members tm
      where tm.tenant_id=v_payment.tenant_id and tm.user_id=p_confirmed_by_user_id
    ) then
      raise exception 'SellerTray staff payment confirmation requires a tenant member' using errcode='42501';
    end if;
  end if;

  update public.order_payments
  set status=p_status,
      confirmation_source=case when p_status='confirmed' then p_confirmation_source else null end,
      confirmed_by_user_id=case when p_status='confirmed' then p_confirmed_by_user_id else null end,
      confirmed_at=case when p_status='confirmed' then now() else null end,
      provider_reference=coalesce(provider_reference,nullif(btrim(p_provider_reference),'')),
      failure_reason=case
        when p_status in ('failed','cancelled','expired') then nullif(btrim(p_failure_reason),'')
        else null end,
      updated_at=now()
  where id=p_payment_id;

  return p_payment_id;
end;
$$;

revoke all on function public.transition_sellertray_order_payment(uuid,text,text,uuid,text,text) from public, anon, authenticated;
grant execute on function public.transition_sellertray_order_payment(uuid,text,text,uuid,text,text) to service_role;

create or replace function public.void_sellertray_invoice_on_cancellation()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.status='cancelled' and old.status is distinct from new.status then
    update public.order_payments
    set status='cancelled',
        failure_reason=coalesce(failure_reason,'Order cancelled'),
        updated_at=now()
    where tenant_id=new.tenant_id
      and order_id=new.id
      and status in ('initiated','pending_verification');

    update public.order_financial_documents
    set status='void',voided_at=now(),updated_at=now()
    where tenant_id=new.tenant_id
      and order_id=new.id
      and document_type='invoice'
      and status='issued';
  end if;
  return new;
end;
$$;

revoke all on function public.void_sellertray_invoice_on_cancellation() from public, anon, authenticated;

create trigger void_sellertray_invoice_on_cancellation
after update of status on public.orders
for each row
when (old.status is distinct from new.status)
execute function public.void_sellertray_invoice_on_cancellation();

create or replace function public.guard_order_status_transition()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if new.status=old.status then return new; end if;

  if old.status in ('completed','rejected','cancelled') then
    raise exception 'Order status % is terminal',old.status using errcode='23514';
  end if;

  if new.status='accepted' then
    if old.status not in ('draft','needs_review') then
      raise exception 'Order cannot move from % to accepted',old.status using errcode='23514';
    end if;
    if not exists (
      select 1 from public.order_items oi
      where oi.tenant_id=new.tenant_id and oi.order_id=new.id
    ) then
      raise exception 'Order must contain at least one item before acceptance' using errcode='23514';
    end if;
    if exists (
      select 1 from public.order_items oi
      where oi.tenant_id=new.tenant_id and oi.order_id=new.id and oi.unit_price is null
    ) then
      raise exception 'All order items must be priced before acceptance' using errcode='23514';
    end if;
    return new;
  end if;

  if new.status='rejected' and old.status in ('draft','needs_review') then return new; end if;
  if new.status='processing' and old.status='accepted' then return new; end if;
  if new.status='ready' and old.status='processing' then return new; end if;
  if new.status='completed' and old.status='ready' then return new; end if;

  if new.status='cancelled' and old.status in ('accepted','processing','ready') then
    if old.payment_status='paid' or new.payment_status='paid' then
      raise exception 'Paid SellerTray orders cannot be cancelled until refund support is available' using errcode='23514';
    end if;
    return new;
  end if;

  raise exception 'Invalid order status transition: % -> %',old.status,new.status using errcode='23514';
end;
$$;

do $$
declare r record;
begin
  for r in
    select o.id from public.orders o
    where o.status in ('accepted','processing','ready','completed')
    order by o.created_at,o.id
  loop
    perform public.ensure_sellertray_invoice_for_order(r.id);
  end loop;
end $$;

commit;