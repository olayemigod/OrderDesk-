# OA5 — original five Vercel Preview application-capture local integrity evidence

**Observation date:** 10 November 2026.  
**Evidence class:** User-operated authenticated historical Preview read-only capture; locally reverified preserved private files, and separate read-only connected-Vercel deployment metadata confirmation.  
**Scope:** Restricted to original deployed HTML and traversed application JS. **Not** a hosted browser/runtime acceptance, Test reset approval, or Production release.

## Original fixed deployments

| Directory | Surface | Original frozen Vercel deployment ID | Original Git SHA | Locally SHA-256 verified files |
| --- | --- | --- | --- | ---: |
| `capture_0` | Merchant | `dpl_Cfh7oAt9nHQkdUZtbXShj7jfhMfw` | `3f0df8f16455572cd0d1c079a3ac2327cc5bcd88` | 16 |
| `capture_1` | Merchant | `dpl_Gh9s6Rm2dJibEKuBDDcm7jZ3bGmz` | `bbee34e999971b5c87e7274428ee655e4ff36d4d` | 16 |
| `capture_2` | Admin | `dpl_5UfqxbGpPuQqGkSu1rU4bpCFrQWZ` | `7ba66274068ee75a2341a9adcccde338b1545f90` | 2 |
| `capture_3` | Admin | `dpl_H1suGYapnAjZR9rAKBq8WLtHu5Uo` | `3f0df8f16455572cd0d1c079a3ac2327cc5bcd88` | 2 |
| `capture_4` | Admin | `dpl_J9nL3wiNKyXcJEoVjbb65kUw4JnA` | `3c6e338ef7743c270023e791034c321294c70e6f` | 2 |

**Actual owner terminal evidence:**

- `node --experimental-vm-modules "$Runner" --check-plan "$Plan"`: `PASS` for five original deployment IDs, commits and restricted Preview origins. This check alone never verified original alias mapping or reviewer authorization.
- On the **third fresh, distinct private capture folder**: `node --experimental-vm-modules "$Runner" --capture "$Plan" "$ThirdOutput"`: `PASS: privately captured 5 supplied Preview trees and 38 local files`. Private content-only manifest and SHA-256 inventory were written in the owner's private workstation folder.
- Independent offline replay `node --experimental-vm-modules "$Integrity" --check "$ThirdOutput"`: `PASS: all 5 frozen deployment records, 38 private original file SHA-256 hashes and local Test backend content rechecked`. **Per-capture file counts:** `16, 16, 2, 2, 2`. Source-backed inspector confirms that the traversed HTML/JS contains the approved Test Supabase backend identity, without a Production project ref or unexpected Supabase project URL. This is a local source-content finding, not proof of a future hosted browser execution or all possible lazy-loaded chunks.
- The published, exact Vercel Preview Toolbar JavaScript is injected in **three** Admin historical HTML documents; it was **not fetched or attested** as part of the compiled application JS. Its external/runtime effects remain a separate evidence boundary.
- The Node `ExperimentalWarning` for parse-only VM modules did not block the successful local checks; captured modules were **parsed, not executed**. No library/package was installed or remote JavaScript imported by the local inspector.

**Independent provider metadata evidence:** Using read-only authenticated Vercel connector calls, all five IDs returned `READY` with the expected project, original source SHA and repository. Each ID's original single Preview alias matched both deployment metadata and the provider's alias-list response (**5/5**). This attests current provider-side identity/alias mapping, **not** cryptographic provenance for the already saved HTTP response bytes.

**Previous protection/reviewer proof to preserve:** The 09 November 2026 approved Standard Vercel Authentication owner checks, recorded in `ENVIRONMENTS_RESOURCES.md`, showed signed-out login protection for one historical Merchant and one historical Admin Preview; signed-in Vercel Owner could open both, and both canonical Production custom domains were public. Do not erase or repeat this as if absent. It is **not** proof that every historical invited reviewer retains access or that all five original URLs have independent signed-out/signed-in browser evidence.

## Gate accounting

| Gate | Finding |
| --- | --- |
| Exact five original deployment IDs, pinned commits and alias-to-deployment provider metadata | **PASS (metadata)** |
| Local HTML/traversed JS capture, privately stored inventory, independent 38-file SHA-256 replay | **PASS (local evidence)** |
| Compiled traversed HTML/JS uses the Test backend, not Production | **PASS (bounded offline content)** |
| Three external Vercel Toolbar scripts and nonliteral runtime-loaded modules | **UNATTESTED / outside local module capture scope** |
| Signed-out access and signed-in owner opening a Merchant/Admin historical Preview | **Previously observed for two URLs**; not a fresh 5/5 browser acceptance |
| Historical full reviewer continuity, signed hosted artifact bytes, entire browser runtime, QA domain protection | **OPEN** |
| Test-only providers/ingress/cron/Auth/Storage, archive/fresh census/restore, migration parity | **OPEN** |
| OA5 staged Test reset/cutover, production deployment, paid resources, Tandar/live merchant effect | **NOT AUTHORIZED** |

**Decision:** Mark the **local historical compiled application content custody and SHA replay** subgate complete. Do **not** mark the broader OA5 hosted staging acceptance or C2 release gate complete. Keep PR #228 DRAFT/unmerged until all applicable separate gates close.

## Preservation and next bounded evidence

Keep the first two failed partial private folders and the third successful 5-Preview private folder unchanged and outside Git, issue comments, customer documents, or public URLs. Do not upload the private plan, hashes, original alias hostnames, authentication cookies, original HTML/JS, or private absolute paths. Retain the owner-provided output above as sanitized evidence in this document.

The **next separate review** is to reconcile historic reviewer access using the already documented 09 November owner checks, rather than repeating them, and collect only genuinely missing reviewer/browser evidence. After that, continue the *read-only* Test ingress/provider/census/cron/managed-resource preflight. No external callbacks, four-job cron pause, destructive Test rebuild, new Preview, new APK, merchant activity, or Production changes are authorized by this evidence.

## Cross-surface impact

This work validates **historical Merchant Web and Admin Web deployment artifacts**. No shared-commerce schema or domain transaction changes were made. Mobile, WhatsApp, AI, inventory, payments, reporting, merchant permissions, and offline/replay were not changed because artifact-custody validation is read-only. No migrations, frontend builds or Android binaries are required for this QA documentation.
