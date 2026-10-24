begin;

-- Keep the C1 deferred amount/schedule validators safe when the same trigger
-- function is attached to both a parent table and its child rows. PL/pgSQL NEW
-- is a record, so field selection must be table-aware.

create or replace function public.validate_sellertray_commercial_order_amounts()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_order_id uuid;
  v_tenant_id uuid;
  v_expected numeric(18,2);
  v_actual numeric(18,2);
  v_count integer;
begin
  if tg_table_name='sellertray_commercial_orders' then
    v_order_id := new.id;
    v_tenant_id := new.tenant_id;
  elsif tg_table_name='sellertray_commercial_order_price_snapshots' then
    v_order_id := new.commercial_order_id;
    v_tenant_id := new.tenant_id;
  else
    raise exception 'Unexpected SellerTray commercial amount trigger table: %',tg_table_name
      using errcode='55000';
  end if;

  select o.total_gross_amount
    into v_expected
  from public.sellertray_commercial_orders o
  where o.id=v_order_id and o.tenant_id=v_tenant_id;

  if v_expected is null then
    return new;
  end if;

  select count(*)::integer,coalesce(sum(s.gross_amount),0)::numeric(18,2)
    into v_count,v_actual
  from public.sellertray_commercial_order_price_snapshots s
  where s.commercial_order_id=v_order_id and s.tenant_id=v_tenant_id;

  if v_count=0 or abs(v_expected-v_actual) >= 0.005 then
    raise exception 'SellerTray commercial order total must equal immutable price snapshots'
      using errcode='23514';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_sellertray_commercial_order_amounts()
  from public,anon,authenticated;

create or replace function public.validate_sellertray_commercial_installment_schedule()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_obligation_id uuid;
  v_tenant_id uuid;
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_count integer;
  v_percent numeric;
  v_amount numeric;
  v_first numeric;
  v_second numeric;
  v_third numeric;
begin
  if tg_table_name='sellertray_commercial_installment_obligations' then
    v_obligation_id := new.id;
    v_tenant_id := new.tenant_id;
  elsif tg_table_name='sellertray_commercial_installment_schedule' then
    v_obligation_id := new.installment_obligation_id;
    v_tenant_id := new.tenant_id;
  else
    raise exception 'Unexpected SellerTray installment trigger table: %',tg_table_name
      using errcode='55000';
  end if;

  select o.* into v_obligation
  from public.sellertray_commercial_installment_obligations o
  where o.id=v_obligation_id and o.tenant_id=v_tenant_id;

  if not found then
    return new;
  end if;

  select count(*)::integer,
         coalesce(sum(s.percentage),0),
         coalesce(sum(s.amount_due),0),
         max(s.amount_due) filter (where s.sequence_no=1),
         max(s.amount_due) filter (where s.sequence_no=2),
         max(s.amount_due) filter (where s.sequence_no=3)
    into v_count,v_percent,v_amount,v_first,v_second,v_third
  from public.sellertray_commercial_installment_schedule s
  where s.installment_obligation_id=v_obligation.id
    and s.tenant_id=v_obligation.tenant_id;

  if abs(v_percent-100) >= 0.0001 or abs(v_amount-v_obligation.obligated_amount) >= 0.005 then
    raise exception 'SellerTray installment schedule must reconcile to 100 percent and the commercial obligation'
      using errcode='23514';
  end if;

  if v_obligation.structure_code='two_installment_70_30' then
    if v_count<>2
       or not exists (
         select 1 from public.sellertray_commercial_installment_schedule s
         where s.installment_obligation_id=v_obligation.id and s.sequence_no=1 and s.percentage=70
       )
       or not exists (
         select 1 from public.sellertray_commercial_installment_schedule s
         where s.installment_obligation_id=v_obligation.id and s.sequence_no=2 and s.percentage=30
       )
       or abs(v_first-round((v_obligation.obligated_amount*0.70)::numeric,2)) >= 0.005
       or abs(v_second-(v_obligation.obligated_amount-v_first)) >= 0.005 then
      raise exception 'SellerTray two-installment schedule must preserve the approved 70:30 structure'
        using errcode='23514';
    end if;
  elsif v_obligation.structure_code='three_installment_60_20_20' then
    if v_count<>3
       or not exists (
         select 1 from public.sellertray_commercial_installment_schedule s
         where s.installment_obligation_id=v_obligation.id and s.sequence_no=1 and s.percentage=60
       )
       or not exists (
         select 1 from public.sellertray_commercial_installment_schedule s
         where s.installment_obligation_id=v_obligation.id and s.sequence_no=2 and s.percentage=20
       )
       or not exists (
         select 1 from public.sellertray_commercial_installment_schedule s
         where s.installment_obligation_id=v_obligation.id and s.sequence_no=3 and s.percentage=20
       )
       or abs(v_first-round((v_obligation.obligated_amount*0.60)::numeric,2)) >= 0.005
       or abs(v_second-round((v_obligation.obligated_amount*0.20)::numeric,2)) >= 0.005
       or abs(v_third-(v_obligation.obligated_amount-v_first-v_second)) >= 0.005 then
      raise exception 'SellerTray three-installment schedule must preserve the approved 60:20:20 structure'
        using errcode='23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.validate_sellertray_commercial_installment_schedule()
  from public,anon,authenticated;

commit;
