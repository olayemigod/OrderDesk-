---
name: sellertray-ui-form-pr-governance
description: "Mandatory SellerTray UI/form semantics, accessible typography, intuitive registration flows, continuous PR reconciliation, and pre-finalization implementation audit rules. Read together with sellertray-project-implementation for every SellerTray implementation, review, QA, or PR task."
metadata:
  author: ProcessEdge Solutions Limited
  product: SellerTray
  version: "0.1.1"
  status: governing
---

# SellerTray UI, Form, PR and Review Governance

## Mandatory relationship to the main skill

This skill supplements `.agents/skills/sellertray-project-implementation/SKILL.md`. Both are governing instructions. The main skill remains authoritative for SellerTray architecture, shared commerce, branch, UOM, inventory, payments, WhatsApp, permissions, reporting and offline behaviour. This skill adds mandatory UI field semantics, form usability, typography/accessibility, PR hygiene, and pre-finalization implementation review.

A later explicit user decision overrides an older rule. If such a decision materially changes these rules, update this skill in the same workstream.

# 1. Semantic field controls are mandatory

Do not default business forms to generic text boxes. Choose the control from the meaning and data type of the field, and preserve the same semantic contract across mobile and merchant web where the business meaning is the same.

Before implementing or reviewing a form, identify every field's semantic type, valid values, dependencies, validation, formatting, search behaviour and mobile interaction.

Use these defaults unless a more specific product rule requires otherwise:

| Field meaning | Required/default control |
| --- | --- |
| Country | Searchable country selector/autocomplete backed by governed country data; never a free-text country box when a known country list is intended. |
| State/Province/Region | Searchable selector filtered by the selected country when governed subdivisions are available. Clear or revalidate it when country changes. Do not retain an invalid subdivision. |
| City/LGA/District | Prefer searchable governed choices when reliable data exists; otherwise use validated text/autocomplete appropriate to the country. Cascade from higher geography where supported. |
| Branch | Searchable selector limited to branches the user is allowed to access/operate. Preserve active branch context. |
| Date | Native/design-system date picker. Do not require manual date-string entry as the primary interaction. |
| Date and time | Date-time picker appropriate to the platform, with timezone/business-time semantics made explicit where relevant. |
| Time only | Time picker. |
| Date range/period | Purpose-built date-range or period control with useful presets where appropriate. |
| Boolean | Checkbox, switch or explicit Yes/No control according to the action semantics; do not use free text. |
| Small fixed choice set | Radio/segmented/select control according to count and context. |
| Large choice set | Searchable select/autocomplete with keyboard and mobile-friendly interaction. |
| Status | Governed status selector or read-only status presentation; never arbitrary text when values are enumerated. |
| Role/permission | Governed role/capability selector using merchant-facing labels and server-authorised values. |
| Currency | Governed currency selector where multiple currencies are valid; formatted monetary input for amounts. |
| Money/amount | Numeric/currency-aware input with correct precision and locale display; never unrestricted text. |
| Quantity | Numeric input respecting fractional/integer policy and UOM rules. |
| UOM | Governed Product/UOM selector. Preserve selected UOM and conversion semantics required by the main skill. |
| Percentage/rate | Numeric input with valid bounds, precision and visible unit/suffix. |
| Phone | Telephone input with country calling-code support, sensible mobile keyboard and normalized storage/validation. Do not treat phone as an arbitrary number. |
| Email | Email input with appropriate keyboard/autocomplete and validation. |
| URL | URL input with validation and appropriate keyboard/autocomplete. |
| Password/PIN/secret | Secure input with appropriate reveal, validation and platform autofill behaviour; never plain text by default. |
| Address | Structured address fields where the workflow benefits from structure; use country/subdivision cascade rather than one opaque text box when those dimensions are required. |
| Product/customer/supplier/staff | Searchable entity selector backed by governed records, scoped to merchant/branch/permission as applicable. |
| Barcode/SKU/reference | Purpose-specific text/scanner input preserving leading zeros and non-numeric identifiers. |
| Long note/reason | Multiline text area with clear purpose and reasonable length guidance. |
| File/image/document | Purpose-built upload/capture control with type/size validation and preview/status where useful. |

Do not force a selector when the value genuinely must allow new free-form data. In those cases, make the create-new path explicit and governed rather than silently accepting arbitrary text into a reference field.

# 2. Cascading and dependent fields

Dependent fields must behave as a coherent flow rather than independent inputs.

Rules:

