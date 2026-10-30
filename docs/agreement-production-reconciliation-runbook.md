# SellerTray Agreement Production Reconciliation Runbook

Status: **OA5C deployment plan only — not production deployment approval**

This runbook converts the read-only LIVE migration audit for PR #150 into an explicit, equivalence-aware production reconciliation sequence.

It does **not** authorise deployment. Do not execute the LIVE steps until:

1. PR #150 remains green on its exact candidate head;
2. the hosted TEST agreement document flow has been accepted to the extent required by OA5C;
3. the exact production Master Agreement text/version has been explicitly approved by ProcessEdge;
4. the controlled OA5C real-merchant evidence gate is satisfied or an explicit later ProcessEdge decision changes that gate; and
5. the operator reconfirms the LIVE project identity before every mutating phase.

The governing product sequence remains:

> OA4 acceptance/closure → OA5 lifecycle notifications/reporting + controlled real-merchant proof → C2 Commercial V2 cutover/legacy runtime retirement.

This runbook is part of **OA5C**. It is not C2.

---

## 1. Environment identity and non-negotiable safety boundary

### LIVE

- Supabase project name: `OrderDesk`
- Project ref: `eujxswjspolugrzlsjnn`

### Dedicated agreement TEST

- Supabase project name: `SellerTray Agreement Package Test`
- Project ref: `iukgsukdoowvnhlfmpml`

Before any LIVE mutation, independently verify the project name and project ref in the same operating session. A project-ref mismatch is an immediate stop condition.

Never reuse a TEST project ID, QA Business ID, QA Master version, QA Order Form, QA package fingerprint, QA command ID or QA user identity in a LIVE mutation.

Do not describe production as untouched. The 2026-10-27 incident remains part of the audit record: a QA proof subset reached LIVE, two real Businesses received `master_agreement_required` push notifications, no real merchant accepted the QA Master, the QA Master was quarantined immutably, and LIVE currently resolves no approved Master Agreement.

---

## 2. Governing reconciliation principle

LIVE received hosted/ad-hoc agreement migrations whose timestamps do not match the repository migration ledger.

Therefore:

> **Reconcile by semantic authority, not filename or timestamp equality.**

Rules:

1. Do **not** blindly replay repository migrations `20261027100000` through `20261027100500`.
2. Do **not** insert fake rows into `supabase_migrations.schema_migrations` merely to make the ledger look like the repository.
3. Do **not** drop/recreate immutable legal/commercial tables to force migration parity.
4. Preserve all existing Master, Order Form, package, confirmation, quarantine, acceptance and commercial evidence.
5. Introduce only authority that is genuinely absent, then verify the resulting semantics against the clean repository target.
6. A failed phase stops progression. Do not continue because later migrations might “fix” an earlier failure.

---

## 3. Current LIVE semantic map

The read-only audit established the following hosted LIVE sequence:

- `20261027111931 hosted_agreement_package_schema_subset`
- `20261027111945 hosted_order_form_admin_boundary_current_pr`
- `20261027112009 hosted_order_form_issue_and_admin_read_current_pr`
- `20261027112025 hosted_agreement_package_no_master_read_current_pr`
- `20261027112042 hosted_agreement_package_retry_current_pr`
- `20261027112110 agreement_package_fk_index_hardening_current_head_retry`
- `20261027120028 master_agreement_publication_quarantine`

Semantic mapping:

