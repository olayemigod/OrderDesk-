begin;

-- SellerTray OA2 flexible commercial settlement authority.
--
-- This migration is intentionally forward-only. It does not rewrite accepted
-- commercial agreements, confirmed provider payments, or existing installment
-- schedules. Existing 70:30 and 60:20:20 obligations remain valid immutable
-- history while new commerce can resolve installment availability and schedule
-- shape from governed, versioned policy.

create table public.sellertray_installment_schedule_templates (
  id uuid primary key default gen_random_uuid(),
  template_code text not null,
  version integer not null,
  display_name text not null,
  allocation_type text not null default 'percentage',
  installment_count integer not null,
  provisional_entitlement_months integer not null,
  full_term_months integer not null default 12,
  fixed_currency text,
  due_policy jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  created_by_user_id uuid references auth.users(id) on delete restrict,
  reason text not null,
  created_at timestamptz not null default now(),
  unique (template_code,version),
  constraint sellertray_installment_schedule_templates_code_check
    check (template_code ~ '^[a-z][a-z0-9_]{2,79}$'),
  constraint sellertray_installment_schedule_templates_version_check
    check (version > 0),
  constraint sellertray_installment_schedule_templates_name_check
    check (char_length(btrim(display_name)) between 1 and 120),
  constraint sellertray_installment_schedule_templates_allocation_check
    check (allocation_type in ('percentage','fixed')),
  constraint sellertray_installment_schedule_templates_count_check
    check (installment_count between 2 and 24),
  constraint sellertray_installment_schedule_templates_provisional_check
    check (provisional_entitlement_months between 1 and 60),
  constraint sellertray_installment_schedule_templates_term_check
    check (full_term_months between provisional_entitlement_months and 60),
  constraint sellertray_installment_schedule_templates_currency_check
    check (
      (allocation_type='percentage' and fixed_currency is null)
      or
      (allocation_type='fixed' and fixed_currency ~ '^[A-Z]{3}$')
    ),
  constraint sellertray_installment_schedule_templates_due_policy_check
    check (jsonb_typeof(due_policy)='object'),
  constraint sellertray_installment_schedule_templates_status_check
    check (status in ('active','retired')),
  constraint sellertray_installment_schedule_templates_effective_check
    check (effective_until is null or effective_until > effective_from),
  constraint sellertray_installment_schedule_templates_reason_check
    check (char_length(btrim(reason)) between 1 and 1000)
);

create table public.sellertray_installment_schedule_template_lines (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.sellertray_installment_schedule_templates(id) on delete restrict,
  sequence_no integer not null,
  percentage numeric(7,4),
  fixed_amount numeric(18,2),
  due_offset_days integer,
  created_at timestamptz not null default now(),
  unique (template_id,sequence_no),
  constraint sellertray_installment_schedule_template_lines_sequence_check
    check (sequence_no > 0),
  constraint sellertray_installment_schedule_template_lines_allocation_check
    check (
      (percentage is not null and percentage > 0 and percentage <= 100 and fixed_amount is null)
      or
      (fixed_amount is not null and fixed_amount > 0 and percentage is null)
    ),
  constraint sellertray_installment_schedule_template_lines_due_check
    check (due_offset_days is null or due_offset_days >= 0)
);

create or replace function public.validate_sellertray_installment_schedule_template()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_template_id uuid;
  v_template public.sellertray_installment_schedule_templates%rowtype;
  v_count integer;
  v_percent numeric;
  v_fixed_count integer;
  v_percentage_count integer;
  v_min_sequence integer;
  v_max_sequence integer;
begin
  if tg_table_name='sellertray_installment_schedule_templates' then
    v_template_id := new.id;
  else
    v_template_id := new.template_id;
  end if;

  select t.* into v_template
  from public.sellertray_installment_schedule_templates t
  where t.id=v_template_id;

  if not found then
    return coalesce(new,old);
  end if;

  select count(*)::integer,
         coalesce(sum(l.percentage),0),
         count(*) filter (where l.fixed_amount is not null)::integer,
         count(*) filter (where l.percentage is not null)::integer,
         min(l.sequence_no),
         max(l.sequence_no)
    into v_count,v_percent,v_fixed_count,v_percentage_count,v_min_sequence,v_max_sequence
  from public.sellertray_installment_schedule_template_lines l
  where l.template_id=v_template.id;

  if v_count<>v_template.installment_count
     or v_min_sequence<>1
     or v_max_sequence<>v_template.installment_count then
    raise exception 'SellerTray installment template lines must be contiguous and match installment_count'
      using errcode='23514';
  end if;

  if v_template.allocation_type='percentage' then
    if v_percentage_count<>v_count or v_fixed_count<>0 or abs(v_percent-100) >= 0.0001 then
      raise exception 'Percentage installment template lines must reconcile to 100 percent'
        using errcode='23514';
    end if;
  else
    if v_fixed_count<>v_count or v_percentage_count<>0 then
      raise exception 'Fixed installment template lines must contain only fixed amounts'
        using errcode='23514';
    end if;
  end if;

  return coalesce(new,old);
