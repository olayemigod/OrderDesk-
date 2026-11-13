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

## 13 November follow-up — read-only Auth session provenance and Vercel resource check

**Observed at 2026-11-13T06:38:19Z, Test-only SQL SELECT:** 5 managed Auth users, **7** session records, 22 refresh tokens; historical Businesses 3, memberships 3, Platform Admin assignments 3 and applied historical migrations 54. Four Test jobs remained inactive and the pending HTTP queue remained empty. Grouping `auth.sessions.created_at` by UTC date returned **five** session rows created before 8 November (2 on 27 October, 1 on 30 October, 2 on 1 November), **one on 9 November** and **one on 12 November**. Both post-archive sessions belong to users currently holding historical Business memberships **and** Platform Admin assignments. This count-only query did not retrieve user IDs, emails, token strings, provider secrets or business data, and does not prove that the five pre-archive session IDs equal those in the encrypted archive.

**Important correction to the operational gate:** the encrypted 7 November archive records **five** Auth sessions; the 9/11 dated operational census and historical-authority checker record **six**; **seven** exist now. The previously considered *one-session* review applies only to the sixth session and is not permission to delete or waive either current extra session. Existing `oa5-test-live-census`, `oa5-test-managed-boundary` and `oa5-test-historical-auth-lineage` gates **correctly fail closed** at seven. Their immutable baseline values must **not** be silently changed to seven merely to pass preflight; a separate independently reviewed session lineage/custody disposition is required. In particular, neither the newly observed privileged account sessions nor previously issued JWTs are automatically inert because cron is paused.

**Read-only Vercel provider metadata:** `sellertray-merchant` and `sellertray-admin` both still have `ssoProtection.enabled=true` and `deploymentType=prod_deployment_urls_and_all_previews`. The sellertray.com project-domain inventory lists `app.sellertray.com` on Merchant and `admin.sellertray.com` on Admin, while **neither** `test.sellertray.com` nor `test-admin.sellertray.com` is attached. Both Vercel projects still contain encrypted Preview Supabase URL/key environment variables and older branch-specific Preview mappings, which were **not decrypted or modified** here. This confirms project-level protection and current domain non-binding only: it does **not** establish historic reviewer continuity, compiled artifact backend routing, secure recipient delivery or that an eventual Test Preview uses the Test backend. No temporary share link was created, and no Vercel settings were changed.

**Disposition after this observation:** cron safety remains PASS at the time captured; historical Auth lineage remains **OPEN/NO-GO**, independent external provider containment remains **OPEN/NO-GO**, and Method B hosted reconstruction has **not** been authorised. The first future Test reconstruction checkpoint must use a newly refreshed (<10-minute) snapshot, independently reviewed source/CLI impact, and a separately approved operator execution record. Production and Tandar were not contacted or changed by this Test-only SQL/Vercel metadata review.

### Historical protected Preview deployments — independent metadata check

The Vercel deployment API was queried **read-only** for each of the **five** frozen deployment IDs in `docs/qa/oa5-historical-vercel-preview-custody-2026-11-09.json`. **5/5** still report `READY`, with the exact originally recorded Git branch/source SHA and one deployment URL alias each. **0/5** has a current Production/QA custom-domain alias. Neither the deployments nor their aliases were replaced, shared, retired, redeployed or modified. This improves *metadata preservation* evidence but is not authenticated reviewer browser-access continuity, proof that historic compiled JS points to the intended backend, or permission to move the Test backend. Original deployed HTML/JS captures, protected reviewer access and safe Test-only routing must still be independently checked before a destructive operation.
