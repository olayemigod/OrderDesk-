begin;

-- Reconcile the Commercial Flexibility price-scope schema already active in
-- production. Existing C1 prices are standard platform prices. Business-specific
-- overrides must reference the exact standard version they derive from.
alter table public.sellertray_commercial_price_versions
  add column if not exists tenant_id uuid,
  add column if not exists price_scope text not null default 'standard',
  add column if not exists source_standard_price_version_id uuid;

update public.sellertray_commercial_price_versions
set price_scope='standard'
where price_scope is null;

alter table public.sellertray_commercial_price_versions
  drop constraint if exists sellertray_commercial_price_versions_scope_check,
  add constraint sellertray_commercial_price_versions_scope_check
    check (price_scope in ('standard','merchant_override')),
  drop constraint if exists sellertray_commercial_price_versions_scope_subject_check,
  add constraint sellertray_commercial_price_versions_scope_subject_check
    check (
      (price_scope='standard' and tenant_id is null and source_standard_price_version_id is null)
      or
      (price_scope='merchant_override' and tenant_id is not null and source_standard_price_version_id is not null)
    );

do $migration$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.sellertray_commercial_price_versions'::regclass
      and conname='sellertray_commercial_price_versions_tenant_id_fkey'
  ) then
    alter table public.sellertray_commercial_price_versions
      add constraint sellertray_commercial_price_versions_tenant_id_fkey
      foreign key (tenant_id) references public.tenants(id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.sellertray_commercial_price_versions'::regclass
      and conname='sellertray_commercial_price_v_source_standard_price_versio_fkey'
  ) then
    alter table public.sellertray_commercial_price_versions
      add constraint sellertray_commercial_price_v_source_standard_price_versio_fkey
      foreign key (source_standard_price_version_id)
      references public.sellertray_commercial_price_versions(id) on delete restrict;
  end if;
end
$migration$;

drop index if exists public.sellertray_commercial_subscription_price_version_key;
create unique index sellertray_commercial_subscription_price_version_key
  on public.sellertray_commercial_price_versions(plan_code,billing_cycle,currency,effective_from)
  where price_kind='subscription' and price_scope='standard';

drop index if exists public.sellertray_commercial_branch_setup_price_version_key;
create unique index sellertray_commercial_branch_setup_price_version_key
  on public.sellertray_commercial_price_versions(currency,effective_from)
  where price_kind='branch_setup' and price_scope='standard';

create unique index if not exists sellertray_commercial_subscription_override_version_key
  on public.sellertray_commercial_price_versions(tenant_id,plan_code,billing_cycle,currency,effective_from)
  where price_kind='subscription' and price_scope='merchant_override';

create unique index if not exists sellertray_commercial_branch_setup_override_version_key
  on public.sellertray_commercial_price_versions(tenant_id,currency,effective_from)
  where price_kind='branch_setup' and price_scope='merchant_override';

drop index if exists public.sellertray_commercial_price_resolution_idx;
create index sellertray_commercial_price_resolution_idx
  on public.sellertray_commercial_price_versions(
    tenant_id,price_scope,price_kind,plan_code,billing_cycle,currency,effective_from desc,created_at desc
  );

commit;
