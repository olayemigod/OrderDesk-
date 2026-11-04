# SellerTray — OA5 Pre-C2 release acceptance record

**Candidate checkpoint:** 04/11/2026 (dd/mm/yyyy). **Status:** OPEN — not an authorisation to merge, deploy, activate merchants or begin C2 runtime cutover.

## Source and release order

- Governing contract: `.agents/skills/sellertray-project-implementation/SKILL.md`, `CROSS_SURFACE.md`, `INTELLIGENT_IMPLEMENTATION.md`, `ONBOARDING_ACTIVATION.md`, `ADMIN_CAPABILITIES.md`, `ADMIN_VISUAL_DESIGN.md` and `ADAPTIVE.md`.
- Stacked draft corrections: **#198** (preactivation devices, accepted-only agreements, optional phone and Settings isolation) → **#202** (real Branch print proof/readiness; inactive purchased Branch devices) → **#205** (distinct ProcessEdge installer identity, appointment-bound commands/printing/handover). Each parent must be merged or otherwise reconciled before release of its child. Do not use a child PR's "green review" as evidence its earlier release dependencies passed.
- **#201** is a *separate* Admin brand-integrity patch: its corrected embedded SVG PNG and byte-parity guard must be integrated into the approved current Admin visual baseline. Do not assume #205 contains it, or restore a pre-PR149 shell to make it apply.
- **No C2 cutover** until the preceding OA5C human lifecycle proof or an explicitly recorded later product decision changes this gate. Legacy pre-C2 Business/trial compatibility remains runtime authority until a separate controlled C2 cutover.

## Immutable gates: candidate must pass on exact merged SHA

| Gate | Evidence required | Status at authoring |
| --- | --- | --- |
| Review | Fresh exact-head code/security review, no reproducible unresolved P1/P2; thread reconciliation | **Pending** following later code changes |
| Branch integration | Integrate latest #202 branch fixes with #205 without dropping saving/printing/Branch-switch race guards; confirm clean ancestry and zero conflicts | **Pending** — #205 currently behind base |
| SQL clean-history | Apply the ordered migrations to a disposable fresh PostgreSQL/Supabase schema; verify every dependency/constraint/trigger/grant/function compiles before pgTAP | **Not run** |
| pgTAP | Run both `oa5_processedge_installer_identity_foundation.test.sql` and `oa5_processedge_invitation_reservation_exclusion.test.sql`, plus #198/#202 prior OA5 tests; no failed assertions, malformed SQL, timing or privilege drift | **Not run** |
| Admin Web | `cd apps/admin-web && npm test && npm run typecheck && npm run build` using the exact integration SHA/dependency lockfile | **Not run** on integrated #205 head |
| Mobile | `cd apps/mobile && npm run typecheck && npm run preflight` and relevant Bluetooth/native build checks | **Not run** on integrated #205 head |
| CI | GitHub Actions green on the **exact integration SHA**, not on an older branch or a different PR | **None returned** for #205 |
| Brand | #201 source asset parity, Admin v2 favicon and authenticated sidebar verified visually against PR149/PR158 baseline on exact candidate | **CI green on #201 only; browser pending** |
| Vercel/browser | Preview build available; record provider, URL, exact SHA, tested user/viewport and screenshots before acceptance | **Blocked by provider deployment quota** |
| Android | Actual installed Android APK, permission/MFA, Bluetooth pairing and native 58/80mm print on connected hardware | **Not verified** |
| Data migration | Production ledger reviewed; forward-only unapplied migrations must be deployed in order after dry run and change control, with post-deploy authority/ledger readback | **Not authorised** |
| QA sign-off | Real ProcessEdge Admin/installer and controlled merchant human acceptance recorded; any exceptions explicitly approved | **Pending** |

The latest production migration ledger seen during read-only inspection terminates before the 03/11/2026–04/11/2026 OA5 device/installer migrations. Repository SQL is **not** proof that any migration is live.

## Human acceptance matrix (record pass/fail and trace, never infer from a source test)

