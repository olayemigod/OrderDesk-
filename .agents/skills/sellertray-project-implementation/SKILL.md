---
name: sellertray-project-implementation
description: "Governing skill for every SellerTray redesign, implementation, refactor, QA, architecture, UX, mobile, merchant web, POS, inventory, branch, UOM, WhatsApp commerce, reporting, Bluetooth printing, AI, payments, purchasing, permissions, or offline-sync task."
metadata:
  author: ProcessEdge Solutions Limited
  product: SellerTray
  version: "0.1.10"
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
- lightweight Product creation/editing for authorised Owners/Managers, including create/select against the shared Business Category and UOM masters;
- customers in selling context;
- unified orders and fulfilment;
- WhatsApp order handling and merchant takeover;
- permitted branch switching;
- stock lookup, governed purchase receiving where authorised, stock transfers, stock count and controlled adjustment;
- cashier shifts, expenses and simple cash movement;
- Bluetooth receipt printing;
- basic operational reports;
- quick AI assistance;
- offline-capable selling where supported;
- lightweight user feedback capture tied to the signed-in account.

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
- tenant-scoped feedback participation and submission review for Owners/Managers;
- merchant settings, audit and integrations.

### Merchant Web UX and information architecture contract

Merchant Web must present as a professional management application, not a collection of independently styled pages.

Shell rules:

1. Use the real SellerTray identity, real navigation icons and text labels. Do not use generated initials or placeholder brand marks as the permanent navigation language.
2. Desktop uses a persistent management sidebar with collapsible groups and a top bar that keeps Business and active Branch context obvious.
3. On narrower screens, the sidebar collapses into an overlay/slide-over navigation drawer. Do not convert the full management hierarchy into a horizontally scrolling navigation strip.
4. Mobile web remains management-first: forms become one column, page actions collapse intelligently, tables reduce columns or become cards where appropriate, and detail drawers may become full-screen sheets.
5. Merchant Web management quick actions should focus on management work such as Add Product, Create Purchase Order, Transfer Stock and Invite Cashier. **New Sale** is not the primary Merchant Web action because mobile performs sales.
6. Build shared Merchant Web UI primitives for AppShell, Sidebar, TopBar, PageHeader, buttons, cards, stat cards, tables, filters, search, badges, tabs, drawers, modals, form fields, selects, date range, skeletons, empty/error states, toasts and confirmations rather than repeating one-off patterns.

Approved primary Merchant Web navigation groups are:

- **Dashboard**
- **Sales** — Sales, Orders, Customers, Returns
- **Catalogue & Inventory** — Products, Inventory
- **Purchasing** — Purchase Orders/Receiving, Suppliers
- **Money** — Payments/Receivables, Cash & Shifts
- **Channels** — WhatsApp, Devices & Printers
- **Insights** — Report Center, Ask SellerTray
- **Business** — Branches, Team & Permissions, Feedback, Settings

Do not expose every product sub-feature as a permanent top-level navigation item. Categories, Units & Barcodes and Pricing belong within Product management unless a later explicit decision changes this.

Dashboard direction:

1. The management dashboard should answer: **How is my business doing, and what needs my attention?**
2. Use governed reporting/read models rather than reconstructing sales, payment or stock truth in browser code.
3. Headline KPIs may include supported Sales, Orders, Amount Collected, Outstanding, Expenses and Average Sale. Do not invent profit/margin until authoritative cost data exists.
4. Provide actionable attention items for supported low stock, payment verification, fulfilment, transfer receipt, purchase receipt, cash variance and WhatsApp connection issues, with drill-down to the relevant management view.
5. Branch comparison and consolidated multi-branch analysis remain web responsibilities.

Product-management direction:

