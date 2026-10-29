begin;

-- SellerTray OA2 commercial settlement surfaces
--
-- Separation of concerns is intentional:
-- - existing Billing & Commercial owns price publication, purchase creation,
--   agreements and Branch readiness;
-- - this slice owns settlement review, audited commercial credits/direct
--   payments and merchant/order installment-policy overrides;
-- - Merchant Billing is read-only over the same settlement truth and continues
--   to use billing-checkout for provider payment creation.

-- ---------------------------------------------------------------------------
-- 1. Scoped ProcessEdge Admin capabilities
-- ---------------------------------------------------------------------------

create table public.platform_admin_capability_grant_versions (
  id uuid primary key default gen_random_uuid(),
  grantee_user_id uuid not null references auth.users(id) on delete restrict,
  capability_code text not null,
  scope_kind text not null default 'platform',
  tenant_id uuid references public.tenants(id) on delete restrict,
  enabled boolean not null,
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  reason text not null,
  created_at timestamptz not null default now(),
  constraint platform_admin_capability_code_check
    check (capability_code in (
      'admin.pricing.manage',
      'admin.payments.reconcile',
      'admin.installments.manage'
    )),
  constraint platform_admin_capability_scope_check
    check (
      (scope_kind='platform' and tenant_id is null)
      or (scope_kind='tenant' and tenant_id is not null)
    ),
  constraint platform_admin_capability_effective_check
    check (effective_until is null or effective_until > effective_from),
  constraint platform_admin_capability_reason_check
    check (char_length(btrim(reason)) between 6 and 1000)
);

create index platform_admin_capability_resolution_idx
  on public.platform_admin_capability_grant_versions(
    grantee_user_id,capability_code,effective_from desc,created_at desc
  );
create index platform_admin_capability_tenant_idx
  on public.platform_admin_capability_grant_versions(
    tenant_id,grantee_user_id,capability_code,effective_from desc
  ) where tenant_id is not null;

create or replace function public.prevent_platform_admin_capability_history_mutation()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  raise exception 'Platform administrator capability history is append-only' using errcode='55000';
end;
$$;

revoke all on function public.prevent_platform_admin_capability_history_mutation()
  from public,anon,authenticated;

create trigger prevent_platform_admin_capability_history_mutation
before update or delete on public.platform_admin_capability_grant_versions
for each row execute function public.prevent_platform_admin_capability_history_mutation();

create or replace function public.platform_admin_has_capability(
  p_actor_user_id uuid,
  p_capability_code text,
  p_tenant_id uuid default null,
  p_as_of timestamptz default now()
)
returns boolean
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_role text;
  v_enabled boolean;
begin
  select pa.role into v_role
  from public.platform_admins pa
  where pa.user_id=p_actor_user_id;

  if v_role='admin' then
    return true;
  end if;
  if v_role is distinct from 'support' then
    return false;
  end if;

  select g.enabled into v_enabled
  from public.platform_admin_capability_grant_versions g
  where g.grantee_user_id=p_actor_user_id
    and g.capability_code=p_capability_code
    and g.effective_from<=p_as_of
    and (g.effective_until is null or g.effective_until>p_as_of)
    and (
      g.scope_kind='platform'
      or (g.scope_kind='tenant' and p_tenant_id is not null and g.tenant_id=p_tenant_id)
    )
  order by
    case g.scope_kind when 'tenant' then 200 else 100 end desc,
    g.effective_from desc,
    g.created_at desc
  limit 1;

  return coalesce(v_enabled,false);
end;
$$;

revoke all on function public.platform_admin_has_capability(uuid,text,uuid,timestamptz)
  from public,anon,authenticated;
