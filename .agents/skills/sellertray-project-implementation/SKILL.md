---
name: sellertray-project-implementation
description: "Governing skill for every SellerTray redesign, implementation, refactor, QA, architecture, UX, mobile, merchant web, POS, inventory, branch, UOM, WhatsApp commerce, reporting, Bluetooth printing, AI, payments, purchasing, permissions, or offline-sync task."
metadata:
  author: ProcessEdge Solutions Limited
  product: SellerTray
  version: "0.1.2"
  status: governing
---

# SellerTray Project Implementation Skill

## Purpose

Use this skill for every SellerTray implementation task. It distils the approved redesign plan so different agents do not independently reinterpret the product.

The originating SellerTray redesign conversation remains the primary product decision record when available. This repository skill is the durable governing fallback. A later explicit user decision overrides an older rule; when direction changes, update this skill so the repository does not drift from the approved product.

## Product definition

SellerTray is a professional mobile-first merchant sales and retail operations platform:

> Mobile POS + Sales + Orders + Inventory + Customers + Branch Operations + Payments + WhatsApp Commerce + AI, with a merchant web management layer.

SellerTray is not merely WhatsApp selling with POS added. It is also not intended to become a full ERP. Do not expand MVP scope into full accounting, payroll, HR, manufacturing, or complex enterprise procurement unless explicitly approved.

## Governing product rule

> Mobile performs. Web manages. WhatsApp sells. AI assists. All channels use the same SellerTray commerce, inventory, UOM, customer, branch, payment, permission, and reporting core.

Do not create separate business truth for POS, WhatsApp, web, or AI.

# 1. Mobile versus merchant web

## Mobile app

Mobile is the primary operational surface. Keep it fast and suitable for everyday store work.

Primary navigation is frozen unless explicitly changed:

1. Home
2. Sell
3. Orders
4. Inventory
5. More

Mobile owns or prioritises:

- POS selling and checkout;
- product search and barcode scan;
- UOM selection during transactions;
- customers in selling context;
- unified orders and fulfilment;
- WhatsApp order handling and merchant takeover;
- permitted branch switching;
- stock lookup, receiving, transfer and stock count;
- cashier shifts, expenses and simple cash movement;
- Bluetooth receipt printing;
- basic operational reports;
- quick AI assistance;
- offline-capable selling where supported.

Do not turn mobile into a miniature ERP or expose complex administration that belongs on web.

## Merchant web

Merchant web is the management, configuration, supervision and analysis surface. It should be designed for desktop workflows, not as a stretched mobile UI.

Web owns or prioritises:

- consolidated dashboard and branch comparison;
- sales and order review;
- product, category, barcode, UOM and pricing administration;
- full inventory administration;
- purchasing and suppliers;
- customer management and deeper history;
- payments, settlement and reconciliation;
- cash/shift review;
- branch administration;
- staff, roles, assignments and permissions;
- register/device administration;
- WhatsApp configuration and analysis;
- full Report Center;
- business AI analysis;
- merchant settings, audit and integrations.

# 2. Shared commerce core

Mobile, web, WhatsApp and AI must consume shared governed capabilities.

The shared core owns at minimum:

- Merchant
- Branch
- Staff and permissions
- Register/device
- Shift
- Product/category
- SKU/barcode
- UOM and conversion
- Pricing
- Inventory/stock ledger
- Customer
- Cart/order
- Sale
- Payment
- Return/refund
- Fulfilment
- Receipt
- Reporting dimensions
- WhatsApp transaction linkage
- AI-accessible governed services

Shared business rules belong in the domain/service layer rather than being duplicated in clients.

# 3. Approved mobile information architecture

## Home

Home is an operational dashboard, not a menu-card dump. It should show active merchant/branch context, today sales, orders, amount collected, expenses, quick actions, needs-attention items, low stock, pending WhatsApp orders, payment verification issues, pending stock transfers, shift state and recent activity.

Primary action: **New Sale**.

## Sell

Sell is the main POS surface. Support:

- search by product name, SKU or barcode;
- barcode scanning;
- availability;
- UOM selection;
- quantity;
- customer;
- controlled discounts/price overrides;
- cart;
- hold/resume;
- checkout;
- configured payment methods;
- split payment where enabled;
- receipt actions.

