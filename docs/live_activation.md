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
- WhatsApp webhook Edge Function deployed and active.
- Meta webhook verification configured and passed.
- Meta `messages` webhook subscription configured.
- HMAC `X-Hub-Signature-256` validation passed.
- Real merchant tenant mapped to its WhatsApp phone-number ID.
- Isolated temporary Meta test tenant created for the dashboard sample phone-number ID; real tenant mapping was left unchanged.
- Meta sample webhook created exactly one customer, one inbound message and one `needs_review` order.
- Replaying the same provider message ID created no duplicate inbound message or order.
- Merchant Auth access and tenant-scoped RLS reads verified.
- Expo Web acceptance path added so the merchant workflow can be tested on PC without blocking on local Android networking.
- Merchant accepted the first test order and progressed it end-to-end: `needs_review -> accepted -> processing -> ready -> completed`.
- Final `completed` status verified directly in Supabase.
- OD-03 server-side status guard deployed: terminal states cannot regress and only supported workflow transitions are allowed.
- Order acceptance now requires at least one line item and every line item to have a selling price.
- Status-guard database verification passed for empty-order rejection, unpriced-order rejection, legal progression and terminal-state enforcement.
- Merchant review editor implemented for `draft` / `needs_review` orders: add, edit and remove order items; correct quantity/name; set selling price.
- Client disables Accept until the order has at least one fully priced item.
- OD-03 correction test order seeded in the isolated test tenant for merchant acceptance.

## OD-02 acceptance status

The backend and merchant workflow acceptance test has passed using the PC web client against the live Supabase project.

Verified path:

`Meta webhook -> signature validation -> tenant resolution -> customer/inbound storage -> needs_review order -> authenticated merchant inbox -> accepted -> processing -> ready -> completed`

This proves the live tenant/RLS/order-state path independently of the outstanding native-device transport issue.

## OD-03 merchant review hardening

Implementation is complete and awaiting one merchant UI acceptance run.

The seeded correction order contains the message:

`I want 2 bags of rice and 3 bottles of oil`

with two unpriced parsed lines. The acceptance test should confirm that the merchant can correct the lines, enter selling prices, and only then accept the order.

## Still required before production WhatsApp launch

1. Complete the OD-03 merchant correction acceptance run.
2. Complete Meta business verification / production app publishing as required by Meta.
3. Send a real WhatsApp message through the actual production phone-number mapping and verify the same ingestion path.
4. Run one native Android/Expo smoke test when a suitable device transport is available; this is not a backend acceptance blocker.
5. Configure production SMTP for merchant authentication emails instead of relying on Supabase's restricted built-in development mail service.
6. Enable leaked-password protection when the selected Supabase plan supports it, or record the accepted plan limitation before launch.
7. Remove the isolated temporary Meta test tenant and temporary test merchant only after native smoke testing no longer needs them.
8. Configure production AI parsing and catalogue matching in later bounded MVP slices.

## Pass condition

OD-02 backend + merchant workflow acceptance is PASS when a signed WhatsApp webhook creates one idempotent tenant-scoped order and an authenticated merchant can progress it through the supported order states. This condition passed on 2026-09-09 using the isolated Meta sample tenant and PC web client.

OD-03 passes when a `needs_review` order cannot be accepted while empty/unpriced, the merchant can correct its order lines in the client, and the corrected order can then enter the normal accepted workflow.

Native Android smoke testing and the first real production WhatsApp message remain separate release-readiness checks.
