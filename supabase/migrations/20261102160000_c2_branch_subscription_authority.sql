begin;

-- SellerTray C2-4 — Branch Subscription authority
--
-- Additive only. public.tenant_subscriptions remains the live compatibility
-- runtime until C2-10. This migration introduces the canonical Branch-owned
-- subscription term/history authority and its governed lifecycle commands.
-- It deliberately does NOT project Branch state back into tenant_subscriptions
-- and cannot create a native Commercial V2 subscription until C2-6 provides a
-- real Branch-bound branch_subscription commercial order line.

-- Allow same-tenant foreign keys from Branch Subscription evidence to the
-- Business-scoped universal Master Agreement acceptance ledger.
alter table public.sellertray_master_agreement_acceptances
  add constraint sellertray_master_agreement_acceptances_tenant_id_id_key
  unique (tenant_id,id);

create table public.sellertray_branch_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  branch_id uuid not null,
  plan_profile_version_id uuid not null references public.sellertray_plan_profile_versions(id) on delete restrict,
  billing_cycle text not null,
  lifecycle_status text not null default 'pending',
  committed_at timestamptz not null,

  -- Native C2 purchase lineage. These stay null for explicit legacy migration
  -- records and become mandatory for provenance_kind='commercial_order'.
  commercial_order_id uuid,
  commercial_order_line_id uuid,
  installment_obligation_id uuid,

  -- Branch-specific prerequisite/evidence links. C2-6/C2-7/C2-8 populate these
  -- through their governed reconciliation paths; C2-4 only owns the fields.
  setup_required boolean not null default false,
  setup_readiness_id uuid,
  required_master_agreement_version_id uuid references public.sellertray_master_agreement_versions(id) on delete restrict,
  master_agreement_acceptance_id uuid,
  order_form_id uuid,
  settlement_qualified_at timestamptz,
  fully_settled_at timestamptz,

  -- Entitlement term. Renewal creates a new Branch Subscription row; it never
  -- edits another Branch's anniversary. Provisional activation may expose a
  -- shorter current period while preserving the expected full-term boundary.
  activated_at timestamptz,
  entitlement_period_start timestamptz,
  entitlement_period_end timestamptz,
  expected_full_term_end timestamptz,

  guarantee_status text not null default 'not_applicable',
  guarantee_started_at timestamptz,
  guarantee_ends_at timestamptz,

  supersedes_branch_subscription_id uuid,
  provenance_kind text not null,
  provenance jsonb not null default '{}'::jsonb,
  creation_command_id uuid not null,
  created_actor_kind text not null default 'system',
  created_by_user_id uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (tenant_id,id),
  unique (tenant_id,creation_command_id),

  constraint sellertray_branch_subscriptions_branch_same_tenant
    foreign key (tenant_id,branch_id)
    references public.branches(tenant_id,id)
    on delete restrict,
  constraint sellertray_branch_subscriptions_order_same_tenant
    foreign key (tenant_id,commercial_order_id)
    references public.sellertray_commercial_orders(tenant_id,id)
    on delete restrict,
  constraint sellertray_branch_subscriptions_line_same_tenant
    foreign key (tenant_id,commercial_order_line_id)
    references public.sellertray_commercial_order_price_snapshots(tenant_id,id)
    on delete restrict,
  constraint sellertray_branch_subscriptions_obligation_same_tenant
    foreign key (tenant_id,installment_obligation_id)
    references public.sellertray_commercial_installment_obligations(tenant_id,id)
    on delete restrict,
  constraint sellertray_branch_subscriptions_setup_same_tenant
    foreign key (tenant_id,setup_readiness_id)
    references public.sellertray_commercial_branch_setup_readiness(tenant_id,id)
    on delete restrict,
  constraint sellertray_branch_subscriptions_master_acceptance_same_tenant
    foreign key (tenant_id,master_agreement_acceptance_id)
    references public.sellertray_master_agreement_acceptances(tenant_id,id)
    on delete restrict,
  constraint sellertray_branch_subscriptions_order_form_same_tenant
    foreign key (tenant_id,order_form_id)
    references public.sellertray_commercial_order_forms(tenant_id,id)
    on delete restrict,
  constraint sellertray_branch_subscriptions_supersedes_same_tenant
    foreign key (tenant_id,supersedes_branch_subscription_id)
    references public.sellertray_branch_subscriptions(tenant_id,id)
    on delete restrict,

  constraint sellertray_branch_subscriptions_cycle_check
    check (billing_cycle in ('monthly','yearly')),
  constraint sellertray_branch_subscriptions_status_check
    check (lifecycle_status in ('pending','provisional','active','suspended','expired','cancelled')),
  constraint sellertray_branch_subscriptions_provenance_kind_check
    check (provenance_kind in ('commercial_order','legacy_compatibility')),
  constraint sellertray_branch_subscriptions_provenance_check
    check (jsonb_typeof(provenance)='object'),
  constraint sellertray_branch_subscriptions_actor_kind_check
    check (created_actor_kind in ('system','merchant','platform_admin')),
  constraint sellertray_branch_subscriptions_native_source_check
    check (
      provenance_kind<>'commercial_order'
      or (commercial_order_id is not null and commercial_order_line_id is not null)
    ),
  constraint sellertray_branch_subscriptions_line_requires_order_check
    check (commercial_order_line_id is null or commercial_order_id is not null),
  constraint sellertray_branch_subscriptions_obligation_requires_order_check
    check (installment_obligation_id is null or commercial_order_id is not null),
  constraint sellertray_branch_subscriptions_setup_shape_check
    check (
      (not setup_required and setup_readiness_id is null)
      or setup_required
    ),
  constraint sellertray_branch_subscriptions_settlement_time_check
    check (
      fully_settled_at is null
      or (settlement_qualified_at is not null and fully_settled_at>=settlement_qualified_at)
    ),
  constraint sellertray_branch_subscriptions_period_shape_check
    check (
      (entitlement_period_start is null and entitlement_period_end is null and activated_at is null)
      or
      (
        entitlement_period_start is not null
        and entitlement_period_end is not null
        and activated_at is not null
        and entitlement_period_end>entitlement_period_start
        and activated_at=entitlement_period_start
      )
    ),
  constraint sellertray_branch_subscriptions_full_term_check
    check (
      expected_full_term_end is null
      or (
        entitlement_period_start is not null
        and expected_full_term_end>=entitlement_period_end
        and expected_full_term_end>entitlement_period_start
      )
    ),
  constraint sellertray_branch_subscriptions_status_period_check
    check (
      lifecycle_status in ('pending','cancelled')
      or (entitlement_period_start is not null and entitlement_period_end is not null and activated_at is not null)
    ),
  constraint sellertray_branch_subscriptions_guarantee_status_check
    check (guarantee_status in ('not_applicable','pending','active','expired','cancelled','refunded')),
  constraint sellertray_branch_subscriptions_guarantee_shape_check
    check (
      guarantee_status='not_applicable'
      or (
        guarantee_started_at is not null
        and guarantee_ends_at is not null
        and guarantee_ends_at>guarantee_started_at
      )
    ),
  constraint sellertray_branch_subscriptions_created_time_check
    check (committed_at<=created_at+interval '5 minutes')
);

