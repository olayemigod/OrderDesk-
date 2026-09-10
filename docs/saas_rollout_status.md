# SellerTray SaaS Rollout Status

This document records the governed rollout state for SellerTray. SellerTray remains a focused WhatsApp-order SaaS: customers stay on WhatsApp; merchants use the mobile app. ERP, POS, accounting, inventory valuation and general CRM are outside the MVP contract.

## Implemented and gated

### S1 — SaaS business context and shell — PASS
- Tenant/business isolation and persisted active-business context.
- Home / Orders / Business mobile shell.
- Owner/Manager business profile editing; Staff read-only.
- Platform-controlled onboarding, subscription and WhatsApp state.

### S2 — signup and self-service provisioning — PASS
- Email/password signup, confirmation and password recovery.
- New merchant can create one initial business without manual SQL.
- Creator becomes Owner and receives a trial subscription.
- Provisioning is behind a JWT-protected Edge Function; elevated DB transaction is service-role-only.

### S3 — catalogue and deterministic pricing — PASS
- Product name, selling price, SKU, category, aliases, active state and image-URL placeholder.
- Owner/Manager catalogue writes.
- WhatsApp wording resolves against merchant catalogue names/aliases.
- Recognized products inherit merchant price; SellerTray never invents selling prices.

### S4A — parser provenance — PASS
- Parser source/version and review reasons on orders.
- Original wording, match source and confidence on order lines.
- Provenance is server-controlled and merchant UI explains review causes.

### S5 — merchant operating experience — PASS
- Review-first inbox, workflow filters and search.
- Merchant correction/pricing before acceptance.
- Action pending/success/error feedback and duplicate-tap suppression.
- Reasoned rejection/cancellation with server enforcement.
- Server-recorded immutable status history.

### S6 — outbound notification foundation and merchant controls — PASS FOUNDATION
- Deterministic Received / Accepted / Ready / Rejected / Cancelled notification events.
- Durable outbound queue with retries, worker claiming and stale-lease recovery.
- WhatsApp 24-hour-window routing and `template_required` state.
- Owner/Manager notification switches; Staff read-only.
- Delivery state visible to merchants without exposing provider credentials.
- Production sending remains activation-pending while Meta verification/credentials are incomplete.

### S7 — team and permissions — PASS
- Owner / Manager / Staff role model.
- Pending email invitations before signup and automatic claim after sign-in.
- Owner protection; Managers may manage Staff only.
- Direct merchant writes to membership/invitation tables are denied.
- Team mutations respect subscription access.

### S8 — business intelligence — PASS
- Server-side tenant-timezone-aware Today, 7-day, previous-period, 30-day and top-item metrics.
- Owner/Manager business performance view; Staff operational view.
- Realtime refresh on order/item changes.

### S9A — subscription lifecycle and enforcement — PASS
- Provider-neutral `SellerTray Business` plan contract.
- 14-day trial default.
- Active / Past due / Grace / Suspended / Cancelled lifecycle.
- Expired/suspended businesses retain read access while operational writes fail server-side.
- WhatsApp ingestion stores the signed inbound message for audit/idempotency and skips new order creation for read-only tenants without causing Meta retry storms.
- Every new tenant automatically receives a subscription row.

### S9B — Paystack billing adapter — IMPLEMENTED, ACTIVATION PENDING
- Owner-only JWT-protected checkout endpoint.
- HMAC-SHA512 Paystack webhook and idempotent provider-event ledger.
- Matching SellerTray checkout reference required before `charge.success` can activate a tenant.
- Recurring subscription/payment-success/failure/non-renewal/disable reconciliation.
- Billing remains deliberately inactive until an approved monthly price, Paystack plan reference and server secret are configured.
- Current `checkout_ready = false`; no billing event has charged or activated a tenant.

### S9C — AI-assisted usage metering — PASS / DEPLOYED
- Frozen billable event: `AI_ORDER_ACTIVITY`.
- Exactly one usage event is recorded only when the external AI parser successfully structures a WhatsApp order.
- Fallback parsing, manual entry and duplicate Meta deliveries do not create billable AI usage.
- Trial usage is explicitly free even if a future paid usage rate is configured.
- Unpriced activity is never repriced retroactively.
- Paid usage snapshots the exact flat unit rate and valid subscription billing-period boundaries at event time.
- Same-tenant composite FK enforcement prevents cross-tenant source-message/usage linkage.
- Merchant subscription view shows current-period AI activity, flat rate state and accrued amount.
- Owner business export includes usage events.
- Rollback/smoke validation proved external=1, fallback=0, duplicate=1, free trial, paid-period rate snapshot and cross-tenant rejection.

