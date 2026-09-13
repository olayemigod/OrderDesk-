# SellerTray Supabase Auth email baseline

SellerTray production authentication email delivery uses the Supabase **Send Email Auth Hook** rather than Supabase's built-in SMTP/template editor.

## Production contract

- Site URL: `https://processedge.com.ng/sellertray`
- Hook endpoint: `https://eujxswjspolugrzlsjnn.supabase.co/functions/v1/send-auth-email`
- Provider: Resend
- Sending domain: `processedge.com.ng`
- Required Edge Function secrets:
  - `SEND_EMAIL_HOOK_SECRET`
  - `RESEND_API_KEY`
  - `AUTH_EMAIL_FROM`
- Canonical native redirects:
  - `sellertray://auth-confirm`
  - `sellertray://reset-password`
- Temporary compatibility redirects:
  - `orderdesk://auth-confirm`
  - `orderdesk://reset-password`

The HTML files in this directory remain the governed copy baseline for confirmation and recovery wording. The deployed `send-auth-email` Edge Function implements the live SellerTray-branded messages and signed-hook verification.

Live acceptance completed on 11 September 2026 for:
- signup confirmation delivery;
- password recovery delivery.

Native deep-link return is tested separately during signed Android preview acceptance.

Do not commit hook secrets, Resend keys, SMTP credentials, service-role keys, or test-user passwords.
