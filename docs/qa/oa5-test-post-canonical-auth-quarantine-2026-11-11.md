# OA5 — historical Test Auth cohort quarantine after a separately approved canonical reconstruction

**Status:** source-only, offline verification tool and reviewed *read-only* SQL templates. **Not run against a reconstructed hosted Test**: reconstruction is still NO-GO. PR #228 is draft. Target exclusively Supabase **Test** `iukgsukdoowvnhlfmpml`; **never Production** `eujxswjspolugrzlsjnn`, Tandar, or any production URL/phone/email destination.

## Why this additional gate is necessary

The actual historical Test contains **5 Auth users, 6 session records, 3 tenant-membership records and 3 platform administrator records**, with **all five** users holding at least one membership or administrator assignment, and **one** holding both. Historical user accounts and managed Auth session state are outside ordinary user-created database migration cleanup. A green disposable-local pgTAP regression with a synthetic orphan user does **not** prove these five real historical Test identities are quarantined in a rebuilt hosted Test database.

The next gate must compare the exact **same five historical Auth identities** before and after reconstruction, even after separately approved synthetic QA users have been provisioned. Neither user IDs nor email addresses may appear in GitHub, PR comments, workflow logs or the operator report. Store both JSON results under protected private custody.

The cohort identity is therefore a **SHA-256 of the sorted UUID string sequence**, returned in private snapshot JSON (not committed). Together with an exact snapshot cutoff and count, this detects silent replacement of, or disappearance from, the five-person historical Auth cohort. A digest is **not an access token, restore proof, authorization or a replacement for protected archived user records**.

## Stage A — historical Test-only cohort snapshot before any reset (read-only)

Only execute on the **existing historical Test** and under a separately reviewed operator change window **before** the separately approved hosted reconstruction. This query reads IDs internally to hash them but returns **no individual identity or email**. The timestamp is truncated to UTC seconds to make an exact immutable cutoff for the later query. Verify the cohort count is five. Its immutable pre-rebuild JSON must be privately preserved; do not add it to source control.

```sql
with stamp as (
  select date_trunc('second', transaction_timestamp()) as cutoff
), cohort as (
  select u.id from auth.users u cross join stamp
  where u.created_at < stamp.cutoff
)
select jsonb_build_object(
  'schema_version',1,
  'project_ref','iukgsukdoowvnhlfmpml',
  'purpose','pre-rebuild-historical-auth-cohort',
  'captured_at_utc',to_char(stamp.cutoff at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'cohort',jsonb_build_object(
    'historical_users',(select count(*)::integer from cohort),
    'identity_set_sha256',(select encode(sha256(convert_to(
      string_agg(id::text,',' order by id::text),'UTF8')),'hex') from cohort)
  )
) as private_pre_rebuild_snapshot from stamp;
```

## Stage B — read-only historical identity/cohort authority snapshot after canonical replay

**Do not run this step now.** Execute only after a separately authorised, isolated hosted Test reconstruction, independent provider isolation, canonical replay verification, and first **synthetic** QA merchant/user provisioning. Replace the two placeholders *locally* with the exact archived Stage A cutoff and verified source Git SHA. Never paste real UUIDs, credentials, JWTs or a copied SQL archive into this command. The query returns only aggregate counts and the protected set fingerprint. It has no SQL DML, DDL or RPC calls.

