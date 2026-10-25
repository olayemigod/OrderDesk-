# SellerTray Repository Agent Instructions

These instructions apply to all work in this repository unless a more specific nested `AGENTS.md` adds narrower compatible guidance.

## Mandatory governing skill

Before planning, editing, reviewing, refactoring, testing, or documenting any SellerTray product change, read and follow:

`.agents/skills/sellertray-project-implementation/SKILL.md`

For **every SellerTray task**, also read and follow:

`.agents/skills/sellertray-project-implementation/CROSS_SURFACE.md`

`CROSS_SURFACE.md` is a universal normative extension of the governing skill. It requires agents to implement one coherent business capability across every necessarily affected SellerTray surface in the same implementation sweep. A request that names only Merchant Web, Mobile, Admin Web, WhatsApp, AI, reporting, or another single surface does not remove the obligation to inspect and complete dependent process flows elsewhere.

For **every SellerTray task**, also read and follow:

`.agents/skills/sellertray-project-implementation/INTELLIGENT_IMPLEMENTATION.md`

`INTELLIGENT_IMPLEMENTATION.md` is a universal normative extension that requires 360-degree lifecycle reasoning from source of truth through create/update, validation, list/detail, state transitions, payments/receivables, history, print/export, reporting, reversals, reconciliation, permissions/audit, offline/replay and every necessarily affected SellerTray surface. It also requires edge-value, migration-order and no-dead-end-state checks before work may be declared complete.

For any task touching SellerTray Mobile UI/UX, responsive layout, phones, foldables, mini tablets, tablets, large screens, orientation, resizing, navigation layout, split panes, master-detail views, or device-form-factor QA, also read and follow:

`.agents/skills/sellertray-project-implementation/ADAPTIVE.md`

`ADAPTIVE.md` governs one adaptive SellerTray Mobile product across Compact, Medium, Expanded and Large application windows. It forbids separate tablet business truth and requires layout decisions from the live application window rather than a permanent hardware `isTablet` assumption.

For any task touching Admin Web, ProcessEdge internal roles, Platform Admin/Platform Support behavior, privileged platform/commercial actions, Admin read/mutation permissions, Admin MFA/AAL2, internal capability assignment, Admin audit/export authority or platform-operations access, also read and follow:

`.agents/skills/sellertray-project-implementation/ADMIN_CAPABILITIES.md`

`ADMIN_CAPABILITIES.md` preserves Platform Admin and Platform Support as broad responsibility bundles while making explicit server-governed capabilities, scope and immutable audit the long-term authorization authority. Merchant Owner/Manager/Cashier permissions remain a separate merchant-domain model.

For any task touching SellerTray Admin Web information architecture, navigation, page separation, merchant context, commercial workspace layout, responsive Admin shell behavior or ProcessEdge operating workflows, also read and follow:

`.agents/skills/sellertray-project-implementation/ADMIN_NAVIGATION.md`

For any task touching inventory valuation, stock history, purchasing cost, COGS, profitability, inventory reports, transfers, returns, or offline/backdated stock events, also read and follow:

`.agents/skills/sellertray-project-implementation/VALUATION.md`

For any task touching sale returns, returned merchandise, receivables, customer balances, payment refunds, refund methods, cash-drawer refund effects, return history, or return/refund reporting, also read and follow:

`.agents/skills/sellertray-project-implementation/RETURNS.md`

`RETURNS.md` records the later approved receivable-first return settlement doctrine: returned merchandise reduces receivable first, only excess previously collected money may be paid back, Cash and Bank payouts have different drawer effects, and Staff/Cashier may prepare a payout but only Owner/Manager may complete a monetary refund.

For any task touching merchant registration, first Business/Branch preparation, first-purchase onboarding, app-to-web commercial handoff, setup-slot availability, setup appointments, setup scheduling/rescheduling, Admin direct/off-gateway payment confirmation, merchant-specific onboarding discounts, setup completion/readiness, first activation, onboarding status or activation recovery, also read and follow:

`.agents/skills/sellertray-project-implementation/ONBOARDING_ACTIVATION.md`

`ONBOARDING_ACTIVATION.md` records the seamless registration -> Business -> web payment -> setup scheduling -> setup readiness -> automatic activation lifecycle and current OA4 compatibility behavior. Where its older all-initial-Branches activation wording conflicts with the later Commercial V2 Branch-owned target architecture, `COMMERCIAL_V2.md` and `OA5_C2_SEQUENCE.md` control.

For any task touching onboarding, subscriptions, setup fees, Branch commercial activation, Merchant Web billing, Admin Web commercial operations, installments, payment schedules, agreements/terms, money-back guarantees, supplied setup equipment, plans/pricing, VAT/tax presentation, promotions, merchant-specific commercial terms, referrals/rewards, or SellerTray editions, also read and follow:

