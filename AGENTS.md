# SellerTray Repository Agent Instructions

These instructions apply to all work in this repository unless a more specific nested `AGENTS.md` adds narrower compatible guidance.

## Mandatory governing skill

Before planning, editing, reviewing, refactoring, testing, or documenting any SellerTray product change, read and follow:

`.agents/skills/sellertray-project-implementation/SKILL.md`

That skill is the repository-level implementation contract for the SellerTray redesign. It governs mobile UX, merchant web boundaries, shared commerce architecture, POS, inventory, branch awareness, UOM, WhatsApp commerce, payments, Bluetooth printing, reporting, AI, permissions, offline behaviour, implementation phases, QA gates, and anti-divergence rules.

The originating SellerTray redesign conversation is the primary decision record when it is available to the agent. The repository skill is the durable fallback and must be used when that thread is unavailable.

A later explicit user decision overrides older guidance. When product direction changes materially, update the governing skill in the same workstream so later agents do not inherit stale instructions.

## Non-negotiable product model

> Mobile performs. Web manages. WhatsApp sells. AI assists. All channels use the same SellerTray commerce, inventory, UOM, customer, branch, payment, permission, and reporting core.

Do not implement a change that creates conflicting business truth across mobile, web, WhatsApp, or AI.

## Before declaring work complete

Confirm the applicable QA gates from the governing skill, report the tests actually run, preserve existing WhatsApp behaviour unless explicitly changed, and state any migration/build/deployment requirement. Do not describe planned work as completed.
