begin;

-- SellerTray commercial price versions are immutable historical facts. A future
-- standard price that was published in error must therefore be neutralised by
-- append-only void evidence, never UPDATE/DELETE. Only future, unused standard
-- subscription pairs are eligible for this correction path.

create table if not exists public.sellertray_commercial_price_version_voids (
  id uuid primary key default gen_random_uuid(),
  price_version_id uuid not null unique references public.sellertray_commercial_price_versions(id) on delete restrict,
  command_id uuid not null,
  voided_by_user_id uuid not null,
  voided_at timestamptz not null default now(),
  reason text not null,
  constraint sellertray_commercial_price_version_voids_reason_check
    check (char_length(btrim(reason)) between 6 and 1000)
);

create index if not exists sellertray_commercial_price_version_voids_command_idx
  on public.sellertray_commercial_price_version_voids(command_id,voided_at);

alter table public.sellertray_commercial_price_version_voids enable row level security;
revoke all on table public.sellertray_commercial_price_version_voids from public,anon,authenticated;
grant select,insert on table public.sellertray_commercial_price_version_voids to service_role;

create trigger prevent_sellertray_commercial_price_version_void_mutation
before update or delete on public.sellertray_commercial_price_version_voids
for each row execute function public.prevent_sellertray_commercial_history_mutation();

comment on table public.sellertray_commercial_price_version_voids is
  'Append-only evidence that a future, unused standard commercial price version was voided before it became effective. The original immutable price row remains preserved.';

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
      and not exists (
        select 1
        from public.sellertray_commercial_price_version_voids v
        where v.price_version_id=p.id
      )
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
      and not exists (
        select 1
        from public.sellertray_commercial_price_version_voids v
        where v.price_version_id=p.id
      )
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
         (
           c.net_amount is null and m.net_amount is null
           and c.tax_rate_percent is null and m.tax_rate_percent is null
           and c.tax_amount is null and m.tax_amount is null
         )
         or
         (
           c.net_amount is not null and m.net_amount is not null
           and c.tax_rate_percent is not distinct from m.tax_rate_percent
           and abs(c.net_amount-(m.net_amount*10))<0.005
           and abs(c.tax_amount-(m.tax_amount*10))<0.005
         )
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
    and not exists (
      select 1
      from public.sellertray_commercial_price_version_voids v
      where v.price_version_id=p.id
    )
    and (
      (p.price_scope='merchant_override' and p.tenant_id=p_tenant_id)
      or
      (p.price_scope='standard' and p.tenant_id is null)
    )
  order by
    case when p.price_scope='merchant_override' then 1 else 0 end desc,
    p.effective_from desc,
    p.created_at desc,
    p.id desc
  limit 1;
$$;

comment on function public.resolve_sellertray_commercial_price_version(text,text,text,text,timestamptz) is
  'Resolves effective global SellerTray commercial pricing while excluding append-only voided future versions and preserving annual 10-for-12 coherence.';
comment on function public.resolve_sellertray_commercial_price_version_for_tenant(uuid,text,text,text,text,timestamptz) is
  'Resolves selected-Business commercial pricing, preferring merchant overrides and excluding any append-only voided price versions.';

