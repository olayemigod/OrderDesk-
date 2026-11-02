---
name: sellertray-c2-current-state-inventory-appendix
description: "C2-1 exact Branch-scope and server command-family appendix for the Commercial V2 current-state inventory."
metadata:
  author: ProcessEdge Solutions Limited
  product: SellerTray
  version: "0.1.1"
  status: governing-extension
  companion: "C2_CURRENT_STATE_INVENTORY.md"
  baseline_commit: "d8024c215850e0e9a3a0ce1496d1d0dd5d7cd150"
  inventory_date: "2026-11-02"
---

# C2 Current-State Inventory Appendix — Branch Scope and Command Families

This appendix is part of C2-1. It records the exact current Branch-scope rules and canonical server command families that C2-2 must use when classifying Features, Capabilities and Limits.

It describes baseline `d8024c215850e0e9a3a0ce1496d1d0dd5d7cd150`; it does not authorise runtime cutover.

## A. Current Branch-scope authority

Branch access is already server-authoritative and remains separate from plan entitlement.

### A.1 Current helpers

Production exposes:

- `get_sellertray_accessible_branches(tenant_id)`
- `sellertray_current_user_can_access_branch(tenant_id, branch_id)`
- `sellertray_current_user_can_read_branch(tenant_id, branch_id)`
- `sellertray_user_can_access_branch(tenant_id, branch_id, user_id)`
- `sellertray_user_can_operate_branch(tenant_id, branch_id, user_id)`
- `sellertray_user_can_read_branch(tenant_id, branch_id, user_id)`
- `sellertray_user_can_read_report_branch(tenant_id, branch_id, user_id)`
- `set_sellertray_member_branch_access(...)`
- `reset_sellertray_member_branch_access(...)`

### A.2 Owner/Manager

Current Owner/Manager behavior:

- operational access succeeds for active Branches in the Business;
- report scope may be Business-wide when no Branch is supplied;
- historical Branch read may remain available where the Branch record exists even when operational access requires an active Branch.

C2 must not convert this user/Branch authorization into Plan Profile grants.

### A.3 Cashier/internal `staff`

The merchant-facing role is **Cashier**; the current internal/database compatibility value is `staff`.

Current `staff`/Cashier Branch behavior is:

1. When explicit `branch_user_access` rows exist, operation/read is limited to Branches with `can_operate = true`.
2. When no explicit Branch-access row exists for the user, Cashier falls back to the Business default Branch.
3. Cashier cannot obtain Business-wide report scope by supplying a null Branch; report reads require a concrete readable Branch.

This is current compatibility behavior. C2 must not invent a separate `cashier` database role or duplicate Branch-scope model merely because user-facing terminology differs.

### A.4 Entitlement intersection

The correct conceptual action check is:

> **resolved Branch plan capability**
> ∩ **actor merchant capability/role**
> ∩ **actor Branch operation/read scope**
> ∩ **Business/Branch/transaction lifecycle state**
> ∩ **available limit/quota**

Examples:

- a plan may permit returns while a particular Cashier still lacks return permission;
- a user may have stock-transfer permission but cannot transfer from a Branch outside their assigned scope;
- a Branch may be commercially entitled to WhatsApp selling while WhatsApp connection/consent/configuration is not ready; entitlement does not manufacture operational readiness.

## B. Current server command families

SellerTray already has broad shared/domain command paths. C2 should add shared entitlement checks at canonical server/domain boundaries, not duplicate plan logic in clients.

### B.1 Commerce, orders and fulfilment

Current function families include:

- `pos-checkout`
- `pos-return`
- `merchant-order`
- `merchant-enquiry-action`
- `order-change-request`
- `order-draft-action`
- `order-fulfillment`
- `financial-document`
- `printer`

C2 implications:

- selling, returns, fulfilment and document/printing features can be catalogue candidates;
- entitlement checks belong at or below canonical server commands;
- stock/payment/UOM/idempotency correctness remains mandatory regardless of plan.

### B.2 Inventory and purchasing

Current families include:

- `inventory-operation`
- `stock-count`
- `stock-transfer`
- existing purchasing/receiving server authorities.

Advanced inventory/purchasing may become features/capabilities; Branch scope, UOM normalization and ledger integrity remain invariants.

### B.3 Cash, money and merchant payments

Current families include:

- `cash-shift`
- `money-operation`
- `merchant-payment-operations`
- `payment-runtime`
- `payment-settings`
- `paystack-payment-webhook`
- `flutterwave-payment-webhook`

Merchant customer-payment configuration remains a separate operational domain from ProcessEdge commercial subscription-payment methods. Plan entitlement never bypasses payment-state/idempotency rules.

### B.4 Team, membership and Business lifecycle

Current families include:

- `team-management`
- `platform-admin-team`
- `account-lifecycle`
- `provision-business`

Staff-seat limits/add-ons may be commercial candidates, but membership, role, capability and Branch assignment remain security authorities independent of plan packaging.

### B.5 WhatsApp commerce

Current families include:

