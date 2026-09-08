# OrderDesk Live Activation Checklist

Dedicated Supabase project: `OrderDesk` (`eujxswjspolugrzlsjnn`).

## Completed

- MVP schema applied.
- RLS enabled on all application tables.
- Anonymous SELECT denied on all application tables.
- Authenticated access restricted through tenant membership policies.
- Same-tenant composite foreign keys enforced.
- Foreign-key covering indexes added.
- `orders` and `order_items` added to Realtime publication.
- Supabase security advisor clean.
- WhatsApp webhook Edge Function deployed and active.
- Mobile `.env.example` bound to project URL and publishable key.
- Mobile TypeScript CI green after live project binding.

## Required before first real WhatsApp order

1. Configure Edge Function secrets:
   - `META_WEBHOOK_VERIFY_TOKEN`
   - `META_APP_SECRET`
   - optional `ORDER_PARSER_URL`
   - optional `ORDER_PARSER_TOKEN`
2. Create the first merchant in Supabase Auth.
3. Insert a tenant and matching `tenant_members` row for that Auth user.
4. Set the tenant `whatsapp_phone_number_id` to the Meta phone-number ID.
5. Subscribe Meta WhatsApp Cloud API to the deployed webhook.
6. Send a real WhatsApp order and verify it becomes a `needs_review` order.
7. Sign into the merchant mobile app and accept the order.

## Pass condition

The OD-02 live pipeline passes only when a customer WhatsApp message produces one idempotent structured order visible to the correct authenticated tenant, and the merchant can change its status from `needs_review` to `accepted` from the mobile app.