On phone, the primary POS flow is explicitly staged:

> Products -> Cart -> Payment

Rules:

1. Products, Cart and Payment are separate phone steps/screens. Do not place the full cart or payment form beneath a long product catalogue.
2. The product catalogue defaults to a tile/grid view. A compact list view may be offered as an explicit toggle.
3. Large catalogues must use bounded paging or equivalent virtualised incremental loading so a merchant is not forced through one unbounded 100+ item scroll.
4. Search and barcode entry remain available from the Products step and must work across the catalogue, not merely the visible page.
5. The Cart shows product-line count separately from transaction quantity; do not label fractional transaction quantity as a fractional number of “items”.
6. Cart quantity must be directly editable by typing and may also provide plus/minus controls. Both paths must enforce the same UOM fractional policy, stock availability and price/conversion rules.
7. Moving from Cart to Payment must revalidate governed branch stock, current price and UOM conversion before a checkout draft is committed.
8. Payment remains a distinct step after the cart is accepted. Completing payment must revalidate server-side transactional invariants before payment and stock effects are committed.
9. A branch change invalidates stale Product/Cart/Payment context safely.
10. Tablet or desktop layouts may use a denser split-screen treatment where appropriate, but do not force that pattern onto small Android phones.

After successful completion, support fast continuation, normally **New Sale**.

## Orders

Orders is a unified order surface. POS, WhatsApp, merchant-created orders and future storefront/API orders use one order model with `source` as a dimension. Do not create isolated order engines per channel.

Order-line rules:

1. Every order must expose its line items for review, including finalised orders.
2. Finalised/posting-affected order lines are historical snapshots and are read-only.
3. Draft order edits must go through a governed server/domain command; clients must not write order-item rows directly.
4. A draft edit must preserve branch authority, capability checks, current UOM/price validation and audit history.
5. Once payment, financial-document or inventory activity exists, order lines must not be silently rewritten as if they were still an untouched draft.

## Inventory

Mobile inventory is operational: stock lookup, branch availability, receiving, transfers, stock count, controlled adjustment, low stock and movement history.

Operational reference rules:

1. SellerTray generates a unique operational reference by default for stock receipts, adjustments, purchase receipts, stock counts and stock transfers.
2. The generated reference may be replaced with a meaningful external reference, such as a supplier delivery note or count sheet, where that improves traceability.
3. User-facing business references are not substitutes for internal idempotency keys; preserve both concepts where retry safety requires them.
4. Reusing a reference according to the governed retry contract must not duplicate stock or payment effects.

Reason rules:

1. Stock receipt and stock adjustment reason entry should use a governed merchant-facing reason vocabulary rather than unrestricted free text by default.
2. Add an “Other approved …” reason only where the workflow genuinely needs it; do not let clients invent internal reason codes.
3. Cancellation/explanation workflows may still require a concise free-text explanation where the audit trail needs human context.

## More

Place secondary capabilities here according to permission: Customers, Suppliers where appropriate, Expenses, Cash & Shift, WhatsApp, Returns, Held Sales, Reports, AI Assistant, Transfers, Devices & Printers, Profile, Settings and Sync Status.

Navigation must be capability-aware; do not show actions merely to fail after tap.

# 4. Professional UX rules

Use a coherent SellerTray design system rather than one-off screen patterns.

Standardise typography, spacing, touch targets, buttons, cards, forms, sheets/modals, search, dropdowns, date/period controls, status badges, confirmation patterns, empty/loading/error/offline/success states.

Rules:

1. Design for small Android devices first.
2. Core selling actions must remain obvious and low-friction.
3. Keep branch context visible whenever it affects data or transactions.
4. Use merchant-facing language only. Do not expose phase names, code names, schema jargon, implementation notes or internal project terminology in user-facing labels/comments/explainers.
5. Reuse shared components where behaviour is equivalent.
6. Error messages must explain what happened and the next safe action.
7. Merchants should not need to understand ledger, conversion, sync or payment internals.

# 5. Branch invariants

Branch awareness is foundational.

Conceptual hierarchy:

> Merchant -> Branch -> Register/Device -> Shift -> User

Inventory hierarchy:

> Merchant -> Branch -> Stock Location

Branch-sensitive areas include sales, orders, stock, transfers, purchasing/receiving, shifts, expenses, WhatsApp fulfilment, pricing where enabled, devices/printers, reporting and permissions.

