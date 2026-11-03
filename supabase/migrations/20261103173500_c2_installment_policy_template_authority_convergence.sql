begin;

-- SellerTray C2-6/C2-7 forward-only installment policy convergence.
-- Keep C1/OA2 policies and accepted history intact. C2 uses the same policy
-- version store with an explicit context and an immutable allowed-template set.
-- No existing published version, accepted agreement or confirmed payment is modified.

alter table public.sellertray_installment_policy_versions
  add column if not exists policy_context text not null default 'legacy',
  add column if not exists publish_command_id uuid,
  add column if not exists publish_request_fingerprint text;

alter table public.sellertray_installment_policy_versions
  add constraint sellertray_installment_policy_context_check
    check (policy_context in ('legacy','branch_commercial_v2')),
  add constraint sellertray_installment_policy_v2_default_check
    check (policy_context<>'branch_commercial_v2' or default_template_id is not null),
  add constraint sellertray_installment_policy_v2_publication_check
    check (policy_context<>'branch_commercial_v2' or
      (publish_command_id is not null and publish_request_fingerprint is not null)
      or change_reason like 'C2 seed:%');

create unique index sellertray_installment_policy_v2_publish_command_key
  on public.sellertray_installment_policy_versions(publish_command_id)
  where publish_command_id is not null;