end;
$$;

revoke all on function public.validate_sellertray_installment_schedule_template()
  from public,anon,authenticated;

drop trigger if exists validate_sellertray_installment_schedule_template_header
  on public.sellertray_installment_schedule_templates;
create constraint trigger validate_sellertray_installment_schedule_template_header
after insert on public.sellertray_installment_schedule_templates
deferrable initially deferred
for each row execute function public.validate_sellertray_installment_schedule_template();

drop trigger if exists validate_sellertray_installment_schedule_template_line
  on public.sellertray_installment_schedule_template_lines;
create constraint trigger validate_sellertray_installment_schedule_template_line
after insert on public.sellertray_installment_schedule_template_lines
deferrable initially deferred
for each row execute function public.validate_sellertray_installment_schedule_template();

drop trigger if exists prevent_sellertray_installment_schedule_template_mutation
  on public.sellertray_installment_schedule_templates;
create trigger prevent_sellertray_installment_schedule_template_mutation
before update or delete on public.sellertray_installment_schedule_templates
for each row execute function public.prevent_sellertray_commercial_history_mutation();

drop trigger if exists prevent_sellertray_installment_schedule_template_line_mutation
  on public.sellertray_installment_schedule_template_lines;
create trigger prevent_sellertray_installment_schedule_template_line_mutation
before update or delete on public.sellertray_installment_schedule_template_lines
for each row execute function public.prevent_sellertray_commercial_history_mutation();

insert into public.sellertray_installment_schedule_templates (
  template_code,version,display_name,allocation_type,installment_count,
  provisional_entitlement_months,full_term_months,due_policy,status,
  effective_from,created_by_user_id,reason
)
values
  (
    'two_installment_70_30',1,'70 / 30','percentage',2,2,12,
    '{"kind":"commercial_schedule","dueDates":"governed_per_order"}'::jsonb,
    'active','2026-10-23 00:00:00+00',null,
    'OA2 compatibility template for the approved two-installment structure'
  ),
  (
    'three_installment_60_20_20',1,'60 / 20 / 20','percentage',3,3,12,
    '{"kind":"commercial_schedule","dueDates":"governed_per_order"}'::jsonb,
    'active','2026-10-23 00:00:00+00',null,
    'OA2 compatibility template for the approved three-installment structure'
  )
on conflict (template_code,version) do nothing;

insert into public.sellertray_installment_schedule_template_lines (
  template_id,sequence_no,percentage,fixed_amount,due_offset_days
)
select t.id,v.sequence_no,v.percentage,null,v.due_offset_days
from public.sellertray_installment_schedule_templates t
join (
  values
    ('two_installment_70_30',1,1,70.0000::numeric,null::integer),
    ('two_installment_70_30',1,2,30.0000::numeric,null::integer),
    ('three_installment_60_20_20',1,1,60.0000::numeric,null::integer),
    ('three_installment_60_20_20',1,2,20.0000::numeric,null::integer),
    ('three_installment_60_20_20',1,3,20.0000::numeric,null::integer)
) as v(template_code,version,sequence_no,percentage,due_offset_days)
  on t.template_code=v.template_code and t.version=v.version
on conflict (template_id,sequence_no) do nothing;

