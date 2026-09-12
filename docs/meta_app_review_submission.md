# SellerTray Meta App Review Submission Packet

**Status:** READY TO COMPLETE WITH META-SUPPLIED IDS / REVIEW MEDIA  
**Product:** SellerTray  
**Company:** ProcessEdge Solutions Limited  
**Prepared:** 2026-09-13

This document contains reviewer-facing draft text. Replace bracketed placeholders with the values shown in Meta before submission. Never paste access tokens, app secret, service-role credentials or encrypted credential material into App Review fields or videos.

## Product summary

SellerTray is a WhatsApp-first order-management SaaS for small businesses. A merchant connects its own WhatsApp Business Account through Meta Embedded Signup. Customers continue chatting with the merchant on WhatsApp. SellerTray receives authorized WhatsApp webhook events, identifies likely product orders, matches products to the merchant's own catalogue and authoritative prices, presents orders to the merchant in the SellerTray mobile app, and sends merchant-configured order progress updates back to customers.

SellerTray does not sell WhatsApp access. The merchant remains the owner of its WhatsApp Business Account and phone number. SellerTray does not require a Meta payment method merely to connect WhatsApp. Any Meta-billable WhatsApp Business Platform messaging remains a separate Meta billing relationship.

## Business/app identifiers

Fill from Meta:

- ProcessEdge Business Portfolio ID: `[META_BUSINESS_PORTFOLIO_ID]`
- SellerTray Meta App ID: `[META_APP_ID]`
- Embedded Signup Configuration ID: `[CONFIGURATION_ID]`
- Production redirect/callback URL: `[REDIRECT_URI]`
- Production webhook callback: `[WEBHOOK_CALLBACK]`
- Review WABA ID: `[REVIEW_WABA_ID]`
- Review Phone Number ID: `[REVIEW_PHONE_NUMBER_ID]`

Do not place these identifiers in the Android bundle unless the value is explicitly public configuration. App secret and access tokens are never client configuration.

## Permission: whatsapp_business_management

### Why SellerTray needs it

SellerTray needs `whatsapp_business_management` so a business Owner can authorize SellerTray to connect and operate the WhatsApp Business assets that the merchant selects through Meta Embedded Signup.

SellerTray uses this permission only for the merchant-authorized WhatsApp business account/phone connection required by the order workflow. After authorization, SellerTray verifies that the selected Phone Number ID belongs to the selected WABA and subscribes the WABA to the SellerTray Meta app for webhook delivery.

SellerTray does not use this permission to take ownership of the merchant's business, silently connect unrelated assets, or expose Meta credentials to the merchant mobile app.

### Reviewer video

Record one focused video showing:

1. Sign in to SellerTray as the Owner of the review business.
2. Open More → WhatsApp connection.
3. Show the SellerTray processing authorization and billing disclosure.
4. Tap Connect WhatsApp.
5. Complete Meta Embedded Signup.
6. Select/confirm the review WABA and business phone number.
7. Return to SellerTray.
8. Show connection state as Connected.
9. Show only safe connection metadata; do not show any access token.
10. If Meta provides an asset-selection/permission screen, keep it visible long enough for the reviewer to see what the Owner authorizes.

### Reviewer explanation

> SellerTray requests whatsapp_business_management so the business Owner can use Meta Embedded Signup to authorize SellerTray to connect the selected WhatsApp Business Account and phone number. SellerTray verifies the selected WABA/Phone Number relationship server-side, subscribes the authorized WABA to SellerTray's webhook, and stores only safe connection metadata in the merchant-visible app. Meta credentials are processed and encrypted server-side and are never exposed to the Android application.

## Permission: whatsapp_business_messaging

### Why SellerTray needs it

SellerTray needs `whatsapp_business_messaging` to support the merchant's operational customer-order conversation on WhatsApp.

The production workflow is:

1. Customer sends a message to the merchant's WhatsApp Business number.
2. Meta delivers the authorized webhook event to SellerTray.
3. SellerTray routes the event by Phone Number ID to the correct merchant tenant.
4. SellerTray determines whether the message contains an order.
5. SellerTray matches any order items against the merchant's own catalogue and prices.
6. Merchant reviews/accepts/updates the order in the SellerTray mobile app.
7. SellerTray sends configured order-progress messages back to that customer through the merchant's connected WhatsApp Business number.

Normal non-order conversations do not create zero-item orders.

### Reviewer video

Record one focused video showing:

