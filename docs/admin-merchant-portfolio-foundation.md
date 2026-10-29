# Admin merchant portfolio and Merchant 360 foundation

This bounded slice follows the ProcessEdge Business Dashboard foundation. It replaces the active Merchants page's browser-side search and filtering with service-authorized database read models. No production deployment is part of this slice.

## Read model contract

- `platform_admin_merchant_portfolio(actor, search, filter, after_name, after_id, limit)` provides deterministic keyset pagination by normalized business name and tenant ID. The server applies search and the `all`, `attention`, `connected`, and `restricted` filters before returning at most 50 rows.
- Portfolio attention is deterministic and based on existing facts: WhatsApp error state, governed access state, commercial status, orders requiring review, and notification delivery exceptions. It introduces no new workflow or policy.
- `platform_admin_merchant_detail(actor, tenant)` supplies a read-only Merchant 360 view: identity, plan/access context, activation facts, branches, team counts, recent platform activity, support context, 30-day sales adoption, and governed commercial readiness counts.
- Completed, non-deleted orders measure merchant order activity and gross merchant GMV using `orders.created_at`. Draft, cancelled, and deleted orders are excluded. GMV includes applicable tax and is before returns. Recorded paid value and outstanding order value are shown only within merchant performance; they are not ProcessEdge revenue or commercial installment collections.
- Money remains partitioned by order currency. There is no FX conversion, profit, refund/guarantee exposure, installment aging, or due/grace inference.
- Commercial readiness counts are read from existing commercial orders, issued/accepted agreements, immutable order snapshots, and Branch setup readiness facts. Merchant 360 does not create another commercial or entitlement authority.
- Both RPCs require a registered ProcessEdge Admin or Support actor and are executable only by service authority. The `platform-admin` gateway verifies the user and AAL2, supplies the actor, validates the cursor and page size, and never accepts an actor from browser input.

## User flow

- Merchants opens a server-paginated portfolio rather than filtering `overview.tenants` in the browser.
- Search is debounced and resets the cursor. Previous/Next navigation uses opaque business-name and tenant-ID cursor values returned by the server.
- Selecting a row opens Merchant 360 with Summary, Commercial, and Support & activity views.
- The Commercial view deep-links to Billing & Commercial with the same merchant preselected. It remains read-only until the user enters the existing governed commercial actions.
- Legacy trial values render as compatibility data rather than as a current offer. Internal implementation phase names remain absent from active Admin copy.

## Changed files

- `apps/admin-web/scripts/dashboard-contract.test.mjs` — routes dashboard merchant attention into the new portfolio.
- `apps/admin-web/scripts/merchant-portfolio-contract.test.mjs` — pagination, server-read, drill-down, gateway, and money-scope contracts.
- `apps/admin-web/src/AdminWorkspace.tsx` — active portfolio entry and Billing merchant selection.
- `apps/admin-web/src/CommercialBillingAdministration.tsx` — accepts a validated initial merchant from the drill-down.
- `apps/admin-web/src/MerchantPortfolio.tsx` — paginated portfolio and Merchant 360 UI.
- `apps/admin-web/src/admin-workspace.css` — portfolio pagination, accessible row focus, tabs, responsive drawer, and detail layouts.
- `supabase/functions/platform-admin/index.ts` — validated portfolio/detail actions and RPC dispatch.
- `supabase/migrations/20261021215930_platform_admin_merchant_portfolio.sql` — service-only portfolio and detail read models plus supporting indexes.
- `supabase/tests/platform_admin_merchant_portfolio.test.sql` — pgTAP authorization, validation, bounding, and read checks.
- `supabase/tests/platform-admin-merchant-runtime.mjs` — optional isolated PostgreSQL execution against source-shaped fixtures.

## Validation and release requirements

Local verification covers Admin unit contracts, TypeScript, security preflight, production build, and isolated PostgreSQL execution of the actual migration functions. The isolated database fixture checks actor denial, service-only grants, page bounds, keyset continuity, filters, currency separation, order exclusions, activation, support activity, and missing merchants.

Docker/Podman and a local Supabase CLI are unavailable. Full migration replay, pgTAP, database advisors, and production-sized query plans remain Database CI requirements. Browser/manual QA is reserved for the user, including narrow layouts, keyboard navigation, search/paging, Support access, and the Billing deep-link.

Release order after review is the additive migration, the updated `platform-admin` Edge Function, and then the Admin build. This task does not apply remote migrations, merge, or deploy.

## Remaining scope

The follow-on bounded estate convergence replaces the active Admin bootstrap and the Billing, Communications, and Operations consumers described here. See `docs/admin-bounded-estate-convergence.md`. The legacy overview remains only for unreachable compatibility code and older mutation responses pending controlled retirement.

Portfolio search currently performs a bounded-result scan across merchant identity and status fields. Before the estate becomes large, validate production query plans and introduce governed indexed search if needed. Audit filtering/export, ongoing agreement administration, installment portfolio operations, guarantees/refunds, and controlled compatibility retirement remain later bounded phases.
