# OA2 authority repair

This repair continues PR #132 against integration `b7d10b54`. It preserves the existing runtime compatibility bridge and the informational OA1 client contract. It does not complete or deploy the entire onboarding lifecycle.

## Corrected behavior

- Merchant and Admin billing reads deny missing memberships explicitly. AAL2 remains required at the Admin gateway; named mutation capabilities remain server-enforced. Explicit capability denials now override the compatibility Admin bundle.
- Every new installment obligation captures its immutable template/policy contract, including obligations created through the existing Admin purchase flow. A disabled policy denies new obligations. Existing accepted schedules remain historical facts.
- Discounts preserve gross pricing but derive the payable percentage schedule from net due, with the final line carrying the deterministic rounding remainder. Payment allocation remains separate from discounts.
- Agreements snapshot adjusted schedule terms and merchant identity. Material adjustments make older terms insufficient for new acceptance, checkout and entitlement release. A replacement must be issued and accepted; existing acceptance command replay still returns its original committed result.
- No Branch-setup lines means setup is incomplete. Zero-payable purchases still require agreement and Branch readiness and never manufacture provider/direct-payment facts.
- OA1 Mobile status consumes canonical adjustment/direct-payment/qualifying-settlement facts while retaining its existing response contract and runtime behavior.
- Credit and checkout transitions lock the same commercial order before writing. Direct-payment facts survive recoverable reconciliation errors, which append a pending-reconciliation audit event.
- Superseded checkout attempts tell Merchant Web to retire the old command and refresh the authoritative schedule before a new explicit attempt.
- Merchant Agreements explains outdated terms; Admin can select the original agreement when issuing its replacement. Admin installment review distinguishes settled, partial and unpaid amounts.

## Verification

The complete repository migration chain and SQL test suite were executed against isolated PostgreSQL through PGlite, using upstream pgTAP. The local harness supplies Supabase auth/storage schema scaffolding and an inert cron scheduler; it does not contact production or run external delivery jobs. Hosted Supabase/CI remains the deployment acceptance authority.

Behavioral coverage includes non-member/Cashier/Support denial, authorized reads, scoped Admin denial, legacy purchase snapshot capture, direct-payment idempotency, discount schedule allocation, stale agreement rejection and replacement, immutable history, stale provider callback rejection, partial and zero settlement, zero setup scope, activation prerequisites, entitlement replay and existing C1A/C1B regression coverage.

The CI job must replay the forward migration and rerun pgTAP on the exact repair commit. Deploy the migration before dependent web/Edge code, then deploy `billing-checkout` and both web apps. Do not infer production deployment from repository or CI presence. A controlled real-merchant commercial lifecycle is still required before C2.

## Cross-surface impact

| Surface | Effect |
| --- | --- |
| Shared core | Canonical settlement, contracts, authorization, setup and reconciliation safeguards repaired. |
| Mobile | Existing OA1 status now reads direct payments, adjustments and qualifying settlement; access remains intentionally informational pending the governed preparation cutover. No layout change. |
| Merchant Web | Existing billing reads revised amounts; stale checkout commands refresh safely; outdated agreements explain replacement requirements. |
| Admin Web | Existing purchase path captures contracts, explicit denial is enforced, replacement agreement selection and settlement labels remain consistent. Admin requires AAL2; Support remains review-only absent an explicit scoped mutation grant. |
| WhatsApp | No new commercial-authoring capability. Shared runtime/access and database regressions cover compatibility; a real WhatsApp transaction was not performed. |
| AI | No new mutation tools or local arithmetic. Consumers of the canonical onboarding projection receive corrected settlement facts. |
| Reporting/audit | Gross, discount, direct payment and provider payment remain distinct; original financial/legal history is preserved. Wider business-dashboard and onboarding-funnel expansion remains separate. |
| Offline/sync | No offline financial authority introduced. Commercial changes remain online; operational compatibility and stock/payment retry contracts remain in the regression suite. |

## Remaining governed work

Keep #132 draft until exact-head CI and hosted acceptance are complete. Live multi-session contention and real provider/webhook delivery require hosted verification beyond the serialized local harness. Windows application-control policy prevents the local Vite native binding from loading; web typechecks and preflights run locally, with production builds verified by CI.

Do not merge duplicate OA1 implementations #129/#130 into this contract. Preserve secure Business-bound handoff and server-enforced preparation as an explicit forward batch. OA3 scheduling, OA4 equipment/readiness/activation convergence, OA5 notifications/reporting and controlled acceptance remain. Merchant Web, Admin Web and Mobile QA/release tracks remain active. Direct-payment corrections and the wider configurable-offer/replacement lifecycle still require their governed completion; this repair does not claim them finished.