1. SellerTray review business is Connected.
2. From a separate customer phone, send a real product-order message to the review WhatsApp number.
3. Show that the message/order appears in SellerTray under the correct merchant.
4. Show catalogue/price matching or review state.
5. Accept/update the order in SellerTray.
6. Show the customer receiving the corresponding WhatsApp progress message.
7. Show that the message came from the connected merchant number.
8. If practical, send a normal greeting and show it does not become an empty order.

### Reviewer explanation

> SellerTray requests whatsapp_business_messaging so an authorized merchant can receive customer order messages through WhatsApp and send operational order-status updates from the same merchant-owned WhatsApp Business number. SellerTray routes messages by the Meta Phone Number ID to the correct tenant, does not invent merchant prices, and does not expose WhatsApp credentials to the mobile client.

## Data handling / security explanation

Suggested reviewer response:

> SellerTray processes only the WhatsApp message content and metadata needed for the merchant-authorized order, customer, payment-assistance, notification and catalogue workflows described in our Privacy Notice. The merchant Owner must accept the current SellerTray Terms/Privacy and separately authorize WhatsApp data processing before SellerTray interprets or stores message content for that tenant. Meta webhook signatures are verified server-side. Provider credentials are never stored in the Android app. Tenant-scoped Meta business credentials, where used, are AES-GCM encrypted in a private server-only schema. Phone Number IDs are unique across SellerTray tenants so the same WhatsApp number cannot be assigned to two merchants.

## Billing explanation

Suggested reviewer response if Meta asks about billing:

> SellerTray's SaaS billing is separate from WhatsApp Business Platform billing. SellerTray does not require a merchant to add a Meta payment method just to connect its WABA/phone number. If the merchant later uses Meta-billable WhatsApp messages, any Meta billing setup and Meta charges are governed by Meta's current pricing and the merchant's Meta account. ProcessEdge does not share a Meta line of credit with merchants in the SellerTray MVP and does not add a percentage markup to Meta messaging charges.

## Reviewer test account

Create a stable review tenant before submission.

Record only in the secure Meta App Review reviewer-credentials field:

- SellerTray review login: `[REVIEW_LOGIN]`
- SellerTray review password: `[REVIEW_PASSWORD]`
- Review business name: `[REVIEW_BUSINESS]`

Do not commit credentials to GitHub or this document.

Recommended review data:

- 2–4 simple catalogue items;
- deterministic NGN prices;
- one customer test number;
- no real customer personal data;
- no production payment credentials.

## Reviewer navigation

1. Sign in.
2. Select the review business if prompted.
3. More → WhatsApp connection.
4. Verify Owner processing authorization.
5. Connect WhatsApp / inspect Connected state.
6. Send order from the separate customer phone.
7. Orders → open the new order.
8. Accept/update order.
9. Verify WhatsApp progress update on the customer phone.

## Submission readiness checklist

- [ ] ProcessEdge Business Portfolio verification complete or acceptable for current Meta submission stage.
- [ ] SellerTray app owned by the correct ProcessEdge Business Portfolio.
- [ ] Tech Provider onboarding started/completed as Meta currently requires.
- [ ] Privacy URL live.
- [ ] Terms URL live.
- [ ] Account deletion URL live.
- [ ] Production webhook configured.
- [ ] Required webhook fields subscribed.
- [ ] Embedded Signup Configuration ID created.
- [ ] Approved redirect/callback configured.
- [ ] `whatsapp_business_management` requested at required access level.
- [ ] `whatsapp_business_messaging` requested at required access level.
- [ ] Any additional permission requested only because Meta's current Embedded Signup setup explicitly requires it.
- [ ] Management permission video uploaded.
- [ ] Messaging permission video uploaded.
- [ ] Reviewer credentials entered only in Meta.
- [ ] No secret appears in screenshots/video.
- [ ] Merchant Meta/SellerTray billing separation visible.
- [ ] Second-merchant self-connect test completed after approval/configuration.
- [ ] Real inbound/outbound acceptance recorded.

## Approval evidence record

Complete after submission:

- Meta submission date: `[DATE]`
- Review/case ID: `[CASE_ID]`
- Permissions submitted: `[PERMISSIONS]`
- First decision date: `[DATE]`
- Decision: `[APPROVED / CHANGES REQUESTED / REJECTED]`
- Reviewer feedback: `[SUMMARY]`
- Remediation commit: `[COMMIT]`
- Resubmission date: `[DATE]`
- Final approval evidence location: `[LOCATION]`
