# OA5 Test / Build 47 Expo SDK58 convergence — source-only candidate
Date: 2026-11-12. DRAFT. Base: Merchant Web acceptance PR #243 @ 638b867512fcc7605c8b28b9d786135c925742d3 (itself stacked on 461-migration PR #242).

## Scoped integration

Copy the exact validated Expo SDK58/React Native 0.88.1 source, tested JS compatibility changes, Android Hermes/Zod security checks and current pinned published dependency lock from independently verified PR #241. Source-only convergence leaves `apps/mobile/app.config.js` and its **stronger QA Firebase project ID, sender ID, registered Android App ID, package and backend-attestation checks** UNCHANGED. The existing app.json versionCode 47, official production package, native scheme and blocked-permission list are preserved; only the SDK58 splash plugin replaces the deprecated top-level splash configuration.

Merge Mobile package manifest by retaining ALL QA-specific preflights (optional customer phone, installer/setup, native scheme, UOM price fallback, shared payment/offline/printing/branch enforcement), while adopting SDK58 dependencies and the unmodified validated package-lock. Do not install a Zod security waiver. The Android QA APK workflow remains explicit manual only; `qa-staging` is still fail-closed until independently attested Test backend/FCM, and legacy EAS `qa` is **Production-bound**, not permissible for Test.

## Deliberate next integration batch
The Mobile PR #241 also contains PR #238 Orders search/filter, customer-order history and saved-sale resume. Those source files have diverged from current QA product behavior; DO NOT wholesale overwrite their current QA implementations or remove existing optional phone/installer/Branch/stock/offline behavior. A subsequent focused port must reconcile OrdersWorkspace, Orders repo/hook, CustomersView, draft-resume and new tests against this SDK58-clean base before the exact Test APK candidate can be deemed functionally complete.

## Acceptance
Exact-head Mobile CI: locked `npm ci`, Expo Doctor and current patch pins, no Zod3 Android bundle, full Mobile QA preflights, TypeScript and Hermes export. Native Kotlin CI with SDK58 compilation is a separate gate. Full Test Method B rebuild, provider callback isolation, extra privileged Auth session retention, five Preview reviewer custody, QA Firebase secrets and real Android device acceptance remain outstanding. No hosted SQL, job pause, Meta/PSP/SMTP/FCM, Preview or APK deployment is authorized by this branch. C2 inert, Production/Tandar unchanged.
