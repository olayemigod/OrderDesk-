begin;

-- SellerTray C1 Commercial Core Foundation
--
-- This slice is deliberately additive. public.tenant_subscriptions remains the
-- runtime subscription/access authority until C2. Commercial obligations,
-- payment confirmation, agreement acceptance and entitlement events remain
-- separate facts. No object in this migration mutates tenant_subscriptions.
--
-- Existing public.subscription_plans remains the legacy plan identity bridge so
-- C1 does not create a second plan/subscription authority. Effective commercial
-- prices, immutable order snapshots, installment obligations/schedules and
-- append-only entitlement events are introduced alongside it.

create table public.sellertray_commercial_price_versions (
  id uuid primary key default gen_random_uuid(),
  price_kind text not null,
  plan_code text references public.subscription_plans(code) on delete restrict,
  billing_cycle text,
  currency text not null,
  gross_amount numeric(18,2) not null,
  tax_inclusive boolean not null default true,
  net_amount numeric(18,2),
  tax_rate_percent numeric(9,6),
  tax_amount numeric(18,2),
  effective_from timestamptz not null,
  effective_until timestamptz,
  status text not null default 'published',
  change_reason text not null,
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  approved_by_user_id uuid not null references auth.users(id) on delete restrict,
  approved_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint sellertray_commercial_price_versions_kind_check
    check (price_kind in ('subscription','branch_setup')),
  constraint sellertray_commercial_price_versions_subject_check
    check (
      (price_kind='subscription' and plan_code is not null and billing_cycle in ('monthly','yearly'))
      or
      (price_kind='branch_setup' and plan_code is null and billing_cycle is null)
    ),
  constraint sellertray_commercial_price_versions_currency_check
    check (currency ~ '^[A-Z]{3}$'),
  constraint sellertray_commercial_price_versions_amount_check
    check (gross_amount >= 0),
  constraint sellertray_commercial_price_versions_tax_inclusive_check
    check (tax_inclusive),
  constraint sellertray_commercial_price_versions_tax_snapshot_check
    check (
      (net_amount is null and tax_rate_percent is null and tax_amount is null)
      or
      (
        net_amount is not null and net_amount >= 0
        and tax_rate_percent is not null and tax_rate_percent >= 0 and tax_rate_percent <= 100
        and tax_amount is not null and tax_amount >= 0
        and abs(gross_amount-(net_amount+tax_amount)) < 0.005
      )
    ),
  constraint sellertray_commercial_price_versions_effective_window_check
    check (effective_until is null or effective_until > effective_from),
  constraint sellertray_commercial_price_versions_status_check
    check (status='published'),
  constraint sellertray_commercial_price_versions_reason_check
    check (char_length(btrim(change_reason)) between 1 and 1000),
  constraint sellertray_commercial_price_versions_approval_check
    check (approved_at >= created_at)
);

create unique index sellertray_commercial_subscription_price_version_key
  on public.sellertray_commercial_price_versions(
    plan_code,billing_cycle,currency,effective_from
  )
  where price_kind='subscription';

create unique index sellertray_commercial_branch_setup_price_version_key
  on public.sellertray_commercial_price_versions(currency,effective_from)
  where price_kind='branch_setup';

create index sellertray_commercial_price_resolution_idx
  on public.sellertray_commercial_price_versions(
    price_kind,plan_code,billing_cycle,currency,effective_from desc
  );

