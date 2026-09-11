# SellerTray Supabase Auth email templates

These files are the source-controlled release baseline for SellerTray authentication email copy.

## Hosted Supabase deployment

The production Supabase project is hosted, so these repository files are **not** deployed automatically by a database migration.

In Supabase Dashboard:

1. Set **Authentication → URL Configuration → Site URL** to `https://processedge.com.ng/sellertray`.
2. Open **Authentication → Email Templates**.
3. Set the confirmation email subject to **Confirm your SellerTray email** and copy `confirmation.html` into the confirmation template.
4. Set the recovery email subject to **Reset your SellerTray password** and copy `recovery.html` into the recovery template.
5. Preserve Supabase's `{{ .ConfirmationURL }}` variable exactly.
6. Configure production custom SMTP before release acceptance.
7. Send a real signup-confirmation email and a real password-reset email to a controlled test account.
8. Verify the resulting links return to the installed app through:
   - `sellertray://auth-confirm`
   - `sellertray://reset-password`

The temporary `orderdesk://` redirect URLs remain allow-listed only for beta-link compatibility; new emails must originate from SellerTray flows.

Do not place SMTP credentials, service-role keys, provider secrets, or test-user passwords in these files.
