# Build 47 / PR #238 SDK 58 security convergence — source-only candidate
Date: 2026-11-12. Status: DRAFT; not yet native QA / APK / Production approved.

Purpose: resolve the *existing* Mobile CI expired SDK57 Expo CLI / Zod dependency vulnerability **without** rewriting PR #238's already-implemented Orders search, hideable filters, customer order history, saved-sale recovery or Build47 shared commerce functions.

## Reuse, no duplicate reimplementation
- SDK 58 candidate source is exact tested PR #235 at `ccb253b0a31feb281b47862aeeea2dfeca241c9e`: verified Mobile CI PASS run 42591466500 and Mobile Native CI PASS 42591466615 at that SHA. Copy only previously validated SDK58-compatible mobile config, pinned published lockfile, checked React Native 0.88 source adaptations and matching production audit guards.
- Branch base is exact PR #238 `b413345c830369b2bb031f21495eaea05bd9ab81`, preserving PR #238's current search/filter and customer order-history implementation.
- The merged Mobile `package.json` retains both existing PR #238 focused checks (`order-search-filters.test.mjs` and `saved-sale-resume.test.mjs`) while adopting the SDK58 dependencies. `package-lock.json` comes **unaltered** from vetted PR #235 because these two scripts add no dependencies.
- Existing business APIs, stock, UOM, payment, WhatsApp webhooks, offline queue and native printer module are not changed by this convergence source slice.
- Expo Doctor monorepo lockfile-locator check remains fail-closed and validates installed/pinned SDK58; no security-exception extension or suppression.

## Explicit resource/Release boundaries
- Android APK creation remains a **manual GitHub workflow_dispatch** operation on the PR #238 base. Do not automatically build or distribute QA APKs from this branch.
- If Vercel's Git integration automatically creates a preview for this GitHub branch, it is incidental to source activity, **not QA acceptance** or authorization for deployment. No Vercel config change, Test migration, provider change or Production deployment is approved.
- SDK58 physical Android device regression remains mandatory (saved-sale resume and offline conflict/idempotency, barcode scan, 58/80mm printer, camera, push, WhatsApp deep links, permissions and payment).
- The separate Web urgent compatibility lane is PR #239; do not merge its Production web logic or migration history into this mobile dependency branch merely to appease CI.

## Acceptance gates
1. Exact-head Mobile CI must pass **both** verify and dependency-audit, with actual npm CI package lock, TypeScript and Hermes release export.
2. The two PR #238 tests and existing Branch/UOM/sale payment/offline/WhatsApp source regression gates must still pass.
3. Native Kotlin compile and Android hardware acceptance are **not** implied by JavaScript CI; require their own review and separately authorised build. In particular do not call this APK Build47.
4. Before release, reconcile the resulting dependency candidate with the correct Production-compatible Mobile source, Test Method B isolated backend and exact version code, and obtain separate approval.
