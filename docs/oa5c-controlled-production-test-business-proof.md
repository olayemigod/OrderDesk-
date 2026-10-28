# OA5C Controlled Production-Test Business Proof

OA5C is a controlled acceptance proof, not a new lifecycle state machine. It validates the governed SellerTray production path before C2 can replace the legacy Business/trial runtime.

The required lifecycle is:

> governed commercial order -> current universal Master Agreement acceptance when required -> exact Order Form confirmation -> deterministic Agreement Package evidence -> supported controlled/test settlement -> governed setup appointment -> structured setup completion -> derived Branch readiness -> entitlement reconciliation -> operational activation

## Controlled subject

Use one explicitly designated **disposable production-test SellerTray Business**, with one active Branch for the default proof.

The Business may be cleaned up, repurposed or deleted after the proof. That does **not** make the lifecycle synthetic. The proof must still use the same production authority and governed commands that a merchant uses.

Do not satisfy OA5C with:

- direct database insertion of agreement acceptance, Order Form confirmation or payment truth;
- fabricated provider events;
- QA-only adjustment records standing in for settlement;
- fabricated setup, readiness or entitlement facts;
- direct entitlement mutation;
- manually edited subscription periods;
- merchant-specific legal agreements outside the universal Master Agreement + Order Form model.

Do not commit the controlled Business UUID, merchant credentials/PII, payment references, agreement acceptance evidence, device serials or handover evidence to the repository.

## Agreement Package proof

For the exact commercial order, OA5C requires all of the following:

1. the current platform-wide SellerTray Master Agreement version is effective;
2. the Business has accepted that Master Agreement version when acceptance is required;
3. exactly one current unsuperseded Order Form exists for the controlled order;
4. the Order Form was instantiated from the exact immutable template version explicitly authorized for **production** merchant use through the governed Admin publication boundary;
5. QA/fixture template versions remain historical/test evidence only and are never eligible for production Order Form resolution or Agreement Package creation;
6. the Agreement Package binds that exact Master version and Order Form;
7. Master hash, Order Form template hash, Order Form hash, commercial-snapshot hash, manifest and package fingerprint reconcile deterministically;
8. an authorised Owner/Manager confirmed the exact Order Form through the authenticated Merchant Web flow;
9. confirmation evidence binds the exact package fingerprint and command;
10. a later order under an unchanged Master does not create a second Master acceptance; only the new Order Form is confirmed.

The technical family keys `subscription_order` and `installment_agreement` are compatibility selectors used to resolve the applicable Order Form shape. They are not separate merchant legal authorities. Production eligibility comes from explicit immutable publication authority on the exact template version, never from the family key or a production-looking title.

## Automated proof

Run the service-role-only canonical function:

`platform_admin_verify_oa5c_production_test_business_proof(actor_user_id, tenant_id, commercial_order_id)`

The older `platform_admin_verify_oa5c_real_merchant_proof(...)` function is retained only as OA5C v2 compatibility tooling and historical evidence. Do not use it as the final OA5C acceptance verifier.

The v3 verifier is read-only and must fail closed unless all of the following are true:

- the commercial order is the current governed order for the Business;
- exactly one active Branch is in the controlled proof;
- commercial price lines resolve to governed price versions, include complete tax snapshots and reconcile to order gross;
- current universal Master acceptance is valid;
- exact current Order Form originates from a production-authorized immutable template version of the correct compatibility family;
- exact current Order Form, Agreement Package, manifest/fingerprint and authenticated confirmation are valid;
- at least one positive immutable provider/direct payment confirmation exists; adjustment-only settlement is insufficient;
- the selected Branch has one setup obligation and a governed completed appointment;
- the completion event belongs to that exact appointment and carries valid OA4 structured completion/equipment/handover evidence;
- Branch readiness has the same command/actor, exact appointment completion time and exact derived evidence envelope used by the governed completion command;
- a governed provisional/full entitlement event exists with a valid plan and effective period;
- the pre-C2 `tenant_subscriptions` compatibility runtime is active and matches that entitlement plan and period exactly;
- runtime write access is active;
- OA5A lifecycle notifications trace the applicable order/agreement/payment/setup/entitlement facts;
- OA5B Admin reporting agrees with shared onboarding/activation state;
- privileged setup/reconciliation audit and replay/idempotency evidence are present;
- immutable-history and uniqueness contracts are intact.

