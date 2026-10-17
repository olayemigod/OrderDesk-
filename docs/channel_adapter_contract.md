# SellerTray Channel Adapter Contract

SellerTray treats WhatsApp, Instagram, Messenger, web chat and future agents as transport/origin adapters. No channel owns SellerTray's commercial truth.

## Canonical flow

Channel event → normalized customer identity → conversation intent → SellerTray policy/workflow engine → canonical customer/order/payment/fulfilment records → channel-specific response.

## Adapter responsibilities

Every inbound adapter must provide:

- channel name
- tenant/business identity
- external customer identity
- external message/event identity
- original customer content
- event timestamp
- media/order payload metadata where available
- idempotency identity

Adapters may normalize transport details but must not directly:

- mark an order paid
- refund funds
- complete fulfilment
- bypass payment/delivery policy
- alter merchant permissions
- mutate financial evidence outside the SellerTray workflow engine

## SellerTray-owned state

The canonical records remain outside Meta and other channel providers:

- customers
- catalogue items and aliases
- customer enquiries
- orders and order items
- financial documents
- payment attempts and reconciliation
- fulfilment evidence
- merchant roles and permissions
- conversation intent telemetry
- commercial action ledger

## Conversation interpretation

The shared intent layer uses:

1. vocabulary
2. workflow/customer context
3. deterministic rules
4. selective AI fallback
5. clarification when unsafe

Channel-specific commands are optional shortcuts only. Customers are never required to learn SellerTray syntax.

## Commercial-action rule

AI may interpret intent. AI does not independently authorize money movement or protected state transitions.

Every commercial action must have an idempotent action identity and, where applicable:

- interpretation source and confidence
- customer/source message
- target order
- risk class
- policy result
- action result
- financial impact
- audit metadata

## Enquiry versus purchase

Questions such as:

- "How much is a bag of rice?"
- "Do you have rice?"
- "What sizes are available?"

are enquiries, not orders.

Purchase commitment requires clear buying/supply intent or a contextual follow-up to an enquiry, for example:

- "Give me two bags."
- "Okay, I will take one."
- "Send two."

A recent enquiry may provide product context, but ambiguity must lead to clarification instead of creating an incorrect order.
