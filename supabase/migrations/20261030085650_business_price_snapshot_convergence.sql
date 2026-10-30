begin;

-- Commercial order snapshots must accept only the governed price version that
-- resolves for the exact Business at order time. This preserves standard-price
-- fallback while allowing a valid merchant override to supersede it.
create or replace function public.snapshot_sellertray_commercial_order_price()
returns trigger
language plpgsql
set search_path=''
as $function$
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

  if v_price.currency<>v_order.currency then
    raise exception 'Commercial order and price version currency must match' using errcode='23514';
  end if;
  if v_price.price_scope='merchant_override' and v_price.tenant_id<>new.tenant_id then
    raise exception 'Merchant-scoped commercial price belongs to a different Business' using errcode='42501';
  end if;

  v_resolved_price_id:=public.resolve_sellertray_commercial_price_version_for_tenant(
    new.tenant_id,v_price.price_kind,v_price.plan_code,v_price.billing_cycle,v_price.currency,v_order.ordered_at
  );
  if v_resolved_price_id is null or v_resolved_price_id<>v_price.id then
    raise exception 'Commercial order must snapshot the governed Business price version effective at the order time' using errcode='23514';
  end if;

  if new.line_type='subscription' then
    if v_price.price_kind<>'subscription' then
      raise exception 'Subscription order line requires a subscription price version' using errcode='23514';
    end if;
    select p.name into strict v_plan_name from public.subscription_plans p where p.code=v_price.plan_code;
    new.plan_code:=v_price.plan_code;
    new.billing_cycle:=v_price.billing_cycle;
    new.branch_id:=null;
    new.quantity:=1;
    if nullif(btrim(new.description_snapshot),'') is null then new.description_snapshot:=v_plan_name; end if;
  elsif new.line_type='branch_setup' then
    if v_price.price_kind<>'branch_setup' then
      raise exception 'Branch setup order line requires a branch setup price version' using errcode='23514';
    end if;
    if new.branch_id is null then raise exception 'Branch setup order line requires a Branch' using errcode='23514'; end if;
    new.plan_code:=null;
    new.billing_cycle:=null;
    new.quantity:=1;
  else
    raise exception 'Unsupported SellerTray commercial order line type' using errcode='23514';
  end if;

  new.currency:=v_price.currency;
  new.unit_gross_amount:=v_price.gross_amount;
  new.gross_amount:=round((new.quantity*v_price.gross_amount)::numeric,2);
  if v_price.net_amount is null then
    new.net_amount:=null;
    new.tax_rate_percent:=null;
    new.tax_amount:=null;
  else
    new.net_amount:=round((new.quantity*v_price.net_amount)::numeric,2);
    new.tax_rate_percent:=v_price.tax_rate_percent;
    new.tax_amount:=new.gross_amount-new.net_amount;
  end if;
  new.snapshotted_at:=now();
  return new;
end;
$function$;

revoke all on function public.snapshot_sellertray_commercial_order_price()
  from public,anon,authenticated;

commit;
