# SellerTray Data Lifecycle and Recovery Contract

Status: S11C pilot baseline.

## Scope

SellerTray stores merchant workspace data needed to receive, review, fulfil and audit WhatsApp orders. Customers stay on WhatsApp; merchants use the SellerTray application.

## Merchant export

- A business Owner can export the complete self-service workspace dataset from Business Settings.
- The export is JSON and includes business profile, catalogue, customers, inbound messages, orders and lines, order status history, outbound notification history, team records, subscription state, merchant payment methods, payment attempts/events and financial-document records.
- Checkout authorization URLs and internal payment-event payload hashes are excluded from the export. Gateway secret credentials and reusable billing authorizations are never included.
- Self-service export is bounded to 5,000 rows per collection. Larger exports require ProcessEdge support so the service does not silently truncate data.

## Account deletion

- Every authenticated user has an in-app account-deletion path, including users who currently have no workspace.
- Deletion requires the current password and the exact confirmation phrase `DELETE MY SELLERTRAY ACCOUNT`.
- A normal merchant account deletion first archives the minimum non-chat financial audit fields required by the retention contract, removes cached order receipts and invoice/payment-receipt PDFs from the private `receipts` bucket through the Storage API, deletes businesses where the user is Owner and their remaining tenant-scoped operational records, removes remaining memberships/invitations and checkout-session records, then deletes the Supabase Auth user.
- Tenant-specific billing-provider event rows and ProcessEdge tenant audit rows are deleted before an Owner tenant is deleted so they do not retain an indirect copy of tenant data.
- Account deletion is blocked when an owned tenant still has an active provider subscription. The subscription must be cancelled first.
- ProcessEdge platform-administrator identities and identities with platform-administration audit history require controlled internal offboarding.
- Storage cleanup is bounded. More than 5,000 referenced SellerTray receipt/financial PDF objects for an owned workspace requires ProcessEdge-assisted deletion rather than silent truncation.

## Access-token window

Deleting the Supabase Auth user removes refresh sessions, but an already-issued access JWT can remain cryptographically valid until its expiry. SellerTray deletes owned tenants and remaining membership records before deleting Auth so the stale token no longer has tenant authorization. Sensitive server actions continue to require tenant membership or platform-admin state.

## Retention baseline

For the MVP pilot:
- Active merchant operational data is retained while the workspace exists.
- Merchant-created workspace data is deleted when the owning account is deleted through the governed path.
- Before workspace deletion, SellerTray retains a minimal server-only financial audit record for six years from the underlying document/payment date. The archive excludes customer profile data, WhatsApp content, catalogue content, delivery information and PDF files. It retains only business/order/financial references, amounts/currency, provider references, payment/document states and timestamps needed for financial audit/reconciliation.
- The six-year baseline follows Nigerian financial/tax record-keeping practice. The legal/privacy documents must disclose this retention and can be revised if applicable law requires a different period.
- No separate long-term analytics copy of customer message content is created by SellerTray.
- Edge Function observability must not log request bodies, customer WhatsApp message text, passwords, authorization headers or query strings.
- Infrastructure backups can temporarily contain data deleted from the live database until the provider backup lifecycle expires. They are for disaster recovery, not ordinary application access.

## Backup and recovery

Supabase provides daily database backups for projects; Point-in-Time Recovery is an optional higher-frequency recovery capability. SellerTray also keeps all schema changes in versioned migrations.

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

Google Play requires an external web resource in addition to the in-app deletion path for apps that support account creation. The public deletion resource is live at `https://sellertray.vercel.app/account-deletion` with `https://processedge.com.ng/orderdesk/account-deletion` retained as a beta-name alias. The canonical SellerTray URL must be entered in Play Console before production release.


## Mobile device backup boundary

SellerTray 1.0.0 explicitly sets Expo `android.allowBackup = false`. Android must not automatically back up or restore SellerTray application-local data through Google Drive/device backup. This reduces the chance that persisted authenticated session material or other app-local state survives through an OS backup/restore path outside SellerTray's governed account/data lifecycle.

This setting does not replace server-side export, retention or disaster-recovery controls. Business-data export remains an explicit Owner action, while server infrastructure backup/recovery is governed separately.


## AI parser cost telemetry

SellerTray stores a bounded server-only record for each attempted external AI parse so ProcessEdge can validate real unit economics before commercial pricing is activated.

Stored fields are limited to:
- tenant and source-message identifiers;
- provider/model identifier;
- outcome and provider HTTP status;
- input, cached-input, output, reasoning and total token counts;
- total catalogue size plus catalogue item/alias counts sent to the parser;
- timestamp.

SellerTray does **not** store the customer message, catalogue payload, prompt, model response, authorization data or provider error body in this telemetry table.

Controls:
- `ai_parser_attempts` has RLS enabled and no direct anon/authenticated table privileges.
- Only server-side service-role paths can write/read the table operationally.
- The composite tenant/source-message foreign key prevents cross-tenant linkage.
- One OpenAI attempt row is retained per source message/provider, so webhook retries do not duplicate cost records.
- Deleting the source inbound message or tenant cascades the telemetry row.
- Owner business export includes these non-content telemetry records.
- ProcessEdge Admin sees period aggregates/token totals, not customer text.
- Cached-input counts are recorded separately from total input so AI cost estimates can apply the provider's discounted cache-read rate accurately.
