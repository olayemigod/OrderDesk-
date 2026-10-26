# OA5C Controlled Real-Merchant Proof

OA5C is a controlled acceptance proof, not a new lifecycle state machine. It validates the existing governed path before C2 can replace the legacy Business/trial runtime.

The required lifecycle is:

> governed commercial order -> current universal Master Agreement acceptance -> genuine confirmed settlement -> governed setup appointment -> structured setup completion -> derived Branch readiness -> entitlement reconciliation -> operational activation

## Controlled subject

Use one explicitly designated real SellerTray Business, with one active Branch for the default proof. Do not use a QA-only Business, synthetic payment, fabricated setup/readiness, direct entitlement mutation, manually edited subscription period, or merchant-specific legal agreement.

Do not commit the controlled Business UUID, merchant PII, payment references, agreement content, device serials or handover evidence to the repository.

## Automated proof

Run the service-role-only function:

`platform_admin_verify_oa5c_real_merchant_proof(actor_user_id, tenant_id, commercial_order_id)`

The verifier is read-only and must fail closed unless all of the following are true:

- the commercial order is the current governed order for the Business;
- exactly one active Branch is in the controlled proof;
- commercial price lines resolve to governed price versions, include complete tax snapshots and reconcile to order gross;
- the current platform-wide Master Agreement exists and the Business accepted that exact version with governed evidence;
- at least one positive immutable provider/direct payment confirmation exists; adjustment-only settlement is insufficient;
- the selected Branch has one setup obligation and a governed completed appointment;
- the completion event belongs to that exact appointment and carries valid OA4 structured completion/equipment/handover evidence;
- Branch readiness has the same command/actor, the exact appointment completion time, and the exact derived evidence envelope used by the governed completion command;
- a governed provisional/full entitlement event exists with a valid plan and effective period;
- the pre-C2 `tenant_subscriptions` compatibility runtime is active and matches that entitlement plan and period exactly;
- runtime write access is active;
- OA5A lifecycle notifications trace the applicable order/agreement/payment/setup/entitlement facts;
- OA5B Admin reporting agrees with shared onboarding/activation state;
- privileged setup/reconciliation audit and replay/idempotency evidence are present;
- immutable-history and uniqueness contracts are intact.

The verifier always returns `oa5cAccepted=false`. Automated evidence cannot declare a Business real, independently verify the external truth of a payment or observe human Mobile/Merchant Web sessions.

## Manual proof

After every automated gate passes, record outside the repository that:

1. the subject is the designated real controlled merchant;
2. payment confirmation corresponds to genuine external settlement, not a synthetic provider event or QA adjustment;
3. physical setup/equipment handover actually occurred and matches the immutable completion evidence;
4. Merchant Web shows the same commercial/agreement/setup/activation outcome;
5. Mobile shows the same activation/runtime outcome and governed lifecycle notices;
6. WhatsApp and AI remain consumers only and did not create lifecycle truth;
7. offline selling remains server-gated by the governed entitlement/runtime authority;
8. the governed reconciliation command was repeated and produced no duplicate entitlement or compatibility-runtime effect.

## Stop conditions

Stop OA5C and report the blocker if:

- no approved/effective universal SellerTray Master Agreement is published;
- merchant acceptance of the current agreement is absent;
- the selected Business is not explicitly approved as the real controlled subject;
- payment provenance cannot be independently established;
- setup completion/equipment/handover evidence is incomplete;
- readiness is not the exact derived completion fact;
- entitlement and legacy runtime plan/period disagree;
- cross-surface state disagrees;
- replay creates a duplicate business effect.

Never manufacture evidence to clear a gate.

## Current production preflight — 2026-10-26

OA5A and OA5B are accepted and merged, and the OA5B reporting authority is live. The current production estate has no effective universal SellerTray Master Agreement version and no existing commercial-order record that supplies a suitable completed real-merchant OA5C proof with genuine payment plus governed setup/readiness/activation evidence.

Therefore OA5C remains **not accepted**. The verifier can be reviewed/deployed as read-only acceptance tooling, but C2 must not begin until an approved agreement is published and a designated real merchant completes the governed lifecycle with both automated and manual proof.