create or replace function public.void_sellertray_future_standard_subscription_price_pair_admin(
  p_monthly_price_version_id uuid,
  p_reason text,
  p_command_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
set search_path=''
as $$
declare
  v_role text;
  v_reason text:=btrim(coalesce(p_reason,''));
  v_monthly public.sellertray_commercial_price_versions%rowtype;
  v_yearly public.sellertray_commercial_price_versions%rowtype;
  v_monthly_void_id uuid;
  v_yearly_void_id uuid;
  v_existing_count integer:=0;
begin
  select pa.role into v_role
  from public.platform_admins pa
  where pa.user_id=p_actor_user_id;

  if v_role is distinct from 'admin' then
    raise exception 'Platform admin role required for this action' using errcode='42501';
  end if;
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.pricing.manage',null,now()) then
    raise exception 'Platform pricing management capability required' using errcode='42501';
  end if;
  if p_monthly_price_version_id is null or p_command_id is null then
    raise exception 'Future monthly price version and command are required' using errcode='22023';
  end if;
  if char_length(v_reason) not between 6 and 1000 then
    raise exception 'Commercial correction reason must be between 6 and 1000 characters' using errcode='22023';
  end if;

  select p.* into v_monthly
  from public.sellertray_commercial_price_versions p
  where p.id=p_monthly_price_version_id
  for share;

  if not found then
    raise exception 'Standard monthly subscription price version not found' using errcode='P0002';
  end if;
  if v_monthly.price_scope<>'standard' or v_monthly.tenant_id is not null
     or v_monthly.price_kind<>'subscription' or v_monthly.billing_cycle<>'monthly'
     or v_monthly.status<>'published' then
    raise exception 'Only a published standard monthly subscription price may be voided by this command' using errcode='22023';
  end if;
  if v_monthly.effective_from<=now() then
    raise exception 'Only a future standard subscription price may be voided' using errcode='22023';
  end if;

  select p.* into v_yearly
  from public.sellertray_commercial_price_versions p
  where p.price_scope='standard'
    and p.tenant_id is null
    and p.price_kind='subscription'
    and p.plan_code=v_monthly.plan_code
    and p.billing_cycle='yearly'
    and p.currency=v_monthly.currency
    and p.effective_from=v_monthly.effective_from
    and p.status='published'
  order by p.created_at desc,p.id desc
  limit 1
  for share;

  if not found then
    raise exception 'Matching governed annual subscription price version not found' using errcode='P0002';
  end if;
  if abs(v_yearly.gross_amount-(v_monthly.gross_amount*10))>=0.005 then
    raise exception 'Future subscription price pair violates the governed 10-for-12 relationship' using errcode='22023';
  end if;

  select count(*)::integer into v_existing_count
  from public.sellertray_commercial_price_version_voids v
  where v.price_version_id in (v_monthly.id,v_yearly.id);

  if v_existing_count=2 then
    select v.id into v_monthly_void_id from public.sellertray_commercial_price_version_voids v where v.price_version_id=v_monthly.id;
    select v.id into v_yearly_void_id from public.sellertray_commercial_price_version_voids v where v.price_version_id=v_yearly.id;
    return jsonb_build_object(
      'monthlyPriceVersionId',v_monthly.id,'yearlyPriceVersionId',v_yearly.id,
      'monthlyVoidId',v_monthly_void_id,'yearlyVoidId',v_yearly_void_id,
      'alreadyVoided',true
    );
  elsif v_existing_count<>0 then
    raise exception 'Future subscription price pair has incomplete void evidence and requires operational review' using errcode='23514';
  end if;

  if exists (
    select 1 from public.sellertray_commercial_order_price_snapshots s
    where s.source_price_version_id in (v_monthly.id,v_yearly.id)
  ) then
    raise exception 'A price version already snapshotted into a commercial order cannot be voided' using errcode='23514';
  end if;
  if exists (
    select 1 from public.sellertray_commercial_price_versions p
    where p.source_standard_price_version_id in (v_monthly.id,v_yearly.id)
  ) then
    raise exception 'A standard price version already referenced by a Business override cannot be voided' using errcode='23514';
  end if;

  insert into public.sellertray_commercial_price_version_voids(
    price_version_id,command_id,voided_by_user_id,reason
  ) values(v_monthly.id,p_command_id,p_actor_user_id,v_reason)
  returning id into v_monthly_void_id;

  insert into public.sellertray_commercial_price_version_voids(
    price_version_id,command_id,voided_by_user_id,reason
  ) values(v_yearly.id,p_command_id,p_actor_user_id,v_reason)
  returning id into v_yearly_void_id;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(p_actor_user_id,null,'sellertray_void_future_subscription_price_pair',jsonb_build_object(
    'commandId',p_command_id,
    'monthlyPriceVersionId',v_monthly.id,
    'yearlyPriceVersionId',v_yearly.id,
    'planCode',v_monthly.plan_code,
    'currency',v_monthly.currency,
    'effectiveFrom',v_monthly.effective_from,
    'monthlyGrossAmount',v_monthly.gross_amount,
    'yearlyGrossAmount',v_yearly.gross_amount,
    'reason',v_reason
  ));

  return jsonb_build_object(
    'monthlyPriceVersionId',v_monthly.id,'yearlyPriceVersionId',v_yearly.id,
    'monthlyVoidId',v_monthly_void_id,'yearlyVoidId',v_yearly_void_id,
    'alreadyVoided',false
  );
end;
$$;

revoke all on function public.void_sellertray_future_standard_subscription_price_pair_admin(uuid,text,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.void_sellertray_future_standard_subscription_price_pair_admin(uuid,text,uuid,uuid)
  to service_role;

comment on function public.void_sellertray_future_standard_subscription_price_pair_admin(uuid,text,uuid,uuid) is
  'AAL2 Admin transport target for append-only voiding of an unused future standard monthly+yearly subscription pair. Never mutates the original price rows.';

-- Preserve the existing onboarding read model and authority separation while
-- annotating immutable price history with append-only void evidence.
create or replace function public.get_sellertray_commercial_onboarding_admin(
  p_actor_user_id uuid,
  p_tenant_id uuid
)
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
  select pa.role into v_role
  from public.platform_admins pa
  where pa.user_id=p_actor_user_id;

  if coalesce(v_role,'') not in ('admin','support') then
    raise exception 'Platform administrator access required' using errcode='42501';
  end if;

  v_result:=public.get_sellertray_commercial_onboarding_admin_impl(
    p_actor_user_id,
    p_tenant_id
  );

  select coalesce(jsonb_agg(
    e.item || jsonb_build_object(
      'voided',v.id is not null,
      'voidedAt',v.voided_at,
      'voidReason',v.reason
    ) order by e.ordinality
  ),'[]'::jsonb)
  into v_prices
  from jsonb_array_elements(coalesce(v_result->'prices','[]'::jsonb)) with ordinality as e(item,ordinality)
  left join public.sellertray_commercial_price_version_voids v
    on v.price_version_id=(e.item->>'id')::uuid;

  v_result:=jsonb_set(v_result,'{prices}',v_prices,true);

  return v_result || jsonb_build_object(
    'canManage',v_role='admin',
    'canManageGlobalPricing',v_role='admin' and public.platform_admin_has_capability(
      p_actor_user_id,'admin.pricing.manage',null,now()
    ),
    'canManageMerchantPricing',public.platform_admin_has_capability(
      p_actor_user_id,'admin.pricing.manage',p_tenant_id,now()
    )
  );
end;
$$;

comment on function public.get_sellertray_commercial_onboarding_admin(uuid,uuid) is
  'Admin commercial onboarding read model with separate order/global-pricing/Business-pricing authority plus immutable future-price void evidence.';

commit;