create or replace function public.validate_sellertray_commercial_price_version()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_monthly public.sellertray_commercial_price_versions%rowtype;
begin
  new.currency := upper(btrim(new.currency));
  new.change_reason := btrim(new.change_reason);

  if new.billing_cycle='yearly' then
    select p.* into v_monthly
    from public.sellertray_commercial_price_versions p
    where p.price_kind='subscription'
      and p.plan_code=new.plan_code
      and p.billing_cycle='monthly'
      and p.currency=new.currency
      and p.status='published'
      and p.effective_from <= new.effective_from
      and (p.effective_until is null or p.effective_until > new.effective_from)
    order by p.effective_from desc,p.created_at desc
    limit 1;

    if not found then
      raise exception 'A governed monthly price must exist before a yearly 10-for-12 price is published'
        using errcode='23514';
    end if;

    if abs(new.gross_amount-(v_monthly.gross_amount*10)) >= 0.005 then
      raise exception 'Yearly SellerTray subscription price must equal 10 monthly periods'
        using errcode='23514';
    end if;

    if (new.net_amount is null) is distinct from (v_monthly.net_amount is null)
       or (new.tax_amount is null) is distinct from (v_monthly.tax_amount is null)
       or (new.tax_rate_percent is null) is distinct from (v_monthly.tax_rate_percent is null) then
      raise exception 'Yearly SellerTray tax treatment must match the governed monthly price'
        using errcode='23514';
    end if;

    if v_monthly.net_amount is not null and (
      abs(new.net_amount-(v_monthly.net_amount*10)) >= 0.005
      or abs(new.tax_amount-(v_monthly.tax_amount*10)) >= 0.005
      or new.tax_rate_percent is distinct from v_monthly.tax_rate_percent
    ) then
      raise exception 'Yearly SellerTray tax snapshot must preserve the 10-for-12 rule'
        using errcode='23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.validate_sellertray_commercial_price_version()
  from public,anon,authenticated;

drop trigger if exists validate_sellertray_commercial_price_version
  on public.sellertray_commercial_price_versions;
create trigger validate_sellertray_commercial_price_version
before insert on public.sellertray_commercial_price_versions
for each row execute function public.validate_sellertray_commercial_price_version();

create or replace function public.prevent_sellertray_commercial_history_mutation()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  raise exception 'SellerTray commercial history is immutable' using errcode='55000';
end;
$$;

revoke all on function public.prevent_sellertray_commercial_history_mutation()
  from public,anon,authenticated;

drop trigger if exists prevent_sellertray_commercial_price_version_mutation
  on public.sellertray_commercial_price_versions;
create trigger prevent_sellertray_commercial_price_version_mutation
before update or delete on public.sellertray_commercial_price_versions
for each row execute function public.prevent_sellertray_commercial_history_mutation();

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
security definer
set search_path=''
as $$
  select p.id
  from public.sellertray_commercial_price_versions p
  where p.price_kind=p_price_kind
    and p.plan_code is not distinct from p_plan_code
    and p.billing_cycle is not distinct from p_billing_cycle
    and p.currency=upper(btrim(p_currency))
    and p.status='published'
    and p.effective_from <= p_as_of
    and (p.effective_until is null or p.effective_until > p_as_of)
  order by p.effective_from desc,p.created_at desc
  limit 1;
$$;

revoke all on function public.resolve_sellertray_commercial_price_version(text,text,text,text,timestamptz)
  from public,anon,authenticated;
grant execute on function public.resolve_sellertray_commercial_price_version(text,text,text,text,timestamptz)
  to service_role;

create table public.sellertray_commercial_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  order_reference text not null,
  currency text not null,
  total_gross_amount numeric(18,2) not null,
  ordered_at timestamptz not null default now(),
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (order_reference),
  constraint sellertray_commercial_orders_reference_check
    check (char_length(btrim(order_reference)) between 1 and 128),
  constraint sellertray_commercial_orders_currency_check
    check (currency ~ '^[A-Z]{3}$'),
  constraint sellertray_commercial_orders_total_check
    check (total_gross_amount >= 0),
  constraint sellertray_commercial_orders_time_check
    check (ordered_at <= created_at + interval '5 minutes')
);

create index sellertray_commercial_orders_tenant_ordered_idx
  on public.sellertray_commercial_orders(tenant_id,ordered_at desc);