create table public.sellertray_installment_policy_allowed_templates(
  policy_version_id uuid not null
    references public.sellertray_installment_policy_versions(id) on delete restrict,
  template_id uuid not null
    references public.sellertray_installment_schedule_templates(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key(policy_version_id,template_id)
);

alter table public.sellertray_installment_policy_allowed_templates enable row level security;
revoke all on public.sellertray_installment_policy_allowed_templates from public,anon,authenticated;
grant select on public.sellertray_installment_policy_allowed_templates to service_role;

create trigger prevent_sellertray_installment_policy_allowed_template_mutation
before update or delete on public.sellertray_installment_policy_allowed_templates
for each row execute function public.prevent_sellertray_commercial_history_mutation();

create or replace function public.validate_sellertray_installment_allowed_template()
returns trigger
language plpgsql set search_path=''
as $function$
declare
  v_policy public.sellertray_installment_policy_versions%rowtype;
  v_template public.sellertray_installment_schedule_templates%rowtype;
begin
  select p.* into strict v_policy from public.sellertray_installment_policy_versions p
  where p.id=new.policy_version_id;
  select t.* into strict v_template from public.sellertray_installment_schedule_templates t
  where t.id=new.template_id;
  if v_policy.policy_context<>'branch_commercial_v2' or not v_policy.enabled
     or v_policy.default_template_id=new.template_id
     or v_template.status<>'published' or v_template.effective_from>v_policy.effective_from
     or (v_template.effective_until is not null and v_template.effective_until<=v_policy.effective_from) then
    raise exception 'Allowed alternative must be a distinct, effective published template on an enabled C2 policy'
      using errcode='23514';
  end if;
  return new;
end;
$function$;

revoke all on function public.validate_sellertray_installment_allowed_template()
  from public,anon,authenticated;

create trigger validate_sellertray_installment_allowed_template
before insert on public.sellertray_installment_policy_allowed_templates
for each row execute function public.validate_sellertray_installment_allowed_template();

-- Seed 100 percent upfront as a governed *identifier*, not a semantic code path.
-- C1 keeps its own legacy policy rows and resolution behavior.
insert into public.sellertray_installment_policy_versions(
  scope_kind,billing_cycle,enabled,default_template_id,effective_from,
  change_reason,policy_context
)
select 'platform',cycles.cycle,cycles.enabled,t.id,'2026-11-02T00:00:00Z',
       'C2 seed: 100 percent upfront is the configured default for Branch purchases',
       'branch_commercial_v2'
from (values ('monthly'::text,false),('yearly'::text,true)) cycles(cycle,enabled)
cross join public.sellertray_installment_schedule_templates t
where t.template_code='full_payment_100' and t.version=1;

insert into public.sellertray_installment_policy_allowed_templates(policy_version_id,template_id)
select p.id,t.id
from public.sellertray_installment_policy_versions p
join public.sellertray_installment_schedule_templates t
  on t.template_code in ('two_installment_70_30','three_installment_60_20_20') and t.version=1
where p.policy_context='branch_commercial_v2' and p.scope_kind='platform'
  and p.billing_cycle='yearly' and p.change_reason like 'C2 seed:%';

create or replace function public.sellertray_c2_installment_template_allowed(
  p_policy jsonb,
  p_template_id uuid
)
returns boolean
language sql
stable
set search_path=''
as $function$
  select p_template_id is not null and p_policy is not null
    and (
      p_template_id=nullif(p_policy->>'defaultTemplateId','')::uuid
      or (
        coalesce((p_policy->>'enabled')::boolean,false)
        and exists(
          select 1 from jsonb_array_elements_text(coalesce(p_policy->'allowedAlternativeTemplateIds','[]'::jsonb)) a(template_id)
          where a.template_id=p_template_id::text
        )
      )
    );
$function$;

revoke all on function public.sellertray_c2_installment_template_allowed(jsonb,uuid)
  from public,anon,authenticated;
grant execute on function public.sellertray_c2_installment_template_allowed(jsonb,uuid)
  to service_role;

create or replace function public.resolve_sellertray_installment_policy(
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_plan_code text,
  p_billing_cycle text,
  p_as_of timestamptz default now()
)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  with candidates as (
    select p.*,
      case p.scope_kind
        when 'commercial_order' then 400
        when 'tenant' then 300
        when 'plan_cycle' then 200
        else 100
      end as precedence
    from public.sellertray_installment_policy_versions p
    where p.policy_context='legacy' and p.effective_from <= p_as_of
      and (p.effective_until is null or p.effective_until > p_as_of)
      and (
        (p.scope_kind='commercial_order' and p.tenant_id=p_tenant_id and p.commercial_order_id=p_commercial_order_id)
        or (p.scope_kind='tenant' and p.tenant_id=p_tenant_id and p.billing_cycle=p_billing_cycle)
        or (p.scope_kind='plan_cycle' and p.plan_code=p_plan_code and p.billing_cycle=p_billing_cycle)
        or (p.scope_kind='platform' and p.billing_cycle=p_billing_cycle)
      )
  )
  select jsonb_build_object(
    'policyVersionId',c.id,
    'scopeKind',c.scope_kind,
    'enabled',c.enabled,
    'defaultTemplateId',c.default_template_id,
    'effectiveFrom',c.effective_from,
    'effectiveUntil',c.effective_until
  )
  from candidates c
  order by c.precedence desc,c.effective_from desc,c.created_at desc
  limit 1;
$$;

create or replace function public.resolve_sellertray_installment_policy_v2(
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_plan_profile_version_id uuid,
  p_billing_cycle text,
  p_as_of timestamptz default now()
)
returns jsonb
language sql
stable
security definer
set search_path=''
as $function$
  with candidates as (
    select p.*,
      case p.scope_kind
        when 'commercial_order' then 400
        when 'tenant' then 300
        when 'plan_profile_cycle' then 200
        else 100
      end as precedence
    from public.sellertray_installment_policy_versions p
    where p.policy_context='branch_commercial_v2' and p.effective_from<=p_as_of and (p.effective_until is null or p.effective_until>p_as_of)
      and (
        (p.scope_kind='commercial_order' and p.tenant_id=p_tenant_id and p.commercial_order_id=p_commercial_order_id)
        or (p.scope_kind='tenant' and p.tenant_id=p_tenant_id and p.billing_cycle=p_billing_cycle)
        or (p.scope_kind='plan_profile_cycle' and p.plan_profile_version_id=p_plan_profile_version_id and p.billing_cycle=p_billing_cycle)
        or (p.scope_kind='platform' and p.billing_cycle=p_billing_cycle)
      )
  )
  select jsonb_build_object(
    'policyVersionId',c.id,'scopeKind',c.scope_kind,'enabled',c.enabled,
    'defaultTemplateId',c.default_template_id,
    'allowedAlternativeTemplateIds',coalesce((select jsonb_agg(a.template_id order by a.template_id)
      from public.sellertray_installment_policy_allowed_templates a
      where a.policy_version_id=c.id),'[]'::jsonb),
    'planProfileVersionId',c.plan_profile_version_id,
    'effectiveFrom',c.effective_from,'effectiveUntil',c.effective_until
  )
  from candidates c
  order by c.precedence desc,c.effective_from desc,c.created_at desc,c.id desc
  limit 1;
$function$;

-- The only application-facing write command for new C2 policy versions.
-- Admin transport must separately enforce authenticated ProcessEdge identity and AAL2.
create or replace function public.publish_sellertray_installment_policy_v2_admin(
  p_scope_kind text,
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_plan_profile_version_id uuid,
  p_billing_cycle text,
  p_enabled boolean,
  p_default_template_id uuid,
  p_allowed_alternative_template_ids uuid[],
  p_effective_from timestamptz,
  p_effective_until timestamptz,
  p_reason text,
  p_actor_user_id uuid,
  p_command_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_scope text:=lower(btrim(coalesce(p_scope_kind,'')));
  v_cycle text:=lower(btrim(coalesce(p_billing_cycle,'')));
  v_reason text:=btrim(coalesce(p_reason,''));
  v_alternatives uuid[]:=coalesce(p_allowed_alternative_template_ids,'{}'::uuid[]);
  v_default public.sellertray_installment_schedule_templates%rowtype;
  v_id uuid;
  v_fingerprint text;
  v_existing public.sellertray_installment_policy_versions%rowtype;
begin
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.installments.manage',p_tenant_id,now()) then
    raise exception 'Installment policy management capability required' using errcode='42501';
  end if;
  if p_actor_user_id is null or p_command_id is null or p_default_template_id is null
     or p_effective_from is null or p_enabled is null
     or v_cycle not in ('monthly','yearly')
     or char_length(v_reason) not between 6 and 1000 then
    raise exception 'Valid actor, command, default schedule, cycle, effective time and reason are required'
      using errcode='22023';
  end if;
  if p_effective_until is not null and p_effective_until<=p_effective_from then
    raise exception 'Installment policy expiry must follow its effective time' using errcode='22023';
  end if;
  if not (
     (v_scope='platform' and p_tenant_id is null and p_commercial_order_id is null and p_plan_profile_version_id is null)
     or (v_scope='plan_profile_cycle' and p_tenant_id is null and p_commercial_order_id is null and p_plan_profile_version_id is not null)
     or (v_scope='tenant' and p_tenant_id is not null and p_commercial_order_id is null and p_plan_profile_version_id is null)
     or (v_scope='commercial_order' and p_tenant_id is not null and p_commercial_order_id is not null and p_plan_profile_version_id is null)
  ) then
    raise exception 'Invalid Commercial V2 installment policy scope' using errcode='22023';
  end if;
  if array_position(v_alternatives,null) is not null
     or cardinality(v_alternatives)<>(
       select count(distinct x)::integer from unnest(v_alternatives) x
     ) or not coalesce(p_enabled,false) and cardinality(v_alternatives)>0 then
    raise exception 'Allowed alternative schedule set must be unique and requires enabled installments' using errcode='23514';
  end if;
  select t.* into strict v_default
  from public.sellertray_installment_schedule_templates t where t.id=p_default_template_id;
  if v_default.status<>'published' or v_default.effective_from>p_effective_from
     or (v_default.effective_until is not null and v_default.effective_until<=p_effective_from) then
    raise exception 'Default schedule version must be published and effective' using errcode='23514';
  end if;
  if exists(
    select 1 from unnest(v_alternatives) v(template_id)
    left join public.sellertray_installment_schedule_templates t on t.id=v.template_id
    where v.template_id=p_default_template_id or t.id is null
       or t.status<>'published' or t.effective_from>p_effective_from
       or (t.effective_until is not null and t.effective_until<=p_effective_from)
  ) then
    raise exception 'Allowed alternatives must be distinct published, effective schedule versions' using errcode='23514';
  end if;
  if v_scope='plan_profile_cycle' and not exists(
    select 1 from public.sellertray_plan_profile_versions v
    where v.id=p_plan_profile_version_id and v.status='published'
      and p_effective_from>=v.effective_from
      and (v.effective_until is null or v.effective_until>p_effective_from)
      and v_cycle=any(v.allowed_billing_cycles)
  ) then
    raise exception 'Plan Profile Version is not published and effective for this cycle'
      using errcode='23514';
  end if;

  v_fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object(
    'scope',v_scope,'tenantId',p_tenant_id,'commercialOrderId',p_commercial_order_id,
    'planProfileVersionId',p_plan_profile_version_id,'cycle',v_cycle,
    'enabled',p_enabled,'defaultTemplateId',p_default_template_id,
    'allowedAlternativeTemplateIds',coalesce((
      select jsonb_agg(x order by x) from unnest(v_alternatives) x
    ),'[]'::jsonb),
    'effectiveFrom',p_effective_from,'effectiveUntil',p_effective_until,
    'reason',v_reason,'actor',p_actor_user_id
  )::text,'UTF8'),'sha256'),'hex');

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('sellertray-installment-policy-v2|'||p_command_id::text,0)
  );
  select p.* into v_existing
  from public.sellertray_installment_policy_versions p
  where p.publish_command_id=p_command_id;
  if found then
    if v_existing.policy_context='branch_commercial_v2'
       and v_existing.publish_request_fingerprint=v_fingerprint then
      return v_existing.id;
    end if;
    raise exception 'Installment policy publication command is already used for different facts'
      using errcode='23505';
  end if;

  insert into public.sellertray_installment_policy_versions(
    scope_kind,tenant_id,commercial_order_id,plan_profile_version_id,billing_cycle,
    enabled,default_template_id,effective_from,effective_until,created_by_user_id,
    change_reason,policy_context,publish_command_id,publish_request_fingerprint
  ) values(
    v_scope,p_tenant_id,p_commercial_order_id,p_plan_profile_version_id,
    case when v_scope='commercial_order' then null else v_cycle end,
    p_enabled,p_default_template_id,p_effective_from,p_effective_until,p_actor_user_id,
    v_reason,'branch_commercial_v2',p_command_id,v_fingerprint
  ) returning id into v_id;

  insert into public.sellertray_installment_policy_allowed_templates(policy_version_id,template_id)
  select v_id,x from unnest(v_alternatives) x;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(p_actor_user_id,p_tenant_id,'sellertray_publish_c2_installment_policy',jsonb_build_object(
    'policyVersionId',v_id,'scopeKind',v_scope,'planProfileVersionId',p_plan_profile_version_id,
    'commercialOrderId',p_commercial_order_id,'billingCycle',v_cycle,
    'enabled',p_enabled,'defaultTemplateId',p_default_template_id,
    'allowedAlternativeTemplateIds',to_jsonb(v_alternatives),
    'effectiveFrom',p_effective_from,'effectiveUntil',p_effective_until,
    'commandId',p_command_id,'reason',v_reason
  ));

  return v_id;
