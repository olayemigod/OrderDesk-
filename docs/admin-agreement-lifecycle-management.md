# Admin Agreement Lifecycle Management

## Boundary

This slice follows the governed commercial portfolio foundation and adds ongoing agreement administration for a selected SellerTray Business.

It does not create a new agreement engine. It exposes the existing C1A replacement/supersession authority in Admin Web so an immutable issued agreement can be corrected or replaced without editing historical evidence.

## Behaviour

The selected-Business Billing & Commercial workflow now shows an **Agreement lifecycle** panel with:

- current and replaced merchant-specific agreements;
- agreement family, template version and commercial order subject;
- immutable issue time and content hash evidence;
- merchant acceptance name, role and acceptance time when present;
- explicit current/replaced lifecycle state;
- Platform Support read-only review;
- Platform Admin-only **Prepare replacement** action for a current agreement.

A replacement:

1. keeps the existing agreement and any acceptance immutable;
2. uses an already-published effective template from the same agreement family;
3. reuses the same governed commercial order and, for installment agreements, the same installment obligation;
4. supplies the prior agreement ID as `supersedesAgreementId` to the existing `admin_issue` path;
5. requires a new immutable agreement reference, rendered content and Admin reason;
6. becomes the current agreement only through the existing C1A supersession model;
7. requires fresh merchant acceptance before the replacement can satisfy the governed agreement-acceptance prerequisite.

The database already rejects replacement attempts that change the original commercial subject, replace an agreement twice, or create a competing current agreement without explicit supersession.

## Authority preserved

The implementation continues to use:

- `commercial-agreements` for authenticated Admin commercial actions;
- `get_sellertray_commercial_agreement_admin` for agreement/template review;
- `issue_sellertray_commercial_agreement_admin` for issuance;
- immutable `sellertray_commercial_agreements` history;
- immutable `sellertray_commercial_agreement_acceptances` evidence;
- the existing C1B current non-superseded acceptance predicate for installment activation.

The browser does not write agreement tables directly and does not perform merchant acceptance on behalf of the merchant.

## Explicit exclusions

This slice does not introduce or infer:

- installment due dates, grace or aging policy;
- guarantee approval/refund policy;
- refund amount or payment reversal authority;
- promotion or negotiated-pricing policy;
- entitlement or subscription expiry mutation;
- legacy trial retirement;
- new legal wording.

Legal/template content must already be explicitly authored and published through the governed template workflow.

## Files

- `apps/admin-web/src/AgreementLifecycleManagement.tsx`
- `apps/admin-web/src/MerchantSelector.tsx`
- `apps/admin-web/scripts/agreement-lifecycle-contract.test.mjs`
- `docs/admin-agreement-lifecycle-management.md`

No database migration or Edge Function change is required because explicit supersession is already supported by C1A and the current `commercial-agreements` Admin gateway.

## QA

Automated Admin contracts should verify:

- lifecycle appears only for a selected single-Business workflow;
- replacement uses `admin_issue` with `supersedesAgreementId`;
- the original commercial order/installment subject is reused;
- replacement templates are restricted to the same agreement family and must already be effective;
- Support cannot issue a replacement;
- the browser performs no direct agreement-table write and no merchant acceptance mutation.

Manual browser QA should verify:

- current/replaced and accepted/awaiting-acceptance states render clearly;
- selecting a current agreement prepares only same-family effective templates;
- issuing a replacement leaves the old agreement visible as immutable history;
- the new agreement appears current and awaiting acceptance until the merchant accepts it;
- replacing an installment agreement causes downstream current-agreement acceptance to fail closed until re-acceptance;
- Support remains review-only.

## Next bounded Admin step

After this agreement-lifecycle slice is validated, the next safe Admin phase is deeper platform audit/search/export or broader platform-service health. Guarantee/refund operations and promotion management should wait for their dedicated governed policy/authority rather than being inferred in Admin UI.
