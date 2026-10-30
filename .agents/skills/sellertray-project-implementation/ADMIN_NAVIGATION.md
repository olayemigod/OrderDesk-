# SellerTray Admin Navigation & Process Architecture

Status: **Normative extension of `SKILL.md` and `ADMIN_CAPABILITIES.md` for SellerTray Admin Web information architecture, navigation and ProcessEdge operating workflows**

## Governing principle

> One Admin page represents one primary administrative job. Related jobs may share a navigation group, merchant context and governed authority, but they must not be stacked into one catch-all page merely because they touch the same Business or commercial record.

SellerTray Admin is a ProcessEdge operating portal. It must optimise discovery, task completion, supervision and controlled recovery without creating a second business-truth engine.

The business architecture remains:

> Mobile performs. Web manages. WhatsApp sells. AI assists. Admin operates the platform. Shared core governs business truth.

Navigation and page separation must never be implemented by duplicating commercial, setup, entitlement, payment, merchant, reporting or audit truth in the browser.

For agreement-specific behavior, `AGREEMENTS.md` controls: Admin publishes one immutable platform-wide Master Agreement version and may review Business acceptance status/history; merchant-specific issuance/replacement is retired.

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

## 3. Approved Admin navigation

### Overview

- **Dashboard**
- **Work Queue** when a governed cross-domain action queue/read model exists

Dashboard answers **How is SellerTray / the ProcessEdge SellerTray business doing?** Work Queue answers **What requires ProcessEdge action now?** Do not turn Dashboard into the action form for every attention item. Drill into the owning workspace.

### Merchants

- **All Merchants**
- **Onboarding & Activation** when a dedicated governed portfolio exists
- **Merchant Attention** when a dedicated governed portfolio exists

Merchant 360 is a contextual summary and launch point. It may show summary, onboarding, commercial, operational/support and Admin-history views, but mutations should deep-link to the owning task workspace where practical.

### Commercial

The converged first-class destinations are:

- **Commercial Orders** — initial commercial purchase creation and immutable order review;
- **Plans & Pricing** — effective-dated subscription and Branch setup pricing;
- **Payments & Settlement** — authoritative balances, direct payments, discounts/adjustments and installment-policy overrides;
- **Installments** — installment progress and entitlement review;
- **Agreements** — platform-wide Master Agreement version publication plus immutable Business/version acceptance review/history.

The Agreements destination is platform-scoped for publication. Selecting a Merchant/Business adds that Business's acceptance status/history as review context only. It must not expose merchant-specific agreement issuance, replacement, bespoke legal text or Admin-created merchant acceptance.

Future commercial destinations include **Guarantees & Refunds** and **Promotions** when their governed decision/read models exist.

Commercial grouping does not collapse these into one page. Pricing, commercial orders, payment/settlement, Master Agreement publication/acceptance, installment policy, guarantees and entitlement remain distinct governed authorities even though they participate in one commercial lifecycle.

### Onboarding & Setup

The converged first-class destinations are:

- **Setup Appointments** — Branch setup scheduling and rescheduling;
- **Setup Resources** — ProcessEdge service areas, setup workforce, coverage, capacity and travel-buffer administration;
- **Branch Readiness** — review of immutable readiness against exact commercial order + Branch + Branch setup obligations.

Appointment operations and ProcessEdge setup-resource administration are related but separate jobs and therefore remain separate pages. The current setup authority may still require a merchant context to load its governed center projection; that implementation detail must not cause the two jobs to be stacked back onto one page.

OA4 extends this group with:

- **Setup Completion** — structured checklist, equipment, handover and acknowledgement evidence;
- **Activation Queue** — named Branch-level activation blockers;
- entitlement reconciliation/recovery integrated with Branch Readiness where appropriate.

Branch Readiness must not expose the legacy generic `Record ready` shortcut as the primary completion path. Readiness comes from the governed setup-completion authority; OA4 must enrich that completion evidence and recovery path rather than create another readiness or activation state machine.

OA4 Admin work must land in this group rather than extending a catch-all Billing page.

### Communications

The converged first-class destinations are:

- **Compose Message** — create, target, preview and publish governed merchant communications;
- **Campaign History** — review audited prior publications.

Publishing authority and read/review authority remain capability-separated. Do not stack campaign history beneath the message composer simply because both use the same communications authority.

