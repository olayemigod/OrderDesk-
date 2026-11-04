begin;

-- SellerTray C2-7 — Universal Master Agreement + Merchant Order Form
-- convergence for Branch-owned Commercial V2 commitments.
--
-- One immutable Merchant Order Form covers the Branch commitments contained in
-- one Commercial V2 order. The required Universal Master Agreement version is
-- pinned when that Order Form is issued. Confirmation reuses the Business's
-- existing acceptance of that exact Master version and creates pending Branch
-- Subscription commitment rows. No operational entitlement is activated here.

alter table public.sellertray_commercial_order_forms
  add column if not exists required_master_agreement_version_id uuid;

alter table public.sellertray_commercial_order_forms
  add constraint sellertray_commercial_order_forms_required_master_fkey
    foreign key (required_master_agreement_version_id)
    references public.sellertray_master_agreement_versions(id)
    on delete restrict;

create index sellertray_commercial_order_forms_required_master_idx
  on public.sellertray_commercial_order_forms(required_master_agreement_version_id)
  where required_master_agreement_version_id is not null;

-- Extend the immutable commercial snapshot. Legacy C1 output remains compatible;
-- C2 adds exact Plan Profile/tax/price identity plus all independent Branch
-- obligations in the same Order Form.
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
      'plan_profile_version_id',s.plan_profile_version_id,
      'billing_cycle',s.billing_cycle,
      'branch_subscription_line_id',s.branch_subscription_line_id,
      'branch_setup_line_id',s.branch_setup_line_id,
      'setup_required',s.setup_required,
      'supersedes_branch_subscription_id',s.supersedes_branch_subscription_id,
      'installment_obligation_id',s.installment_obligation_id,
      'installment_template_id',s.installment_template_id,
      'installment_policy_version_id',s.installment_policy_version_id,
      'settlement',public.get_sellertray_commercial_obligation_settlement_state(
        p_tenant_id,s.installment_obligation_id
      )
    ) order by s.branch_id),'[]'::jsonb)
    into v_branch_commitments
    from public.sellertray_branch_commercial_order_subjects s
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

revoke all on function public.build_sellertray_commercial_agreement_snapshot(uuid,uuid,uuid)
  from public,anon,authenticated;

create or replace function public.prepare_sellertray_commercial_order_form()
returns trigger
language plpgsql
set search_path=''
as $function$
declare
  v_template public.sellertray_commercial_agreement_template_versions%rowtype;
  v_previous public.sellertray_commercial_order_forms%rowtype;
  v_order public.sellertray_commercial_orders%rowtype;
  v_snapshot jsonb;
  v_document jsonb;
