# SellerTray Identity and Business Invitation Governance

Status: **Normative extension of `SKILL.md` — approved 2026-11-02**

This extension records the approved SellerTray identity and team-invitation model. It governs Business membership invitations, multi-Business identities, invitation email presentation, invitation links, Mobile/Web routing and invitation acceptance.

## Governing identity model

SellerTray has one person/account identity per authenticated email identity. A SellerTray user does **not** create a second login merely because another Business invites the same email address.

Membership is Business-scoped:

> SellerTray identity -> one or more Business memberships -> Business-specific role and Branch authority

Rules:

1. The same authenticated user may be Owner in one Business, Manager in another and Cashier in another.
2. Business membership, role, Branch assignment and capabilities remain isolated per Business; accepting another Business invitation must never replace or weaken an existing membership.
3. A Business switch changes active tenant context, not the signed-in identity.
4. Membership uniqueness is scoped to the Business + user authority. Do not introduce a global one-Business-per-user restriction.
5. Merchant/Branch isolation remains server-authoritative after every Business switch.

## Invitation lifecycle

A SellerTray Business invitation is an offer of membership, not an account-activation credential.

1. Creating or refreshing an invitation records a governed pending invitation with its Business, invited email, intended role, inviter, expiry and audit history.
2. An existing SellerTray identity is **not** auto-added when invited.
3. A new recipient creates/validates an ordinary SellerTray identity using the invited email, then reviews the same pending Business invitation.
4. An existing recipient signs in with the existing SellerTray account and reviews the invitation; no second account is created.
5. Acceptance must be explicit and server-authoritative. The authenticated identity email must match the invitation email before membership can be created.
6. Decline, expiry and cancellation remain explicit terminal invitation states. Re-sending may refresh the governed pending invitation according to the existing retry contract.
7. Accepted invitation replay must be idempotent for the same authenticated identity and must not duplicate membership or audit effects.

## Invitation links are locators, never authority

The invitation email may carry the opaque invitation UUID or another non-authoritative locator so the correct invitation can be focused after app/browser handoff.

Rules:

1. Possession of the invitation URL never grants Business membership.
2. Do not place a service-role key, session token, raw authorization secret or auto-accept bearer token in the invitation URL.
3. The URL must survive sign-in/sign-up so the user returns to the intended invitation after authentication.
4. Wrong-identity access fails closed through the server email-match authority.
5. Expired, declined, cancelled or already-resolved links must show a safe resolved/not-pending outcome without changing current Business access.
6. Re-opening an accepted link must not create duplicate membership.

## Channel and routing contract

The canonical production invitation URL uses Merchant Web as the HTTPS smart-link/fallback origin:

`https://app.sellertray.com/invite...`

The intended experience is:

> invitation email -> canonical SellerTray smart link -> SellerTray Mobile when available -> authenticated invitation review -> Accept/Decline -> governed membership -> appropriate Business context

Rules:

1. Mobile is the primary operational destination for Cashier invitations because Mobile performs day-to-day Branch operations.
2. Owner/Manager recipients may also accept through Merchant Web; accepted Owner/Manager Businesses may appear in the Merchant Web management selector.
3. Cashier membership must not be promoted into Merchant Web management merely because the invitation was accepted in a browser. Merchant Web management remains Owner/Manager only.
4. The browser fallback must preserve the invitation locator through authentication and focus the intended invitation.
5. Android/iOS verified App/Universal Links should be used where the required production-domain association and signing identifiers are available. A SellerTray custom-scheme fallback may be retained so unsupported browsers/devices can still open the installed app.
6. Domain association is delivery/routing configuration only; it never changes membership authority.

## Merchant-facing role language

Internal `staff` remains the technical role identifier where required for compatibility. User-facing surfaces must label that role **Cashier**.

Do not expose `staff` as the permanent merchant-facing role label in invitations, Mobile invitation review or Merchant Web invitation review.

## Email identity and presentation

SellerTray is the merchant-facing product identity for SellerTray transactional and authentication emails.

1. Visible sender name: **SellerTray**.
2. Preferred product-domain mailbox: `notifications@sellertray.com` once that sender/domain is verified with the configured email provider.
3. Until the product-domain mailbox is verified, preserve a known-deliverable configured sender address but force the visible display name to SellerTray. Do not hard-code an unverified mailbox and cause transactional email failure.
4. ProcessEdge may appear in footer/legal ownership wording such as **“SellerTray is a ProcessEdge product.”** It must not replace SellerTray as the primary sender/product identity.
5. Merchant-facing links use the canonical SellerTray origins (`sellertray.com`, `app.sellertray.com`, `admin.sellertray.com`) rather than deployment aliases.
6. Team invitation CTA wording should describe the actual action, normally **Review invitation** or **Join <Business>**, not **Activate your account** for an existing identity.

## Cross-surface completion requirements

Any future change to identity/invitation behavior must assess and, where affected, update in one implementation sweep:

- shared membership/invitation authority and audit history;
- team-management email delivery;
- Mobile auth/deep-link bootstrap and Business switching;
- Merchant Web sign-in/fallback and invitation review;
- role labels and permissions;
- canonical domain routing and App/Universal Link association;
- transactional/authentication email sender identity;
- retry/idempotency, expiry and wrong-identity behavior.

WhatsApp, AI, reporting and offline commerce do not gain independent membership truth from invitation links. They continue to consume the same authenticated Business/Branch authority after membership exists.

## Required regression cases

At minimum verify:

1. new email invited to one Business -> account creation/verification -> invitation review -> accept;
2. existing SellerTray identity invited to a second Business;
3. Owner in Business A + Cashier in Business B;
4. Owner in Business A + Manager in Business B;
5. invitation re-send/refresh without duplicate pending membership effects;
6. wrong authenticated email follows another person's invitation link -> denied/fails closed;
7. expired, declined and cancelled invitation link;
8. accepted link reopened -> idempotent/no duplicate membership;
9. Business switch preserves tenant/Branch isolation;
10. Cashier acceptance remains operational-Mobile access and does not become Merchant Web management;
11. email sender displays SellerTray while delivery uses a verified/configured mailbox;
12. invitation link does not itself grant membership.
