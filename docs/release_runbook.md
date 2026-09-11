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

- `preview`: internally distributed signed APK for installation on physical Android devices.
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

## Build commands

From `apps/mobile`:

```bash
eas build --platform android --profile preview
```

Use the resulting APK for device QA.

After preview acceptance:

```bash
eas build --platform android --profile production
```

The production artifact must be an AAB. Do not substitute the preview APK for Play Store submission.

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
