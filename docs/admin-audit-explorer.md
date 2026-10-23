# Admin Audit Explorer

Stacked on PR #113 (`e1da792afd01f71d8995ce4cb128f73fff73bd61`). Audit menu only. Communications retains `action: 'audit'` and its legacy 100-row feed. No changes to commercial commands, tenant operations, stock, UOM, payment, WhatsApp, mobile or offline authority.

## Read contract

- Business uses the existing bounded Business selector with commercial portfolios and agreement management disabled on Audit only.
- Event is an exact event name; Actor is a case-insensitive email/UUID substring; Search is a literal case-insensitive substring across event, Business name/ID, actor email and JSON details. `%` and `_` are literal characters.
- From is inclusive; To is exclusive. Local datetime inputs become ISO instants. Missing bounds are unrestricted.
- Page default 50; RPC clamps page requests to 1–100. Gateway rejects malformed requests. Descending `(created_at, id)` tuple pagination preserves timestamp microseconds, including tied timestamps. Previous reuses prior cursors; Refresh returns to the newest page. Concurrent new records appear on refresh; this is not a historical database snapshot.
- Export uses the applied filters from the newest matching record, independently of the current page. The database returns at most 1,000 records and one lookahead determines truncation. The gateway additionally caps CSV serialization. UTF-8 BOM, CRLF, quoted fields and formula-prefix protection preserve safe spreadsheet import. Truncation is disclosed.
- `platform_admin_audit_explorer` is service-role-only, with an explicit Admin/Support membership check and empty search path. The gateway derives actor identity from verified credentials and requires AAL2 before dispatch. The browser never supplies the authorizing actor UUID. The existing Admin/Support read policy is preserved.
- No audit-row update/delete, trigger replacement, legacy RPC rewrite or separate audit store.

## Validation and release boundary

Local Admin build/typecheck and security preflight passed. All 25 Admin tests passed, including executable gateway parameter/CSV tests and Communications compatibility coverage. The actual migration/RPC was executed against isolated PGlite PostgreSQL fixtures: default/max/export limits, tied timestamp continuation, microseconds, Business/Event/Actor/Search/From/To, missing actor, denied role ACLs and unchanged history passed. This minimal fixture run is not a full-schema migration replay.

`supabase/tests/platform_admin_audit_explorer.test.sql` adds 20 full-schema pgTAP assertions for Database CI. Full migration replay and pgTAP require CI because Docker is unavailable locally. Authenticated browser QA and database advisors remain release gates; no production database was queried to substitute for these checks.

Manual QA: Admin and Support with MFA; denied non-platform user and AAL1; filter apply/reset; Business selection without agreement UI; >100 tied records across Next/Previous; empty/error/retry and rapid filter changes; narrow-screen labels/layout; CSV with Unicode/quotes/newlines/formulas; >1,000 export truncation; Communications publication/feed unchanged.

After stack integration and acceptance only, release ordering is additive migration, updated `platform-admin` Edge Function, Admin build. No production Supabase or Vercel deployment, merge or remote migration is authorized in this batch.

## Wider status and bounded follow-up

Admin dashboard, Merchant 360, bounded selectors, commercial portfolios and agreement lifecycle remain an unmerged draft stack. Merchant Web QA (#105) is independent. Commercial acceptance/trial-compatibility retirement, broader Merchant Web completion, mobile/device QA and shared-core/offline regression work remain separate tracks. Next bounded step is this Audit slice's exact-commit CI and authenticated browser acceptance before integrating the Admin stack in dependency order.

At inspection on 2026-10-22, #103/#106/#110 were drafts with passing GitHub checks and no submitted reviews. #106 targets #103; #110 targets #107's bounded-selector branch. #105 is a separate draft with a real database regression: `sellertray_money_expense_foundation.test.sql:193` raises `Choose an active Business Expense category`, stopping after 10 of 25 assertions. The new category test itself passes. #110/#113 also have Vercel deployment-quota failures. These observations do not establish an undocumented human reason for deferral.
