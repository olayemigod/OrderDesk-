begin;
-- C2-6: governed add-on line selection is priced with the Branch commitment.
-- Only registered Branch Subscription lifecycle reconciliation may later grant entitlement.
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
  v_addon_price_id uuid;
  v_addon_version_id uuid;
  v_addon_cycle text;
  v_addon_definition_id uuid;
  v_addon_item jsonb;
  v_addon_version public.sellertray_addon_versions%rowtype;
  v_addon_price public.sellertray_commercial_price_versions%rowtype;
  v_seen_addon_definitions uuid[];
  v_addon_line_id uuid;
  v_addon_lines jsonb;
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
        'supersedesBranchSubscriptionId',s.supersedes_branch_subscription_id,
        'addonLines',coalesce((
          select jsonb_agg(jsonb_build_object(
            'addonVersionId',l.addon_version_id,
            'billingCycle',l.billing_cycle,
            'addonLineId',l.id
          ) order by l.line_no)
          from public.sellertray_commercial_order_price_snapshots l
          where l.tenant_id=s.tenant_id
            and l.commercial_order_id=s.commercial_order_id
            and l.branch_id=s.branch_id and l.line_type='branch_addon'
        ),'[]'::jsonb)
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
    if jsonb_typeof(coalesce(v_item->'addonSelections','[]'::jsonb))<>'array' then
      raise exception 'Branch add-on selections must be an array' using errcode='22023';
    end if;
    v_seen_addon_definitions:='{}'::uuid[];
    for v_addon_item in
      select a.value from jsonb_array_elements(coalesce(v_item->'addonSelections','[]'::jsonb)) a(value)
    loop
      if jsonb_typeof(v_addon_item)<>'object' then
        raise exception 'Each add-on selection must be an object' using errcode='22023';
      end if;
      begin
        v_addon_version_id:=(v_addon_item->>'addonVersionId')::uuid;
      exception when invalid_text_representation then
        raise exception 'Add-on version identifier is invalid' using errcode='22023';
      end;
      v_addon_cycle:=lower(btrim(coalesce(v_addon_item->>'billingCycle','')));
      if v_addon_version_id is null or v_addon_cycle not in (v_cycle,'one_time') then
        raise exception 'Add-on selection requires a version and the Branch cycle or one-time billing'
          using errcode='23514';
      end if;
      select av.* into v_addon_version
      from public.sellertray_addon_versions av
      join public.sellertray_addon_definitions ad on ad.id=av.addon_definition_id
      where av.id=v_addon_version_id and av.status='published'
        and ad.status='active' and av.effective_from<=v_ordered_at
        and (av.effective_until is null or av.effective_until>v_ordered_at)
        and v_addon_cycle=any(av.allowed_billing_cycles);
      if not found then
        raise exception 'Selected add-on is not published and effective for this cycle'
          using errcode='23514';
      end if;
      v_addon_definition_id:=v_addon_version.addon_definition_id;
      if v_addon_definition_id=any(v_seen_addon_definitions) then
        raise exception 'A Branch cannot buy overlapping versions of the same add-on'
          using errcode='23514';
      end if;
      v_seen_addon_definitions:=array_append(v_seen_addon_definitions,v_addon_definition_id);
      v_addon_price_id:=public.resolve_sellertray_commercial_v2_price_version(
        p_tenant_id,'addon',null,v_addon_version_id,v_addon_cycle,v_currency,v_ordered_at
      );
      if v_addon_price_id is null then
        raise exception 'No governed add-on price is effective for the selected Branch add-on'
          using errcode='23514';
      end if;
      select p.* into strict v_addon_price
      from public.sellertray_commercial_price_versions p where p.id=v_addon_price_id;
      v_total:=v_total+v_addon_price.gross_amount;
    end loop;
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


    v_addon_lines:='[]'::jsonb;
    for v_addon_item in
      select a.value from jsonb_array_elements(coalesce(v_item->'addonSelections','[]'::jsonb)) a(value)
    loop
      v_addon_version_id:=(v_addon_item->>'addonVersionId')::uuid;
      v_addon_cycle:=lower(btrim(v_addon_item->>'billingCycle'));
      v_addon_price_id:=public.resolve_sellertray_commercial_v2_price_version(
        p_tenant_id,'addon',null,v_addon_version_id,v_addon_cycle,v_currency,v_ordered_at
      );
      insert into public.sellertray_commercial_order_price_snapshots(
        tenant_id,commercial_order_id,line_no,line_type,source_price_version_id,branch_id,
        description_snapshot,quantity,currency,unit_gross_amount,gross_amount
      ) values(
        p_tenant_id,v_order_id,v_line_no,'branch_addon',v_addon_price_id,v_branch_id,
        '',1,v_currency,0,0
      ) returning id into v_addon_line_id;
      v_addon_lines:=v_addon_lines||jsonb_build_array(jsonb_build_object(
        'addonVersionId',v_addon_version_id,'billingCycle',v_addon_cycle,
        'addonLineId',v_addon_line_id
      ));
      v_line_no:=v_line_no+1;
    end loop;

    v_policy:=public.resolve_sellertray_installment_policy_v2(
      p_tenant_id,v_order_id,v_plan_version_id,v_cycle,v_ordered_at
    );
    -- The configured default is always the fallback; no template code is semantic.
    -- An alternative is allowed only when explicitly published on this policy version.
    v_template_id:=coalesce(v_requested_template_id,nullif(v_policy->>'defaultTemplateId','')::uuid);
    if not public.sellertray_c2_installment_template_allowed(v_policy,v_template_id) then
      raise exception 'Selected installment structure is not authorised by the effective Commercial V2 policy'
        using errcode='23514';
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
      'addonLines',v_addon_lines,
      'supersedesBranchSubscriptionId',v_supersedes
    ));
  end loop;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(p_actor_user_id,p_tenant_id,'sellertray_create_c2_branch_commercial_order',jsonb_build_object(
    'commercialOrderId',v_order_id,'orderReference',v_reference,'currency',v_currency,
    'totalGrossAmount',v_total,'commandId',p_command_id,'actorKind',v_actor_kind,
    'branchSubjectCount',jsonb_array_length(v_results),
    'addonLineCount',(select count(*) from public.sellertray_commercial_order_price_snapshots l
      where l.tenant_id=p_tenant_id and l.commercial_order_id=v_order_id
        and l.line_type='branch_addon')
  ));

  return jsonb_build_object(
    'commercialOrderId',v_order_id,'orderReference',v_reference,'currency',v_currency,
    'totalGrossAmount',v_total,'subjects',v_results,'idempotentReplay',false
  );
end;
$function$;
commit;
