begin;

-- Published SellerTray price rows are immutable commercial history. Operational
-- lifecycle changes therefore live in an append-only control ledger rather than
-- mutating status/effective dates on the published price version itself.

create table if not exists public.sellertray_commercial_price_version_controls (
  id uuid primary key default gen_random_uuid(),
  price_version_id uuid not null references public.sellertray_commercial_price_versions(id) on delete restrict,
  control_action text not null,
  command_id uuid not null,
  controlled_by_user_id uuid not null,
  effective_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  reason text not null,
  constraint sellertray_commercial_price_version_controls_action_check
    check (control_action in ('pause','resume','deactivate','void')),
  constraint sellertray_commercial_price_version_controls_reason_check
    check (char_length(btrim(reason)) between 6 and 1000),
  unique(command_id,price_version_id)
);

create index if not exists sellertray_commercial_price_version_controls_state_idx
  on public.sellertray_commercial_price_version_controls(price_version_id,effective_at desc,created_at desc);

alter table public.sellertray_commercial_price_version_controls enable row level security;
revoke all on table public.sellertray_commercial_price_version_controls from public,anon,authenticated,service_role;
grant select,insert on table public.sellertray_commercial_price_version_controls to service_role;

create trigger prevent_sellertray_commercial_price_version_control_mutation
before update or delete on public.sellertray_commercial_price_version_controls
for each row execute function public.prevent_sellertray_commercial_history_mutation();

comment on table public.sellertray_commercial_price_version_controls is
  'Append-only Pause/Resume/Deactivate/Void evidence for immutable SellerTray commercial price versions. Existing orders retain their snapshotted prices.';

-- This helper is deliberately SECURITY DEFINER because the existing Business-aware
-- resolver is callable by anon/authenticated roles while the control ledger itself
-- must remain private. The helper exposes only the effective lifecycle state, never
-- actor/reason/audit detail from the underlying control evidence.
create or replace function public.sellertray_commercial_price_version_state(
  p_price_version_id uuid,
  p_as_of timestamptz
)
returns text
language sql
stable
security definer
set search_path=''
as $$
  with latest as (
    select c.control_action
    from public.sellertray_commercial_price_version_controls c
    where c.price_version_id=p_price_version_id
      and c.effective_at<=p_as_of
    order by c.effective_at desc,c.created_at desc,c.id desc
    limit 1
  )
  select case coalesce((select control_action from latest),'resume')
    when 'pause' then 'paused'
    when 'deactivate' then 'deactivated'
    when 'void' then 'voided'
    else 'active'
  end;
$$;

revoke all on function public.sellertray_commercial_price_version_state(uuid,timestamptz) from public;
grant execute on function public.sellertray_commercial_price_version_state(uuid,timestamptz) to anon,authenticated,service_role;

create or replace function public.resolve_sellertray_commercial_price_version(
  p_price_kind text,
  p_plan_code text,
  p_billing_cycle text,
  p_currency text,
  p_as_of timestamptz
)
returns uuid
language sql
stable
set search_path=''
as $$
  with candidate as (
    select p.*
    from public.sellertray_commercial_price_versions p
    where p.price_scope='standard'
      and p.tenant_id is null
      and p.price_kind=p_price_kind
      and p.plan_code is not distinct from p_plan_code
      and p.billing_cycle is not distinct from p_billing_cycle
      and p.currency=upper(btrim(p_currency))
      and p.status='published'
      and p.effective_from<=p_as_of
      and (p.effective_until is null or p.effective_until>p_as_of)
      and public.sellertray_commercial_price_version_state(p.id,p_as_of)='active'
    order by p.effective_from desc,p.created_at desc,p.id desc
    limit 1
  ),
  effective_monthly as (
    select p.*
    from public.sellertray_commercial_price_versions p
    where p.price_scope='standard'
      and p.tenant_id is null
      and p.price_kind='subscription'
      and p.plan_code=p_plan_code
      and p.billing_cycle='monthly'
      and p.currency=upper(btrim(p_currency))
      and p.status='published'
      and p.effective_from<=p_as_of
      and (p.effective_until is null or p.effective_until>p_as_of)
      and public.sellertray_commercial_price_version_state(p.id,p_as_of)='active'
    order by p.effective_from desc,p.created_at desc,p.id desc
    limit 1
  )
  select c.id
  from candidate c
  left join effective_monthly m on true
  where c.price_kind<>'subscription'
     or c.billing_cycle<>'yearly'
     or (
       m.id is not null
       and abs(c.gross_amount-(m.gross_amount*10))<0.005
       and (
         (c.net_amount is null and m.net_amount is null and c.tax_rate_percent is null and m.tax_rate_percent is null and c.tax_amount is null and m.tax_amount is null)
         or
         (c.net_amount is not null and m.net_amount is not null and c.tax_rate_percent is not distinct from m.tax_rate_percent and abs(c.net_amount-(m.net_amount*10))<0.005 and abs(c.tax_amount-(m.tax_amount*10))<0.005)
       )
     )
  limit 1;
