# OrderDesk

OrderDesk is a lightweight AI-assisted order management SaaS for small merchants who sell through WhatsApp.

## Product contract

- Customers stay on WhatsApp.
- Merchants operate from a mobile app.
- OrderDesk converts free-form customer messages into structured draft orders.
- Merchants confirm, edit, accept, reject, and progress orders from the app.
- The MVP is intentionally not an ERP, POS, inventory suite, CRM, or accounting system.

## MVP vertical slice

1. WhatsApp message arrives.
2. Webhook stores the conversation event.
3. Order parser turns order intent into a structured draft.
4. Merchant sees the draft in the mobile inbox.
5. Merchant reviews and accepts it.
6. Order status is updated and can be communicated back to the customer.

## Proposed stack

- Mobile: Expo + React Native + TypeScript
- Backend: Supabase Postgres, Auth, Realtime and Edge Functions
- WhatsApp: Meta WhatsApp Cloud API webhook adapter
- AI: provider-neutral order parsing boundary so the model can be changed without changing domain logic

Implementation begins on a feature branch after this repository bootstrap commit.