end;
$function$;

revoke all on function public.publish_sellertray_installment_policy_v2_admin(
  text,uuid,uuid,uuid,text,boolean,uuid,uuid[],timestamptz,timestamptz,text,uuid,uuid
) from public,anon,authenticated;
grant execute on function public.publish_sellertray_installment_policy_v2_admin(
  text,uuid,uuid,uuid,text,boolean,uuid,uuid[],timestamptz,timestamptz,text,uuid,uuid
) to service_role;


create or replace function public.validate_sellertray_branch_commercial_installment_policy()
returns trigger
language plpgsql
set search_path=''
as $function$
declare
  v_order public.sellertray_commercial_orders%rowtype;
  v_template public.sellertray_installment_schedule_templates%rowtype;
  v_policy jsonb;
  v_policy_enabled boolean;
  v_policy_template_id uuid;
begin
  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.tenant_id=new.tenant_id and o.id=new.commercial_order_id;

  select t.* into strict v_template
  from public.sellertray_installment_schedule_templates t
  where t.id=new.installment_template_id;

  v_policy:=public.resolve_sellertray_installment_policy_v2(
    new.tenant_id,
    new.commercial_order_id,
    new.plan_profile_version_id,
    new.billing_cycle,
    v_order.ordered_at
  );
  v_policy_enabled:=coalesce((v_policy->>'enabled')::boolean,false);
  v_policy_template_id:=nullif(v_policy->>'defaultTemplateId','')::uuid;

  if not public.sellertray_c2_installment_template_allowed(v_policy,new.installment_template_id)
     or new.installment_policy_version_id is distinct from nullif(v_policy->>'policyVersionId','')::uuid then
    raise exception 'Selected installment structure is not authorised by the effective Commercial V2 policy'
      using errcode='23514';
  end if;

  return new;
