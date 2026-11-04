begin;
-- C2-6: price snapshot, Branch obligation and add-on assignment integrity.
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

  if v_price.plan_code is not null or v_price.charge_type_code is null then
    v_resolved_price_id:=public.resolve_sellertray_commercial_price_version_for_tenant(
      new.tenant_id,v_price.price_kind,v_price.plan_code,v_price.billing_cycle,v_price.currency,v_order.ordered_at
    );
  else
    v_resolved_price_id:=public.resolve_sellertray_commercial_v2_price_version(
      new.tenant_id,v_price.price_kind,v_price.plan_profile_version_id,v_price.addon_version_id,
      v_price.billing_cycle,v_price.currency,v_order.ordered_at
    );
  end if;

  if v_resolved_price_id is null or v_resolved_price_id<>v_price.id then
    raise exception 'Commercial order must snapshot the governed Business price version effective at the order time' using errcode='23514';
  end if;

  if new.line_type='subscription' then
    if v_price.price_kind<>'subscription' or v_price.plan_code is null then
      raise exception 'Legacy subscription order line requires a legacy subscription price version' using errcode='23514';
    end if;
    select p.name into strict v_plan_name from public.subscription_plans p where p.code=v_price.plan_code;
    new.plan_code:=v_price.plan_code;
    new.addon_version_id:=null;
    new.plan_profile_version_id:=null;
    new.billing_cycle:=v_price.billing_cycle;
    new.branch_id:=null;
    new.quantity:=1;
    if nullif(btrim(new.description_snapshot),'') is null then new.description_snapshot:=v_plan_name; end if;
  elsif new.line_type='branch_subscription' then
    if v_price.price_kind<>'subscription'
       or v_price.plan_code is not null
       or v_price.plan_profile_version_id is null
       or v_price.charge_type_code<>'branch_subscription' then
      raise exception 'Branch subscription order line requires a Commercial V2 Branch subscription price version' using errcode='23514';
    end if;
    if new.branch_id is null then
      raise exception 'Branch subscription order line requires a Branch' using errcode='23514';
    end if;
    select v.display_name into strict v_plan_name
    from public.sellertray_plan_profile_versions v
    where v.id=v_price.plan_profile_version_id;
    new.plan_code:=null;
    new.addon_version_id:=null;
    new.plan_profile_version_id:=v_price.plan_profile_version_id;
    new.billing_cycle:=v_price.billing_cycle;
    new.quantity:=1;
    if nullif(btrim(new.description_snapshot),'') is null then new.description_snapshot:=v_plan_name; end if;
  elsif new.line_type='branch_addon' then
    if v_price.price_kind<>'addon' or v_price.plan_code is not null
       or v_price.plan_profile_version_id is not null
       or v_price.addon_version_id is null or v_price.charge_type_code<>'addon' then
      raise exception 'Branch add-on requires governed add-on price identity' using errcode='23514';
    end if;
    if new.branch_id is null then
      raise exception 'Branch add-on requires a Branch' using errcode='23514';
    end if;
    select av.display_name into v_plan_name
    from public.sellertray_addon_versions av
    join public.sellertray_addon_definitions ad on ad.id=av.addon_definition_id
    where av.id=v_price.addon_version_id and av.status='published'
      and ad.status='active' and av.effective_from<=v_order.ordered_at
      and (av.effective_until is null or av.effective_until>v_order.ordered_at)
      and v_price.billing_cycle=any(av.allowed_billing_cycles);
    if not found then
      raise exception 'Selected add-on must be published, effective and active'
        using errcode='23514';
    end if;
    new.plan_code:=null;
    new.plan_profile_version_id:=null;
    new.addon_version_id:=v_price.addon_version_id;
    new.billing_cycle:=v_price.billing_cycle;
    new.quantity:=1;
    if nullif(btrim(new.description_snapshot),'') is null then
      new.description_snapshot:=v_plan_name;
    end if;
  elsif new.line_type='branch_setup' then
    if v_price.price_kind<>'branch_setup' then
      raise exception 'Branch setup order line requires a branch setup price version' using errcode='23514';
    end if;
    if new.branch_id is null then raise exception 'Branch setup order line requires a Branch' using errcode='23514'; end if;
    new.plan_code:=null;
    new.plan_profile_version_id:=null;
    new.addon_version_id:=null;
    new.billing_cycle:=null;
    new.quantity:=1;
  else
    raise exception 'Unsupported SellerTray commercial order line type' using errcode='23514';
  end if;

  new.charge_type_code:=v_price.charge_type_code;
  new.commercial_tax_profile_version_id:=v_price.commercial_tax_profile_version_id;
  new.price_scope_snapshot:=v_price.price_scope;
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

