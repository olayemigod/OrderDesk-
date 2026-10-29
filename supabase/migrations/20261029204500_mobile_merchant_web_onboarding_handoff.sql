begin;

create table if not exists public.sellertray_merchant_web_handoffs (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  action_code text not null,
  target_page text not null,
  source_surface text not null default 'mobile',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  constraint sellertray_merchant_web_handoffs_token_hash_shape check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint sellertray_merchant_web_handoffs_target_page check (target_page in ('agreements', 'sellertray_billing', 'setup')),
  constraint sellertray_merchant_web_handoffs_source_surface check (source_surface = 'mobile'),
  constraint sellertray_merchant_web_handoffs_expiry_order check (expires_at > created_at),
  constraint sellertray_merchant_web_handoffs_consumed_order check (consumed_at is null or consumed_at >= created_at)
);

create index if not exists sellertray_merchant_web_handoffs_user_created_idx
  on public.sellertray_merchant_web_handoffs(user_id, created_at desc);
create index if not exists sellertray_merchant_web_handoffs_expiry_idx
  on public.sellertray_merchant_web_handoffs(expires_at)
  where consumed_at is null;

alter table public.sellertray_merchant_web_handoffs enable row level security;
revoke all on table public.sellertray_merchant_web_handoffs from public, anon, authenticated;
grant select, insert, update, delete on table public.sellertray_merchant_web_handoffs to service_role;

create or replace function public.get_sellertray_onboarding_state(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_role text;
  v_state jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;

  if v_role is null or v_role not in ('owner','manager') then
    raise exception 'Onboarding commercial status requires an Owner or Manager' using errcode='42501';
  end if;

  v_state := public.get_sellertray_onboarding_state_core(p_tenant_id);

  -- Branch setup scheduling/appointment management is a Merchant Web management
  -- responsibility. Mobile remains a status/perform surface and hands off rather
  -- than creating a parallel setup workflow.
  if v_state #>> '{nextAction,code}' = 'prepare_branches' then
    v_state := jsonb_set(
      v_state,
      '{nextAction}',
      jsonb_build_object(
        'code','review_setup_appointments',
        'label','Review setup appointments',
        'surface','merchant_web'
      ),
      true
    );
  end if;

  return v_state || jsonb_build_object(
    'viewer',jsonb_build_object('kind','merchant','role',v_role)
  );
end;
$$;

create or replace function public.get_sellertray_merchant_web_handoff_target(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_role text;
  v_state jsonb;
  v_action_code text;
  v_action_label text;
  v_target_page text;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;

  if v_role is null or v_role not in ('owner','manager') then
    raise exception 'Merchant Web onboarding handoff requires an Owner or Manager' using errcode='42501';
  end if;

  v_state := public.get_sellertray_onboarding_state(p_tenant_id);
  v_action_code := v_state #>> '{nextAction,code}';
  v_action_label := v_state #>> '{nextAction,label}';

  v_target_page := case v_action_code
    when 'review_master_agreement' then 'agreements'
    when 'pay_outstanding' then 'sellertray_billing'
    when 'review_setup_appointments' then 'setup'
    else null
  end;

  if v_target_page is null or v_state #>> '{nextAction,surface}' <> 'merchant_web' then
    raise exception 'No Merchant Web onboarding action is currently available' using errcode='22023';
  end if;

  return jsonb_build_object(
    'tenantId', p_tenant_id,
    'userId', v_user_id,
    'role', v_role,
    'actionCode', v_action_code,
    'actionLabel', v_action_label,
    'targetPage', v_target_page
  );
end;
$$;

revoke all on function public.get_sellertray_merchant_web_handoff_target(uuid) from public, anon;
grant execute on function public.get_sellertray_merchant_web_handoff_target(uuid) to authenticated;

comment on table public.sellertray_merchant_web_handoffs is
  'Short-lived, one-time evidence for governed SellerTray Mobile to Merchant Web onboarding handoff. Raw bearer secrets are never stored.';
comment on function public.get_sellertray_merchant_web_handoff_target(uuid) is
  'Returns the current server-governed Merchant Web onboarding destination for an authenticated Owner or Manager.';

commit;
