begin;

-- SellerTray OA2 Flexible Commercial Settlement Authority
--
-- Forward-only convergence layer. Existing orders, accepted agreements,
-- installment obligations/schedules, provider confirmations and entitlement
-- history remain immutable. OA2 adds versioned installment policy/templates,
-- immutable contract snapshots, audited commercial credits and one settlement
-- projection shared by Admin, Merchant Web, Mobile status, WhatsApp and AI.

-- ---------------------------------------------------------------------------
-- 1. Versioned installment schedule templates
-- ---------------------------------------------------------------------------

create table public.sellertray_installment_schedule_templates (
  id uuid primary key default gen_random_uuid(),
  template_code text not null,
  version integer not null,
  display_name text not null,
  status text not null default 'published',
  provisional_entitlement_months integer not null default 0,
  qualifying_settlement_sequence integer not null default 1,
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  created_by_user_id uuid references auth.users(id) on delete restrict,
  change_reason text not null,
  created_at timestamptz not null default now(),
  unique (template_code,version),
  constraint sellertray_installment_templates_code_check
    check (template_code ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint sellertray_installment_templates_version_check check (version > 0),
  constraint sellertray_installment_templates_name_check
    check (char_length(btrim(display_name)) between 1 and 120),
  constraint sellertray_installment_templates_status_check
    check (status in ('published','retired')),
  constraint sellertray_installment_templates_provisional_check
    check (provisional_entitlement_months between 0 and 120),
  constraint sellertray_installment_templates_qualifying_check
    check (qualifying_settlement_sequence > 0),
  constraint sellertray_installment_templates_reason_check
    check (char_length(btrim(change_reason)) between 1 and 1000),
  constraint sellertray_installment_templates_effective_check
    check (effective_until is null or effective_until > effective_from)
);

create table public.sellertray_installment_schedule_template_lines (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.sellertray_installment_schedule_templates(id) on delete restrict,
  sequence_no integer not null,
  percentage numeric(9,6),
  fixed_amount numeric(18,2),
  due_offset_days integer,
  created_at timestamptz not null default now(),
  unique (template_id,sequence_no),
  constraint sellertray_installment_template_lines_sequence_check check (sequence_no > 0),
  constraint sellertray_installment_template_lines_allocation_check
    check (
      (percentage is not null and percentage > 0 and percentage <= 100 and fixed_amount is null)
      or
      (fixed_amount is not null and fixed_amount > 0 and percentage is null)
    ),
  constraint sellertray_installment_template_lines_due_check
    check (due_offset_days is null or due_offset_days >= 0)
);

create index sellertray_installment_templates_effective_idx
  on public.sellertray_installment_schedule_templates(template_code,status,effective_from desc);

create or replace function public.validate_sellertray_installment_schedule_template()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_template_id uuid;
  v_count integer;
  v_percent_count integer;
  v_fixed_count integer;
  v_percent numeric;
  v_qualifying integer;
begin
  if tg_table_name='sellertray_installment_schedule_templates' then
    v_template_id := new.id;
  else
    v_template_id := new.template_id;
  end if;

  select count(*)::integer,
         count(*) filter (where l.percentage is not null)::integer,
         count(*) filter (where l.fixed_amount is not null)::integer,
         coalesce(sum(l.percentage),0)
    into v_count,v_percent_count,v_fixed_count,v_percent
  from public.sellertray_installment_schedule_template_lines l
  where l.template_id=v_template_id;

  select t.qualifying_settlement_sequence
    into v_qualifying
  from public.sellertray_installment_schedule_templates t
  where t.id=v_template_id;

  if v_qualifying is null then
    return new;
  end if;
  if v_count=0 then
    raise exception 'SellerTray installment template requires at least one line' using errcode='23514';
  end if;
  if v_percent_count not in (0,v_count) or v_fixed_count not in (0,v_count) then
    raise exception 'SellerTray installment template cannot mix percentage and fixed allocation lines' using errcode='23514';
  end if;
  if v_percent_count=v_count and abs(v_percent-100) >= 0.000001 then
    raise exception 'SellerTray percentage installment template must total 100 percent' using errcode='23514';
  end if;
  if v_qualifying > v_count then
    raise exception 'SellerTray qualifying settlement sequence exceeds template line count' using errcode='23514';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_sellertray_installment_schedule_template()
  from public,anon,authenticated;

create constraint trigger validate_sellertray_installment_template_header
after insert on public.sellertray_installment_schedule_templates
deferrable initially deferred
for each row execute function public.validate_sellertray_installment_schedule_template();

create constraint trigger validate_sellertray_installment_template_line
after insert on public.sellertray_installment_schedule_template_lines
deferrable initially deferred
for each row execute function public.validate_sellertray_installment_schedule_template();

create trigger prevent_sellertray_installment_template_mutation
before update or delete on public.sellertray_installment_schedule_templates
for each row execute function public.prevent_sellertray_commercial_history_mutation();

create trigger prevent_sellertray_installment_template_line_mutation
before update or delete on public.sellertray_installment_schedule_template_lines
for each row execute function public.prevent_sellertray_commercial_history_mutation();

insert into public.sellertray_installment_schedule_templates (
  template_code,version,display_name,status,provisional_entitlement_months,
  qualifying_settlement_sequence,effective_from,change_reason
) values
  ('two_installment_70_30',1,'70 / 30','published',2,1,'2026-10-21 00:00:00+00','System seed from approved C1B 70:30 structure'),
  ('three_installment_60_20_20',1,'60 / 20 / 20','published',3,1,'2026-10-21 00:00:00+00','System seed from approved C1B 60:20:20 structure');

insert into public.sellertray_installment_schedule_template_lines(template_id,sequence_no,percentage)
select t.id,x.sequence_no,x.percentage
from public.sellertray_installment_schedule_templates t
join lateral (
  values
    ('two_installment_70_30'::text,1,70::numeric),
    ('two_installment_70_30',2,30),
    ('three_installment_60_20_20',1,60),
    ('three_installment_60_20_20',2,20),
    ('three_installment_60_20_20',3,20)
) x(template_code,sequence_no,percentage) on x.template_code=t.template_code
where t.version=1;

-- ---------------------------------------------------------------------------
-- 2. Effective-dated installment availability policy
-- ---------------------------------------------------------------------------

create table public.sellertray_installment_policy_versions (
  id uuid primary key default gen_random_uuid(),
  scope_kind text not null,
  tenant_id uuid references public.tenants(id) on delete restrict,
  commercial_order_id uuid,
  plan_code text references public.subscription_plans(code) on delete restrict,
  billing_cycle text,
  enabled boolean not null,
  default_template_id uuid references public.sellertray_installment_schedule_templates(id) on delete restrict,
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  created_by_user_id uuid references auth.users(id) on delete restrict,
  change_reason text not null,
  created_at timestamptz not null default now(),
  constraint sellertray_installment_policy_order_same_tenant
    foreign key (tenant_id,commercial_order_id)
    references public.sellertray_commercial_orders(tenant_id,id)
    on delete restrict,
  constraint sellertray_installment_policy_scope_kind_check
    check (scope_kind in ('platform','plan_cycle','tenant','commercial_order')),
  constraint sellertray_installment_policy_cycle_check
    check (billing_cycle is null or billing_cycle in ('monthly','yearly')),
  constraint sellertray_installment_policy_reason_check
    check (char_length(btrim(change_reason)) between 1 and 1000),
  constraint sellertray_installment_policy_effective_check
    check (effective_until is null or effective_until > effective_from),
  constraint sellertray_installment_policy_scope_shape_check
    check (
      (scope_kind='platform' and tenant_id is null and commercial_order_id is null and plan_code is null and billing_cycle is not null)
      or
      (scope_kind='plan_cycle' and tenant_id is null and commercial_order_id is null and plan_code is not null and billing_cycle is not null)
      or
      (scope_kind='tenant' and tenant_id is not null and commercial_order_id is null and plan_code is null and billing_cycle is not null)
      or
      (scope_kind='commercial_order' and tenant_id is not null and commercial_order_id is not null and plan_code is null and billing_cycle is null)
    ),
  constraint sellertray_installment_policy_template_check
    check ((enabled and default_template_id is not null) or not enabled)
);

create index sellertray_installment_policy_resolution_idx
  on public.sellertray_installment_policy_versions(scope_kind,billing_cycle,effective_from desc);
create index sellertray_installment_policy_tenant_idx
  on public.sellertray_installment_policy_versions(tenant_id,effective_from desc)
  where tenant_id is not null;
create index sellertray_installment_policy_order_idx
  on public.sellertray_installment_policy_versions(commercial_order_id,effective_from desc)
  where commercial_order_id is not null;

create trigger prevent_sellertray_installment_policy_mutation
before update or delete on public.sellertray_installment_policy_versions
for each row execute function public.prevent_sellertray_commercial_history_mutation();

insert into public.sellertray_installment_policy_versions (
  scope_kind,billing_cycle,enabled,default_template_id,effective_from,change_reason
)
select 'platform','yearly',true,t.id,'2026-10-21 00:00:00+00','System seed preserving pre-OA2 yearly installment availability'
from public.sellertray_installment_schedule_templates t
where t.template_code='two_installment_70_30' and t.version=1;

insert into public.sellertray_installment_policy_versions (
  scope_kind,billing_cycle,enabled,default_template_id,effective_from,change_reason
) values (
  'platform','monthly',false,null,'2026-10-21 00:00:00+00','System seed: monthly installments disabled unless explicitly governed on'
);

create or replace function public.resolve_sellertray_installment_policy(
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_plan_code text,
  p_billing_cycle text,
  p_as_of timestamptz default now()
)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  with candidates as (
    select p.*,
      case p.scope_kind
        when 'commercial_order' then 400
        when 'tenant' then 300
        when 'plan_cycle' then 200
        else 100
      end as precedence
    from public.sellertray_installment_policy_versions p
    where p.effective_from <= p_as_of
      and (p.effective_until is null or p.effective_until > p_as_of)
      and (
        (p.scope_kind='commercial_order' and p.tenant_id=p_tenant_id and p.commercial_order_id=p_commercial_order_id)
        or (p.scope_kind='tenant' and p.tenant_id=p_tenant_id and p.billing_cycle=p_billing_cycle)
        or (p.scope_kind='plan_cycle' and p.plan_code=p_plan_code and p.billing_cycle=p_billing_cycle)
        or (p.scope_kind='platform' and p.billing_cycle=p_billing_cycle)
      )
  )
  select jsonb_build_object(
    'policyVersionId',c.id,
    'scopeKind',c.scope_kind,
    'enabled',c.enabled,
    'defaultTemplateId',c.default_template_id,
    'effectiveFrom',c.effective_from,
    'effectiveUntil',c.effective_until
  )
  from candidates c
  order by c.precedence desc,c.effective_from desc,c.created_at desc
  limit 1;
$$;

revoke all on function public.resolve_sellertray_installment_policy(uuid,uuid,text,text,timestamptz)
  from public,anon,authenticated;
grant execute on function public.resolve_sellertray_installment_policy(uuid,uuid,text,text,timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3. Immutable obligation contract snapshots
-- ---------------------------------------------------------------------------

alter table public.sellertray_commercial_installment_obligations
  drop constraint if exists sellertray_commercial_installment_obligations_structure_check;
alter table public.sellertray_commercial_installment_obligations
  add constraint sellertray_commercial_installment_obligations_structure_check
  check (structure_code ~ '^[a-z][a-z0-9_]{1,63}$');

create table public.sellertray_installment_contract_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  commercial_order_id uuid not null,
  installment_obligation_id uuid not null,
  policy_version_id uuid references public.sellertray_installment_policy_versions(id) on delete restrict,
  template_id uuid not null references public.sellertray_installment_schedule_templates(id) on delete restrict,
  template_code text not null,
  template_version integer not null,
  provisional_entitlement_months integer not null,
  qualifying_settlement_sequence integer not null,
  snapshotted_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (installment_obligation_id),
  constraint sellertray_installment_contract_order_same_tenant
    foreign key (tenant_id,commercial_order_id)
    references public.sellertray_commercial_orders(tenant_id,id) on delete restrict,
  constraint sellertray_installment_contract_obligation_same_tenant
    foreign key (tenant_id,installment_obligation_id)
    references public.sellertray_commercial_installment_obligations(tenant_id,id) on delete restrict,
  constraint sellertray_installment_contract_template_code_check
    check (template_code ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint sellertray_installment_contract_template_version_check check (template_version > 0),
  constraint sellertray_installment_contract_provisional_check
    check (provisional_entitlement_months between 0 and 120),
  constraint sellertray_installment_contract_qualifying_check
    check (qualifying_settlement_sequence > 0)
);

create trigger prevent_sellertray_installment_contract_snapshot_mutation
before update or delete on public.sellertray_installment_contract_snapshots
for each row execute function public.prevent_sellertray_commercial_history_mutation();

insert into public.sellertray_installment_contract_snapshots (
  tenant_id,commercial_order_id,installment_obligation_id,policy_version_id,
  template_id,template_code,template_version,provisional_entitlement_months,
  qualifying_settlement_sequence,snapshotted_at
)
select o.tenant_id,o.commercial_order_id,o.id,
       case when p.enabled then p.id else null end,
       t.id,t.template_code,t.version,t.provisional_entitlement_months,
       t.qualifying_settlement_sequence,o.created_at
from public.sellertray_commercial_installment_obligations o
join public.sellertray_commercial_order_price_snapshots s
  on s.tenant_id=o.tenant_id
 and s.commercial_order_id=o.commercial_order_id
 and s.line_type='subscription'
join public.sellertray_installment_schedule_templates t
  on t.template_code=o.structure_code and t.version=1
left join lateral (
  select pv.*
  from public.sellertray_installment_policy_versions pv
  where pv.scope_kind='platform'
    and pv.billing_cycle=s.billing_cycle
    and pv.effective_from <= o.created_at
    and (pv.effective_until is null or pv.effective_until > o.created_at)
  order by pv.effective_from desc,pv.created_at desc
  limit 1
) p on true
on conflict (installment_obligation_id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Immutable commercial adjustments and direct payments
-- ---------------------------------------------------------------------------

create table public.sellertray_commercial_adjustments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  commercial_order_id uuid not null,
  command_id uuid not null,
  adjustment_type text not null default 'discount',
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
    references public.sellertray_commercial_orders(tenant_id,id) on delete restrict,
  constraint sellertray_commercial_adjustments_type_check check (adjustment_type='discount'),
  constraint sellertray_commercial_adjustments_amount_check check (amount > 0),
  constraint sellertray_commercial_adjustments_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint sellertray_commercial_adjustments_reason_check
    check (char_length(btrim(reason)) between 1 and 1000),
  constraint sellertray_commercial_adjustments_evidence_check check (jsonb_typeof(evidence)='object'),
  constraint sellertray_commercial_adjustments_time_check
    check (approved_at <= recorded_at + interval '5 minutes')
);

create table public.sellertray_commercial_direct_payment_confirmations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  commercial_order_id uuid not null,
  command_id uuid not null,
  payment_reference text not null,
  payment_method text not null,
  amount numeric(18,2) not null,
  currency text not null,
  reason text not null,
  evidence jsonb not null default '{}'::jsonb,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  paid_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,command_id),
  unique (tenant_id,payment_reference),
  constraint sellertray_commercial_direct_payments_order_same_tenant
    foreign key (tenant_id,commercial_order_id)
    references public.sellertray_commercial_orders(tenant_id,id) on delete restrict,
  constraint sellertray_commercial_direct_payments_reference_check
    check (char_length(btrim(payment_reference)) between 1 and 160),
  constraint sellertray_commercial_direct_payments_method_check
    check (payment_method ~ '^[a-z][a-z0-9_-]{0,31}$'),
  constraint sellertray_commercial_direct_payments_amount_check check (amount > 0),
  constraint sellertray_commercial_direct_payments_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint sellertray_commercial_direct_payments_reason_check
    check (char_length(btrim(reason)) between 1 and 1000),
  constraint sellertray_commercial_direct_payments_evidence_check check (jsonb_typeof(evidence)='object'),
  constraint sellertray_commercial_direct_payments_time_check
    check (paid_at <= recorded_at + interval '5 minutes')
);

