# SellerTray Google Play Submission Checklist

Status: **release hold**

This checklist complements `docs/release_acceptance.json`. It is not evidence that Play Console declarations have been submitted.

## App identity

- [x] App name: SellerTray
- [x] Android package: `ng.processedge.sellertray`
- [x] Version: 1.0.0
- [x] Expo SDK 57 baseline targets API 36
- [ ] Verify target API 36 from the final signed AAB / Play Console upload
- [ ] Final launcher icon / adaptive icon / splash branding
- [ ] Final store screenshots and feature graphic
- [ ] Short description and full store description
- [ ] ProcessEdge developer/contact details verified in Play Console

## App content declarations

- [x] Privacy Policy — published at `https://processedge.com.ng/sellertray/privacy`
- [ ] Independent legal review/approval of the published SellerTray Privacy/Terms wording
- [x] External account deletion resource — `https://processedge.com.ng/sellertray/account-deletion`
- [ ] Data Safety — complete from `docs/google_play_data_safety.md`
- [ ] Data deletion questions — answer from implemented account deletion contract
- [ ] Contains ads — proposed **No**
- [ ] App access — provide stable reviewer tenant/credentials/instructions
- [ ] Target audience — proposed **18+ business users**
- [ ] Content rating — complete IARC questionnaire
- [ ] Financial features — proposed **My app doesn't provide any financial features**
- [ ] Any Play Console AI/store-asset declaration that applies to final listing assets
- [ ] Verify account/app registration and any developer-verification notices shown in Play Console

## Data Safety provider classification

Before submitting:
- [ ] Confirm Supabase service-provider classification
- [ ] Confirm OpenAI API service-provider/data-processing classification
- [ ] Confirm Meta/WhatsApp data-transfer classification
- [ ] Confirm Paystack billing-email/reference classification
- [ ] Freeze final collected/shared answers and make Privacy Policy consistent

## Reviewer access tenant

Create a dedicated review workspace with:
- [ ] non-personal review email/account;
- [ ] stable password;
- [ ] no mandatory expiring MFA/OTP;
- [ ] sample catalogue;
- [ ] sample test orders;
- [ ] access to Home / Orders / Business;
- [ ] visible Privacy/Terms/account-deletion controls;
- [ ] no ProcessEdge platform-admin privileges;
- [ ] instructions for any WhatsApp feature that cannot be exercised by Play review.

Do not commit reviewer credentials to Git.

## Binary gate

- [ ] Signed preview APK produced
- [ ] Physical Android smoke passed
- [ ] Signup confirmation deep link passed
- [ ] Password-reset deep link passed
- [ ] Legal acceptance record passed
- [ ] Disposable account deletion passed
- [ ] No cleartext-network configuration introduced
- [ ] No server/provider secrets in client bundle
- [ ] Signed production AAB produced
- [ ] Play upload accepts package/version/target API

## External provider gate

- [ ] Meta WhatsApp production E2E
- [ ] AI parser live E2E
- [ ] outbound WhatsApp notification E2E
- [ ] production Auth/SMTP email
- [ ] Paystack test-mode subscription E2E after commercial values are frozen

## Submission rule

Do not move PR #1 out of draft or represent SellerTray as production-ready merely because the Play forms can be filled. Production declaration requires the release-acceptance manifest to pass and the intended provider gates to have recorded evidence.
