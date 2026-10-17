-- SellerTray Phase 1 hardening: preserve Flutterwave's provider/network
-- reference (flw_ref) so chargeback/refund events can be resolved to the
-- correct SellerTray payment even when tx_ref is not present.

alter table public.order_payments
  add column if not exists provider_secondary_reference text;

alter table public.order_payments
  drop constraint if exists order_payments_provider_secondary_reference_check,
  add constraint order_payments_provider_secondary_reference_check
    check (
      provider_secondary_reference is null
      or (
        char_length(provider_secondary_reference) between 1 and 160
        and provider_secondary_reference !~ '[[:space:]]'
      )
    );

create unique index if not exists order_payments_provider_secondary_reference_key
  on public.order_payments(tenant_id,provider,provider_secondary_reference)
  where provider_secondary_reference is not null;

create or replace function public.set_sellertray_payment_secondary_reference(
  p_payment_id uuid,
  p_reference text
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_reference text := nullif(btrim(coalesce(p_reference,'')),'');
  v_existing text;
begin
  if v_reference is null or char_length(v_reference)>160 or v_reference ~ '[[:space:]]' then
    raise exception 'SellerTray provider secondary reference is invalid' using errcode='22023';
  end if;

  select p.provider_secondary_reference into v_existing
  from public.order_payments p
  where p.id=p_payment_id
  for update;

  if not found then
    raise exception 'SellerTray payment not found' using errcode='22023';
  end if;

  if v_existing is not null and v_existing<>v_reference then
    raise exception 'SellerTray provider secondary reference is immutable once recorded'
      using errcode='23514';
  end if;

  update public.order_payments
  set provider_secondary_reference=coalesce(provider_secondary_reference,v_reference),
      updated_at=now()
  where id=p_payment_id;
end;
$$;

revoke all on function public.set_sellertray_payment_secondary_reference(uuid,text)
  from public,anon,authenticated;
grant execute on function public.set_sellertray_payment_secondary_reference(uuid,text)
  to service_role;