1. Product creation remains product-definition only. **Creating a product must never create, infer or invent stock.** Opening stock, receiving, transfer and adjustment remain separate governed inventory operations.
2. Initial creation should stay simple: Product name, SKU, Category, Stock UOM, selling price, fractional-quantity policy and product image where supported. Advanced configuration follows after save.
3. Product Category and UOM are tenant-scoped **Business master data**, not independent free-entry strings maintained separately by Mobile or Merchant Web. Authorised Owners/Managers may create masters from either Product surface and then select them from the same governed shared vocabulary.
4. A Product Stock UOM and every product-specific alternate UOM must resolve to an active Business UOM master. Product-specific conversion factors, UOM prices, barcodes and selling/purchase defaults remain on the product-UOM configuration; creating a Business UOM must never invent a conversion, price or stock balance.
5. Existing or legacy/internal catalogue values must converge into the same Business masters during migration/runtime compatibility rather than creating a second vocabulary. Historical transaction UOM snapshots remain immutable even if master configuration changes later.
6. Product list/search must scale to large catalogues using governed pagination/filtering rather than loading an unbounded full catalogue into one client-side list.
7. Product management should support useful filters such as Category, Active/Archived, Missing barcode, Missing price, Low stock and UOM where supported by governed data.
8. Product detail should converge on management sections such as **Overview**, **Units & Barcodes**, **Pricing**, **Stock** and **Activity**.
9. Web is the richer surface for alternate UOMs, conversion factors, UOM-specific prices, multiple barcodes, selling/purchase defaults, category management, product images, detailed pricing, bulk administration and audit/activity history.
10. Stock display on Product management must read Branch stock truth from the governed inventory model; it must not maintain a separate product-quantity truth.
11. Product/Category/UOM/barcode/pricing mutations must continue through governed SellerTray commands/RPC boundaries and preserve UOM, Branch, permission, audit and inventory invariants.

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
- merchant-governed partial payment and pay-later where enabled;
- merchant-governed manual non-cash payment confirmation authority;
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
9. Split payment, partial settlement and pay-later are merchant policy, not client hard-coding. Mobile and web must consume the same governed payment settings.
10. `amount_paid` is the sum of confirmed allocations. An order is `paid` only when confirmed allocations cover the governed invoice amount; any remainder stays an explicit outstanding balance.
11. Cash is cashier-confirmed physical drawer tender. Manual bank-transfer and terminal confirmation authority is merchant-configurable and must still preserve Branch access plus the configured payment capability boundary.
12. A branch change invalidates stale Product/Cart/Payment context safely.
13. Tablet or desktop layouts may use a denser split-screen treatment where appropriate, but do not force that pattern onto small Android phones.

After successful completion, support fast continuation, normally **New Sale**.

## Orders

Orders is a unified order surface. POS, WhatsApp, merchant-created orders and future storefront/API orders use one order model with `source` as a dimension. Do not create isolated order engines per channel.

Order-line rules:

1. Every order must expose its line items for review, including finalised orders.
2. Finalised/posting-affected order lines are historical snapshots and are read-only.
3. Draft order edits must go through a governed server/domain command; clients must not write order-item rows directly.
4. A draft edit must preserve branch authority, capability checks, current UOM/price validation and audit history.
5. Once payment, financial-document or inventory activity exists, order lines must not be silently rewritten as if they were still an untouched draft.
6. An unwanted commercially untouched unpaid POS draft may be deleted only through an audited soft-delete command. A draft with payment, stock or financial-document effects is not eligible for deletion.
7. Soft-deleted drafts and ordinary active drafts must not inflate completed-sales or commercial-performance reporting. Reports must intentionally select the governed lifecycle states they measure.
8. Sale returns are quantity- and line-aware. Returning a sale never implies that every originally sold line or quantity is returned; track sold, already-returned and remaining returnable quantity per line.
9. A partial return preserves the original sale and payment history, restores only the approved returned stock quantity using the historical UOM snapshot, and leaves any remaining quantity available for later governed return where policy allows.

## Customer identity and selling context

Customer identity is shared commerce truth across POS, merchant web, WhatsApp and reporting. Walk-in sales are supported, but SellerTray must not force every POS transaction into a walk-in customer when the merchant needs customer-level history or outstanding-balance tracking.

Rules:

1. Sell defaults to **Walk-in Customer** but the cashier may search and select an existing Customer before checkout.
2. The cashier may create a new Customer in selling context using merchant-facing identity fields; the committed sale/order must immediately reference that shared Customer.
3. An explicitly selected Customer ID wins over name/phone matching. Clients must not recreate a selected WhatsApp Customer as a separate manual/POS Customer.
4. New name/phone entry may reuse one unambiguous existing Customer with the same canonical phone identity. If multiple records match, fail closed and require explicit selection rather than guessing or silently merging history.
5. Phone comparison may normalise superficial formatting such as an optional leading `+`; do not invent country-code transformations or assume `080...` and `234...` are the same identity without an explicit governed rule.
6. POS and WhatsApp must converge on one Customer record. When a POS-created phone later becomes a WhatsApp sender, preserve the existing Customer ID and history rather than creating channel-specific duplicates.
7. Customer choice is part of the sale snapshot and must survive idempotent retry and offline replay. A branch change or completed/cleared sale must invalidate stale customer context safely.
8. Customer-linked orders, payments, invoices/receipts and outstanding amounts must remain attributable to that Customer so merchant web can support customer history, receivables and balance follow-up. Walk-in sales remain intentionally unassigned to a named Customer.
9. Do not expose direct customer-table writes from mobile clients. Customer creation/reuse and identity convergence belong behind governed server/domain commands.

