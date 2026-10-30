# SellerTray Intelligent 360-Degree Implementation

Status: normative universal extension of the SellerTray governing implementation skill.

## Purpose

SellerTray work must be implemented as a complete business capability, not as a local screen patch. Every agent must reason upstream, downstream and sideways before changing code and before declaring a task complete.

## Mandatory 360-degree completion gate

For every SellerTray defect, feature, refactor, migration or UX change, inspect the full applicable lifecycle:

> source of truth -> create/update -> validation -> list -> detail -> state transitions -> payment/receivable -> history -> print/export -> reporting -> returns/refunds/reversals -> reconciliation -> permissions/audit -> offline/replay -> dependent SellerTray surfaces

Not every capability uses every stage, but every stage must be considered and either implemented/verified or explicitly ruled out with a concrete reason.

A change is not complete merely because the originally named screen works. If the change necessarily alters a process contract, master data, status, amount, permission, lifecycle, or presentation that another surface consumes, close that dependent flow in the same implementation sweep in accordance with `CROSS_SURFACE.md`.

## Intelligent state reasoning

1. Distinguish business dimensions that can vary independently. For example, payment state and fulfilment state are different truths; never use `Collected` to imply `Paid`, or `Pending` to hide a confirmed partial payment.
2. Prefer derived merchant-facing state from governed facts when the storage model is more granular. Example: when confirmed allocations are greater than zero but below the invoice total, the merchant-facing payment state is **Partial** even if a lower-level workflow row is still represented internally as `pending`.
3. Preserve immutable historical facts. Never recalculate historical Branch, Cashier, price, tax, UOM, customer or payment attribution from mutable current configuration when a transaction snapshot exists.
4. Do not create a state that has no valid next action. If SellerTray permits Pay Later or Partial Payment, the same implementation must provide an authorised way to identify the debtor, see the outstanding balance, collect later money, print/reprint the appropriate document and reconcile/report the payment.
5. Reuse shared authority. Do not implement a convenient client-side mutation when an existing governed command/RPC/service owns the business action.

## Edge-value and presentation gate

Do not validate only the happy-path sample value. Test the applicable boundary classes, including:

- zero, partial, full and over-payment attempts;
- unpaid and pay-later completion;
- pending verification versus confirmed allocations;
- large monetary values such as 10,000,000 and larger supported amounts;
- long customer/product/branch names;
- narrow phone widths and supported adaptive window classes;
- empty/loading/error states;
- archived/inactive master data;
- retry/idempotent replay and degraded/offline recovery where supported.

Do not solve layout overflow by shrinking important text below the SellerTray readability contract. Reflow, wrap, constrain, stack or use adaptive layout first.

## Data and migration gate

1. Check whether the live schema contains the authority that merged application code calls; repository presence alone is not proof of deployment.
2. Check migration ordering. A migration introduced later with an older version/timestamp can be permanently skipped by a forward-only production ledger. Repair such drift with a new forward-dated convergence migration rather than pretending the old migration ran.
3. Migration repair must preserve idempotency, tenant isolation, existing data and audit history.
4. After deployment, verify both migration-ledger convergence and the actual function/table/constraint authority used by clients.

## Merchant Web navigation override — 2026-10-28

This later explicit product decision overrides the older Merchant Web navigation list in `SKILL.md` where they conflict.

1. **Money** contains merchant operational money management only: Payments & Receivables, Cash & Shifts, and Business Expenses. SellerTray platform billing must not appear under Money.
2. **Business** contains Branches, Team & Permissions, Agreements, Feedback, **Billing**, **Setup & Activation**, and **Settings**.
3. Merchant-facing platform billing is labelled **Billing**, not **SellerTray Billing**.
4. **Setup & Activation** is a separate Business navigation entry and must reuse the existing governed onboarding/setup scheduling authority; it must not be embedded inside Settings and must not create a second setup truth.
5. **Settings** remains the final Business navigation entry and preserves its existing settings tabs/configuration responsibilities.
6. This information-architecture decision applies to Merchant Web only. It does not move or rename Admin Web platform/commercial navigation.
7. Merchant-facing Billing copy should explain merchant actions and commercial state in plain language. Do not expose implementation-oriented wording about server authority, immutable settlement facts, or other internal governance mechanics when those details do not help the merchant complete the task.

## Completion report requirement

Every SellerTray completion report must state:

- the business capability corrected;
- upstream/downstream dependencies inspected;
- the cross-surface impact required by `CROSS_SURFACE.md`;
- edge values and lifecycle states tested;
- migrations/builds/deployments still required;
- any deliberately deferred lifecycle stage and why it is safe to defer.

A known dependent break must never be hidden behind the phrase “out of scope” merely because the user first reported another screen.
