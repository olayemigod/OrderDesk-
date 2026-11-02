---
name: sellertray-project-implementation
description: "Governing skill for every SellerTray redesign, implementation, refactor, QA, architecture, UX, mobile, merchant web, POS, inventory, branch, UOM, WhatsApp commerce, reporting, Bluetooth printing, AI, payments, purchasing, permissions, or offline-sync task."
metadata:
  author: ProcessEdge Solutions Limited
  product: SellerTray
  version: "0.1.17"
  status: governing
---

# SellerTray Project Implementation Skill

## Mandatory governing baseline

Before attempting any SellerTray implementation, review, planning, QA, deployment, database, UI/UX, Mobile, Merchant Web, Admin Web, WhatsApp, AI, reporting, payments, inventory, UOM, Branch, printing, offline or release task, read `BASELINE_V0_1_16.md` in this skill directory. It contains the complete SellerTray v0.1.16 governing implementation contract and remains normative except where a later explicit decision in this file overrides it.

Also consult the relevant companion governance in this directory, including `CROSS_SURFACE.md`, `INTELLIGENT_IMPLEMENTATION.md`, `ONBOARDING_ACTIVATION.md`, and surface-specific guidance where the task touches those concerns.

A later explicit user decision overrides an older rule. When such a decision materially changes product behaviour or architecture, update this governing skill so future work inherits the decision.

## Governing product rule

> Mobile performs. Web manages. WhatsApp sells. AI assists. Admin operates the platform. All channels use the same SellerTray commerce, inventory, UOM, customer, branch, payment, permission, commercial, and reporting core.

Do not create separate business truth for Mobile, Merchant Web, Admin Web, WhatsApp, or AI. Domain routing is presentation and delivery configuration; it never becomes commercial, authorization, inventory, payment, or reporting authority.

## Canonical production origins — approved 2026-11-02

The canonical SellerTray production origins are:

- Public/marketing: `https://sellertray.com`
- Merchant Web: `https://app.sellertray.com`
- Admin Web: `https://admin.sellertray.com`

Rules:

1. Merchant-facing production links, authenticated Merchant Web continuation links, onboarding/commercial handoffs, and supported merchant callbacks must use `https://app.sellertray.com` unless a later explicit decision changes the canonical origin.
2. Platform-operator production links and supported Admin callbacks must use `https://admin.sellertray.com`.
3. `*.vercel.app` hostnames are deployment/preview aliases only. Do not present them as canonical production URLs or use them as production fallbacks in merchant/admin flows.
4. Mobile must fail closed when a server-provided Merchant Web continuation points to a non-canonical production origin; HTTPS alone is not sufficient trust.
5. Prefer same-origin/static assets on Merchant Web and Admin Web rather than coupling production CSP or branding to a deployment alias.
6. WhatsApp, notifications, documents, receipts, reporting exports, AI responses, and other user-facing surfaces must not generate deployment-alias links where a canonical SellerTray origin exists.
7. Changing domains must not move or duplicate business authority. The governed shared core remains the source of truth for tenant/Branch scope, commercial state, payments, permissions, audit, inventory, UOM, reporting and onboarding readiness.
8. Preview/staging environments may use non-canonical hosts only for explicitly non-production testing; they must not silently become production fallback authority.

## Implementation discipline

For every task, continue to apply the full baseline contract in `BASELINE_V0_1_16.md`: inspect before editing, preserve approved behaviour and invariants, prefer shared/domain authority over duplicated client logic, verify relevant cross-surface implications, run focused and regression gates, and report only completed evidence as complete.
