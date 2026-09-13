-- Merchant catalogue images selected from device gallery.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) values (
  'catalogue-images',
  'catalogue-images',
  true,
  5242880,
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "SellerTray catalogue image upload" on storage.objects;
create policy "SellerTray catalogue image upload"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'catalogue-images'
  and exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id::text = (storage.foldername(name))[1]
      and tm.user_id = auth.uid()
      and tm.role in ('owner','manager')
      and public.orderdesk_subscription_can_write(tm.tenant_id)
  )
);

drop policy if exists "SellerTray catalogue image update" on storage.objects;
create policy "SellerTray catalogue image update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'catalogue-images'
  and exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id::text = (storage.foldername(name))[1]
      and tm.user_id = auth.uid()
      and tm.role in ('owner','manager')
      and public.orderdesk_subscription_can_write(tm.tenant_id)
  )
)
with check (
  bucket_id = 'catalogue-images'
  and exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id::text = (storage.foldername(name))[1]
      and tm.user_id = auth.uid()
      and tm.role in ('owner','manager')
      and public.orderdesk_subscription_can_write(tm.tenant_id)
  )
);

drop policy if exists "SellerTray catalogue image delete" on storage.objects;
create policy "SellerTray catalogue image delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'catalogue-images'
  and exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id::text = (storage.foldername(name))[1]
      and tm.user_id = auth.uid()
      and tm.role in ('owner','manager')
      and public.orderdesk_subscription_can_write(tm.tenant_id)
  )
);
