# SellerTray Admin Web

Minimal ProcessEdge administration portal for SellerTray merchant notifications.

## Scope

This app intentionally contains only the first web-admin module:

- ProcessEdge administrator sign-in
- Supabase MFA / AAL2 enforcement and TOTP enrollment
- SellerTray business discovery and targeting
- Owner / Manager / Staff audience targeting
- Product update, service, information and promotion messages
- Normal, attention and urgent priority controls
- Optional CTA and expiry
- Merchant notification preview
- Explicit final publish confirmation
- Recent merchant-message audit history

Billing, subscription management and broader platform administration are intentionally outside this module for now.

## Environment

Copy `.env.example` to `.env.local` and configure the same SellerTray Supabase project used by the mobile app:

```text
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
```

Do not place a Supabase secret/service-role key in this app. The browser uses only the publishable key plus the signed-in administrator JWT. Privileged actions remain behind the existing `platform-admin` and `platform-merchant-message` Edge Functions.

## Local development

```bash
npm install
npm run dev
```

Validation:

```bash
npm run typecheck
npm run build
```

## Vercel

Recommended project settings:

- Repository: `olayemigod/OrderDesk-`
- Root Directory: `apps/admin-web`
- Framework Preset: Vite
- Production branch: set when the admin portal is approved for release
- Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`
- Intended domain: `app.sellertray.com`

Use a preview deployment first. Do not attach the production domain until notification E2E QA is complete.
