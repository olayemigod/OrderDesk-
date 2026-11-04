# Admin Audit Explorer

SellerTray Admin Governance → Audit Log uses a bounded server-backed historical explorer. It does not reconstruct the audit estate in browser memory and it does not create a second audit store.

## Read contract

- The explorer is read-only and uses the existing `platform_admin_audit` records.
- The Admin transport requires an authenticated ProcessEdge platform identity at MFA/AAL2 before dispatch.
- The database RPC is `SECURITY DEFINER`, uses an empty search path, verifies current Platform Admin/Platform Support membership, and is executable only by `service_role`.
- Business accepts a literal case-insensitive Business name or Business UUID substring. It reads retained tenant rows directly rather than using the active Merchant selector, so historical evidence remains searchable after Business retirement.
- Retired Businesses remain excluded from active merchant/onboarding/operations selectors and read models. Audit history does not reactivate or restore them operationally.
- Event is an exact event name. Actor is a case-insensitive email/UUID substring. Search is a literal case-insensitive substring across event, Business name/ID, actor email/ID and JSON details. `%` and `_` are treated literally.
- From is inclusive; To is exclusive. Local Admin datetime inputs are converted to ISO instants before dispatch.
- Page default is 50. The RPC clamps interactive pages to 100 and uses descending `(created_at, id)` keyset pagination so tied timestamps do not duplicate or skip rows.
- CSV export starts from the newest matching event, applies the same filters, and is capped at 1,000 rows with truncation disclosure. CSV cells are quoted and spreadsheet-formula prefixes are neutralised.
- The legacy `action: 'audit'` feed remains in `platform-admin` because Communications Campaign History still consumes that bounded recent-event feed. Governance → Audit Log alone uses the explorer.

## Retirement and evidence boundary

Business retirement preserves historical tenant, commercial, legal and Admin audit evidence. Audit Explorer therefore intentionally uses a `LEFT JOIN` to retained `tenants` and does not apply `retired_at is null`. This is a historical evidence rule only; active SellerTray operating surfaces continue to apply their retirement filters.

## Release and QA

The forward migration is `20261101063000_platform_admin_audit_explorer_convergence.sql`. Database CI must prove service-only grants, bounded limits, keyset pagination, literal search, date bounds and discoverability of retired-Business history. Admin CI must prove the Governance route uses the explorer, Communications retains the legacy feed, AAL2 precedes explorer dispatch and CSV formula protection remains intact.

Authenticated browser acceptance of the exact Admin candidate is still required by `ADMIN_VISUAL_DESIGN.md`; successful typecheck/build/CI alone is not visual acceptance.