begin
  select t.* into strict v_template
  from public.sellertray_commercial_agreement_template_versions t
  where t.id=new.order_form_template_version_id;
  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.tenant_id=new.tenant_id and o.id=new.commercial_order_id;

  if v_template.agreement_family not in ('subscription_order','installment_agreement') then
    raise exception 'Order Forms require a subscription-order or installment-agreement template'
      using errcode='23514';
  end if;

  if v_order.order_kind='branch_commercial_v2' then
    if new.installment_obligation_id is not null then
      raise exception 'Commercial V2 Branch commitments use one Order Form for the complete commercial order'
        using errcode='23514';
    end if;
    if v_template.agreement_family<>'subscription_order' then
      raise exception 'Commercial V2 Branch commitments require a production subscription Order Form template'
        using errcode='23514';
    end if;
    new.required_master_agreement_version_id:=public.resolve_sellertray_master_agreement_version_id(
      coalesce(new.issued_at,now())
    );
    if new.required_master_agreement_version_id is null then
      raise exception 'SellerTray Master Agreement is not yet published' using errcode='23514';
    end if;
  else
    if (v_template.agreement_family='installment_agreement') <> (new.installment_obligation_id is not null) then
      raise exception 'Installment Order Forms must bind the exact installment obligation'
        using errcode='23514';
    end if;
    new.required_master_agreement_version_id:=null;
  end if;

  v_snapshot:=public.build_sellertray_commercial_agreement_snapshot(
    new.tenant_id,new.commercial_order_id,new.installment_obligation_id
  );
  if new.required_master_agreement_version_id is not null then
    v_snapshot:=v_snapshot||jsonb_build_object(
      'requiredMasterAgreementVersionId',new.required_master_agreement_version_id
    );
  end if;

  new.template_version_code:=v_template.version_code;
  new.template_content_sha256:=v_template.content_sha256;
  new.order_form_reference:=btrim(new.order_form_reference);
  new.rendered_content:=v_template.content_body;
  new.commercial_snapshot:=v_snapshot;
  new.commercial_snapshot_sha256:=encode(
    extensions.digest(convert_to(v_snapshot::text,'UTF8'),'sha256'),'hex'
  );
  v_document:=jsonb_build_object(
    'schemaVersion',case when v_order.order_kind='branch_commercial_v2' then 2 else 1 end,
    'reference',new.order_form_reference,
    'requiredMasterAgreementVersionId',new.required_master_agreement_version_id,
    'template',jsonb_build_object(
      'versionId',v_template.id,
      'versionCode',v_template.version_code,
      'contentSha256',v_template.content_sha256
    ),
    'commercialSnapshot',v_snapshot
  );
  new.content_sha256:=encode(
    extensions.digest(convert_to(v_document::text,'UTF8'),'sha256'),'hex'
  );
  new.issued_at:=coalesce(new.issued_at,now());
  new.created_at:=coalesce(new.created_at,now());

  if v_template.effective_from>new.issued_at then
    raise exception 'Order Form template is not effective at the issue time' using errcode='23514';
  end if;

  if new.supersedes_order_form_id is not null then
    select f.* into strict v_previous
    from public.sellertray_commercial_order_forms f
    where f.tenant_id=new.tenant_id and f.id=new.supersedes_order_form_id
    for share;
    if v_previous.commercial_order_id<>new.commercial_order_id
       or v_previous.installment_obligation_id is distinct from new.installment_obligation_id then
      raise exception 'Replacement Order Form must preserve the original commercial subject'
        using errcode='23514';
    end if;
    if exists(
      select 1 from public.sellertray_commercial_order_forms r
      where r.tenant_id=new.tenant_id and r.supersedes_order_form_id=v_previous.id
    ) then
      raise exception 'The selected Order Form has already been superseded' using errcode='23505';
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function public.prepare_sellertray_commercial_order_form()
  from public,anon,authenticated;

