begin;

-- Harden the bounded C1B first-merchant acceptance bridge without changing
-- C1/C1A/C1B commercial semantics. The original implementations are retained
-- as internal service-only implementations; public service RPC names become
-- explicit role-guarded wrappers. Initial-purchase creation is also serialized
-- per Business before the implementation re-checks existing commercial orders.

alter function public.get_sellertray_commercial_onboarding_admin(uuid,uuid)
  rename to get_sellertray_commercial_onboarding_admin_impl;
alter function public.publish_sellertray_subscription_price_pair_admin(text,text,numeric,numeric,timestamptz,text,uuid)
  rename to publish_sellertray_subscription_price_pair_admin_impl;
alter function public.publish_sellertray_branch_setup_price_admin(text,numeric,numeric,timestamptz,text,uuid)
  rename to publish_sellertray_branch_setup_price_admin_impl;
alter function public.create_sellertray_initial_installment_purchase_admin(uuid,text,text,uuid[],text,text,text,uuid)
  rename to create_sellertray_initial_installment_purchase_admin_impl;

revoke all on function public.get_sellertray_commercial_onboarding_admin_impl(uuid,uuid)
  from public,anon,authenticated;
revoke all on function public.publish_sellertray_subscription_price_pair_admin_impl(text,text,numeric,numeric,timestamptz,text,uuid)
  from public,anon,authenticated;
revoke all on function public.publish_sellertray_branch_setup_price_admin_impl(text,numeric,numeric,timestamptz,text,uuid)
  from public,anon,authenticated;
revoke all on function public.create_sellertray_initial_installment_purchase_admin_impl(uuid,text,text,uuid[],text,text,text,uuid)
  from public,anon,authenticated;

-- The internal implementations remain callable only by the trusted service role.
-- Untrusted authenticated clients cannot execute either implementation or wrapper.
grant execute on function public.get_sellertray_commercial_onboarding_admin_impl(uuid,uuid)
  to service_role;
grant execute on function public.publish_sellertray_subscription_price_pair_admin_impl(text,text,numeric,numeric,timestamptz,text,uuid)
  to service_role;
grant execute on function public.publish_sellertray_branch_setup_price_admin_impl(text,numeric,numeric,timestamptz,text,uuid)
  to service_role;
grant execute on function public.create_sellertray_initial_installment_purchase_admin_impl(uuid,text,text,uuid[],text,text,text,uuid)
  to service_role;

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
begin
  select pa.role into v_role
  from public.platform_admins pa
  where pa.user_id=p_actor_user_id;

  if coalesce(v_role,'') not in ('admin','support') then
    raise exception 'Platform administrator access required' using errcode='42501';
  end if;

  return public.get_sellertray_commercial_onboarding_admin_impl(
    p_actor_user_id,
    p_tenant_id
  );
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
begin
  select pa.role into v_role
  from public.platform_admins pa
  where pa.user_id=p_actor_user_id;

  if v_role is distinct from 'admin' then
    raise exception 'Platform admin role required for this action' using errcode='42501';
  end if;

  return public.publish_sellertray_subscription_price_pair_admin_impl(
    p_plan_code,
    p_currency,
    p_monthly_gross_amount,
    p_tax_rate_percent,
    p_effective_from,
    p_reason,
    p_actor_user_id
  );
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
begin
  select pa.role into v_role
  from public.platform_admins pa
  where pa.user_id=p_actor_user_id;

  if v_role is distinct from 'admin' then
    raise exception 'Platform admin role required for this action' using errcode='42501';
  end if;

  return public.publish_sellertray_branch_setup_price_admin_impl(
    p_currency,
    p_gross_amount,
    p_tax_rate_percent,
    p_effective_from,
    p_reason,
    p_actor_user_id
  );
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
begin
  select pa.role into v_role
  from public.platform_admins pa
  where pa.user_id=p_actor_user_id;

  if v_role is distinct from 'admin' then
    raise exception 'Platform admin role required for this action' using errcode='42501';
  end if;

  if p_tenant_id is null then
    raise exception 'Business not found' using errcode='P0002';
  end if;

  -- Serialize all acceptance-bridge initial-purchase commands for the same
  -- Business before the implementation checks idempotent replay/existing order
  -- state. A concurrent different-reference request therefore waits, then sees
  -- the first committed subscription order and fails closed instead of creating
  -- an unpayable second "initial" order.
  perform 1
  from public.tenants t
  where t.id=p_tenant_id
  for update;

  if not found then
    raise exception 'Business not found' using errcode='P0002';
  end if;

  return public.create_sellertray_initial_installment_purchase_admin_impl(
    p_tenant_id,
    p_plan_code,
    p_currency,
    p_branch_ids,
    p_structure_code,
    p_order_reference,
    p_reason,
    p_actor_user_id
  );
end;
$$;

revoke all on function public.create_sellertray_initial_installment_purchase_admin(uuid,text,text,uuid[],text,text,text,uuid)
  from public,anon,authenticated;
grant execute on function public.create_sellertray_initial_installment_purchase_admin(uuid,text,text,uuid[],text,text,text,uuid)
  to service_role;

commit;