create table public.sellertray_installment_policy_versions (
  id uuid primary key default gen_random_uuid(),
  scope_type text not null,
  tenant_id uuid references public.tenants(id) on delete restrict,
  plan_code text references public.subscription_plans(code) on delete restrict,
  billing_cycle text,
  enabled boolean not null,
  schedule_template_id uuid references public.sellertray_installment_schedule_templates(id) on delete restrict,
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  created_by_user_id uuid references auth.users(id) on delete restrict,
  reason text not null,
  created_at timestamptz not null default now(),
  constraint sellertray_installment_policy_versions_scope_check
    check (scope_type in ('platform','billing_cycle','plan','merchant')),
  constraint sellertray_installment_policy_versions_cycle_check
    check (billing_cycle is null or billing_cycle in ('monthly','yearly')),
  constraint sellertray_installment_policy_versions_subject_check
    check (
      (scope_type='platform' and tenant_id is null and plan_code is null and billing_cycle is null)
      or
      (scope_type='billing_cycle' and tenant_id is null and plan_code is null and billing_cycle is not null)
      or
      (scope_type='plan' and tenant_id is null and plan_code is not null)
      or
      (scope_type='merchant' and tenant_id is not null)
    ),
  constraint sellertray_installment_policy_versions_template_check
    check ((enabled and schedule_template_id is not null) or (not enabled)),
  constraint sellertray_installment_policy_versions_effective_check
    check (effective_until is null or effective_until > effective_from),
  constraint sellertray_installment_policy_versions_reason_check
    check (char_length(btrim(reason)) between 1 and 1000)
);

create index sellertray_installment_policy_versions_resolution_idx
  on public.sellertray_installment_policy_versions(
    effective_from desc,scope_type,tenant_id,plan_code,billing_cycle
  );

create unique index sellertray_installment_policy_versions_identity_key
  on public.sellertray_installment_policy_versions(
    scope_type,
    coalesce(tenant_id,'00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(plan_code,''),
    coalesce(billing_cycle,''),
    effective_from
  );

drop trigger if exists prevent_sellertray_installment_policy_version_mutation
  on public.sellertray_installment_policy_versions;
create trigger prevent_sellertray_installment_policy_version_mutation
before update or delete on public.sellertray_installment_policy_versions
for each row execute function public.prevent_sellertray_commercial_history_mutation();

insert into public.sellertray_installment_policy_versions (
  scope_type,tenant_id,plan_code,billing_cycle,enabled,schedule_template_id,
  effective_from,created_by_user_id,reason
)
select 'billing_cycle',null,null,'yearly',true,t.id,
       '2026-10-23 00:00:00+00',null,
       'OA2 backward-compatible yearly default; now governed as data instead of code'
from public.sellertray_installment_schedule_templates t
where t.template_code='two_installment_70_30' and t.version=1
on conflict do nothing;

insert into public.sellertray_installment_policy_versions (
  scope_type,tenant_id,plan_code,billing_cycle,enabled,schedule_template_id,
  effective_from,created_by_user_id,reason
)
values (
  'billing_cycle',null,null,'monthly',false,null,
  '2026-10-23 00:00:00+00',null,
  'OA2 monthly installment default remains disabled unless explicitly enabled by governed policy'
)
on conflict do nothing;

create or replace function public.resolve_sellertray_installment_policy(
  p_tenant_id uuid,
  p_plan_code text,
  p_billing_cycle text,
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_policy public.sellertray_installment_policy_versions%rowtype;
  v_template public.sellertray_installment_schedule_templates%rowtype;
  v_lines jsonb := '[]'::jsonb;
begin
  select p.* into v_policy
  from public.sellertray_installment_policy_versions p
  where p.effective_from <= p_as_of
    and (p.effective_until is null or p.effective_until > p_as_of)
    and (
      p.scope_type='platform'
      or (p.scope_type='billing_cycle' and p.billing_cycle=p_billing_cycle)
      or (
        p.scope_type='plan'
        and p.plan_code=p_plan_code
        and (p.billing_cycle is null or p.billing_cycle=p_billing_cycle)
      )
      or (
        p.scope_type='merchant'
        and p.tenant_id=p_tenant_id
        and (p.plan_code is null or p.plan_code=p_plan_code)
        and (p.billing_cycle is null or p.billing_cycle=p_billing_cycle)
      )
    )
  order by
    case p.scope_type
      when 'merchant' then 400
      when 'plan' then 300
      when 'billing_cycle' then 200
      else 100
    end
    + case when p.plan_code is not null then 20 else 0 end
    + case when p.billing_cycle is not null then 10 else 0 end desc,
    p.effective_from desc,
    p.created_at desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'enabled',false,
      'source','default_disabled',
      'policyVersionId',null,
      'scheduleTemplate',null
    );
  end if;

  if not v_policy.enabled then
    return jsonb_build_object(
      'enabled',false,
      'source',v_policy.scope_type,
      'policyVersionId',v_policy.id,
      'scheduleTemplate',null
    );
  end if;

  select t.* into strict v_template
  from public.sellertray_installment_schedule_templates t
  where t.id=v_policy.schedule_template_id
    and t.status='active'
    and t.effective_from <= p_as_of
    and (t.effective_until is null or t.effective_until > p_as_of);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'sequenceNo',l.sequence_no,
        'percentage',l.percentage,
        'fixedAmount',l.fixed_amount,
        'dueOffsetDays',l.due_offset_days
      ) order by l.sequence_no
    ),
    '[]'::jsonb
  )
  into v_lines
  from public.sellertray_installment_schedule_template_lines l
  where l.template_id=v_template.id;

  return jsonb_build_object(
    'enabled',true,
    'source',v_policy.scope_type,
    'policyVersionId',v_policy.id,
    'scheduleTemplate',jsonb_build_object(
      'id',v_template.id,
      'code',v_template.template_code,
      'version',v_template.version,
      'displayName',v_template.display_name,
      'allocationType',v_template.allocation_type,
      'installmentCount',v_template.installment_count,
      'provisionalEntitlementMonths',v_template.provisional_entitlement_months,
      'fullTermMonths',v_template.full_term_months,
      'fixedCurrency',v_template.fixed_currency,
      'duePolicy',v_template.due_policy,
      'lines',v_lines
    )
  );
