# SellerTray Admin Web Agent Instructions

These instructions apply to `apps/admin-web/**` in addition to repository-level `AGENTS.md` and all applicable SellerTray governing skills.

Before planning, editing, reviewing, refactoring, testing or documenting SellerTray Admin Web, read and follow:

1. `.agents/skills/sellertray-project-implementation/SKILL.md`
2. `.agents/skills/sellertray-project-implementation/CROSS_SURFACE.md`
3. `.agents/skills/sellertray-project-implementation/INTELLIGENT_IMPLEMENTATION.md`
4. `.agents/skills/sellertray-project-implementation/ADMIN_CAPABILITIES.md`
5. `.agents/skills/sellertray-project-implementation/ADMIN_NAVIGATION.md`
6. any additional domain extension required by the requested Admin task, including `ONBOARDING_ACTIVATION.md` and `COMMERCIAL.md` where applicable.

`ADMIN_NAVIGATION.md` is the normative Admin information-architecture contract. Preserve grouped two-level navigation, one-primary-job-per-page, persistent Merchant context for merchant-scoped work, stable deep links, server-authoritative capability checks, and the rule that navigation refactors must not create or duplicate business truth.

The active navigation must preserve these focused jobs:

- **Commercial:** Commercial Orders; Plans & Pricing; Payments & Settlement; Installments; Agreements.
- **Onboarding & Setup:** Setup Appointments; Setup Resources; Branch Readiness. OA4 adds Setup Completion, activation blockers and reconciliation/recovery here.
- **Communications:** Compose Message; Campaign History.
- **Platform Operations:** WhatsApp Operations; AI Operations.
- **Insights & Reports:** Revenue Dashboard as a platform-wide governed report for confirmed collections, commercial order value and outstanding installment exposure. Keep currencies separate and never present collections, order value, outstanding installments or merchant GMV as recognised revenue. Recognised revenue requires a future approved accounting/recognition authority.
- **Governance:** Audit Log, with Admin Access / Platform Settings only when governed implementations exist.

Do not remount the retired all-in-one commercial workspace, stack setup resources back into appointment work, place campaign history under the composer, recombine WhatsApp and AI operational work, restore generic direct-readiness UI while OA4 structured completion/recovery is the governed direction, or invent accounting truth in Revenue Dashboard.

Browser acceptance is part of the Admin navigation QA gate. When a preview/deployment provider is unavailable or rate-limited, do not claim desktop/narrow/Back-Forward visual acceptance from static CI alone; report that environmental blocker explicitly while preserving the green typecheck, security, regression and production-build evidence.
