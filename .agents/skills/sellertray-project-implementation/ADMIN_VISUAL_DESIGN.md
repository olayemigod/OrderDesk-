# SellerTray Admin Web Visual Design Preservation

Status: **Normative extension of `SKILL.md`, `ADMIN_NAVIGATION.md` and `ADMIN_CAPABILITIES.md` for every task that touches, merges, deploys or can affect SellerTray Admin Web.**

## Why this skill exists

SellerTray Admin Web has an explicitly approved redesigned presentation. Functional work must not silently restore an older Admin shell, old workspace styling, old navigation presentation or pre-redesign page composition.

This is a preservation contract, not an instruction to freeze product capability. New Admin functionality must be integrated into the approved redesigned shell and design system.

## Authoritative visual baseline

The approved Admin visual direction is the redesign first established in **PR #149 — `feat(admin): SellerTray Admin visual redesign v1`** and converged onto the newer OA5C functional implementation in **PR #158 — `Converge PR149 Admin redesign onto OA5C`**.

The PR #149 head `8084ea3bcd91362792870892cb8750edae4340c1` is the original approved presentation reference.

PR #158, merged as `c001f7260199a806278bcba7af73d080b31ff047`, is the governing convergence precedent: preserve the redesigned presentation while retaining newer Agreements, onboarding, payment-readiness, security and other governed functional authority.

A later explicit user-approved Admin redesign may supersede this visual baseline. Functional implementation, refactoring, conflict resolution, cherry-picking, rebasing, legal/commercial work or deployment does **not** supersede it by itself.

## Non-negotiable rule

> **Never solve an Admin functional conflict by reverting SellerTray Admin Web to a pre-PR149 visual shell. Preserve the current governed business authority and re-integrate it into the approved redesigned presentation.**

If an older implementation contains required functional code, extract or port that functional behavior into the redesigned Admin structure. Do not wholesale-copy an older `App.tsx`, stylesheet stack, workspace component or route shell over the approved redesign.

## Protected presentation contract

The approved Admin presentation includes, at minimum:

1. the redesigned SellerTray Admin shell;
2. grouped two-level desktop sidebar navigation with clear active states;
3. narrow-screen drawer/overlay navigation rather than a flattened horizontal strip;
4. the redesigned top bar and persistent Merchant/Business context presentation;
5. coherent workspace spacing, hierarchy and page-header treatment;
6. redesigned cards, panels, KPI/stat surfaces, tables, filters, search, buttons, tabs, badges and status treatments;
7. responsive treatment for narrow browser windows;
8. accessible focus visibility and reduced-motion behavior;
9. the approved SellerTray logo and favicon assets;
10. page-specific redesigned presentation already accepted for Dashboard, Revenue Dashboard, Commercial Orders/Pricing, Payments/Settlement, Setup/Onboarding and other Admin destinations as they were converged in PR #158 or later approved work.

The design may evolve only through an intentional UI/UX change. A business-function change is not permission to degrade the shell, spacing, component hierarchy, responsiveness or navigation presentation.

## Protected implementation areas

Before editing or resolving conflicts in Admin Web, inspect the current versions and history of the presentation-bearing files, especially:

- `apps/admin-web/src/App.tsx`
- `apps/admin-web/src/styles.css`
- `apps/admin-web/src/admin-navigation.css`
- `apps/admin-web/src/admin-workspace.css`
- `apps/admin-web/src/brand.css`
- `apps/admin-web/src/BusinessDashboard.tsx`
- `apps/admin-web/src/RevenueDashboard.tsx`
- `apps/admin-web/src/CommercialAdminWorkspaces.tsx`
- `apps/admin-web/src/CommercialSettlementAdministration.tsx`
- `apps/admin-web/src/SetupSchedulingAdministration.tsx`
- any later shared Admin shell/design-system component or stylesheet that replaces these responsibilities.