create index sellertray_branch_subscriptions_branch_term_idx
  on public.sellertray_branch_subscriptions(
    tenant_id,branch_id,entitlement_period_start desc,committed_at desc,created_at desc
  );
create index sellertray_branch_subscriptions_plan_idx
  on public.sellertray_branch_subscriptions(plan_profile_version_id,lifecycle_status,entitlement_period_end);
create index sellertray_branch_subscriptions_renewal_idx
  on public.sellertray_branch_subscriptions(tenant_id,entitlement_period_end)
  where lifecycle_status in ('provisional','active','suspended');

create table public.sellertray_branch_subscription_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_subscription_id uuid not null,
  branch_id uuid not null,
  command_id uuid not null,
  event_type text not null,
  effective_at timestamptz not null,
  actor_kind text not null,
  actor_user_id uuid references auth.users(id) on delete restrict,
  reason text not null,
  details jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,command_id),
  constraint sellertray_branch_subscription_events_subscription_same_tenant
    foreign key (tenant_id,branch_subscription_id)
    references public.sellertray_branch_subscriptions(tenant_id,id)
    on delete restrict,
  constraint sellertray_branch_subscription_events_branch_same_tenant
    foreign key (tenant_id,branch_id)
    references public.branches(tenant_id,id)
    on delete restrict,
  constraint sellertray_branch_subscription_events_type_check
    check (event_type in (
      'created','provisional_activated','activated','suspended','resumed','expired','cancelled'
    )),
  constraint sellertray_branch_subscription_events_actor_kind_check
    check (actor_kind in ('system','merchant','platform_admin')),
  constraint sellertray_branch_subscription_events_reason_check
    check (char_length(btrim(reason)) between 6 and 1000),
  constraint sellertray_branch_subscription_events_details_check
    check (jsonb_typeof(details)='object'),
  constraint sellertray_branch_subscription_events_time_check
    check (effective_at<=recorded_at+interval '5 minutes')
);

create index sellertray_branch_subscription_events_history_idx
  on public.sellertray_branch_subscription_events(
    tenant_id,branch_subscription_id,effective_at desc,recorded_at desc
  );

