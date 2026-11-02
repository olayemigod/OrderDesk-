begin;

-- SellerTray C2-5 — shared Branch entitlement resolver
--
-- This resolver is the canonical C2 read authority for Branch Plan Profile
-- entitlements. It remains parallel to the live Business-level runtime until
-- C2-10. No existing operational command is switched to it in this migration.

create or replace function public.sellertray_branch_subscription_effective_status(
  p_branch_subscription_id uuid,
  p_as_of timestamptz
)
returns text
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  v_subscription public.sellertray_branch_subscriptions%rowtype;
  v_event_type text;
  v_status text;
begin
  if p_branch_subscription_id is null or p_as_of is null then
    return null;
  end if;

  select s.* into v_subscription
  from public.sellertray_branch_subscriptions s
  where s.id=p_branch_subscription_id;
  if not found then return null; end if;

  select e.event_type into v_event_type
  from public.sellertray_branch_subscription_events e
  where e.branch_subscription_id=p_branch_subscription_id
    and e.effective_at<=p_as_of
  order by e.effective_at desc,e.recorded_at desc,e.id desc
  limit 1;

  if not found then return 'not_started'; end if;

  v_status:=case v_event_type
    when 'created' then 'pending'
    when 'provisional_activated' then 'provisional'
    when 'activated' then 'active'
    when 'resumed' then 'active'
    when 'suspended' then 'suspended'
    when 'expired' then 'expired'
    when 'cancelled' then 'cancelled'
    else 'pending'
  end;

  if v_status in ('provisional','active','suspended') then
    if v_subscription.entitlement_period_start is not null
       and p_as_of<v_subscription.entitlement_period_start then
      return 'not_started';
    end if;
    if v_subscription.entitlement_period_end is not null
       and p_as_of>=v_subscription.entitlement_period_end then
      return 'expired';
    end if;
  end if;

  return v_status;
end;
$function$;

revoke all on function public.sellertray_branch_subscription_effective_status(uuid,timestamptz)
  from public,anon,authenticated;
grant execute on function public.sellertray_branch_subscription_effective_status(uuid,timestamptz)
  to service_role;

