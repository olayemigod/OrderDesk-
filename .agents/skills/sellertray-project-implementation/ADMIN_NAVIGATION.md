# SellerTray Admin Navigation & Process Architecture

Status: **Normative extension of `SKILL.md` and `ADMIN_CAPABILITIES.md` for SellerTray Admin Web information architecture, navigation and ProcessEdge operating workflows**

## Governing principle

> One Admin page represents one primary administrative job. Related jobs may share a navigation group, merchant context and governed authority, but they must not be stacked into one catch-all page merely because they touch the same Business or commercial record.

SellerTray Admin is a ProcessEdge operating portal. It must optimise discovery, task completion, supervision and controlled recovery without creating a second business-truth engine.

The business architecture remains:

> Mobile performs. Web manages. WhatsApp sells. AI assists. Admin operates the platform. Shared core governs business truth.

Navigation and page separation must never be implemented by duplicating commercial, setup, entitlement, payment, merchant, reporting or audit truth in the browser.

## 1. Admin shell contract

1. Desktop uses a persistent SellerTray Admin sidebar with collapsible navigation groups and labelled submenus.
2. Keep the visible hierarchy to no more than two navigation levels: group -> destination.
3. Narrow screens use the same hierarchy in an overlay/slide-over drawer; do not flatten it into a horizontally scrolling strip.
4. The top bar keeps the signed-in ProcessEdge responsibility bundle and selected merchant/Business context obvious where relevant.
5. Navigation may be capability-aware, but hiding a destination never replaces server-side capability enforcement.
6. Do not show empty placeholder destinations merely to reserve future menu space. Expose a destination when its governed read/action surface exists.
7. Tabs are for alternate views of the same record/work object. Unrelated jobs belong in separate destinations, even when they share data.

## 2. Persistent merchant context

Merchant-scoped Admin work uses one explicit shell-level Merchant context.

Rules:

1. A ProcessEdge user should select a Merchant/Business once and carry that context between sibling merchant-scoped destinations.
2. Do not make every sibling module independently ask for the same Merchant again when the shell already has a valid context.
3. Merchant context is navigation/scope state, not authorization. Every read/mutation remains server-scoped and capability-checked.
4. Deep links may include the Merchant/Business identifier so support and operations workflows can open the exact context safely.
5. Changing or clearing Merchant context must not mutate merchant data.
6. Platform-wide destinations may preserve the selected context visually but must clearly indicate when the current page is platform-scoped rather than merchant-scoped.

## 3. Approved Admin navigation direction

The approved destination families are:

### Overview

- Dashboard
- Work Queue when a governed cross-domain action queue/read model exists

Dashboard answers **How is SellerTray / the ProcessEdge SellerTray business doing?**
Work Queue answers **What requires ProcessEdge action now?**

Do not turn Dashboard into the action form for every attention item. Drill into the owning workspace.

### Merchants

- All Merchants
- Onboarding & Activation when a dedicated governed portfolio exists
- Merchant Attention when a dedicated governed portfolio exists

Merchant 360 is a contextual summary and launch point. It may show summary, onboarding, commercial, operational/support and Admin-history views, but mutations should deep-link to the owning task workspace where practical.

### Commercial

- Commercial Orders / initial commercial workspace
- Plans & Pricing
- Payments & Settlement
- Installments
- Agreements
- Guarantees & Refunds
- Promotions when implemented

Commercial grouping does not collapse these into one page. Pricing, commercial orders, payment/settlement, agreements, installment policy, guarantees and entitlement remain distinct governed authorities even though they participate in one commercial lifecycle.

### Onboarding & Setup

- Activation Queue when its governed read model exists
- Setup Appointments
- Setup Completion
- Branch Readiness
- Setup Resources

Setup scheduling, equipment/completion evidence, Branch readiness and entitlement reconciliation are related lifecycle stages but distinct ProcessEdge jobs. Do not append setup-resource management, appointment scheduling, completion evidence and activation recovery below unrelated pricing/payment forms.

OA4 Admin work must land in this group rather than extending a catch-all Billing page.

### Communications

- Merchant Messages / Compose
- Campaign History when separately surfaced

Publishing authority and read/review authority remain capability-separated.

### Platform Operations

- Service Health
- WhatsApp Operations when independently surfaced
- AI Operations when independently surfaced
- Integrations when governed operational tooling exists

Platform Operations owns technical/service health, not ProcessEdge commercial performance.

### Insights & Reports

Expose report destinations only when governed report/read models exist. Dashboard summaries do not replace deeper commercial, onboarding, adoption or operations reporting.

### Governance

- Audit Log
- Admin Access when governed internal capability administration exists
- Platform Settings when actual platform settings are exposed

Do not occupy prime navigation with an empty Settings page.

## 4. Process pattern

Prefer:

> Queue/List -> Record or Merchant context -> Governed action -> Result/history

Avoid:

> Select merchant -> render every possible action -> force the operator to scroll until the required task appears

Task pages should expose one clear primary job, its supporting context, prerequisites, evidence/history and the next valid action.

## 5. Capability and persona behavior

1. Platform Admin and Platform Support remain responsibility bundles; explicit server capabilities remain authority.
2. Support/read-only users should see coherent review surfaces, not unexplained disabled mutation controls scattered through giant pages.
3. Sensitive actions retain existing AAL2, capability, scope, reason/evidence and audit requirements from `ADMIN_CAPABILITIES.md`.
4. Reorganising navigation must not broaden a role, bypass a governed command, move authority into the browser or weaken audit/idempotency.

## 6. Deep-link and routing contract

1. Every first-class Admin destination should have a stable route/hash path.
2. Merchant-scoped deep links should preserve the intended Merchant/Business context.
3. Legacy route aliases may redirect to the new destination during migration so existing links do not become dead ends.
4. Browser Back/Forward navigation must restore both destination and merchant scope without mutating business state.

## 7. Migration discipline

The Admin IA may be converged incrementally when existing catch-all components are too coupled to separate safely in one patch.

During that migration:

1. separate already-independent components first;
2. keep the existing governed RPC/command/service boundaries unchanged unless the business requirement itself changes;
3. remove hidden component side effects such as a selector automatically rendering unrelated management modules;
4. do not declare the full Admin IA complete while a major catch-all page remains;
5. each intermediate branch/PR must state the residual bundled work explicitly.

## 8. QA gate

For Admin navigation/process work verify at minimum:

1. grouped sidebar and submenu behavior on desktop;
2. drawer behavior on narrow screens;
3. active destination and group indication;
4. stable deep links and legacy route aliases;
5. persistent Merchant context across merchant-scoped destinations;
6. context clearing/changing does not mutate business data;
7. Platform Support versus Platform Admin behavior remains no broader than before;
8. AAL2/security bootstrap remains unchanged;
9. server-side capability checks remain authoritative;
10. merchant selectors no longer inject unrelated management modules unless explicitly requested;
11. browser Back/Forward restores route/context;
12. no Merchant Web, Mobile, WhatsApp, AI or offline business behavior changes unless a shared business rule was intentionally changed.

## 9. Cross-surface impact rule

Admin information-architecture-only work normally has no business-behavior impact outside Admin Web because shared authority is unchanged. Still report Shared Core, Merchant Web, Mobile, WhatsApp, AI, reporting/audit and offline/sync effects explicitly under `CROSS_SURFACE.md`.
