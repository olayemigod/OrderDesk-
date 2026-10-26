---
name: sellertray-plan-seeds
description: "Normative SellerTray subscription Plan Profile seed matrix and planned-feature treatment for Commercial V2."
metadata:
  author: ProcessEdge Solutions Limited
  product: SellerTray
  version: "0.1.0"
  status: governing-extension
---

# SellerTray Plan Seed Governance

## Status and precedence

This file is a normative extension of `SKILL.md`, `COMMERCIAL.md` and `COMMERCIAL_V2.md` for subscription Plan Profile seeding and plan-table presentation.

It records the later explicit product decision approved on 2026-10-26. Where older suggested seed wording conflicts, this file controls.

The plan names, prices, entitlements and limits below are **initial editable seed configuration**, not permanent code constants. Runtime behavior must resolve the published Plan Profile Version and governed entitlement catalogue. Do not add `Starter`/`Growth`/`Scale` conditionals to application code.

## 1. Initial Plan Profile seeds

Seed these three merchant-facing Plan Profiles:

1. **Starter**
2. **Growth**
3. **Scale**

Seed pricing:

| Plan | Monthly | Yearly |
| --- | ---: | ---: |
| Starter | ₦5,000 | ₦50,000 |
| Growth | ₦12,500 | ₦125,000 |
| Scale | ₦25,000 | ₦250,000 |

Yearly pricing preserves the approved **10 months paid for 12 months service** rule. Pricing remains editable, effective-dated commercial data.

## 2. Approved entitlement seed matrix

The initial Plan Profile entitlement matrix is:

| Entitlement | Starter | Growth | Scale |
| --- | ---: | ---: | ---: |
| Branches | Not plan-limited | Not plan-limited | Not plan-limited |
| Staff | 3 | 10 | 30 |
| Active registers | 2 | 5 | 15 |
| Products / SKUs | 2,500 | 10,000 | 50,000 |
| Mobile POS | Included | Included | Included |
| Offline selling | Included | Included | Included |
| Inventory & UOM | Included | Included | Included |
| Customers | Included | Included | Included |
| Receivables / Pay Later | Included | Included | Included |
| Returns & refunds | Included | Included | Included |
| Bluetooth printing | Included | Included | Included |
| Expenses & cash shifts | Included | Included | Included |
| Merchant Web | Included | Included | Included |
| Standard reporting | Included | Included | Included |
| Advanced analytics | Not included | Included | Included |
| Scheduled reports | Not included | Included | Included |
| API / Webhooks | Not included | Not included | Included |
| Advanced automation | Not included | Not included | Included |
| Advanced controls & audit | Not included | Not included | Included |
| WhatsApp Commerce | Included | Included | Included |
| WhatsApp automation | Basic | Advanced | Advanced+ |
| WhatsApp analytics | Basic | Full | Full |
| AI units / month | 100 | 400 | 1,000 |

These values are seed defaults and must be represented through the governed feature/capability/limit catalogue and Plan Profile Version records rather than bespoke columns or client constants wherever the Commercial V2 model provides the applicable authority.

## 3. Implemented versus planned plan-table status

The seed matrix expresses approved commercial intent. It does **not** authorize agents to pretend that an unimplemented capability already exists.

Before seeding or publishing a plan table, agents must inventory the actual SellerTray implementation and classify every plan-table row as one of:

- **Available** — the capability is implemented, governed, and sufficiently verified for the applicable release boundary.
- **Planned** — the capability is approved for the plan but is not yet implemented, is only partially implemented, is not wired to the entitlement authority, or has not passed the required acceptance gate.
- **Unavailable for this plan** — the capability exists but is deliberately not included in that Plan Profile Version.

Rules:

1. Any approved plan feature that is unimplemented, incomplete, placeholder-only, not entitlement-enforced, or not accepted must be shown/stored as **Planned**, not as Included/Available.
2. Do not implement speculative functionality merely because it appears in this seed matrix. The approved implementation sequence and bounded workstream still control.
3. Do not remove an approved future capability from the plan catalogue simply because implementation has not started. Preserve it as Planned when it is useful to represent the approved roadmap.
4. A Planned capability must not grant runtime authority, unlock a route, satisfy an entitlement check, or be counted as delivered functionality.
5. Promotion from Planned to Available requires the actual implementation, cross-surface wiring where applicable, server-side entitlement enforcement, tests/QA required by the governing skills, and the relevant release/acceptance gate.
6. If a feature is only partially available, keep the parent commercial promise Planned unless the available subset has its own honest, separately named entitlement.
7. Merchant-facing pricing/comparison surfaces must distinguish Planned from Available clearly and must not use a checkmark or equivalent delivered-state presentation for Planned functionality.
8. Historical Plan Profile Versions and commercial snapshots must preserve the status/terms that applied when published; do not retroactively rewrite prior contracts.