-- Immutable add-on entitlement assignments for one Branch Subscription term.
-- Early cancellation/proration policy is intentionally not invented here; a
-- future governed commercial policy may add revocation evidence if approved.
create table public.sellertray_branch_subscription_addons (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_subscription_id uuid not null,
  branch_id uuid not null,
  addon_version_id uuid not null references public.sellertray_addon_versions(id) on delete restrict,
  billing_cycle text not null,
  entitlement_from timestamptz not null,
  entitlement_until timestamptz not null,
  commercial_order_id uuid,
  commercial_order_line_id uuid,
  creation_command_id uuid not null,
  actor_user_id uuid references auth.users(id) on delete restrict,
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,creation_command_id),
  constraint sellertray_branch_subscription_addons_subscription_same_tenant
    foreign key (tenant_id,branch_subscription_id)
    references public.sellertray_branch_subscriptions(tenant_id,id)
    on delete restrict,
  constraint sellertray_branch_subscription_addons_branch_same_tenant
    foreign key (tenant_id,branch_id)
    references public.branches(tenant_id,id)
    on delete restrict,
  constraint sellertray_branch_subscription_addons_order_same_tenant
    foreign key (tenant_id,commercial_order_id)
    references public.sellertray_commercial_orders(tenant_id,id)
    on delete restrict,
  constraint sellertray_branch_subscription_addons_line_same_tenant
    foreign key (tenant_id,commercial_order_line_id)
    references public.sellertray_commercial_order_price_snapshots(tenant_id,id)
    on delete restrict,
  constraint sellertray_branch_subscription_addons_cycle_check
    check (billing_cycle in ('monthly','yearly','one_time')),
  constraint sellertray_branch_subscription_addons_window_check
    check (entitlement_until>entitlement_from),
  constraint sellertray_branch_subscription_addons_line_requires_order_check
    check (commercial_order_line_id is null or commercial_order_id is not null),
  constraint sellertray_branch_subscription_addons_provenance_check
    check (jsonb_typeof(provenance)='object')
);

create index sellertray_branch_subscription_addons_resolution_idx
  on public.sellertray_branch_subscription_addons(
    tenant_id,branch_subscription_id,entitlement_from,entitlement_until
  );

-- New C2 history is never directly mutable. Branch Subscription current-state
-- rows may only be changed through a governed function that sets a transaction-
-- local mutation marker. Database-owner migrations remain able to perform later
-- controlled backfills at C2-10.
create or replace function public.guard_sellertray_branch_subscription_mutation()
returns trigger
language plpgsql
set search_path=''
as $function$
begin
  if tg_op='DELETE' then
    raise exception 'SellerTray Branch Subscription history cannot be deleted' using errcode='55000';
  end if;

  if session_user not in ('postgres','supabase_admin')
     and coalesce(current_setting('sellertray.branch_subscription_mutation',true),'')<>'governed' then
    raise exception 'Use the governed SellerTray Branch Subscription lifecycle authority' using errcode='42501';
  end if;

  if new.tenant_id<>old.tenant_id
     or new.branch_id<>old.branch_id
     or new.plan_profile_version_id<>old.plan_profile_version_id
     or new.billing_cycle<>old.billing_cycle
     or new.committed_at<>old.committed_at
     or new.commercial_order_id is distinct from old.commercial_order_id
     or new.commercial_order_line_id is distinct from old.commercial_order_line_id
     or new.installment_obligation_id is distinct from old.installment_obligation_id
     or new.setup_required<>old.setup_required
     or new.required_master_agreement_version_id is distinct from old.required_master_agreement_version_id
     or new.order_form_id is distinct from old.order_form_id
     or new.supersedes_branch_subscription_id is distinct from old.supersedes_branch_subscription_id
     or new.provenance_kind<>old.provenance_kind
     or new.provenance is distinct from old.provenance
     or new.creation_command_id<>old.creation_command_id
     or new.created_actor_kind<>old.created_actor_kind
     or new.created_by_user_id is distinct from old.created_by_user_id
     or new.created_at<>old.created_at then
    raise exception 'SellerTray Branch Subscription commitment identity is immutable' using errcode='55000';
  end if;

  return new;
end;
$function$;

create trigger guard_sellertray_branch_subscription_mutation
before update or delete on public.sellertray_branch_subscriptions
for each row execute function public.guard_sellertray_branch_subscription_mutation();

create trigger prevent_sellertray_branch_subscription_event_mutation
before update or delete on public.sellertray_branch_subscription_events
for each row execute function public.prevent_sellertray_commercial_history_mutation();

create trigger prevent_sellertray_branch_subscription_addon_mutation
before update or delete on public.sellertray_branch_subscription_addons
for each row execute function public.prevent_sellertray_commercial_history_mutation();

