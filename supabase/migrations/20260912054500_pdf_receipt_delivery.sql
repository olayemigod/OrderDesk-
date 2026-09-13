-- SellerTray PDF receipt delivery foundation.
-- Keeps receipts private in Storage, caches generated PDFs on completed orders,
-- and lets the governed WhatsApp worker deliver PDF documents.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 2097152, array['application/pdf']::text[])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types,
    updated_at = now();

alter table public.orders
  add column if not exists receipt_storage_path text,
  add column if not exists receipt_generated_at timestamptz,
  add column if not exists receipt_version integer not null default 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_receipt_version_check'
  ) then
    alter table public.orders
      add constraint orders_receipt_version_check
      check (receipt_version >= 1);
  end if;
end $$;

alter table public.outbound_notifications
  add column if not exists media_type text,
  add column if not exists storage_bucket text,
  add column if not exists storage_path text,
  add column if not exists media_filename text,
  add column if not exists media_mime_type text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.outbound_notifications'::regclass
      and conname = 'outbound_notifications_media_type_check'
  ) then
    alter table public.outbound_notifications
      add constraint outbound_notifications_media_type_check
      check (media_type is null or media_type = 'document');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.outbound_notifications'::regclass
      and conname = 'outbound_notifications_media_contract_check'
  ) then
    alter table public.outbound_notifications
      add constraint outbound_notifications_media_contract_check
      check (
        (
          media_type is null
          and storage_bucket is null
          and storage_path is null
          and media_filename is null
          and media_mime_type is null
        )
        or
        (
          media_type = 'document'
          and storage_bucket is not null
          and storage_path is not null
          and media_filename is not null
          and media_mime_type = 'application/pdf'
        )
      );
  end if;
end $$;


create or replace function public.guard_sellertray_receipt_cache()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (
    new.receipt_storage_path is distinct from old.receipt_storage_path
    or new.receipt_generated_at is distinct from old.receipt_generated_at
    or new.receipt_version is distinct from old.receipt_version
  ) and (select auth.uid()) is not null then
    raise exception 'SellerTray receipt cache is server-managed' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_sellertray_receipt_cache on public.orders;
create trigger guard_sellertray_receipt_cache
before update of receipt_storage_path, receipt_generated_at, receipt_version on public.orders
for each row
when (
  old.receipt_storage_path is distinct from new.receipt_storage_path
  or old.receipt_generated_at is distinct from new.receipt_generated_at
  or old.receipt_version is distinct from new.receipt_version
)
execute function public.guard_sellertray_receipt_cache();
