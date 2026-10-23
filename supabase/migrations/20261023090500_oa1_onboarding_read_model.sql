begin;

-- SellerTray OA1: derive one onboarding/readiness state from existing commercial
-- authorities while preserving legacy tenants on the pre-OA1 compatibility path.
-- The enrollment marker selects the new lifecycle; it is not activation truth.
alter table public.tenants
  add column if not exists commercial_onboarding_required boolean not null default false;

comment on column public.tenants.commercial_onboarding_required is
  'Rollout marker: true for Businesses provisioned into governed SellerTray commercial onboarding. Activation remains derived from commercial entitlement/setup authority.';

-- The live authority no longer exposes this historical self-service RPC. Keep
-- forward/fresh installs converged so Business creation cannot bypass the
-- service-authoritative provisioning command and onboarding enrollment.
drop function if exists public.create_my_business(text,text,text,text);

create or replace function public.sellertray_onboarding_live_operations_allowed(
  p_tenant_id uuid
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select coalesce((
    select case
      when not t.commercial_onboarding_required then
        public.orderdesk_subscription_can_write(t.id)
      else
        public.orderdesk_subscription_can_write(t.id)
        and public.sellertray_c1b_runtime_period_state(t.id) in ('provisional','full_term')
    end
    from public.tenants t
    where t.id=p_tenant_id
  ),false);
$$;

revoke all on function public.sellertray_onboarding_live_operations_allowed(uuid)
  from public,anon,authenticated;
grant execute on function public.sellertray_onboarding_live_operations_allowed(uuid)
  to service_role;

create or replace function public.guard_sellertray_onboarding_live_operation()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_tenant_id uuid;
begin
  v_tenant_id := case when tg_op='DELETE' then old.tenant_id else new.tenant_id end;
  if not public.sellertray_onboarding_live_operations_allowed(v_tenant_id) then
    raise exception 'SellerTray setup is not active yet. Complete commercial setup and activation before live operations.'
      using errcode='42501';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.guard_sellertray_onboarding_live_operation()
  from public,anon,authenticated;
grant execute on function public.guard_sellertray_onboarding_live_operation()
  to service_role;

-- Live commerce and operational money/stock movement are blocked for newly
-- enrolled Businesses until governed entitlement becomes active. Business,
-- Branch, catalogue, customer, payment-method and other preparation/configuration
-- authorities remain available through their existing permission boundaries.
drop trigger if exists guard_sellertray_onboarding_orders on public.orders;
create trigger guard_sellertray_onboarding_orders before insert or update or delete on public.orders
for each row execute function public.guard_sellertray_onboarding_live_operation();

drop trigger if exists guard_sellertray_onboarding_order_items on public.order_items;
create trigger guard_sellertray_onboarding_order_items before insert or update or delete on public.order_items
for each row execute function public.guard_sellertray_onboarding_live_operation();

drop trigger if exists guard_sellertray_onboarding_order_payments on public.order_payments;
create trigger guard_sellertray_onboarding_order_payments before insert or update or delete on public.order_payments
for each row execute function public.guard_sellertray_onboarding_live_operation();

drop trigger if exists guard_sellertray_onboarding_order_payment_events on public.order_payment_events;
create trigger guard_sellertray_onboarding_order_payment_events before insert or update or delete on public.order_payment_events
for each row execute function public.guard_sellertray_onboarding_live_operation();

drop trigger if exists guard_sellertray_onboarding_financial_documents on public.order_financial_documents;
create trigger guard_sellertray_onboarding_financial_documents before insert or update or delete on public.order_financial_documents
for each row execute function public.guard_sellertray_onboarding_live_operation();

drop trigger if exists guard_sellertray_onboarding_cash_shifts on public.sellertray_cash_shifts;
create trigger guard_sellertray_onboarding_cash_shifts before insert or update or delete on public.sellertray_cash_shifts
for each row execute function public.guard_sellertray_onboarding_live_operation();

drop trigger if exists guard_sellertray_onboarding_shift_cash_sales on public.sellertray_shift_cash_sales;
create trigger guard_sellertray_onboarding_shift_cash_sales before insert or update or delete on public.sellertray_shift_cash_sales
for each row execute function public.guard_sellertray_onboarding_live_operation();

drop trigger if exists guard_sellertray_onboarding_shift_payments on public.sellertray_shift_payments;
create trigger guard_sellertray_onboarding_shift_payments before insert or update or delete on public.sellertray_shift_payments
for each row execute function public.guard_sellertray_onboarding_live_operation();

drop trigger if exists guard_sellertray_onboarding_shift_cash_movements on public.sellertray_shift_cash_movements;
create trigger guard_sellertray_onboarding_shift_cash_movements before insert or update or delete on public.sellertray_shift_cash_movements
for each row execute function public.guard_sellertray_onboarding_live_operation();

drop trigger if exists guard_sellertray_onboarding_business_expenses on public.sellertray_business_expenses;
create trigger guard_sellertray_onboarding_business_expenses before insert or update or delete on public.sellertray_business_expenses
for each row execute function public.guard_sellertray_onboarding_live_operation();

drop trigger if exists guard_sellertray_onboarding_inventory_movements on public.inventory_movements;
create trigger guard_sellertray_onboarding_inventory_movements before insert or update or delete on public.inventory_movements
for each row execute function public.guard_sellertray_onboarding_live_operation();

drop trigger if exists guard_sellertray_onboarding_stock_counts on public.stock_counts;
create trigger guard_sellertray_onboarding_stock_counts before insert or update or delete on public.stock_counts
for each row execute function public.guard_sellertray_onboarding_live_operation();

drop trigger if exists guard_sellertray_onboarding_stock_count_items on public.stock_count_items;
create trigger guard_sellertray_onboarding_stock_count_items before insert or update or delete on public.stock_count_items
for each row execute function public.guard_sellertray_onboarding_live_operation();

drop trigger if exists guard_sellertray_onboarding_stock_transfers on public.stock_transfers;
create trigger guard_sellertray_onboarding_stock_transfers before insert or update or delete on public.stock_transfers
for each row execute function public.guard_sellertray_onboarding_live_operation();

drop trigger if exists guard_sellertray_onboarding_stock_transfer_items on public.stock_transfer_items;
create trigger guard_sellertray_onboarding_stock_transfer_items before insert or update or delete on public.stock_transfer_items
for each row execute function public.guard_sellertray_onboarding_live_operation();

drop trigger if exists guard_sellertray_onboarding_purchase_orders on public.sellertray_purchase_orders;
create trigger guard_sellertray_onboarding_purchase_orders before insert or update or delete on public.sellertray_purchase_orders
for each row execute function public.guard_sellertray_onboarding_live_operation();

drop trigger if exists guard_sellertray_onboarding_purchase_order_items on public.sellertray_purchase_order_items;
create trigger guard_sellertray_onboarding_purchase_order_items before insert or update or delete on public.sellertray_purchase_order_items
for each row execute function public.guard_sellertray_onboarding_live_operation();

drop trigger if exists guard_sellertray_onboarding_purchase_receipts on public.sellertray_purchase_receipts;
create trigger guard_sellertray_onboarding_purchase_receipts before insert or update or delete on public.sellertray_purchase_receipts
for each row execute function public.guard_sellertray_onboarding_live_operation();

drop trigger if exists guard_sellertray_onboarding_purchase_receipt_items on public.sellertray_purchase_receipt_items;
create trigger guard_sellertray_onboarding_purchase_receipt_items before insert or update or delete on public.sellertray_purchase_receipt_items
for each row execute function public.guard_sellertray_onboarding_live_operation();

drop trigger if exists guard_sellertray_onboarding_supplier_payments on public.sellertray_supplier_payments;
create trigger guard_sellertray_onboarding_supplier_payments before insert or update or delete on public.sellertray_supplier_payments
for each row execute function public.guard_sellertray_onboarding_live_operation();

drop trigger if exists guard_sellertray_onboarding_supplier_payment_reversals on public.sellertray_supplier_payment_reversals;
create trigger guard_sellertray_onboarding_supplier_payment_reversals before insert or update or delete on public.sellertray_supplier_payment_reversals
for each row execute function public.guard_sellertray_onboarding_live_operation();

drop trigger if exists guard_sellertray_onboarding_sale_returns on public.sale_returns;
create trigger guard_sellertray_onboarding_sale_returns before insert or update or delete on public.sale_returns
for each row execute function public.guard_sellertray_onboarding_live_operation();

drop trigger if exists guard_sellertray_onboarding_sale_return_items on public.sale_return_items;
create trigger guard_sellertray_onboarding_sale_return_items before insert or update or delete on public.sale_return_items
for each row execute function public.guard_sellertray_onboarding_live_operation();

drop trigger if exists guard_sellertray_onboarding_payment_refunds on public.payment_refunds;
create trigger guard_sellertray_onboarding_payment_refunds before insert or update or delete on public.payment_refunds
for each row execute function public.guard_sellertray_onboarding_live_operation();

create or replace function public.sellertray_onboarding_state_impl(
  p_tenant_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_tenant public.tenants%rowtype;
  v_subscription jsonb;
  v_obligation_id uuid;
  v_billing jsonb;
  v_active_branches integer := 0;
  v_operations_allowed boolean := false;
  v_enrolled boolean := false;
  v_agreement_accepted boolean := false;
  v_first_payment_confirmed boolean := false;
  v_setup_required integer := 0;
  v_setup_ready integer := 0;
  v_setup_complete boolean := false;
  v_stage text;
  v_next_code text;
  v_next_label text;
  v_next_surface text;
  v_blockers jsonb := '[]'::jsonb;
  v_step integer := 1;
begin
  select t.* into v_tenant
  from public.tenants t
  where t.id=p_tenant_id;
  if not found then
    raise exception 'Business not found' using errcode='P0002';
  end if;

  v_enrolled := v_tenant.commercial_onboarding_required;
  select count(*)::integer into v_active_branches
  from public.branches b
  where b.tenant_id=p_tenant_id and b.is_active;

  v_subscription := public.get_orderdesk_subscription_access(p_tenant_id);

  -- OA1 models first activation. Initial-purchase creation is already serialized
  -- and limited to one governed first subscription order by the C1B authority.
  select o.id into v_obligation_id
  from public.sellertray_commercial_installment_obligations o
  where o.tenant_id=p_tenant_id
  order by o.created_at,o.id
  limit 1;

  if v_obligation_id is not null then
    v_billing := public.get_sellertray_installment_billing_state(p_tenant_id,v_obligation_id);
    v_agreement_accepted := coalesce((v_billing->>'agreementAccepted')::boolean,false);
    v_first_payment_confirmed := nullif(v_billing->>'firstPaidAt','') is not null;
    v_setup_required := coalesce((v_billing->>'setupRequiredCount')::integer,0);
    v_setup_ready := coalesce((v_billing->>'setupReadyCount')::integer,0);
    v_setup_complete := coalesce((v_billing->>'setupReady')::boolean,false);
  end if;

  v_operations_allowed := public.sellertray_onboarding_live_operations_allowed(p_tenant_id);

  if v_operations_allowed then
    v_stage := 'active';
    v_next_code := 'start_selling';
    v_next_label := 'Start selling';
    v_next_surface := 'mobile';
    v_step := 6;
  elsif v_active_branches=0 then
    v_stage := 'business_setup';
    v_next_code := 'add_branch';
    v_next_label := 'Add your first Branch';
    v_next_surface := 'merchant_web';
    v_step := 1;
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code','branch_required','message','Add at least one active Branch for SellerTray setup.'
    ));
  elsif v_obligation_id is null then
    v_stage := 'commercial_purchase';
    v_next_code := 'complete_purchase';
    v_next_label := 'Choose your plan & pay';
    v_next_surface := 'merchant_web';
    v_step := 2;
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code','commercial_order_required','message','Complete the SellerTray commercial purchase for this Business.'
    ));
  elsif not v_agreement_accepted then
    v_stage := 'agreement';
    v_next_code := 'review_agreement';
    v_next_label := 'Review and accept agreement';
    v_next_surface := 'merchant_web';
    v_step := 3;
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code','agreement_required','message','Accept the current SellerTray commercial agreement.'
    ));
  elsif not v_first_payment_confirmed then
    v_stage := 'payment';
    v_next_code := 'pay';
    v_next_label := 'Complete payment';
    v_next_surface := 'merchant_web';
    v_step := 4;
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code','payment_required','message','A qualifying confirmed payment is required before setup activation can proceed.'
    ));
  elsif not v_setup_complete then
    v_stage := 'setup';
    v_next_code := 'setup_pending';
    v_next_label := 'Schedule or complete Branch setup';
    v_next_surface := 'merchant_web';
    v_step := 5;
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code','setup_required',
      'message','Complete setup for every Branch included in this purchase.',
      'requiredCount',v_setup_required,
      'readyCount',v_setup_ready
    ));
  else
    v_stage := 'activating';
    v_next_code := 'refresh_activation';
    v_next_label := 'Check activation';
    v_next_surface := 'mobile';
    v_step := 5;
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code','activation_reconciliation','message','Setup is complete. SellerTray is reconciling activation.'
    ));
  end if;

  return jsonb_build_object(
    'tenantId',p_tenant_id,
    'enrolled',v_enrolled,
    'compatibilityMode',not v_enrolled,
    'stage',v_stage,
    'operationsAllowed',v_operations_allowed,
    'progress',jsonb_build_object('current',v_step,'total',6),
    'nextAction',jsonb_build_object(
      'code',v_next_code,
      'label',v_next_label,
      'surface',v_next_surface
    ),
    'blockers',v_blockers,
    'branch',jsonb_build_object('activeCount',v_active_branches),
    'commercial',jsonb_build_object(
      'installmentObligationId',v_obligation_id,
      'agreementAccepted',v_agreement_accepted,
      'firstPaymentConfirmed',v_first_payment_confirmed,
      'setupRequiredCount',v_setup_required,
      'setupReadyCount',v_setup_ready,
      'setupComplete',v_setup_complete,
      'entitlementState',case when v_billing is null then null else v_billing->>'entitlementState' end,
      'activationAt',case when v_billing is null then null else v_billing->'activationAt' end,
      'provisionalUntil',case when v_billing is null then null else v_billing->'provisionalUntil' end,
      'fullTermUntil',case when v_billing is null then null else v_billing->'fullTermUntil' end
    ),
    'runtime',jsonb_build_object(
      'baseStatus',v_subscription->>'baseStatus',
      'effectiveStatus',v_subscription->>'effectiveStatus',
      'accessMode',v_subscription->>'accessMode',
      'commercialEntitlementState',v_subscription->>'commercialEntitlementState'
    )
  );
