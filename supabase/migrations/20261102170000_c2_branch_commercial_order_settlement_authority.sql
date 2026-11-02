begin;

-- SellerTray C2-6 — Branch-aware commercial orders and settlement
--
-- Forward-only Commercial V2 authority. C1 commercial history and the legacy
-- Business-wide tenant_subscriptions runtime remain intact. This migration:
-- - introduces immutable Branch-bound subscription order lines;
-- - allows one commercial order to contain independent Branch subjects;
-- - extends the existing installment obligation/payment evidence to Branch scope;
-- - keeps settlement arithmetic server-authoritative;
-- - reuses Commercial V2 price, tax, installment and payment-method masters.
--
-- It does NOT cut any operational surface over to Commercial V2 and does not
-- mutate tenant_subscriptions.

-- ---------------------------------------------------------------------------
-- 1. C2 order identity and Branch-bound immutable price snapshots
-- ---------------------------------------------------------------------------

alter table public.sellertray_commercial_orders
  add column if not exists order_kind text,
  add column if not exists creation_command_id uuid,
  add column if not exists creation_request_fingerprint text;

alter table public.sellertray_commercial_orders
  add constraint sellertray_commercial_orders_kind_check
    check (order_kind is null or order_kind='branch_commercial_v2'),
  add constraint sellertray_commercial_orders_creation_shape_check
    check (
      (order_kind is null and creation_command_id is null and creation_request_fingerprint is null)
      or
      (
        order_kind='branch_commercial_v2'
        and creation_command_id is not null
        and creation_request_fingerprint ~ '^[0-9a-f]{64}$'
      )
    );

create unique index sellertray_commercial_orders_creation_command_key
  on public.sellertray_commercial_orders(tenant_id,creation_command_id)
  where creation_command_id is not null;

alter table public.sellertray_commercial_order_price_snapshots
  add column if not exists charge_type_code text,
  add column if not exists plan_profile_version_id uuid,
  add column if not exists commercial_tax_profile_version_id uuid,
  add column if not exists price_scope_snapshot text;

alter table public.sellertray_commercial_order_price_snapshots
  add constraint sellertray_commercial_order_snapshots_charge_type_fkey
    foreign key (charge_type_code)
    references public.sellertray_commercial_charge_types(code) on delete restrict,
  add constraint sellertray_commercial_order_snapshots_plan_profile_fkey
    foreign key (plan_profile_version_id)
    references public.sellertray_plan_profile_versions(id) on delete restrict,
  add constraint sellertray_commercial_order_snapshots_tax_profile_fkey
    foreign key (commercial_tax_profile_version_id)
    references public.sellertray_commercial_tax_profile_versions(id) on delete restrict,
  add constraint sellertray_commercial_order_snapshots_price_scope_check
    check (price_scope_snapshot is null or price_scope_snapshot in ('standard','merchant_override')),
  drop constraint sellertray_commercial_order_price_snapshots_type_check,
  add constraint sellertray_commercial_order_price_snapshots_type_check
    check (line_type in ('subscription','branch_subscription','branch_setup')),
  drop constraint sellertray_commercial_order_price_snapshots_subject_check,
  add constraint sellertray_commercial_order_price_snapshots_subject_check
    check (
      (
        line_type='subscription'
        and plan_code is not null
        and branch_id is null
        and plan_profile_version_id is null
        and billing_cycle in ('monthly','yearly')
        and quantity=1
      )
      or
      (
        line_type='branch_subscription'
        and plan_code is null
        and branch_id is not null
        and plan_profile_version_id is not null
        and billing_cycle in ('monthly','yearly')
        and charge_type_code='branch_subscription'
        and quantity=1
      )
      or
      (
        line_type='branch_setup'
        and plan_code is null
        and branch_id is not null
        and plan_profile_version_id is null
        and billing_cycle is null
        and quantity=1
      )
    );

create unique index sellertray_commercial_order_one_branch_subscription_line
  on public.sellertray_commercial_order_price_snapshots(commercial_order_id,branch_id)
  where line_type='branch_subscription';

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
    new.plan_profile_version_id:=v_price.plan_profile_version_id;
    new.billing_cycle:=v_price.billing_cycle;
    new.quantity:=1;
    if nullif(btrim(new.description_snapshot),'') is null then new.description_snapshot:=v_plan_name; end if;
  elsif new.line_type='branch_setup' then
    if v_price.price_kind<>'branch_setup' then
      raise exception 'Branch setup order line requires a branch setup price version' using errcode='23514';
    end if;
    if new.branch_id is null then raise exception 'Branch setup order line requires a Branch' using errcode='23514'; end if;
    new.plan_code:=null;
    new.plan_profile_version_id:=null;
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

revoke all on function public.snapshot_sellertray_commercial_order_price()
  from public,anon,authenticated;

-- ---------------------------------------------------------------------------
-- 2. Generalize installment schedules without changing accepted C1 contracts
-- ---------------------------------------------------------------------------

alter table public.sellertray_commercial_installment_schedule
  alter column percentage drop not null,
  add column if not exists allocation_mode text not null default 'percentage',
  add column if not exists fixed_amount_snapshot numeric(18,2);

alter table public.sellertray_commercial_installment_schedule
  drop constraint sellertray_commercial_installment_schedule_percentage_check,
  add constraint sellertray_commercial_installment_schedule_allocation_check
    check (
      (
        allocation_mode='percentage'
        and percentage is not null and percentage>0 and percentage<=100
        and fixed_amount_snapshot is null
      )
      or
      (
        allocation_mode='fixed'
        and percentage is null
        and fixed_amount_snapshot is not null and fixed_amount_snapshot>0
      )
    );

create or replace function public.validate_sellertray_commercial_installment_schedule()
returns trigger
language plpgsql
set search_path=''
as $function$
declare
  v_obligation_id uuid:=coalesce(new.installment_obligation_id,new.id);
  v_tenant_id uuid:=coalesce(new.tenant_id,old.tenant_id);
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_count integer;
  v_percentage_count integer;
  v_fixed_count integer;
  v_percent numeric;
  v_amount numeric;
  v_first numeric;
  v_second numeric;
  v_third numeric;