1. Parent selection filters valid child choices. Example: Country -> State/Province -> City/LGA where supported.
2. When a parent changes, preserve a child only if it remains valid; otherwise clear it and explain what needs reselection.
3. Do not let a child selector display choices that violate the selected parent, merchant, branch, permission, Product/UOM or other governing context.
4. Load dependent options progressively and show loading, empty and error states.
5. Searchable selectors should support practical fuzzy/search behaviour without weakening validation.
6. Server/domain validation remains authoritative even when the client constrains choices.
7. Never infer or silently rewrite business-critical dependent values merely to make submission pass.

# 3. Registration and setup forms

Registration, onboarding and setup forms must be intuitive, smart, concise and user-friendly.

Rules:

1. Ask only for information needed at the current step. Defer optional administration that can safely be completed later.
2. Order fields naturally and group related information. Do not present a long undifferentiated form when progressive steps are clearer.
3. Use sensible defaults derived only from reliable context; never fabricate business data.
4. Use autocomplete, existing merchant data, country-aware controls and dependency-aware defaults to reduce typing.
5. Clearly distinguish required and optional fields.
6. Validate as the user progresses where practical; do not wait until final submission to reveal every simple field error.
7. Preserve entered data after recoverable validation/network errors.
8. Place validation feedback next to the relevant field and state the corrective action in merchant-facing language.
9. Prevent duplicate submissions and provide visible submitting/success/failure state.
10. Support keyboard/autofill/accessibility semantics and appropriate mobile input modes.
11. Avoid asking the same information twice when it can be safely reused from governed context.
12. Review the complete happy path and common failure paths on a small mobile screen and on merchant web before calling the form complete.

# 4. Typography, readability and user adjustment

Readable typography is a product requirement, not cosmetic polish.

Rules:

1. Do not use tiny text to fit more content. Reduce clutter, reflow or progressively disclose instead.
2. Body text, labels, inputs, buttons, tables/cards and supporting text must remain comfortably readable on their target device.
3. Use the shared design-system type scale rather than arbitrary one-off font sizes.
4. Preserve clear hierarchy between headings, body text, labels, metadata and helper text without making secondary information illegibly small.
5. Respect platform/browser accessibility font scaling and text-size preferences wherever technically possible. Do not disable system font scaling merely to protect layout.
6. Web layouts must remain usable under browser zoom/text enlargement; mobile layouts must tolerate larger accessibility text without clipping critical actions or values.
7. Prefer responsive wrapping/reflow over truncating essential business information.
8. Tap/click targets, spacing and line height must remain usable with larger text.
9. If SellerTray provides an in-app text-size preference, implement it through shared design tokens rather than per-screen overrides, and persist the user's choice. Do not create a second styling system.
10. QA must include default text size and an enlarged-text/zoom case for affected screens.

Do not hard-code a universal pixel value as a substitute for accessibility. Platform conventions, shared tokens and user scaling are authoritative; the outcome must be human-readable on mobile and web.

# 5. Form and field QA gate

Any task that adds or changes fields/forms must verify:

- semantic control matches field meaning;
- required/optional state is clear;
- dependent/cascading fields invalidate stale child values correctly;
- searchable selectors handle empty/loading/error/no-result states;
- client and server validation agree;
- mobile keyboard/input mode is appropriate;
- values survive recoverable errors;
- permission and branch scoping are respected;
- accessibility labels/focus/order are sensible;
- default and enlarged text remain readable without hiding critical actions;
- mobile and web behaviour are consistent where they represent the same business truth.

A form is not complete merely because it submits successfully.

# 6. Continuous PR reconciliation and repository hygiene

Do not allow implementation PRs to accumulate indefinitely or form long unhealthy stacks of overlapping work.

Rules:

1. Reconcile PRs continuously during implementation, not only at the end of a large initiative.
2. Before opening a new PR, inspect open PRs/branches for overlap, superseded work, conflicts and an existing suitable integration branch.
3. Prefer extending/reconciling the current approved workstream when a new branch would create duplicate or conflicting truth.
4. When a PR becomes merge-ready and its required gates pass, merge it promptly unless there is a documented dependency requiring it to remain open.
5. Close superseded PRs promptly and record which PR/commit replaced them. Do not leave obsolete PRs open as historical placeholders.
6. Rebase/merge/reconcile dependent branches as needed while work proceeds so conflicts remain small and understandable.
7. Avoid multiple PRs editing the same business capability independently. Reconcile to one authoritative implementation before continuing downstream work.
8. Before declaring a milestone complete, review the open PR list and classify each relevant PR as merge now, intentionally blocked, superseded/close, or active next work.
9. Never merge solely to reduce PR count. Architecture, tests, migrations, permissions, data integrity and QA gates remain mandatory.
10. Do not rewrite shared branch history or force-push merely for cleanliness unless the branch ownership and consequences are understood and explicitly safe.
11. Keep PR scope reviewable, but do not fragment one coherent business outcome into many tiny PRs that create unnecessary dependency chains.
12. When reconciliation changes architecture or approved product behaviour, update the governing skill in the same workstream.

