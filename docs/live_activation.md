# OrderDesk Live Activation Checklist

Dedicated Supabase project: `OrderDesk` (`eujxswjspolugrzlsjnn`).

## Completed

- MVP schema applied with tenant-scoped RLS and same-tenant foreign-key integrity.
- Anonymous application-table access denied.
- `orders` and `order_items` enabled for Realtime.
- WhatsApp webhook deployed with Meta verification and HMAC signature validation.
- Real merchant tenant mapped to the production WhatsApp phone-number ID.
- Isolated Meta test tenant used without altering the real mapping.
- Meta sample ingestion and duplicate-message idempotency verified.
- Merchant Auth/RLS access verified.
- PC web client acceptance completed through `needs_review -> accepted -> processing -> ready -> completed`.
- OD-03 server-side order-state guard deployed and database-tested.
- Empty or unpriced orders can no longer be accepted.
- Merchant review editor implemented for `draft` / `needs_review`: add, edit, remove, correct quantity/name and set selling price.
- Client Accept is disabled until at least one fully priced line exists.
- Mobile CI #20 passed for the OD-03 client implementation.
- OD-03 correction test order seeded in the isolated tenant.

## Current acceptance checkpoint

OD-02 backend + merchant workflow: **PASS**.

OD-03 order correction: implementation complete; one merchant UI acceptance run remains.

Test message:

`I want 2 bags of rice and 3 bottles of oil`

The seeded order has two unpriced parsed lines. Merchant acceptance should verify that prices/details can be corrected and that Accept becomes available only after both lines are valid.

## Release-readiness gaps

1. Complete OD-03 merchant correction acceptance.
2. Complete Meta production/business verification and send one real production WhatsApp order.
3. Run one native Android smoke test when device transport is available.
4. Configure production SMTP for Auth emails.
5. Address or formally accept the Supabase Auth leaked-password-protection warning based on plan capability: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
6. Remove temporary Meta/test-user fixtures after native smoke testing.
7. Add production AI parsing and catalogue matching in later bounded slices.

Performance advisor currently reports only unused-index INFO findings, expected at the current low data volume.