## Inventory

Mobile inventory is operational: stock lookup, branch availability, governed purchase receiving, transfers, stock count, controlled adjustment, low stock and movement history.

Operational reference rules:

1. SellerTray generates a unique operational reference by default on every user-created operational transaction that needs a business reference, including stock adjustments, purchase receipts, stock counts, stock transfers, cash in, cash out and expenses.
2. The generated reference remains editable and may be replaced with a meaningful external reference, such as a supplier delivery note, voucher, receipt, count sheet or other source document, where that improves traceability.
3. Apply the same generated-by-default rule across mobile and web surfaces that create the same governed transaction; do not require blank/manual-only reference entry on one channel while another channel generates it.
4. User-facing business references are not substitutes for internal idempotency keys; preserve both concepts where retry safety requires them.
5. Reusing a reference according to the governed retry contract must not duplicate stock, cash or payment effects.

Reason rules:

1. Stock adjustment reason entry should use a governed merchant-facing reason vocabulary rather than unrestricted free text by default.
2. Add an “Other approved …” reason only where the workflow genuinely needs it; do not let clients invent internal reason codes.
3. Cancellation/explanation workflows may still require a concise free-text explanation where the audit trail needs human context.

Receiving rules:

1. Do not expose a generic mobile **Receive Stock** action that can bypass purchasing or transfer authority.
2. Supplier-delivered stock enters a Branch through the governed Purchase Order/Purchase Receiving flow and only for physically received quantities.
3. Stock sent from another Branch enters through the governed Stock Transfer receipt flow.
4. Purchase receiving is management/procurement authority; do not grant it to Staff merely because they can view or operate ordinary inventory tasks.
5. Controlled stock adjustment remains available only for governed correction scenarios and must not be used as a substitute for purchasing or Branch transfer.

## More

Place secondary capabilities here according to permission: Customers, Suppliers where appropriate, Expenses, Cash & Shift, WhatsApp, Returns, Held Sales, Reports, AI Assistant, Transfers, Devices & Printers, Feedback, Profile, Settings and Sync Status.

Navigation must be capability-aware; do not show actions merely to fail after tap.

## Feedback

SellerTray feedback is tied to authenticated business membership and is part of the product quality loop, not a separate anonymous truth store.

Rules:

1. Mobile must be able to tell whether the signed-in user has submitted feedback for the current business, including submission count and latest submission time where available.
2. A user may submit feedback again later; do not lock the user permanently after the first response.
3. Feedback may carry merchant-facing type, optional rating, message, Branch context, app/platform context and submission timestamp.
4. Feedback access is tenant-isolated. A user cannot inspect or submit feedback for a business they do not belong to.
5. Merchant Web provides an Owner/Manager management dashboard showing participation, who has or has not submitted, ratings and recent submissions for that business.
6. Staff do not gain management-dashboard access merely because they may submit feedback from mobile.
7. Do not create a separate feedback identity system; use the authenticated SellerTray user and tenant membership.

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
8. Appearance uses a persisted font-size slider rather than only fixed Small/Large choices. The preference must apply consistently across appropriate SellerTray mobile text surfaces through a shared typography primitive or equivalent central mechanism; do not implement screen-specific font scaling that drifts between Home, Sell, Orders, Inventory and More.
9. Font scaling must preserve usable layouts and touch targets; it changes readable text sizing, not business logic or transaction truth.

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

1. The Business UOM vocabulary is tenant-scoped governed master data shared by Mobile, Merchant Web, WhatsApp and the shared commerce core. Product-specific UOM rows reference that vocabulary but own their conversion, barcode, fractional and price configuration.
2. Inventory ledger quantities are stored in Stock UOM.
3. Transaction lines preserve selected UOM, transaction quantity, conversion factor used and resulting stock quantity.
4. UOM prices may be independent; never assume alternate price = base price × conversion.
5. Purchase UOM may differ from Selling UOM.
6. Barcode may resolve Product + UOM.
7. Fractional quantity is permitted only where product/UOM policy allows it.
8. Historical conversion factors used by posted transactions must remain auditable; do not silently reinterpret history after conversion changes.
9. Branch stock is one quantity truth in Stock UOM, not unrelated balances per alternate UOM.

