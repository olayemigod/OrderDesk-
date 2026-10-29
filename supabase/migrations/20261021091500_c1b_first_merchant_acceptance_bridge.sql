begin;

-- SellerTray C1B first-merchant acceptance bridge.
--
-- This migration makes the already-approved C1/C1A/C1B commercial authority
-- operable by Platform Admin before the deliberate C2 cutover. It does not
-- change tenant_subscriptions runtime ownership, create a second payment truth,
-- or introduce due-date/grace/suspension semantics.

create or replace function public.get_sellertray_commercial_onboarding_admin(
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
  v_result jsonb;
begin
  select pa.role into v_role
  from public.platform_admins pa
  where pa.user_id=p_actor_user_id;

  if v_role not in ('admin','support') then
    raise exception 'Platform administrator access required' using errcode='42501';
  end if;
  if p_tenant_id is null or not exists (select 1 from public.tenants t where t.id=p_tenant_id) then
    raise exception 'Business not found' using errcode='P0002';
  end if;

  select jsonb_build_object(
    'actorRole',v_role,
    'canManage',v_role='admin',
    'tenantId',p_tenant_id,
    'runtimeCompatibility',(
      select jsonb_build_object(
        'planCode',s.plan_code,
        'status',s.status,
        'eligibleForInitialInstallment',s.status='trial'
      )
      from public.tenant_subscriptions s
      where s.tenant_id=p_tenant_id
    ),
    'plans',coalesce((
      select jsonb_agg(jsonb_build_object(
        'code',p.code,
        'name',p.name,
        'currency',p.currency,
        'active',p.is_active
      ) order by p.name,p.code)
      from public.subscription_plans p
      where p.is_active
    ),'[]'::jsonb),
    'branches',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',b.id,
        'code',b.code,
        'name',b.name,
        'active',b.is_active,
        'isDefault',b.is_default
      ) order by b.is_default desc,b.name,b.id)
      from public.branches b
      where b.tenant_id=p_tenant_id
    ),'[]'::jsonb),
    'prices',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',p.id,
        'priceKind',p.price_kind,
        'planCode',p.plan_code,
        'billingCycle',p.billing_cycle,
        'currency',p.currency,
        'grossAmount',p.gross_amount,
        'netAmount',p.net_amount,
        'taxRatePercent',p.tax_rate_percent,
        'taxAmount',p.tax_amount,
        'effectiveFrom',p.effective_from,
        'changeReason',p.change_reason
      ) order by p.price_kind,p.plan_code nulls last,p.billing_cycle nulls last,p.effective_from desc,p.created_at desc)
      from public.sellertray_commercial_price_versions p
      where p.status='published'
    ),'[]'::jsonb),
    'orders',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',o.id,
        'reference',o.order_reference,
        'currency',o.currency,
        'totalGrossAmount',o.total_gross_amount,
        'orderedAt',o.ordered_at,
        'installmentObligationId',io.id,
        'structureCode',io.structure_code,
        'schedule',coalesce((
          select jsonb_agg(jsonb_build_object(
            'sequenceNo',s.sequence_no,
            'percentage',s.percentage,
            'amountDue',s.amount_due,
            'dueAt',s.due_at
          ) order by s.sequence_no)
          from public.sellertray_commercial_installment_schedule s
          where s.tenant_id=o.tenant_id and s.installment_obligation_id=io.id
        ),'[]'::jsonb),
        'branches',coalesce((
          select jsonb_agg(jsonb_build_object(
            'branchId',ps.branch_id,
            'description',ps.description_snapshot,
            'grossAmount',ps.gross_amount
          ) order by ps.line_no)
          from public.sellertray_commercial_order_price_snapshots ps
          where ps.tenant_id=o.tenant_id
            and ps.commercial_order_id=o.id
            and ps.line_type='branch_setup'
        ),'[]'::jsonb)
      ) order by o.ordered_at desc,o.id desc)
      from public.sellertray_commercial_orders o
      left join public.sellertray_commercial_installment_obligations io
        on io.tenant_id=o.tenant_id and io.commercial_order_id=o.id
      where o.tenant_id=p_tenant_id
    ),'[]'::jsonb),
    'templates',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',t.id,
        'family',t.agreement_family,
        'versionCode',t.version_code,
        'title',t.title,
        'effectiveFrom',t.effective_from,
        'publishedAt',t.published_at
      ) order by t.agreement_family,t.effective_from desc,t.published_at desc)
      from public.sellertray_commercial_agreement_template_versions t
    ),'[]'::jsonb),
    'agreements',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',a.id,
        'commercialOrderId',a.commercial_order_id,
        'installmentObligationId',a.installment_obligation_id,
        'templateVersionId',a.template_version_id,
        'family',a.agreement_family,
        'reference',a.agreement_reference,
        'issuedAt',a.issued_at,
        'accepted',exists(
          select 1 from public.sellertray_commercial_agreement_acceptances ac
          where ac.tenant_id=a.tenant_id and ac.agreement_id=a.id
        )
      ) order by a.issued_at desc,a.id desc)
      from public.sellertray_commercial_agreements a
      where a.tenant_id=p_tenant_id
    ),'[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_sellertray_commercial_onboarding_admin(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.get_sellertray_commercial_onboarding_admin(uuid,uuid)
  to service_role;