Rules:

1. A user cannot transact against an inaccessible branch.
2. Active branch must be explicit on operational screens.
3. Multi-branch users may switch only among permitted branches.
4. Branch switching must invalidate stale cart/register/stock/payment context safely.
5. Branch attribution should be captured on the transaction, not reconstructed later when avoidable.
6. Consolidated multi-branch analysis primarily belongs on web.

# 6. UOM invariants

UOM is foundational and must be shared by products, selling, purchasing, inventory, WhatsApp and reporting.

Every stock-managed product has exactly one **Stock UOM**. Alternate UOMs require explicit conversion factors.

Example:

- Bottle = 1
- Pack = 12 Bottles
- Crate = 24 Bottles

Rules:

1. Inventory ledger quantities are stored in Stock UOM.
2. Transaction lines preserve selected UOM, transaction quantity, conversion factor used and resulting stock quantity.
3. UOM prices may be independent; never assume alternate price = base price × conversion.
4. Purchase UOM may differ from Selling UOM.
5. Barcode may resolve Product + UOM.
6. Fractional quantity is permitted only where product/UOM policy allows it.
7. Historical conversion factors used by posted transactions must remain auditable; do not silently reinterpret history after conversion changes.
8. Branch stock is one quantity truth in Stock UOM, not unrelated balances per alternate UOM.

# 7. Inventory invariants

Inventory must be ledger-driven rather than maintained only as a mutable current quantity.

Stock movements include at minimum: sale, sale return, purchase receipt, stock adjustment, stock count reconciliation, transfer out, transfer in, damaged/expired stock where supported and opening stock.

Every movement should preserve Product, Stock UOM quantity, Branch/Location, business timestamp, source/reference, user/system actor and reason where required.

Rules:

1. Never silently overwrite stock from a count.
2. Stock count flow is Start Count -> Capture -> Review Variance -> Authorised Apply.
3. Sale reduces stock exactly once.
4. Return restores stock only according to approved return state/policy.
5. Transfer out and transfer receipt must remain auditable and duplicate-safe.
6. Retried requests must not duplicate stock effects.
7. A Purchase Order does not create on-hand stock. It records procurement intent for a specific branch.
8. Purchase stock enters inventory only when a physical receipt is posted for that Purchase Order. Partial receipts post only the physically received quantity.
9. Stock needed by another branch must be received against that branch’s Purchase Order or moved through a governed Stock Transfer after receipt; do not create global phantom stock from placing a purchase.

# 8. WhatsApp preservation and unification

Do not discard or rebuild the existing WhatsApp investment as a separate product.

Existing/current capabilities around webhook/conversation intake, catalogue, customers, order capture, payments, notifications, receipts and delivery should migrate to the shared commerce core.

Target flow:

> WhatsApp conversation -> Customer -> Product/UOM -> Branch availability -> Shared cart/order -> Payment -> Fulfilment -> Receipt/status

Rules:

1. WhatsApp orders appear in the same Orders model as POS and merchant-created orders.
2. Preserve `source = WhatsApp` for filtering/reporting.
3. Merchant can take over an AI-generated or WhatsApp-generated order.
4. UOM and branch stock checks use the same shared services as POS.
5. Shared commerce changes require WhatsApp regression tests.

# 9. Payments and cash

Use one governed payment model across channels. Preserve idempotency and external references so retries cannot duplicate effects.

Support configured methods such as cash, transfer, Paystack, Flutterwave and other approved methods. Split or partial payment must follow merchant policy.

Payment/verification state must be explicit. A pending transfer is not equivalent to paid.

Cashier flow:

> Open Shift -> Operate -> Cash Movements/Expenses -> Close Shift -> Reconcile

Track opening cash, cash sales, expenses, cash in/out, expected cash, declared cash, variance and explanation/manager review where required.

# 10. Bluetooth printing and hardware

Android mobile printing should support Bluetooth ESC/POS, initially 58mm and 80mm.

Support discovery/pairing, default printer, test print, device/register assignment, auto-print where configured and reprint.

Critical invariant:

> A successful sale must never be rolled back because receipt printing failed.

Reprinting must never duplicate the business transaction.

# 11. Reporting