create or replace function public.resolve_sellertray_branch_entitlement(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_as_of timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  v_user_id uuid:=(select auth.uid());
  v_auth_role text:=coalesce((select auth.role()),'');
  v_branch public.branches%rowtype;
  v_subscription public.sellertray_branch_subscriptions%rowtype;
  v_plan_version public.sellertray_plan_profile_versions%rowtype;
  v_plan public.sellertray_plan_profiles%rowtype;
  v_effective_status text;
  v_access_mode text;
  v_candidate_count integer:=0;
  v_features jsonb:='[]'::jsonb;
  v_capabilities jsonb:='[]'::jsonb;
  v_limits jsonb:='[]'::jsonb;
  v_addons jsonb:='[]'::jsonb;
  v_legacy_access jsonb;
  v_legacy_can_write boolean:=false;
  v_resolution_mode text:='legacy_compatibility_only';
begin
  if p_tenant_id is null or p_branch_id is null or p_as_of is null then
    raise exception 'Business, Branch and resolution time are required' using errcode='22023';
  end if;

  if session_user not in ('postgres','supabase_admin') and v_auth_role<>'service_role' then
    if v_user_id is null or not public.sellertray_user_can_read_branch(p_tenant_id,p_branch_id,v_user_id) then
      raise exception 'SellerTray Branch read access required' using errcode='42501';
    end if;
  end if;

  select b.* into strict v_branch
  from public.branches b
  where b.tenant_id=p_tenant_id and b.id=p_branch_id;

  -- A currently entitled/suspended term is authoritative when exactly one term
  -- covers the requested time. Multiple covering terms are a data-integrity
  -- error and fail closed rather than choosing one arbitrarily.
  select count(*)::integer into v_candidate_count
  from public.sellertray_branch_subscriptions s
  where s.tenant_id=p_tenant_id and s.branch_id=p_branch_id
    and s.entitlement_period_start is not null
    and s.entitlement_period_end is not null
    and s.entitlement_period_start<=p_as_of
    and s.entitlement_period_end>p_as_of
    and public.sellertray_branch_subscription_effective_status(s.id,p_as_of)
        in ('provisional','active','suspended');

  if v_candidate_count>1 then
    raise exception 'Multiple SellerTray Branch Subscription terms cover the same Branch and time' using errcode='23505';
  end if;

  if v_candidate_count=1 then
    select s.* into strict v_subscription
    from public.sellertray_branch_subscriptions s
    where s.tenant_id=p_tenant_id and s.branch_id=p_branch_id
      and s.entitlement_period_start<=p_as_of
      and s.entitlement_period_end>p_as_of
      and public.sellertray_branch_subscription_effective_status(s.id,p_as_of)
          in ('provisional','active','suspended')
    order by s.entitlement_period_start desc,s.committed_at desc,s.id
    limit 1;
    v_resolution_mode:='c2_branch_subscription';
  else
    -- During preparation there may be a pending future/current commitment.
    select s.* into v_subscription
    from public.sellertray_branch_subscriptions s
    where s.tenant_id=p_tenant_id and s.branch_id=p_branch_id
      and s.committed_at<=p_as_of
      and public.sellertray_branch_subscription_effective_status(s.id,p_as_of)='pending'
    order by s.committed_at desc,s.created_at desc,s.id desc
    limit 1;

    if found then
      v_resolution_mode:='c2_preparation';
    else
      -- Historical read fallback: return the latest C2 term without granting
      -- current entitlement. Before C2-10, no C2 row means legacy-only mode.
      select s.* into v_subscription
      from public.sellertray_branch_subscriptions s
      where s.tenant_id=p_tenant_id and s.branch_id=p_branch_id
        and s.committed_at<=p_as_of
      order by coalesce(s.entitlement_period_start,s.committed_at) desc,s.created_at desc,s.id desc
      limit 1;
      if found then v_resolution_mode:='c2_historical'; end if;
    end if;
  end if;

  begin
    v_legacy_can_write:=public.orderdesk_subscription_can_write(p_tenant_id);
    v_legacy_access:=public.get_orderdesk_subscription_access(p_tenant_id);
  exception when others then
    -- Compatibility visibility must never manufacture C2 entitlement. A legacy
    -- read failure is represented explicitly and does not change C2 resolution.
    v_legacy_can_write:=false;
    v_legacy_access:=null;
  end;

  if v_subscription.id is null then
    return jsonb_build_object(
      'tenantId',p_tenant_id,
      'branchId',p_branch_id,
      'branchName',v_branch.name,
      'branchActive',v_branch.is_active,
      'runtimeCutoverActive',false,
      'resolutionMode','legacy_compatibility_only',
      'subscriptionFound',false,
      'effectiveStatus','none',
      'accessMode','unresolved',
      'features','[]'::jsonb,
      'capabilities','[]'::jsonb,
      'limits','[]'::jsonb,
      'addons','[]'::jsonb,
      'legacyCompatibility',jsonb_build_object(
        'canWrite',v_legacy_can_write,
        'access',v_legacy_access
      ),
      'resolvedAt',p_as_of
    );
  end if;

  select v.* into strict v_plan_version
  from public.sellertray_plan_profile_versions v
  where v.id=v_subscription.plan_profile_version_id;
  select p.* into strict v_plan
  from public.sellertray_plan_profiles p
  where p.id=v_plan_version.plan_profile_id;

  v_effective_status:=public.sellertray_branch_subscription_effective_status(v_subscription.id,p_as_of);
  v_access_mode:=case
    when not v_branch.is_active then 'read_only'
    when v_effective_status in ('provisional','active') then 'full'
    when v_effective_status in ('pending','not_started') then 'preparation'
    else 'read_only'
  end;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'code',f.code,
      'displayName',f.display_name,
      'catalogueStatus',f.status,
      'configuredEnabled',x.configured_enabled,
      'effectiveEnabled',(x.configured_enabled and v_access_mode='full'),
      'planGranted',x.plan_enabled,
      'addonGranted',x.addon_enabled,
      'overridden',x.override_enabled is not null,
      'overrideEnabled',x.override_enabled
    ) order by f.code
  ),'[]'::jsonb) into v_features
  from (
    with plan_grants as (
      select g.feature_code,bool_or(g.enabled) as enabled
      from public.sellertray_plan_profile_feature_grants g
      where g.plan_profile_version_id=v_subscription.plan_profile_version_id
      group by g.feature_code
    ),
    addon_grants as (
      select g.feature_code,bool_or(g.enabled) as enabled
      from public.sellertray_branch_subscription_addons ba
      join public.sellertray_addon_feature_grants g on g.addon_version_id=ba.addon_version_id
      where ba.tenant_id=p_tenant_id
        and ba.branch_subscription_id=v_subscription.id
        and ba.entitlement_from<=p_as_of and ba.entitlement_until>p_as_of
      group by g.feature_code
    ),
    overrides as (
      select distinct on (o.feature_code) o.feature_code,o.enabled
      from public.sellertray_commercial_entitlement_override_versions o
      where o.tenant_id=p_tenant_id
        and o.plan_profile_version_id=v_subscription.plan_profile_version_id
        and o.override_kind='feature'
        and o.effective_from<=p_as_of
        and (o.effective_until is null or o.effective_until>p_as_of)
      order by o.feature_code,o.effective_from desc,o.created_at desc,o.id desc
    ),
    codes as (
      select feature_code from plan_grants
      union select feature_code from addon_grants
      union select feature_code from overrides
    )
    select c.feature_code,
           coalesce(pg.enabled,false) as plan_enabled,
           coalesce(ag.enabled,false) as addon_enabled,
           ov.enabled as override_enabled,
           coalesce(ov.enabled,(coalesce(pg.enabled,false) or coalesce(ag.enabled,false)),false) as configured_enabled
    from codes c
    left join plan_grants pg on pg.feature_code=c.feature_code
    left join addon_grants ag on ag.feature_code=c.feature_code
    left join overrides ov on ov.feature_code=c.feature_code
  ) x
  join public.sellertray_feature_catalogue f on f.code=x.feature_code;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'code',c.code,
      'displayName',c.display_name,
      'featureCode',c.feature_code,
      'catalogueStatus',c.status,
      'legacyPermissionCode',c.legacy_permission_code,
      'configuredEnabled',x.configured_enabled,
      'effectiveEnabled',(x.configured_enabled and v_access_mode='full'),
      'planGranted',x.plan_enabled,
      'addonGranted',x.addon_enabled,
      'overridden',x.override_enabled is not null,
      'overrideEnabled',x.override_enabled
    ) order by c.code
  ),'[]'::jsonb) into v_capabilities
  from (
    with plan_grants as (
      select g.capability_code,bool_or(g.enabled) as enabled
      from public.sellertray_plan_profile_capability_grants g
      where g.plan_profile_version_id=v_subscription.plan_profile_version_id
      group by g.capability_code
    ),
    addon_grants as (
      select g.capability_code,bool_or(g.enabled) as enabled
      from public.sellertray_branch_subscription_addons ba
      join public.sellertray_addon_capability_grants g on g.addon_version_id=ba.addon_version_id
      where ba.tenant_id=p_tenant_id
        and ba.branch_subscription_id=v_subscription.id
        and ba.entitlement_from<=p_as_of and ba.entitlement_until>p_as_of
      group by g.capability_code
    ),
    overrides as (
      select distinct on (o.capability_code) o.capability_code,o.enabled
      from public.sellertray_commercial_entitlement_override_versions o
      where o.tenant_id=p_tenant_id
        and o.plan_profile_version_id=v_subscription.plan_profile_version_id
        and o.override_kind='capability'
        and o.effective_from<=p_as_of
        and (o.effective_until is null or o.effective_until>p_as_of)
      order by o.capability_code,o.effective_from desc,o.created_at desc,o.id desc
    ),
    codes as (
      select capability_code from plan_grants
      union select capability_code from addon_grants
      union select capability_code from overrides
    )
    select x.capability_code,
           coalesce(pg.enabled,false) as plan_enabled,
           coalesce(ag.enabled,false) as addon_enabled,
           ov.enabled as override_enabled,
           coalesce(ov.enabled,(coalesce(pg.enabled,false) or coalesce(ag.enabled,false)),false) as configured_enabled
    from codes x
    left join plan_grants pg on pg.capability_code=x.capability_code
    left join addon_grants ag on ag.capability_code=x.capability_code
    left join overrides ov on ov.capability_code=x.capability_code
  ) x
  join public.sellertray_capability_catalogue c on c.code=x.capability_code;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'code',d.code,
      'displayName',d.display_name,
      'unitCode',d.unit_code,
      'scopeKind',d.scope_kind,
      'definitionStatus',d.status,
      'meterCode',d.meter_code,
      'isUnlimited',x.final_unlimited,
      'limitValue',case when x.final_unlimited then null else x.final_value end,
      'enforcementMode',x.enforcement_mode,
      'usage',null,
      'available',null,
      'usageState',case when x.final_unlimited then 'unlimited' when d.meter_code is null then 'meter_unbound' else 'branch_meter_not_connected' end,
      'enforcementReady',x.final_unlimited,
      'overridden',x.override_present,
      'addonDelta',x.addon_delta
    ) order by d.code
  ),'[]'::jsonb) into v_limits
  from (
    with plan_limits as (
      select g.limit_code,g.limit_value,g.is_unlimited,g.enforcement_mode
      from public.sellertray_plan_profile_limit_values g
      where g.plan_profile_version_id=v_subscription.plan_profile_version_id
    ),
    addon_limits as (
      select g.limit_code,
             coalesce(sum(g.limit_delta) filter (where not g.is_unlimited),0)::numeric as limit_delta,
             coalesce(bool_or(g.is_unlimited),false) as is_unlimited
      from public.sellertray_branch_subscription_addons ba
      join public.sellertray_addon_limit_values g on g.addon_version_id=ba.addon_version_id
      where ba.tenant_id=p_tenant_id
        and ba.branch_subscription_id=v_subscription.id
        and ba.entitlement_from<=p_as_of and ba.entitlement_until>p_as_of
      group by g.limit_code
    ),
    overrides as (
      select distinct on (o.limit_code) o.limit_code,o.limit_value,coalesce(o.is_unlimited,false) as is_unlimited
      from public.sellertray_commercial_entitlement_override_versions o
      where o.tenant_id=p_tenant_id
        and o.plan_profile_version_id=v_subscription.plan_profile_version_id
        and o.override_kind='limit'
        and o.effective_from<=p_as_of
        and (o.effective_until is null or o.effective_until>p_as_of)
      order by o.limit_code,o.effective_from desc,o.created_at desc,o.id desc
    ),
    codes as (
      select limit_code from plan_limits
      union select limit_code from addon_limits
      union select limit_code from overrides
    )
    select c.limit_code,
           coalesce(pl.enforcement_mode,'hard') as enforcement_mode,
           coalesce(al.limit_delta,0)::numeric as addon_delta,
           (ov.limit_code is not null) as override_present,
           case
             when ov.limit_code is not null then ov.is_unlimited
             else coalesce(pl.is_unlimited,false) or coalesce(al.is_unlimited,false)
           end as final_unlimited,
           case
             when ov.limit_code is not null then ov.limit_value
             else coalesce(pl.limit_value,0)+coalesce(al.limit_delta,0)
           end as final_value
    from codes c
    left join plan_limits pl on pl.limit_code=c.limit_code
    left join addon_limits al on al.limit_code=c.limit_code
    left join overrides ov on ov.limit_code=c.limit_code
  ) x
  join public.sellertray_limit_definitions d on d.code=x.limit_code;

  select coalesce(jsonb_agg(jsonb_build_object(
    'assignmentId',ba.id,
    'addonVersionId',ba.addon_version_id,
    'addonCode',ad.code,
    'displayName',av.display_name,
    'billingCycle',ba.billing_cycle,
    'entitlementFrom',ba.entitlement_from,
    'entitlementUntil',ba.entitlement_until
  ) order by ad.code,ba.entitlement_from),'[]'::jsonb)
  into v_addons
  from public.sellertray_branch_subscription_addons ba
  join public.sellertray_addon_versions av on av.id=ba.addon_version_id
  join public.sellertray_addon_definitions ad on ad.id=av.addon_definition_id
  where ba.tenant_id=p_tenant_id
    and ba.branch_subscription_id=v_subscription.id
    and ba.entitlement_from<=p_as_of and ba.entitlement_until>p_as_of;

  return jsonb_build_object(
    'tenantId',p_tenant_id,
    'branchId',p_branch_id,
    'branchName',v_branch.name,
    'branchActive',v_branch.is_active,
    'runtimeCutoverActive',false,
    'resolutionMode',v_resolution_mode,
    'subscriptionFound',true,
    'branchSubscriptionId',v_subscription.id,
    'subscriptionLifecycleStatus',v_subscription.lifecycle_status,
    'effectiveStatus',v_effective_status,
    'accessMode',v_access_mode,
    'planProfileId',v_plan.id,
    'planProfileCode',v_plan.code,
    'planProfileVersionId',v_plan_version.id,
    'planProfileVersion',v_plan_version.version,
    'planName',v_plan_version.display_name,
    'billingCycle',v_subscription.billing_cycle,
    'committedAt',v_subscription.committed_at,
    'activatedAt',v_subscription.activated_at,
    'entitlementPeriodStart',v_subscription.entitlement_period_start,
    'entitlementPeriodEnd',v_subscription.entitlement_period_end,
    'expectedFullTermEnd',v_subscription.expected_full_term_end,
    'nextRenewalAt',v_subscription.entitlement_period_end,
    'setupRequired',v_subscription.setup_required,
    'setupReady',not v_subscription.setup_required or v_subscription.setup_readiness_id is not null,
    'settlementQualified',v_subscription.settlement_qualified_at is not null,
    'fullySettled',v_subscription.fully_settled_at is not null,
    'masterAgreementRequired',v_subscription.required_master_agreement_version_id is not null,
    'masterAgreementAccepted',v_subscription.required_master_agreement_version_id is null or v_subscription.master_agreement_acceptance_id is not null,
    'orderFormId',v_subscription.order_form_id,
    'guaranteeStatus',v_subscription.guarantee_status,
    'guaranteeStartedAt',v_subscription.guarantee_started_at,
    'guaranteeEndsAt',v_subscription.guarantee_ends_at,
    'features',v_features,
    'capabilities',v_capabilities,
    'limits',v_limits,
    'addons',v_addons,
    'legacyCompatibility',jsonb_build_object(
      'canWrite',v_legacy_can_write,
      'access',v_legacy_access
    ),
    'resolvedAt',p_as_of
  );
