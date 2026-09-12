# SellerTray Release and Rollback Runbook

Status: S11D production-release baseline.

## Frozen application identity

- Store/display name: **SellerTray**
- Expo slug: `sellertray`
- Android application ID: `ng.processedge.sellertray`
- iOS bundle identifier: `ng.processedge.sellertray`
- Initial public version: `1.0.0`
- Initial Android version code: `1`
- Canonical deep-link scheme: `sellertray://`
- Temporary beta compatibility scheme: `orderdesk://`
- Internal database/RPC/function names that already contain `orderdesk` are compatibility identifiers and are not a reason to rename production data structures.

The Android application ID is release identity. Do not change it after the Google Play listing is created.

## Auth redirect contract

Use `https://processedge.com.ng/sellertray` as the SellerTray production **Site URL** in Supabase Auth.

Before native release acceptance, Supabase Auth Additional Redirect URLs must include:

- `sellertray://auth-confirm`
- `sellertray://reset-password`
- `orderdesk://auth-confirm`
- `orderdesk://reset-password`

SellerTray generates new native Auth links with `sellertray://`. The legacy `orderdesk://` scheme remains registered temporarily so beta confirmation/recovery links do not break.

The current Supabase connector used by the governed build does not expose Auth URL configuration. Verify the production Site URL is `https://processedge.com.ng/sellertray` and the four redirects are configured in Supabase Dashboard before native acceptance; do not mark the redirect gate passed from repository code alone.

## Auth email delivery contract

SellerTray production Auth email delivery uses the Supabase **Send Email Auth Hook**.

- Hook endpoint: `https://eujxswjspolugrzlsjnn.supabase.co/functions/v1/send-auth-email`
- Provider: Resend
- Verified sending domain: `processedge.com.ng`
- Required server-only secrets: `SEND_EMAIL_HOOK_SECRET`, `RESEND_API_KEY`, `AUTH_EMAIL_FROM`
- Confirmation subject: **Confirm your SellerTray email**
- Recovery subject: **Reset your SellerTray password**

Live transport acceptance passed on 11 September 2026 for both signup confirmation and password recovery.

The HTML files in `supabase/templates/` remain the governed copy baseline. The deployed `send-auth-email` Edge Function owns the live branded messages and verifies the signed Supabase hook payload.

Native return through `sellertray://auth-confirm` and `sellertray://reset-password` is tested during signed Android preview acceptance, not as part of email transport acceptance.

## Android build profiles

`apps/mobile/eas.json` defines:

- `qa`: internally distributed signed APK for native and deep-link QA before final brand approval. It does not close the release-candidate APK gate.
- `preview`: internally distributed signed APK for the exact branded release candidate.
- `production`: signed Android App Bundle (AAB) for Google Play.
- Production version codes use EAS remote versioning and auto-increment after the initial version.

Client builds receive only the Supabase project URL and publishable key. Server/service-role keys, WhatsApp credentials, Paystack secrets, AI keys and worker tokens must never be placed in EAS client environment variables.

## Pre-build gates

All of these must pass before creating a release candidate:

1. Mobile CI/typecheck green on the exact candidate commit.
2. Supabase security advisor reviewed. Leaked-password protection is waived on the current Free plan and must be enabled when the project upgrades to Pro.
3. Supabase native redirect URLs above are configured.
4. SellerTray Send Email Hook/Auth email transport is accepted.
5. Approved SellerTray launcher icon, Android adaptive icon and splash/launch branding are committed and referenced from Expo config.
6. No production secrets exist in the mobile repository or client bundle.
7. Account deletion resource is live at `https://processedge.com.ng/sellertray/account-deletion`.
8. Privacy Policy and Terms have SellerTray-specific data/service coverage and legal approval.
9. Relevant external-service gates are accepted for the intended release scope.
10. Google Play billing boundary is verified: the Play-distributed Android build contains no external SellerTray SaaS subscription checkout link or Paystack subscription CTA. Merchant-customer payments for physical goods/orders remain a separate commerce feature.

## Build commands

From `apps/mobile`:

For native/deep-link testing before final brand approval:

```bash
eas build --platform android --profile qa
```

The QA APK is test evidence only and does not satisfy `android_preview_apk`.

After approved SellerTray brand assets are committed:

```bash
eas build --platform android --profile preview
```

Use that exact preview APK for release-candidate device acceptance.

After preview acceptance:

```bash
eas build --platform android --profile production
```

The production artifact must be an AAB. Do not substitute the QA or preview APK for Play Store submission.

## Native preview smoke

Install the exact preview APK on at least one ordinary Android phone and verify:

1. Launcher shows SellerTray, not OrderDesk or Expo.
2. Cold launch and sign-in succeed.
3. New account confirmation returns through `sellertray://auth-confirm`.
4. Password recovery returns through `sellertray://reset-password`.
5. Legacy `orderdesk://` recovery link still opens the app during the compatibility window.
6. New merchant provisioning succeeds.
7. Business/catalogue views load only the signed-in tenant.
8. One test order can move through review, acceptance, processing, ready and completed.
9. Business data export produces the expected SellerTray JSON export.
10. Disposable test-account deletion removes the Auth account and owned test tenant.
11. App relaunch after deletion returns to sign-in.
12. No service-role, provider or AI secrets are observable in the client configuration.

## Production submission

