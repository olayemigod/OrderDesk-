# SellerTray solo-maintainer release governance

**Approved decision:** 06/11/2026 (dd/mm/yyyy), SellerTray owner.  
**Applies to:** SellerTray implementation and release workflows while ProcessEdge has only one developer/repository maintainer.  
**Owner:** ProcessEdge / SellerTray product and release owner.  
**Status:** governing; this policy supplements `.agents/skills/sellertray-project-implementation/SKILL.md`.  
**Non-goal:** this document is not a Production deployment command, blanket migration approval, or representation of an independent human approval.

## 1. Why an exception exists

SellerTray currently has only one developer. A mandatory second internal GitHub `APPROVED` review cannot be performed honestly. The owner's explicit 06/11/2026 decision replaces that **staffing-only** requirement with a documented, risk-based solo-maintainer process. Never manufacture a collaborator, fake GitHub approval, use the author's own approval as an independent review, or call AI-based review an independent human sign-off.

An external qualified PostgreSQL/Supabase security reviewer remains the preferred option for especially sensitive or regulated changes, but the absence of a second employee is not by itself an indefinite release blocker when every applicable technical control and an explicit owner risk exception are satisfied. Any externally imposed legal, contractual or regulatory independence requirement is **not waived** by this policy.

## 2. Mandatory evidence for every change

1. Re-read repository `AGENTS.md` and the current governing SellerTray skill. Pin the exact source commit, base branch, changed files and intended environment.
2. Inspect the actual implementation and affected cross-channel authorities: Branch, tenant, role/capability, UOM, inventory, payments, WhatsApp, AI, reporting, idempotency and offline behavior where applicable.
3. Obtain a separate automated code review of the **exact final source** (Codex or equivalent), including clear findings and resolution status. Do not mislabel an ordinary code review as a security-specialist review.
4. Run focused tests and relevant CI; verify release-specific invariants and negatives, not only happy paths. When changes alter source or migration behavior, rerun the affected gates.
5. Keep release evidence in the PR or issue: exact SHA/file hashes, CI run IDs, tests and results, risk assessment, unresolved findings, change scope, backup/restore evidence where applicable, and operator/owner decision.
6. The sole maintainer may approve and merge their own changes **only under this documented exception**; the GitHub review state must be reported accurately. Self-approval is **owner authorization**, never independent reviewer approval.

## 3. Additional high-risk release gates

High-risk changes include Production SQL, `SECURITY DEFINER`/RLS/permission changes, payment or settlement authority, commercial activation, inventory/valuation/stock ledger, data deletion, auth secrets, WhatsApp credential flow, offline replay and migrations.

Before a high-risk Production action:

- Pin the exact migration file hashes, version IDs, target/project and known-good Production baseline.
- Require two distinct verification perspectives: automated code review plus adversarial/negative authorization or ledger/regression tests (or external expert review when available). Record exactly which were used; no claim of human independence unless a different qualified human actually reviews.
- Prove the **final proposed deployment mechanism itself** on an isolated, production-compatible disposable restore. A similar but differently packaged local rehearsal is insufficient.
- Preserve merchant/Branch separation, ledger and payment integrity, immutable audit evidence and existing live-merchant operations.
- Maintain a protected backup, tested database recovery and an accountable forward-fix/recovery owner. For destructive or managed-service-sensitive changes, verify Storage files/API, Edge Functions, secrets, provider configuration and connected services to the extent necessary for the recovery promise; explicitly list any recovery gaps.
- Require a dated, specific owner go-live authorization **after** reviewing the frozen SHA, rollout mechanism, recovery evidence, risk acceptance, run window and operator. A generic "continue" or agreement to the governance policy does not authorize running SQL in Production.
- Stop if the production preflight fingerprint, ledger, grants, app state, backup availability, CI or pinned source differs from reviewed evidence.
- Perform bounded post-release acceptance, authorization denial checks, healthy merchant operations and recorded rollback/forward-fix decisions; do not silently restore a known-vulnerable state.

Low-risk documentation and UI changes still require exact-source review, relevant checks and owner approval, but do not need an unrelated database restore or Android build.

## 4. PR #219 specific emergency human-review exception

**Approved only as to the mandatory second-person review requirement.** The owner explicitly confirmed on 06/11/2026 that SellerTray has one developer and approved replacing the mandatory second-developer review with the solo-maintainer procedure, including a specific emergency review exception for PR #219. Record this as `OWNER-APPROVED SOLE-MAINTAINER HUMAN-REVIEW EXCEPTION`, **not** `INDEPENDENT HUMAN APPROVED`.

- Source head remains `24f03e5fd3dcccdfb85324fa771d6cf1f49c68c7` until a deliberate re-review; affected SQL Git blobs:
  - `20261104213746_restrict_branch_snapshot_trigger_execute_acl.sql` — `03bfa61f03219116a2ffedc3d0c3e2f02ee03e0f`.
  - `20261104214453_fix_security_definer_report_scope_bypass.sql` — `cb3a68a65ed2d0800413d3afc8e8a4762ae17997`.
- Automated exact-head Codex code review found no major findings; Database CI `41924752086` and Mobile CI `41924752285` passed. **A separately approved human security review has not occurred.** Dedicated security-review approval must not be claimed.
- Local Production-snapshot promotion rehearsal passed exactly two security migrations, original 390 ledger rows unchanged, 390→392 recorded, 8/8 integrity checks, 36/36 local security assertions (10 snapshot ACL, 22 reporting scope, 4 owner-identity nonbypass).
- As of 06/11/2026 Production still has 390 migration versions, no PR #219 versions, three vulnerable owner-bypass reporting RPCs, and two exposed internal snapshot trigger helpers. The vulnerability remains open until actual Production deployment and validation.
- The 390 empty historical local-only placeholders are **diagnostic**, and the 390-version SQL evidence archive is **not canonical replayable source history**. Do not commit, reexecute or promote either. Historical source/ledger divergence (including 17 C2 foundations) is not authorization to run or mark skipped migrations.
- Keep Build 47 APK, OA5, C2, unrelated SQL, previews, and additional paid projects out of this emergency change. Avoid changing PR draft/ready state just to gain a review label if the Android QA workflow may rebuild needlessly.
- **Remaining release gates despite the staffing waiver:** independent review of the *technical release mechanism* by a separate expert if available, or a documented additional adversarial script/runbook audit under this exception; verified identical final version-aware migration runner; current Production read-only preflight; protected restore/recovery coverage and known gaps; named operator and forward-fix owner; time-bounded owner go-live authorization; acceptance and monitoring.
- This owner exception authorizes continued preparation. It does **not** authorize executing Production migrations solely because the owner said "yes" to this policy.

Track execution and remaining gates in [Issue #222](https://github.com/olayemigod/OrderDesk-/issues/222) and scope in [PR #219](https://github.com/olayemigod/OrderDesk-/pull/219).

## 5. Reviewable evidence and revisiting the rule

The release report must distinguish `CODE REVIEW PASS`, `SECURITY REGRESSION PASS`, `OWNER APPROVED`, `HUMAN INDEPENDENT REVIEW WAIVED`, `PRODUCTION HOLD`, and `PRODUCTION VERIFIED` truthfully. A green CI check or owner exception alone cannot mean Production is secure.

Revisit the staffing exception when a qualified second maintainer or external reviewer becomes available. A later explicit owner decision can modify this rule, but must be recorded and propagated to the governing skill without weakening business/ledger invariants.
