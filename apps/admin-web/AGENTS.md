# SellerTray Admin Web Agent Instructions

These instructions apply to `apps/admin-web/**` in addition to repository-level `AGENTS.md` and all applicable SellerTray governing skills.

Before planning, editing, reviewing, refactoring, testing, merging, rebasing, resolving conflicts, deploying or documenting SellerTray Admin Web, read and follow:

1. `.agents/skills/sellertray-project-implementation/SKILL.md`
2. `.agents/skills/sellertray-project-implementation/CROSS_SURFACE.md`
3. `.agents/skills/sellertray-project-implementation/INTELLIGENT_IMPLEMENTATION.md`
4. `.agents/skills/sellertray-project-implementation/ADMIN_CAPABILITIES.md`
5. `.agents/skills/sellertray-project-implementation/ADMIN_NAVIGATION.md`
6. `.agents/skills/sellertray-project-implementation/ADMIN_VISUAL_DESIGN.md`
7. any additional domain extension required by the requested Admin task, including `ONBOARDING_ACTIVATION.md` and `COMMERCIAL.md` where applicable.

`ADMIN_NAVIGATION.md` is the normative Admin information-architecture contract. Preserve grouped two-level navigation, one-primary-job-per-page, persistent Merchant context for merchant-scoped work, stable deep links, server-authoritative capability checks, and the rule that navigation refactors must not create or duplicate business truth.

`ADMIN_VISUAL_DESIGN.md` is the normative visual-preservation contract. The approved presentation baseline is the Admin redesign established in PR #149 and converged with newer OA5C authority in PR #158. Functional work, merges, rebases, conflict resolution and deployments must preserve that redesigned shell and design system unless the user explicitly approves a later redesign. Never restore a pre-PR149 shell merely because older functional code is being reused.

The active navigation must preserve these focused jobs:

- **Commercial:** Commercial Orders; Plans & Pricing; Payments & Settlement; Installments; Agreements.
- **Onboarding & Setup:** Setup Appointments; Setup Resources; Branch Readiness. OA4 adds Setup Completion, activation blockers and reconciliation/recovery here.
- **Communications:** Compose Message; Campaign History.
- **Platform Operations:** WhatsApp Operations; AI Operations; Payment Infrastructure for read-only, redacted ProcessEdge/SellerTray collection readiness.
- **Insights & Reports:** Revenue Dashboard as a platform-wide governed report for confirmed collections, commercial order value and outstanding installment exposure. Keep currencies separate and never present collections, order value, outstanding installments or merchant GMV as recognised revenue. Recognised revenue requires a future approved accounting/recognition authority.
- **Governance:** Audit Log, with Admin Access / Platform Settings only when governed implementations exist.

Payment Infrastructure must remain server-derived and AAL2-bound. Admin Web may show only redacted configuration/mode/readiness metadata and endpoint destinations; never place `PAYSTACK_SECRET_KEY`, `BILLING_AUTH_ENCRYPTION_KEY`, other raw platform payment secrets, or unrestricted secret-management controls in browser code or database-backed Admin settings.

Do not remount the retired all-in-one commercial workspace, stack setup resources back into appointment work, place campaign history under the composer, recombine WhatsApp and AI operational work, hide Payment Infrastructure by regressing to a pre-PR154/PR158 operations shell, restore generic direct-readiness UI while OA4 structured completion/recovery is the governed direction, or invent accounting truth in Revenue Dashboard.

Do not replace the redesigned Admin shell, PR149/PR158 styling stack, responsive navigation treatment, Merchant-context presentation, dashboard hierarchy or shared visual patterns with an older implementation during functional convergence. If an older branch contains required business behavior, port that behavior into the redesigned presentation instead of copying the old shell wholesale.

Browser acceptance is part of the Admin navigation and visual QA gate. When a preview/deployment provider is unavailable or rate-limited, do not claim desktop/narrow/Back-Forward or visual-baseline acceptance from static CI alone; report that environmental blocker explicitly while preserving the green typecheck, security, regression and production-build evidence.

Every Admin completion report must include the `Visual baseline` result required by `ADMIN_VISUAL_DESIGN.md` and identify the exact candidate/deployed SHA used for that verification.
