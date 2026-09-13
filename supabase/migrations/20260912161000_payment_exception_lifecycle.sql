-- SellerTray Phase 1 hardening: preserve original payment confirmation
-- while separately tracking refunds, disputes, reversals and duplicate value.

alter table public.order_payments
  add column if not exists exception_state text not null default 'none',
  add column if not exists exception_reason text,
  add column if not exists exception_provider_ref text,
  add column if not exists exception_updated_at timestamptz;

alter table public.order_payments
  drop constraint if exists order_payments_exception_state_check,
  add constraint order_payments_exception_state_check
    check (exception_state in (
      'none','refund_pending','refunded','disputed',
      'chargeback','reversed','duplicate_payment'
    )),
  drop constraint if exists order_payments_exception_reason_check,
  add constraint order_payments_exception_reason_check
    check (exception_reason is null or char_length(exception_reason) <= 500),
  drop constraint if exists order_payments_exception_provider_ref_check,
  add constraint order_payments_exception_provider_ref_check
    check (exception_provider_ref is null or char_length(exception_provider_ref) <= 160);

alter table public.orders
  drop constraint if exists orders_payment_status_check,
  add constraint orders_payment_status_check
    check (payment_status in (
      'unpaid','pending','verification_required','paid','payment_issue'
    ));

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

  if v_order_payment_status in ('paid','payment_issue') then
    if tg_op='INSERT' then
      raise exception 'SellerTray order already has settled or exceptional payment value' using errcode='23514';
    end if;
    if tg_op='UPDATE'
       and old.status<>'confirmed'
       and new.status not in ('cancelled','expired') then
      raise exception 'SellerTray order already has settled or exceptional payment value' using errcode='23514';
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
    coalesce(sum(p.amount) filter (
      where p.status='confirmed' and p.exception_state='none'
    ),0)::numeric(14,2),
    max(p.confirmed_at) filter (
      where p.status='confirmed' and p.exception_state='none'
    ),
    case
      when bool_or(p.exception_state<>'none') then 'payment_issue'
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
  where p.tenant_id=v_tenant_id
    and p.order_id=v_order_id
    and p.status='confirmed'
    and p.exception_state='none'
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

create or replace function public.apply_sellertray_payment_exception(
  p_payment_id uuid,
  p_state text,
  p_provider_event_ref text default null,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_payment public.order_payments%rowtype;
begin
  if p_state not in (
    'none','refund_pending','refunded','disputed',
    'chargeback','reversed','duplicate_payment'
  ) then
    raise exception 'Unsupported SellerTray payment exception state' using errcode='22023';
  end if;

  select * into v_payment
  from public.order_payments p
  where p.id=p_payment_id
  for update;

  if not found then
    raise exception 'SellerTray payment not found' using errcode='22023';
  end if;

  if p_state not in ('none','duplicate_payment') and v_payment.status<>'confirmed' then
    raise exception 'Only a confirmed payment can enter this financial exception state'
      using errcode='23514';
  end if;

  if p_state='duplicate_payment' and v_payment.status='confirmed' then
    raise exception 'A primary confirmed payment cannot be labelled duplicate'
      using errcode='23514';
  end if;

  update public.order_payments
  set exception_state=p_state,
      exception_reason=case when p_state='none' then null else left(nullif(btrim(coalesce(p_reason,'')),''),500) end,
      exception_provider_ref=case when p_state='none' then null else left(nullif(btrim(coalesce(p_provider_event_ref,'')),''),160) end,
      exception_updated_at=now(),
      updated_at=now()
  where id=p_payment_id;
end;
$$;

revoke all on function public.apply_sellertray_payment_exception(uuid,text,text,text)
  from public,anon,authenticated;
grant execute on function public.apply_sellertray_payment_exception(uuid,text,text,text)
  to service_role;

create or replace function public.cancel_sellertray_competing_payment_attempts()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.status='confirmed'
     and (tg_op='INSERT' or old.status is distinct from new.status) then
    update public.order_payments p
    set status='cancelled',
        failure_reason='Superseded by confirmed payment ' || new.id::text,
        updated_at=now()
    where p.tenant_id=new.tenant_id
      and p.order_id=new.order_id
      and p.id<>new.id
      and p.status in ('initiated','pending_verification');
  end if;
  return null;
end;
$$;

revoke all on function public.cancel_sellertray_competing_payment_attempts()
  from public,anon,authenticated;

drop trigger if exists zy_cancel_sellertray_competing_payment_attempts on public.order_payments;
create trigger zy_cancel_sellertray_competing_payment_attempts
after insert or update of status on public.order_payments
for each row
execute function public.cancel_sellertray_competing_payment_attempts();