### Platform Operations

The converged first-class destinations are:

- **WhatsApp Operations** — cross-merchant WhatsApp connection/service health;
- **AI Operations** — parser readiness and controlled diagnostics;
- **Payment Infrastructure** — ProcessEdge/SellerTray commercial collection readiness, including redacted provider mode, server-side credential presence, billing-authorization encryption readiness and the governed checkout/webhook/callback destinations.

Payment Infrastructure is platform-scoped and read-only. It must never display, read back into the browser, or persist raw `PAYSTACK_SECRET_KEY`, `BILLING_AUTH_ENCRYPTION_KEY`, service-role credentials or equivalent provider secrets. Raw platform collection credentials remain in the authorised server-side secret store. Admin Web may report configured/not-configured/invalid readiness and endpoint destinations only.

Future **Integrations** or additional service-health destinations should be exposed only when governed operational tooling exists. Platform Operations owns technical/service health, not ProcessEdge commercial performance.

### Insights & Reports

The converged first-class destination is:

- **Revenue Dashboard** — platform-wide ProcessEdge commercial reporting for confirmed collections, commercial order value, period comparison and outstanding installment exposure, with every amount kept separate by currency.

Revenue Dashboard uses the governed server-side business-performance read model; it does not calculate financial truth in the browser. Its destination name does not authorise an accounting shortcut:

1. confirmed collections are cash/settlement facts, not automatically recognised revenue;
2. commercial order value is contract/order value, not automatically recognised revenue;
3. outstanding installments are obligations/exposure, not earned revenue;
4. merchant GMV remains merchant business activity and must not be presented as ProcessEdge revenue;
5. currencies must remain separate unless a future governed FX/consolidation authority explicitly defines conversion;
6. **recognised revenue must not be calculated or displayed until an approved SellerTray revenue-recognition/accounting authority exists**.

Future commercial, onboarding, adoption and operations reports should be exposed here only when governed report/read models exist. Dashboard summaries do not replace deeper report destinations.

### Governance

- **Audit Log**
- **Admin Access** when governed internal capability administration exists
- **Platform Settings** when actual platform settings are exposed

Do not occupy prime navigation with an empty Settings page.

## 4. Process pattern

Prefer:

> Queue/List -> Record or Merchant context -> Governed action -> Result/history

Avoid:

> Select merchant -> render every possible action -> force the operator to scroll until the required task appears

Task pages should expose one clear primary job, its supporting context, prerequisites, evidence/history and the next valid action.

For Agreements, the primary platform job is **publish/review Master Agreement versions**. Merchant context is secondary review of whether that Business accepted the current/historical version; it never changes the published content for that merchant.

For Payment Infrastructure, the primary platform job is **read server-side commercial collection readiness**. It is not a payment entry form, merchant settlement screen or browser secret-management surface.

## 5. Capability and persona behavior

1. Platform Admin and Platform Support remain responsibility bundles; explicit server capabilities remain authority.
2. Support/read-only users should see coherent review surfaces, not unexplained disabled mutation controls scattered through giant pages.
3. Sensitive actions retain existing AAL2, capability, scope, reason/evidence and audit requirements from `ADMIN_CAPABILITIES.md`.
4. Reorganising navigation must not broaden a role, bypass a governed command, move authority into the browser or weaken audit/idempotency.
5. Publishing a Master Agreement version requires the platform-global publication capability; merchant-context selection does not grant or narrow that legal publication authority.
6. Payment Infrastructure readiness requires authenticated ProcessEdge Admin access at AAL2 and a server-side platform membership/read boundary. Its read-only status does not permit browser retrieval or mutation of platform secrets.

## 6. Deep-link and routing contract

1. Every first-class Admin destination has a stable route/hash path.
2. Merchant-scoped deep links preserve the intended Merchant/Business context.
3. Legacy route aliases may redirect to the new destination during migration so existing links do not become dead ends.
4. Browser Back/Forward navigation must restore both destination and merchant scope without mutating business state.
5. The legacy `billing` and `commercial/core` destinations resolve to **Commercial Orders**; they must not resurrect the retired commercial catch-all page.
6. Legacy `communications` / `communications/messages` resolve to **Compose Message**.
7. Legacy `operations` / `operations/health` resolve to **WhatsApp Operations** as the primary service-health landing page.
8. `operations/payments` is the stable **Payment Infrastructure** destination; the short `payment-infrastructure` alias may resolve to it.
9. `reports/revenue` is the stable Revenue Dashboard destination; short `revenue` / `reports` aliases may resolve to it without changing report authority.
10. Any legacy merchant-specific agreement issuance/replacement route may resolve to **Agreements** for history/review, but it must not re-enable the retired mutation path.

