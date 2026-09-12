# SellerTray Meta Tech Provider Approval Runbook

**Status:** APPROVAL PREPARATION IN PROGRESS  
**Product:** SellerTray  
**Owner:** ProcessEdge Solutions Limited  
**Updated:** 2026-09-13

## Goal

Enable independent SellerTray merchants to connect their own WhatsApp Business Account and phone number through Meta Embedded Signup without ProcessEdge manually entering Phone Number IDs or exposing Meta credentials to the Android app.

SellerTray uses the **Meta Tech Provider** model for the MVP. The merchant remains the owner of its WhatsApp Business Account and is responsible for Meta WhatsApp Business Platform charges. SellerTray bills its own SaaS subscription and approved AI activity separately.

Official partner reference:
https://whatsappbusiness.com/partners/become-a-partner/

Meta's published partner comparison distinguishes Tech Providers from Solution Partners: Tech Providers can onboard businesses with Embedded Signup; managing billing for businesses through shared line of credit is a Solution Partner capability.

## Already implemented in SellerTray

- Live Meta webhook routing by Phone Number ID.
- One Phone Number ID can belong to only one SellerTray tenant.
- Owner WhatsApp data-processing authorization.
- Server-side inbound message processing.
- Secure multi-merchant connection table.
- Private tenant-scoped Meta credential store.
- AES-GCM encrypted BISU credential support.
- Android cannot read Meta credentials.
- Server-only Embedded Signup authorization-code exchange.
- Meta token introspection:
  - token is valid;
  - token belongs to the SellerTray Meta app;
  - required WhatsApp permissions are present.
- WABA/Phone Number ownership verification.
- WABA `subscribed_apps` registration.
- Server-side outbound credential selection by Phone Number ID.
- Server-side WhatsApp media credential selection by tenant.
- Existing Naijalivemedia connection retained in platform-system-user mode.

Current backend functions:
- `whatsapp-connection`
- `whatsapp-webhook`
- `send-whatsapp-notifications`
- `catalogue-from-chat`

## Approval sequence

### A. ProcessEdge Business Portfolio

Before submission confirm in Meta Business Manager:

- ProcessEdge business legal name matches registration documents.
- Business address, phone, website and email are current.
- Business Portfolio verification is completed or submitted.
- SellerTray/ProcessEdge domain is verified where Meta requests it.
- Two-factor authentication is enforced for administrators where available.

Evidence to retain:
- verification status screenshot;
- Business Portfolio ID;
- verification submission/reference if pending;
- domain verification screenshot.

### B. SellerTray Meta app

Confirm:

- App type is Business.
- App is owned by the verified ProcessEdge Business Portfolio.
- WhatsApp product/use case is added.
- Production webhook callback and verify token are configured.
- Webhook fields needed by SellerTray are subscribed.
- Privacy Policy URL points to SellerTray Privacy.
- Terms URL points to SellerTray Terms.
- Data deletion/account deletion URL is available.
- App icon/name/domain match SellerTray/ProcessEdge production identity.

Do not paste access tokens into screenshots, documents, GitHub, chat or the Android app.

### C. Become a Tech Provider

In the Meta/WhatsApp partner onboarding surface:

1. Start the Tech Provider onboarding process for ProcessEdge.
2. Associate the SellerTray Meta app.
3. Complete requested business/use-case information.
4. Complete any data handling or security questionnaire.
5. Record the submission/reference ID.

SellerTray use-case description:

> SellerTray is a WhatsApp-first order-management SaaS for small businesses. A merchant connects its own WhatsApp Business Account through Meta Embedded Signup. Customers continue chatting with the merchant on WhatsApp. SellerTray receives authorized WhatsApp webhook events, identifies likely product orders, matches products to the merchant's own catalogue and prices, presents orders to the merchant in its mobile app, and sends merchant-approved/merchant-configured order progress notifications back to customers. SellerTray does not sell WhatsApp access and does not expose Meta credentials to merchants or the Android application.

### D. Request required permissions / Advanced Access

Request only permissions needed by SellerTray, including the permissions Meta currently requires for the Embedded Signup and WhatsApp management flow.

Current SellerTray backend expects at minimum:

- `whatsapp_business_management`
- `whatsapp_business_messaging`

