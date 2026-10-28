---
name: sellertray-billing-center
description: "Normative SellerTray Merchant Web Billing Center contract for merchant-to-SellerTray purchases, subscriptions, setup/equipment charges, invoices, payments, installments and agreement evidence."
metadata:
  author: ProcessEdge Solutions Limited
  product: SellerTray
  version: "0.1.0"
  status: governing-extension
---

# SellerTray Merchant Billing Center Governance

## Status and precedence

This file is a normative extension of `.agents/skills/sellertray-project-implementation/SKILL.md`, `COMMERCIAL.md`, `COMMERCIAL_V2.md`, `AGREEMENTS.md`, `CROSS_SURFACE.md` and `INTELLIGENT_IMPLEMENTATION.md`.

It records the later explicit ProcessEdge decision of 2026-10-28 that Merchant Web must have a first-class **Billing Center** route where the merchant can see and manage all SellerTray platform-billing matters and the complete detail/history of purchases made from ProcessEdge/SellerTray.

Where older Merchant Web navigation or commercial UX omits this destination, this later decision controls.

## Governing distinction

The Billing Center is **not** the merchant's operational Money workspace.

- Merchant operational Money concerns money the merchant collects or owes in its own business: customer payments, receivables, cash shifts, business expenses, returns/refunds and reconciliation.
- Billing Center concerns money and commercial commitments **between the merchant and SellerTray / ProcessEdge**: SellerTray purchases, subscriptions, setup, equipment, add-ons, installments, invoices, SellerTray receipts, settlement history, renewals and legal/commercial evidence.

Do not mix these two domains or create a second billing truth.

## Route and navigation

1. Merchant Web must expose a first-class **Billing Center** navigation destination.
2. The stable target URL is `/billing` once Merchant Web navigation is URL-backed.
3. Until the current state-only Merchant Web shell is migrated to URL routing, the application page identity should still be `billing` and must preserve a direct migration path to `/billing`; do not create a differently named duplicate page.
4. Billing Center should be visible to authorised merchant Owners and Managers according to governed commercial permissions. Cashiers/ordinary Staff do not gain commercial-purchase authority merely because billing information exists.
5. Billing Center is Business-aware and Branch-aware where a purchase/subscription line belongs to a Branch. Business-wide purchases remain Business-scoped.

## Billing Center purpose

The Billing Center must answer, from governed SellerTray commercial truth:

- What has this Business purchased from SellerTray?
- Which Branch does each subscription or setup obligation belong to?
- What Plan Profile/version and billing cycle applies?
- What was charged, discounted, taxed, paid, refunded/credited or remains outstanding?
- Was the purchase direct/full settlement or installment-based?
- What payment evidence exists and when was it confirmed?
- What SellerTray invoice, receipt, Order Form or executed Agreement Package belongs to the purchase?
- When does the subscription renew/expire and what commercial action is available next?
- What setup/equipment obligations and charges were part of the purchase?
- What historical purchases, renewals, upgrades/downgrades, add-ons and adjustments exist?

## Information architecture

Billing Center should provide coherent views rather than one long catch-all page. At minimum it should support:

1. **Overview**
   - current Branch subscription summary;
   - upcoming renewal/expiry attention;
   - current outstanding SellerTray balance/installments;
   - recent purchases and recent confirmed SellerTray payments;
   - blocked commercial actions requiring merchant attention.
2. **Purchases**
   - all governed SellerTray commercial orders;
   - order reference/date/status;
   - exact Branch subjects;
   - Plan Profile/version and billing cycle snapshot;
   - subscription, setup, equipment, add-on and other approved charge lines;
   - gross amount, approved adjustments/discounts, tax and net amount;
   - settlement status and outstanding amount;
   - purchase detail drill-down.
3. **Subscriptions**
   - current Branch-owned subscriptions;
   - plan/version, term, status, effective dates and renewal date;
   - entitlement/usage summary where governed;
   - renew/change-plan/manage actions routed through the shared commercial authority.
4. **Payments & Installments**
   - SellerTray payment history only, not merchant customer-payment operations;
   - confirmed payment date, amount, governed ProcessEdge collection method and reference/evidence;
   - installment structure/schedule, due dates, amount paid and outstanding;
   - reconciliation/exception state where merchant-visible.
5. **Invoices & Receipts**
   - immutable SellerTray/ProcessEdge commercial invoices and confirmed-payment receipts where supported;
   - secure view/download/reprint from governed evidence;
   - no browser-invented financial document totals.
6. **Agreements & Documents**
   - applicable universal Master Agreement version status/history;
   - exact merchant Order Forms;
   - Agreement Package review/executed PDFs;
   - setup/equipment acknowledgement or other governed purchase documents where applicable;
   - download/view from private governed artifact authority.
7. **Billing Profile**
   - governed Business billing identity/contact details and tax information where supported;
   - no silent rewrite of historical invoice/order snapshots when current profile data changes.

Tabs may be adapted to the final Merchant Web design system, but the above business coverage must remain intact.

## Purchase detail contract

A purchase detail view must be reconstructable from immutable governed facts rather than mutable current configuration. It should expose, as applicable:

- commercial order ID/reference and ordered timestamp;
- Business identity snapshot;
- Branch line(s);
- Plan Profile/version and billing cycle snapshot;
- each charge line and quantity;
- setup/equipment/add-on details;
- price version/tax snapshot;
- discount/adjustment evidence;
- gross, tax, net, paid and outstanding amounts;
- settlement/payment history;
- installment obligation and schedule when applicable;
- current setup/readiness/activation relationship where useful to explain status;
- Order Form reference and confirmation;
- Master Agreement version and acceptance status;
- Agreement Package/document links;
- renewal/change-plan lineage when the order replaces or extends a prior commercial position;
- immutable audit/history appropriate for the merchant-facing surface.