create table public.sellertray_commercial_order_price_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  commercial_order_id uuid not null,
  line_no integer not null,
  line_type text not null,
  source_price_version_id uuid not null references public.sellertray_commercial_price_versions(id) on delete restrict,
  plan_code text references public.subscription_plans(code) on delete restrict,
  branch_id uuid,
  billing_cycle text,
  description_snapshot text not null,
  quantity numeric(18,6) not null default 1,
  currency text not null,
  unit_gross_amount numeric(18,2) not null,
  gross_amount numeric(18,2) not null,
  net_amount numeric(18,2),
  tax_rate_percent numeric(9,6),
  tax_amount numeric(18,2),
  snapshotted_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (commercial_order_id,line_no),
  constraint sellertray_commercial_order_price_snapshots_order_same_tenant
    foreign key (tenant_id,commercial_order_id)
    references public.sellertray_commercial_orders(tenant_id,id)
    on delete restrict,
  constraint sellertray_commercial_order_price_snapshots_branch_same_tenant
    foreign key (tenant_id,branch_id)
    references public.branches(tenant_id,id)
    on delete restrict,
  constraint sellertray_commercial_order_price_snapshots_line_no_check
    check (line_no > 0),
  constraint sellertray_commercial_order_price_snapshots_type_check
    check (line_type in ('subscription','branch_setup')),
  constraint sellertray_commercial_order_price_snapshots_subject_check
    check (
      (
        line_type='subscription'
        and plan_code is not null
        and branch_id is null
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
    ),
  constraint sellertray_commercial_order_price_snapshots_description_check
    check (char_length(btrim(description_snapshot)) between 1 and 500),
  constraint sellertray_commercial_order_price_snapshots_quantity_check
    check (quantity > 0),
  constraint sellertray_commercial_order_price_snapshots_currency_check
    check (currency ~ '^[A-Z]{3}$'),
  constraint sellertray_commercial_order_price_snapshots_amount_check
    check (
      unit_gross_amount >= 0
      and gross_amount >= 0
      and abs(gross_amount-round((quantity*unit_gross_amount)::numeric,2)) < 0.005
    ),
  constraint sellertray_commercial_order_price_snapshots_tax_check
    check (
      (net_amount is null and tax_rate_percent is null and tax_amount is null)
      or
      (
        net_amount is not null and net_amount >= 0
        and tax_rate_percent is not null and tax_rate_percent >= 0 and tax_rate_percent <= 100
        and tax_amount is not null and tax_amount >= 0
        and abs(gross_amount-(net_amount+tax_amount)) < 0.005
      )
    )
);

create unique index sellertray_commercial_order_one_subscription_line
  on public.sellertray_commercial_order_price_snapshots(commercial_order_id)
  where line_type='subscription';

create unique index sellertray_commercial_order_one_setup_per_branch
  on public.sellertray_commercial_order_price_snapshots(commercial_order_id,branch_id)
  where line_type='branch_setup';

create index sellertray_commercial_order_snapshot_tenant_idx
  on public.sellertray_commercial_order_price_snapshots(tenant_id,commercial_order_id,line_no);

create or replace function public.snapshot_sellertray_commercial_order_price()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_order public.sellertray_commercial_orders%rowtype;
  v_price public.sellertray_commercial_price_versions%rowtype;
  v_plan_name text;
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

  if v_price.effective_from > v_order.ordered_at
     or (v_price.effective_until is not null and v_price.effective_until <= v_order.ordered_at) then
    raise exception 'Commercial price version is not effective for the order time' using errcode='23514';
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

drop trigger if exists snapshot_sellertray_commercial_order_price
  on public.sellertray_commercial_order_price_snapshots;
create trigger snapshot_sellertray_commercial_order_price
before insert on public.sellertray_commercial_order_price_snapshots
for each row execute function public.snapshot_sellertray_commercial_order_price();

drop trigger if exists prevent_sellertray_commercial_order_mutation
  on public.sellertray_commercial_orders;
create trigger prevent_sellertray_commercial_order_mutation
before update or delete on public.sellertray_commercial_orders
for each row execute function public.prevent_sellertray_commercial_history_mutation();

drop trigger if exists prevent_sellertray_commercial_order_snapshot_mutation
  on public.sellertray_commercial_order_price_snapshots;
create trigger prevent_sellertray_commercial_order_snapshot_mutation
before update or delete on public.sellertray_commercial_order_price_snapshots
for each row execute function public.prevent_sellertray_commercial_history_mutation();