create or replace function public.publish_sellertray_subscription_price_pair_admin(
  p_plan_code text,
  p_currency text,
  p_monthly_gross_amount numeric,
  p_tax_rate_percent numeric,
  p_effective_from timestamptz,
  p_reason text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_role text;
  v_plan_code text := btrim(coalesce(p_plan_code,''));
  v_currency text := upper(btrim(coalesce(p_currency,'')));
  v_reason text := btrim(coalesce(p_reason,''));
  v_monthly_gross numeric(18,2) := round(coalesce(p_monthly_gross_amount,0)::numeric,2);
  v_monthly_net numeric(18,2);
  v_monthly_tax numeric(18,2);
  v_yearly_gross numeric(18,2);
  v_yearly_net numeric(18,2);
  v_yearly_tax numeric(18,2);
  v_monthly_id uuid;
  v_yearly_id uuid;
begin
  select pa.role into v_role from public.platform_admins pa where pa.user_id=p_actor_user_id;
  if v_role<>'admin' then
    raise exception 'Platform admin role required for this action' using errcode='42501';
  end if;
  if not exists (select 1 from public.subscription_plans p where p.code=v_plan_code and p.is_active) then
    raise exception 'Active SellerTray plan not found' using errcode='P0002';
  end if;
  if v_currency !~ '^[A-Z]{3}$' or v_monthly_gross<=0 or p_effective_from is null then
    raise exception 'Plan, currency, positive monthly price and effective time are required' using errcode='22023';
  end if;
  if char_length(v_reason) not between 6 and 1000 then
    raise exception 'Commercial change reason must be between 6 and 1000 characters' using errcode='22023';
  end if;
  if p_tax_rate_percent is not null and (p_tax_rate_percent<0 or p_tax_rate_percent>100) then
    raise exception 'Tax rate must be between 0 and 100 percent' using errcode='22023';
  end if;

  if p_tax_rate_percent is not null then
    v_monthly_net := round((v_monthly_gross/(1+(p_tax_rate_percent/100)))::numeric,2);
    v_monthly_tax := v_monthly_gross-v_monthly_net;
  end if;
  v_yearly_gross := v_monthly_gross*10;
  if v_monthly_net is not null then
    v_yearly_net := v_monthly_net*10;
    v_yearly_tax := v_yearly_gross-v_yearly_net;
  end if;

  insert into public.sellertray_commercial_price_versions(
    price_kind,plan_code,billing_cycle,currency,gross_amount,tax_inclusive,
    net_amount,tax_rate_percent,tax_amount,effective_from,status,change_reason,
    created_by_user_id,approved_by_user_id,approved_at
  ) values (
    'subscription',v_plan_code,'monthly',v_currency,v_monthly_gross,true,
    v_monthly_net,p_tax_rate_percent,v_monthly_tax,p_effective_from,'published',v_reason,
    p_actor_user_id,p_actor_user_id,now()
  )
  on conflict (plan_code,billing_cycle,currency,effective_from) where price_kind='subscription' do nothing
  returning id into v_monthly_id;

  if v_monthly_id is null then
    select p.id into strict v_monthly_id
    from public.sellertray_commercial_price_versions p
    where p.price_kind='subscription' and p.plan_code=v_plan_code
      and p.billing_cycle='monthly' and p.currency=v_currency and p.effective_from=p_effective_from
      and p.gross_amount=v_monthly_gross
      and p.net_amount is not distinct from v_monthly_net
      and p.tax_rate_percent is not distinct from p_tax_rate_percent
      and p.tax_amount is not distinct from v_monthly_tax
      and p.change_reason=v_reason;
  end if;

  insert into public.sellertray_commercial_price_versions(
    price_kind,plan_code,billing_cycle,currency,gross_amount,tax_inclusive,
    net_amount,tax_rate_percent,tax_amount,effective_from,status,change_reason,
    created_by_user_id,approved_by_user_id,approved_at
  ) values (
    'subscription',v_plan_code,'yearly',v_currency,v_yearly_gross,true,
    v_yearly_net,p_tax_rate_percent,v_yearly_tax,p_effective_from,'published',v_reason,
    p_actor_user_id,p_actor_user_id,now()
  )
  on conflict (plan_code,billing_cycle,currency,effective_from) where price_kind='subscription' do nothing
  returning id into v_yearly_id;

  if v_yearly_id is null then
    select p.id into strict v_yearly_id
    from public.sellertray_commercial_price_versions p
    where p.price_kind='subscription' and p.plan_code=v_plan_code
      and p.billing_cycle='yearly' and p.currency=v_currency and p.effective_from=p_effective_from
      and p.gross_amount=v_yearly_gross
      and p.net_amount is not distinct from v_yearly_net
      and p.tax_rate_percent is not distinct from p_tax_rate_percent
      and p.tax_amount is not distinct from v_yearly_tax
      and p.change_reason=v_reason;
  end if;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values (p_actor_user_id,null,'sellertray_publish_subscription_price_pair',jsonb_build_object(
    'planCode',v_plan_code,'currency',v_currency,'monthlyPriceVersionId',v_monthly_id,
    'yearlyPriceVersionId',v_yearly_id,'monthlyGrossAmount',v_monthly_gross,
    'yearlyGrossAmount',v_yearly_gross,'taxRatePercent',p_tax_rate_percent,
    'effectiveFrom',p_effective_from,'reason',v_reason
  ));

  return jsonb_build_object(
    'monthlyPriceVersionId',v_monthly_id,
    'yearlyPriceVersionId',v_yearly_id,
    'monthlyGrossAmount',v_monthly_gross,
    'yearlyGrossAmount',v_yearly_gross
  );
exception when no_data_found then
  raise exception 'Existing governed subscription price version conflicts with this request' using errcode='23505';
end;
$$;

revoke all on function public.publish_sellertray_subscription_price_pair_admin(text,text,numeric,numeric,timestamptz,text,uuid)
  from public,anon,authenticated;
grant execute on function public.publish_sellertray_subscription_price_pair_admin(text,text,numeric,numeric,timestamptz,text,uuid)
  to service_role;

create or replace function public.publish_sellertray_branch_setup_price_admin(
  p_currency text,
  p_gross_amount numeric,
  p_tax_rate_percent numeric,
  p_effective_from timestamptz,
  p_reason text,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_role text;
  v_currency text := upper(btrim(coalesce(p_currency,'')));
  v_reason text := btrim(coalesce(p_reason,''));
  v_gross numeric(18,2) := round(coalesce(p_gross_amount,0)::numeric,2);
  v_net numeric(18,2);
  v_tax numeric(18,2);
  v_id uuid;
begin
  select pa.role into v_role from public.platform_admins pa where pa.user_id=p_actor_user_id;
  if v_role<>'admin' then
    raise exception 'Platform admin role required for this action' using errcode='42501';
  end if;
  if v_currency !~ '^[A-Z]{3}$' or v_gross<=0 or p_effective_from is null then
    raise exception 'Currency, positive Branch setup price and effective time are required' using errcode='22023';
  end if;
  if char_length(v_reason) not between 6 and 1000 then
    raise exception 'Commercial change reason must be between 6 and 1000 characters' using errcode='22023';
  end if;
  if p_tax_rate_percent is not null and (p_tax_rate_percent<0 or p_tax_rate_percent>100) then
    raise exception 'Tax rate must be between 0 and 100 percent' using errcode='22023';
  end if;
  if p_tax_rate_percent is not null then
    v_net := round((v_gross/(1+(p_tax_rate_percent/100)))::numeric,2);
    v_tax := v_gross-v_net;
  end if;

  insert into public.sellertray_commercial_price_versions(
    price_kind,plan_code,billing_cycle,currency,gross_amount,tax_inclusive,
    net_amount,tax_rate_percent,tax_amount,effective_from,status,change_reason,
    created_by_user_id,approved_by_user_id,approved_at
  ) values (
    'branch_setup',null,null,v_currency,v_gross,true,
    v_net,p_tax_rate_percent,v_tax,p_effective_from,'published',v_reason,
    p_actor_user_id,p_actor_user_id,now()
  )
  on conflict (currency,effective_from) where price_kind='branch_setup' do nothing
  returning id into v_id;

  if v_id is null then
    select p.id into strict v_id
    from public.sellertray_commercial_price_versions p
    where p.price_kind='branch_setup' and p.currency=v_currency and p.effective_from=p_effective_from
      and p.gross_amount=v_gross
      and p.net_amount is not distinct from v_net
      and p.tax_rate_percent is not distinct from p_tax_rate_percent
      and p.tax_amount is not distinct from v_tax
      and p.change_reason=v_reason;
  end if;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values (p_actor_user_id,null,'sellertray_publish_branch_setup_price',jsonb_build_object(
    'priceVersionId',v_id,'currency',v_currency,'grossAmount',v_gross,
    'taxRatePercent',p_tax_rate_percent,'effectiveFrom',p_effective_from,'reason',v_reason
  ));

  return v_id;
exception when no_data_found then
  raise exception 'Existing governed Branch setup price version conflicts with this request' using errcode='23505';
end;
$$;

revoke all on function public.publish_sellertray_branch_setup_price_admin(text,numeric,numeric,timestamptz,text,uuid)
  from public,anon,authenticated;
grant execute on function public.publish_sellertray_branch_setup_price_admin(text,numeric,numeric,timestamptz,text,uuid)
  to service_role;

create or replace function public.create_sellertray_initial_installment_purchase_admin(
  p_tenant_id uuid,
  p_plan_code text,
  p_currency text,
  p_branch_ids uuid[],
  p_structure_code text,
  p_order_reference text,
  p_reason text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_role text;
  v_plan_code text := btrim(coalesce(p_plan_code,''));
  v_currency text := upper(btrim(coalesce(p_currency,'')));
  v_structure text := btrim(coalesce(p_structure_code,''));
  v_reference text := btrim(coalesce(p_order_reference,''));
  v_reason text := btrim(coalesce(p_reason,''));
  v_order_id uuid;
  v_obligation_id uuid;
  v_subscription_price_id uuid;
  v_setup_price_id uuid;
  v_subscription_price public.sellertray_commercial_price_versions%rowtype;
  v_setup_price public.sellertray_commercial_price_versions%rowtype;
  v_order public.sellertray_commercial_orders%rowtype;
  v_ordered_at timestamptz := now();
  v_branch_count integer;
  v_line_no integer := 2;
  v_total numeric(18,2);
  v_first numeric(18,2);
  v_second numeric(18,2);
  v_third numeric(18,2);
  v_branch record;
begin
  select pa.role into v_role from public.platform_admins pa where pa.user_id=p_actor_user_id;
  if v_role<>'admin' then
    raise exception 'Platform admin role required for this action' using errcode='42501';
  end if;
  if p_tenant_id is null or not exists (select 1 from public.tenants t where t.id=p_tenant_id) then
    raise exception 'Business not found' using errcode='P0002';
  end if;
  if char_length(v_reference) not between 1 and 128 then
    raise exception 'Commercial order reference is required' using errcode='22023';
  end if;
  if char_length(v_reason) not between 6 and 1000 then
    raise exception 'Commercial creation reason must be between 6 and 1000 characters' using errcode='22023';
  end if;
  if v_structure not in ('two_installment_70_30','three_installment_60_20_20') then
    raise exception 'Unsupported installment structure' using errcode='22023';
  end if;
  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'Valid commercial currency is required' using errcode='22023';
  end if;
  if not exists (select 1 from public.subscription_plans p where p.code=v_plan_code and p.is_active) then
    raise exception 'Active SellerTray plan not found' using errcode='P0002';
  end if;

  -- C1B is intentionally a pre-C2 bridge. This internal compatibility state is
  -- not a merchant-facing free-trial product and must disappear only in C2.
  if not exists (
    select 1 from public.tenant_subscriptions s
    where s.tenant_id=p_tenant_id and s.status='trial'
  ) then
    raise exception 'Business is not in the pre-C2 runtime compatibility state required for an initial installment purchase'
      using errcode='23514';
  end if;

  if p_branch_ids is null or cardinality(p_branch_ids)=0 then
    raise exception 'Select at least one active Branch for the initial purchase' using errcode='22023';
  end if;
  if cardinality(p_branch_ids)<>(select count(distinct x) from unnest(p_branch_ids) x) then
    raise exception 'Branch selection contains duplicates' using errcode='22023';
  end if;
  select count(*) into v_branch_count
  from public.branches b
  where b.tenant_id=p_tenant_id and b.is_active and b.id=any(p_branch_ids);
  if v_branch_count<>cardinality(p_branch_ids) then
    raise exception 'Every selected Branch must be active and belong to this business' using errcode='23514';
  end if;

  -- Natural command identity: the immutable commercial order reference. A retry
  -- returns the same order only when its governed subject matches this request.
  select o.* into v_order
  from public.sellertray_commercial_orders o
  where o.order_reference=v_reference;
  if found then
    if v_order.tenant_id<>p_tenant_id or v_order.currency<>v_currency then
      raise exception 'Commercial order reference is already used for different facts' using errcode='23505';
    end if;
    select io.id into strict v_obligation_id
    from public.sellertray_commercial_installment_obligations io
    where io.tenant_id=p_tenant_id and io.commercial_order_id=v_order.id and io.structure_code=v_structure;
    if not exists (
      select 1
      from public.sellertray_commercial_order_price_snapshots ps
      where ps.tenant_id=p_tenant_id and ps.commercial_order_id=v_order.id
        and ps.line_type='subscription' and ps.plan_code=v_plan_code and ps.billing_cycle='yearly'
    ) or (
      select coalesce(array_agg(ps.branch_id order by ps.branch_id),'{}'::uuid[])
      from public.sellertray_commercial_order_price_snapshots ps
      where ps.tenant_id=p_tenant_id and ps.commercial_order_id=v_order.id and ps.line_type='branch_setup'
    ) is distinct from (
      select array_agg(x order by x) from unnest(p_branch_ids) x
    ) then
      raise exception 'Commercial order reference is already used for different facts' using errcode='23505';
    end if;
    return jsonb_build_object(
      'commercialOrderId',v_order.id,
      'installmentObligationId',v_obligation_id,
      'orderReference',v_order.order_reference,
      'currency',v_order.currency,
      'totalGrossAmount',v_order.total_gross_amount,
      'idempotentReplay',true
    );
  end if;

  if exists (
    select 1
    from public.sellertray_commercial_orders o
    join public.sellertray_commercial_order_price_snapshots ps
      on ps.tenant_id=o.tenant_id and ps.commercial_order_id=o.id and ps.line_type='subscription'
    where o.tenant_id=p_tenant_id
  ) then
    raise exception 'Business already has a governed subscription commercial order; initial purchase cannot be duplicated'
      using errcode='23505';
  end if;

  v_subscription_price_id := public.resolve_sellertray_commercial_price_version(
    'subscription',v_plan_code,'yearly',v_currency,v_ordered_at
  );
  v_setup_price_id := public.resolve_sellertray_commercial_price_version(
    'branch_setup',null,null,v_currency,v_ordered_at
  );
  if v_subscription_price_id is null then
    raise exception 'No governed yearly subscription price is effective for this purchase' using errcode='23514';
  end if;
  if v_setup_price_id is null then
    raise exception 'No governed Branch setup price is effective for this purchase' using errcode='23514';
  end if;

  select p.* into strict v_subscription_price from public.sellertray_commercial_price_versions p where p.id=v_subscription_price_id;
  select p.* into strict v_setup_price from public.sellertray_commercial_price_versions p where p.id=v_setup_price_id;
  v_total := v_subscription_price.gross_amount + (v_setup_price.gross_amount*v_branch_count);

  insert into public.sellertray_commercial_orders(
    tenant_id,order_reference,currency,total_gross_amount,ordered_at,created_by_user_id
  ) values (
    p_tenant_id,v_reference,v_currency,v_total,v_ordered_at,p_actor_user_id
  ) returning id into v_order_id;

  insert into public.sellertray_commercial_order_price_snapshots(
    tenant_id,commercial_order_id,line_no,line_type,source_price_version_id,
    description_snapshot,quantity,currency,unit_gross_amount,gross_amount
  ) values (
    p_tenant_id,v_order_id,1,'subscription',v_subscription_price_id,
    '',1,v_currency,0,0
  );

  for v_branch in
    select b.id,b.code,b.name
    from public.branches b
    where b.tenant_id=p_tenant_id and b.is_active and b.id=any(p_branch_ids)
    order by b.name,b.id
  loop
    insert into public.sellertray_commercial_order_price_snapshots(
      tenant_id,commercial_order_id,line_no,line_type,source_price_version_id,branch_id,
      description_snapshot,quantity,currency,unit_gross_amount,gross_amount
    ) values (
      p_tenant_id,v_order_id,v_line_no,'branch_setup',v_setup_price_id,v_branch.id,
      format('Branch setup · %s',v_branch.name),1,v_currency,0,0
    );
    v_line_no := v_line_no+1;
  end loop;

  insert into public.sellertray_commercial_installment_obligations(
    tenant_id,commercial_order_id,structure_code,currency,obligated_amount,created_by_user_id
  ) values (
    p_tenant_id,v_order_id,v_structure,v_currency,v_total,p_actor_user_id
  ) returning id into v_obligation_id;

  if v_structure='two_installment_70_30' then
    v_first := round((v_total*0.70)::numeric,2);
    v_second := v_total-v_first;
    insert into public.sellertray_commercial_installment_schedule(
      tenant_id,installment_obligation_id,sequence_no,percentage,amount_due,due_at
    ) values
      (p_tenant_id,v_obligation_id,1,70,v_first,null),
      (p_tenant_id,v_obligation_id,2,30,v_second,null);
  else
    v_first := round((v_total*0.60)::numeric,2);
    v_second := round((v_total*0.20)::numeric,2);
    v_third := v_total-v_first-v_second;
    insert into public.sellertray_commercial_installment_schedule(
      tenant_id,installment_obligation_id,sequence_no,percentage,amount_due,due_at
    ) values
      (p_tenant_id,v_obligation_id,1,60,v_first,null),
      (p_tenant_id,v_obligation_id,2,20,v_second,null),
      (p_tenant_id,v_obligation_id,3,20,v_third,null);
  end if;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values (p_actor_user_id,p_tenant_id,'sellertray_create_initial_installment_purchase',jsonb_build_object(
    'commercialOrderId',v_order_id,'installmentObligationId',v_obligation_id,
    'orderReference',v_reference,'planCode',v_plan_code,'currency',v_currency,
    'branchIds',to_jsonb(p_branch_ids),'structureCode',v_structure,'totalGrossAmount',v_total,
    'reason',v_reason
  ));

  return jsonb_build_object(
    'commercialOrderId',v_order_id,
    'installmentObligationId',v_obligation_id,
    'orderReference',v_reference,
    'currency',v_currency,
    'totalGrossAmount',v_total,
    'idempotentReplay',false
  );
end;
$$;

revoke all on function public.create_sellertray_initial_installment_purchase_admin(uuid,text,text,uuid[],text,text,text,uuid)
  from public,anon,authenticated;
grant execute on function public.create_sellertray_initial_installment_purchase_admin(uuid,text,text,uuid[],text,text,text,uuid)
  to service_role;

create or replace function public.publish_sellertray_commercial_agreement_template_admin(
  p_agreement_family text,
  p_version_code text,
  p_title text,
  p_content_body text,
  p_effective_from timestamptz,
  p_reason text,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_reason text := btrim(coalesce(p_reason,''));
  v_id uuid;
begin
  if char_length(v_reason) not between 6 and 1000 then
    raise exception 'Commercial change reason must be between 6 and 1000 characters' using errcode='22023';
  end if;
  v_id := public.publish_sellertray_commercial_agreement_template_version(
    p_agreement_family,p_version_code,p_title,p_content_body,p_effective_from,p_actor_user_id
  );
  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values (p_actor_user_id,null,'sellertray_publish_commercial_agreement_template',jsonb_build_object(
    'templateVersionId',v_id,'agreementFamily',p_agreement_family,'versionCode',p_version_code,
    'effectiveFrom',p_effective_from,'reason',v_reason
  ));
  return v_id;
end;
$$;

revoke all on function public.publish_sellertray_commercial_agreement_template_admin(text,text,text,text,timestamptz,text,uuid)
  from public,anon,authenticated;
grant execute on function public.publish_sellertray_commercial_agreement_template_admin(text,text,text,text,timestamptz,text,uuid)
  to service_role;

create or replace function public.issue_sellertray_commercial_agreement_admin(
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_installment_obligation_id uuid,
  p_template_version_id uuid,
  p_agreement_reference text,
  p_rendered_content text,
  p_supersedes_agreement_id uuid,
  p_reason text,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_reason text := btrim(coalesce(p_reason,''));
  v_id uuid;
begin
  if char_length(v_reason) not between 6 and 1000 then
    raise exception 'Commercial issuance reason must be between 6 and 1000 characters' using errcode='22023';
  end if;
  v_id := public.issue_sellertray_commercial_agreement(
    p_tenant_id,p_commercial_order_id,p_installment_obligation_id,p_template_version_id,
    p_agreement_reference,p_rendered_content,p_supersedes_agreement_id,p_actor_user_id
  );
  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values (p_actor_user_id,p_tenant_id,'sellertray_issue_commercial_agreement',jsonb_build_object(
    'agreementId',v_id,'commercialOrderId',p_commercial_order_id,
    'installmentObligationId',p_installment_obligation_id,'templateVersionId',p_template_version_id,
    'agreementReference',p_agreement_reference,'reason',v_reason
  ));
  return v_id;
end;
$$;

revoke all on function public.issue_sellertray_commercial_agreement_admin(uuid,uuid,uuid,uuid,text,text,uuid,text,uuid)
  from public,anon,authenticated;
grant execute on function public.issue_sellertray_commercial_agreement_admin(uuid,uuid,uuid,uuid,text,text,uuid,text,uuid)
  to service_role;

commit;