grant execute on function public.platform_admin_has_capability(uuid,text,uuid,timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- 2. Idempotent policy-change command ledger
-- ---------------------------------------------------------------------------

create table public.sellertray_installment_policy_change_commands (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  command_id uuid not null,
  policy_version_id uuid not null references public.sellertray_installment_policy_versions(id) on delete restrict,
  request_payload jsonb not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (tenant_id,command_id),
  constraint sellertray_installment_policy_change_payload_check
    check (jsonb_typeof(request_payload)='object')
);

create trigger prevent_sellertray_installment_policy_change_command_mutation
before update or delete on public.sellertray_installment_policy_change_commands
for each row execute function public.prevent_sellertray_commercial_history_mutation();

-- ---------------------------------------------------------------------------
-- 3. Shared settlement detail projection
-- ---------------------------------------------------------------------------

create or replace function public.get_sellertray_commercial_settlement_detail_internal(
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
  v_plan_code text;
  v_billing_cycle text;
  v_obligation_id uuid;
  v_settlement jsonb;
  v_billing jsonb;
  v_policy jsonb;
  v_contract jsonb;
  v_adjustments jsonb;
  v_direct_payments jsonb;
  v_gateway_payments jsonb;
begin
  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.tenant_id=p_tenant_id and o.id=p_commercial_order_id;

  select s.plan_code,s.billing_cycle
    into v_plan_code,v_billing_cycle
  from public.sellertray_commercial_order_price_snapshots s
  where s.tenant_id=p_tenant_id
    and s.commercial_order_id=p_commercial_order_id
    and s.line_type='subscription'
  order by s.line_no
  limit 1;

  select io.id into v_obligation_id
  from public.sellertray_commercial_installment_obligations io
  where io.tenant_id=p_tenant_id and io.commercial_order_id=p_commercial_order_id
  order by io.created_at,io.id
  limit 1;

  v_settlement := public.get_sellertray_commercial_settlement_state(
    p_tenant_id,p_commercial_order_id
  );

  if v_obligation_id is not null then
    v_billing := public.get_sellertray_installment_billing_state(
      p_tenant_id,v_obligation_id
    );
    select jsonb_build_object(
      'id',cs.id,
      'policyVersionId',cs.policy_version_id,
      'templateId',cs.template_id,
      'templateCode',cs.template_code,
      'templateVersion',cs.template_version,
      'templateDisplayName',t.display_name,
      'provisionalEntitlementMonths',cs.provisional_entitlement_months,
      'qualifyingSettlementSequence',cs.qualifying_settlement_sequence,
      'snapshottedAt',cs.snapshotted_at
    ) into v_contract
    from public.sellertray_installment_contract_snapshots cs
    join public.sellertray_installment_schedule_templates t on t.id=cs.template_id
    where cs.tenant_id=p_tenant_id and cs.installment_obligation_id=v_obligation_id;
  else
    v_billing := null;
    v_contract := null;
  end if;

  if v_plan_code is not null and v_billing_cycle is not null then
    v_policy := public.resolve_sellertray_installment_policy(
      p_tenant_id,p_commercial_order_id,v_plan_code,v_billing_cycle,now()
    );
  else
    v_policy := null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',a.id,
    'commandId',a.command_id,
    'type',a.adjustment_type,
    'amount',a.amount,
    'currency',a.currency,
    'reason',a.reason,
    'evidence',a.evidence,
    'actorUserId',a.actor_user_id,
    'approvedAt',a.approved_at,
    'recordedAt',a.recorded_at
  ) order by a.approved_at desc,a.recorded_at desc,a.id desc),'[]'::jsonb)
  into v_adjustments
  from public.sellertray_commercial_adjustments a
  where a.tenant_id=p_tenant_id and a.commercial_order_id=p_commercial_order_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',d.id,
    'commandId',d.command_id,
    'paymentReference',d.payment_reference,
    'paymentMethod',d.payment_method,
    'amount',d.amount,
    'currency',d.currency,
    'reason',d.reason,
    'evidence',d.evidence,
    'actorUserId',d.actor_user_id,
    'paidAt',d.paid_at,
    'recordedAt',d.recorded_at
  ) order by d.paid_at desc,d.recorded_at desc,d.id desc),'[]'::jsonb)
  into v_direct_payments
  from public.sellertray_commercial_direct_payment_confirmations d
  where d.tenant_id=p_tenant_id and d.commercial_order_id=p_commercial_order_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,
    'installmentScheduleId',p.installment_schedule_id,
    'provider',p.provider,
    'providerReference',p.provider_reference,
    'amount',p.amount,
    'currency',p.currency,
    'paidAt',p.paid_at,
    'recordedAt',p.recorded_at
  ) order by p.paid_at desc,p.recorded_at desc,p.id desc),'[]'::jsonb)
  into v_gateway_payments
  from public.sellertray_commercial_installment_payment_confirmations p
  where p.tenant_id=p_tenant_id and p.commercial_order_id=p_commercial_order_id;

  return jsonb_build_object(
    'tenantId',p_tenant_id,
    'commercialOrderId',v_order.id,
    'orderReference',v_order.order_reference,
    'orderedAt',v_order.ordered_at,
    'currency',v_order.currency,
    'grossAmount',v_order.total_gross_amount,
    'planCode',v_plan_code,
    'billingCycle',v_billing_cycle,
    'installmentObligationId',v_obligation_id,
    'settlement',v_settlement,
    'billingState',v_billing,
    'contractSnapshot',v_contract,
    'currentInstallmentPolicy',v_policy,
    'adjustments',v_adjustments,
    'directPayments',v_direct_payments,
    'gatewayPayments',v_gateway_payments
  );