create or replace function public.assert_sellertray_branch_subscription_subject(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_plan_profile_version_id uuid,
  p_billing_cycle text,
  p_committed_at timestamptz
)
returns void
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  v_plan public.sellertray_plan_profile_versions%rowtype;
begin
  if p_tenant_id is null or p_branch_id is null or p_plan_profile_version_id is null
     or p_billing_cycle not in ('monthly','yearly') or p_committed_at is null then
    raise exception 'Business, Branch, Plan Profile Version, billing cycle and commitment time are required' using errcode='22023';
  end if;

  if not exists(
    select 1 from public.branches b
    where b.tenant_id=p_tenant_id and b.id=p_branch_id
  ) then
    raise exception 'SellerTray Branch subscription subject not found' using errcode='P0002';
  end if;

  select v.* into strict v_plan
  from public.sellertray_plan_profile_versions v
  where v.id=p_plan_profile_version_id;

  -- Historical commitments remain valid after later retirement. The exact plan
  -- version only has to have been published/effective at commitment time.
  if v_plan.status not in ('published','retired')
     or v_plan.effective_from is null
     or v_plan.effective_from>p_committed_at
     or (v_plan.effective_until is not null and v_plan.effective_until<=p_committed_at)
     or not (p_billing_cycle=any(v_plan.allowed_billing_cycles)) then
    raise exception 'Plan Profile Version is not eligible for this Branch subscription commitment' using errcode='23514';
  end if;
end;
$function$;

revoke all on function public.assert_sellertray_branch_subscription_subject(uuid,uuid,uuid,text,timestamptz)
  from public,anon,authenticated;
grant execute on function public.assert_sellertray_branch_subscription_subject(uuid,uuid,uuid,text,timestamptz)
  to service_role;

create or replace function public.register_sellertray_branch_subscription_term(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_plan_profile_version_id uuid,
  p_billing_cycle text,
  p_committed_at timestamptz,
  p_commercial_order_id uuid,
  p_commercial_order_line_id uuid,
  p_installment_obligation_id uuid,
  p_setup_required boolean,
  p_required_master_agreement_version_id uuid,
  p_order_form_id uuid,
  p_supersedes_branch_subscription_id uuid,
  p_provenance_kind text,
  p_provenance jsonb,
  p_command_id uuid,
  p_actor_kind text,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_kind text:=lower(btrim(coalesce(p_provenance_kind,'')));
  v_actor_kind text:=lower(btrim(coalesce(p_actor_kind,'')));
  v_provenance jsonb:=coalesce(p_provenance,'{}'::jsonb);
  v_existing public.sellertray_branch_subscriptions%rowtype;
  v_line public.sellertray_commercial_order_price_snapshots%rowtype;
  v_previous public.sellertray_branch_subscriptions%rowtype;
  v_id uuid;
begin
  if p_command_id is null or jsonb_typeof(v_provenance)<>'object'
     or v_kind not in ('commercial_order','legacy_compatibility')
     or v_actor_kind not in ('system','merchant','platform_admin') then
    raise exception 'Valid Branch Subscription provenance, command and actor kind are required' using errcode='22023';
  end if;

  perform public.assert_sellertray_branch_subscription_subject(
    p_tenant_id,p_branch_id,p_plan_profile_version_id,p_billing_cycle,p_committed_at
  );

  -- Serialize all term creation for one Branch so staggered/renewal lineage is
  -- deterministic without imposing one Business-wide renewal lock.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'sellertray-branch-subscription|'||p_tenant_id::text||'|'||p_branch_id::text,0
  ));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'sellertray-branch-subscription-command|'||p_command_id::text,0
  ));

  select s.* into v_existing
  from public.sellertray_branch_subscriptions s
  where s.tenant_id=p_tenant_id and s.creation_command_id=p_command_id;

  if found then
    if v_existing.branch_id=p_branch_id
       and v_existing.plan_profile_version_id=p_plan_profile_version_id
       and v_existing.billing_cycle=p_billing_cycle
       and v_existing.committed_at=p_committed_at
       and v_existing.commercial_order_id is not distinct from p_commercial_order_id
       and v_existing.commercial_order_line_id is not distinct from p_commercial_order_line_id
       and v_existing.installment_obligation_id is not distinct from p_installment_obligation_id
       and v_existing.setup_required=coalesce(p_setup_required,false)
       and v_existing.required_master_agreement_version_id is not distinct from p_required_master_agreement_version_id
       and v_existing.order_form_id is not distinct from p_order_form_id
       and v_existing.supersedes_branch_subscription_id is not distinct from p_supersedes_branch_subscription_id
       and v_existing.provenance_kind=v_kind
       and v_existing.provenance=v_provenance
       and v_existing.created_actor_kind=v_actor_kind
       and v_existing.created_by_user_id is not distinct from p_actor_user_id then
      return v_existing.id;
    end if;
    raise exception 'Branch Subscription creation command is already used for different facts' using errcode='23505';
  end if;

  if p_supersedes_branch_subscription_id is not null then
    select s.* into strict v_previous
    from public.sellertray_branch_subscriptions s
    where s.tenant_id=p_tenant_id and s.id=p_supersedes_branch_subscription_id;
    if v_previous.branch_id<>p_branch_id then
      raise exception 'A Branch Subscription may only supersede a term for the same Branch' using errcode='23514';
    end if;
    if v_previous.committed_at>p_committed_at then
      raise exception 'A replacement Branch Subscription cannot predate the term it supersedes' using errcode='23514';
    end if;
  end if;

  if v_kind='commercial_order' then
    if p_commercial_order_id is null or p_commercial_order_line_id is null then
      raise exception 'Native Branch Subscription requires its governed commercial order line' using errcode='23514';
    end if;

    select l.* into strict v_line
    from public.sellertray_commercial_order_price_snapshots l
    where l.tenant_id=p_tenant_id and l.id=p_commercial_order_line_id
      and l.commercial_order_id=p_commercial_order_id;

    -- C2-6 will introduce this line type and its Plan Profile snapshot. Until
    -- then native C2 registration fails closed, preventing premature cutover.
    if v_line.line_type<>'branch_subscription' or v_line.branch_id is distinct from p_branch_id then
      raise exception 'Native Branch Subscription requires a Branch-bound branch_subscription commercial order line' using errcode='23514';
    end if;
  elsif p_commercial_order_line_id is not null and p_commercial_order_id is null then
    raise exception 'Legacy compatibility lineage cannot reference an order line without its order' using errcode='23514';
  end if;

  insert into public.sellertray_branch_subscriptions(
    tenant_id,branch_id,plan_profile_version_id,billing_cycle,lifecycle_status,committed_at,
    commercial_order_id,commercial_order_line_id,installment_obligation_id,
    setup_required,required_master_agreement_version_id,order_form_id,
    supersedes_branch_subscription_id,provenance_kind,provenance,creation_command_id,
    created_actor_kind,created_by_user_id
  ) values (
    p_tenant_id,p_branch_id,p_plan_profile_version_id,p_billing_cycle,'pending',p_committed_at,
    p_commercial_order_id,p_commercial_order_line_id,p_installment_obligation_id,
    coalesce(p_setup_required,false),p_required_master_agreement_version_id,p_order_form_id,
    p_supersedes_branch_subscription_id,v_kind,v_provenance,p_command_id,
    v_actor_kind,p_actor_user_id
  ) returning id into v_id;

  insert into public.sellertray_branch_subscription_events(
    tenant_id,branch_subscription_id,branch_id,command_id,event_type,effective_at,
    actor_kind,actor_user_id,reason,details
  ) values (
    p_tenant_id,v_id,p_branch_id,p_command_id,'created',p_committed_at,
    v_actor_kind,p_actor_user_id,'Branch Subscription term registered',
    jsonb_build_object(
      'planProfileVersionId',p_plan_profile_version_id,
      'billingCycle',p_billing_cycle,
      'provenanceKind',v_kind,
      'commercialOrderId',p_commercial_order_id,
      'commercialOrderLineId',p_commercial_order_line_id,
      'supersedesBranchSubscriptionId',p_supersedes_branch_subscription_id
    )
  );

  return v_id;
