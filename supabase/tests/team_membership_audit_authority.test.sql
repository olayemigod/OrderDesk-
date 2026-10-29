begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(26);

select extensions.ok(
  to_regclass('public.sellertray_membership_events') is not null,
  'membership event ledger exists'
);

select extensions.ok(
  (select relrowsecurity from pg_class where oid = 'public.sellertray_membership_events'::regclass),
  'membership event ledger keeps RLS enabled'
);

select extensions.ok(
  not has_table_privilege('authenticated', 'public.sellertray_membership_events', 'SELECT'),
  'authenticated clients cannot read membership audit rows directly'
);

select extensions.ok(
  not has_table_privilege('authenticated', 'public.sellertray_membership_events', 'INSERT'),
  'authenticated clients cannot forge membership audit rows'
);

select extensions.ok(
  not has_table_privilege('authenticated', 'public.sellertray_membership_events', 'UPDATE'),
  'authenticated clients cannot rewrite membership audit rows'
);

select extensions.ok(
  not has_table_privilege('authenticated', 'public.sellertray_membership_events', 'DELETE'),
  'authenticated clients cannot delete membership audit rows'
);

select extensions.ok(
  exists (
    select 1
    from pg_trigger tg
    where tg.tgrelid = 'public.sellertray_membership_events'::regclass
      and tg.tgname = 'sellertray_membership_events_append_only'
      and not tg.tgisinternal
  ),
  'membership ledger has an append-only mutation guard'
);

select extensions.ok(
  not has_table_privilege('authenticated', 'public.tenant_members', 'INSERT'),
  'authenticated clients cannot create membership rows directly'
);

select extensions.ok(
  not has_table_privilege('authenticated', 'public.tenant_members', 'UPDATE'),
  'authenticated clients cannot change membership rows directly'
);

select extensions.ok(
  not has_table_privilege('authenticated', 'public.tenant_members', 'DELETE'),
  'authenticated clients cannot remove membership rows directly'
);

select extensions.ok(
  not has_table_privilege('authenticated', 'public.tenant_invitations', 'SELECT'),
  'authenticated clients cannot bypass governed invitation reads'
);

select extensions.ok(
  not has_table_privilege('authenticated', 'public.tenant_invitations', 'INSERT'),
  'authenticated clients cannot create invitations directly'
);

select extensions.ok(
  not has_table_privilege('authenticated', 'public.tenant_invitations', 'UPDATE'),
  'authenticated clients cannot mutate invitations directly'
);

select extensions.ok(
  not has_table_privilege('authenticated', 'public.tenant_invitations', 'DELETE'),
  'authenticated clients cannot delete invitations directly'
);

select extensions.ok(
  has_function_privilege('service_role', 'public.accept_orderdesk_team_invitation(uuid,uuid)', 'EXECUTE'),
  'explicit invitation acceptance is service-governed'
);

select extensions.ok(
  has_function_privilege('service_role', 'public.decline_orderdesk_team_invitation(uuid,uuid)', 'EXECUTE'),
  'explicit invitation decline is service-governed'
);

select extensions.ok(
  has_function_privilege('service_role', 'public.list_orderdesk_pending_team_invitations(uuid)', 'EXECUTE'),
  'pending invitation read model is service-governed'
);

select extensions.ok(
  has_function_privilege('service_role', 'public.list_orderdesk_team_membership_history(uuid,uuid,integer)', 'EXECUTE'),
  'membership history is exposed through a governed service RPC'
);

select extensions.ok(
  has_function_privilege('service_role', 'public.platform_admin_transfer_tenant_ownership(uuid,uuid,text,text,uuid)', 'EXECUTE'),
  'ownership transfer is exposed only through governed platform authority'
);

select extensions.ok(
  position('Automatic invitation claiming is no longer supported' in pg_get_functiondef('public.claim_orderdesk_team_invitations(uuid,text)'::regprocedure)) > 0,
  'legacy bulk invitation claim fails closed'
);

select extensions.ok(
  position('insert into public.tenant_members' in lower(pg_get_functiondef('public.invite_orderdesk_team_member(uuid,uuid,text,text)'::regprocedure))) = 0,
  'creating an invitation never directly creates membership, including for existing auth users'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.tenant_invitations'::regclass
      and c.conname = 'tenant_invitations_status_check'
      and pg_get_constraintdef(c.oid) like '%declined%'
  ),
  'invitation lifecycle explicitly supports decline'
);

select extensions.ok(
  position('team.ownership_transfer' in pg_get_functiondef('public.platform_admin_transfer_tenant_ownership(uuid,uuid,text,text,uuid)'::regprocedure)) > 0
  and position('command_id' in pg_get_functiondef('public.platform_admin_transfer_tenant_ownership(uuid,uuid,text,text,uuid)'::regprocedure)) > 0,
  'ownership transfer writes platform audit and carries an idempotency command id'
);

select extensions.ok(
  position('platform_admin_has_capability' in pg_get_functiondef('public.platform_admin_transfer_tenant_ownership(uuid,uuid,text,text,uuid)'::regprocedure)) > 0
  and position('admin.merchant_ownership.transfer' in pg_get_functiondef('public.platform_admin_transfer_tenant_ownership(uuid,uuid,text,text,uuid)'::regprocedure)) > 0,
  'ownership transfer requires the scoped Platform Admin ownership-transfer capability'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.sellertray_membership_events'::regclass
      and c.conname = 'sellertray_membership_events_event_type_check'
      and pg_get_constraintdef(c.oid) like '%initial_owner_assigned%'
  ),
  'membership event vocabulary includes initial owner assignment'
);

select extensions.ok(
  position('initial_owner_assigned' in pg_get_functiondef('public.provision_business_for_user(uuid,text,text,text,text,text)'::regprocedure)) > 0
  and position('sellertray_membership_events' in pg_get_functiondef('public.provision_business_for_user(uuid,text,text,text,text,text)'::regprocedure)) > 0,
  'initial Business provisioning records the authenticated Owner in the membership audit ledger'
);

select * from extensions.finish();
rollback;