# 7. Inventory invariants

Inventory must be ledger-driven rather than maintained only as a mutable current quantity.

Stock movements include at minimum: sale, sale return, purchase receipt, stock adjustment, stock count reconciliation, transfer out, transfer in, damaged/expired stock where supported and opening stock.

Every movement should preserve Product, Stock UOM quantity, Branch/Location, business timestamp, source/reference, user/system actor and reason where required.

Rules:

1. Never silently overwrite stock from a count.
2. Stock count flow is Start Count -> Capture -> Review Variance -> Authorised Apply.
3. Sale reduces stock exactly once.
4. Return restores stock only according to approved return state/policy and only for the approved returned line quantities.
5. Transfer out and transfer receipt must remain auditable and duplicate-safe.
6. Retried requests must not duplicate stock effects.
7. A Purchase Order does not create on-hand stock. It records procurement intent for a specific branch.
8. Purchase stock enters inventory only when a physical receipt is posted for that Purchase Order. Partial receipts post only the physically received quantity.
9. Stock needed by another branch must be received against that branch’s Purchase Order or moved through a governed Stock Transfer after receipt; do not create global phantom stock from placing a purchase.
10. Generic direct stock receipt must not bypass Purchase Receiving or Stock Transfer receiving.

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

Support configured methods such as cash, transfer, physical card terminal, Paystack, Flutterwave and other approved methods. Split or partial payment must follow merchant policy.

Payment/verification state must be explicit. A pending transfer is not equivalent to paid.

Cashier flow:

> Open Shift -> Operate -> Cash Movements/Expenses -> Close Shift -> Reconcile

Track opening cash, cash sales, expenses, cash in/out, expected cash, declared cash, variance and explanation/manager review where required.

Payment and shift rules:

1. Payment-method configuration is merchant-level, but in-person availability is explicitly assigned per Branch. A method enabled for the business is not automatically valid for every Branch after explicit assignments exist.
2. Cash is the physical drawer method and is always reconciled as drawer cash. Confirmed bank-transfer, physical card-terminal and other non-cash settlements must never inflate expected physical drawer cash.
3. Opening a cashier shift snapshots the payment methods available for that Branch. Later configuration changes must not rewrite what the cashier was expected to reconcile for the already-open shift.
4. Every confirmed POS payment must be attributed immutably to the responsible open shift when one exists, preserving payment method, amount, currency, order/payment reference, operator and business timestamp.
5. Shift close shows cash and non-cash methods separately. Declared cash and cash variance apply only to physical drawer cash; non-cash methods reconcile by their confirmed transaction counts and amounts.
6. POS checkout may use only Cash or an enabled in-person method assigned to the active Branch. The server/domain command revalidates Branch authority and assignment before payment and stock effects commit.
7. Physical card terminals are merchant operational methods. Never advertise a physical terminal or drawer cash as a remote WhatsApp/customer payment option.
8. WhatsApp/customer-facing payment options remain limited to methods the remote customer can actually use, such as bank transfer, configured gateways, cash on delivery or pay on pickup as policy allows.
9. Merchant Web manages payment methods and Branch assignments; mobile performs the sale and shift reconciliation using the same governed payment truth.
10. Erroneous cash-in, cash-out or expense activity may be corrected only through an authorised governed correction command. Do not directly edit or delete posted cash-history rows.
11. User-facing **Edit** means supersede the original activity with an audited replacement; user-facing **Remove** means supersede it without a replacement. The original row and correction record remain immutable audit history.
12. Cash correction requires explicit correction authority, Branch authority, writable subscription state, an open shift and a human correction reason. Staff must not receive correction authority merely because they can record ordinary cash activity.
13. Correction commands must be idempotent and drawer totals/read models must use only effective non-superseded cash activity.
14. Closed shifts are historical evidence and are not reopened or rewritten by cash correction; use shift review/follow-up for historical discrepancies.

# 10. Bluetooth printing and hardware

Android mobile printing should support Bluetooth ESC/POS, initially 58mm and 80mm.