end;
$$;

revoke all on function public.get_sellertray_commercial_settlement_detail_internal(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.get_sellertray_commercial_settlement_detail_internal(uuid,uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 4. Admin settlement center read authority
-- ---------------------------------------------------------------------------

create or replace function public.platform_admin_commercial_settlement_center(
  p_actor_user_id uuid,
  p_tenant_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_role text;
  v_orders jsonb;
  v_templates jsonb;
begin
  if p_actor_user_id is null or p_tenant_id is null then
    raise exception 'Administrator and Business are required' using errcode='22023';
  end if;

  select pa.role into v_role
  from public.platform_admins pa
  where pa.user_id=p_actor_user_id;
  if v_role not in ('admin','support') then
    raise exception 'Platform administrator access required' using errcode='42501';
  end if;
  if not exists (select 1 from public.tenants t where t.id=p_tenant_id) then
    raise exception 'SellerTray business not found' using errcode='P0002';
  end if;

  select coalesce(jsonb_agg(
    public.get_sellertray_commercial_settlement_detail_internal(p_tenant_id,o.id)
    order by o.ordered_at desc,o.id desc
  ),'[]'::jsonb)
  into v_orders
  from public.sellertray_commercial_orders o
  where o.tenant_id=p_tenant_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',t.id,
    'code',t.template_code,
    'version',t.version,
    'displayName',t.display_name,
    'status',t.status,
    'provisionalEntitlementMonths',t.provisional_entitlement_months,
    'qualifyingSettlementSequence',t.qualifying_settlement_sequence,
    'effectiveFrom',t.effective_from,
    'effectiveUntil',t.effective_until,
    'lines',coalesce((
      select jsonb_agg(jsonb_build_object(
        'sequenceNo',l.sequence_no,
        'percentage',l.percentage,
        'fixedAmount',l.fixed_amount,
        'dueOffsetDays',l.due_offset_days
      ) order by l.sequence_no)
      from public.sellertray_installment_schedule_template_lines l
      where l.template_id=t.id
    ),'[]'::jsonb)
  ) order by t.template_code,t.version desc),'[]'::jsonb)
  into v_templates
  from public.sellertray_installment_schedule_templates t
  where t.status='published'
    and t.effective_from<=now()
    and (t.effective_until is null or t.effective_until>now());

  return jsonb_build_object(
    'actorRole',v_role,
    'tenantId',p_tenant_id,
    'capabilities',jsonb_build_object(
      'canAdjust',public.platform_admin_has_capability(
        p_actor_user_id,'admin.pricing.manage',p_tenant_id,now()
      ),
      'canConfirmDirectPayment',public.platform_admin_has_capability(
        p_actor_user_id,'admin.payments.reconcile',p_tenant_id,now()
      ),
      'canManageInstallments',public.platform_admin_has_capability(
        p_actor_user_id,'admin.installments.manage',p_tenant_id,now()
      )
    ),
    'templates',v_templates,
    'orders',v_orders,
    'generatedAt',now()
  );