Mobile reporting is concise and operational. Web hosts the full Report Center.

Shared report dimensions should include as applicable: period, branch, staff, product, category, customer, payment method and source channel.

Web reporting should cover sales, inventory, stock movement/valuation, low/out-of-stock, cash/shift, expenses, customers, staff, branch performance, profitability and WhatsApp performance as approved.

Report totals must reconcile to underlying transactions; UOM quantity reporting must normalise correctly where aggregation requires it.

# 12. AI governance

AI is an operational assistant, not an unrestricted database writer.

AI reads/acts through governed SellerTray capabilities and must respect merchant, branch, role, pricing, payment and inventory policies.

Potential AI surfaces include WhatsApp order understanding, Product/UOM resolution, alternatives, availability, merchant sales questions, stock questions, branch comparisons, reorder recommendations, customer reactivation and anomaly summaries.

Do not let AI bypass normal permissions or manipulate business data directly.

# 13. Offline and sync

Offline capability should be added without creating a second business model.

Target offline support includes cached catalogue/pricing/customer context, offline cash sale where allowed, local receipt printing, sync queue, idempotency/duplicate prevention, conflict policy and user-visible sync state.

Operations requiring live verification can remain online-only.

# 14. Permissions

Prefer capability-based authorisation underneath understandable business roles.

Example capabilities:

- can_adjust_stock
- can_change_price
- can_give_discount
- can_view_profit
- can_refund_sale
- can_close_shift

Rules:

1. Enforce permissions server/domain-side, not only by hiding UI.
2. Test read and write/action separately.
3. Branch scope and capability scope must both pass.
4. Preserve appropriate historical read/audit access when current operational authority changes.

# 15. Approved implementation phases

Use this order unless an explicit later decision changes it:

## Phase 1 — Mobile UX shell

New app shell, design system, Home, Sell, Orders, Inventory, More, branch switcher, notifications, capability-aware navigation and loading/error/empty/offline states.

## Phase 2 — Shared commerce foundation

Merchant, Branch, Staff/capabilities, Product/category, SKU/barcode, UOM/conversion/pricing, Customer, Order/Sale, Payment, source channel and stock ledger.

## Phase 3 — Mobile POS

Search/grid, barcode, UOM, cart, customer, pricing/discount policy, hold/resume, checkout, payment methods, split payment where enabled, receipt, sale history and reprint.

## Phase 4 — Inventory

Branch stock, ledger, receiving, adjustments, returns impact, transfers, counts, low stock, movement history and UOM conversion integrity.

## Phase 5 — Branch + cashier operations

Branch assignment/switching, register/device, opening shift, expenses, cash movements, expected cash, closing shift, variance, manager review and permission boundaries.

## Phase 6 — Bluetooth/device layer

Bluetooth ESC/POS, discovery/pairing, 58/80mm rendering, default/test/auto/reprint, scanner support and device/register association.

## Phase 7 — WhatsApp unification

Connect current WhatsApp functionality to the shared customer, Product/UOM, branch availability, cart/order, pricing, payment, fulfilment, receipt, delivery and reporting model.

## Phase 8 — Merchant Web V1

Overview, Sales, Orders, Products, UOM, Pricing, Inventory, Customers, Branches, Staff, Payments, Cash, WhatsApp and Settings.

## Phase 9 — Purchasing

Suppliers, Purchase Orders, Purchase UOM, receiving, supplier payment/outstanding state as approved and purchase history, feeding the same stock ledger.

## Phase 10 — Report Center

Focused mobile reports plus full web reports on shared dimensions.

## Phase 11 — AI

Governed selling and merchant AI on reliable shared data/services.

## Phase 12 — Offline reliability

Robust offline operation, queueing, sync, idempotency, conflicts and visible status.

Do not casually reorder foundation phases because a UI shortcut is easier. Earlier bounded work is acceptable only when it does not create a second model that later must be discarded.

# 16. Agent implementation workflow

For every SellerTray task:

1. **Re-anchor** — identify phase, surface (mobile/web/shared), approved behaviour to preserve, and branch/UOM/stock/payment/WhatsApp implications.
2. **Inspect before editing** — inspect current code, schema, tests, APIs and integrations. Do not duplicate an implementation because it was not immediately visible.
3. **Bound the slice** — prefer one reviewable business outcome; avoid unrelated cleanup.
4. **Protect invariants** — merchant isolation, branch scope, capability scope, UOM integrity, stock ledger integrity, payment idempotency, WhatsApp compatibility and auditability.
5. **Implement shared behaviour once** — put cross-channel rules in shared/domain services.
6. **Verify** — focused tests plus relevant regression tests. A change without verification is incomplete.
7. **Report accurately** — state what changed, what was preserved, tests run/results, migration/build/deployment requirements, limitations and the next bounded milestone. Never report planned work as completed.

# 17. Required QA gates

Apply relevant gates to every slice.

## UX gate

Verify information architecture, primary action, branch context, loading/empty/error states, small-screen behaviour, business-facing labels and tap efficiency.

For phone POS specifically, verify the Products -> Cart -> Payment stage separation, tile-default catalogue, scalable paging/loading, direct quantity entry, and that large catalogues do not require scrolling through the cart or payment UI.

## Permission gate

Verify representative allowed/denied read, allowed/denied write/action, branch isolation and multi-branch switching.

## UOM gate

Verify Stock UOM, alternate conversion, UOM-specific price, UOM barcode where implemented, fractional policy, persisted conversion factor and correct stock impact.

## Inventory gate

Verify sale deduction, return restoration, receiving, transfer, adjustment, stock count reconciliation, movement history and retry safety.

## Payment gate

Verify success, pending verification, failure, retry/idempotency, split payment where applicable and refund/reference behaviour.

## WhatsApp regression gate

When shared commerce changes, verify customer resolution, Product/UOM resolution where applicable, order creation, payment linkage, merchant takeover and receipt/status behaviour.

## Printing gate

Verify successful print, unavailable/failing printer after successful sale, reprint without duplication and 58/80mm where implemented.

## Reporting gate

Verify filters/totals against source transactions, especially period, branch, source channel, UOM-normalised quantity, payment state and returns/cancellations.

## Offline gate

When offline is touched, verify local commit, queued sync, repeated sync, duplicate prevention, conflict outcome and user-visible sync status.

# 18. Anti-divergence rules

Do not:

- rebuild SellerTray as separate WhatsApp and POS products;
- discard existing WhatsApp work during redesign;
- create unrelated stock balances per UOM;
- automatically derive alternate UOM price by multiplication unless explicitly configured;
- infer branch later when it should be captured at transaction time;
- silently change stock from a stock count;
- put full management administration into mobile;
- make merchant web a stretched mobile app;
- collapse phone Products, Cart and Payment into one unbounded long POS screen;
- make manual/free-text references the only operational-reference path when SellerTray can safely generate one;
- write draft order-item changes directly from a client instead of through governed domain commands;
- let print failure undo a completed sale;
- let AI bypass permissions/domain services;
- duplicate payment or stock effects on retries;
- expose phase/code/project/internal implementation names in user-facing UI;
- expand SellerTray into a full ERP without explicit approval;
- declare implementation complete without focused verification.

# 19. New-feature decision checklist

Before adding a feature, answer:

1. Is it mobile operation, web management or shared core?
2. Where does it fit in the approved information architecture?
3. Which branch owns the data/transaction?
4. Does it affect stock?
5. Does it require Product/UOM conversion?
6. Does it affect WhatsApp selling?
7. Does it affect payments/cash?
8. What capability governs it?
9. What audit/history is required?
10. What reports consume it?
11. Does it need offline behaviour?
12. What focused tests prove it?
13. Does it preserve current SellerTray functionality?
14. Is it inside the current approved phase/scope?

If these cannot be answered, do not create a new isolated implementation path; resolve the domain boundary first.

# 20. MVP interpretation

The redesign MVP is a coherent operating product rather than scattered advanced features.

Mobile MVP direction: redesigned Home/Sell/Orders/Inventory/More shell, POS, customers, unified orders, WhatsApp orders, branch awareness, inventory, UOM, payments, cashier shifts, expenses, Bluetooth printing and basic reports.

Merchant web MVP direction: management dashboard, sales/orders, products, UOM/pricing, inventory, purchasing, customers, branches, staff, payments, cash review, WhatsApp administration, Report Center and settings.

Existing WhatsApp functionality must remain operational throughout the transition. AI expansion and deep offline hardening follow the stable transactional core.