begin
  select o.* into v_obligation
  from public.sellertray_commercial_installment_obligations o
  where o.id=v_obligation_id and o.tenant_id=v_tenant_id;
  if not found then return coalesce(new,old); end if;

  select count(*)::integer,
         count(*) filter (where s.allocation_mode='percentage')::integer,
         count(*) filter (where s.allocation_mode='fixed')::integer,
         coalesce(sum(s.percentage),0),
         coalesce(sum(s.amount_due),0),
         max(s.amount_due) filter (where s.sequence_no=1),
         max(s.amount_due) filter (where s.sequence_no=2),
         max(s.amount_due) filter (where s.sequence_no=3)
    into v_count,v_percentage_count,v_fixed_count,v_percent,v_amount,v_first,v_second,v_third
  from public.sellertray_commercial_installment_schedule s
  where s.installment_obligation_id=v_obligation.id and s.tenant_id=v_obligation.tenant_id;

  if v_count=0 or abs(v_amount-v_obligation.obligated_amount)>=0.005 then
    raise exception 'SellerTray installment schedule must reconcile to the commercial obligation' using errcode='23514';
  end if;
  if v_percentage_count not in (0,v_count) or v_fixed_count not in (0,v_count) then
    raise exception 'SellerTray installment schedule cannot mix percentage and fixed allocations' using errcode='23514';
  end if;
  if v_percentage_count=v_count and abs(v_percent-100)>=0.0001 then
    raise exception 'SellerTray percentage installment schedule must reconcile to 100 percent' using errcode='23514';
  end if;
  if v_fixed_count=v_count and exists(
    select 1 from public.sellertray_commercial_installment_schedule s
    where s.installment_obligation_id=v_obligation.id and abs(s.amount_due-s.fixed_amount_snapshot)>=0.005
  ) then
    raise exception 'SellerTray fixed installment schedule must preserve its snapshotted fixed amounts' using errcode='23514';
  end if;

  if v_obligation.structure_code='two_installment_70_30' then
    if v_count<>2 or v_percentage_count<>2
       or not exists(select 1 from public.sellertray_commercial_installment_schedule s where s.installment_obligation_id=v_obligation.id and s.sequence_no=1 and s.percentage=70)
       or not exists(select 1 from public.sellertray_commercial_installment_schedule s where s.installment_obligation_id=v_obligation.id and s.sequence_no=2 and s.percentage=30)
       or abs(v_first-round((v_obligation.obligated_amount*0.70)::numeric,2))>=0.005
       or abs(v_second-(v_obligation.obligated_amount-v_first))>=0.005 then
      raise exception 'SellerTray two-installment schedule must preserve the approved 70:30 structure' using errcode='23514';
    end if;
  elsif v_obligation.structure_code='three_installment_60_20_20' then
    if v_count<>3 or v_percentage_count<>3
       or not exists(select 1 from public.sellertray_commercial_installment_schedule s where s.installment_obligation_id=v_obligation.id and s.sequence_no=1 and s.percentage=60)
       or not exists(select 1 from public.sellertray_commercial_installment_schedule s where s.installment_obligation_id=v_obligation.id and s.sequence_no=2 and s.percentage=20)
       or not exists(select 1 from public.sellertray_commercial_installment_schedule s where s.installment_obligation_id=v_obligation.id and s.sequence_no=3 and s.percentage=20)
       or abs(v_first-round((v_obligation.obligated_amount*0.60)::numeric,2))>=0.005
       or abs(v_second-round((v_obligation.obligated_amount*0.20)::numeric,2))>=0.005
       or abs(v_third-(v_obligation.obligated_amount-v_first-v_second))>=0.005 then
      raise exception 'SellerTray three-installment schedule must preserve the approved 60:20:20 structure' using errcode='23514';
    end if;
  end if;

  return coalesce(new,old);
end;
$function$;

revoke all on function public.validate_sellertray_commercial_installment_schedule()
  from public,anon,authenticated;

insert into public.sellertray_installment_schedule_templates(
  template_code,version,display_name,status,provisional_entitlement_months,
  qualifying_settlement_sequence,effective_from,change_reason
)
values(
  'full_payment_100',1,'Full payment','published',0,1,
  '2026-11-02T00:00:00Z','Commercial V2 canonical full-settlement schedule'
)
on conflict (template_code,version) do nothing;

insert into public.sellertray_installment_schedule_template_lines(
  template_id,sequence_no,percentage,fixed_amount,due_offset_days
)
select t.id,1,100,null,0
from public.sellertray_installment_schedule_templates t
where t.template_code='full_payment_100' and t.version=1
on conflict (template_id,sequence_no) do nothing;

set constraints validate_sellertray_installment_template_header,
                validate_sellertray_installment_template_line immediate;

-- ---------------------------------------------------------------------------
-- 3. Branch-scoped obligations and immutable commercial subject ledger
-- ---------------------------------------------------------------------------

alter table public.sellertray_commercial_installment_obligations
  add column if not exists obligation_scope text not null default 'commercial_order',
  add column if not exists commercial_order_line_id uuid,
  add column if not exists branch_id uuid;

alter table public.sellertray_commercial_installment_obligations
  drop constraint sellertray_commercial_installment_oblig_commercial_order_id_key,
  add constraint sellertray_commercial_installment_obligations_line_same_tenant
    foreign key (tenant_id,commercial_order_line_id)
    references public.sellertray_commercial_order_price_snapshots(tenant_id,id) on delete restrict,
  add constraint sellertray_commercial_installment_obligations_branch_same_tenant
    foreign key (tenant_id,branch_id)
    references public.branches(tenant_id,id) on delete restrict,
  add constraint sellertray_commercial_installment_obligations_scope_check
    check (obligation_scope in ('commercial_order','branch_subscription')),
  add constraint sellertray_commercial_installment_obligations_scope_shape_check
    check (
      (obligation_scope='commercial_order' and commercial_order_line_id is null and branch_id is null)
      or
      (obligation_scope='branch_subscription' and commercial_order_line_id is not null and branch_id is not null)
    );

create unique index sellertray_commercial_installment_obligation_subject_key
  on public.sellertray_commercial_installment_obligations(commercial_order_id,commercial_order_line_id)
  nulls not distinct;

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
      and l.line_type in ('branch_subscription','branch_setup');
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

revoke all on function public.prepare_sellertray_commercial_installment_obligation()
  from public,anon,authenticated;

create table public.sellertray_branch_commercial_order_subjects(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  commercial_order_id uuid not null,
  branch_id uuid not null,
  branch_subscription_line_id uuid not null,
  branch_setup_line_id uuid,
  plan_profile_version_id uuid not null references public.sellertray_plan_profile_versions(id) on delete restrict,
  billing_cycle text not null,
  installment_obligation_id uuid not null,
  installment_template_id uuid not null references public.sellertray_installment_schedule_templates(id) on delete restrict,
  installment_policy_version_id uuid references public.sellertray_installment_policy_versions(id) on delete restrict,
  setup_required boolean not null default false,
  supersedes_branch_subscription_id uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,commercial_order_id,branch_id),
  unique (tenant_id,branch_subscription_line_id),
  unique (tenant_id,installment_obligation_id),
  constraint sellertray_branch_order_subject_order_same_tenant
    foreign key (tenant_id,commercial_order_id)
    references public.sellertray_commercial_orders(tenant_id,id) on delete restrict,
  constraint sellertray_branch_order_subject_branch_same_tenant
    foreign key (tenant_id,branch_id)
    references public.branches(tenant_id,id) on delete restrict,
  constraint sellertray_branch_order_subject_subscription_line_same_tenant
    foreign key (tenant_id,branch_subscription_line_id)
    references public.sellertray_commercial_order_price_snapshots(tenant_id,id) on delete restrict,
  constraint sellertray_branch_order_subject_setup_line_same_tenant
    foreign key (tenant_id,branch_setup_line_id)
    references public.sellertray_commercial_order_price_snapshots(tenant_id,id) on delete restrict,
  constraint sellertray_branch_order_subject_obligation_same_tenant
    foreign key (tenant_id,commercial_order_id,installment_obligation_id)
    references public.sellertray_commercial_installment_obligations(tenant_id,commercial_order_id,id) on delete restrict,
  constraint sellertray_branch_order_subject_supersedes_same_tenant
    foreign key (tenant_id,supersedes_branch_subscription_id)
    references public.sellertray_branch_subscriptions(tenant_id,id) on delete restrict,
  constraint sellertray_branch_order_subject_cycle_check check (billing_cycle in ('monthly','yearly')),
  constraint sellertray_branch_order_subject_setup_shape_check
    check ((setup_required and branch_setup_line_id is not null) or (not setup_required and branch_setup_line_id is null))
);

