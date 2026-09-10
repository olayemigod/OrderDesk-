# SellerTray Google Play Data Safety & App Content Worksheet

Status: **submission draft — not yet entered in Play Console**

Product: SellerTray 1.0.0  
Android package: `ng.processedge.sellertray`

This worksheet maps the current SellerTray Android application and backend data flows to Google Play declarations. It is intentionally conservative. Final Play Console answers must be checked against the exact signed AAB, production provider configuration and the legally approved Privacy Policy.

## 1. Current Android data/SDK baseline

Current mobile dependencies are limited to Expo/React Native, Supabase JS and AsyncStorage. The current app does **not** contain an advertising SDK, mobile analytics SDK or mobile crash-reporting SDK, and does not request location, contacts, camera, microphone, SMS/call-log, calendar or file-library permissions.

Current server-side data domains include merchant authentication, merchant business profile/team/catalogue, customer WhatsApp/order records, workflow history, notifications, subscription/payment references and legal acceptance.

### Play top-level answers — draft

| Play question | Draft answer | Basis / release condition |
| --- | --- | --- |
| Does the app collect or share required user data types? | **Yes** | SellerTray transmits merchant account/workspace and operational data off-device. |
| Is all collected data encrypted in transit? | **Yes — verify on final AAB/provider smoke** | Production app/backend/provider URLs are HTTPS/TLS. Do not submit Yes if any production integration is later configured without TLS. |
| Can users request deletion of their data? | **Yes** | In-app deletion is implemented and external resource is live at `https://processedge.com.ng/sellertray/account-deletion`. |
| Does the app contain ads? | **No** | No ads product behavior or ads SDK exists in the current release. |
| Financial features declaration | **My app doesn't provide any financial features** | Paystack is used only to pay for the SellerTray SaaS subscription. SellerTray is not a wallet, payment service, banking, lending, transfer, investment or financial-advice product. |
| News app declaration | **No** | SellerTray is a merchant operations SaaS. |
| Target audience | **Proposed: adults / 18+ business users** | This is the intended merchant audience. Final Play selection must match marketing/store listing. |
| Restricted app access | **Yes** | Most functionality requires merchant sign-in. Supply Play reviewers a stable test account and exact access instructions. |
| Content rating | **Pending IARC questionnaire** | Must be completed in Play Console before release. |
| AI-generated-content app | **Likely not core policy scope** | AI only structures existing order text as a bounded productivity feature; it is not a general chatbot/content-generation product. User Data obligations for the third-party AI integration still apply. |

## 2. Recommended Data Safety type mapping

### Personal info — Email address

**Collect: Yes**  
**Required: Yes**

Examples in SellerTray:
- merchant Supabase Auth email;
- billing email;
- invited staff email.

Recommended purposes:
- **Account management**
- **App functionality**
- **Fraud prevention, security and compliance** where used for identity/account security.

Potential sharing:
- Supabase receives/processes account email as the platform service provider.
- Paystack may receive billing email for subscription checkout.
- Final "shared" answer depends on whether the production processor relationship qualifies for Google's service-provider exception. If that classification has not been verified, use the conservative shared declaration rather than incorrectly selecting No.

### Personal info — User IDs

**Collect: Yes**  
**Required: Yes**

Examples:
- Supabase Auth user UUID;
- membership actor/requester IDs;
- legal acceptance actor ID.

Recommended purposes:
- **Account management**
- **App functionality**
- **Fraud prevention, security and compliance**

Sharing:
- Primarily processed inside Supabase infrastructure. No advertising/device-profile use exists.

### Personal info — Phone number

**Collect: Yes — conservative declaration**  
**Required: No / optional for the merchant profile**

Examples:
- merchant business phone entered in Business Profile.

Important distinction:
- customer WhatsApp phone/WA ID primarily arrives server-to-server from Meta rather than being harvested from Android device contacts.
- SellerTray does not request Android Contacts permission.

Recommended purposes:
- **App functionality**
- **Account management** when used as merchant profile/contact data.

### Personal info — Name

**Collect: Yes — conservative declaration**  
**Required: Yes for workspace/business name**

SellerTray does not currently ask for a merchant first/last name. It does require a business/workspace name. Because a sole trader may use a personal or trading name that identifies them, the conservative Play declaration is **Name collected** unless legal/store review concludes this business-only field is outside the Play personal-name category.

Recommended purposes:
- **App functionality**
- **Account management**

### Financial info — User payment info

