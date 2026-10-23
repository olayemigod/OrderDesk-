begin;

-- ProcessEdge Admin commercial portfolio queues.
--
-- These are read-only projections over the existing SellerTray commercial,
-- agreement and provider-confirmed payment authorities. They deliberately do
-- not infer installment due dates, grace, aging, recognised revenue, profit,
-- refund/guarantee exposure or cross-currency totals.

create index if not exists sellertray_commercial_installment_obligations_admin_cursor_idx
  on public.sellertray_commercial_installment_obligations(created_at desc,id desc);

create index if not exists sellertray_commercial_agreements_admin_cursor_idx
  on public.sellertray_commercial_agreements(issued_at desc,id desc);

create or replace function public.platform_admin_commercial_installment_portfolio(
  p_actor_user_id uuid,
  p_search text default null,
  p_filter text default 'open',
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_role text;
  v_search text:=lower(nullif(btrim(coalesce(p_search,'')),''));
  v_filter text:=lower(btrim(coalesce(p_filter,'open')));
  v_limit integer:=greatest(1,least(coalesce(p_limit,20),50));
  v_result jsonb;
begin
  select pa.role into v_role
  from public.platform_admins pa
  where pa.user_id=p_actor_user_id;

  if v_role is null then
    raise exception 'Platform administrator access required' using errcode='42501';
  end if;
  if char_length(coalesce(v_search,''))>120 then
    raise exception 'Commercial portfolio search is too long' using errcode='22023';
  end if;
  if v_filter not in ('all','open','awaiting_first_payment','in_progress','settled') then
    raise exception 'Unsupported installment portfolio filter' using errcode='22023';
  end if;
  if (p_before_created_at is null) <> (p_before_id is null) then
    raise exception 'Installment portfolio cursor is incomplete' using errcode='22023';
  end if;

  with base as materialized (
    select
      io.id,
      io.tenant_id,
      io.commercial_order_id,
      io.structure_code,
      io.currency,
      io.obligated_amount,
      io.created_at,
      t.name merchant_name,
      t.slug merchant_slug,
      t.business_email,
      t.business_phone,
      o.order_reference,
      o.ordered_at,
      sub.plan_code,
      coalesce(pay.installment_count,0)::integer installment_count,
      coalesce(pay.paid_count,0)::integer paid_count,
      coalesce(pay.paid_amount,0)::numeric paid_amount,
      pay.first_paid_at,
      pay.last_paid_at,
      nxt.sequence_no next_sequence_no,
      nxt.amount_due next_amount_due,
      public.sellertray_installment_agreement_is_accepted(io.tenant_id,io.commercial_order_id,io.id) agreement_accepted,
      coalesce(setup.required_count,0)::integer setup_required_count,
      coalesce(setup.ready_count,0)::integer setup_ready_count,
      case
        when exists(
          select 1 from public.sellertray_commercial_entitlement_events e
          where e.tenant_id=io.tenant_id
            and e.installment_obligation_id=io.id
            and e.event_type='installment.full_entitlement_released'
        ) then 'full'
        when exists(
          select 1 from public.sellertray_commercial_entitlement_events e
          where e.tenant_id=io.tenant_id
            and e.installment_obligation_id=io.id
            and e.event_type='installment.provisional_activated'
        ) then 'provisional'
        else 'not_active'
      end entitlement_state
    from public.sellertray_commercial_installment_obligations io
    join public.sellertray_commercial_orders o
      on o.tenant_id=io.tenant_id and o.id=io.commercial_order_id
    join public.tenants t on t.id=io.tenant_id
    left join lateral (
      select s.plan_code
      from public.sellertray_commercial_order_price_snapshots s
      where s.tenant_id=io.tenant_id
        and s.commercial_order_id=io.commercial_order_id
        and s.line_type='subscription'
      order by s.line_no
      limit 1
    ) sub on true
    left join lateral (
      select
        count(*)::integer installment_count,
        count(pc.id)::integer paid_count,
        coalesce(sum(pc.amount),0)::numeric paid_amount,
        min(pc.paid_at) first_paid_at,
        max(pc.paid_at) last_paid_at
      from public.sellertray_commercial_installment_schedule sch
      left join public.sellertray_commercial_installment_payment_confirmations pc
        on pc.tenant_id=sch.tenant_id and pc.installment_schedule_id=sch.id
      where sch.tenant_id=io.tenant_id
        and sch.installment_obligation_id=io.id
    ) pay on true
    left join lateral (
      select sch.sequence_no,sch.amount_due
      from public.sellertray_commercial_installment_schedule sch
      where sch.tenant_id=io.tenant_id
        and sch.installment_obligation_id=io.id
        and not exists(
          select 1
          from public.sellertray_commercial_installment_payment_confirmations pc
          where pc.tenant_id=sch.tenant_id and pc.installment_schedule_id=sch.id
        )
      order by sch.sequence_no
      limit 1
    ) nxt on true
    left join lateral (
      select
        count(*)::integer required_count,
        count(r.id)::integer ready_count
      from public.sellertray_commercial_order_price_snapshots s
      left join public.sellertray_commercial_branch_setup_readiness r
        on r.tenant_id=s.tenant_id
       and r.commercial_order_id=s.commercial_order_id
       and r.branch_id=s.branch_id
      where s.tenant_id=io.tenant_id
        and s.commercial_order_id=io.commercial_order_id
        and s.line_type='branch_setup'
    ) setup on true
    where v_search is null
      or position(v_search in lower(concat_ws(' ',
        t.name,t.slug,t.business_email,t.business_phone,o.order_reference,
        sub.plan_code,io.structure_code,io.currency
      )))>0
  ), eligible as materialized (
    select b.*,
      case
        when b.installment_count>0 and b.paid_count=b.installment_count then 'settled'
        when b.paid_count=0 then 'awaiting_first_payment'
        when b.paid_count<b.installment_count then 'in_progress'
        else 'open'
      end portfolio_state
    from base b
  ), filtered as materialized (
    select e.*
    from eligible e
    where (p_before_created_at is null or (e.created_at,e.id)<(p_before_created_at,p_before_id))
      and case v_filter
        when 'open' then e.installment_count=0 or e.paid_count<e.installment_count
        when 'awaiting_first_payment' then e.installment_count>0 and e.paid_count=0
        when 'in_progress' then e.paid_count>0 and e.paid_count<e.installment_count
        when 'settled' then e.installment_count>0 and e.paid_count=e.installment_count
        else true
      end
    order by e.created_at desc,e.id desc
    limit v_limit+1
  ), page as materialized (
    select * from filtered order by created_at desc,id desc limit v_limit
  )
  select jsonb_build_object(
    'actorRole',v_role,
    'generatedAt',now(),
    'pageSize',v_limit,
    'filter',v_filter,
    'items',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',p.id,
        'tenantId',p.tenant_id,
        'merchantName',p.merchant_name,
        'merchantSlug',p.merchant_slug,
        'businessEmail',p.business_email,
        'businessPhone',p.business_phone,
        'commercialOrderId',p.commercial_order_id,
        'orderReference',p.order_reference,
        'orderedAt',p.ordered_at,
        'planCode',p.plan_code,
        'structureCode',p.structure_code,
        'currency',p.currency,
        'obligatedAmount',p.obligated_amount,
        'paidAmount',p.paid_amount,
        'outstandingAmount',greatest(p.obligated_amount-p.paid_amount,0),
        'installmentCount',p.installment_count,
        'paidCount',p.paid_count,
        'nextSequenceNo',p.next_sequence_no,
        'nextAmountDue',p.next_amount_due,
        'firstPaidAt',p.first_paid_at,
        'lastPaidAt',p.last_paid_at,
        'agreementAccepted',p.agreement_accepted,
        'setupRequiredCount',p.setup_required_count,
        'setupReadyCount',p.setup_ready_count,
        'entitlementState',p.entitlement_state,
        'portfolioState',p.portfolio_state,
        'createdAt',p.created_at
      ) order by p.created_at desc,p.id desc)
      from page p
    ),'[]'::jsonb),
    'hasMore',(select count(*)>v_limit from filtered),
    'nextCursor',case when (select count(*)>v_limit from filtered) then (
      select jsonb_build_object('beforeCreatedAt',p.created_at,'beforeId',p.id)
      from page p order by p.created_at,p.id limit 1
    ) else null end
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.platform_admin_commercial_agreement_portfolio(
  p_actor_user_id uuid,
  p_search text default null,
  p_filter text default 'awaiting_acceptance',
  p_before_issued_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_role text;
  v_search text:=lower(nullif(btrim(coalesce(p_search,'')),''));
  v_filter text:=lower(btrim(coalesce(p_filter,'awaiting_acceptance')));
  v_limit integer:=greatest(1,least(coalesce(p_limit,20),50));
  v_result jsonb;
begin
  select pa.role into v_role
  from public.platform_admins pa
  where pa.user_id=p_actor_user_id;

  if v_role is null then
    raise exception 'Platform administrator access required' using errcode='42501';
  end if;
  if char_length(coalesce(v_search,''))>120 then
    raise exception 'Commercial portfolio search is too long' using errcode='22023';
  end if;
  if v_filter not in ('all','awaiting_acceptance','accepted','replaced') then
    raise exception 'Unsupported agreement portfolio filter' using errcode='22023';
  end if;
  if (p_before_issued_at is null) <> (p_before_id is null) then
    raise exception 'Agreement portfolio cursor is incomplete' using errcode='22023';
  end if;

  with eligible as materialized (
    select
      a.id,
      a.tenant_id,
      a.commercial_order_id,
      a.installment_obligation_id,
      a.agreement_reference,
      a.agreement_family,
      a.template_version_code,
      a.issued_at,
      a.supersedes_agreement_id,
      t.name merchant_name,
      t.slug merchant_slug,
      t.business_email,
      t.business_phone,
      o.order_reference,
      tv.title,
      ac.accepted_at,
      ac.accepted_legal_name,
      ac.accepted_role,
      case
        when exists(
          select 1 from public.sellertray_commercial_agreements replacement
          where replacement.tenant_id=a.tenant_id
            and replacement.supersedes_agreement_id=a.id
        ) then 'replaced'
        when ac.id is not null then 'accepted'
        else 'awaiting_acceptance'
      end portfolio_state
    from public.sellertray_commercial_agreements a
    join public.tenants t on t.id=a.tenant_id
    join public.sellertray_commercial_orders o
      on o.tenant_id=a.tenant_id and o.id=a.commercial_order_id
    join public.sellertray_commercial_agreement_template_versions tv
      on tv.id=a.template_version_id
    left join public.sellertray_commercial_agreement_acceptances ac
      on ac.tenant_id=a.tenant_id and ac.agreement_id=a.id
    where v_search is null
      or position(v_search in lower(concat_ws(' ',
        t.name,t.slug,t.business_email,t.business_phone,o.order_reference,
        a.agreement_reference,a.agreement_family,a.template_version_code,tv.title
      )))>0
  ), filtered as materialized (
    select e.*
    from eligible e
    where (p_before_issued_at is null or (e.issued_at,e.id)<(p_before_issued_at,p_before_id))
      and (v_filter='all' or e.portfolio_state=v_filter)
    order by e.issued_at desc,e.id desc
    limit v_limit+1
  ), page as materialized (
    select * from filtered order by issued_at desc,id desc limit v_limit
  )
  select jsonb_build_object(
    'actorRole',v_role,
    'generatedAt',now(),
    'pageSize',v_limit,
    'filter',v_filter,
    'items',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',p.id,
        'tenantId',p.tenant_id,
        'merchantName',p.merchant_name,
        'merchantSlug',p.merchant_slug,
        'businessEmail',p.business_email,
        'businessPhone',p.business_phone,
        'commercialOrderId',p.commercial_order_id,
        'installmentObligationId',p.installment_obligation_id,
        'orderReference',p.order_reference,
        'reference',p.agreement_reference,
        'family',p.agreement_family,
        'title',p.title,
        'templateVersion',p.template_version_code,
        'supersedesAgreementId',p.supersedes_agreement_id,
        'portfolioState',p.portfolio_state,
        'issuedAt',p.issued_at,
        'acceptedAt',p.accepted_at,
        'acceptedLegalName',p.accepted_legal_name,
        'acceptedRole',p.accepted_role
      ) order by p.issued_at desc,p.id desc)
      from page p
    ),'[]'::jsonb),
    'hasMore',(select count(*)>v_limit from filtered),
    'nextCursor',case when (select count(*)>v_limit from filtered) then (
      select jsonb_build_object('beforeIssuedAt',p.issued_at,'beforeId',p.id)
      from page p order by p.issued_at,p.id limit 1
    ) else null end
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.platform_admin_commercial_installment_portfolio(uuid,text,text,timestamptz,uuid,integer)
  from public,anon,authenticated;
revoke all on function public.platform_admin_commercial_agreement_portfolio(uuid,text,text,timestamptz,uuid,integer)
  from public,anon,authenticated;
grant execute on function public.platform_admin_commercial_installment_portfolio(uuid,text,text,timestamptz,uuid,integer)
  to service_role;
grant execute on function public.platform_admin_commercial_agreement_portfolio(uuid,text,text,timestamptz,uuid,integer)
  to service_role;

commit;
