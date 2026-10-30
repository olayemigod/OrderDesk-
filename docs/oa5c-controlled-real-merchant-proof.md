# OA5C Controlled Production-Test Business Proof

OA5C is a controlled acceptance proof, not a new lifecycle state machine. It validates the genuine governed production path before C2 can replace the legacy Business/trial runtime.

The required lifecycle is:

> current universal Master Agreement acceptance -> choose plan and create the governed purchase -> exact purchase-specific Order Form and Agreement Package confirmation -> genuine confirmed settlement -> governed setup appointment -> structured setup completion -> derived Branch readiness -> entitlement reconciliation -> operational activation

## Controlled subject

Use one explicitly designated **disposable production-test SellerTray Business** with one active Branch for the default proof. The Business may be discarded after controlled acceptance, but every lifecycle fact must still be produced by the real production path.

Do not use synthetic payment, fabricated setup/readiness, direct entitlement mutation, manually edited subscription periods, a QA-only agreement, or direct database insertion to manufacture evidence.

Do not commit the controlled Business UUID, merchant PII, payment references, agreement content, device serials or handover evidence to the repository.

## Automated proof

Run the service-role-only function:

`platform_admin_verify_oa5c_production_test_business_proof(actor_user_id, tenant_id, commercial_order_id)`

The verifier is read-only. It composes the earlier OA5C lifecycle gates and must additionally fail closed unless the exact current Order Form, deterministic Agreement Package and merchant confirmation are valid for the exact commercial order.

At minimum the proof requires:

- the commercial order is the current governed order for the Business;
- exactly one active Branch is in the controlled proof;
- commercial price lines resolve to governed price versions, contain complete tax snapshots and reconcile to order gross;
- the current platform-wide Master Agreement exists and the Business accepted that exact version through the authorised merchant path;
- exactly one current unsuperseded Order Form applies to the exact commercial order;
- the Order Form comes from production-authorised template authority and its immutable commercial snapshot/content hashes are valid;
- the deterministic Agreement Package binds the exact Master version/hash, Order Form/hash and commercial snapshot hash;
- the merchant confirmed that exact package fingerprint/Order Form through the governed merchant action with explicit authority evidence;
- at least one positive immutable provider/direct payment confirmation exists; adjustment-only settlement is insufficient;
- the selected Branch has the required governed setup obligation and completed appointment;
- completion belongs to that exact appointment and carries valid OA4 structured completion/equipment/handover evidence;
- Branch readiness is derived from that completion fact rather than manually invented;
- entitlement and compatibility-runtime outcome match the governed order and activation event;
- lifecycle notification/reporting evidence and privileged Admin audit evidence exist;
- replay does not duplicate entitlement, payment, setup or compatibility-runtime effects.

The older `platform_admin_verify_oa5c_real_merchant_proof(...)` remains historical compatibility evidence. It is not the active OA5C acceptance entrypoint because it predates the purchase-specific Order Form/Agreement Package confirmation contract.

## Manual cross-surface proof

After the automated verifier passes, capture evidence that:

1. Merchant Web shows the same Master acceptance, subscription order, Order Form confirmation, payment, setup and activation outcome;
2. Admin shows the same commercial, legal, settlement, setup/readiness, activation, notification/reporting and audit facts;
3. Mobile shows the same Business/Branch activation outcome and governed lifecycle notices;
4. the activated Branch can enter the approved operational flow without a hidden legacy/trial bypass;
5. the exact reviewed/executed agreement package remains accessible and fingerprint-bound;
6. the reconciliation command can be repeated without a duplicate entitlement or compatibility-runtime effect.

## Stop conditions

Stop OA5C and report the blocker if:

- no approved/effective universal SellerTray Master Agreement is published;
- merchant acceptance of the current Master Agreement is absent;
- no current production-authorised Order Form is issued for the exact purchase;
- the exact Order Form/Agreement Package confirmation is absent or its fingerprint/hash chain does not reconcile;
- the selected Business is not explicitly designated as the disposable production-test subject;
- payment provenance cannot be independently established;
- setup completion/equipment/handover evidence is incomplete;
- readiness is not the exact derived completion fact;
- entitlement and compatibility runtime plan/period disagree;
- cross-surface state disagrees;
- replay creates a duplicate business effect.

Never manufacture evidence to clear a gate.

## Current source/release preflight — 2026-10-30

OA5A and OA5B are accepted. Build 43 converged the pre-purchase Master Agreement flow so the merchant accepts the current Master before choosing the first plan/purchase, while purchase-specific Order Form/Agreement Package confirmation remains the exact post-purchase legal evidence.

The repository must retain the merged Agreement Package clean-schema migration chain and the v3 production-test Business verifier so a fresh deployment reproduces the same authority already present in production. Database CI must replay that chain from an empty schema and run the full pgTAP suite before this source recovery is accepted.

OA5C itself remains **not accepted** until the designated disposable production-test Business completes the genuine lifecycle, the v3 verifier passes, and the manual cross-surface/replay evidence is accepted. C2 must not begin before that acceptance unless the user explicitly changes the gate.
