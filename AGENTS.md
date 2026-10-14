# SellerTray Repository Agent Instructions

These instructions apply to all work in this repository unless a more specific nested `AGENTS.md` adds narrower compatible guidance.

## Mandatory governing skills

Before planning, editing, reviewing, refactoring, testing, or documenting any SellerTray product change, read and follow:

`.agents/skills/sellertray-project-implementation/SKILL.md`

For every SellerTray implementation, review, QA, or PR task, also read and follow:

`.agents/skills/sellertray-ui-form-pr-governance/SKILL.md`

The project implementation skill is the repository-level architecture and product implementation contract. The UI/form/PR/review governance skill supplements it with mandatory semantic field controls, cascading field behaviour, intuitive registration/setup forms, readable and user-adjustable typography, form/accessibility QA, continuous PR reconciliation, and an adversarial pre-finalization implementation audit. Neither skill permits a client to create separate business truth from the shared SellerTray core.

The originating SellerTray redesign conversation is the primary decision record when it is available to the agent. The repository skills are the durable fallback and must be used when that thread is unavailable.

A later explicit user decision overrides older guidance. When product direction changes materially, update the applicable governing skill in the same workstream so later agents do not inherit stale instructions.

## Non-negotiable product model

> Mobile performs. Web manages. WhatsApp sells. AI assists. All channels use the same SellerTray commerce, inventory, UOM, customer, branch, payment, permission, and reporting core.

Do not implement a change that creates conflicting business truth across mobile, web, WhatsApp, or AI.

## Mandatory pre-finalization review

Every implementation must be explicitly audited before it is considered final, merge-ready, releasable, or complete. Review the relevant code, schema, policies, migrations, APIs, tests, integrations and end-to-end flow for loopholes/bypasses, permissions and tenant/branch isolation, omissions, threats/abuse cases, data integrity, race/idempotency risks, auditability, UX/accessibility, compatibility, cross-channel regressions, overall SellerTray product alignment, and overlapping/stale PR implementations.

Blockers and required corrections found by that review must be corrected and re-verified before finalization. Do not downgrade a known material defect to a follow-up merely to finish a task. The completion report must state the audit performed and distinguish verified items, blockers, required corrections and bounded follow-ups.

## Before declaring work complete

Confirm the applicable QA gates from both governing skills, report the tests actually run, preserve existing WhatsApp behaviour unless explicitly changed, state any migration/build/deployment requirement, perform and report the mandatory pre-finalization audit, and reconcile relevant open PRs continuously rather than allowing superseded or overlapping PRs to accumulate. Do not describe planned work as completed.