create or replace function public.validate_sellertray_commercial_order_amounts()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_order_id uuid := coalesce(new.commercial_order_id,new.id);
  v_tenant_id uuid := coalesce(new.tenant_id,old.tenant_id);
  v_expected numeric(18,2);
  v_actual numeric(18,2);
  v_count integer;
begin
  select o.total_gross_amount
    into v_expected
  from public.sellertray_commercial_orders o
  where o.id=v_order_id and o.tenant_id=v_tenant_id;

  if v_expected is null then
    return coalesce(new,old);
  end if;

  select count(*)::integer,coalesce(sum(s.gross_amount),0)::numeric(18,2)
    into v_count,v_actual
  from public.sellertray_commercial_order_price_snapshots s
  where s.commercial_order_id=v_order_id and s.tenant_id=v_tenant_id;

  if v_count=0 or abs(v_expected-v_actual) >= 0.005 then
    raise exception 'SellerTray commercial order total must equal immutable price snapshots'
      using errcode='23514';
  end if;

  return coalesce(new,old);
end;
$$;

revoke all on function public.validate_sellertray_commercial_order_amounts()
  from public,anon,authenticated;

drop trigger if exists validate_sellertray_commercial_order_amounts_header
  on public.sellertray_commercial_orders;
create constraint trigger validate_sellertray_commercial_order_amounts_header
after insert on public.sellertray_commercial_orders
deferrable initially deferred
for each row execute function public.validate_sellertray_commercial_order_amounts();

drop trigger if exists validate_sellertray_commercial_order_amounts_snapshot
  on public.sellertray_commercial_order_price_snapshots;
create constraint trigger validate_sellertray_commercial_order_amounts_snapshot
after insert on public.sellertray_commercial_order_price_snapshots
deferrable initially deferred
for each row execute function public.validate_sellertray_commercial_order_amounts();

create table public.sellertray_commercial_installment_obligations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  commercial_order_id uuid not null,
  structure_code text not null,
  currency text not null,
  obligated_amount numeric(18,2) not null,
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (commercial_order_id),
  constraint sellertray_commercial_installment_obligations_order_same_tenant
    foreign key (tenant_id,commercial_order_id)
    references public.sellertray_commercial_orders(tenant_id,id)
    on delete restrict,
  constraint sellertray_commercial_installment_obligations_structure_check
    check (structure_code in ('two_installment_70_30','three_installment_60_20_20')),
  constraint sellertray_commercial_installment_obligations_currency_check
    check (currency ~ '^[A-Z]{3}$'),
  constraint sellertray_commercial_installment_obligations_amount_check
    check (obligated_amount > 0)
);

create table public.sellertray_commercial_installment_schedule (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  installment_obligation_id uuid not null,
  sequence_no integer not null,
  percentage numeric(7,4) not null,
  amount_due numeric(18,2) not null,
  due_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (installment_obligation_id,sequence_no),
  constraint sellertray_commercial_installment_schedule_obligation_same_tenant
    foreign key (tenant_id,installment_obligation_id)
    references public.sellertray_commercial_installment_obligations(tenant_id,id)
    on delete restrict,
  constraint sellertray_commercial_installment_schedule_sequence_check
    check (sequence_no > 0),
  constraint sellertray_commercial_installment_schedule_percentage_check
    check (percentage > 0 and percentage <= 100),
  constraint sellertray_commercial_installment_schedule_amount_check
    check (amount_due > 0)
);

create index sellertray_commercial_installment_obligations_tenant_idx
  on public.sellertray_commercial_installment_obligations(tenant_id,created_at desc);
create index sellertray_commercial_installment_schedule_tenant_idx
  on public.sellertray_commercial_installment_schedule(tenant_id,installment_obligation_id,sequence_no);

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

  new.currency := v_order.currency;
  new.obligated_amount := v_order.total_gross_amount;
  return new;
end;
$$;

revoke all on function public.prepare_sellertray_commercial_installment_obligation()
  from public,anon,authenticated;