The verifier always returns `oa5cAccepted=false`. Automated evidence cannot perform the merchant's authenticated agreement action, independently establish the external/provider reality of a payment, provide a merchant representative acknowledgement, or observe human Merchant Web/Mobile sessions.

## Merchant-side actions

Only actions that genuinely belong to the merchant/payment side should be performed manually during the controlled proof:

1. **Agreement:** sign in to the disposable merchant account and use **Accept & Continue** when the v0.9 Master Agreement still requires acceptance, then confirm the exact Order Form. When the same Master is already accepted, the surface should require only **Confirm Purchase** for the new Order Form.
2. **Payment:** complete checkout through the supported live payment flow using a genuine controlled payment. For the current OA5C live-gateway proof, the governed order total must be **₦1,000 or less**. Do not insert or manufacture a payment directly in the database.
3. **Setup acknowledgement:** when the structured setup/handover workflow requires merchant representative acknowledgement, provide it through the governed surface.

Commercial-order verification, Admin setup scheduling/completion, readiness derivation, entitlement reconciliation, notification checks, Merchant Web/Mobile parity, replay/idempotency checks and the final verifier are technical/governance responsibilities and do not require merchant fabrication.

## Manual acceptance proof

After every automated gate passes, record outside the repository that:

1. the subject was the designated disposable production-test Business;
2. the Master Agreement/Order Form actions were performed by the authorised merchant representative through the authenticated surface;
3. payment confirmation corresponds to the supported controlled live payment flow, the proof order did not exceed ₦1,000, and payment was not direct database insertion;
4. structured setup/equipment/handover evidence and any merchant acknowledgement match the immutable completion evidence;
5. Merchant Web shows the same commercial/agreement/setup/activation outcome;
6. Mobile shows the same activation/runtime outcome and governed lifecycle notices;
7. WhatsApp and AI remain consumers only and did not create lifecycle truth;
8. offline selling remains server-gated by the governed entitlement/runtime authority;
9. the governed reconciliation command was repeated and produced no duplicate entitlement or compatibility-runtime effect.

## Stop conditions

Stop OA5C and report the blocker if:

- no approved/effective universal SellerTray Master Agreement is published;
- no production-authorized Order Form template exists for the required compatibility family;
- a current Order Form was sourced from a QA/non-production template version;
- current Master acceptance is required but absent;
- the exact current Order Form is absent, superseded or not confirmed through the authenticated merchant flow;
- Agreement Package hashes, manifest or fingerprint do not reconcile;
- the selected Business is not explicitly designated for the controlled production-test proof;
- the only available live-gateway proof order would exceed ₦1,000;
- payment provenance cannot be established through the supported flow;
- setup completion/equipment/handover evidence is incomplete;
- required merchant representative acknowledgement is absent;
- readiness is not the exact derived completion fact;
- entitlement and legacy runtime plan/period disagree;
- cross-surface state disagrees;
- replay creates a duplicate business effect.

Never manufacture evidence to clear a gate.

## Current convergence boundary — 2026-10-28

OA5A and OA5B remain accepted. OA5C is the active gate before C2. The approved proof subject is a disposable production-test Business using the genuine production path. The v0.9 universal Master Agreement and exact Order Form/Agreement Package architecture are the governing legal model. ProcessEdge has approved proceeding with v0.9 without waiting for external counsel review; any later material legal change must be a new immutable Master version rather than an in-place rewrite.

Production Order Forms must resolve only from explicitly production-authorized immutable template versions. Historical QA templates remain preserved and readable but are not eligible for production lifecycle use.

Technical work may continue through verifier convergence, regression and deployment without merchant action. Stop only when the first genuine merchant-side action is required, then provide the exact action and expected result.