Support discovery/pairing, default printer, test print, device/register assignment, auto-print where configured and reprint.

Receipt copy rules:

1. Each printer has a governed receipt-copy profile. Existing printers default to one **Customer Copy** so configuration changes remain backward compatible.
2. A merchant may configure multiple physical copies, with standard types including Customer, Store, Audit, Accounts, Dispatch and Production, plus a Custom type with a merchant-facing label.
3. The configured copy order determines physical print order. Each copy prints the same commercial receipt truth with its configured copy heading; copies must never create duplicate orders, payments, stock effects or financial documents.
4. Copy configuration is management/device authority and is shared merchant truth, not an ungoverned device-local preference. Mobile may expose lightweight configuration to authorised Owners/Managers; Merchant Web remains the richer management surface.
5. Every print attempt snapshots the copy profile and merchant footer used at request time so later configuration changes do not rewrite historical print evidence.
6. A reprint is an explicit audited print attempt and must never replay the sale. Printing failure must never roll back or replay the completed commercial transaction.
7. Merchant receipt footer and SellerTray platform attribution are separate concepts. Do not hard-code ProcessEdge Solutions Limited into merchant receipt content. Thermal output must use printer-safe text and must not expose internal customer sentinels such as `pos:walk-in`.
8. Test prints remain distinct from commercial receipt copies and may identify SellerTray for device verification.

Critical invariant:

> A successful sale must never be rolled back because receipt printing failed.

Reprinting must never duplicate the business transaction.

# 11. Reporting

Mobile reporting is concise and operational. Web hosts the full Report Center.

Shared report dimensions should include as applicable: period, branch, staff, product, category, customer, payment method and source channel.

Web reporting should cover sales, inventory, stock movement/valuation, low/out-of-stock, cash/shift, expenses, customers, staff, branch performance, profitability and WhatsApp performance as approved.

Report totals must reconcile to underlying transactions; UOM quantity reporting must normalise correctly where aggregation requires it.

Draft and audit-deleted draft orders are operational work-in-progress, not completed commercial truth. Sales/performance reports must exclude them unless a specific report is explicitly designed to analyse drafts.

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

### Role naming and compatibility

SellerTray merchant-facing team roles are **Owner**, **Manager** and **Cashier**. The existing internal/database compatibility role value `staff` may remain where changing it would create unnecessary migration or API risk, but merchant-facing invitation, team-management, receipt/operator and permission UI should label that operational role **Cashier**. Do not create a second authority model merely to rename the internal value; `staff` and merchant-facing Cashier refer to the same governed operational role unless a later explicit decision changes the role model.

Example capabilities:

- can_adjust_stock
- can_change_price
- can_give_discount
- can_view_profit
- can_refund_sale
- can_correct_cash_movement
- can_manage_purchasing
- can_close_shift

Rules:

1. Enforce permissions server/domain-side, not only by hiding UI.
2. Test read and write/action separately.
3. Branch scope and capability scope must both pass.
4. Preserve appropriate historical read/audit access when current operational authority changes.
5. Do not infer management authority from a neighbouring operational capability; for example, ordinary stock operation does not imply purchase receiving and ordinary cash entry does not imply cash correction.

# 15. Approved implementation phases

Use this order unless an explicit later decision changes it:

## Phase 1 — Mobile UX shell

New app shell, design system, Home, Sell, Orders, Inventory, More, branch switcher, notifications, capability-aware navigation and loading/error/empty/offline states.

## Phase 2 — Shared commerce foundation

Merchant, Branch, Staff/capabilities, Product/category, SKU/barcode, UOM/conversion/pricing, Customer, Order/Sale, Payment, source channel and stock ledger.

## Phase 3 — Mobile POS

Search/grid, barcode, UOM, cart, customer, pricing/discount policy, hold/resume, checkout, payment methods, split payment where enabled, receipt, sale history and reprint.

## Phase 4 — Inventory

Branch stock, ledger, governed purchase receiving, adjustments, returns impact, transfers, counts, low stock, movement history and UOM conversion integrity.

## Phase 5 — Branch + cashier operations

Branch assignment/switching, register/device, opening shift, expenses, cash movements, governed correction, expected cash, closing shift, variance, manager review and permission boundaries.

## Phase 6 — Bluetooth/device layer

Bluetooth ESC/POS, discovery/pairing, 58/80mm rendering, default/test/auto/reprint, scanner support and device/register association.

