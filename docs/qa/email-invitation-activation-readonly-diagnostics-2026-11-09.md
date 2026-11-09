# SellerTray — email invitation and account activation: read-only Production diagnosis
Date: 2026-11-09
Environment: existing SellerTray **Production** (`OrderDesk` Supabase project)
Status: diagnostic evidence only; **no Production mutation or deploy**

## Observations (UTC)

- **13:14:06** — the existing `team-management` Edge function recorded `team_invitation_email_sent`, `provider=resend`. This legacy log proves the function observed an accepted provider request; it does **not** provide provider message ID, recipient inbox delivery, bounce status or message opening.
- **13:46:17** — the independent `send-auth-email` hook recorded `auth_email_sent`, `action=signup`, `messageCount=1`. The associated Edge endpoint returned HTTP **200**, and Supabase Auth recorded a successful `user_confirmation_requested` hook. This proves the Auth email hook executed and reported provider success, **not** inbox receipt or link activation.
- **13:47:03** — the Tandar Oil Solutions Cashier/staff invitation record's latest update time, read-only from `tenant_invitations`. Its **current status is `accepted`**, not pending. The invited email identity is **confirmed** in Auth, and there is a **matching active staff membership** in `tenant_members`. No email address, user UUID, invitation UUID, IP, secret, or token is included in this report.

**Interpretation:** Tandar's originally reported pending invitation was ultimately accepted through some subsequent recipient-side interaction. The data does not prove the original invitation email reached the inbox or that the old installed APK displayed the intended invitation review UI. Do not attribute the acceptance to these unmerged source changes. Do not resend or re-accept this completed invitation.

## Source defects and corrections

1. **Old installed App Link interception:** Previous emailed `/invite.html?invitation=...` was under the installed Android App Link `/invite*` and could open an older APK that lacked invitation review. In draft PR #237, new emails will use `/join.html` outside that prefix, with explicit browser fallback. Legacy links remain supported.
2. **Unreachable browser invitation UX:** Existing Customer/Team invitation review was not mounted for invited users without an existing management Business. Draft PR #237 now routes signed-in invitees to governed invitation review, and offers Auth-account-only registration without Business provisioning. PR #236 carries Mobile invitation UX.
3. **Email uncertainty misclassified as security failure:** The existing Auth email hook returned **401** for unexpected network/provider exceptions **after** verifying the webhook signature. Draft PR #237 now returns a transient **503** for verified post-auth provider failures while keeping invalid signatures at **401**.
4. **Provider traceability:** Draft PR #237 logs Resend provider message IDs for accepted invitation and Auth emails where available, with `recipientDeliveryVerified=false`. This does not implement Resend delivery-status webhooks, and does not prove mailbox delivery.
5. **Follow-up options:** While an invitation is pending, authorised management may request a governed resend or privately copy its review link. A completed/accepted invite must not be re-sent as a means of re-activation.

## Release and acceptance boundaries

- No Production email send, database write, status change, Edge deployment, Vercel Preview, DNS change or APK/OTA build was performed during this investigation.
- PR #237 remains **draft**, stacked on PR #236; neither is deployed. The earlier Tandar acceptance is independent of this source work.
- Before releasing, complete full exact-head TypeScript/source preflights and isolated synthetic Test QA: invite delivery request, provider ID lookup, actual inbox result, browser-first link, wrong identity, account confirmation callback, acceptance/decline and membership/Branch permissions. OA5 isolation gate remains NO-GO until separately accepted.
- After Test acceptance, coordinate the new static `/join.html` Merchant Web route **before** the new backend Edge email-CTA rollout. Any Production changes require explicit release authorisation.

This report intentionally excludes recipient identifiers and any personal authentication details.