end;
$$;

revoke all on function public.platform_admin_commercial_settlement_center(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.platform_admin_commercial_settlement_center(uuid,uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 5. Merchant Billing read authority
-- ---------------------------------------------------------------------------

create or replace function public.get_sellertray_commercial_billing_center(
  p_tenant_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_role text;
  v_orders jsonb;
begin
  if p_tenant_id is null or p_actor_user_id is null then
    raise exception 'Business and user are required' using errcode='22023';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;
  if v_role not in ('owner','manager') then
    raise exception 'Merchant billing access requires an Owner or Manager' using errcode='42501';
  end if;

  select coalesce(jsonb_agg(
    public.get_sellertray_commercial_settlement_detail_internal(p_tenant_id,o.id)
    order by o.ordered_at desc,o.id desc
  ),'[]'::jsonb)
  into v_orders
  from public.sellertray_commercial_orders o
  where o.tenant_id=p_tenant_id;

  return jsonb_build_object(
    'tenantId',p_tenant_id,
    'actorRole',v_role,
    'canPay',v_role='owner',
    'orders',v_orders,
    'generatedAt',now()
  );
end;
$$;

revoke all on function public.get_sellertray_commercial_billing_center(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.get_sellertray_commercial_billing_center(uuid,uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 6. Capability-gated Admin settlement mutations
-- ---------------------------------------------------------------------------

create or replace function public.platform_admin_record_commercial_adjustment(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_command_id uuid,
  p_amount numeric,
  p_reason text,
  p_evidence jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_obligation_id uuid;
  v_state jsonb;
begin
  if not public.platform_admin_has_capability(
    p_actor_user_id,'admin.pricing.manage',p_tenant_id,now()
  ) then
    raise exception 'Commercial pricing capability required' using errcode='42501';
  end if;
  if char_length(btrim(coalesce(p_reason,'')))<6 then
    raise exception 'Adjustment reason must be at least 6 characters' using errcode='22023';
  end if;
  if p_evidence is null or jsonb_typeof(p_evidence)<>'object' then
    raise exception 'Adjustment evidence must be an object' using errcode='22023';
  end if;

  v_state := public.record_sellertray_commercial_adjustment_internal(
    p_tenant_id,p_commercial_order_id,p_command_id,p_amount,p_reason,p_evidence,p_actor_user_id
  );

  select io.id into v_obligation_id
  from public.sellertray_commercial_installment_obligations io
  where io.tenant_id=p_tenant_id and io.commercial_order_id=p_commercial_order_id
  order by io.created_at,io.id limit 1;
  if v_obligation_id is not null then
    perform public.reconcile_sellertray_installment_entitlement(p_tenant_id,v_obligation_id);
  end if;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values (
    p_actor_user_id,p_tenant_id,'commercial_adjustment_recorded',
    jsonb_build_object(
      'commercialOrderId',p_commercial_order_id,
      'commandId',p_command_id,
      'amount',round(p_amount::numeric,2),
      'reason',btrim(p_reason)
    )
  );

  return public.get_sellertray_commercial_settlement_detail_internal(
    p_tenant_id,p_commercial_order_id
  );
end;
$$;

create or replace function public.platform_admin_record_commercial_direct_payment(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_command_id uuid,
  p_payment_reference text,
  p_payment_method text,
  p_amount numeric,
  p_paid_at timestamptz,
  p_reason text,
  p_evidence jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_obligation_id uuid;
  v_state jsonb;
begin
  if not public.platform_admin_has_capability(
    p_actor_user_id,'admin.payments.reconcile',p_tenant_id,now()
  ) then
    raise exception 'Payment reconciliation capability required' using errcode='42501';
  end if;
  if char_length(btrim(coalesce(p_reason,'')))<6 then
    raise exception 'Direct payment reason must be at least 6 characters' using errcode='22023';
  end if;
  if p_paid_at is null or p_paid_at>now()+interval '5 minutes' then
    raise exception 'Direct payment time is invalid' using errcode='22023';
  end if;
  if p_evidence is null or jsonb_typeof(p_evidence)<>'object' then
    raise exception 'Direct payment evidence must be an object' using errcode='22023';
  end if;

  v_state := public.record_sellertray_commercial_direct_payment_internal(
    p_tenant_id,p_commercial_order_id,p_command_id,p_payment_reference,p_payment_method,
    p_amount,p_paid_at,p_reason,p_evidence,p_actor_user_id
  );

  select io.id into v_obligation_id
  from public.sellertray_commercial_installment_obligations io
  where io.tenant_id=p_tenant_id and io.commercial_order_id=p_commercial_order_id
  order by io.created_at,io.id limit 1;
  if v_obligation_id is not null then
    perform public.reconcile_sellertray_installment_entitlement(p_tenant_id,v_obligation_id);
  end if;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values (
    p_actor_user_id,p_tenant_id,'commercial_direct_payment_confirmed',
    jsonb_build_object(
      'commercialOrderId',p_commercial_order_id,
      'commandId',p_command_id,
      'paymentReference',btrim(p_payment_reference),
      'paymentMethod',lower(btrim(p_payment_method)),
      'amount',round(p_amount::numeric,2),
      'paidAt',p_paid_at,
      'reason',btrim(p_reason)
    )
  );

  return public.get_sellertray_commercial_settlement_detail_internal(
    p_tenant_id,p_commercial_order_id
  );
end;
$$;

create or replace function public.platform_admin_publish_installment_policy_override(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_command_id uuid,
  p_scope_kind text,
  p_commercial_order_id uuid,
  p_billing_cycle text,
  p_enabled boolean,
  p_template_id uuid,
  p_effective_from timestamptz,
  p_effective_until timestamptz,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_payload jsonb;
  v_existing public.sellertray_installment_policy_change_commands%rowtype;
  v_policy_id uuid;
begin
  if not public.platform_admin_has_capability(
    p_actor_user_id,'admin.installments.manage',p_tenant_id,now()
  ) then
    raise exception 'Installment management capability required' using errcode='42501';
  end if;
  if p_scope_kind not in ('tenant','commercial_order') then
    raise exception 'Settlement page supports only Business or commercial-order installment overrides'
      using errcode='22023';
  end if;
  if p_scope_kind='tenant' then
    if p_commercial_order_id is not null or p_billing_cycle not in ('monthly','yearly') then
      raise exception 'Business installment override requires monthly or yearly billing cycle and no order'
        using errcode='22023';
    end if;
  else
    if p_commercial_order_id is null or p_billing_cycle is not null then
      raise exception 'Commercial-order installment override requires an order and no billing cycle'
        using errcode='22023';
    end if;
    if not exists (
      select 1 from public.sellertray_commercial_orders o
      where o.tenant_id=p_tenant_id and o.id=p_commercial_order_id
    ) then
      raise exception 'Commercial order not found for this Business' using errcode='P0002';
    end if;
  end if;
  if p_enabled and p_template_id is null then
    raise exception 'Enabled installment override requires a governed schedule template'
      using errcode='22023';
  end if;
  if p_template_id is not null and not exists (
    select 1 from public.sellertray_installment_schedule_templates t
    where t.id=p_template_id and t.status='published'
      and t.effective_from<=coalesce(p_effective_from,now())
      and (t.effective_until is null or t.effective_until>coalesce(p_effective_from,now()))
  ) then
    raise exception 'Installment schedule template is not active for the requested effective time'
      using errcode='23514';
  end if;
  if p_effective_from is null or (p_effective_until is not null and p_effective_until<=p_effective_from) then
    raise exception 'Installment override effective period is invalid' using errcode='22023';
  end if;
  if char_length(btrim(coalesce(p_reason,'')))<6 then
    raise exception 'Installment override reason must be at least 6 characters' using errcode='22023';
  end if;

  v_payload := jsonb_build_object(
    'scopeKind',p_scope_kind,
    'commercialOrderId',p_commercial_order_id,
    'billingCycle',p_billing_cycle,
    'enabled',p_enabled,
    'templateId',p_template_id,
    'effectiveFrom',p_effective_from,
    'effectiveUntil',p_effective_until,
    'reason',btrim(p_reason)
  );

  select c.* into v_existing
  from public.sellertray_installment_policy_change_commands c
  where c.tenant_id=p_tenant_id and c.command_id=p_command_id;
  if found then
    if v_existing.request_payload<>v_payload then
      raise exception 'Installment policy command id was already used with different input'
        using errcode='23505';
    end if;
    v_policy_id := v_existing.policy_version_id;
  else
    insert into public.sellertray_installment_policy_versions(
      scope_kind,tenant_id,commercial_order_id,plan_code,billing_cycle,
      enabled,default_template_id,effective_from,effective_until,
      created_by_user_id,change_reason
    ) values (
      p_scope_kind,p_tenant_id,p_commercial_order_id,null,p_billing_cycle,
      p_enabled,case when p_enabled then p_template_id else null end,
      p_effective_from,p_effective_until,p_actor_user_id,btrim(p_reason)
    ) returning id into v_policy_id;

    insert into public.sellertray_installment_policy_change_commands(
      tenant_id,command_id,policy_version_id,request_payload,actor_user_id
    ) values (
      p_tenant_id,p_command_id,v_policy_id,v_payload,p_actor_user_id
    );

    insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
    values (
      p_actor_user_id,p_tenant_id,'installment_policy_override_published',
      v_payload || jsonb_build_object('commandId',p_command_id,'policyVersionId',v_policy_id)
    );
  end if;

  return public.platform_admin_commercial_settlement_center(p_actor_user_id,p_tenant_id);
end;
$$;

revoke all on function public.platform_admin_record_commercial_adjustment(uuid,uuid,uuid,uuid,numeric,text,jsonb)
  from public,anon,authenticated;
revoke all on function public.platform_admin_record_commercial_direct_payment(uuid,uuid,uuid,uuid,text,text,numeric,timestamptz,text,jsonb)
  from public,anon,authenticated;
revoke all on function public.platform_admin_publish_installment_policy_override(uuid,uuid,uuid,text,uuid,text,boolean,uuid,timestamptz,timestamptz,text)
  from public,anon,authenticated;

grant execute on function public.platform_admin_record_commercial_adjustment(uuid,uuid,uuid,uuid,numeric,text,jsonb)
  to service_role;
grant execute on function public.platform_admin_record_commercial_direct_payment(uuid,uuid,uuid,uuid,text,text,numeric,timestamptz,text,jsonb)
  to service_role;
grant execute on function public.platform_admin_publish_installment_policy_override(uuid,uuid,uuid,text,uuid,text,boolean,uuid,timestamptz,timestamptz,text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 7. Client boundaries
-- ---------------------------------------------------------------------------

alter table public.platform_admin_capability_grant_versions enable row level security;
alter table public.sellertray_installment_policy_change_commands enable row level security;

revoke all on public.platform_admin_capability_grant_versions from public,anon,authenticated;
revoke all on public.sellertray_installment_policy_change_commands from public,anon,authenticated;

grant select,insert on public.platform_admin_capability_grant_versions to service_role;
grant select,insert on public.sellertray_installment_policy_change_commands to service_role;

commit;
