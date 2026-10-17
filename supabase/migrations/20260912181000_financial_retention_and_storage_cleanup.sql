-- SellerTray Phase 1 hardening: retain only the minimum non-chat financial
-- evidence needed for audit/reconciliation when a merchant workspace is deleted.
-- No customer profile, WhatsApp content, delivery address or catalogue content is copied.

create table if not exists sellertray_private.financial_retention_records (
  record_kind text not null,
  source_id uuid not null,
  source_tenant_id uuid not null,
  business_name text not null,
  merchant_code text,
  order_reference text,
  financial_reference text,
  record_subtype text,
  record_status text,
  amount numeric(14,2),
  currency text,
  provider text,
  provider_reference text,
  provider_transaction_id text,
  exception_state text,
  occurred_at timestamptz not null,
  archived_at timestamptz not null default now(),
  retain_until timestamptz not null,
  primary key (record_kind, source_id),
  constraint financial_retention_kind_check
    check (record_kind in ('financial_document','payment')),
  constraint financial_retention_amount_check
    check (amount is null or amount >= 0),
  constraint financial_retention_currency_check
    check (currency is null or currency ~ '^[A-Z]{3}$'),
  constraint financial_retention_period_check
    check (retain_until >= occurred_at)
);

revoke all on table sellertray_private.financial_retention_records
  from public,anon,authenticated;
grant all on table sellertray_private.financial_retention_records
  to service_role;

create index if not exists financial_retention_tenant_idx
  on sellertray_private.financial_retention_records(source_tenant_id,occurred_at desc);

create index if not exists financial_retention_expiry_idx
  on sellertray_private.financial_retention_records(retain_until);

create or replace function public.archive_sellertray_financial_records(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  if p_tenant_id is null then
    raise exception 'Business is required' using errcode='22023';
  end if;

  insert into sellertray_private.financial_retention_records (
    record_kind,source_id,source_tenant_id,business_name,merchant_code,
    order_reference,financial_reference,record_subtype,record_status,
    amount,currency,provider,provider_reference,provider_transaction_id,
    exception_state,occurred_at,archived_at,retain_until
  )
  select
    'financial_document',
    d.id,
    d.tenant_id,
    t.name,
    t.merchant_code,
    o.public_order_id,
    d.document_reference,
    d.document_type,
    d.status,
    d.amount,
    d.currency,
    p.provider,
    p.provider_reference,
    p.provider_transaction_id,
    p.exception_state,
    coalesce(d.issued_at,d.created_at),
    now(),
    coalesce(d.issued_at,d.created_at) + interval '6 years'
  from public.order_financial_documents d
  join public.tenants t on t.id=d.tenant_id
  join public.orders o on o.id=d.order_id and o.tenant_id=d.tenant_id
  left join public.order_payments p on p.id=d.payment_id and p.tenant_id=d.tenant_id
  where d.tenant_id=p_tenant_id
  on conflict (record_kind,source_id) do update
  set record_status=excluded.record_status,
      provider=excluded.provider,
      provider_reference=excluded.provider_reference,
      provider_transaction_id=excluded.provider_transaction_id,
      exception_state=excluded.exception_state,
      archived_at=now(),
      retain_until=greatest(
        sellertray_private.financial_retention_records.retain_until,
        excluded.retain_until
      );

  insert into sellertray_private.financial_retention_records (
    record_kind,source_id,source_tenant_id,business_name,merchant_code,
    order_reference,financial_reference,record_subtype,record_status,
    amount,currency,provider,provider_reference,provider_transaction_id,
    exception_state,occurred_at,archived_at,retain_until
  )
  select
    'payment',
    p.id,
    p.tenant_id,
    t.name,
    t.merchant_code,
    o.public_order_id,
    coalesce(p.provider_reference,p.id::text),
    p.method_type,
    p.status,
    p.amount,
    p.currency,
    p.provider,
    p.provider_reference,
    p.provider_transaction_id,
    p.exception_state,
    coalesce(p.confirmed_at,p.created_at),
    now(),
    coalesce(p.confirmed_at,p.created_at) + interval '6 years'
  from public.order_payments p
  join public.tenants t on t.id=p.tenant_id
  join public.orders o on o.id=p.order_id and o.tenant_id=p.tenant_id
  where p.tenant_id=p_tenant_id
  on conflict (record_kind,source_id) do update
  set record_status=excluded.record_status,
      provider_reference=excluded.provider_reference,
      provider_transaction_id=excluded.provider_transaction_id,
      exception_state=excluded.exception_state,
      archived_at=now(),
      retain_until=greatest(
        sellertray_private.financial_retention_records.retain_until,
        excluded.retain_until
      );
end;
$$;

revoke all on function public.archive_sellertray_financial_records(uuid)
  from public,anon,authenticated;
grant execute on function public.archive_sellertray_financial_records(uuid)
  to service_role;