create index sellertray_branch_commercial_order_subjects_order_idx
  on public.sellertray_branch_commercial_order_subjects(tenant_id,commercial_order_id,branch_id);

alter table public.sellertray_branch_commercial_order_subjects enable row level security;
revoke all on public.sellertray_branch_commercial_order_subjects from public,anon,authenticated;
grant select on public.sellertray_branch_commercial_order_subjects to service_role;

create trigger prevent_sellertray_branch_commercial_order_subject_mutation
before update or delete on public.sellertray_branch_commercial_order_subjects
for each row execute function public.prevent_sellertray_commercial_history_mutation();

-- ---------------------------------------------------------------------------
-- 4. ProcessEdge commercial payment-method selection and scoped credits
-- ---------------------------------------------------------------------------

create table public.sellertray_commercial_payment_method_selections(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  commercial_order_id uuid not null,
  installment_obligation_id uuid not null,
  payment_method_version_id uuid not null references public.sellertray_commercial_payment_method_versions(id) on delete restrict,
  command_id uuid not null,
  actor_user_id uuid references auth.users(id) on delete restrict,
  selected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,command_id),
  constraint sellertray_commercial_payment_selection_obligation_same_order
    foreign key (tenant_id,commercial_order_id,installment_obligation_id)
    references public.sellertray_commercial_installment_obligations(tenant_id,commercial_order_id,id) on delete restrict,
  constraint sellertray_commercial_payment_selection_time_check
    check (selected_at<=created_at+interval '5 minutes')
);

create index sellertray_commercial_payment_selection_current_idx
  on public.sellertray_commercial_payment_method_selections(
    tenant_id,installment_obligation_id,selected_at desc,created_at desc
  );

alter table public.sellertray_commercial_payment_method_selections enable row level security;
revoke all on public.sellertray_commercial_payment_method_selections from public,anon,authenticated;
grant select on public.sellertray_commercial_payment_method_selections to service_role;

create trigger prevent_sellertray_commercial_payment_selection_mutation
before update or delete on public.sellertray_commercial_payment_method_selections
for each row execute function public.prevent_sellertray_commercial_history_mutation();

alter table public.sellertray_commercial_adjustments
  add column if not exists installment_obligation_id uuid,
  add column if not exists adjustment_type_code text,
  add column if not exists input_value numeric(18,6),
  add column if not exists basis_amount numeric(18,2);

alter table public.sellertray_commercial_adjustments
  add constraint sellertray_commercial_adjustments_obligation_same_order
    foreign key (tenant_id,commercial_order_id,installment_obligation_id)
    references public.sellertray_commercial_installment_obligations(tenant_id,commercial_order_id,id) on delete restrict,
  add constraint sellertray_commercial_adjustments_type_code_fkey
    foreign key (adjustment_type_code)
    references public.sellertray_commercial_adjustment_types(code) on delete restrict,
  add constraint sellertray_commercial_adjustments_c2_shape_check
    check (
      adjustment_type_code is null
      or (
        installment_obligation_id is not null
        and adjustment_type_code in ('discount_fixed','discount_percentage')
        and input_value is not null and input_value>0
        and basis_amount is not null and basis_amount>0
      )
    );

alter table public.sellertray_commercial_direct_payment_confirmations
  add column if not exists installment_obligation_id uuid,
  add column if not exists commercial_payment_method_version_id uuid;

alter table public.sellertray_commercial_direct_payment_confirmations
  add constraint sellertray_commercial_direct_payments_obligation_same_order
    foreign key (tenant_id,commercial_order_id,installment_obligation_id)
    references public.sellertray_commercial_installment_obligations(tenant_id,commercial_order_id,id) on delete restrict,
  add constraint sellertray_commercial_direct_payments_method_version_fkey
    foreign key (commercial_payment_method_version_id)
    references public.sellertray_commercial_payment_method_versions(id) on delete restrict,
  add constraint sellertray_commercial_direct_payments_c2_shape_check
    check (
      (installment_obligation_id is null and commercial_payment_method_version_id is null)
      or (installment_obligation_id is not null and commercial_payment_method_version_id is not null)
    );

create or replace function public.prepare_sellertray_commercial_credit_fact()
returns trigger
language plpgsql
set search_path=''
as $function$
declare
  v_order public.sellertray_commercial_orders%rowtype;
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_adjustments numeric(18,2);
  v_gateway numeric(18,2);
  v_direct numeric(18,2);
  v_ceiling numeric(18,2);
begin
  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.tenant_id=new.tenant_id and o.id=new.commercial_order_id;

  new.currency:=v_order.currency;
  new.reason:=btrim(new.reason);

  if new.installment_obligation_id is not null then
    select o.* into strict v_obligation
    from public.sellertray_commercial_installment_obligations o
    where o.tenant_id=new.tenant_id
      and o.commercial_order_id=new.commercial_order_id
      and o.id=new.installment_obligation_id;
    v_ceiling:=v_obligation.obligated_amount;

    select coalesce(sum(a.amount),0)::numeric(18,2) into v_adjustments
    from public.sellertray_commercial_adjustments a
    where a.tenant_id=new.tenant_id and a.commercial_order_id=new.commercial_order_id
      and a.installment_obligation_id=new.installment_obligation_id;
    select coalesce(sum(p.amount),0)::numeric(18,2) into v_gateway
    from public.sellertray_commercial_installment_payment_confirmations p
    where p.tenant_id=new.tenant_id and p.commercial_order_id=new.commercial_order_id
      and p.installment_obligation_id=new.installment_obligation_id;
    select coalesce(sum(p.amount),0)::numeric(18,2) into v_direct
    from public.sellertray_commercial_direct_payment_confirmations p
    where p.tenant_id=new.tenant_id and p.commercial_order_id=new.commercial_order_id
      and p.installment_obligation_id=new.installment_obligation_id;
  else
    if exists(
      select 1 from public.sellertray_commercial_installment_obligations o
      where o.tenant_id=new.tenant_id and o.commercial_order_id=new.commercial_order_id
        and o.obligation_scope='branch_subscription'
    ) then
      raise exception 'Commercial V2 Branch orders require obligation-scoped credits' using errcode='23514';
    end if;
    v_ceiling:=v_order.total_gross_amount;
    select coalesce(sum(a.amount),0)::numeric(18,2) into v_adjustments
    from public.sellertray_commercial_adjustments a
    where a.tenant_id=new.tenant_id and a.commercial_order_id=new.commercial_order_id;
    select coalesce(sum(p.amount),0)::numeric(18,2) into v_gateway
    from public.sellertray_commercial_installment_payment_confirmations p
    where p.tenant_id=new.tenant_id and p.commercial_order_id=new.commercial_order_id;
    select coalesce(sum(p.amount),0)::numeric(18,2) into v_direct
    from public.sellertray_commercial_direct_payment_confirmations p
    where p.tenant_id=new.tenant_id and p.commercial_order_id=new.commercial_order_id;
  end if;

  if v_adjustments+v_gateway+v_direct+new.amount>v_ceiling+0.004 then
    raise exception 'Commercial credits cannot exceed the governed obligation gross' using errcode='23514';
  end if;
  return new;