```sql
with params as (
  select '__PRE_REBUILD_CAPTURE_UTC__'::timestamptz as cutoff
), cohort as (
  select u.id from auth.users u cross join params
  where u.created_at < params.cutoff
)
select jsonb_build_object(
  'schema_version',1,
  'project_ref','iukgsukdoowvnhlfmpml',
  'purpose','post-canonical-historical-auth-cohort',
  'captured_at_utc',to_char(date_trunc('second',transaction_timestamp()) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'historical_cutoff_utc','__PRE_REBUILD_CAPTURE_UTC__',
  'reviewed_source_sha','__REVIEWED_40_HEX_GIT_SHA__',
  'cohort',jsonb_build_object(
    'historical_users',(select count(*)::integer from cohort),
    'identity_set_sha256',(select encode(sha256(convert_to(
      string_agg(id::text,',' order by id::text),'UTF8')),'hex') from cohort)
  ),
  'grants',jsonb_build_object(
    'tenant_member_grants',(select count(*)::integer from public.tenant_members m join cohort h on h.id=m.user_id),
    'branch_user_access_grants',(select count(*)::integer from public.branch_user_access b join cohort h on h.id=b.user_id),
    'tenant_member_capability_grants',(select count(*)::integer from public.tenant_member_capabilities c join cohort h on h.id=c.user_id),
    'platform_admin_grants',(select count(*)::integer from public.platform_admins a join cohort h on h.id=a.user_id),
    'platform_admin_capability_grants',(select count(*)::integer from public.platform_admin_capability_grant_versions g join cohort h on h.id=g.grantee_user_id),
    'setup_installer_staff_links',(select count(*)::integer from public.sellertray_internal_setup_staff s join cohort h on h.id=s.user_id),
    'setup_installer_assignment_links',(select count(*)::integer from public.sellertray_internal_setup_staff_assignments a join cohort h on h.id=a.staff_user_id),
    'setup_invitation_auth_or_email_links',(
      select count(distinct r.command_id)::integer
      from public.sellertray_internal_setup_invitation_reservations r
      join auth.users u on r.auth_user_id=u.id or r.email_normalized=lower(btrim(u.email))
      join cohort h on h.id=u.id
    )
  ),
  'canonical',jsonb_build_object(
    'applied_migrations',(select count(*)::integer from supabase_migrations.schema_migrations),
    'new_auth_users',(select count(*)::integer from auth.users u cross join params p where u.created_at>=p.cutoff),
    'new_business_members',(select count(*)::integer from public.tenant_members m join auth.users u on u.id=m.user_id cross join params p where u.created_at>=p.cutoff),
    'businesses_present',(select count(*)::integer from public.tenants)
  )
) as private_post_rebuild_snapshot;
```

**Explicit STOP:** If the SQL fails because a table is missing, STOP and investigate canonical source parity; do **not** remove the missing category from the SQL just to get a green result. If existing historical accounts must legitimately be deleted, that is a **different** separately approved recovery design and requires a modified reviewed baseline, not a coerced pass. Even where all SQL links are zero, old sessions/JWTs may still be valid: **do not infer real-client or Edge authorization from a database count**.

## Stage C — independent offline reconciliation (no hosted access)

Store the *single JSON object* returned by each SQL in private files. On a checkout exactly matching the reviewed candidate SHA, use:

```sh
node scripts/qa/oa5-test-post-canonical-auth-quarantine.mjs --check /secure/private/pre-rebuild-auth-cohort.json /secure/private/post-rebuild-auth-cohort.json
```

The checker requires the same five UUID identities and sorted-fingerprint digest, one exact UTC cutoff, snapshots within the stage/freshness windows, **zero** historical Auth cohort assignments to merchant, Branch, capability, Platform Admin, installer or invitation-reservation authority, **457** canonical migrations and nonvacuous new QA user/merchant counts. The source SHA must match checked-out Git HEAD. It produces no private identities or fingerprints in stdout/stderr. It only reports `sql_authority_link_quarantine_evidence_consistent` and always rejects interpreting its result as deploy/cleanup/merchant QA authorization.

## Additional gates still required after a structural PASS

1. Run **real authenticated** historical Test actor read/denied-write tests for *each* retained historical identity against a newly provisioned synthetic merchant, Branch, order, payment and Admin service (including service-role Edge actor-subject validation), without sending real messages or exposing secrets. No actual credentials need be published. The previous pgTAP synthetic orphan regression is a useful control but is not this gate.
2. Verify historical Auth session/JWT lifecycle, current redirect URLs, MFA and customer-facing invitation/activation route safety. Disabling old actor authority in canonical SQL does not revoke already issued JWTs or historical preview access.
3. Verify independently isolated Meta/WhatsApp, payment provider, SMTP, FCM, AI and cron network destinations. Existing historical Vercel Previews and reviewer continuity remain protected; the clean QA host must not rebind them to unsafe backends.
4. Preserve encrypted Agreement/audit archive and historical migration ledger, and obtain independent approval for every irreversible operation. Only then can broader merchant QA, APK testing or C2 acceptance proceed.

**Status remains:** source/CI-only preparation; no historic hosted Test reset or migration replay, no old-user deletion, no cron pause, no Production or Tandar change.