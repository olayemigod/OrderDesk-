# SellerTray Cross-Surface Flow Governance

Status: **Normative universal extension of `SKILL.md`**

This extension applies to **every SellerTray implementation task**, not only tasks explicitly labelled cross-surface. It exists to prevent a feature from being implemented on one surface while leaving another SellerTray surface with an obsolete, contradictory, free-text, duplicated, or incomplete process.

## Governing rule

> Implement the business capability, not only the screen that exposed the request.

When a change on one SellerTray surface creates, changes, constrains, configures, names, validates, or removes a business process that another surface consumes, performs, supervises, reports, prints, reconciles, automates, or assists, the dependent surfaces must be assessed and completed in the **same implementation sweep**.

This rule is bidirectional:

- Merchant Web -> Mobile / WhatsApp / AI / reports when Web manages configuration or master data used operationally.
- Mobile -> Merchant Web / Admin Web / reports when a new operational process needs management, review, setup, audit, reconciliation, or analytics.
- Admin Web -> Merchant Web / Mobile / WhatsApp / AI when a platform-level setting or commercial/platform authority changes tenant-visible behaviour.
- WhatsApp / AI -> Merchant Web / Mobile / reports when automation introduces a governed process merchants must take over, configure, inspect, reconcile, or report.
- Shared-core changes -> every consuming surface whose behaviour or contract is affected.

Do not interpret “same implementation sweep” as “copy the same UI everywhere.” SellerTray surfaces have different responsibilities:

> Mobile performs. Web manages. WhatsApp sells. AI assists. Admin operates the platform. Shared core governs business truth.

The requirement is **one coherent business flow and one source of truth**, with the appropriate UX on each affected surface.

## Mandatory impact assessment before editing

For every SellerTray change, the agent must first answer these questions from the current repository and governing skills:

1. **What business capability or rule is changing?**
   - Identify the domain object, lifecycle, master data, setting, permission, validation, state transition, report dimension, or command.
2. **Where is the authoritative truth?**
   - Identify the shared schema, RPC/command, domain/service boundary, ledger, immutable snapshot, settings authority, or master-data authority.
3. **Which surfaces produce or manage this truth?**
   - Merchant Web, Mobile, Admin Web, WhatsApp, AI, integrations, offline queue, or another governed entry point.
4. **Which surfaces consume or depend on it?**
   - Include forms, selectors, operational flows, receipts, order history, shift review, reporting, dashboards, AI answers, WhatsApp flows, offline replay and exports where relevant.
5. **What historical and compatibility behaviour changes?**
   - Consider existing records, immutable snapshots, migrations/backfill, old clients, archived masters, retries, idempotency and offline commands.
6. **What is explicitly unaffected?**
   - State why a neighbouring surface does not require change. Silence is not a no-impact decision.

This assessment must happen even when the user names only one UI surface.

## Same-sweep implementation contract

When the impact assessment finds a necessary dependent flow, implement the following as one bounded business outcome:

1. **Shared authority first**
   - Add or change the governed schema, master, setting, command/RPC/service, validation and permission boundary once.
   - Do not solve cross-surface consistency by duplicating client-side rules.
2. **Management/configuration surface**
   - Implement the appropriate Merchant Web and/or Admin Web management experience when the capability needs setup, lifecycle management, supervision, approval, reconciliation, or platform operation.
3. **Operational surface**
   - Update Mobile and/or WhatsApp operational flows to consume the governed configuration or master instead of keeping stale free text, hard-coded options or independent logic.
4. **AI/integration surface**
   - Update AI or integration resolution only when the capability is exposed there; it must consume the same governed truth.
5. **History/reporting/audit**
   - Preserve the authoritative historical value or snapshot needed to explain old transactions after configuration changes.
   - Update report dimensions, filters, dashboards, receipts, shift review, exports or audit views where the changed capability is materially represented.
6. **Offline and retry behaviour**
   - If an affected operation can be queued or performed offline, update cache/replay/versioning/idempotency so offline does not preserve the obsolete contract.
7. **Compatibility and migration**
   - Define migration/backfill/default behaviour for existing data and older clients where required.
8. **Cross-surface verification**
   - Test the shared authority plus every affected producer/consumer surface. A unit test on the initiating screen is not enough.

A feature is **not complete** if a dependent surface still exposes an old process that contradicts the new governed flow.

## Intelligent cascade rules

The agent must make the cascade decision from product semantics, not by mechanically touching every application.

Examples:

- A new Merchant Web master used during selling normally cascades to Mobile selectors and WhatsApp/AI resolution, but not necessarily to Admin Web if Admin does not own that merchant master.
- A new Mobile cashier action normally cascades to Merchant Web review/reporting if owners/managers must supervise it, but it does not automatically create a Merchant Web transaction-entry form.
- A platform commercial rule created in Admin Web cascades to Merchant Web/Mobile only to the extent it changes merchant entitlement, setup, billing or runtime behaviour.
- A new report-only filter does not require a Mobile change unless Mobile also exposes that report or depends on that dimension operationally.

