# SellerTray — Parallel Performance and Email Activation Repair Flow
Date: 09/11/2026
Status: SOURCE DEVELOPMENT; NO TEST OR PRODUCTION RELEASE APPROVED

## Source baselines and protected boundaries

- Commerce/performance UX: `fix/sell-orders-customer-speed-source-20261109`, based on Build47 integration `5d1228a018de76ca2ec5e550c04450c1e5ee23e7`.
- Invitation Mobile repair: draft PR #236 `fix/mobile-invitation-guest-review-20261109`; source-only, no APK or OTA.
- Invitation browser/auth continuation: `fix/invitation-activation-browser-handoff-20261109`, built on PR #236 exact head `48f7b9432ad3ed7ba3b694f261d3c457153d9be8`. Keep review/reconciliation separate from commerce optimisations.
- OA5 Test isolation: draft PR #228, independent and not approved for destructive rebuild. Its Test backend attestation and Preview security gates must pass before hosted end-to-end QA. **No Production database/provider, Vercel preview, DNS, Edge function, APK or OTA mutation by either workstream.** Tandar stays in Production with pending invitation unchanged until intended recipient acceptance.

## P0 workstream A — Selling and operational performance

1. Source baseline: Mobile Orders searchable by reference/customer/phone/product; filters for status/payment/channel/date **collapsed by default**; loaded results incrementally rendered. Merchant Orders existing server-side search/pagination retained, filters collapsed by default. No new order or ledger engine.
2. Customer history: order references open governed details; cross-Branch access denied; historical Mobile order targeted read; Web uses existing governed details service.
3. Saved sale: explicit permitted Branch switch; continue investigating non-resumable drafts with synthetic data, inactive product/UOM, duplicate items, offline conflict and authoritative stock/payment validation.
4. Sell loading and checkout: stage render limits; parallel independent tax/stock prechecks; follow with cache-first catalogue and measured latency improvements without replacing security/access checks.
5. Offline replay: preserve outbox, idempotency, payment verification and queued stock semantics; no queue destructive migration without tested recovery.
6. Full profitability: aggregated Report Center on historical valuation and cost completeness, capability/Branch gated. No guessed profit.

## P0 workstream B — Email invitation and account activation **blocks QA handoff**

Observed Production report (09/11/2026): a Tandar Cashier invitation was pending; email provider accepted a send request, but receipt in the recipient mailbox was not proven. A manually shared invitation link opened the app without actionable invitation review. A pending invite is **not** proof of delivery, email confirmation, identity verification or membership.

This includes **two distinct email paths**:
- Team invitation: `team-management` -> Resend -> `/invite.html?invitation=<opaque ID>` -> browser or Mobile -> invited identity -> explicit accept/decline -> governed membership.
- Account confirmation: Supabase Auth email hook (`send-auth-email`) -> verified confirmation redirect -> signed-in invite review. This is not Business commercial activation and must not auto-create a new Business.

Root-cause scope: PR #236 addresses Mobile invite-aware welcome/sign-in and wrong-session account switching, while the existing Merchant Web `IncomingBusinessInvitations` code was not mounted by the portal root when no Business existed. A new dedicated browser source change must mount that flow for correctly authenticated invitees, allow account-only signup (with no `provision-business` action), retain the invitation across email confirmation, support wrong-account sign-out and avoid auto-opening an obsolete APK. No invitation token alone authorises membership.

### Source continuation and important App Link correction

Additional browser-first activation branch `fix/invitation-activation-browser-handoff-20261109` builds upon Mobile PR #236:
- New invitation emails now point to `/join.html?invitation=<id>`. This path is deliberately **outside** Production Android's already-installed HTTPS App Link `pathPrefix='/invite'`, so a recipient's old APK cannot silently intercept the email URL and open Home without invitation review.
- Legacy `/invite.html` remains supported for prior emails; the deliberate `Open SellerTray app` button still uses the existing `sellertray://invite/<id>` scheme. The browser option remains available.
- Merchant portal mounts governed invitation review even without a Business membership; isolated account-only signup preserves the invitation across Auth confirmation; no `provision-business` write.
- Team & Permissions now offers **Resend email** for existing pending invitations using the original governed invitation command. The provider response is now traceable via provider message ID, and explicitly does **not** establish mailbox delivery. Test actual delivery/bounce separately.
- Merchant Web Vercel production deployment and backend Edge function deployment must be coordinated and verified: **do not send the new `join.html` link through a deployed Edge function before the `join.html` page exists on the production Merchant domain**. Same QA environment first, human release authorization later.
- Invites that were already sent with `/invite.html` cannot be retroactively changed; the recipient can request a fresh email only after the approved rollout.