1. **Registration/agreements:** A new Business sees accepted agreement versions in its history, and only the currently required legal acceptance when due. No unaccepted historical version is mislabelled accepted; payments remain possible according to the approved Master Agreement/payment separation.
2. **Optional customer telephone:** Create a customer without a phone through supported create paths. Verify customer list/detail, selling selection, receipts, WhatsApp contact eligibility, search and required-field validation remain correct without fake contact values.
3. **Merchant setup before activation:** A purchased `branch_setup` Branch can configure register/printer/test proof while inactive with Owner/Manager device permission. POS/stock/payment/shift authority remains denied and no other inactive/retired tenant is accessible.
4. **Mobile navigation:** Devices & Printers and Branch terminals appear only in the correct owning Settings/management workspace, not repeated on unrelated tabs. Check light/dark and compact window; reflow on Medium, Expanded and Large windows without changing business authority.
5. **Installer internal identity:** A reserved invitation, partially delivered invitation and active linked Setup Installer each remain separate from merchant Team or Platform Admin membership. Pending/active/suspended/revoked staff cannot provision a merchant owner account or accept Team invitation. ProcessEdge Admin provisions/assigns; Support denial is server-enforced.
6. **MFA/assignment:** AAL1 denied; AAL2 + `admin.branch_setup.manage` + exact tenant/Branch scope required for privileged Admin. Assigned installer sees only their scheduled/in-progress work. Expiry, suspension or revocation instantly denies further hardware commands and cross-tenant/Branch access.
7. **Register command:** Create under verified appointment; retry the same command after a lost response or app restart. Verify exactly one register, same command replay result and immutable actor/appointment/before-after audit. Reject new facts under the same key.
8. **Printer command:** Pair and configure 58mm and 80mm printers with actual Android Bluetooth. Check saved width, default printer, receipt-copy profile and footer. Verify immutable audit covers both changed printer and any displaced default printer. Retry after lost response/restart without creating duplicates; reject direct unaudited installer RPC.
9. **Native test proof:** Capture a true canonical printed test job, not a UI checkbox or a requested/printing/failed job. When one installer is legitimately assigned two setup appointments for the *same Branch*, verify job A cannot be attributed to appointment B.
10. **Handover:** Record representative, acknowledgement reference and condition against the exact printed job. Replays do not duplicate and cannot change facts. ProcessEdge Admin must explicitly review/confirm Branch configuration, merchant walkthrough, pairing and printed test; installer submission alone never activates.
11. **Completion/readiness:** The existing canonical setup transition checks immutable handover + actual printer proof, writes exact Branch readiness and invokes existing entitlement reconciliation. Wrong appointment, printer, recipient or altered acknowledgement is denied. Do not silently backfill or rewrite historical OA4/C1 evidence.
12. **Print safety:** Bluetooth failure after a completed sale must not undo payment or stock posting; reprint must not duplicate transaction; installer must not print merchant financial receipts. Existing WhatsApp order/receipt behavior unchanged.
13. **Date presentation:** All touched installer/appointment/history displays use local **dd/mm/yyyy**. Form `datetime-local` remains local wall-clock input, persisted timestamps are UTC ISO, including Africa/Lagos (+01:00); no hour-offset drift.
14. **Admin baseline:** Authenticated PR149/PR158 sidebar, favicon, Settings/Setup navigation, merchant context, responsive drawer and Back/Forward still work; no functional branch may restore the obsolete Admin shell.

## Release evidence to record

For each proof, retain exact candidate/merged/deployed SHA, branch and tenant-safe test identifier, date/time, application/build version, ProcessEdge persona + capability + AAL, Branch/appointment ID where appropriate, test input (including denied and cross-appointment cases), expected/actual result, logs/CI URLs, visual screenshot or physical printer proof when relevant, issue references and the human approver.

**Acceptance rule:** A source regex check, code review, green CI on another commit, Vercel quota failure, production schema read or printer UI success notice is not a substitute for actual migration, end-to-end, native-hardware and authenticated visual proof.

## Cross-surface invariant

**Shared Core:** sole authority for setup command, permissions, device state, immutable events and activation. **Merchant Web:** supervises Branch/register and onboarding without inventing operational activation. **Mobile:** installer-only assigned work plus merchant operational printers and governed retry. **Admin:** ProcessEdge Staff provisioning, AAL2/capability/scope, handover review and canonical completion; preserve approved Admin identity. **WhatsApp/AI:** no independent device/activation command or new selling authority. **Reporting/audit:** preserve canonical setup events and immutable linking. **Offline:** local request keys may survive restarts; no offline authority to create setup readiness, commercial payment or subscription activation.