Do not recompute historical purchase values from today's Plan Profile, price, tax, Branch name or billing profile when authoritative snapshots exist.

## Shared-core authority

Billing Center is a read/manage surface over the existing governed commercial core. It must not create a new merchant-web billing ledger.

Use the shared authoritative facts for:

- commercial orders and price/tax snapshots;
- Branch subscription/entitlement state;
- adjustments/discounts;
- installment obligations/schedules;
- direct and installment payment confirmations;
- setup obligations/readiness where relevant;
- Master Agreement versions/acceptances;
- Order Forms/confirmations;
- Agreement Packages/artifacts;
- commercial invoices/receipts when implemented;
- renewal/change-plan lineage.

Where the current database lacks one efficient merchant-safe projection, add a governed server read model/RPC that joins these authorities. Do not reproduce settlement arithmetic in browser code.

## Permissions and mutations

1. Merchant Owner has Billing Center access and governed purchase authority.
2. Manager access/purchase authority must respect the existing explicit merchant commercial capability model, including agreement-acceptance authority where required.
3. Staff/Cashier does not gain SellerTray commercial purchase, agreement acceptance or subscription-change authority by default.
4. Server/domain commands remain final authority for new purchases, renewal, plan change, installment selection, payment/settlement and agreement confirmation.
5. Billing Center must display failed/pending/retryable commercial states honestly and provide the correct governed next action; it must not hide a blocked purchase behind a generic success status.

## Cross-surface contract

### Shared Core
Provides the authoritative Billing Center read model and all governed commercial mutations. No duplicate billing ledger is permitted.

### Merchant Web
Owns the full Billing Center management experience, purchase history, subscription self-service, SellerTray payment history and legal/commercial document access.

### Mobile
May show current Branch plan/status, renewal/expiry/outstanding attention and secure **Manage billing** / **View purchase** handoff to Merchant Web. Mobile does not duplicate the full Billing Center or calculate SellerTray pricing locally.

### Admin Web
Continues to operate ProcessEdge pricing, plans, payments/settlement, discounts, agreements, setup and exception/recovery authority. It does not become the merchant-facing Billing Center.

### WhatsApp
Cannot create independent billing truth or accept legal/commercial terms. Merchant billing questions may hand off to the secure Merchant Web Billing Center where appropriate.

### AI
May explain Billing Center facts from governed read models and help the merchant find the correct action. AI cannot invent a charge, payment, entitlement, refund/credit or acceptance fact.

### Reporting/Audit
Commercial reporting and audit must remain reconcilable with the same purchase/payment/subscription/agreement facts displayed in Billing Center.

### Offline/Sync
Billing Center is an online management surface by default. Do not queue authoritative subscription purchases, agreement acceptance or SellerTray commercial settlement offline unless a later approved offline commercial contract is designed.

## UX requirements

1. Use merchant-facing language: **Billing Center**, **Purchases**, **Subscriptions**, **Payments**, **Invoices & Receipts**, **Agreements & Documents**.
2. Do not expose internal table/RPC names, package hashes or reconciliation implementation vocabulary as primary UI.
3. Money states must distinguish total, paid and outstanding; do not label partial payment as paid.
4. Payment state and setup/activation state remain separate truths.
5. Purchase rows should be searchable/filterable by date, Branch, purchase type, plan, payment status and lifecycle status where supported.
6. Empty/loading/error states must explain what the merchant can do next.
7. The design must remain responsive/mobile-web usable even though full management belongs on Merchant Web.

## Minimum QA gate

Before Billing Center is called complete, verify at minimum:

1. a Business with multiple Branches can see each Branch purchase/subscription correctly;
2. mixed Plan Profiles and billing cycles do not collapse into a Business-wide plan;
3. all historical commercial orders are visible without recomputing old prices/taxes;
4. direct/full and installment purchases show correct paid/outstanding state;
5. setup/equipment/add-on lines remain attributable to the exact purchase;
6. discounts/adjustments reconcile to the authoritative commercial total;
7. SellerTray payment history does not mix with merchant customer payments;
8. Order Forms and Agreement Packages map to the exact purchase;
9. unchanged Master Agreement does not create duplicate Master acceptance on a later purchase;
10. invoice/receipt download uses governed immutable evidence;
11. Owner/Manager capability checks are server-enforced and Staff/Cashier cannot mutate commercial state;
12. renewal/change-plan actions create governed commercial history rather than editing expiry/plan fields directly;
13. failed/retryable commercial states remain actionable and do not become dead ends;
14. Merchant Web and Admin commercial views reconcile to the same amounts/statuses;
15. Mobile handoff opens the correct Business/Branch Billing Center context;
16. WhatsApp/AI cannot become an independent billing or acceptance authority;
17. no offline replay can duplicate a SellerTray purchase/payment/entitlement effect.

## Anti-patterns

Do not:

- put SellerTray platform billing inside the merchant's operational customer-payment/Cash & Shifts pages;
- create a browser-maintained Billing Center total or settlement ledger;
- show only the current subscription and omit historical purchases;
- hide setup/equipment/add-on purchases from purchase history;
- present a payment receipt before payment is confirmed;
- regenerate a historical purchase from mutable current Plan/price/tax data;
- let a Branch filter erase Business-wide commercial facts without clear scope;
- require a new universal Master Agreement acceptance for each purchase under the same version;
- make Admin issue routine per-merchant documents manually when zero-touch agreement/package authority already exists;
- add Billing Center only as a visual page without the underlying shared-core read/detail contract.