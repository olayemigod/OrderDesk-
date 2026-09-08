# OrderDesk MVP Architecture

## Product boundary

OrderDesk is deliberately narrower than an ERP or WhatsApp Business agent.

**Customer surface:** WhatsApp only.

**Merchant surface:** mobile app only.

**OrderDesk owns:** conversational order capture, structured order review, status progression, lightweight customer/order history, merchant catalogue/pricing references, and outbound order updates.

**OrderDesk does not own in MVP:** accounting, stock ledgers, procurement, payroll, full CRM, websites, generic AI chat, or complex workflow automation.

## First vertical slice

```text
Customer WhatsApp message
        |
        v
Meta WhatsApp Cloud API
        |
        v
Signed webhook
  - tenant resolution
  - idempotency
  - customer upsert
  - text parsing
        |
        v
Supabase Postgres
  - inbound_messages
  - orders
  - order_items
        |
        v
Merchant mobile app
  - inbox
  - review
  - accept/reject
  - processing -> ready -> completed
```

## Multi-tenancy

Every business record carries `tenant_id`. Merchant access is derived from `tenant_members`, and all mobile-facing tables are protected with Postgres Row Level Security. The WhatsApp webhook uses server credentials because it is the trusted ingestion boundary; service credentials must never be shipped in the mobile application.

## AI boundary

The webhook does not couple OrderDesk to one AI vendor. `ORDER_PARSER_URL` accepts raw customer text and returns structured line items plus confidence. This permits OpenAI or another parser to be introduced without changing the order database contract.

The deterministic fallback parser is intentionally conservative. All machine-created orders begin as `needs_review`, so low-confidence extraction cannot silently become a merchant commitment.

## MVP sequence

1. Foundation: domain model, mobile inbox, tenant-safe schema, WhatsApp webhook.
2. Live backend: dedicated Supabase project, Auth, mobile repository, realtime order refresh.
3. Merchant catalogue: price/item matching and order edit flow.
4. AI parser: production parser with confidence thresholds and catalogue grounding.
5. WhatsApp replies: acknowledgement, acceptance, ready-for-pickup/delivery, rejection/correction.
6. Merchant onboarding: business profile, WhatsApp number connection, staff invite.
7. Billing and SaaS controls.

## Core success metric

A merchant should be able to turn a customer WhatsApp message into a reviewed, actionable order in under 30 seconds without copying the order into another tool.