create index sellertray_commercial_adjustments_order_idx
  on public.sellertray_commercial_adjustments(tenant_id,commercial_order_id,approved_at);
create index sellertray_commercial_direct_payments_order_idx
  on public.sellertray_commercial_direct_payment_confirmations(tenant_id,commercial_order_id,paid_at);

create trigger prevent_sellertray_commercial_adjustment_mutation
before update or delete on public.sellertray_commercial_adjustments
for each row execute function public.prevent_sellertray_commercial_history_mutation();
create trigger prevent_sellertray_commercial_direct_payment_mutation
before update or delete on public.sellertray_commercial_direct_payment_confirmations
for each row execute function public.prevent_sellertray_commercial_history_mutation();

create or replace function public.prepare_sellertray_commercial_credit_fact()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_order public.sellertray_commercial_orders%rowtype;
  v_adjustments numeric(18,2);
  v_gateway numeric(18,2);
  v_direct numeric(18,2);
begin
  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.tenant_id=new.tenant_id and o.id=new.commercial_order_id;

  new.currency := v_order.currency;
  new.reason := btrim(new.reason);

  select coalesce(sum(a.amount),0)::numeric(18,2) into v_adjustments
  from public.sellertray_commercial_adjustments a
  where a.tenant_id=new.tenant_id and a.commercial_order_id=new.commercial_order_id;

  select coalesce(sum(p.amount),0)::numeric(18,2) into v_gateway
  from public.sellertray_commercial_installment_payment_confirmations p
  where p.tenant_id=new.tenant_id and p.commercial_order_id=new.commercial_order_id;

  select coalesce(sum(p.amount),0)::numeric(18,2) into v_direct
  from public.sellertray_commercial_direct_payment_confirmations p
  where p.tenant_id=new.tenant_id and p.commercial_order_id=new.commercial_order_id;

  if v_adjustments+v_gateway+v_direct+new.amount > v_order.total_gross_amount + 0.004 then
    raise exception 'Commercial credits cannot exceed immutable order gross' using errcode='23514';
  end if;
  return new;
