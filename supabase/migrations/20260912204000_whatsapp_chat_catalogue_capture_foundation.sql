create table if not exists public.inbound_message_media (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  inbound_message_id uuid not null references public.inbound_messages(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  media_type text not null check (media_type in ('image')),
  provider_media_id text not null,
  media_caption text,
  media_mime_type text,
  media_sha256 text,
  media_file_size bigint check (media_file_size is null or media_file_size >= 0),
  storage_bucket text,
  storage_path text,
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, inbound_message_id),
  unique (provider_media_id),
  check (
    (storage_bucket is null and storage_path is null)
    or
    (storage_bucket is not null and storage_path is not null)
  )
);

create index if not exists inbound_message_media_tenant_created_idx
  on public.inbound_message_media (tenant_id, created_at desc);

create index if not exists inbound_message_media_customer_created_idx
  on public.inbound_message_media (tenant_id, customer_id, created_at desc);

create table if not exists public.catalogue_capture_candidates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  inbound_message_id uuid not null references public.inbound_messages(id) on delete cascade,
  source_media_id uuid not null references public.inbound_message_media(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  suggested_name text,
  suggested_category text,
  suggested_price_ngn numeric(14,2) check (suggested_price_ngn is null or suggested_price_ngn >= 0),
  status text not null default 'pending' check (status in ('pending','rejected','converted')),
  review_note text,
  catalog_item_id uuid references public.catalog_items(id) on delete restrict,
  created_by uuid not null,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, inbound_message_id),
  unique (source_media_id),
  check (
    (status = 'converted' and catalog_item_id is not null and reviewed_at is not null and reviewed_by is not null)
    or
    (status <> 'converted' and catalog_item_id is null)
  ),
  check (
    (status = 'pending' and reviewed_at is null and reviewed_by is null)
    or
    (status <> 'pending' and reviewed_at is not null and reviewed_by is not null)
  )
);

create index if not exists catalogue_capture_candidates_tenant_status_idx
  on public.catalogue_capture_candidates (tenant_id, status, created_at desc);

alter table public.inbound_message_media enable row level security;
alter table public.catalogue_capture_candidates enable row level security;

revoke all on public.inbound_message_media from anon, authenticated;
revoke all on public.catalogue_capture_candidates from anon, authenticated;

grant select on public.inbound_message_media to authenticated;
grant select on public.catalogue_capture_candidates to authenticated;

drop policy if exists inbound_message_media_select_member on public.inbound_message_media;
create policy inbound_message_media_select_member
on public.inbound_message_media
for select
to authenticated
using (
  exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = inbound_message_media.tenant_id
      and tm.user_id = (select auth.uid())
  )
);

drop policy if exists catalogue_capture_candidates_select_member on public.catalogue_capture_candidates;
create policy catalogue_capture_candidates_select_member
on public.catalogue_capture_candidates
for select
to authenticated
using (
  exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = catalogue_capture_candidates.tenant_id
      and tm.user_id = (select auth.uid())
  )
);