end;
$function$;

revoke all on function public.resolve_sellertray_branch_entitlement(uuid,uuid,timestamptz)
  from public,anon;
grant execute on function public.resolve_sellertray_branch_entitlement(uuid,uuid,timestamptz)
  to authenticated,service_role;

create or replace function public.sellertray_branch_plan_allows_feature(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_feature_code text,
  p_as_of timestamptz
)
returns boolean
language sql
stable
security definer
set search_path=''
as $function$
  select coalesce((
    select (f->>'effectiveEnabled')::boolean
    from jsonb_array_elements(
      coalesce(public.resolve_sellertray_branch_entitlement(p_tenant_id,p_branch_id,p_as_of)->'features','[]'::jsonb)
    ) f
    where f->>'code'=p_feature_code
    limit 1
  ),false);
$function$;

create or replace function public.sellertray_branch_plan_allows_capability(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_capability_code text,
  p_as_of timestamptz
)
returns boolean
language sql
stable
security definer
set search_path=''
as $function$
  select coalesce((
    select (c->>'effectiveEnabled')::boolean
    from jsonb_array_elements(
      coalesce(public.resolve_sellertray_branch_entitlement(p_tenant_id,p_branch_id,p_as_of)->'capabilities','[]'::jsonb)
    ) c
    where c->>'code'=p_capability_code
    limit 1
  ),false);
