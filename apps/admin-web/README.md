# SellerTray Admin Web

ProcessEdge's single human-facing administration portal for the SellerTray platform.

## Portal role

`apps/admin-web` is the browser UI used by authorised ProcessEdge administrators. It is a cross-tenant platform-operations surface, not a superuser copy of Merchant Web and not a separate business-truth layer.

The active Admin Web foundation includes:

- ProcessEdge administrator password sign-in;
- Supabase MFA / AAL2 enforcement and TOTP enrollment;
- a responsive professional Admin shell with persistent desktop navigation and mobile drawer;
- **Overview** for cross-merchant platform health and attention signals;
- **Merchants** for read-only cross-tenant discovery and platform status in A1;
- **Billing & Commercial** as the reserved commercial-administration surface for plans, subscriptions, installments, payments, promotions, guarantees and agreements;
- **Communications** for merchant notification composition, preview, targeting, confirmation and campaign audit;
- **Platform Operations** for governed service visibility and controlled AI diagnostics;
- **Audit** for privileged administrator activity;
- **Settings** for true platform-level settings only.

## Commercial boundary

SellerTray has no free trial. The approved commercial model uses paid setup plus a one-month money-back guarantee from merchant activation.

The old `SubscriptionAccess.tsx` trial-extension screen remains only as temporary compatibility source while C1/C2 replace the legacy subscription model. It is **not routed by the active Admin Web entry point** and must not be extended with new commercial behaviour.

Commercial implementation must follow:

- `.agents/skills/sellertray-project-implementation/SKILL.md`
- `.agents/skills/sellertray-project-implementation/COMMERCIAL.md`

A1 intentionally keeps Billing & Commercial mutations read-only until the shared commercial authority is implemented. Do not reintroduce direct trial/expiry mutation in the browser to fill that temporary gap.

## Backend boundaries

The Admin Web portal calls privileged server-side capabilities; those functions are not separate human-facing portals:

- `platform-admin` — general platform administration, overview, audit, current compatibility subscription/access actions, WhatsApp status, support and approved platform operations;
- `platform-merchant-message` — specialised governed command for publishing ProcessEdge messages to SellerTray merchants.

Both remain behind authenticated server boundaries. `platform-merchant-message` is invoked from this Admin Web portal and must not be treated as a separate website or user-facing URL.

The browser receives only the Supabase publishable key plus the signed-in administrator JWT. Never place a Supabase service-role key in this app.

## Environment

Copy `.env.example` to `.env.local` and configure the same SellerTray Supabase project used by the governed shared core:

```text
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
```

## Local development

```bash
npm install
npm run dev
```

Validation:

```bash
npm run typecheck
npm run preflight
npm run build
```

## Vercel

Recommended project settings:

- Repository: `olayemigod/OrderDesk-`
- Root Directory: `apps/admin-web`
- Framework Preset: Vite
- Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`
- Keep affected-project deployment filtering enabled so unrelated Mobile, Merchant Web, database and documentation commits do not deploy Admin Web.

Admin Web belongs in the canonical SellerTray integration tree alongside `apps/mobile` and `apps/merchant-web`, even when the Admin portal is not the active implementation surface.