drop trigger if exists prepare_sellertray_commercial_installment_obligation
  on public.sellertray_commercial_installment_obligations;
create trigger prepare_sellertray_commercial_installment_obligation
before insert on public.sellertray_commercial_installment_obligations
for each row execute function public.prepare_sellertray_commercial_installment_obligation();

create or replace function public.validate_sellertray_commercial_installment_schedule()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_obligation_id uuid := coalesce(new.installment_obligation_id,new.id);
  v_tenant_id uuid := coalesce(new.tenant_id,old.tenant_id);
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_count integer;
  v_percent numeric;
  v_amount numeric;
  v_first numeric;
  v_second numeric;
  v_third numeric;
begin
  select o.* into v_obligation
  from public.sellertray_commercial_installment_obligations o
  where o.id=v_obligation_id and o.tenant_id=v_tenant_id;

  if not found then
    return coalesce(new,old);
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

  return coalesce(new,old);
end;
$$;

revoke all on function public.validate_sellertray_commercial_installment_schedule()
  from public,anon,authenticated;

drop trigger if exists validate_sellertray_commercial_installment_obligation
  on public.sellertray_commercial_installment_obligations;
create constraint trigger validate_sellertray_commercial_installment_obligation
after insert on public.sellertray_commercial_installment_obligations
deferrable initially deferred
for each row execute function public.validate_sellertray_commercial_installment_schedule();

drop trigger if exists validate_sellertray_commercial_installment_schedule_line
  on public.sellertray_commercial_installment_schedule;
create constraint trigger validate_sellertray_commercial_installment_schedule_line
after insert on public.sellertray_commercial_installment_schedule
deferrable initially deferred
for each row execute function public.validate_sellertray_commercial_installment_schedule();

drop trigger if exists prevent_sellertray_commercial_installment_obligation_mutation
  on public.sellertray_commercial_installment_obligations;
create trigger prevent_sellertray_commercial_installment_obligation_mutation
before update or delete on public.sellertray_commercial_installment_obligations
for each row execute function public.prevent_sellertray_commercial_history_mutation();

drop trigger if exists prevent_sellertray_commercial_installment_schedule_mutation
  on public.sellertray_commercial_installment_schedule;
create trigger prevent_sellertray_commercial_installment_schedule_mutation
before update or delete on public.sellertray_commercial_installment_schedule
for each row execute function public.prevent_sellertray_commercial_history_mutation();

create table public.sellertray_commercial_entitlement_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  plan_code text references public.subscription_plans(code) on delete restrict,
  commercial_order_id uuid,
  installment_obligation_id uuid,
  event_type text not null,
  idempotency_key text not null,
  effective_from timestamptz not null,
  effective_until timestamptz,
  payload jsonb not null default '{}'::jsonb,
  actor_user_id uuid references auth.users(id) on delete restrict,
  reason text not null,
  recorded_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,idempotency_key),
  constraint sellertray_commercial_entitlement_events_order_same_tenant
    foreign key (tenant_id,commercial_order_id)
    references public.sellertray_commercial_orders(tenant_id,id)
    on delete restrict,
  constraint sellertray_commercial_entitlement_events_obligation_same_tenant
    foreign key (tenant_id,installment_obligation_id)
    references public.sellertray_commercial_installment_obligations(tenant_id,id)
    on delete restrict,
  constraint sellertray_commercial_entitlement_events_type_check
    check (event_type ~ '^[a-z][a-z0-9_.:-]{0,63}$'),
  constraint sellertray_commercial_entitlement_events_key_check
    check (char_length(btrim(idempotency_key)) between 1 and 128),
  constraint sellertray_commercial_entitlement_events_window_check
    check (effective_until is null or effective_until > effective_from),
  constraint sellertray_commercial_entitlement_events_reason_check
    check (char_length(btrim(reason)) between 1 and 1000)
);

create index sellertray_commercial_entitlement_events_tenant_effective_idx
  on public.sellertray_commercial_entitlement_events(tenant_id,effective_from desc,recorded_at desc);