end;
$$;

revoke all on function public.prepare_sellertray_commercial_credit_fact()
  from public,anon,authenticated;
create trigger prepare_sellertray_commercial_adjustment
before insert on public.sellertray_commercial_adjustments
for each row execute function public.prepare_sellertray_commercial_credit_fact();
create trigger prepare_sellertray_commercial_direct_payment
before insert on public.sellertray_commercial_direct_payment_confirmations
for each row execute function public.prepare_sellertray_commercial_credit_fact();

-- ---------------------------------------------------------------------------
-- 5. Authoritative settlement projection and deterministic allocation
-- ---------------------------------------------------------------------------

create or replace function public.get_sellertray_commercial_settlement_state(
  p_tenant_id uuid,
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
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_adjustments numeric(18,2) := 0;
  v_gateway numeric(18,2) := 0;
  v_direct numeric(18,2) := 0;
  v_net_due numeric(18,2) := 0;
  v_total_paid numeric(18,2) := 0;
  v_outstanding numeric(18,2) := 0;
  v_credit numeric(18,2) := 0;
  v_schedule jsonb := '[]'::jsonb;
  v_next_schedule_id uuid;
  v_next_payable numeric(18,2);
  v_status text;
begin
  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.tenant_id=p_tenant_id and o.id=p_commercial_order_id;

  select coalesce(sum(a.amount),0)::numeric(18,2) into v_adjustments
  from public.sellertray_commercial_adjustments a
  where a.tenant_id=p_tenant_id and a.commercial_order_id=p_commercial_order_id;

  select coalesce(sum(p.amount),0)::numeric(18,2) into v_gateway
  from public.sellertray_commercial_installment_payment_confirmations p
  where p.tenant_id=p_tenant_id and p.commercial_order_id=p_commercial_order_id;

  select coalesce(sum(p.amount),0)::numeric(18,2) into v_direct
  from public.sellertray_commercial_direct_payment_confirmations p
  where p.tenant_id=p_tenant_id and p.commercial_order_id=p_commercial_order_id;

  v_net_due := greatest(v_order.total_gross_amount-v_adjustments,0)::numeric(18,2);
  v_total_paid := (v_gateway+v_direct)::numeric(18,2);
  v_outstanding := greatest(v_net_due-v_total_paid,0)::numeric(18,2);
  v_credit := least(v_adjustments+v_total_paid,v_order.total_gross_amount)::numeric(18,2);

  select o.* into v_obligation
  from public.sellertray_commercial_installment_obligations o
  where o.tenant_id=p_tenant_id and o.commercial_order_id=p_commercial_order_id;

  if found then
    with lines as (
      select s.id,s.sequence_no,s.percentage,s.amount_due,s.due_at,
             coalesce(sum(s.amount_due) over (
               order by s.sequence_no
               rows between unbounded preceding and 1 preceding
             ),0)::numeric(18,2) as prior_due
      from public.sellertray_commercial_installment_schedule s
      where s.tenant_id=p_tenant_id
        and s.installment_obligation_id=v_obligation.id
    ), allocated as (
      select l.*,
             least(l.amount_due,greatest(v_credit-l.prior_due,0))::numeric(18,2) as settled_amount,
             greatest(l.amount_due-least(l.amount_due,greatest(v_credit-l.prior_due,0)),0)::numeric(18,2) as remaining_amount
      from lines l
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'scheduleId',a.id,
             'sequenceNo',a.sequence_no,
             'percentage',a.percentage,
             'amountDue',a.amount_due,
             'settledAmount',a.settled_amount,
             'remainingAmount',a.remaining_amount,
             'dueAt',a.due_at,
             'settled',a.remaining_amount < 0.005
           ) order by a.sequence_no),'[]'::jsonb),
           (array_agg(a.id order by a.sequence_no) filter (where a.remaining_amount >= 0.005))[1],
           (array_agg(least(a.remaining_amount,v_outstanding)::numeric(18,2) order by a.sequence_no)
              filter (where a.remaining_amount >= 0.005))[1]
      into v_schedule,v_next_schedule_id,v_next_payable
    from allocated a;
  end if;

  if v_outstanding < 0.005 then
    v_status := 'settled';
    v_next_schedule_id := null;
    v_next_payable := 0;
  elsif v_total_paid > 0 or v_adjustments > 0 then
    v_status := 'partially_settled';
  else
    v_status := 'unsettled';
  end if;

  return jsonb_build_object(
    'tenantId',p_tenant_id,
    'commercialOrderId',p_commercial_order_id,
    'currency',v_order.currency,
    'grossAmount',v_order.total_gross_amount,
    'approvedAdjustmentAmount',v_adjustments,
    'gatewayPaymentAmount',v_gateway,
    'directPaymentAmount',v_direct,
    'totalConfirmedPaymentAmount',v_total_paid,
    'netAmountDue',v_net_due,
    'outstandingAmount',v_outstanding,
    'overpaymentAmount',greatest(v_total_paid-v_net_due,0)::numeric(18,2),
    'settlementStatus',v_status,
    'installmentObligationId',v_obligation.id,
    'schedule',v_schedule,
    'nextInstallmentScheduleId',v_next_schedule_id,
    'nextPayableAmount',coalesce(v_next_payable,v_outstanding)
  );
