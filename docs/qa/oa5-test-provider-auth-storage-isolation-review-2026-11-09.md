# OA5 — independent Test-only provider isolation and managed Auth/Storage cleanup review (09/11/2026)

**Scope:** Source/documentation review only for standalone Test `iukgsukdoowvnhlfmpml`, building on draft PR #228 at source head `fb1733cb0a60f7b780f67ef4d1810518bf59ac8e`. **Decision: NO-GO** for hosted cleanup, cron pause, migration, Edge deployment, callbacks, Preview, APK, or C2 cutover. Production `eujxswjspolugrzlsjnn`, all live merchants including Tandar, the live Meta/PSP integrations, and existing production web domains are excluded.

This document **closes the review definition, not the external acceptance gate**. Provider-console attestation, exact Auth/Storage service operation, recovery feasibility, maintenance approval and separate destructive authorization remain open. It does not contain executable reset, user-deletion, webhook-repointing or secret-rotation commands.

## Current independent read-only Test snapshot

On 09/11/2026 the connected Supabase Test project was confirmed `ACTIVE_HEALTHY` (PostgreSQL 17). Count-only SQL, with **no identifiers, secrets, email addresses, recipient lists or object paths read**, returned:

| Managed surface | Count |
| --- | ---: |
| `auth.users` | 5 |
| `auth.sessions` | 6 |
| `auth.identities` | 1 |
| `auth.refresh_tokens` | 21 |
| `auth.mfa_factors` | 1 |
| `auth.mfa_challenges` | 8 |
| `auth.one_time_tokens` / `auth.flow_state` | 0 / 0 |
| `auth.oauth_clients` / `auth.sso_providers` | 0 / 0 |
| `storage.buckets` / `storage.objects` | 3 / 0 |
| Storage multipart uploads/parts, analytics/vector buckets and abandoned-artifact rows | 0 |
| Active Test `cron.job` / pending `net.http_request_queue` | 4 / 0 |

These are **point-in-time counts**, not a signed post-pause census, a complete row-level diff or proof that the underlying object store has no orphaned files. The existing encrypted 07/11 recovery archive has five Auth sessions; the owner approved disposal of **only the extra sixth post-archive session** in a future separately approved rebuild. The other managed-state counts are **not** additions to that approval, and their presence does not by itself prove post-archive drift. The existing private exact-scope short-lived review and fresh census rules remain mandatory. Do **not** rewrite archived baseline counts or reinterpret the session approval to cover other unknown losses.

## Provider and ingress review — deny until independently attested

| Surface | Source/previous evidence | Mandatory external decision/evidence | Status |
| --- | --- | --- | --- |
| Meta/WhatsApp inbound | Test-only source guard requires QA app `1429945732160146`, phone `1271836092686870`, matching signed payload phone IDs; production routing code unchanged. **This phone ID also appears in retired Production tenant history**, so screenshots from separate screens do not prove exclusive QA ownership. | One independently reviewed Meta app-to-number/WABA association, *distinct* Test app secret/verify token, current callback/subscription inventory, Test-only synthetic recipient policy and a way to stop incoming callbacks before teardown. Do not repoint live Meta or recycle a merchant phone. | **OPEN — callback forbidden** |
| Paystack platform billing | Test guard requires canonical Test backend plus `sk_test_` and matching signed event mode; live uses `sk_live_`. Earlier Test provider callback was unset. This prefix check is not proof of an isolated provider account or deployed bundle. | Provider-side Test-key ownership/mode, Test-only signed callback destination, no live settlement/customer effect, HMAC/replay/idempotency and charge-domain denial evidence; keep live callback unchanged. | **OPEN — callback forbidden** |
| Flutterwave/merchant payments | Previously inspected Test/live callback fields were empty. This does not establish secret isolation. | Confirm whether OA5 needs Flutterwave; if not, explicitly disabled in Test. If needed, verify sandbox-only key, callback/signature and test recipient/merchant configuration before activation; no live change. | **OPEN — do not enable** |
| SMTP/email/invitations | Test Auth redirect configuration was visually reviewed, but SMTP sender credentials, recipient containment, provider identity and real callback behavior were not attested. | Protected Test-specific mail transport or a non-delivering capture/sandbox sink, synthetic recipient allowlist, redirect/PKCE/deep-link verification and no outbound live customer mail. Test merchant invitation and password-reset links must resolve to protected Test domains/QA native URI, never Production. | **OPEN — no real email tests** |
| Firebase/FCM/Expo push | Dedicated Firebase `sellertray-test` and Android `ng.processedge.sellertray.qa` registered; protected QA sender/Expo transport and delivered-device proof are pending. | Independently verify Test-only FCM credentials, sender, application identity and permitted QA devices; no Production credentials or real-merchant tokens. | **OPEN — no push activation** |
| AI/order parser, notification workers and other Edge transports | The current WhatsApp function can invoke `ORDER_PARSER_URL` and Test workers may use `net.http_post`. Current Test is four active jobs and five historical Edge deployments, not a certified 50-function runtime. | Document all transitive external destinations and cost-bearing secrets, disable or mock in Test until safe, check outbound network queues and provider traffic. Deploy only a separate reviewed Test function allowlist after canonical schema. | **OPEN** |
| Merchant/Admin domains and Auth redirects | Owner confirmed Standard Vercel Authentication for historic deployment URLs and public canonical Production domains. The two Test custom domains remain unattached; historical compiled Preview backend identity is unknown. | Preserve historical five Preview records/reviewer continuity, protect `test.sellertray.com` / `test-admin.sellertray.com` before any binding, prove both point exclusively to verified Test and redirects do not fall back to Production. | **OPEN** |

