# SellerTray

SellerTray is a WhatsApp-first merchant order-management SaaS from ProcessEdge Solutions Limited.

> Historical note: this repository was bootstrapped under the working name **OrderDesk**. The approved production product name is **SellerTray**.

## Phase 1 product contract

- Customers remain on WhatsApp.
- Merchants use the SellerTray mobile app.
- WhatsApp webhook messages are processed only after current business-owner data-processing consent.
- AI-assisted order detection creates governed order records; ambiguous orders remain reviewable.
- Customer order progress can be communicated back over WhatsApp.
- Merchant payment methods support bank transfer, Paystack and Flutterwave foundations.
- Catalogue and customer records are first-class SellerTray domains.
- A merchant can select an inbound WhatsApp product image, create a catalogue candidate, review it, and explicitly convert it into a live catalogue item.
- Chat images never auto-publish as products.

## Backend

- Supabase Postgres, Auth, Storage and Edge Functions
- Meta WhatsApp Cloud API
- Provider-neutral order parser boundary
- Row-Level Security plus server-only privileged commands
- Versioned legal acceptance and WhatsApp channel consent

## Current checkpoint

The files under `supabase/` capture the live Phase 1 backend checkpoint deployed on 12 September 2026.