**Collect: No, under the current Paystack architecture**

SellerTray must not receive/store card numbers, bank-account numbers, CVV or equivalent payment credentials. The Paystack-hosted payment service should collect those directly.

If the integration changes so SellerTray can access payment credentials, this answer must change before release.

### Financial info — Purchase history

**Conservative submission recommendation: Collect Yes**

SellerTray is fundamentally an order/transaction workflow. The Android app retrieves and modifies order lines, quantities, prices, totals and transaction/workflow status. Although original customer orders arrive from WhatsApp server-side, merchant corrections and workflow actions are transmitted from the app and become part of the transaction record.

Recommended purposes:
- **App functionality**

Do not use this category to imply that SellerTray collects the merchant's unrelated personal shopping history.

### App activity — Other user-generated content

**Collect: Yes**  
**Required: Mostly optional / feature-dependent**

Examples:
- catalogue product names, aliases, SKU/category and price;
- optional business type/logo URL;
- merchant corrections to parsed order lines;
- rejection/cancellation reasons and other open-ended operational text.

Recommended purposes:
- **App functionality**

Provider transfer review:
- catalogue names/aliases may be included in server-side AI parser context.
- If OpenAI is treated under Google's service-provider exception for the production API relationship, this may not need to be marked "shared"; if that classification is not confirmed, declare the relevant type as shared rather than under-declare it.

### App activity — Other actions

**Collect: Yes**  
**Required: Yes for normal service operation**

Examples:
- order state transitions;
- notification preference changes;
- team-management actions;
- legal Terms/Privacy acceptance;
- subscription/admin actions where permitted.

Recommended purposes:
- **App functionality**
- **Fraud prevention, security and compliance** for security/audit events.

### Messages — Other in-app messages

**Current Android Data Safety recommendation: No collection from the Android device**

SellerTray displays customer WhatsApp content, but the source customer message reaches the backend from Meta and is then delivered to the merchant app. The Android app is not a WhatsApp-message scraper and does not request SMS/notification-access permissions.

However, the SellerTray Privacy Policy must still disclose that the SellerTray service processes WhatsApp order content. If a later release allows merchants to type/send free-form customer messages from the mobile app, reassess this category before that release.

## 3. Categories currently expected to be No

Unless the exact release binary introduces a new SDK/permission or behavior, do **not** select:

- Approximate location
- Precise location
- Address
- Race and ethnicity
- Political or religious beliefs
- Sexual orientation
- Health info
- Fitness info
- Credit score
- Other financial info
- Emails message content
- SMS/MMS content
- Photos
- Videos
- Voice/sound recordings
- Music/other audio
- Files and docs
- Calendar
- Contacts
- In-app search history
- Installed apps
- Web browsing history
- Crash logs
- Diagnostics
- Other app-performance data
- Device or other IDs / advertising ID

Notes:
- SellerTray search/filter terms are currently operational client behavior and are not stored as search-history analytics.
- The JSON export is explicitly user-initiated; using the native Share sheet does not itself mean SellerTray uploads files to a third-party storage provider.
- A logo **URL** is text; direct image upload is not in this release.
- Reassess crash/diagnostic categories if Sentry, Crashlytics or another mobile observability SDK is added.

## 4. Data sharing classification — do not guess in Play Console

Google's Data Safety definition excludes certain transfers from "sharing", including qualifying transfers to a service provider acting on the developer's instructions. SellerTray's final declaration therefore needs a provider-contract check.

| Provider | SellerTray data flow | Preliminary Play treatment |
| --- | --- | --- |
| Supabase | Auth, database, storage, server functions | Likely service provider; collected data still disclosed, "shared" may be exempt. |
| OpenAI API | Minimum inbound order wording + catalogue names/aliases for bounded parsing when enabled | Verify service-provider treatment and production data controls. Google explicitly holds developers responsible for User Data compliance with third-party AI integrations. |
| Meta / WhatsApp | Incoming customer order events; outgoing status messages may include business name/order information | Verify whether each transfer fits service-provider or user-initiated/expected-action exception. If uncertain, declare shared conservatively. |
| Paystack | Billing email/reference and hosted subscription checkout | Payment credentials collected directly by Paystack are not SellerTray-collected if SellerTray never accesses them. Review email/reference sharing classification separately. |
| Vercel | Public ProcessEdge legal/deletion web pages | Mobile opens these as external web URLs; SellerTray does not intentionally send merchant account payloads to Vercel. |