**Fail-closed rule:** a zero provider data-table count, an unset callback field, a provider-key prefix, a screenshot of a different console page or a successful source test **is not** Test-only provider isolation. Collect protected, independently reviewer-signed, non-secret evidence; publish only opaque reference IDs in the PR/operator record. Never run external test events against a Production merchant or phone number.

## Managed Auth cleanup contract (future operation only)

1. **Preserve and scope first:** Confirm the Test project twice, archive/restore evidence and exact source SHA. Privately reconcile the Auth user, identity, session, refresh-token, MFA factor/challenge, invitation/OTP, OAuth and Auth configuration inventories against the archived snapshot where available. Count-only results do not establish all row contents are unchanged. Identify Auth-linked public tables, storage ownership and foreign-key/triggers before choosing deletion order.
2. **Contain ingress and issuance:** Independently approve the Test ingress freeze and stop new sign-ins/invites/reset links before any data clearing. Reversible pause of the four exact Test cron schedules is a different explicit authorization. Capture the **fresh post-pause** all-age unfinished-run and `pg_net` zero-queue snapshot (<10 minutes old), and independently verify no already-dispatched outbound request remains. Existing live snapshots with four active jobs do not pass.
3. **Choose a supported service-managed Auth operation:** Review Test-only administrative Auth API/Console operations for old synthetic identities, sessions and associated MFA state, with explicit operator credentials, permission boundaries, one-way effects, identity cleanup and post-action verification. Do **not** assume a remote SQL schema reset deletes `auth.*`. Do **not** delete rows directly from Supabase-managed Auth tables as a substitute for supported service operations. The existing approval to discard one additional session is not permission to delete accounts now.
4. **Treat JWTs as a separate post-deletion exposure:** Supabase documents that hard-deleting an Auth user removes their sessions/refresh authority but previously issued stateless access JWTs may remain valid until expiry. The reviewer must record Test JWT expiry, block legacy Test clients during transition, and verify protection for sensitive API/RPC paths where session revocation must take effect immediately. A new QA identity cannot be assumed to inherit the old Auth identity/session/2FA enrollment.
5. **Prove the outcome independently:** After a separately authorised rebuild, confirm only new synthetic Owner/Staff/Installer identities exist, no retired Test session can refresh or write, MFA/AAL2 works with the new setup and Test invitation/reset links reach Test-only endpoints. No user ID, refresh token, credential, session token or private Auth row belongs in Git.

