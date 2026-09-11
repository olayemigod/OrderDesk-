# SellerTray Data Processor / Google Play Sharing Review

Status: **three providers provisionally classified; Meta classification still open**

Purpose: support the SellerTray Privacy Policy and Google Play Data Safety "shared" answers. This is a product/compliance engineering record, not legal advice.

## Google Play rule used

Google Play generally treats off-device transfer of app-collected data to a third party as sharing. Its Data Safety guidance provides exceptions, including transfers to a service provider that processes user data on behalf of the developer and under the developer's instructions, and certain specific user-initiated/expected transfers.

The fact that a company is a vendor does not automatically make every data flow exempt. Classification must follow the actual contract and processing purpose.

## Supabase — provisional SERVICE PROVIDER

SellerTray use:
- authentication;
- Postgres/database;
- Storage;
- Edge Functions/backend infrastructure.

Current public DPA position:
- Supabase states that it acts as processor/service provider and the customer acts as controller/business for covered data, except for identified usage-data/controller purposes.

SellerTray treatment:
- **Collected:** yes, for applicable data types transmitted from the mobile app to SellerTray/Supabase.
- **Shared:** provisionally **No under the Play service-provider exception** for covered service data processed on SellerTray's behalf.
- Reassess any Supabase usage/telemetry data that Supabase processes for independent controller purposes if that data is in scope of Play's user-data types.

Release evidence still needed:
- ProcessEdge/Supabase contractual account must be the production account.
- Privacy Policy must name the infrastructure/service-provider category.
- Final binary should not add unrelated Supabase/mobile telemetry behavior.

## OpenAI API — provisional SERVICE PROVIDER, configuration review required

SellerTray use:
- bounded server-side parsing of inbound order wording;
- catalogue names/aliases may be provided as context;
- output is structured assistance, not authoritative pricing/payment/stock state.

Current public OpenAI API position:
- API/business inputs and outputs are not used for model training by default.
- Default API abuse-monitoring logs can retain customer content/metadata for up to 30 days unless a different approved data-retention control applies.

SellerTray treatment:
- the Android app does not call OpenAI directly; parsing is server-side.
- app-entered catalogue data can later become part of server-side AI context, so the transfer remains relevant to the broader User Data/privacy assessment.
- **Shared:** provisionally **No under the Play service-provider exception** only if ProcessEdge's production API contract/configuration supports processing on SellerTray's behalf and no independent use inconsistent with that classification applies.
- If that cannot be established for the final production setup, mark the relevant Data Safety types as shared.

Release controls:
- SellerTray's local AI cost telemetry stores model/outcome/status and token counts only; it does not duplicate the customer prompt or model output in the telemetry record.
- API key remains server-only.
- Do not opt SellerTray production data into model training.
- Record the production OpenAI project/data-control setting before Play submission.
- Prefer the lowest retention setting reasonably available for the production project.
- Privacy Policy must disclose third-party AI processing.

## Paystack — provisional SERVICE PROVIDER for SellerTray subscription billing

SellerTray use:
- hosted checkout for SellerTray's own SaaS subscription;
- billing email/reference;
- provider customer/subscription references and webhook status.

Current Nigerian DPA position:
- Paystack states the merchant/controller relationship and defines Paystack as processor for merchant personal data processed to provide payment services.
- Paystack may also have independent statutory retention duties for payment records.

SellerTray treatment:
- **User payment info:** SellerTray should answer **Not collected** while card/bank credentials are collected directly by Paystack and SellerTray never accesses them.
- Billing email/reference remains app/account data and is separately disclosed as collected.
- **Shared:** Paystack's processor relationship supports the Play service-provider exception for covered processing. In addition, Google has a specific payment-provider example for payment credentials collected directly by the payment service.
- Paystack's independent legal/statutory retention should remain disclosed in the Privacy/retention wording where relevant.

Release controls:
- keep Paystack checkout hosted/provider-controlled;
- never log or store card/bank credentials;
- verify production billing payload contains no unnecessary merchant/customer data;
- final Privacy Policy identifies payment processing provider/category.

## Meta / WhatsApp — PARTIALLY RESOLVED / EFFECTIVE-TERMS CHECK REQUIRED

SellerTray use:
- customer WhatsApp messages arrive from Meta/WhatsApp to SellerTray server-side;
- SellerTray sends order-status notifications through WhatsApp;
- merchant business name and transaction/order information can appear in outbound status messages.

Current public contract evidence:
- the WhatsApp Business Terms incorporate the WhatsApp Business Data Processing Terms;
- for Customer Data such as customer contact information, the business is the Controller and instructs WhatsApp to process that Personal Information on its behalf as Processor;
- the Data Processing Terms say WhatsApp processes that Personal Information according to the business's instructions and can use subprocessors subject to those terms;
- the same Business Terms separately state that WhatsApp collects business-account, usage, log, performance, diagnostics/support and related information and may use/share some of that information with other Meta Companies for its own stated business-service purposes.

Google Play implication:
- Customer Data processed by WhatsApp solely as processor has strong support for the Play service-provider exception.
- Do **not** generalize that exception to every Meta/WhatsApp data flow. Business-account/usage information processed for Meta's independent purposes may require a different Play classification if it includes a SellerTray Data Safety type transmitted by the Android app.
- SellerTray itself should minimize mobile-to-Meta merchant account data; WhatsApp/WABA configuration remains server/admin-side.

Time-sensitive contract gate:
- Meta has announced updated Meta Terms for WhatsApp Business effective **September 23, 2026**.
- If SellerTray's final Play submission/provider acceptance occurs on or after September 23, 2026, re-read the then-effective WhatsApp Business Solution Terms and Data Processing Terms before freezing the Data Safety "shared" answers.
- Therefore this provider is not release-accepted yet despite the current processor language.

Conservative Play rule:
- If the production terms/data flow do not clearly fit a service-provider or other Google exception, declare the affected type as shared for **App functionality** rather than under-declare it.

## Vercel / ProcessEdge website

SellerTray opens the ProcessEdge Privacy, Terms and account-deletion URLs using the device's external browser. SellerTray does not intentionally append merchant identifiers, authentication tokens or workspace data to those URLs.

Current treatment:
- no SellerTray mobile user-data sharing declaration is expected solely because users open these public web resources.

## Provisional decision table

| Provider | Role for current SellerTray flow | Play "shared" working answer |
| --- | --- | --- |
| Supabase | Processor/service provider for covered app data | No, provisional service-provider exception |
| OpenAI API | Server-side AI processor/service candidate | No provisionally, **only after production contract/data-control verification** |
| Paystack | Processor/payment service for SellerTray subscription | No provisionally for covered processing; payment credentials not SellerTray-collected |
| Meta / WhatsApp | Processor for covered Customer Data; separate independent business/usage processing exists | **Pending final effective-terms/data-flow check; conservative Yes where exception is not established** |
| Vercel public legal pages | External public website, no intentional account payload | No app-data sharing expected |

## Release rule

The `google_play_data_safety` gate cannot be accepted until:
1. Meta/WhatsApp production data-processing classification is resolved;
2. OpenAI production project data controls are recorded;
3. Paystack production billing payload is confirmed;
4. final shared/not-shared answers are entered in Play Console;
5. the legally approved Privacy Policy says the same thing.