end;
$function$;

revoke all on function public.register_sellertray_branch_subscription_term(
  uuid,uuid,uuid,text,timestamptz,uuid,uuid,uuid,boolean,uuid,uuid,uuid,text,jsonb,uuid,text,uuid
) from public,anon,authenticated;
grant execute on function public.register_sellertray_branch_subscription_term(
  uuid,uuid,uuid,text,timestamptz,uuid,uuid,uuid,boolean,uuid,uuid,uuid,text,jsonb,uuid,text,uuid
) to service_role;

create or replace function public.transition_sellertray_branch_subscription(
  p_tenant_id uuid,
  p_branch_subscription_id uuid,
  p_target_status text,
  p_effective_at timestamptz,
  p_entitlement_period_end timestamptz,
  p_expected_full_term_end timestamptz,
  p_command_id uuid,
  p_reason text,
  p_actor_kind text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_target text:=lower(btrim(coalesce(p_target_status,'')));
  v_actor_kind text:=lower(btrim(coalesce(p_actor_kind,'')));
  v_reason text:=btrim(coalesce(p_reason,''));
  v_subscription public.sellertray_branch_subscriptions%rowtype;
  v_existing_event public.sellertray_branch_subscription_events%rowtype;
  v_event_type text;
  v_new_period_end timestamptz;
  v_expected_end timestamptz;
begin
  if p_tenant_id is null or p_branch_subscription_id is null or p_command_id is null
     or p_effective_at is null or v_target not in ('provisional','active','suspended','expired','cancelled')
     or v_actor_kind not in ('system','merchant','platform_admin')
     or char_length(v_reason) not between 6 and 1000 then
    raise exception 'Valid Branch Subscription transition facts are required' using errcode='22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'sellertray-branch-subscription-command|'||p_command_id::text,0
  ));

  select e.* into v_existing_event
  from public.sellertray_branch_subscription_events e
  where e.tenant_id=p_tenant_id and e.command_id=p_command_id;

  if found then
    if v_existing_event.branch_subscription_id=p_branch_subscription_id
       and v_existing_event.effective_at=p_effective_at
       and v_existing_event.actor_kind=v_actor_kind
       and v_existing_event.actor_user_id is not distinct from p_actor_user_id
       and v_existing_event.reason=v_reason
       and v_existing_event.details->>'targetStatus'=v_target
       and (v_existing_event.details->>'entitlementPeriodEnd')::timestamptz is not distinct from p_entitlement_period_end
       and (v_existing_event.details->>'expectedFullTermEnd')::timestamptz is not distinct from p_expected_full_term_end then
      return jsonb_build_object(
        'branchSubscriptionId',p_branch_subscription_id,
        'status',(select lifecycle_status from public.sellertray_branch_subscriptions where tenant_id=p_tenant_id and id=p_branch_subscription_id),
        'alreadyApplied',true
      );
    end if;
    raise exception 'Branch Subscription lifecycle command is already used for different facts' using errcode='23505';
  end if;

  select s.* into strict v_subscription
  from public.sellertray_branch_subscriptions s
  where s.tenant_id=p_tenant_id and s.id=p_branch_subscription_id
  for update;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'sellertray-branch-subscription|'||p_tenant_id::text||'|'||v_subscription.branch_id::text,0
  ));

  if v_subscription.lifecycle_status in ('expired','cancelled') then
    raise exception 'Expired or cancelled Branch Subscription terms are terminal' using errcode='23514';
  end if;

  if v_target='provisional' then
    if v_subscription.lifecycle_status<>'pending' then
      raise exception 'Only a pending Branch Subscription can become provisional' using errcode='23514';
    end if;
    if p_entitlement_period_end is null or p_entitlement_period_end<=p_effective_at
       or p_expected_full_term_end is null or p_expected_full_term_end<p_entitlement_period_end then
      raise exception 'Provisional activation requires a valid provisional and expected full-term window' using errcode='22023';
    end if;
  elsif v_target='active' then
    if v_subscription.lifecycle_status not in ('pending','provisional','suspended') then
      raise exception 'Only pending, provisional or suspended Branch Subscription may become active' using errcode='23514';
    end if;
    if v_subscription.lifecycle_status='pending' and (p_entitlement_period_end is null or p_entitlement_period_end<=p_effective_at) then
      raise exception 'Activation requires a valid Branch entitlement period' using errcode='22023';
    end if;
  elsif v_target='suspended' then
    if v_subscription.lifecycle_status not in ('provisional','active') then
      raise exception 'Only an entitled Branch Subscription may be suspended' using errcode='23514';
    end if;
  elsif v_target='expired' then
    if v_subscription.lifecycle_status not in ('provisional','active','suspended') then
      raise exception 'Only an activated Branch Subscription may expire' using errcode='23514';
    end if;
  elsif v_target='cancelled' then
    if v_subscription.lifecycle_status not in ('pending','provisional','active','suspended') then
      raise exception 'Branch Subscription cannot be cancelled from its current state' using errcode='23514';
    end if;
  end if;

  -- Native C2 activation is allowed only after the row is linked to real C2
  -- purchase facts. C2-6/C2-7/C2-8 will populate/derive these prerequisites.
  if v_target in ('provisional','active') and v_subscription.lifecycle_status='pending'
     and v_subscription.provenance_kind='commercial_order' then
    if v_subscription.commercial_order_id is null or v_subscription.commercial_order_line_id is null
       or v_subscription.settlement_qualified_at is null
       or (v_subscription.setup_required and v_subscription.setup_readiness_id is null)
       or (v_subscription.required_master_agreement_version_id is not null and v_subscription.master_agreement_acceptance_id is null) then
      raise exception 'Native Branch Subscription prerequisites are incomplete' using errcode='23514';
    end if;
  end if;

  if v_target in ('provisional','active') and v_subscription.lifecycle_status='pending' then
    -- An activated Branch must never acquire a period that overlaps another
    -- non-terminal term. The Branch lock above makes this race-safe.
    if exists(
      select 1
      from public.sellertray_branch_subscriptions other
      where other.tenant_id=p_tenant_id
        and other.branch_id=v_subscription.branch_id
        and other.id<>v_subscription.id
        and other.lifecycle_status in ('provisional','active','suspended')
        and other.entitlement_period_start is not null
        and other.entitlement_period_end is not null
        and tstzrange(other.entitlement_period_start,other.entitlement_period_end,'[)')
            && tstzrange(p_effective_at,p_entitlement_period_end,'[)')
    ) then
      raise exception 'Branch Subscription entitlement periods cannot overlap' using errcode='23P01';
    end if;
  end if;

  if v_target='provisional' then
    v_new_period_end:=p_entitlement_period_end;
    v_expected_end:=p_expected_full_term_end;
  elsif v_target='active' and v_subscription.lifecycle_status='pending' then
    v_new_period_end:=p_entitlement_period_end;
    v_expected_end:=coalesce(p_expected_full_term_end,p_entitlement_period_end);
  elsif v_target='active' and v_subscription.lifecycle_status='provisional' then
    v_new_period_end:=coalesce(p_entitlement_period_end,v_subscription.expected_full_term_end);
    v_expected_end:=coalesce(v_subscription.expected_full_term_end,p_expected_full_term_end,v_new_period_end);
    if v_new_period_end is null or v_new_period_end<v_subscription.entitlement_period_end
       or (v_subscription.expected_full_term_end is not null and v_new_period_end>v_subscription.expected_full_term_end) then
      raise exception 'Full activation must preserve or extend provisional entitlement only to the governed full-term boundary' using errcode='23514';
    end if;
  else
    v_new_period_end:=v_subscription.entitlement_period_end;
    v_expected_end:=v_subscription.expected_full_term_end;
  end if;

  perform set_config('sellertray.branch_subscription_mutation','governed',true);

  update public.sellertray_branch_subscriptions
  set lifecycle_status=v_target,
      activated_at=case
        when lifecycle_status='pending' and v_target in ('provisional','active') then p_effective_at
        else activated_at
      end,
      entitlement_period_start=case
        when lifecycle_status='pending' and v_target in ('provisional','active') then p_effective_at
        else entitlement_period_start
      end,
      entitlement_period_end=case
        when v_target in ('provisional','active') then v_new_period_end
        else entitlement_period_end
      end,
      expected_full_term_end=case
        when v_target in ('provisional','active') then v_expected_end
        else expected_full_term_end
      end,
      updated_at=now()
  where tenant_id=p_tenant_id and id=p_branch_subscription_id;

  v_event_type:=case
    when v_target='provisional' then 'provisional_activated'
    when v_target='active' and v_subscription.lifecycle_status='suspended' then 'resumed'
    when v_target='active' then 'activated'
    else v_target
  end;

  insert into public.sellertray_branch_subscription_events(
    tenant_id,branch_subscription_id,branch_id,command_id,event_type,effective_at,
    actor_kind,actor_user_id,reason,details
  ) values (
    p_tenant_id,p_branch_subscription_id,v_subscription.branch_id,p_command_id,v_event_type,p_effective_at,
    v_actor_kind,p_actor_user_id,v_reason,
    jsonb_build_object(
      'previousStatus',v_subscription.lifecycle_status,
      'targetStatus',v_target,
      'entitlementPeriodEnd',case when v_target in ('provisional','active') then v_new_period_end else v_subscription.entitlement_period_end end,
      'expectedFullTermEnd',case when v_target in ('provisional','active') then v_expected_end else v_subscription.expected_full_term_end end
    )
  );

  return jsonb_build_object(
    'branchSubscriptionId',p_branch_subscription_id,
    'branchId',v_subscription.branch_id,
    'previousStatus',v_subscription.lifecycle_status,
    'status',v_target,
    'alreadyApplied',false,
    'entitlementPeriodStart',(select entitlement_period_start from public.sellertray_branch_subscriptions where id=p_branch_subscription_id),
    'entitlementPeriodEnd',(select entitlement_period_end from public.sellertray_branch_subscriptions where id=p_branch_subscription_id),
    'expectedFullTermEnd',(select expected_full_term_end from public.sellertray_branch_subscriptions where id=p_branch_subscription_id)
  );