| Repository authority | LIVE semantic state | Deployment treatment |
| --- | --- | --- |
| `20261027100000_master_order_form_package_oa5c_convergence.sql` | Core Order Form/template/package/confirmation authority already exists through hosted subset | **Do not replay wholesale** |
| `20261027100100_order_form_admin_boundary_and_legacy_retirement.sql` | Legacy C1A create/accept/template mutation retirement and governed template publication are present | **Treat as semantically covered** |
| `20261027100200_agreement_package_no_master_read_guard.sql` | No-Master read guard present | **Treat as semantically covered** |
| `20261027100300_agreement_package_confirmation_retry.sql` | Deterministic confirmation replay response present | **Treat as semantically covered** |
| `20261027100400_agreement_package_activation_compatibility.sql` | Package-aware activation compatibility was not present in the original LIVE audit | **Do not replay old migration; converge through the later forward migration** |
| `20261027100500_order_form_fk_index_hardening.sql` | Required full FK-covering Order Form indexes present | **Treat as semantically covered** |
| `20261027120000_master_agreement_publication_quarantine.sql` | Quarantine authority present | **Treat as covered; preserve evidence** |
| `20261027170000_agreement_document_artifacts.sql` | Source/artifact tables and document publication authority absent | **Apply when approved** |
| `20261027170100_agreement_document_admin_projection_convergence.sql` | Depends on document authority; not live | **Apply after document artifacts** |
| `20261027173000_agreement_package_zero_touch_orchestration.sql` | Zero-touch ensure/orchestration absent | **Apply after document convergence** |
| `20261027224913_agreement_package_processing_self_healing.sql` | Durable processing/retry worker absent | **Apply after zero-touch** |
| `20261028052000_agreement_package_activation_compatibility_forward_convergence.sql` | Forward convergence not live | **Apply last in this agreement reconciliation batch** |

The forward convergence migration exists specifically to reconstruct the final package-aware activation boundary from either a clean-replay shape or a hosted subset shape without mutating commercial/legal history.

---

## 4. Pre-deployment evidence capture

Before the first LIVE migration, capture and retain a deployment evidence bundle containing at minimum:

1. exact PR/commit SHA approved for deployment;
2. all six required GitHub workflow results for that exact SHA;
3. LIVE project name/ref;
4. LIVE `supabase_migrations.schema_migrations` rows for the agreement sequence;
5. counts for:
   - Master Agreement versions;
   - Master Agreement acceptances;
   - quarantines;
   - Order Form templates;
   - Order Forms;
   - Agreement Packages;
   - Order Form confirmations;
   - document source rows if any;
   - package artifact rows if any;
6. current Master resolver result;
7. current service-role EXECUTE state for the manual Order Form issuer;
8. definitions/signatures of the existing entitlement reconciliation and billing-state functions that will be converged;
9. current relevant cron jobs;
10. current relevant triggers on installment schedule, Order Forms and agreement processing tables.

The evidence bundle is the rollback/provenance baseline. Do not rely on memory or screenshots alone.

### Required preflight assertions

Progress is allowed only if all are true:

- LIVE project ref is exactly `eujxswjspolugrzlsjnn`;
- current Master resolver returns no quarantined QA Master as current authority;
- package/confirmation evidence counts are explainable and unchanged from the approved preflight snapshot;
- no unexpected repository-equivalent document/zero-touch/self-healing objects have appeared since the read-only audit;
- the existing manual issuer is still in the expected pre-zero-touch LIVE state;
- no unresolved migration is already running;
- no operator is simultaneously modifying SellerTray agreement/commercial schema.

Any mismatch requires a fresh semantic audit before mutation.

---

## 5. Phase A — document authority

Apply, in repository order:

1. `20261027170000_agreement_document_artifacts.sql`
2. `20261027170100_agreement_document_admin_projection_convergence.sql`

### Expected effects

- private agreement artifact storage metadata authority;
- immutable Master source-document evidence;
- immutable review/executed package artifact evidence;
- reviewed-package exact confirmation authority;
- Admin legal projection includes governed source-document evidence without exposing storage paths.

### Verification checkpoint A

Verify before continuing:

- new source/artifact tables exist and RLS/grants match the repository target;
- ordinary `anon`/`authenticated` roles cannot directly mutate/read protected artifact evidence outside approved paths;
- protected publication/confirmation functions are not directly client-executable;
- existing Master/Order Form/package/confirmation counts are unchanged except for objects intentionally created by an approved production validation action;
- current Master resolver remains fail-closed until an explicitly approved production Master is published;
- no QA source document or QA artifact has become production authority.

**Stop if any existing immutable legal/commercial row is rewritten or deleted.**

---

## 6. Phase B — zero-touch orchestration

Apply:

- `20261027173000_agreement_package_zero_touch_orchestration.sql`

### Expected effects

