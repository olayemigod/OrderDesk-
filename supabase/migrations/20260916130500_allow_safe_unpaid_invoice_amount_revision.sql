create or replace function public.guard_sellertray_financial_document()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_allow_amount_revision boolean := false;
begin
  if new.amount is distinct from old.amount
     and old.document_type='invoice'
     and old.status='issued'
     and new.status='issued' then
    select exists (
      select 1
      from public.orders o
      where o.id=old.order_id
        and o.tenant_id=old.tenant_id
        and o.status='accepted'
        and o.payment_status in ('unpaid','pending')
        and coalesce(o.amount_paid,0)=0
        and o.fulfillment_status='unassigned'
        and not exists (
          select 1
          from public.order_payments p
          where p.order_id=o.id
            and p.tenant_id=o.tenant_id
            and p.status in ('pending_verification','confirmed')
        )
    )
    into v_allow_amount_revision;
  end if;

  if new.tenant_id is distinct from old.tenant_id
     or new.order_id is distinct from old.order_id
     or new.document_type is distinct from old.document_type
     or new.document_reference is distinct from old.document_reference
     or new.currency is distinct from old.currency
     or (new.amount is distinct from old.amount and not v_allow_amount_revision)
     or new.payment_id is distinct from old.payment_id
     or new.issued_at is distinct from old.issued_at
     or new.created_at is distinct from old.created_at then
    raise exception 'SellerTray financial document identity is immutable'
      using errcode='23514';
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
$function$;
