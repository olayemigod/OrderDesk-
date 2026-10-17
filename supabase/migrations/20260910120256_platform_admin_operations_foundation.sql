create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'admin' check (role in ('admin', 'support')),
  created_at timestamptz not null default now()
);

create table if not exists public.tenant_admin_notes (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  support_note text check (support_note is null or char_length(support_note) <= 4000),
  updated_by_user_id uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.platform_admin_audit (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  tenant_id uuid references public.tenants(id) on delete set null,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists tenant_admin_notes_updated_by_idx
  on public.tenant_admin_notes (updated_by_user_id)
  where updated_by_user_id is not null;
create index if not exists platform_admin_audit_actor_created_idx
  on public.platform_admin_audit (actor_user_id, created_at desc);
create index if not exists platform_admin_audit_tenant_created_idx
  on public.platform_admin_audit (tenant_id, created_at desc)
  where tenant_id is not null;

alter table public.platform_admins enable row level security;
alter table public.tenant_admin_notes enable row level security;
alter table public.platform_admin_audit enable row level security;

revoke all on table public.platform_admins from anon, authenticated;
revoke all on table public.tenant_admin_notes from anon, authenticated;
revoke all on table public.platform_admin_audit from anon, authenticated;

create or replace function public.platform_admin_overview(p_actor_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_tenants jsonb;
begin
  select pa.role into v_role
  from public.platform_admins pa
  where pa.user_id = p_actor_user_id;

  if v_role is null then
    raise exception 'Platform administrator access required' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.name), '[]'::jsonb)
  into v_tenants
  from (
    select
      t.id,
      t.name,
      t.slug,
      t.business_email as "businessEmail",
      t.business_phone as "businessPhone",
      t.onboarding_status as "onboardingStatus",
      t.whatsapp_connection_status as "whatsappStatus",
      t.subscription_status as "subscriptionStatus",
      s.plan_code as "planCode",
      s.trial_ends_at as "trialEndsAt",
      s.current_period_end as "currentPeriodEnd",
      s.grace_ends_at as "graceEndsAt",
      case
        when s.status = 'active' then 'full'
        when s.status = 'trial' and (s.trial_ends_at is null or s.trial_ends_at > now()) then 'full'
        when s.status = 'grace' and (s.grace_ends_at is null or s.grace_ends_at > now()) then 'full'
        else 'read_only'
      end as "accessMode",
      coalesce(o.orders_30d, 0) as "orders30d",
      coalesce(o.needs_review, 0) as "needsReview",
      o.last_order_at as "lastOrderAt",
      i.last_inbound_at as "lastInboundAt",
      coalesce(n.notification_exceptions, 0) as "notificationExceptions",
      coalesce(m.team_members, 0) as "teamMembers",
      notes.support_note as "supportNote",
      notes.updated_at as "supportNoteUpdatedAt"
    from public.tenants t
    left join public.tenant_subscriptions s on s.tenant_id = t.id
    left join lateral (
      select
        count(*) filter (where o.created_at >= now() - interval '30 days')::int as orders_30d,
        count(*) filter (where o.status in ('draft', 'needs_review'))::int as needs_review,
        max(o.created_at) as last_order_at
      from public.orders o
      where o.tenant_id = t.id
    ) o on true
    left join lateral (
      select max(im.received_at) as last_inbound_at
      from public.inbound_messages im
      where im.tenant_id = t.id
    ) i on true
    left join lateral (
      select count(*) filter (where onf.delivery_status in ('failed', 'template_required'))::int as notification_exceptions
      from public.outbound_notifications onf
      where onf.tenant_id = t.id
    ) n on true
    left join lateral (
      select count(*)::int as team_members
      from public.tenant_members tm
      where tm.tenant_id = t.id
    ) m on true
    left join public.tenant_admin_notes notes on notes.tenant_id = t.id
  ) x;

  return jsonb_build_object(
    'actorRole', v_role,
    'generatedAt', now(),
    'tenants', v_tenants
  );
end;
$$;

create or replace function public.platform_admin_mutate_tenant(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_action text,
  p_value text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_days integer;
  v_old jsonb;
begin
  select pa.role into v_role
  from public.platform_admins pa
  where pa.user_id = p_actor_user_id;

  if v_role <> 'admin' then
    raise exception 'Platform admin role required for this action' using errcode = '42501';
  end if;
  if not exists (select 1 from public.tenants t where t.id = p_tenant_id) then
    raise exception 'Tenant not found' using errcode = 'P0002';
  end if;

  if p_action = 'set_subscription_status' then
    if p_value not in ('trial', 'active', 'past_due', 'grace', 'suspended', 'cancelled') then
      raise exception 'Unsupported subscription status' using errcode = '22023';
    end if;
    select to_jsonb(s) into v_old from public.tenant_subscriptions s where s.tenant_id = p_tenant_id;
    update public.tenant_subscriptions
    set status = p_value, updated_at = now()
    where tenant_id = p_tenant_id;

  elsif p_action = 'extend_trial_days' then
    begin
      v_days := p_value::integer;
    exception when others then
      raise exception 'Trial extension must be a whole number of days' using errcode = '22023';
    end;
    if v_days < 1 or v_days > 90 then
      raise exception 'Trial extension must be between 1 and 90 days' using errcode = '22023';
    end if;
    select to_jsonb(s) into v_old from public.tenant_subscriptions s where s.tenant_id = p_tenant_id;
    update public.tenant_subscriptions
    set status = 'trial',
        trial_ends_at = greatest(coalesce(trial_ends_at, now()), now()) + make_interval(days => v_days),
        updated_at = now()
    where tenant_id = p_tenant_id;

  elsif p_action = 'set_whatsapp_status' then
    if p_value not in ('not_connected', 'pending', 'connected', 'error') then
      raise exception 'Unsupported WhatsApp status' using errcode = '22023';
    end if;
    select jsonb_build_object('whatsappStatus', t.whatsapp_connection_status) into v_old
    from public.tenants t where t.id = p_tenant_id;
    update public.tenants
    set whatsapp_connection_status = p_value, updated_at = now()
    where id = p_tenant_id;

  elsif p_action = 'set_support_note' then
    if char_length(coalesce(p_value, '')) > 4000 then
      raise exception 'Support note is too long' using errcode = '22023';
    end if;
    select jsonb_build_object('supportNote', n.support_note) into v_old
    from public.tenant_admin_notes n where n.tenant_id = p_tenant_id;
    insert into public.tenant_admin_notes (tenant_id, support_note, updated_by_user_id, updated_at)
    values (p_tenant_id, nullif(btrim(coalesce(p_value, '')), ''), p_actor_user_id, now())
    on conflict (tenant_id) do update
    set support_note = excluded.support_note,
        updated_by_user_id = excluded.updated_by_user_id,
        updated_at = now();

  else
    raise exception 'Unsupported platform admin action' using errcode = '22023';
  end if;

  insert into public.platform_admin_audit (actor_user_id, tenant_id, action, detail)
  values (
    p_actor_user_id,
    p_tenant_id,
    p_action,
    jsonb_build_object('previous', coalesce(v_old, 'null'::jsonb), 'requestedValue', p_value)
  );
end;
$$;

revoke all on function public.platform_admin_overview(uuid) from public, anon, authenticated;
revoke all on function public.platform_admin_mutate_tenant(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.platform_admin_overview(uuid) to service_role;
grant execute on function public.platform_admin_mutate_tenant(uuid, uuid, text, text) to service_role;
