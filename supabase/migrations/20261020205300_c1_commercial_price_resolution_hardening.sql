begin;

-- C1 commercial price-resolution hardening.
--
-- Price history remains append-only/open-ended. The governed resolver therefore
-- decides which version is current for an as-of timestamp, and order snapshots
-- must use that resolved version rather than any older still-open historical row.
-- A yearly price also remains resolvable only while it preserves the approved
-- 10-for-12 relationship with the effective monthly price at the same as-of time.

alter table public.sellertray_commercial_price_versions
  drop constraint if exists sellertray_commercial_price_versions_subject_check,
  add constraint sellertray_commercial_price_versions_subject_check
    check (
      (
        price_kind='subscription'
        and plan_code is not null
        and billing_cycle is not null
        and billing_cycle in ('monthly','yearly')
      )
      or
      (
        price_kind='branch_setup'
        and plan_code is null
        and billing_cycle is null
      )
    );

alter table public.sellertray_commercial_order_price_snapshots
  drop constraint if exists sellertray_commercial_order_price_snapshots_subject_check,
  add constraint sellertray_commercial_order_price_snapshots_subject_check
    check (
      (
        line_type='subscription'
        and plan_code is not null
        and branch_id is null
        and billing_cycle is not null
        and billing_cycle in ('monthly','yearly')
        and quantity=1
      )
      or
      (
        line_type='branch_setup'
        and plan_code is null
        and branch_id is not null
        and billing_cycle is null
        and quantity=1
      )
    );

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
security invoker
set search_path=''
as $$
  with candidate as (
    select p.*
    from public.sellertray_commercial_price_versions p
    where p.price_kind=p_price_kind
      and p.plan_code is not distinct from p_plan_code
      and p.billing_cycle is not distinct from p_billing_cycle
      and p.currency=upper(btrim(p_currency))
      and p.status='published'
      and p.effective_from <= p_as_of
      and (p.effective_until is null or p.effective_until > p_as_of)
    order by p.effective_from desc,p.created_at desc
    limit 1
  ),
  effective_monthly as (
    select p.*
    from public.sellertray_commercial_price_versions p
    where p.price_kind='subscription'
      and p.plan_code=p_plan_code
      and p.billing_cycle='monthly'
      and p.currency=upper(btrim(p_currency))
      and p.status='published'
      and p.effective_from <= p_as_of
      and (p.effective_until is null or p.effective_until > p_as_of)
    order by p.effective_from desc,p.created_at desc
    limit 1
  )
  select c.id
  from candidate c
  left join effective_monthly m on true
  where
    c.price_kind<>'subscription'
    or c.billing_cycle<>'yearly'
    or (
      m.id is not null
      and abs(c.gross_amount-(m.gross_amount*10)) < 0.005
      and (
        (
          c.net_amount is null
          and m.net_amount is null
          and c.tax_rate_percent is null
          and m.tax_rate_percent is null
          and c.tax_amount is null
          and m.tax_amount is null
        )
        or
        (
          c.net_amount is not null
          and m.net_amount is not null
          and c.tax_rate_percent is not distinct from m.tax_rate_percent
          and abs(c.net_amount-(m.net_amount*10)) < 0.005
          and abs(c.tax_amount-(m.tax_amount*10)) < 0.005
        )
      )
    )
  limit 1;
$$;

revoke all on function public.resolve_sellertray_commercial_price_version(
  text,text,text,text,timestamptz
) from public,anon,authenticated;
grant execute on function public.resolve_sellertray_commercial_price_version(
  text,text,text,text,timestamptz
) to service_role;

create or replace function public.snapshot_sellertray_commercial_order_price()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_order public.sellertray_commercial_orders%rowtype;
  v_price public.sellertray_commercial_price_versions%rowtype;
  v_plan_name text;
  v_resolved_price_id uuid;
begin
  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.id=new.commercial_order_id and o.tenant_id=new.tenant_id;

  select p.* into strict v_price
  from public.sellertray_commercial_price_versions p
  where p.id=new.source_price_version_id;

  if v_price.currency <> v_order.currency then
    raise exception 'Commercial order and price version currency must match' using errcode='23514';
  end if;

  v_resolved_price_id := public.resolve_sellertray_commercial_price_version(
    v_price.price_kind,
    v_price.plan_code,
    v_price.billing_cycle,
    v_price.currency,
    v_order.ordered_at
  );

  if v_resolved_price_id is null or v_resolved_price_id <> v_price.id then
    raise exception 'Commercial order must snapshot the governed price version effective at the order time'
      using errcode='23514';
  end if;

  if new.line_type='subscription' then
    if v_price.price_kind <> 'subscription' then
      raise exception 'Subscription order line requires a subscription price version' using errcode='23514';
    end if;
    select p.name into strict v_plan_name
    from public.subscription_plans p
    where p.code=v_price.plan_code;
    new.plan_code := v_price.plan_code;
    new.billing_cycle := v_price.billing_cycle;
    new.branch_id := null;
    new.quantity := 1;
    if nullif(btrim(new.description_snapshot),'') is null then
      new.description_snapshot := v_plan_name;
    end if;
  elsif new.line_type='branch_setup' then
    if v_price.price_kind <> 'branch_setup' then
      raise exception 'Branch setup order line requires a branch setup price version' using errcode='23514';
    end if;
    if new.branch_id is null then
      raise exception 'Branch setup order line requires a Branch' using errcode='23514';
    end if;
    new.plan_code := null;
    new.billing_cycle := null;
    new.quantity := 1;
  else
    raise exception 'Unsupported SellerTray commercial order line type' using errcode='23514';
  end if;

  new.currency := v_price.currency;
  new.unit_gross_amount := v_price.gross_amount;
  new.gross_amount := round((new.quantity*v_price.gross_amount)::numeric,2);
  if v_price.net_amount is null then
    new.net_amount := null;
    new.tax_rate_percent := null;
    new.tax_amount := null;
  else
    new.net_amount := round((new.quantity*v_price.net_amount)::numeric,2);
    new.tax_rate_percent := v_price.tax_rate_percent;
    new.tax_amount := new.gross_amount-new.net_amount;
  end if;
  new.snapshotted_at := now();
  return new;
end;
$$;

revoke all on function public.snapshot_sellertray_commercial_order_price()
  from public,anon,authenticated;

commit;