$function$;

revoke all on function public.sellertray_branch_plan_allows_feature(uuid,uuid,text,timestamptz)
  from public,anon;
revoke all on function public.sellertray_branch_plan_allows_capability(uuid,uuid,text,timestamptz)
  from public,anon;
grant execute on function public.sellertray_branch_plan_allows_feature(uuid,uuid,text,timestamptz)
  to authenticated,service_role;
grant execute on function public.sellertray_branch_plan_allows_capability(uuid,uuid,text,timestamptz)
  to authenticated,service_role;

create or replace function public.get_sellertray_business_branch_subscription_summary(
  p_tenant_id uuid,
  p_as_of timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  v_user_id uuid:=(select auth.uid());
  v_auth_role text:=coalesce((select auth.role()),'');
  v_member_role text;
  v_branches jsonb:='[]'::jsonb;
  v_total integer:=0;
  v_c2 integer:=0;
  v_entitled integer:=0;
  v_pending integer:=0;
  v_suspended integer:=0;
  v_expired integer:=0;
  v_unprovisioned integer:=0;
  v_nearest timestamptz;
begin
  if p_tenant_id is null or p_as_of is null then
    raise exception 'Business and resolution time are required' using errcode='22023';
  end if;

  if session_user not in ('postgres','supabase_admin') and v_auth_role<>'service_role' then
    select tm.role into v_member_role
    from public.tenant_members tm
    where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;
    if v_member_role not in ('owner','manager') then
      raise exception 'Branch subscription summary requires an Owner or Manager' using errcode='42501';
    end if;
  end if;

  with resolved as (
    select b.id,b.name,b.code,b.is_active,
           public.resolve_sellertray_branch_entitlement(p_tenant_id,b.id,p_as_of) as entitlement
    from public.branches b
    where b.tenant_id=p_tenant_id
  )
  select
    count(*)::integer,
    count(*) filter (where (entitlement->>'subscriptionFound')::boolean)::integer,
    count(*) filter (where entitlement->>'effectiveStatus' in ('provisional','active'))::integer,
    count(*) filter (where entitlement->>'effectiveStatus' in ('pending','not_started'))::integer,
    count(*) filter (where entitlement->>'effectiveStatus'='suspended')::integer,
    count(*) filter (where entitlement->>'effectiveStatus'='expired')::integer,
    count(*) filter (where not (entitlement->>'subscriptionFound')::boolean)::integer,
    min(nullif(entitlement->>'nextRenewalAt','')::timestamptz) filter (
      where entitlement->>'effectiveStatus' in ('provisional','active')
        and nullif(entitlement->>'nextRenewalAt','')::timestamptz>p_as_of
    ),
    coalesce(jsonb_agg(jsonb_build_object(
      'branchId',id,
      'branchName',name,
      'branchCode',code,
      'branchActive',is_active,
      'subscription',entitlement
    ) order by name,id),'[]'::jsonb)
  into v_total,v_c2,v_entitled,v_pending,v_suspended,v_expired,v_unprovisioned,v_nearest,v_branches
  from resolved;

  return jsonb_build_object(
    'tenantId',p_tenant_id,
    'isAggregateOnly',true,
    'runtimeCutoverActive',false,
    'branchCount',v_total,
    'c2SubscriptionCount',v_c2,
    'entitledBranchCount',v_entitled,
    'pendingBranchCount',v_pending,
    'suspendedBranchCount',v_suspended,
    'expiredBranchCount',v_expired,
    'unprovisionedBranchCount',v_unprovisioned,
    'nearestRenewalAt',v_nearest,
    'branches',v_branches,
    'resolvedAt',p_as_of
  );
end;
$function$;

revoke all on function public.get_sellertray_business_branch_subscription_summary(uuid,timestamptz)
  from public,anon;
grant execute on function public.get_sellertray_business_branch_subscription_summary(uuid,timestamptz)
  to authenticated,service_role;

commit;