end;
$function$;

revoke all on function public.transition_sellertray_branch_subscription(
  uuid,uuid,text,timestamptz,timestamptz,timestamptz,uuid,text,text,uuid
) from public,anon,authenticated;
grant execute on function public.transition_sellertray_branch_subscription(
  uuid,uuid,text,timestamptz,timestamptz,timestamptz,uuid,text,text,uuid
) to service_role;

create or replace function public.register_sellertray_branch_subscription_addon(
  p_tenant_id uuid,
  p_branch_subscription_id uuid,
  p_addon_version_id uuid,
  p_billing_cycle text,
  p_entitlement_from timestamptz,
  p_entitlement_until timestamptz,
  p_commercial_order_id uuid,
  p_commercial_order_line_id uuid,
  p_command_id uuid,
  p_actor_user_id uuid,
  p_provenance jsonb
)
returns uuid
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_subscription public.sellertray_branch_subscriptions%rowtype;
  v_addon public.sellertray_addon_versions%rowtype;
  v_existing public.sellertray_branch_subscription_addons%rowtype;
  v_definition_id uuid;
  v_id uuid;
begin
  if p_command_id is null or p_billing_cycle not in ('monthly','yearly','one_time')
     or p_entitlement_from is null or p_entitlement_until is null or p_entitlement_until<=p_entitlement_from
     or jsonb_typeof(coalesce(p_provenance,'{}'::jsonb))<>'object' then
    raise exception 'Valid Branch add-on entitlement facts are required' using errcode='22023';
  end if;

  select s.* into strict v_subscription
  from public.sellertray_branch_subscriptions s
  where s.tenant_id=p_tenant_id and s.id=p_branch_subscription_id;

  select a.* into strict v_addon
  from public.sellertray_addon_versions a
  where a.id=p_addon_version_id;

  if v_addon.status not in ('published','retired')
     or v_addon.effective_from is null
     or v_addon.effective_from>p_entitlement_from
     or (v_addon.effective_until is not null and v_addon.effective_until<=p_entitlement_from)
     or not (p_billing_cycle=any(v_addon.allowed_billing_cycles)) then
    raise exception 'Add-on Version is not eligible for this Branch Subscription term' using errcode='23514';
  end if;

  if v_subscription.entitlement_period_start is not null and (
       p_entitlement_from<v_subscription.entitlement_period_start
       or p_entitlement_until>coalesce(v_subscription.expected_full_term_end,v_subscription.entitlement_period_end)
     ) then
    raise exception 'Add-on entitlement must remain within the Branch Subscription term' using errcode='23514';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'sellertray-branch-subscription|'||p_tenant_id::text||'|'||v_subscription.branch_id::text,0
  ));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'sellertray-branch-addon-command|'||p_command_id::text,0
  ));

  select a.* into v_existing
  from public.sellertray_branch_subscription_addons a
  where a.tenant_id=p_tenant_id and a.creation_command_id=p_command_id;

  if found then
    if v_existing.branch_subscription_id=p_branch_subscription_id
       and v_existing.addon_version_id=p_addon_version_id
       and v_existing.billing_cycle=p_billing_cycle
       and v_existing.entitlement_from=p_entitlement_from
       and v_existing.entitlement_until=p_entitlement_until
       and v_existing.commercial_order_id is not distinct from p_commercial_order_id
       and v_existing.commercial_order_line_id is not distinct from p_commercial_order_line_id
       and v_existing.actor_user_id is not distinct from p_actor_user_id
       and v_existing.provenance=coalesce(p_provenance,'{}'::jsonb) then
      return v_existing.id;
    end if;
    raise exception 'Branch add-on creation command is already used for different facts' using errcode='23505';
  end if;

  select a.addon_definition_id into v_definition_id
  from public.sellertray_addon_versions a where a.id=p_addon_version_id;

  if exists(
    select 1
    from public.sellertray_branch_subscription_addons current_addon
    join public.sellertray_addon_versions current_version on current_version.id=current_addon.addon_version_id
    where current_addon.tenant_id=p_tenant_id
      and current_addon.branch_subscription_id=p_branch_subscription_id
      and current_version.addon_definition_id=v_definition_id
      and tstzrange(current_addon.entitlement_from,current_addon.entitlement_until,'[)')
          && tstzrange(p_entitlement_from,p_entitlement_until,'[)')
  ) then
    raise exception 'Overlapping versions of one add-on cannot apply to the same Branch Subscription term' using errcode='23P01';
  end if;

  insert into public.sellertray_branch_subscription_addons(
    tenant_id,branch_subscription_id,branch_id,addon_version_id,billing_cycle,
    entitlement_from,entitlement_until,commercial_order_id,commercial_order_line_id,
    creation_command_id,actor_user_id,provenance
  ) values (
    p_tenant_id,p_branch_subscription_id,v_subscription.branch_id,p_addon_version_id,p_billing_cycle,
    p_entitlement_from,p_entitlement_until,p_commercial_order_id,p_commercial_order_line_id,
    p_command_id,p_actor_user_id,coalesce(p_provenance,'{}'::jsonb)
  ) returning id into v_id;

  return v_id;
end;
$function$;

revoke all on function public.register_sellertray_branch_subscription_addon(
  uuid,uuid,uuid,text,timestamptz,timestamptz,uuid,uuid,uuid,uuid,jsonb
) from public,anon,authenticated;
grant execute on function public.register_sellertray_branch_subscription_addon(
  uuid,uuid,uuid,text,timestamptz,timestamptz,uuid,uuid,uuid,uuid,jsonb
) to service_role;

-- Direct table access is server-only. Merchant/Admin clients consume governed
-- RPC/read models rather than owning subscription state.
do $acl$
declare
  v_table text;
begin
  foreach v_table in array array[
    'sellertray_branch_subscriptions',
    'sellertray_branch_subscription_events',
    'sellertray_branch_subscription_addons'
  ] loop
    execute format('alter table public.%I enable row level security',v_table);
    execute format('revoke all on table public.%I from public,anon,authenticated',v_table);
    execute format('grant select,insert,update,delete on table public.%I to service_role',v_table);
  end loop;
end
$acl$;

commit;