- completed governed commercial schedule invokes automatic Order Form/package ensure authority;
- Order Form template and reference selection move to server-governed zero-touch behavior;
- routine service-role manual Order Form issuance is retired on the target schema;
- missing Master/template configuration returns explicit non-fatal orchestration state rather than deleting/recreating the commercial order;
- existing legacy/pre-Order-Form orders are not bulk-converted.

### Verification checkpoint B

Verify:

- `ensure_sellertray_agreement_package_for_commercial_order(...)` exists with intended grants;
- ordinary clients cannot call the ensure authority directly;
- service role can call the governed ensure authority;
- service role can no longer execute routine `issue_sellertray_commercial_order_form_admin(...)`;
- the installment-schedule orchestration trigger exists once, not duplicated;
- historical Order Form/package counts do not jump simply because the migration was applied;
- a controlled production-safe dry/read check shows no historical sweep/backfill.

Do not create a synthetic real-merchant order merely to test the trigger.

---

## 7. Phase C — durable self-healing

Apply:

- `20261027224913_agreement_package_processing_self_healing.sql`

### Expected effects

- durable processing ledger for zero-touch subjects only;
- `pending / retryable / resolved / manual_attention` state;
- bounded worker with `FOR UPDATE SKIP LOCKED`;
- configuration wake-up triggers;
- exceptional Admin recovery limited to registered zero-touch subjects;
- one scheduler job for agreement-package retry.

### Verification checkpoint C

Verify:

- processing ledger exists with RLS/grants matching target;
- immediately after migration, the processing ledger does **not** contain a bulk import of historical orders;
- exactly one expected retry cron job is scheduled;
- worker invocation on an empty queue completes cleanly;
- no unexpected Order Forms/packages are created by the empty worker;
- recovery projection is visible only through governed Admin authority;
- review-only Admin projection remains restricted.

If historical rows appear merely because the migration ran, stop and investigate before any further phase.

---

## 8. Phase D — final activation compatibility convergence

Apply last:

- `20261028052000_agreement_package_activation_compatibility_forward_convergence.sql`

Do **not** apply the older `20261027100400_agreement_package_activation_compatibility.sql` to LIVE merely to imitate the clean migration ledger. The forward migration is the hosted-subset convergence authority.

### Expected effects

- universal Master acceptance remains mandatory for current-path service delivery;
- package-path orders additionally require confirmation of their exact current Order Form;
- pre-Order-Form OA5C compatibility orders remain governed by the universal Master prerequisite without legacy C1A fallback;
- billing-state and entitlement reconciliation converge onto the same package-aware agreement gate;
- no entitlement is manufactured by the migration itself.

### Verification checkpoint D

Verify:

- `sellertray_installment_contract_accepted_at(uuid,uuid,uuid)` exists and is service-bound;
- `sellertray_installment_agreement_is_accepted(...)` delegates to the same contract gate;
- package-aware billing state reports Order Form confirmation requirement correctly;
- package-aware entitlement reconciliation core and public wrapper both exist with expected grants;
- a current-path package order cannot satisfy agreement readiness with Master acceptance alone when its current Order Form is unconfirmed;
- a legacy OA5C order without an Order Form does not suddenly require a fabricated Order Form;
- no new entitlement event appears without independent agreement + setup/readiness + qualifying settlement facts.

---

## 9. Edge Function deployment checkpoint

Only after Phases A–D verify cleanly should the exact approved repository `master-agreements` function be deployed to LIVE.

Requirements:

- deploy exact candidate source, not a manually reconstructed function;
- keep `verify_jwt=true`;
- preserve pinned PDF/runtime dependencies from the approved candidate;
- verify function version/status after deployment;
- do not disable JWT, MFA/AAL2 or capability checks for smoke testing;
- do not expose service-role credentials to browser code.

### Post-function smoke checks

Use genuine authorised sessions only:

- read-only `admin_get` with approved ProcessEdge Admin identity;
- read-only `merchant_get` with a genuine merchant identity when the controlled OA5C proof is authorised;
- no production legal publication until exact final merchant-facing legal text/version has separate ProcessEdge approval.

---

## 10. Production Master publication gate

Technical deployment does **not** authorise Master publication.

