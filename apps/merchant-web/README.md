# SellerTray Merchant Web

SellerTray Merchant Web is the management surface for SellerTray business Owners and Managers.

It follows the product boundary:

- mobile performs day-to-day selling and operations;
- web manages and reviews;
- WhatsApp remains a selling channel on the same commerce core;
- all surfaces use the same Branch, product, UOM, inventory, order, payment and permission model.

## Current management surface

The first slice includes:

- SellerTray merchant sign-in using the browser publishable Supabase key;
- Owner/Manager access enforcement using SellerTray tenant membership;
- business and active Branch context;
- business-wide 30-day dashboard from `sellertray_report_summary`;
- Branch-filtered recent Orders using shared RLS;
- ledger-derived Branch stock from `get_sellertray_branch_stock`;
- cashier shift history from `get_sellertray_cash_shift_history`;
- WhatsApp connection status;
- management navigation for reports, products/pricing, team/Branches, devices/printers and settings.

Staff accounts remain operationally focused on the mobile app rather than receiving a web management workspace.

## Local setup

Copy `.env.example` to `.env.local` and configure:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Then run:

```bash
npm install
npm run typecheck
npm run preflight
npm run dev
```

## Security boundary

Never put a Supabase service-role/secret key in this application. ProcessEdge platform-admin operations and the internal administrator notification portal are separate from Merchant Web and must not be imported into this browser bundle.