exception
  when no_data_found then
    raise exception 'Enabled SellerTray installment policy references an unavailable schedule template'
      using errcode='55000';
end;
$$;

revoke all on function public.resolve_sellertray_installment_policy(uuid,text,text,timestamptz)
  from public,anon,authenticated;
grant execute on function public.resolve_sellertray_installment_policy(uuid,text,text,timestamptz)
  to service_role;

-- New obligations snapshot the policy/template that created them. Legacy accepted
-- obligations remain nullable here and keep their exact immutable schedule rows.
alter table public.sellertray_commercial_installment_obligations
  add column if not exists schedule_template_id uuid references public.sellertray_installment_schedule_templates(id) on delete restrict,
  add column if not exists schedule_template_code text,
  add column if not exists schedule_template_version integer,
  add column if not exists installment_count integer,
  add column if not exists provisional_entitlement_months integer,
  add column if not exists installment_policy_snapshot jsonb;

alter table public.sellertray_commercial_installment_obligations
  drop constraint if exists sellertray_commercial_installment_obligations_structure_check,
  add constraint sellertray_commercial_installment_obligations_structure_check
    check (structure_code ~ '^[a-z][a-z0-9_]{2,79}$'),
  add constraint sellertray_commercial_installment_obligations_template_snapshot_check
    check (
      (
        schedule_template_id is null
        and schedule_template_code is null
        and schedule_template_version is null
        and installment_count is null
        and provisional_entitlement_months is null
        and installment_policy_snapshot is null
        and structure_code in ('two_installment_70_30','three_installment_60_20_20')
      )
      or
      (
        schedule_template_id is not null
        and schedule_template_code is not null
        and schedule_template_version is not null and schedule_template_version > 0
        and installment_count between 2 and 24
        and provisional_entitlement_months between 1 and 60
        and jsonb_typeof(installment_policy_snapshot)='object'
      )
    );

create or replace function public.prepare_sellertray_commercial_installment_obligation()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_order public.sellertray_commercial_orders%rowtype;
  v_template public.sellertray_installment_schedule_templates%rowtype;
  v_adjustments numeric(18,2) := 0;
begin
  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.id=new.commercial_order_id and o.tenant_id=new.tenant_id;

  select coalesce(sum(a.amount),0)::numeric(18,2)
    into v_adjustments
  from public.sellertray_commercial_adjustments a
  where a.tenant_id=new.tenant_id and a.commercial_order_id=new.commercial_order_id;

  new.currency := v_order.currency;
  new.obligated_amount := round((v_order.total_gross_amount-v_adjustments)::numeric,2);

  if new.obligated_amount <= 0 then
    raise exception 'A fully adjusted SellerTray commercial order does not require an installment obligation'
      using errcode='23514';
  end if;

  if new.schedule_template_id is not null then
    select t.* into strict v_template
    from public.sellertray_installment_schedule_templates t
    where t.id=new.schedule_template_id;

    new.structure_code := v_template.template_code;
    new.schedule_template_code := v_template.template_code;
    new.schedule_template_version := v_template.version;
    new.installment_count := v_template.installment_count;
    new.provisional_entitlement_months := v_template.provisional_entitlement_months;

    if new.installment_policy_snapshot is null then
      raise exception 'Template-backed SellerTray installment obligation requires a policy snapshot'
        using errcode='23514';
    end if;

    if v_template.allocation_type='fixed' and v_template.fixed_currency<>v_order.currency then
      raise exception 'Fixed installment template currency does not match the commercial order'
        using errcode='23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.prepare_sellertray_commercial_installment_obligation()
  from public,anon,authenticated;

