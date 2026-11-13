# OA5 Test — four-job post-pause evidence and Method B next gate

**Date:** 13 November 2026. **Scope:** SellerTray **Test only**, Supabase project `iukgsukdoowvnhlfmpml`. **Status:** Cron maintenance prerequisite **PASS** at captured snapshot; full Method B reconstruction **NO-GO / not authorised**.

This continuation records the already owner-approved Test-only reversible four-job pause and the read-only post-pause verification. It does **not** grant or perform a hosted Test reset, migration replay, Auth/Storage mutation, Edge or provider configuration, Vercel deployment, APK build, or any Production/Tandar operation.

## Exact observed post-pause state

A fresh Test-only read-only schema-v2 `cron.job`/run-history/`net.http_request_queue` snapshot at **2026-11-13T06:14:23Z** returned exactly four cron jobs, all `active=false`. Jobs were deactivated via `cron.alter_job(job_id := ..., active := false)`, not unscheduled, replaced or deleted.

| ID | Name | Retained schedule | Command SHA-256 | State |
| --- | --- | --- | --- | --- |
| 1 | `sellertray-prepare-usage-settlements` | `15 1 * * *` | `19adca9347f95ae6df6caaf31f45b2c7a2a102375aaa44227456ddea992ebaac` | inactive |
| 2 | `sellertray-whatsapp-notification-retry` | `* * * * *` | `5271a0ecf65418ef0943a49e187a79c7c66733f2418e5c4c067342f5073fc3be` | inactive |
| 3 | `sellertray-merchant-push-retry` | `* * * * *` | `9415cef3fdd4acc626406791c201d275fb49fe3ac89d0f4dbee3218fb49aeb37` | inactive |
| 4 | `sellertray-agreement-package-retry` | `* * * * *` | `280ed1badf510aceee14117efad11d008fa0b4eaf589d9721650970077c5bc36` | inactive |

Every job reported **zero all-age unfinished/running executions**; pending `pg_net` HTTP queue depth was **zero**. All names, schedules and command fingerprints match the four exact values frozen in `scripts/qa/oa5-test-cron-maintenance-gate.mjs`. Snapshot counts: **5 Auth users / 7 Auth sessions / 22 refresh tokens / 54 historic Test migration ledger rows**. The Test project remained ACTIVE_HEALTHY. These counts match the immediately preceding pre-pause observation. No new Auth session cleanup or SQL migration was performed.

A passing snapshot is **not** evidence that no request was already sent to a provider. The live provider-console isolation gate remains independently open. Avoid retaining a previously fresh snapshot as a perpetual guarantee; refresh the snapshot inside each authorised change window.

## Reconciliation with newer canonical source

The integrated Merchant Web + Build47 Mobile candidate, PR **#247**, exact original base head `b9e27ae26d3bc289c2fdae16b072def93a7698ed`, carries the **461-migration** canonical source. Its exact-head Database pgTAP, Mobile verification/dependency audit, Mobile offline contract and Native Android compile checks reported success, while Supabase Preview was skipped. These checks are source/CI results only; there is no hosted Test canonical replay, preview deployment, APK, or real-device acceptance.

Earlier Method B documents and one Auth post-canonical guard still referred to the prior **457-migration** source. The new source-only branch reconciles the Auth after-replay check to **461** and corrects the Method B checker diagnostic/test. Historical 457-migration comparisons and the separate 54-row Test ledger remain immutable historical evidence, not the current canonical release target.

## Next gates (not yet passed)

1. Independently establish **actual** Test-only containment in Meta/WhatsApp, Paystack, Flutterwave, SMTP/Auth redirects, FCM, AI, and Merchant/Admin endpoint settings; preserve all five historical Preview deployments and reviewer access. The former proposed QA Meta phone collides with a historic Production mapping and must remain denied for Test webhooks.
2. Review the known **additional privileged historical Test Auth session**, preserve all five retained Auth user identities under Method B, and capture a private pre-reset cohort cutoff/fingerprint. Do not revoke managed sessions or users without another explicit approval.
3. Pin the exact **461-source Git commit and ordered migration content hash**. Independently review current hosted CLI v3 help, exact explicit Test project targeting, affected user-created objects, roles/grants, seed disabled, and rollback/abort limits. The 54 historical applied ledger versions cannot be repaired or directly replayed in place.
4. Produce an independently reviewed, **Test-only destructive-operation change record** identifying operator and different reviewer, permitted losses, archive/restore custody, canonical replay, Auth quarantine checks and stop conditions. Obtain **separate explicit owner approval** before any hosted cleanup/rebuild.
5. After a future authorised reconstruction: prove zero inherited permissions for the original five Auth identities across eight authority categories; verify real historic-account denied actions and distinct synthetic QA positive controls. Only then undertake protected Merchant/Admin, Android Build47, WhatsApp, payment, stock/UOM, offline and reporting acceptance.

**Decision:** **Cron post-pause prerequisite PASSED. Method B destructive reconstruction remains BLOCKED.** Production `eujxswjspolugrzlsjnn`, Tandar, customer activity and live provider routes must remain untouched. C2 is not a prerequisite for separately triaged urgent Production defects; C2 rollout remains separately gated.