If Meta's current Embedded Signup configuration requires another business-management permission, add only the permission actually required by the dashboard/onboarding contract.

Do not request unrelated permissions.

### E. Facebook Login for Business / Embedded Signup configuration

Create the Meta configuration used by SellerTray merchant onboarding.

Record:

- Configuration ID
- App ID
- onboarding variation/type
- permitted assets
- requested permissions
- redirect/callback URI
- allowed domains
- whether coexistence is enabled for the configuration

The **Configuration ID is public configuration** and may be supplied to the SellerTray client/hosted onboarding page. App secret, access token and BISU credentials remain server-only.

### F. App Review evidence

Prepare a separate concise recording for each permission Meta requests.

#### Evidence: WhatsApp Business Messaging

Show:

1. SellerTray merchant connection/authorization.
2. A customer sends a real WhatsApp order message.
3. SellerTray receives it.
4. SellerTray creates/displays the order.
5. Merchant changes order state.
6. Customer receives the WhatsApp progress notification.

Explain that `whatsapp_business_messaging` is required to receive/send the merchant's operational WhatsApp messages.

#### Evidence: WhatsApp Business Management

Show:

1. SellerTray Owner selects Connect WhatsApp.
2. Meta Embedded Signup opens.
3. Merchant selects/creates its WABA.
4. Merchant selects/adds its business phone number.
5. SellerTray returns to connected state.
6. SellerTray displays only safe connection metadata, never the token.

Explain that `whatsapp_business_management` is needed to onboard and manage the merchant-authorized WhatsApp business assets used by SellerTray.

#### Evidence rules

- Use a test merchant/customer account where practical.
- Do not reveal Meta access tokens, app secret or service-role credentials.
- Do not show unrelated user/customer data.
- Narrate the exact permission-to-feature relationship.
- Keep recordings focused on one requested permission at a time.

### G. Meta review submission

Before submitting:

- Business verification is complete or meets Meta's current submission requirement.
- Privacy and Terms are live.
- Account deletion instructions are live.
- Permission explanations match the actual product.
- Review credentials/test path are stable.
- Embedded Signup Configuration ID is recorded.
- App review videos are current.
- No screenshot/video exposes secrets.

Record:

- submission date;
- review case ID;
- permissions submitted;
- review result;
- reviewer questions;
- remediation and resubmission date where applicable.

## Merchant billing disclosure

SellerTray must disclose before connection:

> Connecting WhatsApp to SellerTray does not itself create a SellerTray charge. Your WhatsApp Business Account may require a payment method, and billable WhatsApp Business Platform messaging is charged by Meta according to Meta's current pricing. SellerTray subscription and AI-usage charges are billed separately.

MVP rules:

- ProcessEdge does not collect a merchant's card for Meta WhatsApp charges.
- ProcessEdge does not share a Meta line of credit with merchants.
- ProcessEdge does not add a percentage markup to Meta messaging charges.
- Never promise WhatsApp messaging is permanently free.
- If ProcessEdge later moves to a Solution Partner/shared-credit model, that is a separate commercial/legal implementation and must not be enabled silently.

## Remaining implementation boundary

The secure backend is complete, but merchant self-service cannot be marked production-ready until the Meta dashboard provides and ProcessEdge records the actual Embedded Signup Configuration ID and approved redirect configuration.

After the Configuration ID is available:

1. wire the approved Embedded Signup launcher into SellerTray;
2. send the resulting authorization code + WABA ID + Phone Number ID to `whatsapp-connection`;
3. verify connected status;
4. pass real inbound and outbound E2E;
5. capture App Review evidence;
6. submit Meta review.

## Acceptance gate

The SellerTray Meta production gate is accepted only after all of the following are true:

- ProcessEdge Meta business/Tech Provider requirement satisfied;
- required permissions approved at the access level needed for independent merchants;
- Embedded Signup Configuration ID active;
- a second merchant can self-connect without ProcessEdge entering its Phone Number ID manually;
- Meta credential remains server-only;
- WABA subscription succeeds;
- real inbound message routes to the correct tenant;
- real outbound status message is delivered using the correct merchant connection;
- merchant sees the Meta/SellerTray billing separation before onboarding;
- effective Meta terms/data-sharing classification has been reviewed for release.
