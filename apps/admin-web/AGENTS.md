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

The active commercial navigation must keep **Commercial Orders**, **Plans & Pricing**, **Payments & Settlement**, **Installments** and **Agreements** as focused destinations. **Setup Appointments** and **Branch Readiness** belong under **Onboarding & Setup**. Do not remount the retired all-in-one commercial workspace or restore generic direct-readiness UI while OA4 structured completion/recovery is the governed direction.