end;
$$;

revoke all on function public.get_sellertray_commercial_settlement_state(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.get_sellertray_commercial_settlement_state(uuid,uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 6. Stale checkout retirement
-- ---------------------------------------------------------------------------

alter table public.billing_checkout_sessions
  drop constraint if exists billing_checkout_sessions_status_check;
alter table public.billing_checkout_sessions
  add constraint billing_checkout_sessions_status_check
    check (status in ('preparing','initialized','paid','failed','expired','superseded'));

drop index if exists public.billing_checkout_sessions_installment_active_key;
create unique index billing_checkout_sessions_installment_active_key
  on public.billing_checkout_sessions(tenant_id,installment_schedule_id)
  where checkout_kind='installment' and status in ('preparing','initialized','paid');

create or replace function public.supersede_sellertray_stale_installment_checkouts(
  p_tenant_id uuid,
  p_commercial_order_id uuid
)
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  v_state jsonb;
  v_next_schedule_id uuid;
  v_next_amount numeric(18,2);
  v_outstanding numeric(18,2);
  v_count integer;
begin
  v_state := public.get_sellertray_commercial_settlement_state(p_tenant_id,p_commercial_order_id);
  v_next_schedule_id := nullif(v_state->>'nextInstallmentScheduleId','')::uuid;
  v_next_amount := coalesce((v_state->>'nextPayableAmount')::numeric,0);
  v_outstanding := coalesce((v_state->>'outstandingAmount')::numeric,0);

  update public.billing_checkout_sessions s
  set status='superseded'
  where s.tenant_id=p_tenant_id
    and s.commercial_order_id=p_commercial_order_id
    and s.checkout_kind='installment'
    and s.status in ('preparing','initialized')
    and (
      v_outstanding < 0.005
      or v_next_schedule_id is null
      or s.installment_schedule_id <> v_next_schedule_id
      or abs(coalesce(s.amount,0)-v_next_amount) >= 0.005
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.supersede_sellertray_stale_installment_checkouts(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.supersede_sellertray_stale_installment_checkouts(uuid,uuid)
  to service_role;

-- Service-role-only append functions. Capability-aware Admin wrappers are wired
-- in the next OA2 surface slice; direct client mutation is intentionally absent.
create or replace function public.record_sellertray_commercial_adjustment_internal(
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_command_id uuid,
  p_amount numeric,
  p_reason text,
  p_evidence jsonb,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_row public.sellertray_commercial_adjustments%rowtype;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Commercial adjustment amount must be positive' using errcode='22023';
  end if;
  if nullif(btrim(p_reason),'') is null then
    raise exception 'Commercial adjustment reason is required' using errcode='22023';
  end if;

  select a.* into v_row
  from public.sellertray_commercial_adjustments a
  where a.tenant_id=p_tenant_id and a.command_id=p_command_id;

  if found then
    if v_row.commercial_order_id<>p_commercial_order_id or abs(v_row.amount-round(p_amount::numeric,2))>=0.005 then
      raise exception 'Commercial adjustment command id was already used with different input' using errcode='23505';
    end if;
  else
    insert into public.sellertray_commercial_adjustments(
      tenant_id,commercial_order_id,command_id,amount,currency,reason,evidence,actor_user_id
    )
    select p_tenant_id,p_commercial_order_id,p_command_id,round(p_amount::numeric,2),o.currency,
           btrim(p_reason),coalesce(p_evidence,'{}'::jsonb),p_actor_user_id
    from public.sellertray_commercial_orders o
    where o.tenant_id=p_tenant_id and o.id=p_commercial_order_id
    returning * into strict v_row;
  end if;

  perform public.supersede_sellertray_stale_installment_checkouts(p_tenant_id,p_commercial_order_id);
  return public.get_sellertray_commercial_settlement_state(p_tenant_id,p_commercial_order_id);
end;
$$;

create or replace function public.record_sellertray_commercial_direct_payment_internal(
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_command_id uuid,
  p_payment_reference text,
  p_payment_method text,
  p_amount numeric,
  p_paid_at timestamptz,
  p_reason text,
  p_evidence jsonb,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_row public.sellertray_commercial_direct_payment_confirmations%rowtype;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Direct payment amount must be positive' using errcode='22023';
  end if;
  if nullif(btrim(p_payment_reference),'') is null or nullif(btrim(p_payment_method),'') is null then
    raise exception 'Direct payment reference and method are required' using errcode='22023';
  end if;
  if nullif(btrim(p_reason),'') is null then
    raise exception 'Direct payment reason is required' using errcode='22023';
  end if;

  select d.* into v_row
  from public.sellertray_commercial_direct_payment_confirmations d
  where d.tenant_id=p_tenant_id and d.command_id=p_command_id;

  if found then
    if v_row.commercial_order_id<>p_commercial_order_id
       or v_row.payment_reference<>btrim(p_payment_reference)
       or abs(v_row.amount-round(p_amount::numeric,2))>=0.005 then
      raise exception 'Direct payment command id was already used with different input' using errcode='23505';
    end if;
  else
    insert into public.sellertray_commercial_direct_payment_confirmations(
      tenant_id,commercial_order_id,command_id,payment_reference,payment_method,
      amount,currency,reason,evidence,actor_user_id,paid_at
    )
    select p_tenant_id,p_commercial_order_id,p_command_id,btrim(p_payment_reference),
           lower(btrim(p_payment_method)),round(p_amount::numeric,2),o.currency,btrim(p_reason),
           coalesce(p_evidence,'{}'::jsonb),p_actor_user_id,p_paid_at
    from public.sellertray_commercial_orders o
    where o.tenant_id=p_tenant_id and o.id=p_commercial_order_id
    returning * into strict v_row;
  end if;

  perform public.supersede_sellertray_stale_installment_checkouts(p_tenant_id,p_commercial_order_id);
  return public.get_sellertray_commercial_settlement_state(p_tenant_id,p_commercial_order_id);
end;
$$;

revoke all on function public.record_sellertray_commercial_adjustment_internal(uuid,uuid,uuid,numeric,text,jsonb,uuid)
  from public,anon,authenticated;
revoke all on function public.record_sellertray_commercial_direct_payment_internal(uuid,uuid,uuid,text,text,numeric,timestamptz,text,jsonb,uuid)
  from public,anon,authenticated;
grant execute on function public.record_sellertray_commercial_adjustment_internal(uuid,uuid,uuid,numeric,text,jsonb,uuid)
  to service_role;
grant execute on function public.record_sellertray_commercial_direct_payment_internal(uuid,uuid,uuid,text,text,numeric,timestamptz,text,jsonb,uuid)
  to service_role;

-- New OA2 tables are not client-readable/writable by default. Read projections
-- and capability-gated mutation RPCs expose only governed data.
alter table public.sellertray_installment_schedule_templates enable row level security;
alter table public.sellertray_installment_schedule_template_lines enable row level security;
alter table public.sellertray_installment_policy_versions enable row level security;
alter table public.sellertray_installment_contract_snapshots enable row level security;
alter table public.sellertray_commercial_adjustments enable row level security;
alter table public.sellertray_commercial_direct_payment_confirmations enable row level security;

revoke all on public.sellertray_installment_schedule_templates from public,anon,authenticated;
revoke all on public.sellertray_installment_schedule_template_lines from public,anon,authenticated;
revoke all on public.sellertray_installment_policy_versions from public,anon,authenticated;
revoke all on public.sellertray_installment_contract_snapshots from public,anon,authenticated;
revoke all on public.sellertray_commercial_adjustments from public,anon,authenticated;
revoke all on public.sellertray_commercial_direct_payment_confirmations from public,anon,authenticated;

grant select,insert on public.sellertray_installment_schedule_templates to service_role;
grant select,insert on public.sellertray_installment_schedule_template_lines to service_role;
grant select,insert on public.sellertray_installment_policy_versions to service_role;
grant select,insert on public.sellertray_installment_contract_snapshots to service_role;
grant select,insert on public.sellertray_commercial_adjustments to service_role;
grant select,insert on public.sellertray_commercial_direct_payment_confirmations to service_role;

commit;
