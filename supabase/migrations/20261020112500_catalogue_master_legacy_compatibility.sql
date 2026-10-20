begin;

-- Pre-create the catalogue master tables without imposing new length limits on
-- historical values. Managed Product/UOM commands already enforce their
-- existing input limits; this compatibility boundary allows older catalogue
-- data created by legacy/internal paths to backfill without aborting migration.
create table if not exists public.sellertray_product_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (nullif(btrim(name), '') is not null),
  normalized_name text generated always as (lower(btrim(name))) stored,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, normalized_name)
);

create table if not exists public.sellertray_uoms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (nullif(btrim(name), '') is not null),
  normalized_name text generated always as (lower(btrim(name))) stored,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, normalized_name)
);

alter table public.sellertray_product_categories enable row level security;
alter table public.sellertray_uoms enable row level security;

revoke all on table public.sellertray_product_categories from public, anon, authenticated;
revoke all on table public.sellertray_uoms from public, anon, authenticated;
grant all on table public.sellertray_product_categories to service_role;
grant all on table public.sellertray_uoms to service_role;

commit;
