# SellerTray Repository Agent Instructions

These instructions apply to all work in this repository unless a more specific nested `AGENTS.md` adds narrower compatible guidance.

## Mandatory governing skill

Before planning, editing, reviewing, refactoring, testing, or documenting any SellerTray product change, read and follow:

`.agents/skills/sellertray-project-implementation/SKILL.md`

For **every SellerTray task**, also read and follow:

`.agents/skills/sellertray-project-implementation/CROSS_SURFACE.md`

`.agents/skills/sellertray-project-implementation/INTELLIGENT_IMPLEMENTATION.md`

`CROSS_SURFACE.md` requires one coherent business capability across every necessarily affected SellerTray surface. `INTELLIGENT_IMPLEMENTATION.md` requires 360-degree lifecycle reasoning from source of truth through validation, state transitions, payments/receivables, history, reporting, reversals, reconciliation, permissions/audit, offline/replay and affected surfaces.

For any task touching subscription plans, Plan Profiles, pricing tables, plan features/capabilities/limits, entitlement seeds, AI plan allowances, WhatsApp plan packaging, or Commercial V2 plan migrations, also read and follow:

`.agents/skills/sellertray-project-implementation/COMMERCIAL_V2.md`

`.agents/skills/sellertray-project-implementation/PLAN_SEEDS.md`

`PLAN_SEEDS.md` is the later normative seed contract approved on 2026-10-26. It defines the initial editable Starter/Growth/Scale prices and entitlement matrix, requires approved but undelivered/incomplete/unwired capabilities to remain **Planned** and non-authorizing, excludes merchant payment transaction count/value and payment-method rows from subscription-plan metering, and governs the initial AI and WhatsApp plan treatment. It controls where older suggested plan-seed wording conflicts.

For commercial/onboarding work also consult the applicable normative extensions named by the governing skill, including `COMMERCIAL.md`, `AGREEMENTS.md`, `COMMERCIAL_FLEXIBILITY.md`, `COMMERCIAL_C1.md`, `ONBOARDING_ACTIVATION.md` and `OA5_C2_SEQUENCE.md`. For other domains, consult the applicable extensions named in `SKILL.md` such as `ADAPTIVE.md`, `ADMIN_CAPABILITIES.md`, `ADMIN_NAVIGATION.md`, `VALUATION.md`, `RETURNS.md`, `OFFLINE.md` and `SALE_DOCUMENTS.md`.

The originating SellerTray redesign conversation is the primary decision record when available. A later explicit user decision overrides older guidance and must be carried into the governing skill/extension in the same workstream.

## Non-negotiable product model

> Mobile performs. Web manages. WhatsApp sells. AI assists. Admin operates the platform. Shared core governs business truth.

All channels use the same SellerTray commerce, inventory, UOM, customer, branch, payment, permission, reporting, and applicable commercial core. Do not create conflicting business truth or plan-name conditionals across clients.

## Before declaring work complete

Confirm the applicable QA gates from the governing skill and normative extensions, including cross-surface impact and intelligent lifecycle gates. Report tests actually run and any migration/build/deployment requirement. Do not describe planned work as completed.

Every completion report must state cross-surface impact for Shared Core, Merchant Web, Mobile, Admin Web, WhatsApp, AI, reporting/audit, and offline/sync, with either the verified effect or a concrete no-impact reason.

For OA4/OA5/C2 commercial work, explicitly state the sequence gate being worked, the preceding accepted gate, and whether legacy Business/trial runtime authority remains active. Do not describe C2 foundation work as runtime cutover until migration and controlled acceptance complete.

## Standing SellerTray progress conclusion

Every SellerTray task conclusion must include:

1. **Work completed**.
2. **Current overall status**.
3. **Work remaining**.
4. **Blockers or risks** (`None` when none).
5. **Next bounded step**.

Preserve the current commercial sequence until a later explicit decision changes it:

> **OA4 acceptance/closure -> OA5 lifecycle notifications/reporting + controlled real-merchant proof -> C2 Commercial V2 cutover/legacy runtime retirement -> remaining commercial/operations maturity -> launch acceptance.**