$$;

create or replace function public.resolve_sellertray_commercial_price_version_for_tenant(
  p_tenant_id uuid,
  p_price_kind text,
  p_plan_code text,
  p_billing_cycle text,
  p_currency text,
  p_as_of timestamptz
)
returns uuid
language sql
stable
set search_path=''
as $$
  select p.id
  from public.sellertray_commercial_price_versions p
  where p.price_kind=p_price_kind
    and p.plan_code is not distinct from p_plan_code
    and p.billing_cycle is not distinct from p_billing_cycle
    and p.currency=upper(btrim(p_currency))
    and p.status='published'
    and p.effective_from<=p_as_of
    and (p.effective_until is null or p.effective_until>p_as_of)
    and public.sellertray_commercial_price_version_state(p.id,p_as_of)='active'
    and ((p.price_scope='merchant_override' and p.tenant_id=p_tenant_id) or (p.price_scope='standard' and p.tenant_id is null))
  order by case when p.price_scope='merchant_override' then 1 else 0 end desc,p.effective_from desc,p.created_at desc,p.id desc
  limit 1;
$$;

create or replace function public.control_sellertray_commercial_price_version_admin(
  p_price_version_id uuid,
  p_action text,
  p_reason text,
  p_command_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
set search_path=''
as $$
declare
  v_action text:=lower(btrim(coalesce(p_action,'')));
  v_reason text:=btrim(coalesce(p_reason,''));
  v_role text;
  v_target public.sellertray_commercial_price_versions%rowtype;
  v_monthly public.sellertray_commercial_price_versions%rowtype;
  v_yearly public.sellertray_commercial_price_versions%rowtype;
  v_target_ids uuid[];
  v_sorted_target_ids uuid[];
  v_existing_ids uuid[];
  v_existing_action_min text;
  v_existing_action_max text;
  v_existing_reason_min text;
  v_existing_reason_max text;
  v_states text[];
  v_result_state text;
  v_tenant_id uuid;
  v_lock_identity text;
  v_control_at timestamptz;
begin
  if p_price_version_id is null or p_command_id is null then raise exception 'Price version and lifecycle command are required' using errcode='22023'; end if;
  if v_action not in ('pause','resume','deactivate','void') then raise exception 'Price lifecycle action must be pause, resume, deactivate or void' using errcode='22023'; end if;
  if char_length(v_reason) not between 6 and 1000 then raise exception 'Price lifecycle reason must be between 6 and 1000 characters' using errcode='22023'; end if;

  -- Published price rows are immutable, so this first read is safe for deriving the
  -- lifecycle lock identity. State is not inspected until after the advisory lock.
  select p.* into v_target from public.sellertray_commercial_price_versions p where p.id=p_price_version_id;
  if not found then raise exception 'Commercial price version not found' using errcode='P0002'; end if;
  if v_target.status<>'published' then raise exception 'Only a published commercial price version can be controlled' using errcode='22023'; end if;

  select pa.role into v_role from public.platform_admins pa where pa.user_id=p_actor_user_id;
  if v_target.price_scope='standard' then
    if v_role is distinct from 'admin' or not public.platform_admin_has_capability(p_actor_user_id,'admin.pricing.manage',null,now()) then raise exception 'Platform pricing management capability required' using errcode='42501'; end if;
    v_tenant_id:=null;
  elsif v_target.price_scope='merchant_override' then
    if not public.platform_admin_has_capability(p_actor_user_id,'admin.pricing.manage',v_target.tenant_id,now()) then raise exception 'Business pricing management capability required' using errcode='42501'; end if;
    v_tenant_id:=v_target.tenant_id;
  else
    raise exception 'Unsupported commercial price scope' using errcode='22023';
  end if;

  if v_target.price_kind='subscription' then
    v_lock_identity:=concat_ws('|',
      'sellertray-price-lifecycle-v1','subscription',v_target.price_scope,
      coalesce(v_target.tenant_id::text,'platform'),coalesce(v_target.plan_code,''),
      v_target.currency,extract(epoch from v_target.effective_from)::numeric::text
    );
  elsif v_target.price_kind='branch_setup' then
    v_lock_identity:=concat_ws('|','sellertray-price-lifecycle-v1','branch_setup',v_target.id::text);
  else
    raise exception 'Unsupported commercial price kind' using errcode='22023';
  end if;

  -- Serialize every lifecycle transition for the exact price version or subscription
  -- pair before reading state. This prevents Pause/Resume/Deactivate/Void races from
  -- appending a later transition that would violate terminal-state semantics.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_lock_identity,0));
  v_control_at:=clock_timestamp();

  if v_target.price_kind='subscription' then
    select p.* into v_monthly from public.sellertray_commercial_price_versions p
    where p.price_kind='subscription' and p.price_scope=v_target.price_scope and p.tenant_id is not distinct from v_target.tenant_id
      and p.plan_code=v_target.plan_code and p.billing_cycle='monthly' and p.currency=v_target.currency and p.effective_from=v_target.effective_from and p.status='published'
    order by p.created_at desc,p.id desc limit 1;
    if not found then raise exception 'Matching monthly subscription price version not found' using errcode='P0002'; end if;

    select p.* into v_yearly from public.sellertray_commercial_price_versions p
    where p.price_kind='subscription' and p.price_scope=v_target.price_scope and p.tenant_id is not distinct from v_target.tenant_id
      and p.plan_code=v_target.plan_code and p.billing_cycle='yearly' and p.currency=v_target.currency and p.effective_from=v_target.effective_from and p.status='published'
    order by p.created_at desc,p.id desc limit 1;
    if not found then raise exception 'Matching annual subscription price version not found' using errcode='P0002'; end if;
    if abs(v_yearly.gross_amount-(v_monthly.gross_amount*10))>=0.005 then raise exception 'Subscription price pair violates the governed 10-for-12 relationship' using errcode='23514'; end if;
    v_target_ids:=array[v_monthly.id,v_yearly.id];
  else
    v_target_ids:=array[v_target.id];
  end if;

  select array_agg(x order by x) into v_sorted_target_ids from unnest(v_target_ids) x;
  select array_agg(c.price_version_id order by c.price_version_id),min(c.control_action),max(c.control_action),min(c.reason),max(c.reason)
  into v_existing_ids,v_existing_action_min,v_existing_action_max,v_existing_reason_min,v_existing_reason_max
  from public.sellertray_commercial_price_version_controls c where c.command_id=p_command_id;

  if coalesce(cardinality(v_existing_ids),0)>0 then
    if v_existing_ids=v_sorted_target_ids and v_existing_action_min=v_action and v_existing_action_max=v_action and v_existing_reason_min=v_reason and v_existing_reason_max=v_reason then
      v_result_state:=public.sellertray_commercial_price_version_state(v_target.id,v_control_at);
      return jsonb_build_object('priceVersionId',v_target.id,'controlledPriceVersionIds',to_jsonb(v_sorted_target_ids),'action',v_action,'state',v_result_state,'alreadyApplied',true);
    end if;
    raise exception 'Price lifecycle command id already belongs to different facts' using errcode='23505';
  end if;

  select array_agg(distinct public.sellertray_commercial_price_version_state(x,v_control_at) order by public.sellertray_commercial_price_version_state(x,v_control_at)) into v_states from unnest(v_target_ids) x;
  if v_action='pause' and v_states<>array['active']::text[] then raise exception 'Only an active price version can be paused' using errcode='23514'; end if;
  if v_action='resume' and v_states<>array['paused']::text[] then raise exception 'Only a paused price version can be resumed' using errcode='23514'; end if;
  if v_action='deactivate' and (v_states && array['deactivated','voided']::text[]) then raise exception 'A deactivated or voided price version is terminal' using errcode='23514'; end if;
  if v_action='void' then
    if exists(select 1 from public.sellertray_commercial_price_versions p where p.id=any(v_target_ids) and p.effective_from<=v_control_at) then raise exception 'Void is only allowed before a price version becomes effective' using errcode='23514'; end if;
    if v_states && array['deactivated','voided']::text[] then raise exception 'A deactivated or voided price version is terminal' using errcode='23514'; end if;
    if exists(select 1 from public.sellertray_commercial_order_price_snapshots s where s.source_price_version_id=any(v_target_ids)) then raise exception 'A price version already snapshotted into a commercial order cannot be voided' using errcode='23514'; end if;
    if exists(select 1 from public.sellertray_commercial_price_versions p where p.source_standard_price_version_id=any(v_target_ids)) then raise exception 'A standard price version already referenced by a Business override cannot be voided' using errcode='23514'; end if;
  end if;

  insert into public.sellertray_commercial_price_version_controls(price_version_id,control_action,command_id,controlled_by_user_id,effective_at,reason)
  select x,v_action,p_command_id,p_actor_user_id,v_control_at,v_reason from unnest(v_target_ids) x;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(p_actor_user_id,v_tenant_id,'sellertray_control_commercial_price_version',jsonb_build_object(
    'commandId',p_command_id,'requestedPriceVersionId',v_target.id,'controlledPriceVersionIds',to_jsonb(v_target_ids),
    'controlAction',v_action,'priceScope',v_target.price_scope,'priceKind',v_target.price_kind,'planCode',v_target.plan_code,
    'currency',v_target.currency,'effectiveFrom',v_target.effective_from,'controlAt',v_control_at,'reason',v_reason));

  v_result_state:=public.sellertray_commercial_price_version_state(v_target.id,v_control_at);
  return jsonb_build_object('priceVersionId',v_target.id,'controlledPriceVersionIds',to_jsonb(v_sorted_target_ids),'action',v_action,'state',v_result_state,'alreadyApplied',false);