The retained v0.9 review copy is not merchant-publishable production text. Before any production `admin_publish` / `admin_publish_pdf` action:

1. counsel-review-only/review-register material must be reconciled without inventing unapproved commercial/legal choices;
2. the merchant-facing production version must have a new immutable production version code where reconciliation is material;
3. ProcessEdge must explicitly approve the exact final text/version;
4. the production file/text must contain no QA, placeholder, `NOT FOR MERCHANT ACCEPTANCE`, counsel-instruction or similar review-only wording;
5. publication must occur through governed AAL2 + `admin.agreements.publish` authority.

A green deployment cannot convert draft legal content into production legal authority.

---

## 11. Stop conditions

Stop the deployment immediately when any of the following occurs:

- project identity mismatch;
- migration tries to recreate/drop an existing immutable legal/commercial table unexpectedly;
- Master/Order Form/package/confirmation history changes without an approved business action;
- current Master resolver exposes quarantined QA content;
- client roles gain direct protected legal/document mutation authority;
- routine manual Order Form issuance remains available after zero-touch convergence;
- processing migration bulk-registers historical orders;
- duplicate retry cron jobs appear;
- activation reconciliation emits entitlement without all independent prerequisites;
- a migration/function version differs from the approved repository candidate;
- any QA/placeholder legal content becomes production current authority.

Do not “push through” a stop condition to finish the batch.

---

## 12. Compensating rollback strategy

This agreement migration line preserves immutable evidence. Rollback therefore means **restore safe authority**, not delete history.

### Before mutation

Capture exact pre-deployment function definitions, grants, triggers and cron jobs so they can be restored if necessary.

### If Phase A fails

- stop before zero-touch deployment;
- leave any successfully created immutable document tables/evidence intact;
- restore replaced function/projection definitions from the captured preflight only if required;
- do not drop source/artifact evidence that may already have been created by an approved action.

### If Phase B/C fails

With explicit incident approval only:

- stop the agreement retry scheduler;
- disable/remove only the new automatic orchestration trigger/worker authority required to prevent further processing;
- preserve any immutable Order Form/package/confirmation evidence already created;
- restore prior callable authority only from the captured pre-deployment definitions and only when consistent with the incident decision.

Do **not** restore routine manual issuance as the normal operating model merely because zero-touch had an incident.

### If Phase D fails

- prevent new entitlement reconciliation through the defective path;
- restore the captured pre-deployment reconciliation/billing function definitions only as an explicit compensating incident action;
- preserve all existing entitlement events and legal/commercial history;
- do not delete/rewrite entitlement history to simulate rollback.

Every compensating action must be audited and included in the deployment evidence bundle.

---

## 13. Final acceptance evidence after reconciliation

Before declaring LIVE agreement infrastructure reconciled, retain evidence showing:

- exact deployed repository SHA;
- exact migration sequence actually applied to LIVE;
- before/after semantic object map;
- before/after immutable evidence counts;
- protected grants/role checks;
- zero-touch trigger state;
- retry scheduler state;
- package-aware activation function definitions/signatures;
- Edge Function version + `verify_jwt=true`;
- current Master resolution state;
- proof that no QA Master became current;
- controlled OA5C lifecycle evidence when that separate acceptance step is authorised.

Only then may the production reconciliation blocker be marked closed.

---

## 14. Cross-surface impact

- **Shared Core:** this runbook governs migration/reconciliation of legal, commercial and activation authority.
- **Admin Web:** no new business truth; retains governed publication, monitoring and exception roles.
- **Merchant Web:** no new business truth; consumes the reconciled package/review/signing authority.
- **Mobile:** no schema-owned signing authority; notification/handoff behavior remains unchanged.
- **WhatsApp:** no signing authority and no change to commerce truth.
- **AI:** no legal authority and no change to deterministic orchestration.
- **Reporting/audit:** deployment evidence, immutable legal history and privileged-operation audit must be preserved.
- **Offline/sync:** no offline legal acceptance is introduced; signing remains online/fail-closed.

Legacy Business/trial runtime authority remains active until the later governed C2 cutover. This runbook must not be interpreted as C2 retirement approval.