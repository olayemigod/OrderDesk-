# SellerTray Admin Web

ProcessEdge's single human-facing administration portal for the SellerTray platform.

## Portal role

`apps/admin-web` is the browser UI used by authorised ProcessEdge administrators. It is not a separate business-truth layer and does not expose privileged database credentials to the browser.

The portal currently includes:

- ProcessEdge administrator sign-in;
- Supabase MFA / AAL2 enforcement and TOTP enrollment;
- SellerTray business discovery and targeting;
- merchant notification composition, preview, targeting and publish confirmation;
- Owner / Manager / Staff notification audience targeting;
- product update, service notice, information and promotion messages;
- normal, attention and urgent notification severity controls;
- optional CTA and expiry;
- merchant-message audit history;
- subscription/access administration supported by the governed platform admin backend.

## Backend boundaries

The Admin Web portal calls privileged server-side capabilities; those functions are not separate human-facing portals:

- `platform-admin` — general platform administration, overview, audit, subscription/access, WhatsApp status, support and approved platform operations;
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
- Intended production domain: `app.sellertray.com`
- Keep affected-project deployment filtering enabled so unrelated Mobile, Merchant Web, database and documentation commits do not deploy Admin Web.

Admin Web belongs in the canonical SellerTray integration tree alongside `apps/mobile` and `apps/merchant-web`, even when the Admin portal is not the active implementation surface.
