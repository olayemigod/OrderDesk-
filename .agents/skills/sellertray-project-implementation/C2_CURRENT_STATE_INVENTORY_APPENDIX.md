---
name: sellertray-c2-current-state-inventory-appendix
description: "C2-1 exact Branch-scope and server command-family appendix for the Commercial V2 current-state inventory."
metadata:
  author: ProcessEdge Solutions Limited
  product: SellerTray
  version: "0.1.0"
  status: governing-extension
  companion: "C2_CURRENT_STATE_INVENTORY.md"
  baseline_commit: "d8024c215850e0e9a3a0ce1496d1d0dd5d7cd150"
  inventory_date: "2026-11-02"
---

# C2 Current-State Inventory Appendix — Branch Scope and Command Families

This appendix is part of the C2-1 implementation inventory. It tightens the exact current Branch-scope and server command-family map used when designing the canonical Feature/Capability/Limit catalogue and the later shared Branch entitlement resolver.

It is descriptive of the current implementation at baseline `d8024c215850e0e9a3a0ce1496d1d0dd5d7cd150`; it does not authorise C2 runtime cutover.

## A. Current Branch-scope authority

Current Branch access is already server-authoritative and must remain a separate intersecting dimension from plan entitlement.

### A.1 Canonical current helpers

Production currently exposes:

- `get_sellertray_accessible_branches(tenant_id)`
- `sellertray_current_user_can_access_branch(tenant_id, branch_id)`
- `sellertray_current_user_can_read_branch(tenant_id, branch_id)`
- `sellertray_user_can_access_branch(tenant_id, branch_id, user_id)`
- `sellertray_user_can_operate_branch(tenant_id, branch_id, user_id)`
- `sellertray_user_can_read_branch(tenant_id, branch_id, user_id)`
- `sellertray_user_can_read_report_branch(tenant_id, branch_id, user_id)`
- `set_sellertray_member_branch_access(...)`
- `reset_sellertray_member_branch_access(...)`

### A.2 Owner/Manager behavior

For the current `owner` and `manager` roles:

- operational Branch access succeeds for active Branches in the Business;
- report scope can be Business-wide when no Branch is supplied;
- Branch read helpers allow governed historical read where the underlying Branch row exists, even when operation requires an active Branch.

C2 must not convert this user/Branch authorization into a Plan Profile grant. A plan entitlement may permit a feature at a Branch, but the actor still requires applicable user/Branch authority.

### A.3 Staff behavior

Current `staff` Branch behavior is:

1. If explicit `branch_user_access` exists for the user, operation/read is limited to Branch rows where `can_operate = true`.
2. If **no** explicit Branch-access rows exist for the user, Staff falls back to the Business default Branch.
3. Staff cannot use a null Branch to obtain Business-wide report scope; report reads require an actual Branch the user may read.

This fallback is current compatibility behavior. C2 must preserve approved behavior unless role/Branch governance is deliberately changed in its own bounded decision.

### A.4 Cashier divergence

Governance recognises Cashier, but production `tenant_members.role` currently permits only `owner`, `manager`, `staff`.

Therefore current Branch-scope helpers have no explicit Cashier branch semantics. C2 catalogue/schema design must not infer Cashier behavior from Staff by accident. Cashier role convergence requires an explicit role/permission decision and regression coverage.

### A.5 Branch entitlement intersection

The C2 resolver must treat Branch entitlement and actor Branch access as different facts.

A correct action check is conceptually:

> **resolved Branch plan capability**
> ∩ **actor merchant capability/role**
> ∩ **actor Branch operation/read scope**
> ∩ **Business/Branch/transaction lifecycle state**
> ∩ **available limit/quota**

Examples:

- Growth may permit returns at Branch A, but a Cashier without return permission still cannot return.
- A user may have stock-transfer permission but cannot transfer from a Branch outside their assigned scope.
- A Branch may be commercially entitled to WhatsApp selling while its connection/consent/configuration remains incomplete; entitlement alone does not manufacture readiness.

## B. Current server command families

The current Supabase Edge Function tree demonstrates that SellerTray already has broad shared/domain behavior. C2 should add entitlement checks to canonical server/domain paths rather than duplicate client-only plan logic.

### B.1 Commerce, orders and fulfilment

Current command/function families include:

- `pos-checkout`
- `pos-return`
- `merchant-order`
- `merchant-enquiry-action`
- `order-change-request`
- `order-draft-action`
- `order-fulfillment`
- `financial-document`
- `printer`

C2 relevance:

- selling, returns, payment behavior, fulfilment and document/printing features may become catalogue candidates;
- plan gates must execute at or below the canonical server command boundary;
- stock/payment/UOM/idempotency correctness remains mandatory regardless of plan.

### B.2 Inventory and purchasing

Current command families include:

- `inventory-operation`
- `stock-count`
- `stock-transfer`
- purchasing/receiving paths exposed through existing merchant inventory/purchasing authorities.

C2 relevance:

- advanced inventory/purchasing can be represented as Features/Capabilities only after mapping their actual server operations;
- Branch scope, UOM normalization and ledger integrity are always-on invariants.

### B.3 Cash, money and merchant payments

Current command families include:

- `cash-shift`
- `money-operation`
- `merchant-payment-operations`
- `payment-runtime`
- `payment-settings`
- `paystack-payment-webhook`
- `flutterwave-payment-webhook`

C2 relevance:

- merchant customer-payment configuration remains a merchant operational domain;
- C2 ProcessEdge Commercial Payment Method Master is a different authority for paying SellerTray commercial obligations;
- plan entitlement must never bypass payment-state/idempotency rules.

