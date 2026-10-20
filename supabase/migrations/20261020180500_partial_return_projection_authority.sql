begin;

-- Partial returns were added after the original order-return projection guard.
-- Keep the projection derived from immutable completed return evidence, but
-- validate the accumulated return amount rather than requiring one full return.
create or replace function public.guard_sellertray_order_return_projection()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_completed_count integer:=0;
  v_completed_amount numeric(18,2):=0;
  v_currency_mismatch boolean:=false;
begin
  if new.return_status is not distinct from old.return_status
     and new.returned_amount is not distinct from old.returned_amount
     and new.returned_at is not distinct from old.returned_at then
    return new;
  end if;

  if old.return_status='returned' then
    raise exception 'Returned sale history is immutable' using errcode='55000';
  end if;

  if new.return_status not in ('partial','returned')
     or new.returned_amount<=0
     or new.returned_at is null then
    raise exception 'Sale return projection requires completed return evidence' using errcode='23514';
  end if;

  select count(*)::integer,
         coalesce(sum(sr.amount),0)::numeric(18,2),
         coalesce(bool_or(sr.currency is distinct from new.currency),false)
  into v_completed_count,v_completed_amount,v_currency_mismatch
  from public.sale_returns sr
  where sr.tenant_id=new.tenant_id
    and sr.order_id=new.id
    and sr.status='completed';

  if v_completed_count<1
     or v_currency_mismatch
     or v_completed_amount<>new.returned_amount then
    raise exception 'Sale return projection does not match immutable return evidence'
      using errcode='23514';
  end if;

  if (new.return_status='partial' and new.returned_amount>=new.total_amount)
     or (new.return_status='returned' and new.returned_amount<>new.total_amount) then
    raise exception 'Sale return projection status does not match returned value'
      using errcode='23514';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_sellertray_order_return_projection()
  from public,anon,authenticated;

commit;
