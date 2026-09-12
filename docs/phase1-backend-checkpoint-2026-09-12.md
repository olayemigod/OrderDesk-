# SellerTray Phase 1 backend checkpoint — 12 September 2026

This checkpoint freezes the live Supabase work completed after the stalled implementation thread.

## Live runtime

- `whatsapp-webhook` v30
- `catalogue-from-chat` v1
- `channel-consent` v1

## Included migrations

- 20260912151931 — whatsapp_chat_catalogue_capture_foundation
- 20260912152034 — catalogue_chat_candidate_atomic_commands
- 20260912152143 — catalogue_chat_capture_fk_indexes
- 20260912152301 — whatsapp_data_processing_consent

## Contract enforced here

1. Inbound WhatsApp images are captured as message-media metadata; they do not become catalogue products automatically.
2. Only SellerTray Owners/Managers can create, reject or convert catalogue chat candidates.
3. Conversion verifies the Meta image payload and publishes an approved product image into SellerTray catalogue storage.
4. WhatsApp message content is not persisted or processed unless the tenant has an active consent for the current WhatsApp data-processing policy.
5. Only the business Owner may accept or revoke that tenant-level WhatsApp processing consent.
6. The privileged conversion/rejection database commands are executable by `service_role` only.