create or replace function public.validate_sellertray_commercial_installment_schedule()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_obligation_id uuid := coalesce(new.installment_obligation_id,new.id);
  v_tenant_id uuid := coalesce(new.tenant_id,old.tenant_id);
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_template public.sellertray_installment_schedule_templates%rowtype;
  v_count integer;
  v_percent numeric;
  v_amount numeric;
  v_min_sequence integer;
  v_max_sequence integer;
  v_expected numeric(18,2);
  v_line record;
begin
  select o.* into v_obligation
  from public.sellertray_commercial_installment_obligations o
  where o.id=v_obligation_id and o.tenant_id=v_tenant_id;

  if not found then
    return coalesce(new,old);
  end if;

  select count(*)::integer,
         coalesce(sum(s.percentage),0),
         coalesce(sum(s.amount_due),0)::numeric(18,2),
         min(s.sequence_no),
         max(s.sequence_no)
    into v_count,v_percent,v_amount,v_min_sequence,v_max_sequence
  from public.sellertray_commercial_installment_schedule s
  where s.installment_obligation_id=v_obligation.id
    and s.tenant_id=v_obligation.tenant_id;

  if v_count < 2
     or v_min_sequence<>1
     or v_max_sequence<>v_count
     or abs(v_percent-100) >= 0.0001
     or abs(v_amount-v_obligation.obligated_amount) >= 0.005 then
    raise exception 'SellerTray installment schedule must be contiguous and reconcile to 100 percent and the commercial obligation'
      using errcode='23514';
  end if;

  if v_obligation.installment_count is not null and v_count<>v_obligation.installment_count then
    raise exception 'SellerTray installment schedule count must match the governed obligation snapshot'
      using errcode='23514';
  end if;

  if v_obligation.schedule_template_id is not null then
    select t.* into strict v_template
    from public.sellertray_installment_schedule_templates t
    where t.id=v_obligation.schedule_template_id;

    if v_template.installment_count<>v_count then
      raise exception 'SellerTray installment schedule does not match its governed template count'
        using errcode='23514';
    end if;

    for v_line in
      select s.sequence_no,s.percentage,s.amount_due,
             tl.percentage as template_percentage,
             tl.fixed_amount as template_fixed_amount
      from public.sellertray_commercial_installment_schedule s
      join public.sellertray_installment_schedule_template_lines tl
        on tl.template_id=v_template.id and tl.sequence_no=s.sequence_no
      where s.installment_obligation_id=v_obligation.id
        and s.tenant_id=v_obligation.tenant_id
      order by s.sequence_no
    loop
      if v_template.allocation_type='percentage' then
        if abs(v_line.percentage-v_line.template_percentage) >= 0.0001 then
          raise exception 'SellerTray installment schedule percentage differs from its governed template'
            using errcode='23514';
        end if;
        if v_line.sequence_no < v_count then
          v_expected := round((v_obligation.obligated_amount*v_line.template_percentage/100)::numeric,2);
        else
          select round((v_obligation.obligated_amount-coalesce(sum(s.amount_due),0))::numeric,2)
            into v_expected
          from public.sellertray_commercial_installment_schedule s
          where s.installment_obligation_id=v_obligation.id
            and s.tenant_id=v_obligation.tenant_id
            and s.sequence_no < v_line.sequence_no;
        end if;
      else
        v_expected := v_line.template_fixed_amount;
      end if;

      if abs(v_line.amount_due-v_expected) >= 0.005 then
        raise exception 'SellerTray installment schedule amount differs from its governed deterministic allocation'
          using errcode='23514';
      end if;
    end loop;
  end if;

  return coalesce(new,old);
end;
$$;

revoke all on function public.validate_sellertray_commercial_installment_schedule()
  from public,anon,authenticated;

