begin;

-- Tighten C1 relational invariants without changing runtime subscription access.

alter table public.sellertray_commercial_installment_obligations
  add constraint sellertray_commercial_installment_obligations_tenant_order_id_key
  unique (tenant_id,commercial_order_id,id);

alter table public.sellertray_commercial_entitlement_events
  add constraint sellertray_commercial_entitlement_events_obligation_requires_order
  check (installment_obligation_id is null or commercial_order_id is not null),
  add constraint sellertray_commercial_entitlement_events_obligation_same_order
  foreign key (tenant_id,commercial_order_id,installment_obligation_id)
  references public.sellertray_commercial_installment_obligations(tenant_id,commercial_order_id,id)
  on delete restrict;

create or replace function public.prepare_sellertray_commercial_installment_obligation()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_order public.sellertray_commercial_orders%rowtype;
begin
  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.id=new.commercial_order_id and o.tenant_id=new.tenant_id;

  if not exists (
    select 1
    from public.sellertray_commercial_order_price_snapshots s
    where s.tenant_id=new.tenant_id
      and s.commercial_order_id=new.commercial_order_id
      and s.line_type='subscription'
      and s.billing_cycle='yearly'
  ) then
    raise exception 'SellerTray installments require a governed annual subscription purchase'
      using errcode='23514';
  end if;

  new.currency := v_order.currency;
  new.obligated_amount := v_order.total_gross_amount;
  return new;
end;
$$;

revoke all on function public.prepare_sellertray_commercial_installment_obligation()
  from public,anon,authenticated;

commit;
