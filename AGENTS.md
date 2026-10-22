# SellerTray Repository Agent Instructions

These instructions apply to all work in this repository unless a more specific nested `AGENTS.md` adds narrower compatible guidance.

## Mandatory governing skill

Before planning, editing, reviewing, refactoring, testing, or documenting any SellerTray product change, read and follow:

`.agents/skills/sellertray-project-implementation/SKILL.md`

For **every SellerTray task**, also read and follow:

`.agents/skills/sellertray-project-implementation/CROSS_SURFACE.md`

`CROSS_SURFACE.md` is a universal normative extension of the governing skill. It requires agents to implement one coherent business capability across every necessarily affected SellerTray surface in the same implementation sweep. A request that names only Merchant Web, Mobile, Admin Web, WhatsApp, AI, reporting, or another single surface does not remove the obligation to inspect and complete dependent process flows elsewhere.

For any task touching SellerTray Mobile UI/UX, responsive layout, phones, foldables, mini tablets, tablets, large screens, orientation, resizing, navigation layout, split panes, master-detail views, or device-form-factor QA, also read and follow:

`.agents/skills/sellertray-project-implementation/ADAPTIVE.md`

`ADAPTIVE.md` governs one adaptive SellerTray Mobile product across Compact, Medium, Expanded and Large application windows. It forbids separate tablet business truth and requires layout decisions from the live application window rather than a permanent hardware `isTablet` assumption.

For any task touching Admin Web, ProcessEdge internal roles, Platform Admin/Platform Support behavior, privileged platform/commercial actions, Admin read/mutation permissions, Admin MFA/AAL2, internal capability assignment, Admin audit/export authority or platform-operations access, also read and follow:

`.agents/skills/sellertray-project-implementation/ADMIN_CAPABILITIES.md`

`ADMIN_CAPABILITIES.md` preserves Platform Admin and Platform Support as broad responsibility bundles while making explicit server-governed capabilities, scope and immutable audit the long-term authorization authority. Merchant Owner/Manager/Cashier permissions remain a separate merchant-domain model.

For any task touching inventory valuation, stock history, purchasing cost, COGS, profitability, inventory reports, transfers, returns, or offline/backdated stock events, also read and follow:

`.agents/skills/sellertray-project-implementation/VALUATION.md`

For any task touching onboarding, subscriptions, setup fees, Branch commercial activation, Merchant Web billing, Admin Web commercial operations, installments, payment schedules, agreements/terms, money-back guarantees, supplied setup equipment, plans/pricing, VAT/tax presentation, promotions, merchant-specific commercial terms, referrals/rewards, or SellerTray editions, also read and follow:

`.agents/skills/sellertray-project-implementation/COMMERCIAL.md`

For C1 commercial-core work and any implementation that depends on the C1/C1A/C1B/C2 transition boundary, also read and follow:

`.agents/skills/sellertray-project-implementation/COMMERCIAL_C1.md`

`COMMERCIAL_C1.md` records the later approved additive-C1 sequencing decision and overrides older C1/C1A/C1B sequence wording where they conflict.

For any task touching offline POS selling, cached payment methods, offline payment capture/verification, outbox replay, sync conflicts, retry/idempotency, or degraded-connectivity payment behavior, also read and follow:

`.agents/skills/sellertray-project-implementation/OFFLINE.md`

`CROSS_SURFACE.md`, `ADAPTIVE.md`, `ADMIN_CAPABILITIES.md`, `VALUATION.md`, `COMMERCIAL.md`, `COMMERCIAL_C1.md` and `OFFLINE.md` are normative extensions of the governing SellerTray skill for their applicable boundaries. `CROSS_SURFACE.md` applies universally; the others apply when their domains are touched. They do not replace or weaken any rule in `SKILL.md`.

That governing skill and its applicable normative extensions are the repository-level implementation contract for the SellerTray redesign. They govern cross-surface flow closure, adaptive Mobile UX and device-form-factor behavior, Admin capability/RBAC boundaries, mobile UX, merchant web boundaries, Admin Web platform/commercial operations, shared commerce architecture, POS, inventory, branch awareness, UOM, WhatsApp commerce, payments, subscriptions, setup, installments, agreements, guarantees, promotions, Bluetooth printing, reporting, AI, permissions, offline behaviour, implementation phases, QA gates, and anti-divergence rules.

The originating SellerTray redesign conversation is the primary decision record when it is available to the agent. The repository skill is the durable fallback and must be used when that thread is unavailable.

A later explicit user decision overrides older guidance. When product direction changes materially, update the governing skill or its applicable normative extension in the same workstream so later agents do not inherit stale instructions.

## Non-negotiable product model

> Mobile performs. Web manages. WhatsApp sells. AI assists. All channels use the same SellerTray commerce, inventory, UOM, customer, branch, payment, permission, reporting, and applicable commercial core.

Do not implement a change that creates conflicting business truth across mobile, web, WhatsApp, AI, or Admin operations.

When one surface creates or changes configuration, master data, validation, lifecycle, permissions, state, reporting dimensions, or another process contract that necessarily affects another surface, treat the dependent flow as part of the same business implementation batch. Do not leave affected operational clients on stale free text, hard-coded options, duplicated enums, obsolete validation, or ungoverned behaviour.

## Before declaring work complete

Confirm the applicable QA gates from the governing skill and normative extensions, including the universal cross-surface impact gate. Report the tests actually run, preserve existing WhatsApp behaviour unless explicitly changed, and state any migration/build/deployment requirement. Do not describe planned work as completed.

Every completion report must state the cross-surface impact for Shared Core, Merchant Web, Mobile, Admin Web, WhatsApp, AI, reporting/audit, and offline/sync, with either the implemented/verified effect or a concrete no-impact reason.

For Mobile UI/UX work, report the adaptive window classes and device/window sizes actually verified when `ADAPTIVE.md` applies. For Admin work, report the ProcessEdge persona, required capability, scope, MFA/AAL2 boundary, server enforcement point and audit behavior when `ADMIN_CAPABILITIES.md` applies.

## Standing SellerTray progress conclusion

Every SellerTray task conclusion must keep the wider implementation plan visible, even when work continues in a different thread. Do not report only the local code change.

At minimum, conclude with:

1. **Work completed** — the concrete implementation, audit, fix, merge, migration or deployment completed in the current task.
2. **Current overall status** — where SellerTray now stands against the approved implementation plan, including the active surface or phase.
3. **Work remaining** — the important outstanding items from the approved plan, not only issues discovered in the current task.
4. **Blockers or risks** — unresolved failures, dependencies, migrations, deployments, product decisions or QA gaps; state `None` when there are none.
5. **Next bounded step** — the single recommended next implementation batch so work can resume safely in another thread without losing sequence.

Keep commercial/onboarding work, Merchant Web completion, Admin Web completion, mobile work and shared-core work visible as parallel or sequential tracks where applicable. A newly introduced track must not silently erase or block previously pending work unless the user explicitly reprioritises it.