### B.4 Team, membership and Business lifecycle

Current command families include:

- `team-management`
- `platform-admin-team`
- `account-lifecycle`
- `provision-business`

C2 relevance:

- staff seats/additional users may become Limit/add-on candidates;
- actual membership, role and Branch authorization remain security authorities independent of plan packaging.

### B.5 WhatsApp commerce

Current command families include:

- `whatsapp-connection`
- `whatsapp-catalog`
- `whatsapp-webhook`
- `send-whatsapp-notifications`
- `catalogue-from-chat`
- `channel-consent`
- `order-parser`

Related production RPCs include connection/consent, Branch selection, runtime credential resolution, catalogue mapping, customer resolution and atomic WhatsApp-order creation.

C2 relevance:

- WhatsApp selling/channel access is a valid Feature/add-on candidate;
- the webhook must resolve the governed Branch and consult shared Branch entitlement before gated selling behavior;
- WhatsApp routing, consent, connection and catalogue readiness remain separate prerequisites;
- WhatsApp must never create Branch Subscription truth.

### B.6 AI

Current command family:

- `merchant-ai`

Current AI behavior is authenticated, Owner/Manager-only, read-only, rate-limited and backed by the governed `sellertray_ai_insight_context` server read model.

The AI instructions explicitly prohibit executing sales, stock, payment, purchasing, staff, WhatsApp, printer or settings changes.

C2 relevance:

- AI access and commercial usage limits are valid catalogue candidates;
- operational abuse rate limits are not the same as commercial plan limits;
- AI may consume/explain Branch entitlement and usage facts, never create them.

### B.7 Commercial purchase, pricing, legal and settlement

Current command families include:

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

C2 relevance:

- preserve and extend immutable price/order/installment/legal/payment evidence;
- replace Business subscription subjects with Branch Subscription subjects at C2-6;
- keep Universal Master Agreement acceptance separate from purchase-specific Merchant Order Form confirmation;
- do not reintroduce legacy commercial agreements as a second universal legal authority.

## C. Cross-surface implementation targets by action class

| Action class | Current surface(s) | Current server authority pattern | C2 treatment |
|---|---|---|---|
| Sell/POS | Mobile; WhatsApp-derived orders | POS/order server commands + Business-wide subscription write gate | Gate by Branch resolver + user/Branch scope; preserve commerce correctness. |
| Returns/refunds | Mobile/Merchant management | return command + `can_refund_sale`/transaction rules | Candidate plan capability intersected with user permission. |
| Stock receive/adjust/count/transfer | Mobile/Merchant Web | inventory/stock commands + named capabilities + Branch scope | Candidate capability/features; never bypass UOM/ledger/Branch rules. |
| Shifts/cash/expense | Mobile/Merchant Web | cash/money commands + staff capability defaults | Plan decision may affect advanced features, not cash/payment correctness. |
| Products/purchasing | Merchant Web; selected Mobile operations | shared product/inventory/purchasing authorities | Package only at feature/action level; shared product truth remains one core. |
| Team/permissions | Merchant Web | membership/capability/Branch-assignment authority | Possible staff-seat/advanced-permission limits; security controls remain mandatory. |
| WhatsApp selling | WhatsApp + management surfaces | WhatsApp connection/webhook + Branch routing | Branch entitlement feature/add-on; channel cannot create subscription truth. |
| AI insights | Mobile/Web insight surfaces | `merchant-ai` + governed read context | Entitlement/usage candidate; read-only authority remains. |
| Reports/exports | Mobile basic + Merchant Web full + Admin audit | report read models + role/capability/Branch reporting scope | Catalogue report families/limits without weakening audit evidence. |
| Printing/devices | Mobile/Merchant Web | printer/device commands + `can_print_receipt`/`can_manage_devices` | Candidate advanced integration/device limits; transaction evidence remains available. |
| Merchant Billing | Merchant Web | C1 commercial order/price/legal/payment/setup authorities | C2 Branch-by-Branch purchase/renew/change management. |
| Commercial operations | Admin Web | Admin capabilities + AAL2/scope/audit where required | ProcessEdge operational authority, never merchant Plan Profile capability. |
| Offline selling/replay | Mobile | bounded cached write authority + canonical replay commands | Cache Branch/version entitlement; replay revalidates all current server authorities. |

## D. C2-2 design warnings from the exact scope inventory

1. Do not put `owner`, `manager`, `staff` or `cashier` into Plan Profile grants. Roles are user authorization, not commercial entitlements.
2. Do not make `branch_user_access` a plan table. Branch assignment is actor scope.
3. Do not use a single `can_sell` boolean to replace payment, UOM, inventory, transaction-state or offline replay validation.
4. Do not model Admin capabilities as merchant package features.
5. Do not confuse operational API/rate limits with commercial usage limits.
6. Do not entitlement-gate historical read/audit evidence in a way that destroys access needed for compliance, support or financial history.
7. When a feature is disabled by plan, fail through the shared resolver with a stable server reason suitable for Mobile/Web/WhatsApp handling; do not rely on hidden UI alone.
8. When entitlement changes while Mobile is offline, replay must revalidate against current server authority and fail safely without duplicate transaction effects.

## E. Appendix exit condition

This appendix closes the explicit C2-1 requirement to inventory current Branch-scope rules and canonical command families. C2-2 may use it with `C2_CURRENT_STATE_INVENTORY.md` to classify the first canonical Feature/Capability/Limit registry without inventing disconnected client-only plan behavior.