# 7. Mandatory pre-finalization implementation audit

Every implementation must receive an explicit adversarial review before it is considered final, merge-ready, releasable, or complete. Passing the happy path, typecheck, build, or focused tests is necessary but is not sufficient.

The review must inspect the implementation in the context of the whole SellerTray product model and the current repository, not only the files changed in the immediate slice.

At minimum, audit:

1. **Loopholes and bypasses** — identify paths that can bypass the intended domain command, validation, workflow, approval, capability, branch scope, UOM rule, inventory rule, payment rule, idempotency rule, audit trail or other governed service. Include direct client/database mutation paths and service-role/privileged paths.
2. **Permissions and isolation** — verify allowed and denied reads/actions, merchant isolation, branch isolation, role/capability checks, historical-read versus operational authority, privilege grants/RLS and server-side enforcement. Hiding a control in the UI is never sufficient permission enforcement.
3. **Omissions and incomplete flows** — look for missing states, actions, fields, validations, loading/empty/error/offline states, cancellation/retry/recovery paths, audit events, notifications, reporting dimensions, migrations, deployment steps and tests.
4. **Threats and abuse cases** — review relevant trust boundaries, untrusted input, authentication/authorization, privilege escalation, replay/duplicate submission, race/concurrency behavior, tampering, unsafe defaults, data leakage, injection or arbitrary mutation risks, and secret/sensitive-data exposure. Apply the review proportionately to the capability being changed.
5. **Data and business integrity** — confirm merchant/branch attribution, UOM snapshots/conversions, stock ledger integrity, payment/reference idempotency, immutable/history requirements, timestamps, source channel and audit actor attribution remain correct.
6. **End-to-end workflow continuity** — trace the complete user/business flow before and after the change. Verify the implementation has a sensible entry point, next action, completion state and recovery path and does not create a dead end or disconnected feature.
7. **Overall product alignment** — reconcile the implementation with `Mobile performs. Web manages. WhatsApp sells. AI assists.` Confirm it uses the shared SellerTray core and does not create duplicated or conflicting business truth.
8. **Cross-channel/regression impact** — inspect implications for mobile, merchant web, WhatsApp, AI, reports, printing, offline behavior and integrations whenever they share the affected domain capability. Run the applicable regression gates rather than assuming untouched clients remain correct.
9. **UX and accessibility** — check semantic field controls, intuitive flow, readable typography, enlarged text/zoom, touch targets, user-facing labels, error guidance and responsive behavior where UI is affected.
10. **Compatibility and migration** — check existing records, migrations, older app clients, API/function contracts, staged rollouts, retries and backward compatibility where relevant. Never assume only newly-created data exists.
11. **Tests versus actual guarantees** — ensure tests prove the governing behavior, including representative negative/adversarial cases, rather than merely executing code. Identify important guarantees that remain untested.
12. **Repository/PR consistency** — inspect overlapping PRs, migrations, duplicate implementations, stale branches and superseded code so the final result has one authoritative implementation.

The audit must be evidence-based. Inspect relevant code, schema, policies, migrations, APIs, tests and integrations. Do not mark an item safe merely because no problem was observed in the changed file.

For every material finding, classify it as one of:

- **Blocker** — must be corrected before merge/release because it can violate security, permissions, data integrity, governed business truth, or a critical user flow.
- **Required correction** — material omission or defect that should be fixed in the current workstream before finalization.
- **Follow-up** — bounded non-critical improvement that may safely follow, with its limitation recorded.
- **Verified** — reviewed with evidence and no material gap found.

If the audit discovers a blocker or required correction, correct it and re-run the affected audit/test gates before finalizing. Do not convert a known blocker into a follow-up merely to finish the task.

A feature is not complete because its implementation exists. It is complete only when its intended flow, permissions, data integrity, security/trust boundaries, relevant cross-channel effects, tests and repository state have been reviewed and material findings resolved or explicitly bounded according to this governance.

# 8. Agent completion report

For affected work, report:

- semantic field/control decisions and important cascades;
- registration/setup UX implications;
- readability/accessibility checks actually performed;
- tests/QA actually run;
- pre-finalization audit scope and material findings, including blockers/corrections/follow-ups and what was verified;
- PRs reconciled, merged, closed, intentionally blocked or still active;
- migration/build/deployment requirements;
- remaining limitations and the next bounded milestone.

Never report a PR as reconciled, an audit item as verified, or a UX/accessibility check as passed unless it was actually verified.