# OA5 Test + Build47 Mobile convergence — source-only candidate

Date: 2026-11-13.
Status: DRAFT / no APK / no hosted deployment.
Base: Merchant+backend Test candidate PR #246 exact head 8b60aedb579079dfe471c693a6b97c87e180362b.
Mobile source: verified Build47+Expo58 PR #241 exact head be74c26aeba7a629b7e207262af8f2b7182b7707.

## Purpose

Converge the already-tested mobile operational corrections onto the same isolated Test source without weakening Test environment controls.

Exact Build47 blobs ported:
- Orders search/status/payment/channel/date filters are collapsed until deliberately opened, with bounded visible results.
- Customer history orders are clickable and open the governed order, including Branch switching only when the user has that Branch.
- Saved POS drafts can be reopened safely; wrong-Branch resume requires explicit switch, missing Cashier shift is actionable, and connectivity failure preserves the original draft with a retry path.
- Order realtime reloads are coalesced so payment/order/stock events do not trigger overlapping full reloads; Business switches suppress stale records.
- Customer-history order opening may use a targeted order read instead of loading the entire history.
- Sell catalogue uses bounded product rendering, indexed barcode resolution, concurrent current tax/stock reads, and non-blocking cache writes while preserving server-side checkout validation.
- Expo SDK 58 / React Native 0.88 package set and lockfile, current Expo Doctor gate, Zod advisory/bundle checks and required compatibility adaptations.

## Stronger Test controls deliberately retained from OA5 source

Do **not** copy the Build47 branch's older `apps/mobile/app.config.js`. The Test source retains its stricter QA staging guard with independently registered Test Firebase project/sender/app identity, distinct `ng.processedge.sellertray.qa` package, attested non-Production Supabase endpoint, distinct publishable key and production-link exclusion. `eas.json`, OA5 staging attestation scripts, resource governance and manual-only Android APK workflow remain from the OA5 branch.

The existing Android QA APK workflow is `workflow_dispatch` only and requires an exact SHA + named acceptance reason. This convergence must be source/CI-only until hosted Test Method B reconstruction, provider isolation, and separate build approval.

## Cross-surface contract

Backend authority remains the 461-migration Test candidate. Merchant Web invitation, Customer History and Profitability are in PR #246. Mobile still uses shared SellerTray commerce/Branch/UOM/payment/order truth; no mobile-only business state is introduced. WhatsApp Test ingress remains fail-closed on the Production-linked historical Meta phone, and active/non-retired routing remains shared-core authority.

## Required gates

Exact-head Mobile CI must pass dependency audit + verify + Hermes export + Orders/saved-sale tests; Mobile Native CI must pass Kotlin compile. These are source/native compilation gates only, not real-device acceptance. Physical Android acceptance remains required for sale speed, saved-sale resume, offline retry/idempotency, customer history navigation, barcode scan, camera, push, WhatsApp links, 58/80mm printing, Branch switching and payments before calling the artifact Build47-ready.

No Test/Production SQL mutation, Vercel deployment, provider call, cron pause, APK build/distribution or Production/Tandar change is authorised by this branch.
