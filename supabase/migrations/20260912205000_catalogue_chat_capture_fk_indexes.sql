create index if not exists inbound_message_media_inbound_message_idx
  on public.inbound_message_media (inbound_message_id);

create index if not exists inbound_message_media_customer_idx
  on public.inbound_message_media (customer_id);

create index if not exists catalogue_capture_candidates_inbound_message_idx
  on public.catalogue_capture_candidates (inbound_message_id);

create index if not exists catalogue_capture_candidates_customer_idx
  on public.catalogue_capture_candidates (customer_id);

create index if not exists catalogue_capture_candidates_catalog_item_idx
  on public.catalogue_capture_candidates (catalog_item_id)
  where catalog_item_id is not null;