### Acceptance gates

A. **Email dispatch vs receipt**: use synthetic Test recipient. Verify provider request and provider message/delivery events separately, inbox/spam receipt, sender identity, bounce/complaint suppression and documented retry/resend behavior. A Resend API 2xx proves provider acceptance, **not mailbox delivery**.

B. **New invitee**: invitation email arrives; browser and App Link show invitation-specific entry; sign-up uses exact invited email; Auth confirmation returns to the same isolated QA environment and retains invitation focus; sign in; see correct Business + Cashier/Manager role; explicit accept; verify membership and permitted Branch.

C. **Existing invitee**: signed-in matching email sees the invitation without creating a Business. Existing memberships survive. Wrong signed-in email sees a safe sign-out/switch control, not a false claim that the invitation expired. User can decline or retry; cancelled/expired/resolved IDs never grant access.

D. **Link variants**: recipient opens email on Android with/without app, old installed app, desktop browser, cold/warm app, copied link, after confirmation, after app restart; production and QA scheme/domain separation. No automatic legacy-app launch from browser fallback.

E. **Security and data**: server re-checks tenant, recipient identity, role, Branch and explicit consent. No impersonation, service-role browser leak, cross-tenant exposure, automatic account invitation acceptance or duplicate membership effect on retry.

F. **Environment and release**: PR #236 Mobile source requires a future approved APK, not OTA assumption. Merchant Web and Auth email changes need source checks, typecheck, managed Preview protection, isolated backend, synthetic QA inbox and explicit approval before deployment. Do not use Tandar as a Test fixture. Only after QA passes may a controlled Production release be proposed.

## Source QA continuation (09/11/2026)

- Merchant Web customer history total/line prices are returned as numeric or numeric-string values by the governed management RPC. Its local money formatter now handles both safely; prior source had a strict `number` signature that would reject the new detail typing in TypeScript.
- When customer history opens a specific Mobile order, that explicit focused order bypasses the retained list filters. Expanding it does not silently clear the user's filters. The status controls also include rejected WhatsApp orders.
- Invitation source PR #237 is stacked on PR #236, and source checks include a new `node:test` browser handoff suite. The four browser tests exercised a local matching copy of `invite.js` against valid ID, invalid ID, blocked storage and uppercase ID: **4/4 passed locally**. Four Mobile order-filter tests also **passed locally**. These are not exact-head complete app typechecks or hosted e2e tests.
- Team & Permissions in #237 offers governed **Resend email** and **Copy review link** to the authorised Owner/Manager of an existing pending invitation. The copied link uses `/join.html` on the current Merchant Web origin, is non-authoritative by itself, and still requires the invited authenticated identity and explicit acceptance.
- Both PRs remain draft and source-only. No recipient invitation was sent, no customer data was touched, and neither QA nor Production is deployed.

## Parallel implementation order / release dependency

1. Continue OA5 isolation and Preview security attestation independently.
2. Continue code-only P0 operational performance and source tests.
3. Complete dedicated invitation browser/auth source repair alongside PR #236; preserve individual patch lineage.
4. Run automated preflights/typechecks and small-device/UI accessibility checks on exact reconciled source head.
5. Once OA5 clears, run synthetic end-to-end Test invitation and selling regressions. If email delivery or link-to-review fails, mark **STOP**; do not accept Tandar invitation on recipient's behalf or deploy around it.
6. Consolidate reviewed Android changes into a single approved build after device testing; make web/backend rollout independently gated.
7. Profitability aggregate and deeper offline/caching work follow as separately verified slices.

No application/device/database/provider verification is represented by this plan document.