### S9D — postpaid usage settlement foundation — PASS CODE / DEPLOYED; COMMERCIAL ACTIVATION PENDING
- Monthly base fee remains a fixed Paystack subscription; variable AI usage is settled separately.
- Added server-only `billing_payment_authorizations`, `usage_settlements` and `usage_settlement_items`.
- Reusable Paystack authorization codes are AES-GCM encrypted before storage when `BILLING_AUTH_ENCRYPTION_KEY` is configured.
- Merchant clients have no direct table privileges on authorization or settlement records.
- Paid usage requires valid closed subscription period boundaries; missing/invalid/future period data fails free rather than guessing a charge.
- Usage events snapshot ISO currency with price/period; mixed-currency settlement data is rejected instead of using the tenant's later plan currency.
- Settlement preparation is concurrency-safe/idempotent by tenant/event/period and a usage event can belong to only one settlement.
- Supabase Cron job `sellertray-prepare-usage-settlements` is ACTIVE at 01:15 UTC daily and prepares closed-period settlements only; it never invokes Paystack or moves money.
- Self-service account deletion now blocks while any priced AI usage remains unsettled and clears only after settlement is paid.
- New `usage-settlement` Edge Function is ACTIVE with custom server-token auth and an explicit `USAGE_BILLING_LIVE=true` money-movement kill switch.
- A second database commercial charging interlock, `subscription_plans.usage_charging_enabled`, defaults to `false`; the worker requires both gates before any Paystack debit.
- `usage-settlement` v5 atomically claims a pending settlement before the Paystack request; concurrent charge calls stop locally and cannot issue a second provider request.
- Failed or ambiguous provider attempts are never automatically retried.
- Paystack webhook recognizes settlement references separately from base checkout and verifies expected amount/currency before marking a settlement paid.
- `usage-settlement` v4 retains non-debiting Paystack Verify Transaction reconciliation by the existing provider reference; failed/ambiguous attempts are never blindly retried.
- ProcessEdge Admin exposes authorization readiness, outstanding usage amount and failed-settlement count without exposing encrypted payment credentials.
- Owner business export includes safe settlement history but deliberately excludes reusable charge credentials.
- `docs/usage_billing.md` is CI-gated; backend function/migration paths now trigger release CI as well as mobile/document changes.
- Mobile CI #200 passed the first settlement safety preflight; a final post-reconciliation checkpoint is pending below.
- Mobile CI #235 passed the final S9D settlement-safety checkpoint, including locked install, dependency audit, TypeScript and release preflight.
- Commercial prices, reusable authorization capture, and real/test Paystack usage debit acceptance remain pending.

### S10A — ProcessEdge SaaS operations console — PASS AUTOMATED / VISUAL SMOKE PENDING
- Separate `platform_admins` role space; merchant Owner/Manager roles do not confer platform access.
- ProcessEdge admin overview for tenant health, subscription state, AI usage/settlement readiness, WhatsApp state, order activity, notification exceptions and team size.
- Controlled subscription, trial-extension, WhatsApp-state and internal-support-note actions.
- Suspension/cancellation requires explicit confirmation in UI.
- Immutable platform-admin audit trail and audit viewer.
- Direct authenticated access to admin tables/RPCs is denied; JWT-protected `platform-admin` Edge Function fronts service-role RPCs.
- Admin-only accounts can enter SaaS Operations without owning a merchant workspace.
- Self-cleaning live DB smoke proved overview, mutation and audit retrieval; test tenant removed afterward.
- Mobile CI #144 passed on the final S10A mobile head.

## Activation-pending services

These are implemented but must not be described as production-accepted yet:

1. **Meta production WhatsApp** — business/app verification and one real production inbound/outbound E2E are still required.
2. **AI parser** — configure server-only `OPENAI_API_KEY` and `ORDER_PARSER_TOKEN`, then run live AI acceptance. Do not put secrets in the mobile app, repository or chat.
3. **Outbound WhatsApp worker** — configure server-only worker/Meta credentials after Meta production approval and acceptance-test delivery.
4. **Paystack billing** — approve the monthly base price and flat AI-activity price; configure the Paystack plan/secret plus billing-encryption/settlement secrets; capture one reusable authorization; then pass base checkout and usage-settlement acceptance in test mode before enabling live usage charging.
5. **Production email** — configure production SMTP/Auth email delivery.

