begin;

-- Standard platform price resolution remains distinct from tenant-aware price
-- resolution. Lifecycle controls are part of price validity, and merchant
-- overrides preserve the tax treatment of the standard source version.
create or replace function public.resolve_sellertray_commercial_price_version(
  p_price_kind text,
  p_plan_code text,
  p_billing_cycle text,
  p_currency text,
  p_as_of timestamptz
)
returns uuid
language sql
stable
set search_path=''
as $function$
  with candidate as (
    select p.*
    from public.sellertray_commercial_price_versions p
    where p.price_scope='standard'
      and p.tenant_id is null
      and p.price_kind=p_price_kind
      and p.plan_code is not distinct from p_plan_code
      and p.billing_cycle is not distinct from p_billing_cycle
      and p.currency=upper(btrim(p_currency))
      and p.status='published'
      and p.effective_from<=p_as_of
      and (p.effective_until is null or p.effective_until>p_as_of)
      and public.sellertray_commercial_price_version_state(p.id,p_as_of)='active'
    order by p.effective_from desc,p.created_at desc,p.id desc
    limit 1
  ),
  effective_monthly as (
    select p.*
    from public.sellertray_commercial_price_versions p
    where p.price_scope='standard'
      and p.tenant_id is null
      and p.price_kind='subscription'
      and p.plan_code=p_plan_code
      and p.billing_cycle='monthly'
      and p.currency=upper(btrim(p_currency))
      and p.status='published'
      and p.effective_from<=p_as_of
      and (p.effective_until is null or p.effective_until>p_as_of)
      and public.sellertray_commercial_price_version_state(p.id,p_as_of)='active'
    order by p.effective_from desc,p.created_at desc,p.id desc
    limit 1
  )
  select c.id
  from candidate c
  left join effective_monthly m on true
  where c.price_kind<>'subscription'
     or c.billing_cycle<>'yearly'
     or (
       m.id is not null
       and abs(c.gross_amount-(m.gross_amount*10))<0.005
       and (
         (c.net_amount is null and m.net_amount is null and c.tax_rate_percent is null and m.tax_rate_percent is null and c.tax_amount is null and m.tax_amount is null)
         or
         (c.net_amount is not null and m.net_amount is not null and c.tax_rate_percent is not distinct from m.tax_rate_percent and abs(c.net_amount-(m.net_amount*10))<0.005 and abs(c.tax_amount-(m.tax_amount*10))<0.005)
       )
     )
  limit 1;
$function$;

revoke all on function public.resolve_sellertray_commercial_price_version(text,text,text,text,timestamptz)
  from public,anon,authenticated;
grant execute on function public.resolve_sellertray_commercial_price_version(text,text,text,text,timestamptz)
  to service_role;

create or replace function public.validate_sellertray_commercial_price_version()
returns trigger
language plpgsql
set search_path=''
as $function$
declare
  v_monthly public.sellertray_commercial_price_versions%rowtype;
  v_standard public.sellertray_commercial_price_versions%rowtype;
begin
  new.currency:=upper(btrim(new.currency));
  new.change_reason:=btrim(new.change_reason);

  if new.price_scope='merchant_override' then
    select p.* into v_standard
    from public.sellertray_commercial_price_versions p
    where p.id=new.source_standard_price_version_id;

    if not found
       or v_standard.price_scope<>'standard'
       or v_standard.tenant_id is not null
       or v_standard.price_kind<>new.price_kind
       or v_standard.plan_code is distinct from new.plan_code
       or v_standard.billing_cycle is distinct from new.billing_cycle
       or v_standard.currency<>new.currency
       or v_standard.status<>'published'
       or v_standard.effective_from>new.effective_from
       or (v_standard.effective_until is not null and v_standard.effective_until<=new.effective_from) then
      raise exception 'Merchant commercial override must reference the exact standard price version effective at the override start' using errcode='23514';
    end if;

    if public.resolve_sellertray_commercial_price_version(
      new.price_kind,new.plan_code,new.billing_cycle,new.currency,new.effective_from
    ) is distinct from v_standard.id then
      raise exception 'Merchant commercial override source is not the governed standard price effective at the override start' using errcode='23514';
    end if;

    if new.tax_rate_percent is distinct from v_standard.tax_rate_percent
       or (new.net_amount is null) is distinct from (v_standard.net_amount is null)
       or (new.tax_amount is null) is distinct from (v_standard.tax_amount is null) then
      raise exception 'Merchant commercial override must preserve the standard price tax treatment' using errcode='23514';
    end if;
  end if;

  if new.billing_cycle='yearly' then
    select p.* into v_monthly
    from public.sellertray_commercial_price_versions p
    where p.price_kind='subscription'
      and p.plan_code=new.plan_code
      and p.billing_cycle='monthly'
      and p.currency=new.currency
      and p.status='published'
      and p.price_scope=new.price_scope
      and p.tenant_id is not distinct from new.tenant_id
      and p.effective_from<=new.effective_from
      and (p.effective_until is null or p.effective_until>new.effective_from)
    order by p.effective_from desc,p.created_at desc,p.id desc
    limit 1;

    if not found then
      raise exception 'A governed monthly price in the same scope must exist before a yearly 10-for-12 price is published' using errcode='23514';
    end if;
    if abs(new.gross_amount-(v_monthly.gross_amount*10))>=0.005 then
      raise exception 'Yearly SellerTray subscription price must equal 10 monthly periods' using errcode='23514';
    end if;
    if (new.net_amount is null) is distinct from (v_monthly.net_amount is null)
       or (new.tax_amount is null) is distinct from (v_monthly.tax_amount is null)
       or (new.tax_rate_percent is null) is distinct from (v_monthly.tax_rate_percent is null) then
      raise exception 'Yearly SellerTray tax treatment must match the governed monthly price' using errcode='23514';
    end if;
    if v_monthly.net_amount is not null and (
      abs(new.net_amount-(v_monthly.net_amount*10))>=0.005
      or abs(new.tax_amount-(v_monthly.tax_amount*10))>=0.005
      or new.tax_rate_percent is distinct from v_monthly.tax_rate_percent
    ) then
      raise exception 'Yearly SellerTray tax snapshot must preserve the 10-for-12 rule' using errcode='23514';
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function public.validate_sellertray_commercial_price_version()
  from public,anon,authenticated;

commit;
