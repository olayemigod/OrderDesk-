# OA5 — actual source migration interleaving and reconstruction scope decision

**Observation:** 11 November 2026. Exact source/content inventory from successful `OA5 Staging Isolation Contract` on source SHA `3e2bf5614f380f43d55cc1182559925380dcbe2a`, after correcting the initially too-narrow OA5 filename classifier.  
**Source:** Offline CI read of `supabase/migrations`; no Supabase database, merchant data, provider endpoint or remote runtime was touched.  
**Authoritative interpretation:** The later inclusive OA5A/OA5B/OA5C scan **supersedes** the earlier narrow-prefix 17/17/14 count. The source content inventory SHA stayed the same; the additional matches are a **classification correction**, not new migrations.

## 1. Final source classification (names only; not deployment selection)

| Category | Count |
| --- | ---: |
| Unique, structurally valid canonical SQL migration files | **457** |
| Named OA5/Pre-C2 candidates (includes `oa5_*`, `oa5a_*`, `oa5b_*`, `oa5c_*`, `pre_c2_*` and exact legacy guard) | **24** |
| C2-prefixed candidates | **17** |
| Other/unclassified (not presumed safe to omit) | **416** |

The **earliest** named OA5 candidate is `20261026073126_oa5a_lifecycle_notifications.sql`, and the **latest** is `20261104074500_oa5_printer_default_displacement_typed_row_repair.sql`. Within that timestamp interval there are exactly **77** migrations:

- **24** named OA5/Pre-C2 candidates, including historical OA5A lifecycle notification, OA5B reporting, OA5C controlled-merchant proof, later onboarding/installer/printer and pre-C2 repair migrations.
- **17** C2 candidate migrations (all 17 C2-prefixed files sit **inside** this OA5 timestamp window).
- **36** unclassified migrations inside the same interval, including separate Master Agreement/Order Form schema and acceptance convergence, merchant-first-purchase authority, pricing, and agreement-package processing prerequisites. Their unclassified label **does not** mean they are unrelated to OA5.

**Thus a contiguous timestamp-based OA5-only migration range is impossible: 53 of 77 files in the named OA5 window are not named OA5.** Equally, choosing the 24 named files alone would omit critical dependency candidates and may fail schema installation or corrupt authority.

**Content fingerprint:** `6f8239cfd96108a2f70a69a2d7cf11540701f07a1c1a86449cadada11529d3c6` is the SHA-256 over sorted source filenames and file-content digests. It is not a deployed SQL/hosted schema signature.

## 2. Source-level dependency observations (bounded, not full parity proof)

A read-only source inspection of representative actual SQL files established:

- `20261026073126_oa5a_lifecycle_notifications.sql` and related early OA5A/B/C migrations must be part of **named OA5 intake review**; treating only `oa5_*` as OA5 was incorrect and has been fixed in `scripts/qa/oa5-migration-scope-inventory.mjs` and synthetic tests.
- `20261102005000_order_form_production_authority_replay_convergence.sql` is unclassified by prefix but its SQL comments explicitly repair a missing historical Order Form creating migration, ahead of the OA5C verifier. Its omission cannot be justified from its filename.
- `20261102062500_agreement_package_processing_schema_convergence.sql` reconstructs a missing internal processing-table contract; `20261102063000_agreement_package_processing_service_role_read.sql` grants internal service-role read access. These are unclassified but relevant to agreement/merchant billing and cannot be casually excluded.
- `20261103181500_oa5_pre_activation_device_setup_and_agreement_history.sql` creates/restores agreement-version quarantine authority and updates pre-activation setup access. Later installer migrations create/add to governed tables and functions; their SQL requires preceding setup/device/permission authority.
- `20261104074500_oa5_printer_default_displacement_typed_row_repair.sql` rewrites a typed-row declaration **in a previously existing function**. It is not standalone and must be sequenced after the canonical printer-function definition.
- `20261102150000_c2_plan_profile_catalogue_foundation.sql`, `20261102160000_c2_branch_subscription_authority.sql` and `20261102161000_c2_branch_entitlement_resolver.sql` explicitly describe **additive, parallel** target-schema foundations. Their comments retain the legacy Business/trial runtime until C2-10. These observations **do not** prove that all 17 C2 files are compatible with an OA5 rehearsal, nor authorize enabling Branch-subscription runtime early.
- `20261103194500_pre_c2_customer_optional_phone_identity.sql` preserves the legacy write guard, phone-match semantics and WhatsApp-linked identity. This must stay coherent on Mobile, Merchant Web, WhatsApp and server permissions when OA5 Test is eventually verified.

The remaining SQL source dependency closure is **OPEN**. Naming/candidate classification and comments alone do not prove an executable schema chain. No migration SQL was executed, packaged or applied in this step.

## 3. Historical Test applied-ledger mismatch remains a separate HARD STOP

The owner's private read-only comparison remains: **457 canonical source versions / 54 historically applied Test versions; 2 exact version-and-name matches; 52 Test-only versions; 455 canonical-only versions; 452 retroactive unapplied source versions; 3 newer canonical versions**. The Test ledger high-water mark is `20261104214453`. This was a standalone Agreement Package Test import/snapshot lineage and must not be repaired by automatically marking canonical migrations applied.

**Never run** in-place `supabase db push`, bulk migration repair, or all-457 replay on the existing Test schema. There is no approved direct-forward migration path.

## 4. Preferred bounded next phase — local-first rehearsal planning

Produce an explicit, dependency-closed **ordered canonical baseline + OA5 compatibility** manifest from the 77-file mixed window and necessary earlier source baseline. A clean canonical Test baseline may include additive C2 schema **only after** a specific review proves unchanged legacy commercial runtime and excludes prohibited C2 runtime activation. A restricted OA5-only subset is acceptable **only** if every required dependency and clean local schema replay passes. Neither selection is approved by filename.

Verify on a **disposable local PostgreSQL** database before proposing any hosted action. Use the previously preserved encrypted 07 November Test archive, private SQL manifests and verified local restore evidence; do not unnecessarily repeat the archival process. Acceptance must cover schema/migration replay, RLS/grants, SECURITY DEFINER authorization, Branch/UOM/stock ledger, payment idempotency, onboarding/Agreement/installer readiness and Mobile/Merchant/Admin/WhatsApp/report/offline contract.

Hosted Test reconstruction still requires an independently reviewed provider/ingress safe-sink matrix (Meta, payment, email, FCM, AI), exactly scoped Auth/Storage and recovery, explicit reversible four-cron maintenance approval and fresh zero-queue proof. **Production/Tandar remain untouched. C2 production cutover remains blocked by OA5 controlled lifecycle acceptance.**

## 5. Verification and cross-surface impact

The inclusive classifier and the optional `--review-window` mode run in the existing offline OA5 CI workflow. `--inventory` emits only aggregate counts; `--review-window` emits filename, timestamp, group and SHA-256 **for explicit human source review**. Neither mode prints SQL bodies or local absolute file paths, contacts Supabase or authorizes migration/cleanup. Latest tests and real-source inventory passed under exact-head OA5 Isolation CI.

This changes only QA source inspection and its documentation. No shared commerce, inventory/UOM, payment, Merchant Web, Mobile, Admin Web, WhatsApp, AI, reporting, receipts or offline/sync runtime behavior has changed. No Preview/APK/billable branch was created; no Test or Production mutation or cron pause took place.