`.agents/skills/sellertray-project-implementation/COMMERCIAL.md`

For any task touching installment availability, installment enable/disable behavior, installment eligibility, schedule templates, schedule customization, merchant/order-specific installment overrides, or safe treatment of active installment contracts after policy changes, also read and follow:

`.agents/skills/sellertray-project-implementation/COMMERCIAL_FLEXIBILITY.md`

`COMMERCIAL_FLEXIBILITY.md` records the later approved rule that installments are governed configurable commercial policy rather than hard-coded product truth. It allows installments to be enabled or disabled safely without a code deployment, treats 70:30 and 60:20:20 as approved presets rather than the only representable schedules, and requires accepted agreements/payment history to remain immutable unless changed through a governed replacement/amendment path.

For C1 commercial-core work and any implementation that depends on the C1/C1A/C1B/C2 transition boundary, also read and follow:

`.agents/skills/sellertray-project-implementation/COMMERCIAL_C1.md`

`COMMERCIAL_C1.md` records the additive-C1 sequencing decision and the legacy runtime compatibility boundary. Its original C2 purpose remains valid: C2 deliberately retires the legacy trial-oriented Business subscription runtime only after controlled lifecycle evidence.

For any task touching SellerTray subscription ownership, Branch subscriptions, Plan Profiles, plan features/capabilities/limits, commercial master configuration, subscription renewal/extension/change-plan, commercial tax/payment-method masters, agreement-version acceptance, merchant self-service subscription lifecycle, or the C2 target architecture, also read and follow:

`.agents/skills/sellertray-project-implementation/COMMERCIAL_V2.md`

`COMMERCIAL_V2.md` records the later approved target architecture: subscription is Branch-owned; plans are editable/versioned profiles rather than hard-coded editions; features, capabilities and limits come from one governed catalogue; Business subscription state is an aggregate; Branch activation is independent; Admin commercial configuration is master-driven; legal agreements are accepted by required published version rather than on every unchanged order. It controls where older commercial/onboarding rules conflict.

For any task touching OA4 closure, OA5 notifications/reporting, controlled first-merchant acceptance, C2 sequencing, legacy subscription-runtime retirement, Commercial V2 migration/cutover or final mixed-plan multi-Branch acceptance, also read and follow:

`.agents/skills/sellertray-project-implementation/OA5_C2_SEQUENCE.md`

`OA5_C2_SEQUENCE.md` fixes the implementation order as **OA4 acceptance/closure -> OA5 lifecycle notifications/reporting + controlled real-merchant proof -> C2 Commercial V2 cutover/legacy runtime retirement -> later commercial/operations maturity -> launch acceptance**. Do not start the C2 cutover merely because OA4 CI is green.

For any task touching offline POS selling, cached payment methods, offline payment capture/verification, outbox replay, sync conflicts, retry/idempotency, or degraded-connectivity payment behavior, also read and follow:

`.agents/skills/sellertray-project-implementation/OFFLINE.md`

For any task touching sale/invoice printing, receipt semantics, Partial or Pay Later sale documents, later receivable collection receipts, payment/fulfilment status presentation, sale-history reprints, large monetary rendering in these flows, or offline replay of unsettled POS sales, also read and follow:

`.agents/skills/sellertray-project-implementation/SALE_DOCUMENTS.md`

`SALE_DOCUMENTS.md` records the later approved separation between the immutable commercial **Sales Invoice** and payment-specific **Payment Receipt** evidence. It requires explicit Payment/Fulfilment status presentation, confirmed-payment-only receipts, unchanged original invoices after later collection, adaptive monetary rendering, and duplicate-safe Partial/Pay Later replay.

`CROSS_SURFACE.md`, `INTELLIGENT_IMPLEMENTATION.md`, `ADAPTIVE.md`, `ADMIN_CAPABILITIES.md`, `ADMIN_NAVIGATION.md`, `VALUATION.md`, `RETURNS.md`, `ONBOARDING_ACTIVATION.md`, `COMMERCIAL.md`, `COMMERCIAL_FLEXIBILITY.md`, `COMMERCIAL_C1.md`, `COMMERCIAL_V2.md`, `OA5_C2_SEQUENCE.md`, `OFFLINE.md` and `SALE_DOCUMENTS.md` are normative extensions of the governing SellerTray skill for their applicable boundaries. `CROSS_SURFACE.md` and `INTELLIGENT_IMPLEMENTATION.md` apply universally; the others apply when their domains are touched. They do not replace or weaken any rule in `SKILL.md`; later explicit product decisions documented in an applicable extension control only where an older extension conflicts.