end;
$function$;

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
        'supersedesBranchSubscriptionId',s.supersedes_branch_subscription_id
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
      'supersedesBranchSubscriptionId',v_supersedes
    ));
  end loop;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(p_actor_user_id,p_tenant_id,'sellertray_create_c2_branch_commercial_order',jsonb_build_object(
    'commercialOrderId',v_order_id,'orderReference',v_reference,'currency',v_currency,
    'totalGrossAmount',v_total,'commandId',p_command_id,'actorKind',v_actor_kind,
    'branchSubjectCount',jsonb_array_length(v_results)
  ));

  return jsonb_build_object(
    'commercialOrderId',v_order_id,'orderReference',v_reference,'currency',v_currency,
    'totalGrossAmount',v_total,'subjects',v_results,'idempotentReplay',false
  );
end;
$function$;

create or replace function public.validate_sellertray_commercial_installment_schedule()
returns trigger
language plpgsql
set search_path=''
as $function$
declare
  v_obligation_id uuid;
  v_tenant_id uuid;
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_count integer;
  v_percentage_count integer;
  v_fixed_count integer;
  v_percent numeric;
  v_amount numeric;
  v_first numeric;
  v_second numeric;
  v_third numeric;
  v_template_id uuid;
  v_ordered_at timestamptz;
  v_expected_count integer;
  v_template_matches boolean;
