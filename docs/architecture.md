# OrderDesk MVP Architecture

## Product boundary

OrderDesk solves one narrow merchant problem: turn WhatsApp order messages into an organised order workflow without forcing the customer into another app.

Customers stay on WhatsApp. Merchants use the OrderDesk mobile app.

OrderDesk is not intended to become an ERP, POS, inventory suite, accounting package or CRM.

## Core flow

1. Customer sends a WhatsApp message to a merchant number.
2. Meta WhatsApp Cloud API sends the webhook to the OrderDesk Edge Function.
3. The function verifies the request signature before parsing it.
4. The WhatsApp phone-number ID resolves the correct OrderDesk tenant.
5. The inbound provider message is stored idempotently.
6. The customer is upserted within that tenant.
7. A parser converts message text into structured order lines. A provider-neutral AI parser may be configured; otherwise a conservative fallback parser is used.
8. The order is created as `needs_review`.
9. The authenticated merchant sees the order through tenant-scoped RLS.
10. The merchant corrects AI/parser output where necessary: line name, quantity and selling price; lines may also be added or removed.
11. The order cannot be accepted unless it has at least one line and every line is priced.
12. The merchant progresses the accepted order through `processing`, `ready` and `completed`.

## Trust boundaries

### Public WhatsApp webhook

The Meta webhook is intentionally public and does not rely on a Supabase user JWT. It is protected by Meta's `X-Hub-Signature-256` HMAC signature using the app secret stored only in Edge Function secret storage.

The webhook verification token and Meta app secret must never be stored in the mobile client or committed to source control.

### Merchant client

The Expo/React Native client uses only the Supabase publishable key and an authenticated merchant session.

All merchant data access is filtered by Row Level Security through `tenant_members`. The client never receives or uses a Supabase server/service credential.

Merchant UI rules are convenience and guidance, not the final integrity boundary. Supported status transitions and acceptance prerequisites are also enforced in Postgres.

## Data model

- `tenants` — OrderDesk businesses and WhatsApp phone-number mapping.
- `tenant_members` — authenticated merchant membership and role.
- `customers` — tenant-scoped WhatsApp customers.
- `catalog_items` — optional tenant catalogue and selling prices.
- `inbound_messages` — source-message record used for idempotency/audit.
- `orders` — merchant workflow state and parser confidence.
- `order_items` — structured/corrected order lines with generated line totals.

Composite foreign keys prevent cross-tenant customer, message, order and catalogue references even if application logic is faulty.

## Status integrity

The supported normal workflow is:

`draft / needs_review -> accepted -> processing -> ready -> completed`

Review orders may instead become `rejected`. Accepted/processing/ready orders may be cancelled.

A database trigger prevents unsupported transitions, prevents terminal states from regressing, and prevents acceptance of empty or unpriced orders. This protects the workflow even if a modified client bypasses UI controls.

## Merchant correction boundary

OD-03 keeps correction deliberately narrow. During `draft` / `needs_review`, a merchant may:

- correct the parsed item name;
- correct quantity;
- set the selling price;
- add a missing line;
- remove an incorrect line.

Once an order is accepted, line editing is removed from the ordinary merchant flow. This keeps the order record stable after operational commitment without introducing inventory, quotation, invoicing or ERP concepts.

Catalogue matching can later assist this review flow, but it must not remove the merchant's final acceptance step.

## Realtime

For the small MVP, Supabase Postgres Changes subscriptions refresh the merchant inbox when `orders` or `order_items` change. This keeps implementation deliberately small. If scale later requires it, Realtime Broadcast can replace the subscription mechanism without changing the product workflow.

## Parser contract

The webhook accepts an optional external parser endpoint. The parser is expected to return structured order lines conservatively. It must not auto-accept an order. The merchant remains the final reviewer before an order enters processing.

Catalogue matching and stronger AI extraction can be added later behind the same review boundary.
