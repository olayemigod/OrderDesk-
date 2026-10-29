begin;

create index if not exists tenants_admin_name_cursor_idx
  on public.tenants(lower(name),id);

create index if not exists outbound_notifications_admin_exception_idx
  on public.outbound_notifications(tenant_id)
  where delivery_status in ('failed','template_required');

create or replace function public.platform_admin_merchant_portfolio(
  p_actor_user_id uuid,
  p_search text default null,
  p_filter text default 'all',
  p_after_name text default null,
  p_after_id uuid default null,
  p_limit integer default 25
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
  v_filter text:=lower(btrim(coalesce(p_filter,'all')));
  v_limit integer:=greatest(1,least(coalesce(p_limit,25),50));
  v_result jsonb;
begin
  select pa.role into v_role
  from public.platform_admins pa
  where pa.user_id=p_actor_user_id;

  if v_role is null then
    raise exception 'Platform administrator access required' using errcode='42501';
  end if;
  if char_length(coalesce(v_search,''))>120 then
    raise exception 'Merchant search is too long' using errcode='22023';
  end if;
  if v_filter not in ('all','attention','connected','restricted') then
    raise exception 'Unsupported merchant filter' using errcode='22023';
  end if;
  if (p_after_name is null)<> (p_after_id is null) then
    raise exception 'Merchant cursor is incomplete' using errcode='22023';
  end if;

  with eligible as materialized (
    select
      t.id,t.name,lower(t.name) sort_name,t.slug,
      t.business_email business_email,t.business_phone business_phone,
      t.onboarding_status,t.whatsapp_connection_status whatsapp_status,
      t.currency,t.created_at,
      coalesce(s.status,t.subscription_status,'unknown') subscription_status,
      s.plan_code,s.current_period_end,
      case
        when s.status='active' then 'full'
        when s.status='trial' and (s.trial_ends_at is null or s.trial_ends_at>now()) then 'full'
        when s.status='grace' and (s.grace_ends_at is null or s.grace_ends_at>now()) then 'full'
        else 'read_only'
      end access_mode,
      exists(
        select 1 from public.orders o
        where o.tenant_id=t.id and o.deleted_at is null and o.status='needs_review'
      ) has_review,
      exists(
        select 1 from public.outbound_notifications n
        where n.tenant_id=t.id and n.delivery_status in ('failed','template_required')
      ) has_notification_exception
    from public.tenants t
    left join public.tenant_subscriptions s on s.tenant_id=t.id
    where v_search is null or position(v_search in lower(concat_ws(' ',t.name,t.slug,t.business_email,t.business_phone,s.plan_code,s.status,t.whatsapp_connection_status)))>0
  ), filtered as materialized (
    select e.*
    from eligible e
    where (p_after_name is null or (e.sort_name,e.id)>(lower(p_after_name),p_after_id))
      and case v_filter
        when 'attention' then e.whatsapp_status='error' or e.access_mode<>'full'
          or e.subscription_status in ('past_due','grace','suspended','cancelled')
          or e.has_review or e.has_notification_exception
        when 'connected' then e.whatsapp_status='connected'
        when 'restricted' then e.access_mode<>'full'
        else true
      end
    order by e.sort_name,e.id
    limit v_limit+1
  ), page as materialized (
    select * from filtered order by sort_name,id limit v_limit
  ), enriched as (
    select
      p.*,
      coalesce(o.completed_orders_30d,0) completed_orders_30d,
      coalesce(o.needs_review,0) needs_review,
      o.last_order_at,
      coalesce(b.total_branches,0) total_branches,
      coalesce(b.active_branches,0) active_branches,
      coalesce(m.team_count,0) team_count,
      coalesce(n.notification_exceptions,0) notification_exceptions,
      a.activated_at,
      array_remove(array[
        case when p.whatsapp_status='error' then 'WhatsApp connection issue' end,
        case when p.access_mode<>'full' then 'Restricted access' end,
        case when p.subscription_status in ('past_due','grace','suspended','cancelled') then 'Commercial access review' end,
        case when coalesce(o.needs_review,0)>0 then 'Orders require review' end,
        case when coalesce(n.notification_exceptions,0)>0 then 'Notification delivery issue' end
      ]::text[],null) attention_reasons
    from page p
    left join lateral (
      select
        count(*) filter(where o.status='completed' and o.created_at>=now()-interval '30 days')::integer completed_orders_30d,
        count(*) filter(where o.status='needs_review')::integer needs_review,
        max(o.created_at) filter(where o.status<>'draft') last_order_at
      from public.orders o
      where o.tenant_id=p.id and o.deleted_at is null
    ) o on true
    left join lateral (
      select count(*)::integer total_branches,count(*) filter(where b.is_active)::integer active_branches
      from public.branches b where b.tenant_id=p.id
    ) b on true
    left join lateral (
      select count(*)::integer team_count from public.tenant_members m where m.tenant_id=p.id
    ) m on true
    left join lateral (
      select count(*)::integer notification_exceptions
      from public.outbound_notifications n
      where n.tenant_id=p.id and n.delivery_status in ('failed','template_required')
    ) n on true
    left join lateral (
      select min(e.effective_from) activated_at
      from public.sellertray_commercial_entitlement_events e
      where e.tenant_id=p.id and e.event_type='installment.provisional_activated'
    ) a on true
  )
  select jsonb_build_object(
    'actorRole',v_role,
    'generatedAt',now(),
    'pageSize',v_limit,
    'items',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',e.id,'name',e.name,'slug',e.slug,
        'businessEmail',e.business_email,'businessPhone',e.business_phone,
        'onboardingStatus',e.onboarding_status,'whatsappStatus',e.whatsapp_status,
        'subscriptionStatus',e.subscription_status,'accessMode',e.access_mode,
        'planCode',e.plan_code,'currentPeriodEnd',e.current_period_end,
        'currency',e.currency,'createdAt',e.created_at,'activatedAt',e.activated_at,
        'completedOrders30d',e.completed_orders_30d,'needsReview',e.needs_review,
        'totalBranches',e.total_branches,'activeBranches',e.active_branches,
        'teamCount',e.team_count,'lastOrderAt',e.last_order_at,
        'notificationExceptions',e.notification_exceptions,
        'attentionReasons',to_jsonb(e.attention_reasons)
      ) order by e.sort_name,e.id) from enriched e
    ),'[]'::jsonb),
    'hasMore',(select count(*)>v_limit from filtered),
    'nextCursor',case when (select count(*)>v_limit from filtered) then (
      select jsonb_build_object('afterName',p.name,'afterId',p.id)
      from page p order by p.sort_name desc,p.id desc limit 1
    ) else null end
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.platform_admin_merchant_detail(
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
  v_merchant jsonb;
  v_branches jsonb;
  v_team jsonb;
  v_performance jsonb;
  v_commercial jsonb;
  v_activity jsonb;
begin
  select pa.role into v_role
  from public.platform_admins pa
  where pa.user_id=p_actor_user_id;

  if v_role is null then
    raise exception 'Platform administrator access required' using errcode='42501';
  end if;

  select jsonb_build_object(
    'id',t.id,'name',t.name,'slug',t.slug,
    'businessEmail',t.business_email,'businessPhone',t.business_phone,
    'businessType',t.business_type,'currency',t.currency,'timezone',t.timezone,
    'createdAt',t.created_at,'updatedAt',t.updated_at,
    'onboardingStatus',t.onboarding_status,'whatsappStatus',t.whatsapp_connection_status,
    'subscriptionStatus',coalesce(s.status,t.subscription_status,'unknown'),
    'planCode',s.plan_code,'planName',p.name,
    'currentPeriodEnd',s.current_period_end,'graceEndsAt',s.grace_ends_at,
    'accessMode',case
      when s.status='active' then 'full'
      when s.status='trial' and (s.trial_ends_at is null or s.trial_ends_at>now()) then 'full'
      when s.status='grace' and (s.grace_ends_at is null or s.grace_ends_at>now()) then 'full'
      else 'read_only'
    end,
    'activatedAt',a.activation_at,'activeUntil',a.active_until,
    'lastInboundAt',(select max(i.received_at) from public.inbound_messages i where i.tenant_id=t.id),
    'supportNote',n.support_note,'supportNoteUpdatedAt',n.updated_at,
    'attentionReasons',to_jsonb(array_remove(array[
      case when t.whatsapp_connection_status='error' then 'WhatsApp connection issue' end,
      case when not coalesce(s.status='active' or (s.status='trial' and (s.trial_ends_at is null or s.trial_ends_at>now())) or (s.status='grace' and (s.grace_ends_at is null or s.grace_ends_at>now())),false) then 'Restricted access' end,
      case when coalesce(s.status,t.subscription_status) in ('past_due','grace','suspended','cancelled') then 'Commercial access review' end,
      case when exists(select 1 from public.orders o where o.tenant_id=t.id and o.deleted_at is null and o.status='needs_review') then 'Orders require review' end,
      case when exists(select 1 from public.outbound_notifications x where x.tenant_id=t.id and x.delivery_status in ('failed','template_required')) then 'Notification delivery issue' end
    ]::text[],null))
  ) into v_merchant
  from public.tenants t
  left join public.tenant_subscriptions s on s.tenant_id=t.id
  left join public.subscription_plans p on p.code=s.plan_code
  left join public.tenant_admin_notes n on n.tenant_id=t.id
  left join lateral (
    select min(e.effective_from) activation_at,max(e.effective_until) active_until
    from public.sellertray_commercial_entitlement_events e
    where e.tenant_id=t.id and e.event_type in ('installment.provisional_activated','installment.full_entitlement_released')
  ) a on true
  where t.id=p_tenant_id;

  if v_merchant is null then
    raise exception 'Merchant not found' using errcode='P0002';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',b.id,'code',b.code,'name',b.name,'active',b.is_active,'default',b.is_default
  ) order by b.is_default desc,b.name,b.id),'[]'::jsonb)
  into v_branches
  from public.branches b where b.tenant_id=p_tenant_id;

  select jsonb_build_object(
    'total',count(*)::integer,
    'owners',count(*) filter(where m.role='owner')::integer,
    'managers',count(*) filter(where m.role='manager')::integer,
    'cashiers',count(*) filter(where m.role='staff')::integer
  ) into v_team
  from public.tenant_members m where m.tenant_id=p_tenant_id;

  with completed as materialized (
    select o.* from public.orders o
    where o.tenant_id=p_tenant_id and o.deleted_at is null and o.status='completed'
      and o.created_at>=now()-interval '30 days'
  ), money as (
    select o.currency,
      coalesce(sum(o.total_amount),0)::numeric merchant_gmv,
      coalesce(sum(o.amount_paid),0)::numeric recorded_paid_value,
      coalesce(sum(greatest(coalesce(o.total_amount,0)-coalesce(o.amount_paid,0),0)),0)::numeric outstanding_order_value
    from completed o group by o.currency
  )
  select jsonb_build_object(
    'periodDays',30,
    'completedOrders',(select count(*)::integer from completed),
    'whatsappOrders',(select count(*)::integer from completed where source='whatsapp'),
    'posOrders',(select count(*)::integer from completed where source='pos'),
    'manualOrders',(select count(*)::integer from completed where source='manual'),
    'lastOrderAt',(select max(o.created_at) from public.orders o where o.tenant_id=p_tenant_id and o.deleted_at is null and o.status<>'draft'),
    'lastCompletedAt',(select max(created_at) from completed),
    'money',coalesce((select jsonb_agg(jsonb_build_object(
      'currency',m.currency,'merchantGmv',m.merchant_gmv,
      'recordedPaidValue',m.recorded_paid_value,'outstandingOrderValue',m.outstanding_order_value
    ) order by m.currency) from money m),'[]'::jsonb)
  ) into v_performance;

  select jsonb_build_object(
    'commercialOrders',(select count(*)::integer from public.sellertray_commercial_orders o where o.tenant_id=p_tenant_id),
    'latestCommercialOrderAt',(select max(o.ordered_at) from public.sellertray_commercial_orders o where o.tenant_id=p_tenant_id),
    'agreementsIssued',(select count(*)::integer from public.sellertray_commercial_agreements a where a.tenant_id=p_tenant_id),
    'agreementsAccepted',(select count(*)::integer from public.sellertray_commercial_agreement_acceptances a where a.tenant_id=p_tenant_id),
    'setupRequired',(select count(*)::integer from public.sellertray_commercial_order_price_snapshots s where s.tenant_id=p_tenant_id and s.line_type='branch_setup'),
    'setupReady',(select count(*)::integer from public.sellertray_commercial_branch_setup_readiness r where r.tenant_id=p_tenant_id)
  ) into v_commercial;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',a.id,'action',a.action,'createdAt',a.created_at
  ) order by a.created_at desc,a.id desc),'[]'::jsonb)
  into v_activity
  from (
    select x.id,x.action,x.created_at
    from public.platform_admin_audit x
    where x.tenant_id=p_tenant_id
    order by x.created_at desc,x.id desc
    limit 10
  ) a;

  return jsonb_build_object(
    'actorRole',v_role,'generatedAt',now(),'merchant',v_merchant,
    'branches',v_branches,'team',v_team,'performance',v_performance,
    'commercial',v_commercial,'recentAdminActivity',v_activity
  );
end;
$$;

revoke all on function public.platform_admin_merchant_portfolio(uuid,text,text,text,uuid,integer)
  from public,anon,authenticated;
revoke all on function public.platform_admin_merchant_detail(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.platform_admin_merchant_portfolio(uuid,text,text,text,uuid,integer)
  to service_role;
grant execute on function public.platform_admin_merchant_detail(uuid,uuid)
  to service_role;

commit;