## 7. Migration discipline

The Admin IA may be converged incrementally when existing catch-all components are too coupled to separate safely in one patch.

During migration:

1. separate already-independent components first;
2. keep existing governed RPC/command/service boundaries unchanged unless the business requirement itself changes;
3. remove hidden component side effects such as a selector automatically rendering unrelated management modules;
4. do not declare the full Admin IA complete while a major catch-all page remains active;
5. each intermediate branch/PR must state residual bundled work explicitly;
6. once focused destinations replace a catch-all, retire the old active shell/component rather than leaving multiple competing implementations for future agents to accidentally reactivate.

Agreement governance is an intentional business-requirement change: migrate current paths to the universal Master Agreement authority while preserving legacy order-bound agreement records as immutable history only.

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
12. no Merchant Web, Mobile, WhatsApp, AI or offline business behavior changes unless a shared business rule was intentionally changed;
13. active Commercial navigation does not mount the retired all-in-one commercial workspace;
14. Branch Readiness review does not expose a generic direct-readiness mutation that bypasses governed setup completion;
15. Setup Resources is not stacked into Setup Appointments;
16. Campaign History is not stacked into Compose Message;
17. WhatsApp Operations and AI Operations remain independent task pages even though they reuse the same governed platform summary authority;
18. Payment Infrastructure never exposes raw provider/encryption credentials, requires AAL2 plus ProcessEdge platform membership server-side, and reports only redacted readiness/endpoint state;
19. Revenue Dashboard reads governed server facts, keeps currencies separate, and does not label collections, order value, outstanding installments or merchant GMV as recognised revenue;
20. Agreements publishes one universal immutable version, and merchant context is acceptance review only;
21. no Admin route can issue/replace a bespoke merchant/order agreement or fabricate merchant acceptance.

## 9. Browser acceptance requirement

Static typecheck/build/contracts are necessary but do not replace browser acceptance for navigation UX. Verify desktop sidebar behavior, narrow-screen drawer behavior, persistent Merchant context and browser Back/Forward when an executable preview is available.

When the preview provider is unavailable or rate-limited, do not claim visual/browser acceptance. Report the provider blocker explicitly while preserving the exact green static-CI evidence.

## 10. Current implementation sequence

The Admin implementation sequence after the initial IA convergence is:

1. keep **Revenue Dashboard** as the first governed Insights & Reports destination using the existing server-calculated business-performance authority and financial semantic boundaries above;
2. complete browser acceptance for desktop grouped navigation, narrow drawer, Merchant-context persistence and Back/Forward restoration;
3. extend **Onboarding & Setup** with OA4 structured Setup Completion/equipment evidence;
4. add OA4 activation blockers and readiness/entitlement reconciliation recovery without creating another activation state machine;
5. preserve **Agreements** as universal Master Agreement publication + acceptance review under `AGREEMENTS.md`;
6. expose **Payment Infrastructure** as the read-only server readiness surface before the first controlled OA5C live commercial payment, without turning Admin Web into the platform secret store;
7. add later report destinations only as their governed read models become available.

This sequence is an implementation-order contract, not permission to skip the prerequisite authority, security, audit or cross-surface gates of the underlying capability.

## 11. Cross-surface impact rule

Admin information-architecture-only work normally has no business-behavior impact outside Admin Web because shared authority is unchanged. Still report Shared Core, Merchant Web, Mobile, WhatsApp, AI, reporting/audit and offline/sync effects explicitly under `CROSS_SURFACE.md`.

Payment Infrastructure readiness is an Admin/platform-operations view over the existing commercial payment authority. It does not create a second payment ledger, alter Merchant Web checkout, change Mobile/customer payments, or grant WhatsApp/AI payment authority.

The universal Master Agreement correction is not IA-only: Admin publication, Merchant acceptance and Shared Core service-delivery gating must converge in the same governed business change while Mobile/WhatsApp/AI/offline remain consumers or no-impact surfaces as documented in `AGREEMENTS.md`.