**Release rule:** SellerTray must not submit "No data shared" merely because third parties are infrastructure vendors. Confirm the Google service-provider definition against the actual contracts/configuration first.

## 5. Security/deletion answers

### Encryption in transit

Draft: **Yes**

Acceptance evidence required before submission:
- signed AAB generated;
- production API/provider URLs are HTTPS;
- no cleartext Android traffic exception is introduced;
- Meta, OpenAI, Paystack and Supabase production requests use TLS.

### Data deletion

Draft: **Yes**

Evidence already available:
- in-app account deletion;
- password + explicit confirmation;
- owned tenant/workspace deletion;
- membership cleanup;
- Auth-user deletion;
- public web request path;
- legal/deletion policy explains backup and lawful-retention exceptions.

### Independent security review

Do **not** claim an independent security review unless ProcessEdge actually obtains one meeting Google's current form definition.

## 6. Play App Content worksheet

### App access

SellerTray is login-restricted. Before submission create a stable Play review tenant that:
- does not depend on a personal employee account;
- does not require expiring OTP/MFA unless instructions can reliably support Google review;
- has a small safe catalogue and test orders;
- allows reviewers to reach Home, Orders, Business, legal links and account deletion;
- is not the production ProcessEdge platform-admin account.

Record the credentials in Play Console **App access**, not in source control.

### Ads

Draft: **No**.

If ads/marketing SDKs are ever added, update the Play declaration, privacy policy and Data Safety form before shipping that version.

### Target audience

Proposed SellerTray audience: **18+ business users**. Do not include child age groups merely to maximize availability. Selecting child age groups can trigger Families requirements.

### Content rating

Complete the IARC questionnaire accurately. SellerTray has no built-in entertainment, gambling, sexual or violent feature. Private merchant/customer order text can nevertheless contain user/business-entered content, so answer the questionnaire based on the exact questions rather than assuming an automatic rating.

### Financial features

Recommended answer: **My app doesn't provide any financial features.**

SellerTray charging merchants for its own SaaS subscription is commerce for SellerTray service access, not a user-facing digital wallet, mobile payment product, banking/lending product, transfer service or investment product.

### AI

SellerTray's current AI parser transforms existing order text into structured operational fields. It is a limited productivity feature rather than a general generative-content destination. Nevertheless:
- disclose the third-party AI processing in the Privacy Policy;
- send only minimum required text/catalogue context;
- keep merchant pricing deterministic;
- retain human review for uncertain output;
- reassess Google's AI-generated-content policy if SellerTray later generates free-form customer-facing content.

## 7. Store technical gates

As of September 10, 2026, Google Play requires new normal Android apps to target Android 16 / API 36. SellerTray currently uses Expo SDK 57, whose documented `targetSdkVersion` is 36.

**Do not mark the final target-API gate accepted until the signed production AAB is inspected and Play Console accepts its target API.**

Other mandatory submission preparation:
- publish legally approved SellerTray Privacy Policy;
- provide account-deletion URL;
- complete Data Safety;
- complete Financial features declaration;
- complete App access instructions;
- complete target audience;
- complete IARC content rating;
- provide store listing/screenshots/icon;
- ensure verified developer/app registration requirements shown in the account are complete.

## 8. Recommended provisional Play Data Safety selections

This is the conservative working set for Play Console review:

| Data type | Collect | Required? | Primary purposes |
| --- | --- | --- | --- |
| Name | Yes | Yes | App functionality; Account management |
| Email address | Yes | Yes | Account management; App functionality; Security/compliance |
| User IDs | Yes | Yes | Account management; App functionality; Security/compliance |
| Phone number | Yes | No | App functionality; Account management |
| Purchase history | Yes | Yes | App functionality |
| Other user-generated content | Yes | No | App functionality |
| Other actions | Yes | Yes | App functionality; Security/compliance |

**Sharing selections remain pending provider-classification review.** If there is doubt, select sharing for the affected type rather than rely on an unverified service-provider exemption.

## 9. Change-control triggers

Re-run this worksheet before shipping any release that adds:
- a mobile analytics/crash SDK;
- advertising or attribution;
- push-notification/device token collection;
- location;
- contacts;
- camera/photo/file upload;
- merchant free-form WhatsApp messaging;
- payment credential access;
- device fingerprinting;
- new AI provider or expanded AI-generated content;
- new sales channel;
- new SDK that sends data off-device.

The Play Data Safety label describes the released app and its SDK behavior. It must change when the actual behavior changes.