begin
  if tg_table_name='sellertray_commercial_installment_obligations' then
    v_obligation_id:=new.id;
    v_tenant_id:=new.tenant_id;
  elsif tg_table_name='sellertray_commercial_installment_schedule' then
    v_obligation_id:=new.installment_obligation_id;
    v_tenant_id:=new.tenant_id;
  else
    raise exception 'Unexpected SellerTray installment trigger table: %',tg_table_name
      using errcode='55000';
  end if;

  select o.* into v_obligation
  from public.sellertray_commercial_installment_obligations o
  where o.id=v_obligation_id and o.tenant_id=v_tenant_id;
  if not found then return new; end if;

  select count(*)::integer,
         count(*) filter(where s.allocation_mode='percentage')::integer,
         count(*) filter(where s.allocation_mode='fixed')::integer,
         coalesce(sum(s.percentage),0),
         coalesce(sum(s.amount_due),0),
         max(s.amount_due) filter(where s.sequence_no=1),
         max(s.amount_due) filter(where s.sequence_no=2),
         max(s.amount_due) filter(where s.sequence_no=3)
    into v_count,v_percentage_count,v_fixed_count,v_percent,v_amount,v_first,v_second,v_third
  from public.sellertray_commercial_installment_schedule s
  where s.installment_obligation_id=v_obligation.id
    and s.tenant_id=v_obligation.tenant_id;

  if v_count=0 or abs(v_amount-v_obligation.obligated_amount)>=0.005 then
    raise exception 'SellerTray installment schedule must reconcile to the commercial obligation'
      using errcode='23514';
  end if;
  if v_percentage_count not in (0,v_count) or v_fixed_count not in (0,v_count) then
    raise exception 'SellerTray installment schedule cannot mix percentage and fixed allocations'
      using errcode='23514';
  end if;
  if v_percentage_count=v_count and abs(v_percent-100)>=0.0001 then
    raise exception 'SellerTray percentage installment schedule must reconcile to 100 percent'
      using errcode='23514';
  end if;
  if v_fixed_count=v_count and exists(
    select 1
    from public.sellertray_commercial_installment_schedule s
    where s.tenant_id=v_obligation.tenant_id
      and s.installment_obligation_id=v_obligation.id
      and abs(s.amount_due-s.fixed_amount_snapshot)>=0.005
  ) then
    raise exception 'SellerTray fixed installment schedule must preserve its snapshotted fixed amounts'
      using errcode='23514';
  end if;

  if v_obligation.obligation_scope='branch_subscription' then
    -- A C2 contract must reproduce its immutable selected template, never a
    -- set of hard-coded percentages inferred from a human-readable code.
    select c.template_id into strict v_template_id
    from public.sellertray_installment_contract_snapshots c
    where c.tenant_id=v_obligation.tenant_id
      and c.installment_obligation_id=v_obligation.id;

    select o.ordered_at into strict v_ordered_at
    from public.sellertray_commercial_orders o
    where o.tenant_id=v_obligation.tenant_id and o.id=v_obligation.commercial_order_id;

    with template_lines as (
      select l.sequence_no,l.percentage,l.fixed_amount,l.due_offset_days,
             row_number() over (order by l.sequence_no) as row_no,
             count(*) over () as total_lines,
             coalesce(sum(case when l.percentage is not null
                    then round((v_obligation.obligated_amount*l.percentage/100)::numeric,2)
                    else l.fixed_amount end)
               over (order by l.sequence_no rows between unbounded preceding and 1 preceding),0)::numeric as prior_allocated
      from public.sellertray_installment_schedule_template_lines l
      where l.template_id=v_template_id
    )
    select count(*)::integer,
           coalesce(bool_and(
             s.id is not null
             and s.allocation_mode=case when t.percentage is not null then 'percentage' else 'fixed' end
             and s.percentage is not distinct from t.percentage
             and s.fixed_amount_snapshot is not distinct from t.fixed_amount
             and abs(s.amount_due-case
                 when t.percentage is null then t.fixed_amount
                 when t.row_no=t.total_lines then v_obligation.obligated_amount-t.prior_allocated
                 else round((v_obligation.obligated_amount*t.percentage/100)::numeric,2)
               end)<0.005
             and s.due_at is not distinct from
               case when t.due_offset_days is null then null
                    else v_ordered_at+make_interval(days=>t.due_offset_days) end
           ),false)
      into v_expected_count,v_template_matches
    from template_lines t
    left join public.sellertray_commercial_installment_schedule s
      on s.tenant_id=v_obligation.tenant_id
     and s.installment_obligation_id=v_obligation.id
     and s.sequence_no=t.sequence_no;

    if v_count<>v_expected_count or not v_template_matches then
      raise exception 'Commercial V2 installment schedule must match its snapshotted template allocations and due dates'
        using errcode='23514';
    end if;
  else
    -- Preserve exact historical C1 structure checks; they are not C2 runtime
    -- authority and the existing C1/OA2 evidence must not be rewritten.
    if v_obligation.structure_code='two_installment_70_30' then
      if v_count<>2 or v_percentage_count<>2
         or not exists(select 1 from public.sellertray_commercial_installment_schedule s where s.installment_obligation_id=v_obligation.id and s.sequence_no=1 and s.percentage=70)
         or not exists(select 1 from public.sellertray_commercial_installment_schedule s where s.installment_obligation_id=v_obligation.id and s.sequence_no=2 and s.percentage=30)
         or abs(v_first-round((v_obligation.obligated_amount*0.70)::numeric,2))>=0.005
         or abs(v_second-(v_obligation.obligated_amount-v_first))>=0.005 then
        raise exception 'SellerTray two-installment schedule must preserve the approved 70:30 structure'
          using errcode='23514';
      end if;
    elsif v_obligation.structure_code='three_installment_60_20_20' then
      if v_count<>3 or v_percentage_count<>3
         or not exists(select 1 from public.sellertray_commercial_installment_schedule s where s.installment_obligation_id=v_obligation.id and s.sequence_no=1 and s.percentage=60)
         or not exists(select 1 from public.sellertray_commercial_installment_schedule s where s.installment_obligation_id=v_obligation.id and s.sequence_no=2 and s.percentage=20)
         or not exists(select 1 from public.sellertray_commercial_installment_schedule s where s.installment_obligation_id=v_obligation.id and s.sequence_no=3 and s.percentage=20)
         or abs(v_first-round((v_obligation.obligated_amount*0.60)::numeric,2))>=0.005
         or abs(v_second-round((v_obligation.obligated_amount*0.20)::numeric,2))>=0.005
         or abs(v_third-(v_obligation.obligated_amount-v_first-v_second))>=0.005 then
        raise exception 'SellerTray three-installment schedule must preserve the approved 60:20:20 structure'
          using errcode='23514';
      end if;
    end if;
  
  end if;

  return new;
