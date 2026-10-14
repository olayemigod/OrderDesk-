# SellerTray Repository Agent Instructions

These instructions apply to all work in this repository unless a more specific nested `AGENTS.md` adds narrower compatible guidance.

## Mandatory governing skills

Before planning, editing, reviewing, refactoring, testing, or documenting any SellerTray product change, read and follow:

`.agents/skills/sellertray-project-implementation/SKILL.md`

For any SellerTray task touching UI, forms, fields, registration/onboarding, typography/accessibility, or branch/PR management, also read and follow:

`.agents/skills/sellertray-ui-form-pr-governance/SKILL.md`

The project implementation skill is the repository-level architecture and product implementation contract. The UI/form/PR governance skill supplements it with mandatory semantic field controls, cascading field behaviour, intuitive registration/setup forms, readable and user-adjustable typography, form/accessibility QA, and continuous PR reconciliation rules. Neither skill permits a client to create separate business truth from the shared SellerTray core.

The originating SellerTray redesign conversation is the primary decision record when it is available to the agent. The repository skills are the durable fallback and must be used when that thread is unavailable.

A later explicit user decision overrides older guidance. When product direction changes materially, update the applicable governing skill in the same workstream so later agents do not inherit stale instructions.

## Non-negotiable product model

> Mobile performs. Web manages. WhatsApp sells. AI assists. All channels use the same SellerTray commerce, inventory, UOM, customer, branch, payment, permission, and reporting core.

Do not implement a change that creates conflicting business truth across mobile, web, WhatsApp, or AI.

## Before declaring work complete

Confirm the applicable QA gates from both governing skills, report the tests actually run, preserve existing WhatsApp behaviour unless explicitly changed, state any migration/build/deployment requirement, and reconcile relevant open PRs continuously rather than allowing superseded or overlapping PRs to accumulate. Do not describe planned work as completed.
