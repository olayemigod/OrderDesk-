# SellerTray Live Activation

This document is the operational activation view. Historical implementation detail remains in `docs/saas_rollout_status.md`.

Supabase project ID: `eujxswjspolugrzlsjnn`.

## Code and platform state

**CODE PASS / RELEASE ACCEPTANCE PENDING**

Current established state:

- Core merchant workflow is implemented and server-governed.
- Tenant/RLS isolation is deployed.
- Self-service signup, provisioning, teams, catalogue and business settings are implemented.
- WhatsApp ingestion foundation is deployed.
- AI parser integration and safe fallback are implemented.
- Outbound notification queue/worker foundation is deployed.
- Business insights are implemented.
- Subscription lifecycle and Paystack adapter are implemented.
- ProcessEdge SaaS operations/admin boundary is implemented.
- Business export and account deletion are implemented.
- SellerTray production app identity and Android build profiles are committed.
- All 9 current Edge Functions are ACTIVE and structured-observability instrumented.
- Every body-consuming Edge Function has a streamed request-size limit.
- Public deletion resource is live at `https://processedge.com.ng/sellertray/account-deletion`.
- Mobile CI #160 passed typecheck plus the automated SellerTray release preflight.

## SellerTray production identity

- Version: `1.0.0`
- Android package: `ng.processedge.sellertray`
- Canonical scheme: `sellertray://`
- Temporary beta scheme: `orderdesk://`
- Subscription plan label: `SellerTray Business`

## External acceptance gates

The authoritative machine-readable gate state is `docs/release_acceptance.json`.

The release is held until all required gates are accepted:

1. Supabase Auth redirect URLs.
2. Supabase leaked-password protection.
3. SellerTray icon/adaptive-icon/splash assets.
4. SellerTray Privacy Policy and Terms legal approval/publication.
5. Production Auth/SMTP email.
6. Signed Android preview APK.
7. Physical-device native smoke, including disposable account deletion.
8. Production Android AAB.
9. Meta WhatsApp production inbound/outbound E2E.
10. Live AI parser acceptance.
11. Outbound WhatsApp worker delivery acceptance.
12. Approved commercial values plus Paystack test billing acceptance.

Run from `apps/mobile`:

```bash
npm run preflight
npm run release:check
```

`npm run preflight` must pass in CI. `npm run release:check` is expected to fail while external gates remain pending and must not be bypassed for a production declaration.

## Provider acceptance sequence

### Meta / WhatsApp

- Finish business/app verification.
- Confirm production phone-number mapping.
- Send a genuinely new inbound customer message.
- Verify one order is created exactly once.
- Accept/edit the order in SellerTray.
- Progress it to a notification-producing state.
- Confirm outbound delivery and provider delivery/failure reconciliation.

### AI parser

- Configure `OPENAI_API_KEY` and `ORDER_PARSER_TOKEN` only in server secret storage.
- Send a controlled order phrase against a known merchant catalogue.
- Confirm extracted item/quantity and parser provenance.
- Confirm merchant price comes from the catalogue, not AI.
- Exercise parser failure and verify conservative fallback.

### Paystack

- Freeze approved SellerTray commercial values.
- Configure provider plan reference and secret server-side.
- Run test checkout.
- Verify signed webhook, idempotent provider-event ledger and subscription transition.
- Exercise failed/non-renewal handling before live mode.

### Auth/email

- Configure SellerTray and temporary legacy Auth redirect URLs.
- Enable leaked-password protection.
- Configure production SMTP/Auth email.
- Verify signup confirmation and password recovery on an installed native build.

## Native Android acceptance

Use the preview APK profile first. Follow the complete matrix in `docs/release_runbook.md`.

Only after preview acceptance should the production AAB be generated for Google Play.

## Merge rule

PR #1 remains draft until the required release/provider gates for the intended paid pilot are accepted. Code completeness alone is not permission to merge or call SellerTray production-ready.