- `whatsapp-connection`
- `whatsapp-catalog`
- `whatsapp-webhook`
- `send-whatsapp-notifications`
- `catalogue-from-chat`
- `channel-consent`
- `order-parser`

Related production RPCs cover consent, connection, Branch selection, runtime credential resolution, catalogue mapping, customer resolution and atomic WhatsApp-order creation.

C2 implications:

- WhatsApp selling/channel access can be a Feature/add-on;
- the webhook resolves the governed Branch and consults shared Branch entitlement before gated selling behavior;
- routing, consent, connection and catalogue readiness remain separate prerequisites;
- WhatsApp never creates Branch Subscription truth.

### B.6 AI

Current family: `merchant-ai`.

Merchant AI is authenticated, Owner/Manager-only today, read-only, rate-limited and backed by governed `sellertray_ai_insight_context`. Its instructions prohibit sales, stock, payment, purchasing, staff, WhatsApp, printer or settings mutations.

AI access/commercial usage can be catalogued, but abuse protection is not the same as a plan quota. AI may consume/explain entitlement facts and never create them.

### B.7 Commercial purchase, pricing, legal and settlement

Current families include:

- `commercial-billing`
- `billing-checkout`
- `commercial-price-controls`
- `commercial-price-overrides`
- `commercial-agreements` (legacy/historical compatibility)
- `master-agreement-prepurchase`
- `master-agreements`
- `platform-admin-commercial`
- `platform-admin-settlement`
- `platform-admin-setup-scheduling`
- `platform-payment-readiness`
- `usage-settlement`

C2 must preserve immutable price/order/installment/legal/payment evidence; replace Business subscription subjects with Branch Subscription subjects at C2-6; keep Master acceptance separate from Order Form confirmation; and never restore legacy commercial agreements as a second universal legal authority.

## C. Cross-surface action map

| Action class | Current surface(s) | Current authority pattern | C2 treatment |
|---|---|---|---|
| Sell/POS | Mobile; WhatsApp-derived orders | POS/order commands + Business-wide subscription write gate | Branch resolver + user/Branch scope; preserve commerce correctness. |
| Returns/refunds | Mobile/Merchant management | return command + `can_refund_sale` + transaction rules | Candidate plan capability intersected with user permission. |
| Stock receive/adjust/count/transfer | Mobile/Merchant Web | inventory commands + named capabilities + Branch scope | Candidate features/capabilities; never bypass UOM/ledger/Branch rules. |
| Shifts/cash/expense | Mobile/Merchant Web | cash/money commands + role/capability rules | Plan may affect advanced features, not cash/payment correctness. |
| Products/purchasing | Merchant Web; selected Mobile operations | shared product/inventory/purchasing authority | Package only higher-level feature/action; shared product truth remains one core. |
| Team/permissions | Merchant Web | membership/capability/Branch assignment | Possible seat/advanced-permission limits; security controls remain mandatory. |
| WhatsApp selling | WhatsApp + management surfaces | connection/webhook + Branch routing | Branch entitlement feature/add-on; channel never owns subscription. |
| AI insights | Mobile/Web | `merchant-ai` + governed read context | Entitlement/usage candidate; remains read-only. |
| Reports/exports | Mobile basic + Merchant Web full + Admin audit | read models + role/capability/Branch report scope | Catalogue report families/limits without weakening audit evidence. |
| Printing/devices | Mobile/Merchant Web | printer/device commands + merchant capabilities | Candidate advanced integration/device limits; transaction evidence remains. |
| Merchant Billing | Merchant Web | C1 order/price/legal/payment/setup authority | C2 Branch-by-Branch buy/renew/change management. |
| Commercial operations | Admin Web | Admin capabilities + AAL2/scope/audit | ProcessEdge authority; never merchant Plan Profile capability. |
| Offline selling/replay | Mobile | bounded cached Business write authority + canonical replay | Cache Branch/version entitlement; replay revalidates server authority. |

## D. C2-2 design warnings

1. Do not put Owner, Manager or Cashier/internal `staff` into Plan Profile grants; roles are user authorization.
2. Do not make `branch_user_access` a plan table; Branch assignment is actor scope.
3. Do not use one `can_sell` switch to replace payment, UOM, inventory, transaction-state or replay validation.
4. Do not model Admin capabilities as merchant package features.
5. Do not confuse operational API/rate limits with commercial usage limits.
6. Do not entitlement-gate historical read/audit evidence so aggressively that required compliance/support/financial history is lost.
7. When plan entitlement denies an action, return a stable server reason suitable for Mobile/Web/WhatsApp handling; hidden UI is not enforcement.
8. If entitlement changes while Mobile is offline, replay revalidates current server authority and fails safely without duplicate transaction effects.
9. Do not create a separate `cashier` role solely to match user-facing wording; internal `staff` remains the compatibility value unless an explicit later decision changes it.

## E. Exit condition

This appendix closes the C2-1 requirement for exact Branch-scope and canonical command-family inventory. C2-2 may use it with `C2_CURRENT_STATE_INVENTORY.md` to classify the canonical Feature/Capability/Limit registry without inventing disconnected client-only behavior.