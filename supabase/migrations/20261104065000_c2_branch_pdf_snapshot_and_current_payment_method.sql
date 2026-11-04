begin;

-- Reviewed C2 Branch Order Forms need a legible Branch name bound into the
-- immutable commercial snapshot; never fetch a mutable name at PDF render time.
create or replace function public.build_sellertray_commercial_agreement_snapshot(
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_installment_obligation_id uuid
)
returns jsonb
language plpgsql
stable
set search_path=''
as $function$
declare
  v_tenant public.tenants%rowtype;
  v_order public.sellertray_commercial_orders%rowtype;
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_lines jsonb;
  v_schedule jsonb;
  v_settlement jsonb;
  v_branch_commitments jsonb;
begin
  select t.* into strict v_tenant
  from public.tenants t
  where t.id=p_tenant_id;

  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.tenant_id=p_tenant_id and o.id=p_commercial_order_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'line_no',s.line_no,
    'line_type',s.line_type,
    'source_price_version_id',s.source_price_version_id,
    'charge_type_code',s.charge_type_code,
    'price_scope',s.price_scope_snapshot,
    'plan_code',s.plan_code,
    'plan_profile_version_id',s.plan_profile_version_id,
    'addon_version_id',s.addon_version_id,
    'commercial_tax_profile_version_id',s.commercial_tax_profile_version_id,
    'branch_id',s.branch_id,
    'billing_cycle',s.billing_cycle,
    'description',s.description_snapshot,
    'quantity',s.quantity,
    'currency',s.currency,
    'unit_gross_amount',s.unit_gross_amount,
    'gross_amount',s.gross_amount,
    'net_amount',s.net_amount,
    'tax_rate_percent',s.tax_rate_percent,
    'tax_amount',s.tax_amount
  ) order by s.line_no),'[]'::jsonb)
  into v_lines
  from public.sellertray_commercial_order_price_snapshots s
  where s.tenant_id=p_tenant_id and s.commercial_order_id=p_commercial_order_id;

  if v_order.order_kind='branch_commercial_v2' then
    if p_installment_obligation_id is not null then
      raise exception 'Commercial V2 Branch Order Form covers the complete commercial order, not one Branch obligation'
        using errcode='23514';
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'subject_id',s.id,
      'branch_id',s.branch_id,
      'branch_name',b.name,
      'plan_profile_version_id',s.plan_profile_version_id,
      'billing_cycle',s.billing_cycle,
      'branch_subscription_line_id',s.branch_subscription_line_id,
      'branch_setup_line_id',s.branch_setup_line_id,
      'setup_required',s.setup_required,
      'supersedes_branch_subscription_id',s.supersedes_branch_subscription_id,
      'installment_obligation_id',s.installment_obligation_id,
      'installment_template_id',s.installment_template_id,
      'installment_template_code',cs.template_code,
      'installment_template_version',cs.template_version,
      'installment_policy_version_id',s.installment_policy_version_id,
      'addon_lines',coalesce((
        select jsonb_agg(jsonb_build_object(
          'order_line_id',l.id,
          'addon_version_id',l.addon_version_id,
          'billing_cycle',l.billing_cycle,
          'gross_amount',l.gross_amount,
          'tax_amount',l.tax_amount
        ) order by l.line_no)
        from public.sellertray_commercial_order_price_snapshots l
        where l.tenant_id=s.tenant_id and l.commercial_order_id=s.commercial_order_id
          and l.branch_id=s.branch_id and l.line_type='branch_addon'
      ),'[]'::jsonb),
      'settlement',public.get_sellertray_commercial_obligation_settlement_state(
        p_tenant_id,s.installment_obligation_id
      )
    ) order by s.branch_id),'[]'::jsonb)
    into v_branch_commitments
    from public.sellertray_branch_commercial_order_subjects s
    join public.branches b on b.tenant_id=s.tenant_id and b.id=s.branch_id
    join public.sellertray_installment_contract_snapshots cs
      on cs.tenant_id=s.tenant_id and cs.installment_obligation_id=s.installment_obligation_id
    where s.tenant_id=p_tenant_id and s.commercial_order_id=p_commercial_order_id;

    if jsonb_array_length(v_branch_commitments)=0 then
      raise exception 'Commercial V2 order has no Branch commitments' using errcode='23514';
    end if;

    v_settlement:=public.get_sellertray_commercial_settlement_state(
      p_tenant_id,p_commercial_order_id
    );
    v_schedule:=null;
  else
    if p_installment_obligation_id is not null then
      select o.* into strict v_obligation
      from public.sellertray_commercial_installment_obligations o
      where o.tenant_id=p_tenant_id
        and o.commercial_order_id=p_commercial_order_id
        and o.id=p_installment_obligation_id;

      select coalesce(jsonb_agg(jsonb_build_object(
        'sequence_no',s.sequence_no,
        'percentage',s.percentage,
        'amount_due',s.amount_due,
        'due_at',s.due_at
      ) order by s.sequence_no),'[]'::jsonb)
      into v_schedule
      from public.sellertray_commercial_installment_schedule s
      where s.tenant_id=p_tenant_id
        and s.installment_obligation_id=p_installment_obligation_id;
    else
      v_schedule:=null;
    end if;

    v_settlement:=public.get_sellertray_commercial_settlement_state(
      p_tenant_id,p_commercial_order_id
    );
    if p_installment_obligation_id is not null then
      select jsonb_agg(jsonb_build_object(
        'sequence_no',x->'sequenceNo',
        'percentage',x->'percentage',
        'amount_due',x->'amountDue',
        'due_at',x->'dueAt'
      ) order by (x->>'sequenceNo')::integer)
      into v_schedule
      from jsonb_array_elements(v_settlement->'schedule') x;
    end if;
    v_branch_commitments:=null;
  end if;

  return jsonb_build_object(
    'schemaVersion',case when v_order.order_kind='branch_commercial_v2' then 2 else 1 end,
    'orderKind',v_order.order_kind,
    'settlementTerms',jsonb_build_object(
      'approvedAdjustmentAmount',v_settlement->'approvedAdjustmentAmount',
      'netAmountDue',v_settlement->'netAmountDue',
      'outstandingAmount',v_settlement->'outstandingAmount'
    ),
    'merchant',jsonb_build_object(
      'tenant_id',v_tenant.id,
      'merchant_code',v_tenant.merchant_code,
      'business_name',v_tenant.name,
      'business_email',v_tenant.business_email,
      'business_phone',v_tenant.business_phone,
      'business_type',v_tenant.business_type
    ),
    'commercial_order_id',v_order.id,
    'order_reference',v_order.order_reference,
    'currency',v_order.currency,
    'total_gross_amount',v_order.total_gross_amount,
    'ordered_at',v_order.ordered_at,
    'price_snapshots',v_lines,
    'branch_commitments',v_branch_commitments,
    'installment',case
      when p_installment_obligation_id is null then null
      else jsonb_build_object(
        'installment_obligation_id',v_obligation.id,
        'structure_code',v_obligation.structure_code,
        'currency',v_obligation.currency,
        'obligated_amount',v_obligation.obligated_amount,
        'schedule',v_schedule
      )
    end
  );