## S11 — production hardening — CODE PASS / RELEASE ACCEPTANCE PENDING

### S11A — structured Edge Function observability — PASS CODE / DEPLOYED; RUNTIME CORRELATION SMOKE PENDING
- Standardized structured request-start, request-finish and uncaught-exception logs across `whatsapp-webhook`, `order-parser`, `send-whatsapp-notifications`, `billing-checkout`, `paystack-webhook` and `platform-admin`.
- Every function-generated response receives an `x-orderdesk-request-id` correlation header.
- Logs include only service, request ID, method, pathname, status and duration by default; query strings, request bodies, customer message text and authorization headers are not logged by the wrapper.
- Uncaught error messages are length-limited and redact common bearer/secret-key patterns before logging.
- All six target functions were redeployed ACTIVE to the SellerTray Supabase project without changing their existing JWT verification boundaries.
- Mobile CI #146 passed on commit `4d7904d`.
- Direct external HTTP correlation smoke could not be run from the current execution environment because outbound DNS resolution is unavailable; production/provider E2E remains an explicit acceptance gate rather than being silently assumed.

### S11B — security regression + bounded abuse controls — PASS CODE / DEPLOYED
- Re-audited every exposed `public` table: RLS is enabled throughout and `anon` has no direct table CRUD privileges.
- Re-audited the ProcessEdge admin boundary: `platform_admins`, `platform_admin_audit` and `tenant_admin_notes` remain unavailable to authenticated clients directly.
- Re-audited every current `SECURITY DEFINER` function: each uses an empty `search_path`, denies `anon` / `authenticated` execution and is executable only by `service_role`.
- Added streaming request-body limits before JSON/signature processing: WhatsApp webhook 1 MiB; Paystack webhook 512 KiB; AI parser 2 MiB; billing checkout 64 KiB; platform admin 64 KiB.
- Limits enforce both declared `Content-Length` and actual streamed bytes, returning HTTP 413 when exceeded.
- The notification worker remains token-gated and does not consume an inbound request body, so no redundant body parser was added.
- All five patched functions were redeployed ACTIVE without changing their prior JWT verification boundaries.
- Mobile CI #148 passed on commit `1c40263`.
- Security advisor remains clear except for the existing project-level leaked-password-protection warning. Performance advisor reports only informational unused-index notices on the new/low-traffic schema.
- Full production/provider abuse smoke remains part of external acceptance because direct public-host invocation is unavailable from the current execution environment.

### S11C — data lifecycle, export, deletion and recovery — PASS CODE / DEPLOYED
- Added JWT-protected `account-lifecycle` Edge Function with structured observability and a 64 KiB request-body cap.
- Business Owners can export a bounded JSON copy of the tenant profile, catalogue, customers, inbound WhatsApp messages, orders/items/status history, outbound notification history, team records and subscription state.
- Self-service export fails closed above 5,000 rows per collection instead of silently truncating.
- Every authenticated merchant can access in-app account deletion, including a signed-in user with no business workspace.
- Deletion requires the current password and the exact `DELETE MY SELLERTRAY ACCOUNT` confirmation phrase.
- Owned businesses and their tenant-scoped operational data are removed before the Auth user; memberships in other businesses are removed. User-owned Storage objects are removed through the Storage API within the bounded self-service contract.
- Active provider subscriptions, ProcessEdge platform-admin identities/audit history and oversized Storage cleanup fail closed to controlled support handling.
- Added `docs/data_lifecycle.md` covering retention, access-token expiry considerations, backup/recovery and destructive-restore controls.
- `account-lifecycle` is ACTIVE in the SellerTray Supabase project with JWT verification enabled.
- Initial Mobile CI #150 exposed one TypeScript-only cast issue; the smallest correction was applied and Mobile CI #151 passed on commit `86e4151`.
- Published the required external deletion resource at `https://processedge.com.ng/sellertray/account-deletion` with legacy `/orderdesk/account-deletion` alias. ProcessEdge website production deployment `6cf677c5` is READY and the canonical route returns HTTP 200.
- Full destructive account-deletion smoke is intentionally not run against the current working merchant account; first disposable-account E2E remains part of release acceptance.

