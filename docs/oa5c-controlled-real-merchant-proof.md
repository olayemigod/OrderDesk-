# OA5C Controlled Real-Merchant Proof

This document is the operational acceptance contract for SellerTray OA5C. It does not create commercial, payment, agreement, setup, readiness, entitlement, notification, or reporting truth. It only verifies the existing governed authorities required by `.agents/skills/sellertray-project-implementation/OA5_C2_SEQUENCE.md`.

## Acceptance subject

Use one explicitly approved real SellerTray Business with exactly one Branch in the controlled proof path. Do not use a QA-only Business, synthetic payment, fabricated setup readiness, direct entitlement mutation, or merchant-specific legal agreement.

The proof sequence is:

> governed commercial order -> current universal Master Agreement acceptance -> qualifying confirmed settlement -> governed setup appointment -> structured setup completion -> Branch readiness -> entitlement reconciliation -> operational activation

## Stop conditions

Stop and report OA5C blocked if any of the following is true:

- no effective universal SellerTray Master Agreement version is published;
- the Business has not accepted the exact current version through the governed merchant acceptance authority;
- the Business is not an explicitly approved real controlled acceptance subject;
- the commercial order or price/tax snapshot is absent;
- settlement depends on synthetic or fabricated payment evidence;
- the Branch setup obligation is not tied to a governed appointment;
- required completion/equipment/handover evidence is missing;
- Branch readiness was created outside governed setup completion;
- reconciliation/activation evidence cannot be matched to the current compatibility runtime effect;
- Merchant Web, Mobile, Admin reporting, notifications, or audit materially disagree on lifecycle state.

Do not bypass a stop condition to make the lifecycle appear complete.

## Evidence required

Record evidence for the controlled Business without committing merchant identifiers, payment references, personal data, or agreement content into the repository.

1. Commercial order
   - order identity retained outside the repository;
   - selected plan/billing-cycle snapshot;
   - Branch setup line for the controlled Branch;
   - governed VAT/tax snapshot;
   - commercial order timestamp and authorised actor.
2. Master Agreement
   - current published version code/hash;
   - Business acceptance of that exact version;
   - authorised merchant actor role;
   - immutable acceptance timestamp;
   - exact-command replay produces no duplicate acceptance.
3. Settlement
   - confirmed gateway/provider payment and/or governed confirmed direct payment/approved adjustment;
   - amount paid/outstanding agrees with governed order arithmetic;
   - no fake provider event or synthetic payment;
   - repeated confirmation/reconciliation does not duplicate financial effects.
4. Setup and readiness
   - appointment linked to exact Business + commercial order + Branch;
   - structured completion checklist/equipment/handover evidence satisfies the OA4 completion validator;
   - Branch readiness is derived from governed completion;
   - replay does not duplicate appointment/readiness effects.
5. Entitlement and runtime
   - reconciliation creates the correct entitlement event once;
   - repeated reconciliation is idempotent;
   - compatibility `tenant_subscriptions`/runtime access matches the governed entitlement event until C2 retires it;
   - no direct subscription-expiry or activation mutation is used.
6. Cross-surface parity
   - Admin onboarding/commercial report shows the same stage/outcome;
   - Merchant Web shows the same commercial/agreement/setup/activation status;
   - Mobile shows the same activation/runtime status and governed notifications;
   - notifications exist for applicable lifecycle facts without duplicate event delivery;
   - WhatsApp/AI remain consumers only and do not create lifecycle truth;
   - offline POS authority remains unchanged and active selling is server-gated by entitlement.
7. Audit
   - privileged ProcessEdge actions retain actor/reason/evidence;
   - Master Agreement publication and merchant acceptance remain distinct immutable facts;
   - payment/setup/reconciliation retries leave one authoritative business effect.

## Live verification harness

Use `scripts/oa5c-controlled-real-merchant-proof.sql` against the configured production database with a temporary session setting:

```sql
select set_config('sellertray.oa5c_tenant_id','<CONTROLLED_REAL_BUSINESS_UUID>',false);
```

Run the proof query in the same session. The script is read-only. It reports PASS/BLOCKED checks and does not mutate merchant state.

## Acceptance decision

OA5C is accepted only when every required check is PASS and the operator has separately verified the real-world evidence that SQL cannot prove by itself, especially genuine payment provenance, physical setup/equipment handover, merchant identity/acceptance, and cross-surface browser/device observations.

Until OA5C is accepted, C2 Commercial V2 cutover and legacy Business/trial runtime retirement remain blocked.
