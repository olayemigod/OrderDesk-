# Admin Commercial Portfolio Foundation

## Boundary

This slice continues the ProcessEdge SellerTray Admin roadmap after the Business Dashboard, Merchant Portfolio / Merchant 360, and bounded Admin-estate work.

It adds read-only cross-merchant operational queues for:

- installment collection progress; and
- commercial agreement acceptance / replacement state.

The queues consume existing SellerTray commercial authority. They do not create a second payment, agreement, entitlement, subscription or merchant authority.

## Authority used

Installment portfolio facts come from the existing immutable commercial order, installment obligation and schedule tables plus provider-confirmed installment payment records, Branch setup readiness, accepted installment agreements and append-only entitlement events.

Agreement portfolio facts come from immutable merchant-specific agreements, versioned templates, immutable acceptance evidence and explicit supersession history.

The Admin read projections are service-only RPCs. Browser access goes through `platform-admin-commercial`, which verifies the authenticated user and requires AAL2 before invoking the service-authority projection.

## Product behaviour

Billing & Commercial now exposes a Commercial portfolio before the merchant selector in its single-Business workflow.

### Installment queue

Supported filters:

- Open
- Awaiting first payment
- In progress
- Settled
- All

Each row preserves its own currency and shows only confirmed payment progress. `Open`, `Awaiting first payment`, `In progress`, and `Settled` are derived strictly from the immutable installment schedule and confirmed payment count; they are not due-state or collections-aging policy.

Rows show the governed purchase reference, plan where available, approved installment structure, obligated amount, confirmed amount, remaining amount, next unpaid installment amount, agreement acceptance, Branch setup-readiness count, and entitlement state.

### Agreement queue

Supported filters:

- Awaiting acceptance
- Accepted
- Replaced
- All

Rows show Business, order, agreement family/title/reference, template version, issuance time and immutable acceptance evidence when present.

### Drill-down

`Open Business` resolves the selected merchant through the existing governed Merchant 360 read and hands the merchant back to the existing Billing & Commercial single-Business workflow. All mutations remain there. The portfolio itself performs no commercial mutation.

## Explicit exclusions

This slice does not infer or implement:

- installment due dates;
- overdue / past-due classification;
- grace duration or suspension policy;
- installment aging buckets;
- recognised revenue;
- profit or margin;
- foreign-exchange conversion or cross-currency aggregation;
- guarantee/refund exposure or refund operations;
- promotions;
- legacy-trial retirement.

Those require their own governed authority or later approved roadmap slice.

## Files

- `apps/admin-web/src/CommercialPortfolio.tsx`
- `apps/admin-web/src/MerchantSelector.tsx`
- `apps/admin-web/scripts/commercial-portfolio-contract.test.mjs`
- `supabase/functions/platform-admin-commercial/index.ts`
- `supabase/migrations/20261022093000_platform_admin_commercial_portfolios.sql`
- `supabase/tests/platform_admin_commercial_portfolios.test.sql`
- `docs/admin-commercial-portfolio-foundation.md`

## Release order

1. Apply the additive database migration.
2. Deploy `platform-admin-commercial`.
3. Deploy the Admin Web build.
4. Run browser QA using a Platform Admin and Platform Support account.

No production migration or deployment is part of this implementation branch.

## Manual QA

Verify at minimum:

- Billing & Commercial loads both portfolio tabs before selecting a Business;
- search and each queue filter return bounded server results;
- next / previous pagination preserves the active search and filter;
- currencies remain separate per row;
- no due, grace, overdue or aging claim appears;
- `Open Business` loads the existing merchant commercial workflow;
- Platform Support can read queues but remains unable to perform merchant commercial mutations;
- an AAL1 request to the new Admin gateway is rejected;
- existing Communications multi-select merchant selection does not render the commercial portfolio.
