# SellerTray Mobile — Expo/Zod advisory remediation readiness

**Reviewed 08/11/2026. Status: BLOCKED.** Source-only test and evidence; **not** a patch, risk exception, APK release or staging approval.

## Current locked graph and risk boundary

On OA5 draft PR #228, base head `f90e95eed12972186253ba49b7041d2de9884021`:
- `expo@57.0.28` (manifest range `~57.0.9`) -> `expo/node_modules/@expo/cli@57.0.29` -> `zod:^3.25.76`;
- resolved `node_modules/zod@3.25.76`, treated by npm lock as **production** dependency;
- no other locked package declares a dependency on Zod, and Mobile's package manifest has no direct Zod runtime dependency.

GitHub advisory [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) describes a Zod resource-exhaustion vulnerability, patched starting at 4.6.6. The current dated exception expired **07/11/2026**. `apps/mobile/scripts/dependency-audit-policy.mjs` must keep failing while the finding is unresolved.

The Hermes bytecode marker check is *heuristic*, not full dependency provenance. New source-only contract scripts `expo-zod-advisory-contract.mjs` and `expo-zod-advisory-contract.test.mjs` classify the actual npm lock graph and scan merchant application source for explicit Zod imports. Their `CANDIDATE_ONLY` result is **not** a clean audit or proof of no exploitable CLI input. No production-level vulnerability was patched.

## Governed upgrade proposal

[Expo SDK 58](https://expo.dev/changelog/sdk-58) was released on **15/10/2026**, upgrading React Native 0.86 -> **0.88** and React to **19.3**. The upstream Expo CLI main manifest lists Zod as a development dependency, but published SDK 58 package contents and actual SellerTray-compatible lockfile must be checked independently. Do not use CLI 58 with SDK 57 or make a global Zod 4 override.

Prefer a **separate, isolated SDK 58 candidate** that updates supported Expo native-module versions, React/React Native/Metro/Hermes and Android config. Regenerate the exact package lock from npm without manual version spoofing, then run `npm ci`, `npm audit --omit=dev --json`, unchanged `npm run audit:dependencies`, `npx expo install --check`, typecheck, native app config/FCM tests, preflight and a source-mapped Android export. The existing raw Hermes marker check alone is not sufficient.

Only a genuinely audit-clean, Expo-supported lockfile and successful full regression may clear Issue #229. Mobile POS, offline replay, branch/UOM/stock, payments, Bluetooth receipts, WhatsApp handoff and QA app variant must retain their approved behavior. An APK/native compilation or Production rollout needs **separate** authorization and verification. If SDK 58 cannot meet this, use a security-reviewed vendor backport or request a **new explicit owner risk decision**; do not silently extend the expired exception, disable npm audit, retag Zod 3 as 4, or redirect to vulnerable `zod/v3`.

## Read-only Test safety snapshot — 08/11/2026

Connected Supabase Test project `iukgsukdoowvnhlfmpml` rechecked **without writing data**:

| Observation | Verified count |
| --- | ---: |
| Migration history | 54 |
| Auth users / sessions | 5 / 5 |
| Test businesses / branches | 3 / 3 |
| WhatsApp connections / receipts | 0 / 0 |
| Active scheduled jobs | 4 |

Four Test jobs remain active: agreement-package retry, merchant-push retry, WhatsApp-notification retry (minute cadence) and daily usage-settlement preparation. They must be included in the Test-only quiescence and restore plan; no job was paused or edited. Historical Vercel review access, protected Test domains, sandbox provider sinks, hosted Auth redirects, QA Firebase and Meta phone ownership, ordered migration replay and exact-source Edge deployment are not yet attested.

The archived encrypted Test database, local restore and OneDrive-synced checksum have already been documented as passing by the operator; this does **not** authorize a Test reset. Keep `docs/qa/oa5-staging-backend-attestation.json` at `blocked`, preserve five historic Preview deployments, and obtain approval of a specific Test-only change plan before destructive work or live provider callbacks. Production project `eujxswjspolugrzlsjnn` and Tandar must remain untouched.

## Verification and effect

- Local pure Node fixture tests for the new advisory-provenance contract: **6/6 PASS** on 08/11/2026.
- Exact-source Mobile CI for this review branch: **pending**; current Expo 57 dependency-audit is **expected to fail** until safely remediated.
- No package/lock modification; no APK, Vercel Preview, Edge deployment, provider callback/payment/push, Test reset, cron mutation or Production operation.

Track: [Issue #229](https://github.com/olayemigod/OrderDesk-/issues/229), [draft PR #228](https://github.com/olayemigod/OrderDesk-/pull/228), [Test callback gate](oa5-meta-paystack-test-callback-acceptance-2026-11-08.md), [Preview protection](oa5-vercel-preview-custody-and-test-domain-protection-2026-11-08.md).