### S11D — production identity, Auth/deep-link and Android release contract — PASS CODE / EXTERNAL ACCEPTANCE PENDING
- SellerTray is frozen as the store/display identity at version `1.0.0`.
- Android application ID is frozen as `ng.processedge.sellertray`; iOS bundle identifier matches for future iOS release.
- Canonical native scheme is `sellertray://`; legacy `orderdesk://` remains registered temporarily for beta confirmation/recovery compatibility.
- New native signup/password-recovery links are generated with the SellerTray scheme while AuthGate accepts both schemes.
- Added `apps/mobile/eas.json`: internal preview produces an installable APK; production produces a Google Play AAB with remote auto-incremented version codes.
- Client build profiles contain only the already-public Supabase URL/publishable key. Server/service-role/provider secrets remain outside the mobile bundle.
- Added `docs/release_runbook.md` with preview QA, AAB release, rollback/forward-fix and release-record contracts.
- Completed visible SellerTray UI rebrand across auth, workspace, provisioning, business settings, notifications, teams and ProcessEdge SaaS Admin surfaces.
- Account deletion now asks for `DELETE MY SELLERTRAY ACCOUNT`; the server temporarily accepts the former beta phrase for compatibility.
- `account-lifecycle` v2 is ACTIVE with JWT verification enabled.
- Live plan name changed from `OrderDesk Business` to `SellerTray Business`; stale user-facing subscription/team and Edge Function messages were corrected and deployed.
- In-app Privacy Policy and Terms links now target the SellerTray-specific production URLs.
- Mobile CI #154 passed the production-identity/UI change, CI #155 passed the in-app legal-link change, and CI #158 passed the final server-boundary hardening head.
- **Not yet accepted:** Supabase Auth Additional Redirect URLs must be configured/verified; leaked-password protection remains disabled; SellerTray icon/adaptive-icon/splash assets do not yet exist; no signed EAS preview APK/native smoke or production AAB has been completed.

### S11E — SellerTray legal-policy alignment — PREVIEW READY / LEGAL APPROVAL PENDING
- Prepared SellerTray-specific Privacy Policy and Terms covering merchant/customer order data, WhatsApp, AI-assisted parsing, subscriptions, service providers, retention/export/deletion, security, acceptable use and merchant responsibilities.
- Draft website PR #2 remains deliberately unmerged.
- Vercel preview for the initial legal commit `836089d` is READY; the red-team legal refinement is `a437797` and its preview is also READY.
- Privacy wording is aligned to the current SellerTray data contract and the Nigeria Data Protection Act rights baseline.
- The account-deletion page links to the product-specific Privacy/Terms routes on the legal branch.
- Google Play requires a comprehensive privacy policy accessible in the app plus the separate account-deletion resource; mobile links are implemented but production legal URLs must not be considered accepted until PR #2 is legally approved and published.

### S11F — release acceptance preparation — PASS CODE / DEPLOYED
- Closed the last two authenticated Edge Function hardening gaps: `provision-business` and `team-management` now have structured request observability, correlation IDs and 64 KiB streamed request-body limits.
- Both functions remain JWT-verified and were redeployed ACTIVE after the hardening patch.
- Full Edge Function matrix now shows all nine functions ACTIVE and instrumented.
- Every function that consumes an inbound request body enforces a streamed byte limit; the notification worker consumes no request body and remains worker-token gated.
- Public/custom-auth boundaries remain explicit: Meta webhook signature, parser token, notification worker token and Paystack signature/secret paths retain their intended controls.
- Live security advisor still reports only the project-level leaked-password-protection warning. Performance advisor reports informational unused-index notices only.
- Mobile CI #158 passed on hardening commit `0a1d136`.
- No further code-side MVP release blocker was identified in this hardening pass.

### S11G — automated release governance — PASS
- Added repository-level SellerTray release preflight and made it a required Mobile CI step after TypeScript checking.
- Preflight enforces SellerTray 1.0.0 identity, Android package, canonical/legacy deep-link contract, APK/AAB EAS profiles, client secret boundaries, deletion phrase and legal/deletion URL contracts.
- Mobile package identity is now `@sellertray/mobile` version `1.0.0`.
- Root README and current architecture/activation documentation are aligned to SellerTray rather than the obsolete early OrderDesk/S4 checkpoint.
- Mobile CI #160 passed both Typecheck and SellerTray release preflight on commit `08f8395`.
- Added machine-readable `docs/release_acceptance.json` and `npm run release:check`; the latter intentionally fails while any required external gate remains unaccepted.