That governing skill and its applicable normative extensions are the repository-level implementation contract for the SellerTray redesign. They govern intelligent lifecycle completion, cross-surface flow closure, adaptive Mobile UX and device-form-factor behavior, Admin capability/RBAC boundaries, Admin information architecture, mobile UX, merchant web boundaries, Admin Web platform/commercial operations, shared commerce architecture, POS, inventory, branch awareness, UOM, WhatsApp commerce, payments, returns/refunds/receivables, sale/invoice/payment-document semantics, Branch-owned subscriptions, onboarding/setup scheduling, Admin commercial intervention, setup, configurable installments, Plan Profiles, entitlement features/capabilities/limits, commercial masters, agreement versioning, Merchant Web subscription self-service, OA5 lifecycle evidence, C2 cutover, Bluetooth printing, reporting, AI, permissions, offline behaviour, implementation phases, QA gates, and anti-divergence rules.

The originating SellerTray redesign conversation is the primary decision record when it is available to the agent. The repository skill is the durable fallback and must be used when that thread is unavailable.

A later explicit user decision overrides older guidance. When product direction changes materially, update the governing skill or its applicable normative extension in the same workstream so later agents do not inherit stale instructions.

## Non-negotiable product model

> Mobile performs. Web manages. WhatsApp sells. AI assists. Admin operates the platform. Shared core governs business truth.

All channels use the same SellerTray commerce, inventory, UOM, customer, branch, payment, permission, reporting, and applicable commercial core.

Do not implement a change that creates conflicting business truth across mobile, web, WhatsApp, AI, or Admin operations.

When one surface creates or changes configuration, master data, validation, lifecycle, permissions, state, reporting dimensions, or another process contract that necessarily affects another surface, treat the dependent flow as part of the same business implementation batch. Do not leave affected operational clients on stale free text, hard-coded options, duplicated enums, obsolete validation, or ungoverned behaviour.

For Commercial V2 specifically, do not implement plan-name conditionals, Business-wide subscription authority, duplicated plan feature lists, client-owned entitlement rules or one-surface commercial masters. Branch subscription, Plan Profile, feature/capability/limit, price/tax/installment/payment-method and agreement-version changes must be assessed across Shared Core, Admin Web, Merchant Web, Mobile, WhatsApp, AI, reporting/audit and offline/sync.

## Before declaring work complete

Confirm the applicable QA gates from the governing skill and normative extensions, including the universal cross-surface impact gate and intelligent 360-degree lifecycle gate. Report the tests actually run, preserve existing WhatsApp behaviour unless explicitly changed, and state any migration/build/deployment requirement. Do not describe planned work as completed.

Every completion report must state the cross-surface impact for Shared Core, Merchant Web, Mobile, Admin Web, WhatsApp, AI, reporting/audit, and offline/sync, with either the implemented/verified effect or a concrete no-impact reason.

For Mobile UI/UX work, report the adaptive window classes and device/window sizes actually verified when `ADAPTIVE.md` applies. For Admin work, report the ProcessEdge persona, required capability, scope, MFA/AAL2 boundary, server enforcement point and audit behavior when `ADMIN_CAPABILITIES.md` applies.

For OA4/OA5/C2 commercial work, explicitly state which sequence gate is being worked, which preceding gate has actually been accepted, and whether legacy Business/trial runtime authority remains active. Do not describe a C2 foundation as runtime cutover until migration and controlled acceptance have completed.

## Standing SellerTray progress conclusion

Every SellerTray task conclusion must keep the wider implementation plan visible, even when work continues in a different thread. Do not report only the local code change.

At minimum, conclude with:

1. **Work completed** — the concrete implementation, audit, fix, merge, migration or deployment completed in the current task.
2. **Current overall status** — where SellerTray now stands against the approved implementation plan, including the active surface or phase.
3. **Work remaining** — the important outstanding items from the approved plan, not only issues discovered in the current task.
4. **Blockers or risks** — unresolved failures, dependencies, migrations, deployments, product decisions or QA gaps; state `None` when there are none.
5. **Next bounded step** — the single recommended next implementation batch so work can resume safely in another thread without losing sequence.

Keep commercial/onboarding work, Merchant Web completion, Admin Web completion, mobile work and shared-core work visible as parallel or sequential tracks where applicable. A newly introduced track must not silently erase or block previously pending work unless the user explicitly reprioritises it.

For the current approved onboarding/commercial programme, preserve this visible sequence until a later explicit decision changes it:

> **OA4 acceptance/closure -> OA5 lifecycle notifications/reporting + controlled real-merchant proof -> C2 Commercial V2 cutover/legacy runtime retirement -> remaining commercial/operations maturity -> launch acceptance.**