References: [Supabase User Management](https://supabase.com/docs/guides/auth/managing-user-data) and [User sessions](https://supabase.com/docs/guides/auth/sessions).

## Managed Storage cleanup contract (future operation only)

- Three existing buckets and zero `storage.objects` rows are **not** proof that all backing blobs, signed URLs, stale multipart uploads, cached CDN content or legacy bucket configuration are harmless. Independently review bucket ownership, public/private flags, policy/grants and API-level object listings in protected Test only. Current ancillary multipart/analytics/vector/abandoned-artifact counts are zero.
- **Use the supported Storage API / Console** for any future object removal and verify actual object-store consequences. Supabase explicitly warns that direct SQL deletion of `storage.objects` leaves orphaned backend files. Do not blindly drop or edit managed `storage` schemas, buckets, metadata, policies or internal migrations with remote `db reset`.
- With zero current objects, **no object-delete operation is presently justified**. Preserve the three bucket definitions until the canonical Test configuration is reviewed. If an API-level listing disagrees or new objects appear, STOP and re-archive/re-review; no silent delete.
- Treat existing signed URLs, tokens, CDN caching, object retention and Storage-owned Auth dependencies as independent security checks. After the future authorised clean Test setup, verify only canonical Test buckets/policies exist, no Production access, and synthetic upload/read/delete permissions work under RLS.

References: [Supabase Storage object deletion](https://supabase.com/docs/guides/storage/management/delete-objects) and [Storage schema ownership](https://supabase.com/docs/guides/storage/schema/design).

## Exact rebuild / rollback review boundary

**Do not nominate generic remote `supabase db reset --linked` as a complete hosted-project wipe.** Its user-created-database-entity behavior does not imply managed Auth, Storage, secrets, Edge deployments, scheduled jobs or external provider callbacks are erased. A separate reviewed Test-specific operation design must enumerate user-created schemas/grants/triggers, the historical 54-row migration ledger, canonical 457-migration replay, 5 legacy functions (including Agreement PDF probe), Auth/Storage management actions, worker schedules, provider settings and external identity redirects. Do not spoof history or deploy all 50 Edge functions at once.

The future operator change record must include: named executor and independent reviewer; exact Test project identity and source; full scope of irreversible Test-only loss; protected archive SHA and independent restore logs; precise per-service supported operations and privileges; ordered pre/post-condition queries; failure/abort points; a tested rollback or explicitly accepted *non-recoverable* Auth/session/Storage/provider side-effect boundary; and **a separate operation-specific destructive execution approval**. An encrypted SQL/Agreement archive does **not** establish that deleted Auth sessions/MFA credentials, physical objects, secrets, provider routing or historical Preview artifacts can be restored as they were.

## Final independent review disposition

- **Reviewed and documented:** Test identity and current managed-state counts; provider ingress and outbound safety criteria; Auth JWT/session/MFA pitfalls; API-only Storage deletion requirements; no-reset-without-reviewed-method boundary. This document intentionally makes **no hosted mutation**.
- **Not accepted/closed:** external Meta ownership and all Test-only secret/sink attestations; exact Auth/Storage service-managed action design and its irreversibility review; historical Preview compiled backend and reviewer evidence; exact safe hosted schema rebuild and rollback; approved four-cron pause with fresh subsequent quiescence; independent post-archive private session-loss record; operation-specific destructive approval.
- **Operational outcome:** OA5 Test rebuild remains **NO-GO**. `docs/qa/oa5-staging-backend-attestation.json` must remain `state: blocked`; C2 and Production/Tandar remain untouched. No Preview, APK or new paid resource is needed to review this plan.

## 09/11/2026 — restricted Auth reference occupancy and safe cleanup order

**Independent read-only Test catalog + row-count inspection** on `iukgsukdoowvnhlfmpml` (09/11/2026) found:

- Exactly **64 public foreign-key constraints to `auth.users`** across **57 public tables**: **30 RESTRICT**, **8 CASCADE**, **26 SET NULL**. There are also **10 internal Auth** and **2 `sellertray_private`** foreign keys to Auth users, and **no non-internal trigger** on `auth.users` at this snapshot. These counts describe current Test, not canonical post-rebuild schema.
- Of the **30 public RESTRICT relationships**, **10 reference existing Test Auth user rows** and **20 currently have zero matching references**.
- The 10 populated relationships total **51 referenced rows across FK columns**, *not necessarily 51 distinct underlying application records*. The exact occupancy is:

| Public table | Restricted FK column | Matching reference rows |
| --- | --- | ---: |
| `platform_admin_audit` | `actor_user_id` | 14 |
| `sellertray_commercial_agreement_template_versions` | `published_by_user_id` | 3 |
| `sellertray_commercial_installment_obligations` | `created_by_user_id` | 3 |
| `sellertray_commercial_order_forms` | `issued_by_user_id` | 5 |
| `sellertray_commercial_orders` | `created_by_user_id` | 5 |
| `sellertray_commercial_price_versions` | `approved_by_user_id` | 6 |
| `sellertray_commercial_price_versions` | `created_by_user_id` | 6 |
| `sellertray_master_agreement_acceptances` | `accepted_by_user_id` | 3 |
| `sellertray_master_agreement_versions` | `published_by_user_id` | 1 |
| `sellertray_order_form_confirmations` | `confirmed_by_user_id` | 5 |
| **Total across relationships** | | **51** |

Queries counted records matching existing `auth.users.id` via `SELECT count(*)`, without returning any user ID, email, row content, access token or private Agreement data. No mutation was performed. The 51-count baseline is **not contained in the original archived restore checker**, so it must not be represented as independent row-by-row historical backup parity. A reviewer must repeat the protected count-only scope just before a separately approved maintenance operation and STOP on unreviewed drift.

### Mandatory dependency-aware operation order — review proposal, not execution

1. **Custody first:** preserve protected archived Agreement and audit evidence with manifest/hash and verified offline restore; document the five historic Preview dependencies and the operator's accepted irreversible losses. Confirm exact standalone Test project and target/source commit, not Production.
2. **Freeze Test ingress/egress separately:** independently verify safe SMTP, Meta, PSP, Firebase and any AI/notification sink, and arrange a Test-only ingress block. Request specific authority to pause the exact four Test cron schedules; afterward verify recent zero-active/zero-unfinished/all-age and `pg_net` queue evidence plus already dispatched provider requests. No change to live Production provider callbacks.
3. **Review the historical user-created schema cleanup** (including `public` Agreement, commercial, audit and invitation artifacts; nonpublic SellerTray schema; existing 54-row migration ledger; historical Edge probe), preserving immutable evidence first. Explicitly decide whether to remove Test-only linked user-created records and constraints as part of a controlled canonical-schema replacement. **Never loosen production FK constraints, manually falsify migration history or selectively erase audit rows merely to make Auth deletion work.** The exact schema/ledger cleanup operation, privileges, failure boundaries and recovery route remain unapproved.
4. **After the old application references have been safely removed and verified**, a separately authorized Test operator may use supported Supabase Auth administration to decommission old synthetic Auth accounts/sessions/MFA enrollment. Check that Storage object ownership and bucket metadata have been independently reviewed first. Do not interpret the owner's single additional session-loss approval as account-deletion permission. JWT access tokens may remain usable until expiry unless appropriately constrained; block legacy Test clients during the transition.
5. **Apply the separately approved canonical migration set in order**, verify RLS, grants, tenancy, branch/ledger and audit invariants and re-create only approved Test-specific service configuration and synthetic new Auth identities. Deploy only explicitly reviewed Edge functions and sandbox sinks in phases; never deploy all 50 solely for roster parity.
6. **Rollback boundary:** database restore proof alone cannot undo an Auth hard delete, reinstate the same MFA/session credentials, retract a provider callback or restore already emitted messages/payments. The operator record must identify exactly which steps permit a Test restore versus which require a new synthetic identity or manual provider recovery, and require explicit separate approval for irreversible steps.

**Disposition:** This closes the *source-level occupancy investigation*, not the hosted cleanup-method approval. Test Auth, Storage, public data, schedules and provider configuration were not changed. The OA5 backend attestation stays blocked.

Reference: [Supabase Auth user management and JWT limitations](https://supabase.com/docs/guides/auth/managing-user-data); [Storage API deletion semantics](https://supabase.com/docs/guides/storage/management/delete-objects).

## 09/11/2026 — fresh Test-side provider deployment and data census

A new connected **read-only Supabase Test** check confirmed that the **five** ACTIVE deployed Edge Functions are `master-agreements`, `platform-admin`, `commercial-agreements`, `agreement-pdf-runtime-probe` (historical acceptance custody) and `platform-admin-settlement`. In particular, **`whatsapp-webhook` and `paystack-webhook` are not deployed in this standalone Test project**.

The current Test database aggregate also returned: `tenant_whatsapp_connections=0`, `sellertray_private.whatsapp_connection_credentials=0`, `merchant_payment_methods=0`, `merchant_push_devices=0`, `sellertray_private.runtime_config=0`; **four pg_cron jobs remain ACTIVE** and `net.http_request_queue=0`. These observations establish only Test project metadata/data state; they do **not** establish Meta/PSP/SMTP/FCM external callback ownership, absence of future ingress, external credential segregation, or transitive functions' side-effect safety. Do not assume that an absent Test webhook function or zero Test rows proves external providers are disconnected, and do not change live callbacks to manufacture QA evidence.

**Review split:** Test-side callback deploy/data inventory is now read-only corroborated; external provider console and protected secret/sink attestations remain **OPEN**, as do exact managed Auth/Storage cleanup, cron pause and irreversible rollback authorization. No service operation, webhook invocation, SQL mutation, app build or provider configuration change occurred.


## 09/11/2026 — separate pre-Auth-decommission dependency safety gate

This is an **additional offline safety precondition before a future separately approved Auth-admin user deletion**, NOT a requirement that historic App-to-Auth FKs be zero before the separately approved *earlier* Test user-created-schema cleanup. In the current, unreconstructed Test project, these counts are deliberately nonzero and this guard **MUST FAIL**.

**Read-only standalone Test census (09/11/2026):** 66 foreign keys from non-Auth schemas to \`auth.users\`: 30 RESTRICT, eight CASCADE, 28 SET NULL, zero other actions; zero non-internal triggers directly on \`auth.users\`. This includes the 64 public FKs plus two from \`sellertray_private\`. The ten populated public RESTRICT relationships with 51 matching FK references are separately documented above. None of these counts are an authorization to erase the old agreement/audit data.

New offline script: \`scripts/qa/oa5-test-auth-decommission-boundary.mjs\`; regression suite: \`scripts/qa/oa5-test-auth-decommission-boundary.test.mjs\` (wired to OA5 source-only CI). The script requires an **exact Test project ID**, exact purpose/schema, a **fresh under-ten-minutes** private aggregate, zero *all* externally referencing FKs (including CASCADE, SET NULL and future schemas), zero non-internal \`auth.users\` triggers and internally consistent counts. It checks **only** the post-legacy-cleanup database dependency prerequisite. It always returns \`auth_user_deletion_authorized:false\` and \`destructive_execution_authorized:false\`, even if the metadata precondition passes.

### Future protected snapshot — SQL is SELECT-only and does not delete anything

The review operator must independently confirm the connected **standalone Test** project is \`iukgsukdoowvnhlfmpml\` before running the following SELECT. Return only an aggregate JSON object, privately held outside Git/CI. Verify the target and historic archive custody again when capturing it for a future Test-only handover.

~~~sql
WITH f AS (
  SELECT con.confdeltype AS delete_code, srcns.nspname AS referencing_schema
  FROM pg_constraint con
  JOIN pg_class src ON src.oid=con.conrelid
  JOIN pg_namespace srcns ON srcns.oid=src.relnamespace
  JOIN pg_class dst ON dst.oid=con.confrelid
  JOIN pg_namespace dstns ON dstns.oid=dst.relnamespace
  WHERE con.contype='f' AND dstns.nspname='auth' AND dst.relname='users'
    AND srcns.nspname <> 'auth'
)
SELECT jsonb_build_object(
  'schema_version', 1,
  'project_ref', 'iukgsukdoowvnhlfmpml',
  'purpose', 'pre-auth-decommission-dependency-only',
  'captured_at_utc',
    to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'counts', jsonb_build_object(
    'external_auth_user_fks', (SELECT count(*)::int FROM f),
    'external_restrict_fks', (SELECT count(*)::int FROM f WHERE delete_code='r'),
    'external_cascade_fks', (SELECT count(*)::int FROM f WHERE delete_code='c'),
    'external_set_null_fks', (SELECT count(*)::int FROM f WHERE delete_code='n'),
    'external_other_fks', (SELECT count(*)::int FROM f WHERE delete_code NOT IN ('r','c','n')),
    'auth_users_custom_triggers', (
      SELECT count(*)::int FROM pg_trigger t
      JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_namespace ns ON ns.oid=c.relnamespace
      WHERE ns.nspname='auth' AND c.relname='users' AND NOT t.tgisinternal)
  )
) AS snapshot;
~~~

When a separately authorized, reviewed legacy App-schema cleanup has actually been completed, an independent reviewer can perform this isolated offline check with the protected snapshot:

~~~sh
node scripts/qa/oa5-test-auth-decommission-boundary.mjs --check /secure/private/test-auth-decommission-fk-snapshot.json
~~~

**CURRENT OUTCOME: BLOCKED**, since the untouched Test schema contains 66 external Auth-user FKs. Never set these counts to zero artificially or drop constraints just to satisfy the checker. Before a future Auth-admin action, the independent reviewer must separately verify the encrypted/restore-tested archive and immutability of Agreement/audit evidence, the approved historical App-schema retirement result, remaining Storage/signed-URL ownership, existing provider callbacks/secrets, old JWT expiry/session revocation, irreversible MFA/session loss, operator access and operation-specific approval. A zero-FK snapshot is **necessary but not sufficient** for Auth deletion. Any changed schema, time, counts or unexpected metadata forces a fresh review. No service mutation or Auth API/Console action was performed as part of this gate.