### S11H — auditable Terms/Privacy acceptance — PASS CODE / DEPLOYED
- Signup now requires explicit acknowledgement of the SellerTray Terms of Service and Privacy Policy.
- Every authenticated session is gated by `LegalAcceptanceGate` before merchant/admin workspace access.
- Added append-only `user_legal_acceptances` with Auth-user cascade deletion, current document versions and server timestamp.
- RLS is enabled; anonymous access is denied; authenticated clients may read their own acceptance but cannot insert/update/delete acceptance records directly.
- Existing JWT-protected `account-lifecycle` now owns `legal_status` and `accept_legal` actions; no additional privileged public endpoint was introduced.
- `account-lifecycle` v3 is ACTIVE with JWT verification.
- Live DB audit confirmed authenticated INSERT is denied while own-row SELECT is policy-gated.
- Supabase security advisor shows no new application-schema warning; leaked-password protection remains the only Auth warning.
- Mobile CI #162 passed Typecheck and SellerTray release preflight on commit `7d3edba`.
- Legal acceptance version is `2026-09-10`; if legal review materially changes the draft before publication, the acceptance version must be bumped before release.

### S11I — Google Play declaration preparation — PASS DOCUMENTATION / CONSOLE ACCEPTANCE PENDING
- Added `docs/google_play_data_safety.md` mapping current SellerTray data fields, SDK behavior, purposes, collection status, provider transfers and exclusions to Google's Data Safety model.
- Current conservative collection set is Name, Email address, User IDs, Phone number, Purchase history, Other user-generated content and Other actions; final "shared" selections remain gated on provider/service-provider classification review.
- Explicitly records that Paystack-hosted card/bank credentials are not SellerTray-collected while SellerTray cannot access them.
- Current release has no ads SDK, mobile analytics/crash SDK, device-ID use, contacts/location/camera/microphone/SMS/calendar permissions or direct photo/file upload.
- Added `docs/google_play_submission.md` covering Privacy, deletion, App access, target audience, IARC rating, Financial features, Data Safety, review tenant and binary/provider gates.
- SellerTray's Expo SDK 57 baseline targets API 36, matching the Google Play requirement effective August 31, 2026; final acceptance remains tied to the signed AAB/Play upload.
- SellerTray AI parsing is documented as a bounded productivity transformation rather than a general content-generation product, while third-party AI User Data obligations remain in scope.
- Added required release-manifest gates for Data Safety, App Content and Play reviewer access. These remain pending until Play Console evidence exists.

### S11J — Google Play store-listing package — PASS COPY / ASSETS & CONSOLE PENDING
- Added `docs/google_play_store_listing.md` with Play-length SellerTray name, 78-character short description, bounded full description, category recommendation, contact details and metadata guardrails.
- Primary category is Business; tag candidates are suggestions only and must be selected from tags actually available in Play Console.
- Prepared an eight-screen screenshot narrative using synthetic/demo data only; real customer WhatsApp data must never appear in store assets.
- Added app-icon/feature-graphic requirements and a SellerTray icon creative brief without copying WhatsApp/Meta trade dress.
- Added two-account Play reviewer access pattern: one stable walkthrough tenant and one disposable deletion-test tenant; credentials must live only in Play Console.
- Added `google_play_store_listing` to the release manifest. It remains pending until approved graphics, signed-candidate screenshots, working reviewer credentials and Play Console entry exist.

### S11K — provider data-sharing classification review — PARTIAL / META PENDING
- Added `docs/data_processor_review.md` to separate Google Play "collection" from "sharing" decisions provider by provider.
- Supabase's current DPA expressly positions Supabase as processor/service provider for covered data, supporting the Play service-provider exception for the current infrastructure flow.
- Paystack's Nigerian DPA expressly positions Paystack as processor for merchant personal data used to provide payment processing; SellerTray still must never receive hosted card/bank credentials.
- OpenAI API is provisionally treated as a service provider for the bounded parser, but production project data controls must be recorded before final Play classification. API/business data is not used for training by default; default abuse-monitoring retention may be up to 30 days unless approved retention controls apply.
- WhatsApp's current Business/Data Processing Terms support processor treatment for covered Customer Data, but separate WhatsApp business-account/usage processing must not be swept into that exception automatically.
- Meta has announced updated WhatsApp Business terms effective September 23, 2026; any provider/Data Safety acceptance on or after that date requires a fresh effective-terms check.
- Release rule remains conservative: where the applicable Play exception cannot be established from the production data flow and effective terms, declare the affected types as shared for App functionality.
- Added `provider_data_sharing_classification` as a required release-manifest gate.