-- Settlement facts are append-only. They intentionally remain separate from
-- provider confirmations so a direct ProcessEdge payment can never masquerade
-- as a Paystack/provider event.
create table public.sellertray_commercial_adjustments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  commercial_order_id uuid not null,
  command_id uuid not null,
  adjustment_kind text not null default 'discount',
  amount numeric(18,2) not null,
  currency text not null,
  reason text not null,
  evidence jsonb not null default '{}'::jsonb,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  approved_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,command_id),
  constraint sellertray_commercial_adjustments_order_same_tenant
    foreign key (tenant_id,commercial_order_id)
    references public.sellertray_commercial_orders(tenant_id,id)
    on delete restrict,
  constraint sellertray_commercial_adjustments_kind_check
    check (adjustment_kind in ('discount','commercial_credit')),
  constraint sellertray_commercial_adjustments_amount_check
    check (amount > 0),
  constraint sellertray_commercial_adjustments_currency_check
    check (currency ~ '^[A-Z]{3}$'),
  constraint sellertray_commercial_adjustments_reason_check
    check (char_length(btrim(reason)) between 1 and 1000),
  constraint sellertray_commercial_adjustments_evidence_check
    check (jsonb_typeof(evidence)='object'),
  constraint sellertray_commercial_adjustments_time_check
    check (approved_at <= recorded_at + interval '5 minutes')
);

create table public.sellertray_commercial_direct_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  commercial_order_id uuid not null,
  command_id uuid not null,
  payment_reference text not null,
  amount numeric(18,2) not null,
  currency text not null,
  paid_at timestamptz not null,
  reason text not null,
  evidence jsonb not null default '{}'::jsonb,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,command_id),
  unique (tenant_id,payment_reference),
  constraint sellertray_commercial_direct_payments_order_same_tenant
    foreign key (tenant_id,commercial_order_id)
    references public.sellertray_commercial_orders(tenant_id,id)
    on delete restrict,
  constraint sellertray_commercial_direct_payments_reference_check
    check (char_length(btrim(payment_reference)) between 1 and 160),
  constraint sellertray_commercial_direct_payments_amount_check
    check (amount > 0),
  constraint sellertray_commercial_direct_payments_currency_check
    check (currency ~ '^[A-Z]{3}$'),
  constraint sellertray_commercial_direct_payments_reason_check
    check (char_length(btrim(reason)) between 1 and 1000),
  constraint sellertray_commercial_direct_payments_evidence_check
    check (jsonb_typeof(evidence)='object'),
  constraint sellertray_commercial_direct_payments_time_check
    check (paid_at <= recorded_at + interval '5 minutes')
);

create index sellertray_commercial_adjustments_order_idx
  on public.sellertray_commercial_adjustments(tenant_id,commercial_order_id,approved_at);
create index sellertray_commercial_direct_payments_order_idx
  on public.sellertray_commercial_direct_payments(tenant_id,commercial_order_id,paid_at);

create trigger prevent_sellertray_commercial_adjustment_mutation
before update or delete on public.sellertray_commercial_adjustments
for each row execute function public.prevent_sellertray_commercial_history_mutation();

create trigger prevent_sellertray_commercial_direct_payment_mutation
before update or delete on public.sellertray_commercial_direct_payments
for each row execute function public.prevent_sellertray_commercial_history_mutation();