end;
$function$;

-- C2 payment-method changes and checkout preparation are serialized against
-- the same Business/Order authority. The current/latest selection must itself
-- be Paystack and effective; earlier Paystack selections cannot be reused.
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
  v_selected_at timestamptz;
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

  -- Match checkout's order-scoped lock so selection and reserve cannot race.
  perform public.lock_sellertray_commercial_order(p_tenant_id,v_obligation.commercial_order_id);

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

  -- now() is transaction-stable: multiple choices in one transaction can
  -- otherwise tie and a random UUID becomes the accidental latest selector.
  v_selected_at:=clock_timestamp();
  insert into public.sellertray_commercial_payment_method_selections(
    tenant_id,commercial_order_id,installment_obligation_id,payment_method_version_id,
    command_id,actor_user_id,selected_at,created_at
  ) values(
    p_tenant_id,v_obligation.commercial_order_id,p_installment_obligation_id,p_payment_method_version_id,
    p_command_id,p_actor_user_id,v_selected_at,v_selected_at
  ) returning id into v_id;
  return v_id;
end;
$function$;

create or replace function public.reserve_sellertray_installment_checkout(
  p_tenant_id uuid,
  p_installment_schedule_id uuid,
  p_command_id uuid,
  p_actor_user_id uuid,
  p_billing_email text
)
returns jsonb
language plpgsql
set search_path=''
as $function$
declare
  v_role text;
  v_email text:=lower(btrim(coalesce(p_billing_email,'')));
  v_schedule public.sellertray_commercial_installment_schedule%rowtype;
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_order public.sellertray_commercial_orders%rowtype;
  v_plan_code text;
  v_plan_profile_version_id uuid;
  v_payment_method_version_id uuid;
  v_state jsonb;
  v_next_schedule_id uuid;
  v_next_amount numeric(18,2);
  v_existing public.billing_checkout_sessions%rowtype;
  v_reference text;
  v_session public.billing_checkout_sessions%rowtype;
  v_order_form_id uuid;
  v_order_form_confirmed boolean:=false;
  v_agreement_processing_exists boolean:=false;
