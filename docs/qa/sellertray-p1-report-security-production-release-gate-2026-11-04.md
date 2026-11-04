# SellerTray P1 reporting security — production release gate

**Checkpoint:** 04/11/2026 (dd/mm/yyyy). **Status:** verified source correction; **PRODUCTION NOT DEPLOYED**. This is a release-preparation record, not change authorization.

## Why urgent

Three authenticated-callable `SECURITY DEFINER` report RPCs run as `postgres` and historically checked `current_user <> 'postgres'` before checking the requesting merchant. That condition is false inside a postgres-owned SECURITY DEFINER function even when the caller belongs to another Business. Their report/Branch checks were effectively bypassed.

The affected RPCs are `get_sellertray_branch_stock_as_of(uuid,uuid,timestamptz)`, `get_sellertray_branch_stock_valuation(uuid,uuid,timestamptz)` and `get_sellertray_order_profitability(uuid,uuid)`. Do not confuse a confirmed authorization vulnerability with confirmed malicious use; no exploitation evidence was established.

PR [#218](https://github.com/olayemigod/OrderDesk-/pull/218) merged the correction and the separate two-trigger EXECUTE ACL hardening into the Build 47 integration branch, at merge SHA `df19633929d1dd46121f87c20f5379174cf22778`. Original PRs #215/#216 were closed as superseded **without independently merging their older, diverged OA5 branch**. PR #214 remains draft and is not production release authorization.

## Production baseline — read-only evidence at 04/11/2026

- Supabase project ref: `eujxswjspolugrzlsjnn` (live merchants, including Tandar). Current live ledger: **390 applied migrations**, latest `20261104180647_pos_draft_delete_financial_documents_guard`.
- All three privileged report functions still have the postgres-owner bypass and remain directly executable by `authenticated` (not `anon`). Existing production definition MD5s respectively:
  - historical stock: `8779c03739093d8e7926dd06b2ea9a5a`;
  - valuation: `91de6f97cc27b38edcb2e9adb97c15d6`;
  - order profitability: `d83ecb80540a3793669062414b020f14`.
- The two snapshot trigger helpers remain callable by both `anon` and `authenticated`, although they are trigger-only functions. Their current definitions' MD5s: Order `37c11f041c76ab09591680839dc8963b`; Receipt `122b3c0579091244f50823af97ea487b`.
- Compared the **actual live** definition of each reporting RPC with migration `20261104214453_fix_security_definer_report_scope_bypass.sql`: after removing exactly one owner-identity exemption and normalizing the final SQL terminator, **all three definitions match byte-for-byte**. No business calculation, field, UOM, ledger, valuation or reporting expression needs rewriting.
- The Agreement Package Test project (`iukgsukdoowvnhlfmpml`) holds the two SQL hardenings and passed disposable transaction-scoped role/Branch tests, but its schema/ledger is **not certified as OA5 functional staging** and must not be treated as a production-parity hosting or Android acceptance environment.

## Pre-release gates — STOP if any condition fails

1. **Explicit production-change approval and rollback ownership.** Record approved release window, operator and reviewer, protected backup/recovery capability, change/incident reference, Vercel/merchant baseline and communications plan. A generic `continue` request does not itself waive the repository's separate production release gate.
2. **Recheck actual live ledger and function bodies immediately before release.** The five MD5s above are snapshot expectations, not timeless truths. Any drift, absence of functions, altered EXECUTE grants or missing enabled triggers requires code review before applying anything.
3. **Reconcile migration-order barrier.** On the current Build 47/OA5 lineage, multiple **unreleased** OA5/pre-C2 migrations and **17 C2 foundation** migrations predate the security files. Live has already passed some source timestamps with the isolated POS-draft hotfix. **Never run a generic `supabase db push`** or assume applying only the two security versions will allow all older pending migrations to deploy later by normal forward order. Obtain a reviewed, version-ledger-consistent **security-only emergency release plan** with explicit handling of older pending migrations (future forward-dated convergence where needed) and prove it does not activate C2.
4. **Pin exact reviewed source.** The SQL changes are:
   - `supabase/migrations/20261104213746_restrict_branch_snapshot_trigger_execute_acl.sql`
   - `supabase/migrations/20261104214453_fix_security_definer_report_scope_bypass.sql`
   Both must be applied transactionally in that order, and both before `20261104234000_cost_aware_inventory_adjustment.sql` if that later release proceeds. Use a migration runner that can record the *approved source version accurately*. Do **not** assume an ad hoc SQL execution or connector-generated migration timestamp matches the repository filename; do not forge or edit the migration ledger.
5. **Evidence of CI and role-matrix tests.** At the PR #218 security head `7b3608ae09f65a5385b8db45807428ddcba0bf7f`, Database CI `41923412841` and Mobile CI `41923412678` passed. Transactional QA tests cover Owner, Manager, explicit Manager report denial, Cashier default/wrong Branch, outsider, service role and immutable Branch snapshots. The merged Build 47 head and any later integrated release candidate require their **own** clean-history CI and release review; do not substitute older green status.
6. **Keep the environment boundary.** No Tandar/real-merchant QA writes, no production merchant reassignment, no cross-boundary test APK, no third paid project, and no unsolicited WhatsApp, email, payment or printer output.

## Read-only preflight (no deployment)

The release operator checks source and current database separately. This SQL **only selects metadata**; it is safe to run against Production:

```sql
select p.proname,
       md5(pg_get_functiondef(p.oid)) as definition_md5,
       p.prosecdef as security_definer,
       p.proowner::regrole::text as owner,
       (p.prosrc ~* 'current_user[[:space:]]*<>[[:space:]]*''postgres''') as unsafe_owner_exemption,
       has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
       has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
       has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in (
    'get_sellertray_branch_stock_as_of',
    'get_sellertray_branch_stock_valuation',
    'get_sellertray_order_profitability',
    'snapshot_sellertray_order_branch_name',
    'snapshot_sellertray_receipt_branch_name'
  )
order by p.proname;
```

Also verify both existing, enabled trigger attachments on `public.orders` and `public.sellertray_print_jobs`. Record the actual last-applied migration, not a cached assumption. Never treat a successful SELECT as release approval.

## Post-release acceptance — only after separately approved migration execution

- Confirm actual **migration ledger entries** and **function definitions**, not just a reported deployment success.
- Confirm all three report RPCs have **no owner-identity exemption**, still enforce signed JWT/Branch and report capability, and preserve the original grants where intended.
- Confirm `anon` and `authenticated` cannot EXECUTE either trigger-only helper, `service_role` retains EXECUTE, and both Branch-name snapshot triggers remain enabled.
- Run bounded, **read-only** authorized Owner/Manager/Staff reporting checks against the correct Branch, explicit denied-capability and wrong-Branch negative tests using approved identities. Do not create a new production synthetic Business to test.
- Compare existing inventory quantity, derived valuation and reporting totals before/after for a fixed Branch/as-of moment; numbers and prior audit/COGS evidence must remain unchanged. A rejected unauthorized read is the intended behavioral difference.
- Confirm Merchant Web, Mobile and Admin can still consume their governed report paths. WhatsApp/AI and offline clients must use shared truth; no new channel-specific data or release APK is created.
- If any authority differs, stop promotion, capture logs, and make an approved **forward fix**; do not silently restore the vulnerable owner bypass.

## Parallel work unaffected

Pre-C2 OA5 acceptance, archived Test-project rebuild authorization, Build 47 cost-aware stock adjustment/UOM pricing, platform preview quota policy and C2 foundation remain separately gated. The live Business/trial runtime remains authoritative until OA5C acceptance and deliberate C2 cutover.

**Single next release decision:** approve a **security-only** production migration sequence, backup/rollback plan and version-ledger reconciliation that do not include the pending C2 foundations. Without that separate release approval, the production vulnerability is not closed.