The agent must report the decision, including explicit no-impact conclusions for closely related surfaces.

## Expense Category reference example

If SellerTray introduces or manages **Expense Categories** as Merchant Web business configuration, that immediately changes the operational expense contract.

The correct sweep is:

1. Create or confirm one governed Business-scoped Expense Category authority with lifecycle, tenant isolation, permissions and audit behaviour.
2. Merchant Web owns the richer category-management experience where categories can be created, renamed/archived according to safe reference rules, and selected when recording a Business Expense.
3. Mobile Business Expense entry must stop accepting unrelated unrestricted category free text and select from the same active governed categories.
4. Any Cashier Expense flow that uses the same category concept must consume the same governed vocabulary unless the product intentionally defines a separate cashier-expense classification; that distinction must be explicit in the shared domain.
5. Server/domain expense commands must validate the category authority. Client-side selection alone is not sufficient.
6. Existing expense history must remain intelligible after a category is renamed or archived. Preserve the required immutable category identity/snapshot rather than rewriting historical meaning.
7. Business Expense reports, filters, AI analysis and other category-dependent views must use the same governed category truth where applicable.
8. If expenses are later supported offline, the active category vocabulary and replay contract must be version/cache safe.

Therefore, adding an Expense Category management feature to Merchant Web while leaving Mobile with `Expense category` free text is an incomplete implementation and must not be reported as finished.

## Additional examples

- Merchant Web assigns payment methods to a Branch -> Mobile POS payment options and shift snapshots must consume that assignment; WhatsApp must still exclude in-person-only methods.
- Merchant Web creates Product Categories or Business UOMs -> Mobile product workflows and WhatsApp/AI product resolution use the same masters; clients cannot keep separate free-text vocabularies.
- Merchant Web changes tax settings -> shared calculation, Mobile checkout, order/invoice history, receipts and reports must remain consistent with the same tax authority.
- Merchant Web changes printer receipt-copy profile -> Mobile printing must consume it and reprint/audit behaviour must preserve the configured snapshot.
- Mobile adds a new shift cash movement type -> Merchant Web Cash & Shifts review, reporting and correction authority must understand that type in the same business sweep.
- Mobile captures a new immutable order attribute -> Merchant Web order review, receipt/reprint and reporting should expose it where it is part of the merchant’s historical transaction evidence.
- Admin Web changes subscription/entitlement semantics -> merchant-visible setup/runtime behaviour must consume the same entitlement authority; do not leave one client enforcing an obsolete plan rule.

## PR and sequencing rule

Cross-surface work may be split into multiple commits for reviewability, but it remains **one business implementation batch**.

Do not merge or declare a user-visible capability complete while a required dependent surface remains on the old contract.

An intermediate foundation PR is acceptable only when all of the following are true:

- the new behaviour is not yet exposed as complete to users;
- backward compatibility is intentional and verified;
- the dependent follow-up is explicitly tracked as part of the same implementation batch;
- the completion report does not claim the business flow is finished.

## Required cross-surface QA gate

For every SellerTray task, verify:

1. the initiating surface works;
2. the shared authority enforces the rule server/domain-side;
3. each affected dependent surface consumes the new contract;
4. stale free-text/hard-coded/duplicated paths cannot bypass the governed truth;
5. permissions and Branch/tenant isolation remain correct;
6. historical records remain explainable;
7. reporting/receipts/reconciliation reflect the change where applicable;
8. offline/retry compatibility is preserved where applicable;
9. WhatsApp and AI regressions are checked when the shared capability is exposed to them.

## Required implementation report

Every completion report must include a concise **Cross-surface impact** section containing:

| Surface | Impact | Implemented / verified | No-impact reason if unchanged |
| --- | --- | --- | --- |
| Shared core | Yes/No | Authority/schema/API/tests | — |
| Merchant Web | Yes/No | Management/config/review changes | Reason |
| Mobile | Yes/No | Operational changes | Reason |
| Admin Web | Yes/No | Platform/commercial changes | Reason |
| WhatsApp | Yes/No | Commerce/resolution changes | Reason |
| AI | Yes/No | Governed assistant changes | Reason |
| Reporting/audit | Yes/No | Reports/history/receipts | Reason |
| Offline/sync | Yes/No | Cache/replay/versioning | Reason |

Also state migrations, deployments/builds, compatibility limits and any deliberately deferred dependent surface.

If a dependent surface is deliberately deferred, the task is not “complete”; report it as a remaining part of the same business batch unless the user explicitly changes scope or product behaviour.

## Anti-divergence additions

Do not:

- implement merchant-managed master data while leaving an affected operational client on unrestricted free text;
- add an operational transaction type without adding the management/reconciliation/reporting flow required to supervise it;
- add a setting on one surface that another affected surface silently ignores;
- create separate enum lists, labels or validation rules in Mobile and Web when they represent one governed business vocabulary;
- mark a one-surface implementation complete merely because its local tests pass;
- treat “not requested in this prompt” as proof that an obviously dependent SellerTray surface is out of scope.