## Phase 7 — WhatsApp unification

Connect current WhatsApp functionality to the shared customer, Product/UOM, branch availability, cart/order, pricing, payment, fulfilment, receipt, delivery and reporting model.

## Phase 8 — Merchant Web V1

Overview, Sales, Orders, Products, UOM, Pricing, Inventory, Customers, Branches, Cashiers/Managers, Payments, Cash, WhatsApp, tenant feedback review and Settings.

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

For Merchant Web, verify the approved navigation grouping, SellerTray identity, visible Business/Branch context, collapsible desktop navigation and slide-over/drawer navigation on narrow screens. Do not accept a horizontally scrolling full administration hierarchy as the responsive navigation solution.

For phone POS specifically, verify the Products -> Cart -> Payment stage separation, tile-default catalogue, scalable paging/loading, direct quantity entry, and that large catalogues do not require scrolling through the cart or payment UI.

Where adjustable font sizing is implemented, verify the persisted slider affects the appropriate SellerTray-wide text surfaces without breaking critical layouts.

## Permission gate

Verify representative allowed/denied read, allowed/denied write/action, branch isolation and multi-branch switching.

## UOM gate

Verify Business UOM master create/select authority, Stock UOM, alternate conversion, UOM-specific price, UOM barcode where implemented, fractional policy, persisted conversion factor and correct stock impact. Verify Mobile and Merchant Web consume the same tenant master vocabulary rather than maintaining separate free-entry lists.

## Inventory gate

Verify sale deduction, return restoration, purchase receiving, transfer, adjustment, stock count reconciliation, movement history and retry safety. Verify supplier stock cannot bypass Purchase Receiving and inter-Branch stock cannot bypass Stock Transfer.

## Payment gate

Verify success, pending verification, failure, retry/idempotency, split payment where applicable and refund/reference behaviour. For POS shifts, also verify Branch assignment, per-shift payment-method snapshot, separate cash/non-cash totals, drawer variance isolation, retry-safe payment attribution and governed cash correction without destructive history mutation.

## WhatsApp regression gate

When shared commerce changes, verify customer resolution, Product/UOM resolution where applicable, order creation, payment linkage, merchant takeover and receipt/status behaviour. Payment changes must also prove that in-person-only methods such as physical card terminals are never advertised as WhatsApp/customer payment options.

## Printing gate

Verify successful print, unavailable/failing printer after successful sale, reprint without duplication, configured copy headings/order, custom copy labels, merchant footer/platform attribution separation, printer-safe output, and 58/80mm where implemented.

## Reporting gate

Verify filters/totals against source transactions, especially period, branch, source channel, UOM-normalised quantity, payment state and returns/cancellations. Verify operational drafts and audit-deleted drafts do not inflate completed sales/performance totals.

## Offline gate

When offline is touched, verify local commit, queued sync, repeated sync, duplicate prevention, conflict outcome and user-visible sync status.

## Feedback gate

When feedback is touched, verify signed-in submission state, repeat submission, tenant isolation, Owner/Manager dashboard access and denial for unauthorised/non-member users.

# 18. Anti-divergence rules

1. Do not fork POS, WhatsApp, web and AI into separate commerce truth.
2. Do not duplicate UOM conversion logic in clients.
3. Do not maintain separate client-side Category or UOM master vocabularies; create/select through the shared Business masters and preserve historical transaction snapshots independently.
4. Do not let reporting invent business rules independently of transaction state.
5. Do not add a second payment model for a new channel.
6. Do not let offline create a parallel permanent database model.
7. Do not expose cross-tenant or cross-branch data for convenience.
8. Do not bypass server/domain validation because the UI already checked something.
9. Do not use generic direct stock receipt where purchasing or transfer receiving is the governed source.
10. Do not destructively edit posted cash history to correct a mistake.

# 19. Definition of done

A SellerTray implementation slice is complete only when:

- the approved business behaviour works end to end;
- mobile/web/WhatsApp/AI boundaries remain coherent;
- branch and permission rules are enforced;
- UOM and inventory effects are correct where relevant;
- payment and retry/idempotency rules are preserved;
- offline implications are handled where relevant;
- reporting implications are handled where relevant;
- user-facing language is merchant-facing;
- relevant tests pass;
- WhatsApp regressions are checked when shared commerce changed;
- migrations and deployment steps are documented;
- no known divergence from this governing skill remains unaddressed.