create or replace function public.get_sellertray_commercial_settlement_summary_core(
  p_commercial_order_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_order public.sellertray_commercial_orders%rowtype;
  v_adjustments numeric(18,2) := 0;
  v_gateway numeric(18,2) := 0;
  v_direct numeric(18,2) := 0;
  v_outstanding numeric(18,2) := 0;
begin
  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.id=p_commercial_order_id;

  select coalesce(sum(a.amount),0)::numeric(18,2)
    into v_adjustments
  from public.sellertray_commercial_adjustments a
  where a.tenant_id=v_order.tenant_id
    and a.commercial_order_id=v_order.id;

  select coalesce(sum(p.amount),0)::numeric(18,2)
    into v_gateway
  from public.sellertray_commercial_installment_payment_confirmations p
  where p.tenant_id=v_order.tenant_id
    and p.commercial_order_id=v_order.id;

  select coalesce(sum(p.amount),0)::numeric(18,2)
    into v_direct
  from public.sellertray_commercial_direct_payments p
  where p.tenant_id=v_order.tenant_id
    and p.commercial_order_id=v_order.id;

  v_outstanding := greatest(
    round((v_order.total_gross_amount-v_adjustments-v_gateway-v_direct)::numeric,2),
    0
  );

  return jsonb_build_object(
    'tenantId',v_order.tenant_id,
    'commercialOrderId',v_order.id,
    'currency',v_order.currency,
    'grossAmount',v_order.total_gross_amount,
    'approvedAdjustmentAmount',v_adjustments,
    'gatewayPaymentAmount',v_gateway,
    'directPaymentAmount',v_direct,
    'confirmedPaymentAmount',round((v_gateway+v_direct)::numeric,2),
    'outstandingAmount',v_outstanding,
    'fullySettled',v_outstanding < 0.005
  );
end;
$$;

revoke all on function public.get_sellertray_commercial_settlement_summary_core(uuid)
  from public,anon,authenticated;
grant execute on function public.get_sellertray_commercial_settlement_summary_core(uuid)
  to service_role;

create or replace function public.validate_sellertray_commercial_settlement_fact()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order public.sellertray_commercial_orders%rowtype;
  v_adjustments numeric(18,2) := 0;
  v_gateway numeric(18,2) := 0;
  v_direct numeric(18,2) := 0;
  v_available numeric(18,2);
begin
  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.tenant_id=new.tenant_id and o.id=new.commercial_order_id
  for update;

  new.currency := v_order.currency;
  new.reason := btrim(new.reason);

  if tg_table_name='sellertray_commercial_direct_payments' then
    new.payment_reference := btrim(new.payment_reference);
  end if;

  select coalesce(sum(a.amount),0)::numeric(18,2)
    into v_adjustments
  from public.sellertray_commercial_adjustments a
  where a.tenant_id=v_order.tenant_id and a.commercial_order_id=v_order.id;

  select coalesce(sum(p.amount),0)::numeric(18,2)
    into v_gateway
  from public.sellertray_commercial_installment_payment_confirmations p
  where p.tenant_id=v_order.tenant_id and p.commercial_order_id=v_order.id;

  select coalesce(sum(p.amount),0)::numeric(18,2)
    into v_direct
  from public.sellertray_commercial_direct_payments p
  where p.tenant_id=v_order.tenant_id and p.commercial_order_id=v_order.id;

  v_available := round((v_order.total_gross_amount-v_adjustments-v_gateway-v_direct)::numeric,2);

  if new.amount > v_available + 0.004 then
    raise exception 'SellerTray commercial settlement fact exceeds the authoritative outstanding balance'
      using errcode='23514';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_sellertray_commercial_settlement_fact()
  from public,anon,authenticated;

drop trigger if exists validate_sellertray_commercial_adjustment
  on public.sellertray_commercial_adjustments;
create trigger validate_sellertray_commercial_adjustment
before insert on public.sellertray_commercial_adjustments
for each row execute function public.validate_sellertray_commercial_settlement_fact();

drop trigger if exists validate_sellertray_commercial_direct_payment
  on public.sellertray_commercial_direct_payments;
create trigger validate_sellertray_commercial_direct_payment
before insert on public.sellertray_commercial_direct_payments
for each row execute function public.validate_sellertray_commercial_settlement_fact();

-- A changed settlement fact makes any in-flight provider amount stale. OA2 uses
-- an explicit terminal state instead of allowing a delayed webhook to revive it.
alter table public.billing_checkout_sessions
  drop constraint if exists billing_checkout_sessions_status_check;
alter table public.billing_checkout_sessions
  add constraint billing_checkout_sessions_status_check
    check (status in ('preparing','initialized','paid','failed','expired','superseded'));

create table public.sellertray_commercial_checkout_supersessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  commercial_order_id uuid not null,
  billing_checkout_session_id uuid not null references public.billing_checkout_sessions(id) on delete restrict,
  cause_kind text not null,
  cause_id uuid,
  reason text not null,
  actor_user_id uuid references auth.users(id) on delete restrict,
  superseded_at timestamptz not null default now(),
  unique (billing_checkout_session_id),
  constraint sellertray_commercial_checkout_supersessions_order_same_tenant
    foreign key (tenant_id,commercial_order_id)
    references public.sellertray_commercial_orders(tenant_id,id)
    on delete restrict,
  constraint sellertray_commercial_checkout_supersessions_cause_check
    check (cause_kind in ('adjustment','direct_payment','policy_change','schedule_replacement','manual')),
  constraint sellertray_commercial_checkout_supersessions_reason_check
    check (char_length(btrim(reason)) between 1 and 1000)
);

