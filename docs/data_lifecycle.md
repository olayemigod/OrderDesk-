# OrderDesk Data Lifecycle and Recovery Contract

Status: S11C pilot baseline.

## Scope

OrderDesk stores merchant workspace data needed to receive, review, fulfil and audit WhatsApp orders. Customers stay on WhatsApp; merchants use the OrderDesk application.

## Merchant export

- A business Owner can export the complete self-service workspace dataset from Business Settings.
- The export is JSON and includes business profile, catalogue, customers, inbound messages, orders and lines, order status history, outbound notification history, team records and subscription state.
- Checkout authorization URLs are excluded from the export.
- Self-service export is bounded to 5,000 rows per collection. Larger exports require ProcessEdge support so the service does not silently truncate data.

## Account deletion

- Every authenticated user has an in-app account-deletion path, including users who currently have no workspace.
- Deletion requires the current password and the exact confirmation phrase `DELETE MY ORDERDESK ACCOUNT`.
- A normal merchant account deletion removes user-owned Storage files through the Storage API, deletes businesses where the user is Owner and their tenant-scoped operational records, removes remaining team memberships/invitations and checkout-session records, then deletes the Supabase Auth user.
- Tenant-specific billing-provider event rows and ProcessEdge tenant audit rows are deleted before an Owner tenant is deleted so they do not retain an indirect copy of tenant data.
- Account deletion is blocked when an owned tenant still has an active provider subscription. The subscription must be cancelled first.
- ProcessEdge platform-administrator identities and identities with platform-administration audit history require controlled internal offboarding.
- More than 100 user-owned Storage objects requires ProcessEdge-assisted deletion so files are removed through the Storage API rather than orphaned through SQL metadata deletion.

## Access-token window

Deleting the Supabase Auth user removes refresh sessions, but an already-issued access JWT can remain cryptographically valid until its expiry. OrderDesk deletes owned tenants and remaining membership records before deleting Auth so the stale token no longer has tenant authorization. Sensitive server actions continue to require tenant membership or platform-admin state.

## Retention baseline

For the MVP pilot:
- Active merchant operational data is retained while the workspace exists.
- Merchant-created workspace data is deleted when the owning account is deleted through the governed path.
- No separate long-term analytics copy of customer message content is created by OrderDesk.
- Edge Function observability must not log request bodies, customer WhatsApp message text, passwords, authorization headers or query strings.
- Infrastructure backups can temporarily contain data deleted from the live database until the provider backup lifecycle expires. They are for disaster recovery, not ordinary application access.

## Backup and recovery

Supabase provides daily database backups for projects; Point-in-Time Recovery is an optional higher-frequency recovery capability. OrderDesk also keeps all schema changes in versioned migrations.

Pilot recovery procedure:
1. Confirm incident scope and stop affected writes when necessary.
2. Preserve the current migration commit and incident request IDs/log evidence.
3. Restore the Supabase database using the provider backup/restore path or the documented CLI dump/restore procedure.
4. Reapply any repository migrations newer than the restored snapshot.
5. Reconfigure/deploy Edge Functions and server secrets from the controlled environment.
6. Validate Auth, tenant isolation, one test order, order state transition, notification queue and subscription access before reopening merchant writes.
7. Record the incident and recovery checkpoint.

A destructive restore must never be initiated merely to correct a single merchant record when a narrower data repair is possible.

## External deletion resource

Google Play requires an external web resource in addition to the in-app deletion path for apps that support account creation. The public deletion resource is live at `https://processedge.com.ng/sellertray/account-deletion` with `https://processedge.com.ng/orderdesk/account-deletion` retained as a beta-name alias. The canonical SellerTray URL must be entered in Play Console before production release.