These filenames are implementation landmarks, not permission to preserve obsolete code forever. If files are intentionally refactored, the visual contract above must remain equivalent or improve through explicit user-approved redesign.

## Merge, rebase and conflict-resolution rule

When Admin functional work is based on a branch that predates the redesign, or when a merge/rebase reports conflicts in presentation-bearing files:

1. treat the redesigned Admin presentation as the visual side to preserve;
2. treat newer governed server/business authority as the functional side to preserve;
3. manually converge both rather than accepting one side wholesale;
4. do not use broad `ours`/`theirs` resolution on `App.tsx` or Admin CSS without reviewing the resulting browser presentation;
5. do not restore a retired catch-all workspace, legacy shell or old page layout merely because it compiles;
6. document any intentional visual change separately from functional convergence.

## Deployment provenance rule

Before any Admin production or preview deployment is declared ready:

1. identify the exact deployed commit SHA;
2. confirm that SHA contains the approved redesigned presentation or an explicitly approved successor;
3. confirm that the deployment did not originate from a stale/pre-redesign branch;
4. verify the production/preview URL actually serves that SHA where the deployment platform exposes provenance;
5. if the deployed browser presentation visibly differs from the approved redesign, treat that as a release regression even if CI is green.

Never describe Admin deployment as successful solely because Vercel/build status is green.

## Required visual anti-regression gate

Any task touching Admin Web must answer all of the following before completion:

- Does the resulting Admin still use the approved redesigned shell?
- Is grouped sidebar navigation still present on desktop?
- Does narrow-screen navigation still use the approved drawer behavior?
- Is Merchant/Business context still presented in the redesigned top-bar/shell pattern?
- Did any page fall back to an older pre-redesign card/table/form layout?
- Did a conflict resolution or copied file remove redesign CSS imports/classes?
- Are approved logo/favicon assets still used?
- Does the changed destination visually belong to the same Admin design system as the rest of the application?
- Was browser acceptance performed against the exact candidate/deployed SHA?

If any answer is unknown, visual acceptance is incomplete. If the browser/preview provider is unavailable, report the blocker and **do not** claim visual acceptance from typecheck/build alone.

## Functional-preservation boundary

This skill does not weaken SellerTray business governance. Preserve all current approved:

- routes and stable legacy aliases where still required;
- Merchant/Business context semantics;
- ProcessEdge personas and explicit Admin capabilities;
- MFA/AAL2 boundaries;
- server-side enforcement;
- RPCs/commands and database authority;
- audit and idempotency;
- tenant isolation;
- commercial, onboarding, agreements, payments, setup, subscription and reporting truth.

No new business fact may be invented merely to reproduce a visual mockup. Conversely, no visual regression may be justified merely because newer business logic was added.

## Page-addition rule

When adding a new Admin capability:

1. place it in the approved `ADMIN_NAVIGATION.md` information architecture;
2. use existing redesigned shell and shared visual primitives first;
3. create a new reusable visual primitive only when the existing system cannot express the approved interaction cleanly;
4. do not create an isolated mini-application or one-off legacy-looking page;
5. verify desktop and narrow-screen behavior;
6. preserve capability-aware visibility and server-authoritative permission enforcement.

## Historical boundary document

The former `apps/admin-web/ADMIN_VISUAL_REDESIGN_BOUNDARY.md` introduced during PR #149/#158 captured the presentation-only nature of that convergence. Its disappearance from a later working branch must **not** be interpreted as cancellation of the approved redesign. This skill is the durable repository-level authority for that preservation requirement.

## Completion report requirement

For every Admin Web task, the completion report must include a **Visual baseline** line stating one of:

- `Preserved — PR149/PR158 redesigned Admin shell verified on <exact SHA>`; or
- `Changed by explicit approved redesign — <decision/reference>`; or
- `Not visually verified — <specific blocker>`.

A completion report that omits this line is incomplete for Admin Web work.