end;
$function$;

revoke all on function public.prepare_sellertray_commercial_credit_fact()
  from public,anon,authenticated;

create or replace function public.select_sellertray_commercial_payment_method(
  p_tenant_id uuid,
  p_installment_obligation_id uuid,
  p_payment_method_version_id uuid,
  p_command_id uuid,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_method_version public.sellertray_commercial_payment_method_versions%rowtype;
  v_method public.sellertray_commercial_payment_methods%rowtype;
  v_existing public.sellertray_commercial_payment_method_selections%rowtype;
  v_id uuid;
begin
  if p_tenant_id is null or p_installment_obligation_id is null or p_payment_method_version_id is null or p_command_id is null then
    raise exception 'Business, commercial obligation, payment method and command are required' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sellertray-commercial-payment-selection|'||p_tenant_id::text||'|'||p_command_id::text,0));

  select s.* into v_existing
  from public.sellertray_commercial_payment_method_selections s
  where s.tenant_id=p_tenant_id and s.command_id=p_command_id;
  if found then
    if v_existing.installment_obligation_id=p_installment_obligation_id
       and v_existing.payment_method_version_id=p_payment_method_version_id
       and v_existing.actor_user_id is not distinct from p_actor_user_id then
      return v_existing.id;
    end if;
    raise exception 'Commercial payment-method selection command is already used for different facts' using errcode='23505';
  end if;

  select o.* into strict v_obligation
  from public.sellertray_commercial_installment_obligations o
  where o.tenant_id=p_tenant_id and o.id=p_installment_obligation_id;
  if v_obligation.obligation_scope<>'branch_subscription' then
    raise exception 'Commercial V2 payment-method selection requires a Branch commercial obligation' using errcode='23514';
  end if;

  select v.* into strict v_method_version
  from public.sellertray_commercial_payment_method_versions v
  where v.id=p_payment_method_version_id;
  select m.* into strict v_method
  from public.sellertray_commercial_payment_methods m
  where m.id=v_method_version.payment_method_id;
  if v_method.status<>'active'
     or v_method_version.effective_from>now()
     or (v_method_version.effective_until is not null and v_method_version.effective_until<=now()) then
    raise exception 'Selected ProcessEdge commercial payment method is not currently available' using errcode='23514';
  end if;

  insert into public.sellertray_commercial_payment_method_selections(
    tenant_id,commercial_order_id,installment_obligation_id,payment_method_version_id,
    command_id,actor_user_id,selected_at
  ) values(
    p_tenant_id,v_obligation.commercial_order_id,p_installment_obligation_id,p_payment_method_version_id,
    p_command_id,p_actor_user_id,now()
  ) returning id into v_id;
  return v_id;
end;
$function$;

revoke all on function public.select_sellertray_commercial_payment_method(uuid,uuid,uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.select_sellertray_commercial_payment_method(uuid,uuid,uuid,uuid,uuid)
  to service_role;

create or replace function public.record_sellertray_c2_commercial_discount(
  p_tenant_id uuid,
  p_installment_obligation_id uuid,
  p_adjustment_type_code text,
  p_input_value numeric,
  p_reason text,
  p_evidence jsonb,
  p_command_id uuid,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_code text:=lower(btrim(coalesce(p_adjustment_type_code,'')));
  v_reason text:=btrim(coalesce(p_reason,''));
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_existing public.sellertray_commercial_adjustments%rowtype;
  v_amount numeric(18,2);
  v_id uuid;
begin
  if p_tenant_id is null or p_installment_obligation_id is null or p_command_id is null
     or v_code not in ('discount_fixed','discount_percentage')
     or p_input_value is null or p_input_value<=0
     or char_length(v_reason) not between 1 and 1000
     or jsonb_typeof(coalesce(p_evidence,'{}'::jsonb))<>'object' then
    raise exception 'Valid Commercial V2 discount facts are required' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sellertray-c2-discount|'||p_tenant_id::text||'|'||p_command_id::text,0));
  select a.* into v_existing from public.sellertray_commercial_adjustments a where a.tenant_id=p_tenant_id and a.command_id=p_command_id;
  if found then
    if v_existing.installment_obligation_id=p_installment_obligation_id
       and v_existing.adjustment_type_code=v_code
       and v_existing.input_value=p_input_value
       and v_existing.reason=v_reason
       and v_existing.evidence=coalesce(p_evidence,'{}'::jsonb)
       and v_existing.actor_user_id=p_actor_user_id then return v_existing.id; end if;
    raise exception 'Commercial discount command is already used for different facts' using errcode='23505';
  end if;

  select o.* into strict v_obligation
  from public.sellertray_commercial_installment_obligations o
  where o.tenant_id=p_tenant_id and o.id=p_installment_obligation_id;
  if v_obligation.obligation_scope<>'branch_subscription' then
    raise exception 'Commercial V2 discount requires a Branch commercial obligation' using errcode='23514';
  end if;
  if v_code='discount_percentage' then
    if p_input_value>100 then raise exception 'Percentage discount cannot exceed 100 percent' using errcode='22023'; end if;
    v_amount:=round((v_obligation.obligated_amount*(p_input_value/100))::numeric,2);
  else
    v_amount:=round(p_input_value::numeric,2);
  end if;
  if v_amount<=0 or v_amount>v_obligation.obligated_amount then
    raise exception 'Commercial discount exceeds the governed Branch obligation' using errcode='23514';
  end if;

  insert into public.sellertray_commercial_adjustments(
    tenant_id,commercial_order_id,command_id,adjustment_type,amount,currency,reason,evidence,
    actor_user_id,approved_at,recorded_at,installment_obligation_id,adjustment_type_code,input_value,basis_amount
  ) values(
    p_tenant_id,v_obligation.commercial_order_id,p_command_id,'discount',v_amount,v_obligation.currency,v_reason,
    coalesce(p_evidence,'{}'::jsonb),p_actor_user_id,now(),now(),p_installment_obligation_id,v_code,p_input_value,v_obligation.obligated_amount
  ) returning id into v_id;
  return v_id;
end;
$function$;

revoke all on function public.record_sellertray_c2_commercial_discount(uuid,uuid,text,numeric,text,jsonb,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.record_sellertray_c2_commercial_discount(uuid,uuid,text,numeric,text,jsonb,uuid,uuid)
  to service_role;

create or replace function public.record_sellertray_c2_direct_payment_confirmation(
  p_tenant_id uuid,
  p_installment_obligation_id uuid,
  p_payment_method_version_id uuid,
  p_payment_reference text,
  p_amount numeric,
  p_paid_at timestamptz,
  p_reason text,
  p_evidence jsonb,
  p_command_id uuid,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_reference text:=btrim(coalesce(p_payment_reference,''));
  v_reason text:=btrim(coalesce(p_reason,''));
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_version public.sellertray_commercial_payment_method_versions%rowtype;
  v_method public.sellertray_commercial_payment_methods%rowtype;
  v_selection public.sellertray_commercial_payment_method_selections%rowtype;
  v_existing public.sellertray_commercial_direct_payment_confirmations%rowtype;
  v_amount numeric(18,2):=round(coalesce(p_amount,0)::numeric,2);
  v_id uuid;
begin
  if p_tenant_id is null or p_installment_obligation_id is null or p_payment_method_version_id is null
     or p_command_id is null or char_length(v_reference) not between 1 and 160 or v_amount<=0
     or p_paid_at is null or p_paid_at>now()+interval '5 minutes'
     or char_length(v_reason) not between 1 and 1000
     or jsonb_typeof(coalesce(p_evidence,'{}'::jsonb))<>'object' then
    raise exception 'Valid Commercial V2 direct payment confirmation facts are required' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sellertray-c2-direct-payment|'||p_tenant_id::text||'|'||p_command_id::text,0));
  select p.* into v_existing from public.sellertray_commercial_direct_payment_confirmations p where p.tenant_id=p_tenant_id and p.command_id=p_command_id;
  if found then
    if v_existing.installment_obligation_id=p_installment_obligation_id
       and v_existing.commercial_payment_method_version_id=p_payment_method_version_id
       and v_existing.payment_reference=v_reference and v_existing.amount=v_amount
       and v_existing.paid_at=p_paid_at and v_existing.reason=v_reason
       and v_existing.evidence=coalesce(p_evidence,'{}'::jsonb)
       and v_existing.actor_user_id=p_actor_user_id then return v_existing.id; end if;
    raise exception 'Commercial direct payment command is already used for different facts' using errcode='23505';
  end if;

  select o.* into strict v_obligation
  from public.sellertray_commercial_installment_obligations o
  where o.tenant_id=p_tenant_id and o.id=p_installment_obligation_id;
  if v_obligation.obligation_scope<>'branch_subscription' then
    raise exception 'Commercial V2 direct payment requires a Branch commercial obligation' using errcode='23514';
  end if;
  select v.* into strict v_version from public.sellertray_commercial_payment_method_versions v where v.id=p_payment_method_version_id;
  select m.* into strict v_method from public.sellertray_commercial_payment_methods m where m.id=v_version.payment_method_id;
  if v_method.status<>'active' or v_version.confirmation_mode='automatic'
     or v_version.effective_from>p_paid_at or (v_version.effective_until is not null and v_version.effective_until<=p_paid_at) then
    raise exception 'Selected payment method does not permit manual commercial confirmation for this payment time' using errcode='23514';
  end if;
  select s.* into v_selection
  from public.sellertray_commercial_payment_method_selections s
  where s.tenant_id=p_tenant_id and s.installment_obligation_id=p_installment_obligation_id
  order by s.selected_at desc,s.created_at desc,s.id desc limit 1;
  if not found or v_selection.payment_method_version_id<>p_payment_method_version_id then
    raise exception 'Confirm the currently selected ProcessEdge commercial payment method before recording payment' using errcode='23514';
  end if;

  insert into public.sellertray_commercial_direct_payment_confirmations(
    tenant_id,commercial_order_id,command_id,payment_reference,payment_method,amount,currency,reason,evidence,
    actor_user_id,paid_at,recorded_at,installment_obligation_id,commercial_payment_method_version_id
  ) values(
    p_tenant_id,v_obligation.commercial_order_id,p_command_id,v_reference,v_method.code,v_amount,v_obligation.currency,
    v_reason,coalesce(p_evidence,'{}'::jsonb),p_actor_user_id,p_paid_at,now(),p_installment_obligation_id,p_payment_method_version_id
  ) returning id into v_id;
  return v_id;
end;
$function$;

revoke all on function public.record_sellertray_c2_direct_payment_confirmation(uuid,uuid,uuid,text,numeric,timestamptz,text,jsonb,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.record_sellertray_c2_direct_payment_confirmation(uuid,uuid,uuid,text,numeric,timestamptz,text,jsonb,uuid,uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 5. Branch obligation settlement projection
-- ---------------------------------------------------------------------------

create or replace function public.get_sellertray_commercial_obligation_settlement_state(
  p_tenant_id uuid,
  p_installment_obligation_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_order public.sellertray_commercial_orders%rowtype;
  v_line public.sellertray_commercial_order_price_snapshots%rowtype;
  v_adjustments numeric(18,2):=0;
  v_gateway numeric(18,2):=0;
  v_direct numeric(18,2):=0;
  v_net_due numeric(18,2):=0;
  v_total_paid numeric(18,2):=0;
  v_outstanding numeric(18,2):=0;
  v_credit numeric(18,2):=0;
  v_schedule jsonb:='[]'::jsonb;
  v_next_schedule_id uuid;
  v_next_payable numeric(18,2);
  v_status text;
  v_payment_selection jsonb;
begin
  select o.* into strict v_obligation
  from public.sellertray_commercial_installment_obligations o
  where o.tenant_id=p_tenant_id and o.id=p_installment_obligation_id;
  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.tenant_id=p_tenant_id and o.id=v_obligation.commercial_order_id;
  if v_obligation.commercial_order_line_id is not null then
    select l.* into strict v_line
    from public.sellertray_commercial_order_price_snapshots l
    where l.tenant_id=p_tenant_id and l.id=v_obligation.commercial_order_line_id;
  end if;

  select coalesce(sum(a.amount),0)::numeric(18,2) into v_adjustments
  from public.sellertray_commercial_adjustments a
  where a.tenant_id=p_tenant_id and a.commercial_order_id=v_order.id
    and a.installment_obligation_id=p_installment_obligation_id;
  select coalesce(sum(p.amount),0)::numeric(18,2) into v_gateway
  from public.sellertray_commercial_installment_payment_confirmations p
  where p.tenant_id=p_tenant_id and p.commercial_order_id=v_order.id
    and p.installment_obligation_id=p_installment_obligation_id;
  select coalesce(sum(p.amount),0)::numeric(18,2) into v_direct
  from public.sellertray_commercial_direct_payment_confirmations p
  where p.tenant_id=p_tenant_id and p.commercial_order_id=v_order.id
    and p.installment_obligation_id=p_installment_obligation_id;

  v_net_due:=greatest(v_obligation.obligated_amount-v_adjustments,0)::numeric(18,2);
  v_total_paid:=(v_gateway+v_direct)::numeric(18,2);
  v_outstanding:=greatest(v_net_due-v_total_paid,0)::numeric(18,2);
  v_credit:=least(v_adjustments+v_total_paid,v_obligation.obligated_amount)::numeric(18,2);

  with lines as (
    select s.id,s.sequence_no,s.percentage,s.allocation_mode,s.fixed_amount_snapshot,s.amount_due,s.due_at,
           coalesce(sum(s.amount_due) over(order by s.sequence_no rows between unbounded preceding and 1 preceding),0)::numeric(18,2) prior_due
    from public.sellertray_commercial_installment_schedule s
    where s.tenant_id=p_tenant_id and s.installment_obligation_id=p_installment_obligation_id
  ), allocated as (
    select l.*,least(l.amount_due,greatest(v_credit-l.prior_due,0))::numeric(18,2) settled_amount,
           greatest(l.amount_due-least(l.amount_due,greatest(v_credit-l.prior_due,0)),0)::numeric(18,2) remaining_amount
    from lines l
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'scheduleId',a.id,'sequenceNo',a.sequence_no,'allocationMode',a.allocation_mode,
           'percentage',a.percentage,'fixedAmount',a.fixed_amount_snapshot,'amountDue',a.amount_due,
           'settledAmount',a.settled_amount,'remainingAmount',a.remaining_amount,'dueAt',a.due_at,
           'settled',a.remaining_amount<0.005
         ) order by a.sequence_no),'[]'::jsonb),
         (array_agg(a.id order by a.sequence_no) filter(where a.remaining_amount>=0.005))[1],
         (array_agg(least(a.remaining_amount,v_outstanding)::numeric(18,2) order by a.sequence_no) filter(where a.remaining_amount>=0.005))[1]
    into v_schedule,v_next_schedule_id,v_next_payable
  from allocated a;

  if v_outstanding<0.005 then v_status:='settled'; v_next_schedule_id:=null; v_next_payable:=0;
  elsif v_total_paid>0 or v_adjustments>0 then v_status:='partially_settled';
  else v_status:='unsettled'; end if;

  select jsonb_build_object(
    'selectionId',s.id,'paymentMethodVersionId',s.payment_method_version_id,
    'selectedAt',s.selected_at,'methodCode',m.code,'displayName',v.display_name,
    'methodType',v.method_type,'confirmationMode',v.confirmation_mode
  ) into v_payment_selection
  from public.sellertray_commercial_payment_method_selections s
  join public.sellertray_commercial_payment_method_versions v on v.id=s.payment_method_version_id
  join public.sellertray_commercial_payment_methods m on m.id=v.payment_method_id
  where s.tenant_id=p_tenant_id and s.installment_obligation_id=p_installment_obligation_id
  order by s.selected_at desc,s.created_at desc,s.id desc limit 1;

  return jsonb_build_object(
    'tenantId',p_tenant_id,'commercialOrderId',v_order.id,
    'installmentObligationId',v_obligation.id,'obligationScope',v_obligation.obligation_scope,
    'branchId',v_obligation.branch_id,'commercialOrderLineId',v_obligation.commercial_order_line_id,
    'planProfileVersionId',v_line.plan_profile_version_id,'billingCycle',v_line.billing_cycle,
    'currency',v_obligation.currency,'grossAmount',v_obligation.obligated_amount,
    'approvedAdjustmentAmount',v_adjustments,'gatewayPaymentAmount',v_gateway,'directPaymentAmount',v_direct,
    'totalConfirmedPaymentAmount',v_total_paid,'netAmountDue',v_net_due,'outstandingAmount',v_outstanding,
    'settlementStatus',v_status,'schedule',v_schedule,'nextInstallmentScheduleId',v_next_schedule_id,
    'nextPayableAmount',coalesce(v_next_payable,v_outstanding),'paymentMethodSelection',v_payment_selection
  );
end;
$function$;

revoke all on function public.get_sellertray_commercial_obligation_settlement_state(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.get_sellertray_commercial_obligation_settlement_state(uuid,uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 6. Server-authoritative C2 multi-Branch commercial order creation
-- ---------------------------------------------------------------------------

create or replace function public.create_sellertray_c2_branch_commercial_order(
  p_tenant_id uuid,
  p_currency text,
  p_branch_commitments jsonb,
  p_order_reference text,
  p_command_id uuid,
  p_actor_kind text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_currency text:=upper(btrim(coalesce(p_currency,'')));
  v_reference text:=btrim(coalesce(p_order_reference,''));
  v_actor_kind text:=lower(btrim(coalesce(p_actor_kind,'')));
  v_ordered_at timestamptz:=now();
  v_canonical jsonb;
  v_fingerprint text;
  v_existing public.sellertray_commercial_orders%rowtype;
  v_order_id uuid;
  v_total numeric(18,2):=0;
  v_line_no integer:=1;
  v_seen_branches uuid[]:='{}'::uuid[];
  v_item jsonb;
  v_branch_id uuid;
  v_plan_version_id uuid;
  v_cycle text;
  v_setup_required boolean;
  v_supersedes uuid;
  v_subscription_price_id uuid;
  v_setup_price_id uuid;
  v_subscription_price public.sellertray_commercial_price_versions%rowtype;
  v_setup_price public.sellertray_commercial_price_versions%rowtype;
  v_subscription_line_id uuid;
  v_setup_line_id uuid;
  v_obligation_id uuid;
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_policy jsonb;
  v_template_id uuid;
  v_requested_template_id uuid;
  v_template public.sellertray_installment_schedule_templates%rowtype;
  v_template_line record;
  v_schedule_count integer;
  v_allocated numeric(18,2);
  v_amount numeric(18,2);
  v_results jsonb:='[]'::jsonb;
begin
  if p_tenant_id is null or p_command_id is null or p_actor_user_id is null
     or v_actor_kind not in ('system','merchant','platform_admin')
     or v_currency!~'^[A-Z]{3}$' or char_length(v_reference) not between 1 and 128
     or jsonb_typeof(p_branch_commitments)<>'array' or jsonb_array_length(p_branch_commitments)=0 then
    raise exception 'Valid Business, currency, Branch commitments, order reference, command and actor are required' using errcode='22023';
  end if;
  if not exists(select 1 from public.tenants t where t.id=p_tenant_id) then
    raise exception 'Business not found' using errcode='P0002';
  end if;

  select jsonb_agg(x.value order by x.value->>'branchId') into v_canonical
  from jsonb_array_elements(p_branch_commitments) x(value);
  v_fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object(
    'tenantId',p_tenant_id,'currency',v_currency,'orderReference',v_reference,
    'branchCommitments',v_canonical,'actorKind',v_actor_kind,'actorUserId',p_actor_user_id
  )::text,'UTF8'),'sha256'),'hex');

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sellertray-c2-commercial-order|'||p_tenant_id::text||'|'||p_command_id::text,0));
  select o.* into v_existing
  from public.sellertray_commercial_orders o
  where o.tenant_id=p_tenant_id and o.creation_command_id=p_command_id;
  if found then
    if v_existing.order_kind='branch_commercial_v2'
       and v_existing.creation_request_fingerprint=v_fingerprint then
      select coalesce(jsonb_agg(jsonb_build_object(
        'subjectId',s.id,'branchId',s.branch_id,'planProfileVersionId',s.plan_profile_version_id,
        'billingCycle',s.billing_cycle,'branchSubscriptionLineId',s.branch_subscription_line_id,
        'branchSetupLineId',s.branch_setup_line_id,'installmentObligationId',s.installment_obligation_id,
        'installmentTemplateId',s.installment_template_id,'setupRequired',s.setup_required,
        'supersedesBranchSubscriptionId',s.supersedes_branch_subscription_id
      ) order by s.branch_id),'[]'::jsonb) into v_results
      from public.sellertray_branch_commercial_order_subjects s
      where s.tenant_id=p_tenant_id and s.commercial_order_id=v_existing.id;
      return jsonb_build_object(
        'commercialOrderId',v_existing.id,'orderReference',v_existing.order_reference,
        'currency',v_existing.currency,'totalGrossAmount',v_existing.total_gross_amount,
        'subjects',v_results,'idempotentReplay',true
      );
    end if;
    raise exception 'Commercial V2 order command is already used for different facts' using errcode='23505';
  end if;
  if exists(select 1 from public.sellertray_commercial_orders o where o.order_reference=v_reference) then
    raise exception 'Commercial order reference is already used' using errcode='23505';
  end if;

  for v_item in select value from jsonb_array_elements(v_canonical) loop
    begin
      v_branch_id:=(v_item->>'branchId')::uuid;
      v_plan_version_id:=(v_item->>'planProfileVersionId')::uuid;
      v_requested_template_id:=nullif(v_item->>'installmentTemplateId','')::uuid;
      v_supersedes:=nullif(v_item->>'supersedesBranchSubscriptionId','')::uuid;
    exception when invalid_text_representation then
      raise exception 'Branch commitment contains an invalid identifier' using errcode='22023';
    end;
    v_cycle:=lower(btrim(coalesce(v_item->>'billingCycle','')));
    v_setup_required:=coalesce((v_item->>'setupRequired')::boolean,false);
    if v_branch_id=any(v_seen_branches) then raise exception 'Commercial order cannot contain the same Branch twice' using errcode='23514'; end if;
    v_seen_branches:=array_append(v_seen_branches,v_branch_id);
    perform public.assert_sellertray_branch_subscription_subject(p_tenant_id,v_branch_id,v_plan_version_id,v_cycle,v_ordered_at);
    if v_supersedes is not null and not exists(
      select 1 from public.sellertray_branch_subscriptions s
      where s.tenant_id=p_tenant_id and s.id=v_supersedes and s.branch_id=v_branch_id
    ) then raise exception 'Replacement Branch Subscription must belong to the same Branch' using errcode='23514'; end if;

    v_subscription_price_id:=public.resolve_sellertray_commercial_v2_price_version(
      p_tenant_id,'subscription',v_plan_version_id,null,v_cycle,v_currency,v_ordered_at
    );
    if v_subscription_price_id is null then raise exception 'No governed Branch subscription price is effective for this commitment' using errcode='23514'; end if;
    select p.* into strict v_subscription_price from public.sellertray_commercial_price_versions p where p.id=v_subscription_price_id;
    v_total:=v_total+v_subscription_price.gross_amount;
    if v_setup_required then
      v_setup_price_id:=public.resolve_sellertray_commercial_v2_price_version(p_tenant_id,'branch_setup',null,null,null,v_currency,v_ordered_at);
      if v_setup_price_id is null then raise exception 'No governed Branch setup price is effective for this commitment' using errcode='23514'; end if;
      select p.* into strict v_setup_price from public.sellertray_commercial_price_versions p where p.id=v_setup_price_id;
      v_total:=v_total+v_setup_price.gross_amount;
    end if;
  end loop;

  insert into public.sellertray_commercial_orders(
    tenant_id,order_reference,currency,total_gross_amount,ordered_at,created_by_user_id,
    order_kind,creation_command_id,creation_request_fingerprint
  ) values(
    p_tenant_id,v_reference,v_currency,v_total,v_ordered_at,p_actor_user_id,
    'branch_commercial_v2',p_command_id,v_fingerprint
  ) returning id into v_order_id;

  for v_item in select value from jsonb_array_elements(v_canonical) loop
    v_branch_id:=(v_item->>'branchId')::uuid;
    v_plan_version_id:=(v_item->>'planProfileVersionId')::uuid;
    v_cycle:=lower(btrim(v_item->>'billingCycle'));
    v_setup_required:=coalesce((v_item->>'setupRequired')::boolean,false);
    v_requested_template_id:=nullif(v_item->>'installmentTemplateId','')::uuid;
    v_supersedes:=nullif(v_item->>'supersedesBranchSubscriptionId','')::uuid;

    v_subscription_price_id:=public.resolve_sellertray_commercial_v2_price_version(
      p_tenant_id,'subscription',v_plan_version_id,null,v_cycle,v_currency,v_ordered_at
    );
    insert into public.sellertray_commercial_order_price_snapshots(
      tenant_id,commercial_order_id,line_no,line_type,source_price_version_id,branch_id,
      description_snapshot,quantity,currency,unit_gross_amount,gross_amount
    ) values(
      p_tenant_id,v_order_id,v_line_no,'branch_subscription',v_subscription_price_id,v_branch_id,
      '',1,v_currency,0,0
    ) returning id into v_subscription_line_id;
    v_line_no:=v_line_no+1;

    v_setup_line_id:=null;
    if v_setup_required then
      v_setup_price_id:=public.resolve_sellertray_commercial_v2_price_version(p_tenant_id,'branch_setup',null,null,null,v_currency,v_ordered_at);
      insert into public.sellertray_commercial_order_price_snapshots(
        tenant_id,commercial_order_id,line_no,line_type,source_price_version_id,branch_id,
        description_snapshot,quantity,currency,unit_gross_amount,gross_amount
      ) select p_tenant_id,v_order_id,v_line_no,'branch_setup',v_setup_price_id,b.id,
               format('Branch setup · %s',b.name),1,v_currency,0,0
        from public.branches b where b.tenant_id=p_tenant_id and b.id=v_branch_id
      returning id into v_setup_line_id;
      v_line_no:=v_line_no+1;
    end if;

    v_policy:=public.resolve_sellertray_installment_policy_v2(
      p_tenant_id,v_order_id,v_plan_version_id,v_cycle,v_ordered_at
    );
    if v_requested_template_id is not null then
      v_template_id:=v_requested_template_id;
      if coalesce((v_policy->>'enabled')::boolean,false) is false then
        if not exists(select 1 from public.sellertray_installment_schedule_templates t where t.id=v_template_id and t.template_code='full_payment_100') then
          raise exception 'Installments are not enabled for this Branch commercial commitment' using errcode='23514';
        end if;
      end if;
    elsif coalesce((v_policy->>'enabled')::boolean,false) then
      v_template_id:=nullif(v_policy->>'defaultTemplateId','')::uuid;
    else
      select t.id into strict v_template_id
      from public.sellertray_installment_schedule_templates t
      where t.template_code='full_payment_100' and t.version=1;
    end if;
    if v_template_id is null then raise exception 'Installment policy does not resolve a usable schedule template' using errcode='23514'; end if;
    select t.* into strict v_template from public.sellertray_installment_schedule_templates t where t.id=v_template_id;
    if v_template.status<>'published' or v_template.effective_from>v_ordered_at
       or (v_template.effective_until is not null and v_template.effective_until<=v_ordered_at) then
      raise exception 'Installment schedule template is not effective for this commitment' using errcode='23514';
    end if;

    insert into public.sellertray_commercial_installment_obligations(
      tenant_id,commercial_order_id,structure_code,currency,obligated_amount,created_by_user_id,
      obligation_scope,commercial_order_line_id,branch_id
    ) values(
      p_tenant_id,v_order_id,v_template.template_code,v_currency,1,p_actor_user_id,
      'branch_subscription',v_subscription_line_id,v_branch_id
    ) returning * into v_obligation;
    v_obligation_id:=v_obligation.id;

    select count(*)::integer into v_schedule_count
    from public.sellertray_installment_schedule_template_lines l where l.template_id=v_template_id;
    if v_schedule_count=0 then raise exception 'Installment schedule template has no allocation lines' using errcode='23514'; end if;
    v_allocated:=0;
    for v_template_line in
      select l.*,row_number() over(order by l.sequence_no) as row_no
      from public.sellertray_installment_schedule_template_lines l
      where l.template_id=v_template_id order by l.sequence_no
    loop
      if v_template_line.percentage is not null then
        if v_template_line.row_no=v_schedule_count then
          v_amount:=v_obligation.obligated_amount-v_allocated;
        else
          v_amount:=round((v_obligation.obligated_amount*v_template_line.percentage/100)::numeric,2);
        end if;
        insert into public.sellertray_commercial_installment_schedule(
          tenant_id,installment_obligation_id,sequence_no,percentage,amount_due,due_at,allocation_mode,fixed_amount_snapshot
        ) values(
          p_tenant_id,v_obligation_id,v_template_line.sequence_no,v_template_line.percentage,v_amount,
          case when v_template_line.due_offset_days is null then null else v_ordered_at+make_interval(days=>v_template_line.due_offset_days) end,
          'percentage',null
        );
      else
        v_amount:=v_template_line.fixed_amount;
        insert into public.sellertray_commercial_installment_schedule(
          tenant_id,installment_obligation_id,sequence_no,percentage,amount_due,due_at,allocation_mode,fixed_amount_snapshot
        ) values(
          p_tenant_id,v_obligation_id,v_template_line.sequence_no,null,v_amount,
          case when v_template_line.due_offset_days is null then null else v_ordered_at+make_interval(days=>v_template_line.due_offset_days) end,
          'fixed',v_template_line.fixed_amount
        );
      end if;
      v_allocated:=v_allocated+v_amount;
    end loop;
    if abs(v_allocated-v_obligation.obligated_amount)>=0.005 then
      raise exception 'Selected installment template does not reconcile to this Branch obligation amount' using errcode='23514';
    end if;

    insert into public.sellertray_installment_contract_snapshots(
      tenant_id,commercial_order_id,installment_obligation_id,policy_version_id,
      template_id,template_code,template_version,provisional_entitlement_months,
      qualifying_settlement_sequence,snapshotted_at
    ) values(
      p_tenant_id,v_order_id,v_obligation_id,nullif(v_policy->>'policyVersionId','')::uuid,
      v_template.id,v_template.template_code,v_template.version,v_template.provisional_entitlement_months,
      v_template.qualifying_settlement_sequence,v_ordered_at
    );

    insert into public.sellertray_branch_commercial_order_subjects(
      tenant_id,commercial_order_id,branch_id,branch_subscription_line_id,branch_setup_line_id,
      plan_profile_version_id,billing_cycle,installment_obligation_id,installment_template_id,
      installment_policy_version_id,setup_required,supersedes_branch_subscription_id
    ) values(
      p_tenant_id,v_order_id,v_branch_id,v_subscription_line_id,v_setup_line_id,
      v_plan_version_id,v_cycle,v_obligation_id,v_template.id,nullif(v_policy->>'policyVersionId','')::uuid,
      v_setup_required,v_supersedes
    );

    v_results:=v_results||jsonb_build_array(jsonb_build_object(
      'branchId',v_branch_id,'planProfileVersionId',v_plan_version_id,'billingCycle',v_cycle,
      'branchSubscriptionLineId',v_subscription_line_id,'branchSetupLineId',v_setup_line_id,
      'installmentObligationId',v_obligation_id,'installmentTemplateId',v_template.id,
      'installmentTemplateCode',v_template.template_code,'setupRequired',v_setup_required,
      'supersedesBranchSubscriptionId',v_supersedes
    ));
  end loop;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(p_actor_user_id,p_tenant_id,'sellertray_create_c2_branch_commercial_order',jsonb_build_object(
    'commercialOrderId',v_order_id,'orderReference',v_reference,'currency',v_currency,
    'totalGrossAmount',v_total,'commandId',p_command_id,'actorKind',v_actor_kind,
    'branchSubjectCount',jsonb_array_length(v_results)
  ));

  return jsonb_build_object(
    'commercialOrderId',v_order_id,'orderReference',v_reference,'currency',v_currency,
    'totalGrossAmount',v_total,'subjects',v_results,'idempotentReplay',false
  );
end;
$function$;

revoke all on function public.create_sellertray_c2_branch_commercial_order(uuid,text,jsonb,text,uuid,text,uuid)
  from public,anon,authenticated;
grant execute on function public.create_sellertray_c2_branch_commercial_order(uuid,text,jsonb,text,uuid,text,uuid)
  to service_role;

comment on function public.create_sellertray_c2_branch_commercial_order(uuid,text,jsonb,text,uuid,text,uuid) is
  'Creates one immutable Commercial V2 order containing one or more independent Branch subscription subjects. Does not alter tenant_subscriptions or activate runtime access.';

commit;