- Create/use the Google Play listing for package `ng.processedge.sellertray`.
- Upload the production AAB.
- Use the ProcessEdge deletion-resource URL in the Play Data safety/account deletion section.
- Complete Data safety declarations from the actual SellerTray data contract, not generic website wording.
- Start with internal/closed testing before production rollout.
- Record the accepted AAB version code, source commit and deployment date in the release record.

## Rollback

### Mobile binary regression

Google Play binaries are immutable. Do not attempt to overwrite a released version code.

1. Stop/hold rollout in Play Console where possible.
2. Revert the faulty application change in Git.
3. Keep the package ID `ng.processedge.sellertray` unchanged.
4. Build a new production AAB with a higher version code.
5. Run the same preview/native gates before increasing rollout.

### Server regression

1. Identify the failing Edge Function or migration using request IDs and the release commit.
2. Prefer the smallest forward fix.
3. For an Edge Function-only regression, redeploy the last known-good function source when forward repair is unsafe.
4. Never roll back a database migration destructively when newer merchant data depends on it; use a compensating migration.
5. Validate tenant isolation, Auth, order workflow, notifications and subscription access after recovery.

### External-provider regression

Disable only the affected integration path where the product can degrade safely. Preserve stored orders and merchant access. Do not mark Meta, AI, Paystack or email activation accepted until a real provider smoke succeeds again.

## Release record

Every candidate must record:

- SellerTray version and Android version code
- exact Git commit
- Supabase migration/function checkpoint
- preview APK acceptance result
- production AAB build identifier
- Play testing track
- known activation-pending providers
- rollback/forward-fix decision if an incident occurs


## WhatsApp business-initiated templates

Before production WhatsApp activation, every merchant WABA must have approved utility templates matching the deployment configuration:

- `META_TEXT_TEMPLATE_NAME`: one body variable (`{{1}}`) used for the SellerTray notification text.
- `META_DOCUMENT_TEMPLATE_NAME`: a document header plus one body variable (`{{1}}`) used for invoice/receipt PDF delivery.
- `META_TEMPLATE_LANGUAGE_CODE`: approved template language, default `en_US`.

SellerTray free-form text/document messages are used only while the customer-service window is open. After that window, the worker sends the configured approved template. Missing or unapproved templates remain fail-closed as `template_required`; they must never be converted to unrestricted free-form delivery.


## Google Play billing and financial-features boundary

The Google Play-distributed SellerTray Android build is consumption-only for SellerTray's own digital SaaS subscription:

- it may show current plan/access status and measured usage;
- it must not expose `Subscribe with Paystack`, external subscription checkout URLs, or an external top-up CTA for SellerTray digital credits unless ProcessEdge deliberately implements a Google-approved billing/external-payments program;
- merchant-customer payments for merchant orders are not SellerTray subscription purchases and remain governed by the customer-payment workflow.

Before each Play release, complete/review the Financial features declaration using the features actually present in the binary. SellerTray facilitates merchant payment collection/reconciliation, so ProcessEdge must not certify “no financial features” without reviewing the then-current Play definitions. All Play apps must submit the declaration even when they have no financial features.


## Native authentication storage

SellerTray native Auth persistence uses `expo-secure-store` rather than AsyncStorage.

- Android: SecureStore is backed by encrypted storage using Android Keystore.
- iOS: SecureStore uses Keychain.
- SellerTray requests `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` accessibility for native session material.
- Android Auto Backup remains disabled, and the SecureStore config plugin does not configure backup support.
- The first build containing this security change may require existing beta users whose prior session lived only in AsyncStorage to sign in again. SellerTray intentionally does not migrate plaintext persisted sessions into the new secure store automatically.

Release acceptance must verify sign-in persistence across app restart and sign-out removal on a physical device.


## Multi-factor authentication

SellerTray supports Supabase TOTP MFA from **More → Security & MFA**.

- Merchants can enroll an authenticator factor and verify the current session to AAL2.
- A user with an enrolled factor but an AAL1 session can enter the current six-digit authenticator code to upgrade the session.
- ProcessEdge platform-admin APIs cryptographically validate the Supabase user session and require an `aal2` JWT before returning tenant-wide admin data or accepting mutations.
- ProcessEdge platform administrators must enroll MFA before production operations acceptance.

Physical-device QA must prove enrollment, AAL1→AAL2 verification, persistence through the intended session lifecycle and rejection of platform-admin calls at AAL1.


## Provider timeouts and abuse budgets

SellerTray Phase 1 hardening uses explicit provider deadlines and protective request budgets:

- OpenAI order extraction: 6.5-second provider deadline; WhatsApp caller remains bounded at 8 seconds.
- AI protective ceilings: 6/customer/minute, 60/tenant/minute and 2,000/tenant/day by default. These are abuse/cost ceilings, not purchased usage entitlements.
- Customer Paystack/Flutterwave provider calls: 10-second deadline.
- Merchant provider-verification operations: 30/user/minute and 90/tenant/minute.
- Meta WhatsApp message/media delivery: 10-second provider deadline.
- Usage-settlement Paystack verification/charge calls: 10-second provider deadline.

The AI ceilings can be adjusted through `AI_CUSTOMER_MINUTE_LIMIT`, `AI_TENANT_MINUTE_LIMIT` and `AI_TENANT_DAILY_LIMIT` without a mobile release. If an AI protection ceiling is exhausted, SellerTray skips the paid model request and uses the non-AI fallback/review path. Revisit these defaults after Conversation-to-Order replaces per-message AI parsing.
