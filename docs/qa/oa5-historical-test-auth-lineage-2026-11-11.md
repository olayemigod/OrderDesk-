# OA5 — historical Test Auth and merchant authority census (11 November 2026)

**Scope:** read-only metadata SELECT on existing **Test** Supabase project `iukgsukdoowvnhlfmpml`. **Production `eujxswjspolugrzlsjnn` and Tandar excluded**. The query never selects user IDs, emails, names, phone numbers, JWTs, external endpoints, secrets or business rows.

## Observed Test state at 2026-11-11T19:51:31Z

| Count-only class | Observed |
|---|---:|
| Auth users / sessions | 5 / 6 |
| Tenant-member rows / distinct linked Auth users | 3 / 3 |
| Tenant-member rows lacking corresponding Auth user | 0 |
| Branch user access / active access | 0 / 0 |
| Platform-admin rows / rows linked to Auth user | 3 / 3 |
| Distinct Auth users holding either a business membership or platform-admin role | **5 of 5** |
| Distinct Auth users holding **both** business membership and platform-admin roles | **1** |
| Member capabilities / platform-admin capability-grant versions | 0 / 0 |
| Businesses / Branches | 3 / 3 |
| Historical Agreement Packages / applied migrations | 5 / 54 |

**Security interpretation:** Historic Test retains operational **membership and administrator assignments**. These are legitimate historical Test artifacts but cannot be treated as inert credentials after reconstructing a *new* canonical business schema. Deleting or resetting SQL by itself does not prove Auth identity/session revocation; the old five Auth users and six active session records exist independently. Do not remove current old member/admin rows, reset Auth or revoke sessions merely from this observation. All **five** historical Auth users hold at least one business or platform-admin assignment, and one identity holds both. That makes a blanket claim that historical Auth identities are already inert **incorrect**. Historical Vercel Preview reviewer access must remain preserved until independently addressed.

## Exact read-only census SQL

Run ONLY against `iukgsukdoowvnhlfmpml` when a fresh protected operator snapshot is required. It emits aggregate counts only, not identifiers. Wrap the single returned JSON object under the required `purpose` key in private storage, then invoke the offline checker. A screenshot or a dated narrative cannot satisfy the less-than-ten-minute pre-reset freshness gate.

```sql
select jsonb_build_object(
 'schema_version',1,
 'project_ref','iukgsukdoowvnhlfmpml',
 'purpose','historic-test-auth-authority-before-rebuild',
 'captured_at_utc',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
 'counts',jsonb_build_object(
  'auth_users',(select count(*)::int from auth.users),
  'auth_sessions',(select count(*)::int from auth.sessions),
  'tenant_members',(select count(*)::int from public.tenant_members),
  'member_auth_users',(select count(distinct m.user_id)::int from public.tenant_members m join auth.users u on u.id=m.user_id),
  'member_rows_without_auth_user',(select count(*)::int from public.tenant_members m left join auth.users u on u.id=m.user_id where u.id is null),
  'branch_user_access',(select count(*)::int from public.branch_user_access),
  'branch_access_auth_users',(select count(distinct a.user_id)::int from public.branch_user_access a join auth.users u on u.id=a.user_id),
  'active_branch_access',(select count(*)::int from public.branch_user_access where can_operate),
  'platform_admins',(select count(*)::int from public.platform_admins),
  'platform_admin_users_matching_auth',(select count(*)::int from public.platform_admins p join auth.users u on u.id=p.user_id),
  'auth_users_with_any_member_or_platform_admin_authority',(select count(distinct user_id)::int from (
    select tm.user_id from public.tenant_members tm join auth.users u on u.id=tm.user_id
    union select pa.user_id from public.platform_admins pa join auth.users u on u.id=pa.user_id
  ) known_auth),
  'auth_users_with_both_member_and_platform_admin_authority',
    (select count(distinct tm.user_id)::int from public.tenant_members tm
     join public.platform_admins pa on pa.user_id=tm.user_id
     join auth.users u on u.id=tm.user_id),
  'admin_capability_grants',(select count(*)::int from public.platform_admin_capability_grant_versions),
  'member_capability_rows',(select count(*)::int from public.tenant_member_capabilities),
  'businesses',(select count(*)::int from public.tenants),
  'branches',(select count(*)::int from public.branches),
  'historic_agreement_rows',(select count(*)::int from public.sellertray_agreement_packages),
  'historical_migration_versions',(select count(*)::int from supabase_migrations.schema_migrations)
 )
) as snapshot;
```

Store the value of `snapshot` only as private `fresh-historical-test-auth-lineage.json`; do not commit it or put it in public GitHub/CI logs. Validate offline with:

```sh
node scripts/qa/oa5-test-historical-auth-lineage.mjs --check /secure/private/fresh-historical-test-auth-lineage.json
```

**What PASS means:** the archived Test Auth/member/admin grant topology has not drifted since this measured baseline. It does **not** mean the old user has been quarantined, that historical Preview reviewers retain access, or that a hosted cleanup or Test reset is authorized.

**Next gate:** historical actor identity-cohort quarantine versus synthetic merchant/branch permission boundary *after a separately approved rebuild*, including old JWT/session acceptance, cross-business read/write, admin capability leakage and sign-in/redirect tests. These tests are distinct from today's clean-canonical **synthetic orphan** test; use protected private identity references rather than copying live Auth data into source control. Meta, PSP, email, FCM and four active Test cron jobs remain separately blocked. No remote DML/DDL, cron pause, provider call or APK was performed.
