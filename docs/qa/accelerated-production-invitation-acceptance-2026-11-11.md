# Production-compatible invitation acceptance correction — 11 November 2026

**Source-only emergency defect slice; not deployed.** After the owner's approved accelerated SellerTray release decision, the exact Merchant production deployment was identified via read-only Vercel deployment metadata: `dpl_CfBFKGKgFdSUBJtceMsCZUVCBgY5` at Git SHA `d8024c215850e0e9a3a0ce1496d1d0dd5d7cd150`. This source correction is branched from the live-compatible lineage `fix/oa5-billing-first-purchase-runtime-authority-20261031`, not the C2/OA5/Build47 migration branch. It should not drag C2 migrations into the urgent merchant-web release.

## Verified source defect
The already-shipped `IncomingBusinessInvitations` UI loaded pending invites and called the governed `team-management` acceptance endpoint but **was not imported or rendered by the deployed `MerchantApp`**. A signed-in recipient without an Owner/Manager business was stopped at the `No management workspace` or Cashier-only screen, where they could not accept. An existing Owner/Manager with a second invitation also had no review surface. The login page offered password sign-in only, preventing a new invited person from creating their SellerTray identity in the browser. Merely opening `/invite.html?invitation=<uuid>` or the app did not accept the invitation.

## Bounded correction
- Mount the **existing** invitation review component on signed-in no-business and Cashier-only branches, and for an existing Owner/Manager who opened a valid stored/browser invitation locator.
- After explicit accepted invitation, reload governed memberships through the existing `sellertray_list_businesses_for_current_user` RPC; do not auto-accept, replace any existing role or bypass tenant/Branch checks.
- Allow an invited new recipient to sign up using the invited email without provisioning a new Business; preserve only the validated invitation UUID through the Supabase email-confirmation redirect. The provider must still deliver confirmation emails and permit the intended redirect; these are **hosted acceptance gates**, not proven by source.
- Keep the existing `team-management` membership/API and invitation email sender unchanged. No database schema, service-role key, Supabase Test reset, C2 migration, mobile build, provider message, or Production release in this PR.

## Acceptance before Production
1. Run Merchant Web typecheck/build and `team-invitation-email-preflight.mjs` on the exact commit; check ordinary merchant login and sign-out still work.
2. Test existing invited identity with zero businesses, a new invited email with email confirmation, and existing Owner/Manager invited to a second Business; accept only when JWT identity email matches the invite. Verify revoked/expired/wrong-email links do not add membership.
3. Check a protected signed-in browser on the exact source with pending and accepted invitation state. Use synthetic Test identities where available; if isolation remains blocked, review whether an inert existing reviewer identity or source-only acceptance is sufficient to *prepare*, **not release**, this fix. No synthetic/live customer writes to Production for QA.
4. Confirm Supabase Auth allowed redirect domain and team-management Edge version at Production; do not invoke or alter provider settings here.
5. Approve a single Merchant-Web-only Vercel Production deployment separately, after verifying its Git SHA, frontend backend project identity, rollback candidate, current live merchant session, and browser testing. Keep live Tandar untouched.

## Independent release tracks
This Merchant Web correction is **independent of C2**. UOM price fallback, cost-aware stock adjustment, performance, saved sale resume, search/filter, customer history and reporting remain separate planned or reviewable Build47/mobile/database corrections; this PR does **not** claim to fix them. The permanent Test isolation candidate B stays in draft PR #228 and requires separate hosted-operation approval.