end;
$$;

revoke all on function public.control_sellertray_commercial_price_version_admin(uuid,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.control_sellertray_commercial_price_version_admin(uuid,text,text,uuid,uuid) to service_role;

-- Annotate immutable price history with current lifecycle control state without
-- changing the original commercial onboarding payload contract.
create or replace function public.get_sellertray_commercial_onboarding_admin(p_actor_user_id uuid,p_tenant_id uuid)
returns jsonb
language plpgsql
stable
set search_path=''
as $$
declare
  v_role text;
  v_result jsonb;
  v_prices jsonb;
begin
  select pa.role into v_role from public.platform_admins pa where pa.user_id=p_actor_user_id;
  if coalesce(v_role,'') not in ('admin','support') then raise exception 'Platform administrator access required' using errcode='42501'; end if;

  v_result:=public.get_sellertray_commercial_onboarding_admin_impl(p_actor_user_id,p_tenant_id);

  select coalesce(jsonb_agg(e.item || jsonb_build_object(
    'lifecycleState',public.sellertray_commercial_price_version_state((e.item->>'id')::uuid,now()),
    'latestControlAction',c.control_action,'latestControlAt',c.effective_at,'latestControlReason',c.reason
  ) order by e.ordinality),'[]'::jsonb)
  into v_prices
  from jsonb_array_elements(coalesce(v_result->'prices','[]'::jsonb)) with ordinality as e(item,ordinality)
  left join lateral (
    select ctl.control_action,ctl.effective_at,ctl.reason
    from public.sellertray_commercial_price_version_controls ctl
    where ctl.price_version_id=(e.item->>'id')::uuid and ctl.effective_at<=now()
    order by ctl.effective_at desc,ctl.created_at desc,ctl.id desc limit 1
  ) c on true;

  v_result:=jsonb_set(v_result,'{prices}',v_prices,true);
  return v_result || jsonb_build_object(
    'canManage',v_role='admin',
    'canManageGlobalPricing',v_role='admin' and public.platform_admin_has_capability(p_actor_user_id,'admin.pricing.manage',null,now()),
    'canManageMerchantPricing',public.platform_admin_has_capability(p_actor_user_id,'admin.pricing.manage',p_tenant_id,now())
  );
end;
$$;

commit;
