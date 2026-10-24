begin;

-- Governed C1A read models for Merchant Web and SellerTray Admin.
-- Agreement tables remain service-authority persistence; clients consume these
-- projections through authenticated Edge Functions rather than direct table reads.

create or replace function public.get_sellertray_commercial_agreement_center(
  p_tenant_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path=''
as $$
declare
  v_role text;
  v_can_accept boolean;
  v_agreements jsonb;
begin
  if p_tenant_id is null or p_actor_user_id is null then
    raise exception 'Business and user are required' using errcode='22023';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;

  if v_role not in ('owner','manager') then
    raise exception 'Merchant agreement access requires an Owner or Manager' using errcode='42501';
  end if;

  v_can_accept := public.sellertray_user_has_capability(
    p_tenant_id,p_actor_user_id,'can_accept_commercial_agreements'
  );

  select coalesce(jsonb_agg(row_value order by is_current desc,issued_at desc,agreement_id),'[]'::jsonb)
  into v_agreements
  from (
    select
      a.id as agreement_id,
      a.issued_at,
      not exists (
        select 1
        from public.sellertray_commercial_agreements replacement
        where replacement.tenant_id=a.tenant_id
          and replacement.supersedes_agreement_id=a.id
      ) as is_current,
      jsonb_build_object(
        'id',a.id,
        'reference',a.agreement_reference,
        'family',a.agreement_family,
        'title',t.title,
        'templateVersion',a.template_version_code,
        'templateContentSha256',a.template_content_sha256,
        'contentSha256',a.content_sha256,
        'renderedContent',a.rendered_content,
        'commercialSnapshot',a.commercial_snapshot,
        'commercialOrderId',a.commercial_order_id,
        'installmentObligationId',a.installment_obligation_id,
        'supersedesAgreementId',a.supersedes_agreement_id,
        'isCurrent',not exists (
          select 1
          from public.sellertray_commercial_agreements replacement
          where replacement.tenant_id=a.tenant_id
            and replacement.supersedes_agreement_id=a.id
        ),
        'issuedAt',a.issued_at,
        'acceptance',case when ac.id is null then null else jsonb_build_object(
          'id',ac.id,
          'acceptedAt',ac.accepted_at,
          'acceptedLegalName',ac.accepted_legal_name,
          'acceptedRole',ac.accepted_role,
          'acceptedByCurrentUser',ac.accepted_by_user_id=p_actor_user_id,
          'agreementContentSha256',ac.agreement_content_sha256,
          'templateContentSha256',ac.template_content_sha256
        ) end
      ) as row_value
    from public.sellertray_commercial_agreements a
    join public.sellertray_commercial_agreement_template_versions t
      on t.id=a.template_version_id
    left join public.sellertray_commercial_agreement_acceptances ac
      on ac.tenant_id=a.tenant_id and ac.agreement_id=a.id
    where a.tenant_id=p_tenant_id
  ) projected;

  return jsonb_build_object(
    'tenantId',p_tenant_id,
    'actorRole',v_role,
    'canAccept',v_can_accept,
    'agreements',v_agreements
  );
end;
$$;

revoke all on function public.get_sellertray_commercial_agreement_center(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.get_sellertray_commercial_agreement_center(uuid,uuid)
  to service_role;

create or replace function public.get_sellertray_commercial_agreement_admin(
  p_actor_user_id uuid,
  p_tenant_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path=''
as $$
declare
  v_role text;
  v_templates jsonb;
  v_orders jsonb;
  v_agreements jsonb;
begin
  if p_actor_user_id is null then
    raise exception 'Administrator user is required' using errcode='22023';
  end if;

  select pa.role into v_role
  from public.platform_admins pa
  where pa.user_id=p_actor_user_id;

  if v_role not in ('admin','support') then
    raise exception 'Platform administrator access required' using errcode='42501';
  end if;

  if p_tenant_id is not null and not exists (
    select 1 from public.tenants t where t.id=p_tenant_id
  ) then
    raise exception 'SellerTray business not found' using errcode='P0002';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',t.id,
    'family',t.agreement_family,
    'versionCode',t.version_code,
    'title',t.title,
    'contentBody',t.content_body,
    'contentSha256',t.content_sha256,
    'effectiveFrom',t.effective_from,
    'publishedAt',t.published_at,
    'publishedByUserId',t.published_by_user_id
  ) order by t.agreement_family,t.effective_from desc,t.created_at desc),'[]'::jsonb)
  into v_templates
  from public.sellertray_commercial_agreement_template_versions t;

  if p_tenant_id is null then
    v_orders := '[]'::jsonb;
    v_agreements := '[]'::jsonb;
  else
    select coalesce(jsonb_agg(order_value order by ordered_at desc,order_id),'[]'::jsonb)
    into v_orders
    from (
      select
        o.id as order_id,
        o.ordered_at,
        jsonb_build_object(
          'id',o.id,
          'reference',o.order_reference,
          'currency',o.currency,
          'totalGrossAmount',o.total_gross_amount,
          'orderedAt',o.ordered_at,
          'priceSnapshots',coalesce((
            select jsonb_agg(jsonb_build_object(
              'id',s.id,
              'lineNo',s.line_no,
              'lineType',s.line_type,
              'sourcePriceVersionId',s.source_price_version_id,
              'planCode',s.plan_code,
              'branchId',s.branch_id,
              'billingCycle',s.billing_cycle,
              'description',s.description_snapshot,
              'quantity',s.quantity,
              'currency',s.currency,
              'unitGrossAmount',s.unit_gross_amount,
              'grossAmount',s.gross_amount,
              'netAmount',s.net_amount,
              'taxRatePercent',s.tax_rate_percent,
              'taxAmount',s.tax_amount
            ) order by s.line_no)
            from public.sellertray_commercial_order_price_snapshots s
            where s.tenant_id=o.tenant_id and s.commercial_order_id=o.id
          ),'[]'::jsonb),
          'installmentObligations',coalesce((
            select jsonb_agg(jsonb_build_object(
              'id',io.id,
              'structureCode',io.structure_code,
              'currency',io.currency,
              'obligatedAmount',io.obligated_amount,
              'createdAt',io.created_at,
              'schedule',coalesce((
                select jsonb_agg(jsonb_build_object(
                  'sequenceNo',sch.sequence_no,
                  'percentage',sch.percentage,
                  'amountDue',sch.amount_due,
                  'dueAt',sch.due_at
                ) order by sch.sequence_no)
                from public.sellertray_commercial_installment_schedule sch
                where sch.tenant_id=io.tenant_id
                  and sch.installment_obligation_id=io.id
              ),'[]'::jsonb)
            ) order by io.created_at,io.id)
            from public.sellertray_commercial_installment_obligations io
            where io.tenant_id=o.tenant_id and io.commercial_order_id=o.id
          ),'[]'::jsonb)
        ) as order_value
      from public.sellertray_commercial_orders o
      where o.tenant_id=p_tenant_id
    ) projected_orders;

    select coalesce(jsonb_agg(agreement_value order by is_current desc,issued_at desc,agreement_id),'[]'::jsonb)
    into v_agreements
    from (
      select
        a.id as agreement_id,
        a.issued_at,
        not exists (
          select 1 from public.sellertray_commercial_agreements replacement
          where replacement.tenant_id=a.tenant_id
            and replacement.supersedes_agreement_id=a.id
        ) as is_current,
        jsonb_build_object(
          'id',a.id,
          'reference',a.agreement_reference,
          'family',a.agreement_family,
          'title',t.title,
          'templateVersionId',a.template_version_id,
          'templateVersion',a.template_version_code,
          'templateContentSha256',a.template_content_sha256,
          'contentSha256',a.content_sha256,
          'renderedContent',a.rendered_content,
          'commercialSnapshot',a.commercial_snapshot,
          'commercialOrderId',a.commercial_order_id,
          'installmentObligationId',a.installment_obligation_id,
          'supersedesAgreementId',a.supersedes_agreement_id,
          'isCurrent',not exists (
            select 1 from public.sellertray_commercial_agreements replacement
            where replacement.tenant_id=a.tenant_id
              and replacement.supersedes_agreement_id=a.id
          ),
          'issuedAt',a.issued_at,
          'issuedByUserId',a.issued_by_user_id,
          'acceptance',case when ac.id is null then null else jsonb_build_object(
            'id',ac.id,
            'acceptedAt',ac.accepted_at,
            'acceptedLegalName',ac.accepted_legal_name,
            'acceptedRole',ac.accepted_role,
            'acceptedByUserId',ac.accepted_by_user_id,
            'agreementContentSha256',ac.agreement_content_sha256,
            'templateContentSha256',ac.template_content_sha256
          ) end
        ) as agreement_value
      from public.sellertray_commercial_agreements a
      join public.sellertray_commercial_agreement_template_versions t
        on t.id=a.template_version_id
      left join public.sellertray_commercial_agreement_acceptances ac
        on ac.tenant_id=a.tenant_id and ac.agreement_id=a.id
      where a.tenant_id=p_tenant_id
    ) projected_agreements;
  end if;

  return jsonb_build_object(
    'actorRole',v_role,
    'canManage',v_role='admin',
    'tenantId',p_tenant_id,
    'templates',v_templates,
    'commercialOrders',v_orders,
    'agreements',v_agreements
  );
end;
$$;

revoke all on function public.get_sellertray_commercial_agreement_admin(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.get_sellertray_commercial_agreement_admin(uuid,uuid)
  to service_role;

commit;