create or replace function public.append_sellertray_commercial_entitlement_event(
  p_tenant_id uuid,
  p_plan_code text,
  p_commercial_order_id uuid,
  p_installment_obligation_id uuid,
  p_event_type text,
  p_idempotency_key text,
  p_effective_from timestamptz,
  p_effective_until timestamptz,
  p_payload jsonb,
  p_actor_user_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_event public.sellertray_commercial_entitlement_events%rowtype;
  v_payload jsonb := coalesce(p_payload,'{}'::jsonb);
begin
  insert into public.sellertray_commercial_entitlement_events(
    tenant_id,plan_code,commercial_order_id,installment_obligation_id,
    event_type,idempotency_key,effective_from,effective_until,payload,
    actor_user_id,reason
  ) values (
    p_tenant_id,p_plan_code,p_commercial_order_id,p_installment_obligation_id,
    btrim(p_event_type),btrim(p_idempotency_key),p_effective_from,p_effective_until,v_payload,
    p_actor_user_id,btrim(p_reason)
  )
  on conflict (tenant_id,idempotency_key) do nothing;

  select e.* into strict v_event
  from public.sellertray_commercial_entitlement_events e
  where e.tenant_id=p_tenant_id
    and e.idempotency_key=btrim(p_idempotency_key);

  if v_event.plan_code is distinct from p_plan_code
     or v_event.commercial_order_id is distinct from p_commercial_order_id
     or v_event.installment_obligation_id is distinct from p_installment_obligation_id
     or v_event.event_type is distinct from btrim(p_event_type)
     or v_event.effective_from is distinct from p_effective_from
     or v_event.effective_until is distinct from p_effective_until
     or v_event.payload is distinct from v_payload
     or v_event.actor_user_id is distinct from p_actor_user_id
     or v_event.reason is distinct from btrim(p_reason) then
    raise exception 'SellerTray entitlement idempotency key is already used for different entitlement facts'
      using errcode='23505';
  end if;

  return v_event.id;
end;
$$;

revoke all on function public.append_sellertray_commercial_entitlement_event(uuid,text,uuid,uuid,text,text,timestamptz,timestamptz,jsonb,uuid,text)
  from public,anon,authenticated;
grant execute on function public.append_sellertray_commercial_entitlement_event(uuid,text,uuid,uuid,text,text,timestamptz,timestamptz,jsonb,uuid,text)
  to service_role;

drop trigger if exists prevent_sellertray_commercial_entitlement_event_mutation
  on public.sellertray_commercial_entitlement_events;
create trigger prevent_sellertray_commercial_entitlement_event_mutation
before update or delete on public.sellertray_commercial_entitlement_events
for each row execute function public.prevent_sellertray_commercial_history_mutation();

alter table public.sellertray_commercial_price_versions enable row level security;
alter table public.sellertray_commercial_orders enable row level security;
alter table public.sellertray_commercial_order_price_snapshots enable row level security;
alter table public.sellertray_commercial_installment_obligations enable row level security;
alter table public.sellertray_commercial_installment_schedule enable row level security;
alter table public.sellertray_commercial_entitlement_events enable row level security;

revoke all on table public.sellertray_commercial_price_versions from public,anon,authenticated;
revoke all on table public.sellertray_commercial_orders from public,anon,authenticated;
revoke all on table public.sellertray_commercial_order_price_snapshots from public,anon,authenticated;
revoke all on table public.sellertray_commercial_installment_obligations from public,anon,authenticated;
revoke all on table public.sellertray_commercial_installment_schedule from public,anon,authenticated;
revoke all on table public.sellertray_commercial_entitlement_events from public,anon,authenticated;

grant all on table public.sellertray_commercial_price_versions to service_role;
grant all on table public.sellertray_commercial_orders to service_role;
grant all on table public.sellertray_commercial_order_price_snapshots to service_role;
grant all on table public.sellertray_commercial_installment_obligations to service_role;
grant all on table public.sellertray_commercial_installment_schedule to service_role;
grant all on table public.sellertray_commercial_entitlement_events to service_role;

commit;