create trigger prevent_sellertray_commercial_checkout_supersession_mutation
before update or delete on public.sellertray_commercial_checkout_supersessions
for each row execute function public.prevent_sellertray_commercial_history_mutation();

create or replace function public.supersede_sellertray_installment_checkout_attempts(
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_cause_kind text,
  p_cause_id uuid,
  p_reason text,
  p_actor_user_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  v_session record;
  v_count integer := 0;
begin
  if p_cause_kind not in ('adjustment','direct_payment','policy_change','schedule_replacement','manual') then
    raise exception 'Unsupported SellerTray checkout supersession cause' using errcode='22023';
  end if;
  if nullif(btrim(p_reason),'') is null then
    raise exception 'SellerTray checkout supersession reason is required' using errcode='22023';
  end if;

  for v_session in
    update public.billing_checkout_sessions s
       set status='superseded'
     where s.tenant_id=p_tenant_id
       and s.checkout_kind='installment'
       and s.commercial_order_id=p_commercial_order_id
       and s.status in ('preparing','initialized')
    returning s.id
  loop
    insert into public.sellertray_commercial_checkout_supersessions (
      tenant_id,commercial_order_id,billing_checkout_session_id,cause_kind,
      cause_id,reason,actor_user_id
    ) values (
      p_tenant_id,p_commercial_order_id,v_session.id,p_cause_kind,
      p_cause_id,btrim(p_reason),p_actor_user_id
    )
    on conflict (billing_checkout_session_id) do nothing;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.supersede_sellertray_installment_checkout_attempts(uuid,uuid,text,uuid,text,uuid)
  from public,anon,authenticated;
grant execute on function public.supersede_sellertray_installment_checkout_attempts(uuid,uuid,text,uuid,text,uuid)
  to service_role;

create or replace function public.supersede_sellertray_checkout_after_settlement_fact()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  perform public.supersede_sellertray_installment_checkout_attempts(
    new.tenant_id,
    new.commercial_order_id,
    case when tg_table_name='sellertray_commercial_adjustments' then 'adjustment' else 'direct_payment' end,
    new.id,
    case when tg_table_name='sellertray_commercial_adjustments'
      then 'Commercial adjustment changed the authoritative amount due'
      else 'Direct payment changed the authoritative amount due'
    end,
    new.actor_user_id
  );
  return new;
end;
$$;

revoke all on function public.supersede_sellertray_checkout_after_settlement_fact()
  from public,anon,authenticated;

drop trigger if exists supersede_sellertray_checkout_after_adjustment
  on public.sellertray_commercial_adjustments;
create trigger supersede_sellertray_checkout_after_adjustment
after insert on public.sellertray_commercial_adjustments
for each row execute function public.supersede_sellertray_checkout_after_settlement_fact();

drop trigger if exists supersede_sellertray_checkout_after_direct_payment
  on public.sellertray_commercial_direct_payments;
create trigger supersede_sellertray_checkout_after_direct_payment
after insert on public.sellertray_commercial_direct_payments
for each row execute function public.supersede_sellertray_checkout_after_settlement_fact();

alter table public.sellertray_installment_schedule_templates enable row level security;
alter table public.sellertray_installment_schedule_template_lines enable row level security;
alter table public.sellertray_installment_policy_versions enable row level security;
alter table public.sellertray_commercial_adjustments enable row level security;
alter table public.sellertray_commercial_direct_payments enable row level security;
alter table public.sellertray_commercial_checkout_supersessions enable row level security;

revoke all on table public.sellertray_installment_schedule_templates from public,anon,authenticated;
revoke all on table public.sellertray_installment_schedule_template_lines from public,anon,authenticated;
revoke all on table public.sellertray_installment_policy_versions from public,anon,authenticated;
revoke all on table public.sellertray_commercial_adjustments from public,anon,authenticated;
revoke all on table public.sellertray_commercial_direct_payments from public,anon,authenticated;
revoke all on table public.sellertray_commercial_checkout_supersessions from public,anon,authenticated;

grant select on table public.sellertray_installment_schedule_templates to service_role;
grant select on table public.sellertray_installment_schedule_template_lines to service_role;
grant select on table public.sellertray_installment_policy_versions to service_role;
grant select on table public.sellertray_commercial_adjustments to service_role;
grant select on table public.sellertray_commercial_direct_payments to service_role;
grant select on table public.sellertray_commercial_checkout_supersessions to service_role;

commit;