begin
  if p_tenant_id is null or p_installment_schedule_id is null
     or p_command_id is null or p_actor_user_id is null then
    raise exception 'Business, installment, command and user are required' using errcode='22023';
  end if;
  if char_length(v_email) not between 3 and 320 or position('@' in v_email)=0 then
    raise exception 'A valid billing email is required' using errcode='22023';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;
  if v_role is distinct from 'owner' then
    raise exception 'Only the business Owner can start installment billing' using errcode='42501';
  end if;

  select sch.* into strict v_schedule
  from public.sellertray_commercial_installment_schedule sch
  where sch.tenant_id=p_tenant_id and sch.id=p_installment_schedule_id;
  select o.* into strict v_obligation
  from public.sellertray_commercial_installment_obligations o
  where o.tenant_id=p_tenant_id and o.id=v_schedule.installment_obligation_id;
  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.tenant_id=p_tenant_id and o.id=v_obligation.commercial_order_id;

  -- Serialize checkout reservation against a concurrent method selection.
  perform public.lock_sellertray_commercial_order(p_tenant_id,v_order.id);

  if v_obligation.obligation_scope='branch_subscription' then
    select s.plan_profile_version_id into strict v_plan_profile_version_id
    from public.sellertray_commercial_order_price_snapshots s
    where s.tenant_id=p_tenant_id and s.id=v_obligation.commercial_order_line_id
      and s.line_type='branch_subscription';

    -- Selection order is authoritative; do not look backward for an older
    -- Paystack method after the merchant switches to bank/manual payment.
    select latest.payment_method_version_id into v_payment_method_version_id
    from (
      select sel.payment_method_version_id
      from public.sellertray_commercial_payment_method_selections sel
      where sel.tenant_id=p_tenant_id
        and sel.installment_obligation_id=v_obligation.id
      order by sel.selected_at desc,sel.created_at desc,sel.id desc
      limit 1
    ) latest
    join public.sellertray_commercial_payment_method_versions mv
      on mv.id=latest.payment_method_version_id
    join public.sellertray_commercial_payment_methods m
      on m.id=mv.payment_method_id
    where m.code='paystack' and m.status='active'
      and mv.method_type='paystack' and mv.confirmation_mode='automatic'
      and mv.effective_from<=now() and (mv.effective_until is null or mv.effective_until>now());
    if v_payment_method_version_id is null then
      raise exception 'Select the available Paystack commercial payment method before starting checkout'
        using errcode='23514';
    end if;
  else
    select s.plan_code into strict v_plan_code
    from public.sellertray_commercial_order_price_snapshots s
    where s.tenant_id=p_tenant_id and s.commercial_order_id=v_order.id
      and s.line_type='subscription';
  end if;

  perform public.supersede_sellertray_stale_installment_checkouts(p_tenant_id,v_order.id);
  if v_obligation.obligation_scope='branch_subscription' then
    v_state:=public.get_sellertray_commercial_obligation_settlement_state(p_tenant_id,v_obligation.id);
  else
    v_state:=public.get_sellertray_commercial_settlement_state(p_tenant_id,v_order.id);
  end if;
  v_next_schedule_id:=nullif(v_state->>'nextInstallmentScheduleId','')::uuid;
  v_next_amount:=coalesce((v_state->>'nextPayableAmount')::numeric,0);

  if coalesce((v_state->>'outstandingAmount')::numeric,0)<0.005 then
    return jsonb_build_object(
      'status','paid','installmentScheduleId',p_installment_schedule_id,
      'amount',0,'currency',v_obligation.currency,'planCode',v_plan_code,
      'planProfileVersionId',v_plan_profile_version_id,
      'commercialPaymentMethodVersionId',v_payment_method_version_id,
      'needsProviderInitialization',false
    );
  end if;

  select s.* into v_existing
  from public.billing_checkout_sessions s
  where s.tenant_id=p_tenant_id and s.checkout_kind='installment' and s.command_id=p_command_id;
  if found then
    if v_existing.installment_schedule_id<>v_schedule.id
       or v_existing.requested_by_user_id<>p_actor_user_id
       or lower(v_existing.billing_email)<>v_email then
      raise exception 'Installment checkout command is already used for different facts'
        using errcode='23505';
    end if;
    return jsonb_build_object(
      'sessionId',v_existing.id,'status',v_existing.status,'reference',v_existing.reference,
      'authorizationUrl',v_existing.authorization_url,
      'installmentScheduleId',v_existing.installment_schedule_id,'amount',v_existing.amount,
      'currency',v_existing.currency,'planCode',v_existing.plan_code,
      'planProfileVersionId',v_existing.plan_profile_version_id,
      'commercialPaymentMethodVersionId',v_existing.commercial_payment_method_version_id,
      'needsProviderInitialization',v_existing.status='preparing' and v_existing.authorization_url is null
    );
  end if;

  if v_next_schedule_id is distinct from p_installment_schedule_id then
    raise exception 'Selected installment is not the current authoritative payable schedule'
      using errcode='23514';
  end if;

  select s.* into v_existing
  from public.billing_checkout_sessions s
  where s.tenant_id=p_tenant_id and s.checkout_kind='installment'
    and s.installment_schedule_id=v_schedule.id
    and s.status in ('preparing','initialized','paid')
  order by s.created_at desc
  limit 1;
  if found then
    return jsonb_build_object(
      'sessionId',v_existing.id,'status',v_existing.status,'reference',v_existing.reference,
      'authorizationUrl',v_existing.authorization_url,
      'installmentScheduleId',v_existing.installment_schedule_id,'amount',v_existing.amount,
      'currency',v_existing.currency,'planCode',v_existing.plan_code,
      'planProfileVersionId',v_existing.plan_profile_version_id,
      'commercialPaymentMethodVersionId',v_existing.commercial_payment_method_version_id,
      'needsProviderInitialization',false
    );
  end if;

  select f.id into v_order_form_id
  from public.sellertray_commercial_order_forms f
  where f.tenant_id=p_tenant_id and f.commercial_order_id=v_order.id
    and not exists(
      select 1 from public.sellertray_commercial_order_forms replacement
      where replacement.tenant_id=f.tenant_id and replacement.supersedes_order_form_id=f.id
    )
  order by f.issued_at desc,f.created_at desc
  limit 1;

  if v_order_form_id is not null then
    select exists(
      select 1 from public.sellertray_order_form_confirmations c
      where c.tenant_id=p_tenant_id and c.order_form_id=v_order_form_id
    ) into v_order_form_confirmed;
    if not v_order_form_confirmed then
      raise exception 'Review and confirm this SellerTray Order Form before payment'
        using errcode='23514';
    end if;
  elsif v_order.order_kind='branch_commercial_v2' then
    raise exception 'SellerTray Order Form must be issued and confirmed before Branch subscription payment'
      using errcode='23514';
  else
    if to_regclass('public.sellertray_agreement_package_processing') is not null then
      execute $sql$
        select exists(
          select 1 from public.sellertray_agreement_package_processing p
          where p.tenant_id=$1
            and (
              p.commercial_order_id=$2
              or p.installment_obligation_id=$3
              or (p.subject_kind='installment_obligation' and p.subject_id=$3)
            )
        )
      $sql$
      into v_agreement_processing_exists
      using p_tenant_id,v_order.id,v_obligation.id;
    end if;
    if v_agreement_processing_exists then
      raise exception 'SellerTray is preparing the Order Form for this purchase. Review and confirm it before payment'
        using errcode='23514';
    end if;
  end if;

  v_reference:='sti-'||substr(replace(p_tenant_id::text,'-',''),1,8)
    ||'-'||replace(p_command_id::text,'-','');

  insert into public.billing_checkout_sessions(
    tenant_id,plan_code,plan_profile_version_id,commercial_payment_method_version_id,
    requested_by_user_id,billing_email,provider,reference,status,checkout_kind,command_id,
    commercial_order_id,installment_obligation_id,installment_schedule_id,amount,currency,
    created_at,updated_at
  ) values(
    p_tenant_id,v_plan_code,v_plan_profile_version_id,v_payment_method_version_id,
    p_actor_user_id,v_email,'paystack',v_reference,'preparing','installment',p_command_id,
    v_order.id,v_obligation.id,v_schedule.id,v_next_amount,v_obligation.currency,now(),now()
  ) returning * into v_session;

  return jsonb_build_object(
    'sessionId',v_session.id,'status',v_session.status,'reference',v_session.reference,
    'authorizationUrl',v_session.authorization_url,
    'installmentScheduleId',v_session.installment_schedule_id,'amount',v_session.amount,
    'currency',v_session.currency,'planCode',v_session.plan_code,
    'planProfileVersionId',v_session.plan_profile_version_id,
    'commercialPaymentMethodVersionId',v_session.commercial_payment_method_version_id,
    'needsProviderInitialization',true
  );
end;
$function$;

comment on function public.reserve_sellertray_installment_checkout(uuid,uuid,uuid,uuid,text) is
  'Reserves governed C1 or C2 checkout. Native Branch Paystack checkout requires the latest selected, currently effective automatic Paystack payment method, not a historical selection.';

commit;