-- Register the legally confirmed Branch commitments as pending Branch
-- Subscriptions. The existing C2-4 registration command remains the only table
-- writer; subject id is the deterministic command id for retry safety.
create or replace function public.register_sellertray_c2_confirmed_branch_commitments(
  p_tenant_id uuid,
  p_order_form_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_form public.sellertray_commercial_order_forms%rowtype;
  v_order public.sellertray_commercial_orders%rowtype;
  v_confirmation public.sellertray_order_form_confirmations%rowtype;
  v_package public.sellertray_agreement_packages%rowtype;
  v_acceptance public.sellertray_master_agreement_acceptances%rowtype;
  v_subject public.sellertray_branch_commercial_order_subjects%rowtype;
  v_branch_subscription_id uuid;
  v_result jsonb:='[]'::jsonb;
begin
  select f.* into strict v_form
  from public.sellertray_commercial_order_forms f
  where f.tenant_id=p_tenant_id and f.id=p_order_form_id;
  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.tenant_id=p_tenant_id and o.id=v_form.commercial_order_id;

  if v_order.order_kind<>'branch_commercial_v2' then
    return '[]'::jsonb;
  end if;
  if v_form.required_master_agreement_version_id is null then
    raise exception 'Commercial V2 Order Form must pin its required Master Agreement version'
      using errcode='23514';
  end if;

  select c.* into strict v_confirmation
  from public.sellertray_order_form_confirmations c
  where c.tenant_id=p_tenant_id and c.order_form_id=v_form.id;
  select p.* into strict v_package
  from public.sellertray_agreement_packages p
  where p.tenant_id=p_tenant_id and p.id=v_confirmation.agreement_package_id;

  if v_package.order_form_id<>v_form.id
     or v_package.master_agreement_version_id<>v_form.required_master_agreement_version_id then
    raise exception 'Confirmed agreement package does not match the pinned Master Agreement and Order Form'
      using errcode='23514';
  end if;

  select a.* into strict v_acceptance
  from public.sellertray_master_agreement_acceptances a
  where a.tenant_id=p_tenant_id
    and a.agreement_version_id=v_form.required_master_agreement_version_id;

  for v_subject in
    select s.*
    from public.sellertray_branch_commercial_order_subjects s
    where s.tenant_id=p_tenant_id and s.commercial_order_id=v_order.id
    order by s.branch_id
  loop
    v_branch_subscription_id:=public.register_sellertray_branch_subscription_term(
      p_tenant_id,
      v_subject.branch_id,
      v_subject.plan_profile_version_id,
      v_subject.billing_cycle,
      v_confirmation.confirmed_at,
      v_order.id,
      v_subject.branch_subscription_line_id,
      v_subject.installment_obligation_id,
      v_subject.setup_required,
      v_form.required_master_agreement_version_id,
      v_form.id,
      v_subject.supersedes_branch_subscription_id,
      'commercial_order',
      jsonb_build_object(
        'source','c2_confirmed_order_form',
        'branchCommercialOrderSubjectId',v_subject.id,
        'orderFormConfirmationId',v_confirmation.id,
        'agreementPackageId',v_package.id,
        'masterAgreementAcceptanceId',v_acceptance.id
      ),
      v_subject.id,
      'merchant',
      v_confirmation.confirmed_by_user_id
    );

    perform pg_catalog.set_config('sellertray.branch_subscription_mutation','governed',true);
    update public.sellertray_branch_subscriptions s
    set master_agreement_acceptance_id=v_acceptance.id,
        updated_at=now()
    where s.tenant_id=p_tenant_id
      and s.id=v_branch_subscription_id
      and s.master_agreement_acceptance_id is distinct from v_acceptance.id;

    v_result:=v_result||jsonb_build_array(jsonb_build_object(
      'branchId',v_subject.branch_id,
      'branchCommercialOrderSubjectId',v_subject.id,
      'branchSubscriptionId',v_branch_subscription_id,
      'masterAgreementAcceptanceId',v_acceptance.id,
      'orderFormId',v_form.id,
      'lifecycleStatus','pending'
    ));
  end loop;

  if jsonb_array_length(v_result)=0 then
    raise exception 'Commercial V2 Order Form has no Branch commitments to register'
      using errcode='23514';
  end if;

  return v_result;
end;
$function$;

revoke all on function public.register_sellertray_c2_confirmed_branch_commitments(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.register_sellertray_c2_confirmed_branch_commitments(uuid,uuid)
  to service_role;

-- Confirmation reuses the exact Master version pinned at C2 Order Form issue.
-- Legacy Order Forms keep their previous dynamic-current-Master behavior.
create or replace function public.confirm_sellertray_agreement_package(
  p_tenant_id uuid,
  p_order_form_id uuid,
  p_confirmed_legal_name text,
  p_request_evidence jsonb,
  p_command_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_role text;
  v_name text:=btrim(coalesce(p_confirmed_legal_name,''));
  v_evidence jsonb:=coalesce(p_request_evidence,'{}'::jsonb);
  v_form public.sellertray_commercial_order_forms%rowtype;
  v_master public.sellertray_master_agreement_versions%rowtype;
  v_package public.sellertray_agreement_packages%rowtype;
  v_master_acceptance public.sellertray_master_agreement_acceptances%rowtype;
  v_confirmation public.sellertray_order_form_confirmations%rowtype;
  v_command_confirmation public.sellertray_order_form_confirmations%rowtype;
  v_master_id uuid;
  v_branch_subscriptions jsonb:='[]'::jsonb;
begin
  if p_tenant_id is null or p_order_form_id is null or p_actor_user_id is null or p_command_id is null then
    raise exception 'Business, Order Form, representative and command are required' using errcode='22023';
  end if;
  if char_length(v_name) not between 1 and 200 or jsonb_typeof(v_evidence)<>'object' then
    raise exception 'Valid representative name and confirmation evidence are required' using errcode='22023';
  end if;
  if coalesce((v_evidence->>'authority_confirmed')::boolean,false) is not true then
    raise exception 'Confirm your authority before continuing' using errcode='22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('sellertray-package-command:'||p_tenant_id::text||':'||p_command_id::text,0)
  );

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;
  if v_role='owner' then
    null;
  elsif v_role='manager'
        and public.sellertray_user_has_capability(
          p_tenant_id,p_actor_user_id,'can_accept_commercial_agreements'
        ) then
    null;
  else
    raise exception 'You are not authorised to confirm SellerTray purchases' using errcode='42501';
  end if;

  select f.* into strict v_form
  from public.sellertray_commercial_order_forms f
  where f.tenant_id=p_tenant_id and f.id=p_order_form_id
  for share;

  if exists(
    select 1
    from public.sellertray_commercial_order_forms replacement
    where replacement.tenant_id=p_tenant_id
      and replacement.supersedes_order_form_id=v_form.id
  ) then
    raise exception 'This Order Form has been replaced and cannot be confirmed' using errcode='23514';
  end if;

  v_master_id:=coalesce(
    v_form.required_master_agreement_version_id,
    public.resolve_sellertray_master_agreement_version_id(now())
  );
  if v_master_id is null then
    raise exception 'SellerTray Master Agreement is not yet published' using errcode='23514';
  end if;

  select m.* into strict v_master
  from public.sellertray_master_agreement_versions m
  where m.id=v_master_id;

  select a.* into v_master_acceptance
  from public.sellertray_master_agreement_acceptances a
  where a.tenant_id=p_tenant_id and a.agreement_version_id=v_master.id;
  if not found then
    raise exception 'Accept the required SellerTray Master Agreement separately before confirming this Order Form'
      using errcode='23514';
  end if;

  perform public.create_sellertray_agreement_package(
    p_tenant_id,v_form.id,v_master.id
  );

  select p.* into strict v_package
  from public.sellertray_agreement_packages p
  where p.tenant_id=p_tenant_id
    and p.master_agreement_version_id=v_master.id
    and p.order_form_id=v_form.id;

  select c.* into v_command_confirmation
  from public.sellertray_order_form_confirmations c
  where c.tenant_id=p_tenant_id and c.command_id=p_command_id;
  if found and v_command_confirmation.order_form_id<>v_form.id then
    raise exception 'Purchase confirmation command is already used for a different Order Form'
      using errcode='23505';
  end if;

  select c.* into v_confirmation
  from public.sellertray_order_form_confirmations c
  where c.tenant_id=p_tenant_id and c.order_form_id=v_form.id;

  if not found then
    insert into public.sellertray_order_form_confirmations(
      tenant_id,order_form_id,agreement_package_id,order_form_content_sha256,
      package_fingerprint,confirmed_by_user_id,confirmed_legal_name,confirmed_role,
      confirmation_method,request_evidence,command_id
    ) values(
      p_tenant_id,v_form.id,v_package.id,v_form.content_sha256,
      v_package.package_fingerprint,p_actor_user_id,v_name,v_role,
      'merchant_web_authenticated',
      v_evidence||jsonb_build_object(
        'confirmation_component','order_form_confirmation',
        'master_agreement_version_id',v_master.id,
        'master_acceptance_id',v_master_acceptance.id,
        'agreement_package_id',v_package.id,
        'package_fingerprint',v_package.package_fingerprint,
        'master_version_pinned_at_order_form_issue',v_form.required_master_agreement_version_id is not null
      ),
      p_command_id
    ) returning * into v_confirmation;
  elsif v_command_confirmation.id is not null and (
    v_confirmation.id<>v_command_confirmation.id
    or v_confirmation.confirmed_by_user_id<>p_actor_user_id
    or v_confirmation.confirmed_legal_name<>v_name
    or v_confirmation.confirmed_role<>v_role
  ) then
    raise exception 'Purchase confirmation command is already used for different facts'
      using errcode='23505';
  end if;

  if v_form.required_master_agreement_version_id is not null then
    v_branch_subscriptions:=public.register_sellertray_c2_confirmed_branch_commitments(
      p_tenant_id,v_form.id
    );
  end if;

  return jsonb_build_object(
    'masterAcceptanceId',v_master_acceptance.id,
    'masterAcceptanceCreated',false,
    'orderFormConfirmationId',v_confirmation.id,
    'orderFormConfirmationCreated',v_confirmation.command_id=p_command_id,
    'agreementPackageId',v_package.id,
    'packageFingerprint',v_package.package_fingerprint,
    'masterAgreementVersionId',v_master.id,
    'orderFormId',v_form.id,
    'branchSubscriptions',v_branch_subscriptions
  );
end;
$function$;

revoke all on function public.confirm_sellertray_agreement_package(uuid,uuid,text,jsonb,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.confirm_sellertray_agreement_package(uuid,uuid,text,jsonb,uuid,uuid)
  to authenticated,service_role;

comment on function public.register_sellertray_c2_confirmed_branch_commitments(uuid,uuid) is
  'Registers pending Branch Subscription commitments from a confirmed C2 Merchant Order Form and reuses the Business acceptance of the pinned Master Agreement version. Does not activate runtime access.';

commit;