## 4. Payment gateway exclusion from plan metering

Merchant payment-gateway usage is **not a subscription-plan entitlement dimension**.

Do not add these rows to the Starter/Growth/Scale pricing or entitlement comparison table:

- payment methods;
- payment transaction value;
- payment transaction count.

Do not meter merchant payment transaction count or value against the subscription plan merely because the merchant uses a gateway.

Gateway/provider charges arising from merchant commerce remain governed by the applicable payment/provider commercial arrangement and are separate from SellerTray subscription entitlements. ProcessEdge's cost of collecting SellerTray's own subscription payment is a platform commercial/billing expense, not a merchant plan quota.

This exclusion does not weaken payment permissions, reconciliation, idempotency, settlement, evidence, refund or financial-integrity rules.

## 5. WhatsApp cost treatment

WhatsApp Commerce may be included as a SellerTray plan capability, with plan-specific SellerTray automation/analytics levels as seeded above.

External Meta/BSP messaging charges are not an unlimited cost obligation bundled into the SellerTray subscription. The merchant/provider charging arrangement remains separate from SellerTray Plan Profile entitlement unless a later explicit commercial decision introduces a governed bundled allowance.

Do not invent free-message quantities or silently make ProcessEdge absorb provider traffic costs.

## 6. AI allocation treatment

Seed monthly AI allowances as:

- Starter: **100 AI units**;
- Growth: **400 AI units**;
- Scale: **1,000 AI units**.

AI units are governed SellerTray usage units, not a promise that every AI request has identical provider cost. The AI authority may consume different unit amounts for materially different classes of work when a later approved metering schedule is implemented.

Do not expose raw provider token accounting as the merchant's plan contract. Do not allow clients to self-author usage or remaining quota.

Additional AI usage may be implemented through governed add-ons/top-ups, but no add-on price should be invented or seeded unless separately approved.

## 7. Capacity semantics

- **Branches** are not plan-limited. Each Branch owns its subscription under Commercial V2.
- **Staff** means the governed active staff capacity applicable to the subscription scope; historical/deactivated staff must not be deleted when a lower limit applies.
- **Active registers** is the selling-register/device capacity. Do not substitute arbitrary device installations or payment terminals for this limit.
- **Products / SKUs** is the governed active catalogue capacity. Historical/inactive catalogue records must not be deleted because of a lower limit.
- Limit enforcement must preserve history and fail safely on new activation/creation when the applicable hard limit has been reached.

## 8. Seeding and migration discipline

When implementing these seeds:

1. Inventory existing plan, price, feature, capability and limit records before inserting anything.
2. Reuse stable identities where they already represent the approved concept; do not create duplicate Starter/Growth/Scale authorities.
3. Make the migration idempotent and safe against already-seeded environments.
4. Preserve existing subscriber/commercial history and the current OA5/C2 compatibility boundary.
5. Do not perform the C2 runtime cutover merely by adding seed data.
6. Keep plan definition separate from effective-dated price-book records.
7. Ensure Admin can edit/supersede the seeded configuration through the governed Commercial V2 model rather than requiring a code deployment.
8. Seed Planned status for approved but undelivered capabilities and ensure Planned entries are non-authorizing.
9. Verify Merchant Web/Admin comparison surfaces render Available, Planned and unavailable states honestly.
10. Verify Mobile, WhatsApp and AI consume resolved entitlements rather than plan names.

## 9. Acceptance requirement

A Plan Profile seed implementation is not complete until tests prove at minimum:

- the three seed profiles and approved prices are present exactly once;
- annual pricing follows the approved 10-for-12 seed values;
- limits resolve correctly per Plan Profile Version;
- Planned capabilities do not authorize runtime behavior;
- unavailable capabilities remain unavailable;
- Branch count is not treated as a plan limit;
- payment transaction count/value are absent from subscription quota enforcement;
- AI unit allowances resolve as 100 / 400 / 1,000;
- historical/versioned plan behavior remains immutable;
- cross-surface entitlement consumers do not branch on plan names.

This file governs the initial seed intent. Later explicit product decisions may supersede individual values or classifications, but the governing skill must be updated in the same workstream.