create or replace function public.prepare_sellertray_commercial_installment_obligation()
returns trigger
language plpgsql
set search_path=''
as $function$
declare
  v_order public.sellertray_commercial_orders%rowtype;
  v_line public.sellertray_commercial_order_price_snapshots%rowtype;
  v_amount numeric(18,2);
begin
  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.id=new.commercial_order_id and o.tenant_id=new.tenant_id;

  new.currency:=v_order.currency;

  if new.obligation_scope='commercial_order' then
    new.commercial_order_line_id:=null;
    new.branch_id:=null;
    new.obligated_amount:=v_order.total_gross_amount;
  elsif new.obligation_scope='branch_subscription' then
    select l.* into strict v_line
    from public.sellertray_commercial_order_price_snapshots l
    where l.tenant_id=new.tenant_id
      and l.commercial_order_id=new.commercial_order_id
      and l.id=new.commercial_order_line_id;
    if v_line.line_type<>'branch_subscription' or v_line.branch_id is distinct from new.branch_id then
      raise exception 'Branch settlement obligation requires its Branch subscription order line' using errcode='23514';
    end if;
    select coalesce(sum(l.gross_amount),0)::numeric(18,2) into v_amount
    from public.sellertray_commercial_order_price_snapshots l
    where l.tenant_id=new.tenant_id
      and l.commercial_order_id=new.commercial_order_id
      and l.branch_id=new.branch_id
      and l.line_type in ('branch_subscription','branch_setup','branch_addon');
    if v_amount<=0 then
      raise exception 'Branch settlement obligation requires a positive governed Branch charge' using errcode='23514';
    end if;
    new.obligated_amount:=v_amount;
  else
    raise exception 'Unsupported SellerTray commercial obligation scope' using errcode='23514';
  end if;
  return new;
end;
$function$;

create or replace function public.validate_sellertray_branch_subscription_addon_insert()
returns trigger
language plpgsql
set search_path=''
as $function$
declare
  v_subscription public.sellertray_branch_subscriptions%rowtype;
  v_line public.sellertray_commercial_order_price_snapshots%rowtype;
begin
  select s.* into strict v_subscription
  from public.sellertray_branch_subscriptions s
  where s.tenant_id=new.tenant_id and s.id=new.branch_subscription_id;

  if new.branch_id<>v_subscription.branch_id then
    raise exception 'Branch add-on assignment must belong to the Branch Subscription Branch' using errcode='23514';
  end if;
  if new.entitlement_from<v_subscription.committed_at then
    raise exception 'Branch add-on entitlement cannot begin before its Branch Subscription commitment' using errcode='23514';
  end if;

  if new.commercial_order_line_id is not null then
    if new.commercial_order_id is null then
      raise exception 'Branch add-on commercial order line requires its commercial order' using errcode='23514';
    end if;
    select l.* into strict v_line
    from public.sellertray_commercial_order_price_snapshots l
    where l.tenant_id=new.tenant_id and l.id=new.commercial_order_line_id;
    if v_line.line_type<>'branch_addon'
       or v_line.addon_version_id is distinct from new.addon_version_id
       or v_line.billing_cycle is distinct from new.billing_cycle then
      raise exception 'Branch add-on entitlement requires its exact priced add-on version and cycle'
        using errcode='23514';
    end if;
    if v_line.commercial_order_id<>new.commercial_order_id then
      raise exception 'Branch add-on commercial order line must belong to its commercial order' using errcode='23514';
    end if;
    if v_line.branch_id is not null and v_line.branch_id<>v_subscription.branch_id then
      raise exception 'Branch add-on commercial order line must belong to the Branch Subscription Branch' using errcode='23514';
    end if;
  end if;

  return new;
end;
$function$;
commit;