end;
$$;

revoke all on function public.sellertray_onboarding_state_impl(uuid)
  from public,anon,authenticated;
grant execute on function public.sellertray_onboarding_state_impl(uuid)
  to service_role;

create or replace function public.get_sellertray_onboarding_state(
  p_tenant_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_state jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;
  if v_role is null then
    raise exception 'SellerTray Business access required' using errcode='42501';
  end if;

  v_state := public.sellertray_onboarding_state_impl(p_tenant_id);
  return v_state || jsonb_build_object(
    'actorRole',v_role,
    'canManageCommercial',v_role in ('owner','manager')
  );
end;
$$;

revoke all on function public.get_sellertray_onboarding_state(uuid)
  from public,anon;
grant execute on function public.get_sellertray_onboarding_state(uuid)
  to authenticated;

create or replace function public.get_sellertray_onboarding_state_admin(
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
begin
  select pa.role into v_role
  from public.platform_admins pa
  where pa.user_id=p_actor_user_id;
  if v_role not in ('admin','support') then
    raise exception 'Platform administrator access required' using errcode='42501';
  end if;

  -- Read-only OA1 visibility preserves the currently approved Admin/Support
  -- commercial-read behavior. No privileged mutation is introduced here.
  return public.sellertray_onboarding_state_impl(p_tenant_id)
    || jsonb_build_object('actorRole',v_role,'canManageCommercial',v_role='admin');
end;
$$;

revoke all on function public.get_sellertray_onboarding_state_admin(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.get_sellertray_onboarding_state_admin(uuid,uuid)
  to service_role;

-- Future self-service provisioning enters the governed onboarding lifecycle.
-- Existing Businesses keep commercial_onboarding_required=false so OA1 does not
-- silently revoke their pre-C2 compatibility access.
create or replace function public.provision_business_for_user(
  p_user_id uuid,
  p_name text,
  p_business_email text default null,
  p_business_phone text default null,
  p_business_type text default null,
  p_merchant_code text default null
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_tenant_id uuid;
  v_slug_base text;
  v_slug text;
  v_code text;
  v_compact text;
  v_try integer;
  v_user_chosen boolean := nullif(btrim(coalesce(p_merchant_code,'')),'') is not null;
begin
  if p_user_id is null or not exists (
    select 1 from auth.users u where u.id=p_user_id
  ) then
    raise exception 'Valid user is required' using errcode='42501';
  end if;

  if exists (
    select 1 from public.tenant_members tm where tm.user_id=p_user_id
  ) then
    raise exception 'Initial business provisioning is only available when no workspace exists' using errcode='23514';
  end if;

  if nullif(btrim(p_name),'') is null then
    raise exception 'Business name is required' using errcode='23514';
  end if;

  if v_user_chosen then
    v_code := upper(btrim(p_merchant_code));
    if v_code !~ '^[A-Z0-9]{3}$' then
      raise exception 'Merchant ID must be exactly 3 letters or numbers' using errcode='22023';
    end if;
    perform pg_advisory_xact_lock(hashtext('sellertray-merchant-code:' || v_code));
    if exists (select 1 from public.tenants t where t.merchant_code=v_code) then
      raise exception 'Merchant ID % is already in use. Choose another 3-character ID.',v_code using errcode='23505';
    end if;
  else
    v_compact := upper(regexp_replace(btrim(p_name),'[^A-Za-z0-9]','','g'));
    v_code := rpad(substr(v_compact,1,3),3,'X');

    perform pg_advisory_xact_lock(hashtext('sellertray-merchant-code:' || v_code));
    if exists (select 1 from public.tenants t where t.merchant_code=v_code) then
      for v_try in 0..4095 loop
        v_code := upper(substr(md5(p_user_id::text || ':' || p_name || ':' || v_try::text),1,3));
        perform pg_advisory_xact_lock(hashtext('sellertray-merchant-code:' || v_code));
        exit when not exists (select 1 from public.tenants t where t.merchant_code=v_code);
      end loop;
    end if;

    if exists (select 1 from public.tenants t where t.merchant_code=v_code) then
      raise exception 'Unable to allocate merchant ID. Choose a 3-character ID.' using errcode='23505';
    end if;
  end if;

  v_slug_base := trim(both '-' from regexp_replace(lower(btrim(p_name)),'[^a-z0-9]+','-','g'));
  if v_slug_base='' then v_slug_base := 'business'; end if;
  v_slug := left(v_slug_base,48) || '-' || substr(replace(gen_random_uuid()::text,'-',''),1,6);

  insert into public.tenants (
    name,slug,merchant_code,business_email,business_phone,business_type,
    currency,timezone,onboarding_status,subscription_status,whatsapp_connection_status,
    commercial_onboarding_required
  ) values (
    btrim(p_name),v_slug,v_code,
    nullif(btrim(p_business_email),''),
    nullif(btrim(p_business_phone),''),
    nullif(btrim(p_business_type),''),
    'NGN','Africa/Lagos','catalogue','trial','not_connected',true
  )
  returning id into v_tenant_id;

  insert into public.tenant_members (tenant_id,user_id,role)
  values (v_tenant_id,p_user_id,'owner');

  return v_tenant_id;
end;
$$;

revoke all on function public.provision_business_for_user(uuid,text,text,text,text,text)
  from public,anon,authenticated;
grant execute on function public.provision_business_for_user(uuid,text,text,text,text,text)
  to service_role;

commit;
