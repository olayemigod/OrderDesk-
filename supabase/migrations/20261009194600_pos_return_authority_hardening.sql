-- High-risk POS cash returns require management authority and the order-facing
-- return projection must be derived from immutable return evidence.

create or replace function public.enforce_sellertray_sale_return_authority()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_role text;
begin
  if new.actor_user_id is null then
    raise exception 'SellerTray return requires an accountable operator' using errcode='42501';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=new.tenant_id
    and tm.user_id=new.actor_user_id;

  if v_role not in ('owner','manager') then
    raise exception 'Owner or manager approval is required to return a completed sale'
      using errcode='42501';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_sellertray_sale_return_authority()
  from public,anon,authenticated;

drop trigger if exists enforce_sellertray_sale_return_authority on public.sale_returns;
create trigger enforce_sellertray_sale_return_authority
before insert on public.sale_returns
for each row execute function public.enforce_sellertray_sale_return_authority();

create or replace function public.guard_sellertray_order_return_projection()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_return public.sale_returns%rowtype;
begin
  if new.return_status is not distinct from old.return_status
     and new.returned_amount is not distinct from old.returned_amount
     and new.returned_at is not distinct from old.returned_at then
    return new;
  end if;

  if old.return_status='returned' then
    raise exception 'Returned sale history is immutable' using errcode='55000';
  end if;

  if new.return_status<>'returned'
     or new.returned_amount<=0
     or new.returned_at is null then
    raise exception 'Sale return projection requires completed return evidence' using errcode='23514';
  end if;

  select * into v_return
  from public.sale_returns sr
  where sr.tenant_id=new.tenant_id
    and sr.order_id=new.id
    and sr.status='completed';

  if not found
     or v_return.amount<>new.returned_amount
     or v_return.currency<>new.currency then
    raise exception 'Sale return projection does not match immutable return evidence'
      using errcode='23514';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_sellertray_order_return_projection()
  from public,anon,authenticated;

drop trigger if exists guard_sellertray_order_return_projection on public.orders;
create trigger guard_sellertray_order_return_projection
before update of return_status,returned_amount,returned_at on public.orders
for each row execute function public.guard_sellertray_order_return_projection();