end;
$function$;

create or replace function public.get_sellertray_installment_contract_checkout_policy(
  p_tenant_id uuid,
  p_installment_obligation_id uuid,
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_snapshot public.sellertray_installment_contract_snapshots%rowtype;
  v_plan_code text;
  v_plan_profile_version_id uuid;
  v_billing_cycle text;
  v_policy jsonb;
  v_policy_enabled boolean:=false;
  v_policy_template_id uuid;
  v_master jsonb;
  v_order_form_id uuid;
  v_order_form_confirmed boolean:=false;
begin
  select o.* into strict v_obligation
  from public.sellertray_commercial_installment_obligations o
  where o.tenant_id=p_tenant_id and o.id=p_installment_obligation_id;
  select s.* into strict v_snapshot
  from public.sellertray_installment_contract_snapshots s
  where s.tenant_id=p_tenant_id and s.installment_obligation_id=v_obligation.id;

  if v_obligation.obligation_scope='branch_subscription' then
    select s.plan_profile_version_id,s.billing_cycle
      into strict v_plan_profile_version_id,v_billing_cycle
    from public.sellertray_commercial_order_price_snapshots s
    where s.tenant_id=p_tenant_id and s.id=v_obligation.commercial_order_line_id
      and s.line_type='branch_subscription';
    v_policy:=public.resolve_sellertray_installment_policy_v2(
      p_tenant_id,v_obligation.commercial_order_id,v_plan_profile_version_id,v_billing_cycle,p_as_of
    );
  else
    select s.plan_code,s.billing_cycle into strict v_plan_code,v_billing_cycle
    from public.sellertray_commercial_order_price_snapshots s
    where s.tenant_id=p_tenant_id and s.commercial_order_id=v_obligation.commercial_order_id
      and s.line_type='subscription';
    v_policy:=public.resolve_sellertray_installment_policy(
      p_tenant_id,v_obligation.commercial_order_id,v_plan_code,v_billing_cycle,p_as_of
    );
  end if;

  v_policy_enabled:=coalesce((v_policy->>'enabled')::boolean,false);
  v_policy_template_id:=nullif(v_policy->>'defaultTemplateId','')::uuid;
  v_master:=public.get_sellertray_master_agreement_state(p_tenant_id,p_as_of);

  select f.id into v_order_form_id
  from public.sellertray_commercial_order_forms f
  where f.tenant_id=p_tenant_id and f.commercial_order_id=v_obligation.commercial_order_id
    and not exists(
      select 1 from public.sellertray_commercial_order_forms r
      where r.tenant_id=f.tenant_id and r.supersedes_order_form_id=f.id
    )
  order by f.issued_at desc,f.created_at desc limit 1;
  if v_order_form_id is not null then
    select exists(
      select 1 from public.sellertray_order_form_confirmations c
      where c.tenant_id=p_tenant_id and c.order_form_id=v_order_form_id
    ) into v_order_form_confirmed;
  end if;

  return jsonb_build_object(
    'tenantId',p_tenant_id,'commercialOrderId',v_obligation.commercial_order_id,
    'installmentObligationId',v_obligation.id,'planCode',v_plan_code,
    'planProfileVersionId',v_plan_profile_version_id,'billingCycle',v_billing_cycle,
    'agreementAccepted',true,'agreementAcceptedAt',null,
    'masterAgreementPublished',coalesce((v_master->>'published')::boolean,false),
    'masterAgreementAccepted',coalesce((v_master->>'accepted')::boolean,false),
    'masterAgreementAcceptedAt',v_master->'acceptance'->>'acceptedAt',
    'contractTemplateId',v_snapshot.template_id,'contractTemplateCode',v_snapshot.template_code,
    'contractTemplateVersion',v_snapshot.template_version,'currentPolicy',v_policy,
    'draftEligible',case
      when v_obligation.obligation_scope='branch_subscription'
        then v_order_form_confirmed or public.sellertray_c2_installment_template_allowed(v_policy,v_snapshot.template_id)
      else v_policy_enabled and v_policy_template_id=v_snapshot.template_id end,
    'orderFormId',v_order_form_id,'orderFormConfirmed',v_order_form_confirmed,
    'checkoutEligible',case
      when v_obligation.obligation_scope='branch_subscription' then v_order_form_confirmed
      else true end
  );
end;
$function$;

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
      'installment_template_code',cs.template_code,
      'installment_template_version',cs.template_version,
      'installment_policy_version_id',s.installment_policy_version_id,
      'settlement',public.get_sellertray_commercial_obligation_settlement_state(
        p_tenant_id,s.installment_obligation_id
      )
    ) order by s.branch_id),'[]'::jsonb)
    into v_branch_commitments
    from public.sellertray_branch_commercial_order_subjects s
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
-- The original C1/OA2 history, order/receipt/payment rows and compatibility
-- subscription runtime remain unchanged until a separately approved cutover.
commit;
