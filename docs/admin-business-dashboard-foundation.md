# Admin convergence and ProcessEdge dashboard foundation

Approved scope: additive read-only dashboard before commercial compatibility retirement. No production deployment is part of this slice.

## Sources and definitions

- `platform_admin_business_summary(actor, days)` supports rolling 7/30/90-day periods and the immediately preceding equal period, using one database transaction timestamp. Periods are half-open `[start,end)`. It returns estate totals separately from period metrics.
- Completed, non-deleted `orders` measure merchant adoption and gross GMV by `created_at`, matching the current management-report period basis. Drafts, cancelled orders and deleted orders are excluded. GMV includes applicable tax and is before returns. Completed `sale_returns` are reported separately by their own event date. Do not interpret GMV as ProcessEdge revenue or merchant profit.
- Confirmed `sellertray_commercial_installment_payment_confirmations` measure gross installment collections by immutable `paid_at`. Checkout attempts are not cash receipts. Commercial order value measures committed purchases by `ordered_at`, not invoices issued, cash or recognised revenue. Outstanding installment principal uses obligations less confirmed payments, without aging or late-policy inference.
- All monetary output is grouped by source currency. There is no FX conversion or consolidated monetary total.
- Activations are distinct merchant first `installment.provisional_activated` events. Full entitlement release does not count as a second activation. Legacy activation/collection history is explicitly excluded rather than reconstructed from trial/runtime fields. Active usage means at least one completed order in the selected period, not a subscription status.
- `platform_admin_business_attention(actor)` returns total counts plus at most 20 deterministic merchant/signal rows. It reads completed-order activity, setup-readiness facts and entitlement events. Full entitlement release supersedes provisional expiry on the same order. Fourteen-day inactivity includes activated merchants with no completed sale. Current signals are independent of the selected historical comparison period.
- Each RPC requires a registered Platform Admin/Support actor and is executable only by service authority. The existing `platform-admin` gateway verifies the session and AAL2, supplies the verified actor, validates periods, and never accepts an actor from browser input. Both roles may read; no new mutations exist.

## Changed files

- `.agents/skills/sellertray-project-implementation/SKILL.md` — dashboard contract and approved additive sequencing.
- `.agents/skills/sellertray-project-implementation/COMMERCIAL.md` — Overview business-performance responsibility.
- `.github/workflows/admin-web-ci.yml` — regression contracts in Admin CI.
- `apps/admin-web/package.json` — test command.
- `apps/admin-web/scripts/dashboard-contract.test.mjs` — active-entry, copy, aggregate-fetch and hash-routing checks.
- `apps/admin-web/src/AdminWorkspace.tsx` — dashboard entry and merchant deep links.
- `apps/admin-web/src/BusinessDashboard.tsx` — performance, comparison, coverage and attention UI.
- `apps/admin-web/src/CommercialBillingAdministration.tsx` — business-facing commercial labels.
- `supabase/functions/platform-admin/index.ts` — authenticated dashboard read gateway.
- `supabase/migrations/20261021201432_platform_admin_business_dashboard.sql` — two read models, service-only grants and period indexes.
- `supabase/tests/platform_admin_business_dashboard.test.sql` — pgTAP authorization, range and bounding checks.
- `supabase/tests/platform-admin-business-runtime.mjs` — optional isolated PostgreSQL execution against minimal source-shaped fixtures.
- `docs/admin-business-dashboard-foundation.md` — this implementation/validation record.

## Validation and release requirements

Local checks: Admin typecheck, security preflight, four Admin regression contracts, production build; all five Database CI source contracts (financial-document tax, historical tax backfill, installment webhook, checkout and reconciliation). Isolated PGlite SQL execution covers period boundaries, lifecycle exclusion, currencies, source separation, balances, activation deduplication, entitlement supersession, readiness clearing, invalid ranges, service-only grants and bounded attention.

Optional isolated SQL reproduction: install pinned `@electric-sql/pglite@0.3.14` into a disposable directory, then run `node supabase/tests/platform-admin-business-runtime.mjs <absolute-path-to-pglite/dist/index.js>`.

Docker/Podman is unavailable locally. Full Supabase schema replay, pgTAP (including the new 10-check file), database advisors and production-sized query plans have not been run locally. Database CI remains required. Isolated fixture execution is not a replacement for those checks. Browser/manual QA is reserved for the user, including narrow layouts, period switching, Support read-only access and merchant links.

After review, release requires the additive migration, the updated `platform-admin` Edge Function and the Admin build in that order. This task does not apply migrations to a remote database, merge, or deploy.

## Remaining scope and next bounded step

The existing merchant directory/portal bootstrap still reads the legacy overview estate; this slice does not calculate dashboard KPIs from it. Replace that directory/bootstrap with governed paginated portfolio and Merchant 360 reads in the next dashboard batch. The first page of attention is intentionally bounded; counts disclose additional signals, while full signal-filtered portfolio paging remains follow-up work.

Recurring revenue/run-rate, recognised revenue, historical retention/renewals, total legacy collections and financial time-series are not claimed. Guarantee/refund operations, installment due/grace policy, catalogue/promotions and capability-level internal roles remain separate approved work. Controlled real commercial lifecycle acceptance still precedes compatibility retirement. Merchant Web acceptance/completion, Mobile QA and shared-core regression work remain parallel tracks; this dashboard does not supersede them.
