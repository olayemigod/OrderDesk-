# OA5 Test Merchant Web convergence — source-only candidate

Date: 2026-11-13.
Status: DRAFT / unmerged / no Preview / no Test deployment.
Base: PR #242 exact head 6424781713f68c70e6fd588f7182c5fa3a045a0e (461 canonical migrations, 3,082 pgTAP assertions).
Source of missing Merchant behaviors: PR #239, but this candidate deliberately does **not** replace the newer OA5 Merchant shell.

## Ported capability, not old shell

The Test reconstruction source already contains the required Customer History and Profitability backend migrations. This source convergence adds only the matching Merchant behaviors:
- Orders search/status controls remain server-backed but are collapsed by default and expanded deliberately.
- Customer History order references open governed order detail using the **historical Branch ID returned by the server**. The QA-approved optional customer-phone contract is retained; the older Production-compatible phone-required workaround is not copied into this Test candidate.
- Report Center exposes consolidated gross Profitability backed only by `get_sellertray_profitability_report`; unknown/incomplete COGS intentionally withholds total gross profit/margin and directs the merchant to inventory valuation.
- Business invitation locator recovery is integrated into the **existing shared MerchantPortalRoot + MerchantAuth**. No second Login component is introduced. Invitation-only sign-up creates Auth identity only, preserves the validated locator through confirmation, and never calls `provision-business`; membership is still created only by authenticated explicit acceptance through the existing team-management authority.
- Existing Owner/Manager/Cashier identities can accept another Business invitation without replacing current memberships.

## Explicitly preserved newer OA5/Test behavior

Do not take PR #239 MerchantApp wholesale. The 461 Test base keeps its newer route persistence/back-forward restoration, mobile commercial handoff, Business profile/logo synchronization, notification lifecycle, commercial journey navigation, optional-phone schema, Test Meta fail-closed protection and shared active/non-retired WhatsApp route boundary.

Security preflights enforce all of the above: no raw Orders/profitability reads, Branch-qualified customer order detail, optional phone, cost-completeness withholding, no invitation provisioning of a new Business, and no alternate Merchant login.

## Resource and release boundary

The inherited Merchant `vercel.json` disables Git deployment for all ordinary branches; only `main` and deliberate `qa-preview/merchant-**` branches can deploy. This branch is not a QA Preview branch, so source/CI work must not consume a Merchant Preview. No hosted Supabase mutation, cron pause, Meta/PSP/SMTP/FCM call, APK or Production/Tandar change is authorised.

Acceptance still requires exact-head Merchant Web CI and database/OA5 isolation checks, then a separately approved exact SHA promotion to a managed `qa-preview/merchant-...` only after Method B Test reconstruction and provider isolation are complete.
