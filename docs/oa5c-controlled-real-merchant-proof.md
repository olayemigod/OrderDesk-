# OA5C Controlled Proof — Legacy Document Path

This filename is retained only so older PRs, discussions and audit references remain resolvable.

The phrase **“real merchant”** is no longer the approved OA5C proof model. The controlled subject is a **disposable production-test SellerTray Business** that must traverse the genuine governed production path without fabricated lifecycle facts.

The active OA5C proof specification is:

`docs/oa5c-controlled-production-test-business-proof.md`

The canonical read-only verifier is:

`platform_admin_verify_oa5c_production_test_business_proof(actor_user_id, tenant_id, commercial_order_id)`

The older `platform_admin_verify_oa5c_real_merchant_proof(...)` function remains only as v2 compatibility tooling used by the v3 verifier for previously governed lifecycle gates. It must not be treated as the final OA5C acceptance entrypoint.