### S11L — release-governance integrity — PASS
- Mobile CI now validates `docs/release_acceptance.json` itself rather than trusting the document structurally.
- Checks cover manifest schema/product/version/package agreement, duplicate/missing required gate IDs, valid status values, evidence for accepted/waived gates, and a valid full-SHA/CI code checkpoint.
- Pending external gates remain valid CI state; `npm run release:check` continues to be the deliberate production hold.
- Release-governance documents now trigger Mobile CI, including Data Safety, Play submission/store listing, provider review, lifecycle/runbook, rollout status and the acceptance manifest.
- Mobile CI #168 passed the complete manifest-integrity gate on commit `19c561a`.

### S11M — reproducible mobile dependency install — PASS
- Production audit found no historical mobile lockfile, so transitive dependency resolution was previously non-reproducible.
- A bounded one-time GitHub runner bootstrap generated and committed `apps/mobile/package-lock.json` as npm lockfileVersion 3 at commit `e11d007`.
- Temporary CI write permission and self-commit logic were removed immediately after the lockfile landed; normal workflow permissions are read-only again.
- CI now installs with `npm ci`, not `npm install`.
- CI now runs `npm audit --omit=dev --audit-level=high` before typecheck.
- SellerTray preflight verifies lockfile name/version/root identity against `package.json`.
- Mobile CI #174 passed locked install, production dependency audit, typecheck and SellerTray preflight on commit `a2394ed`.

### S11N — Android permission minimization — PASS
- Added an explicit Expo `android.blockedPermissions` deny-list for sensitive device capabilities SellerTray does not use.
- The deny-list covers location, contacts, camera/microphone, calendar, SMS/call logs, broad media/storage, phone state/numbers, sensors/activity, Bluetooth scan/connect, notifications, exact alarms, package installation, system overlays and Google advertising ID.
- SellerTray preflight now fails if any required blocked permission is silently removed from the release contract.
- This is a preventative manifest-merge guardrail: future features that genuinely require a blocked capability must explicitly revise the product/privacy/Play contract rather than inheriting it transitively.
- Mobile CI #175 passed the full deny-list preflight on commit `4fab718`.

### S11O — Android local-backup boundary — PASS
- Expo `android.allowBackup` is now explicitly false for SellerTray 1.0.0.
- This prevents Android Auto Backup/restore from copying SellerTray application-local state through the normal Google Drive/device backup mechanism.
- The preflight gate now fails if Auto Backup is re-enabled silently.
- This is intentionally separate from SellerTray's explicit business-data export and server disaster-recovery backup contracts.
- Mobile CI #176 passed locked install, production dependency audit, typecheck and the Auto Backup preflight on commit `2de6742`.

### S11P — legal-acceptance version evolution — DB FIX READY / VERIFICATION PENDING
- Audit found the original `user_legal_acceptances` migration incorrectly constrained Terms/Privacy versions to exactly `2026-09-10`.
- That would prevent preserving historical acceptance rows when SellerTray publishes a future policy version.
- The fix removes current-version equality constraints and replaces them with non-empty, trimmed, maximum-64-character version constraints.
- Current-version enforcement remains in the JWT-protected lifecycle service, where it belongs: a session must accept the service's current Terms/Privacy constants, while older acceptance rows remain valid audit history.
- The unique key `(user_id, terms_version, privacy_version)` continues to permit one auditable acceptance per version pair.

### Remaining S11 release gates
- Configure/verify Supabase Auth redirects for `sellertray://auth-confirm`, `sellertray://reset-password` and the two temporary legacy equivalents.
- Enable Supabase leaked-password protection before public signup.
- Finalize SellerTray launcher/adaptive icon and splash/launch assets.
- Obtain legal approval for website PR #2, then publish and verify `/sellertray/privacy` and `/sellertray/terms`.
- Produce signed Android preview APK and pass the native smoke matrix.
- Produce production AAB and record build/version identifiers.
- Complete production SMTP/Auth email acceptance.
- Complete relevant Meta WhatsApp, AI parser, outbound notification and Paystack activation gates for the intended paid pilot.

### Next execution state
**Release acceptance hold**: repository, database and Edge Function hardening are ready for the external release gates above. Do not merge PR #1 or call the product production-ready until those gates are explicitly passed.

## Commercial launch gate

SellerTray is ready for a paid pilot only when S11 passes and the relevant external services are activation-accepted. PR #1 remains draft until the production E2E/release gate is explicitly approved.
