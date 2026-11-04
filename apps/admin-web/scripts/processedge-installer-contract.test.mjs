import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const read = (relative) => readFileSync(resolve(import.meta.dirname,relative),'utf8');
const setup = read('../src/SetupSchedulingAdministration.tsx');
const staff = read('../src/ProcessEdgeInstallerStaffManagement.tsx');
const edge = read('../../../supabase/functions/platform-setup-installer/index.ts');
const migration = read('../../../supabase/migrations/20261104050000_oa5_internal_setup_installer_identity_foundation.sql');
const exclusion = read('../../../supabase/migrations/20261104053000_oa5_installer_invitation_and_merchant_exclusion.sql');
const deviceMigration = read('../../../supabase/migrations/20261104063000_oa5_installer_scoped_device_authority.sql');
const registerAudit = read('../../../supabase/migrations/20261104064500_oa5_installer_register_audit_and_idempotency.sql');
const printerEdge = read('../../../supabase/functions/printer/index.ts');
const printBinding = read('../../../supabase/migrations/20261104065500_oa5_installer_test_print_appointment_binding.sql');
const handover = read('../../../supabase/migrations/20261104070000_oa5_installer_handover_evidence.sql');
const completionLink = read('../../../supabase/migrations/20261104071500_oa5_installer_handover_completion_validation.sql');
const printerProvenance = read('../../../supabase/migrations/20261104073000_oa5_installer_printer_mutation_audit.sql');
const printerRepository = read('../../mobile/src/data/printerRepository.ts');
const printerWorkspace = read('../../mobile/src/redesign/PrinterWorkspace.tsx');
const completion = read('../src/SetupCompletionForm.tsx');
const installerMobile = read('../../mobile/src/components/ProcessEdgeInstallationsView.tsx');

test('ProcessEdge installer management uses the existing approved setup shell',()=>{
  assert.match(setup,/import ProcessEdgeInstallerStaffManagement from '.\/ProcessEdgeInstallerStaffManagement'/);
  assert.match(setup,/resourceTab === 'list' && center\.canManagePlatformMasters/);
  assert.match(setup,/<ProcessEdgeInstallerStaffManagement/);
  assert.match(staff,/invokeJson<StaffResponse>\('platform-setup-installer'/);
  assert.match(staff,/action: 'staff_list', tenantId:/);
  assert.match(staff,/commandId/);
  assert.match(staff,/Revok(e|ed) assignment/);
  assert.doesNotMatch(staff,/SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY/);
});

test('ProcessEdge installer invitation and assignment always use AAL2 and distinct roles',()=>{
  assert.match(edge,/identity\.aal !== 'aal2'/);
  assert.match(edge,/action === 'mine'/);
  assert.match(edge,/bootstrap\.actorRole !== 'admin'/);
  assert.match(edge,/admin\.branch_setup\.manage/);
  assert.match(edge,/auth\.admin\.inviteUserByEmail/);
  assert.match(edge,/SETUP_INSTALLER_INVITE_REDIRECT_URL/);
  assert.match(edge,/platform_admin_link_setup_installer/);
  assert.match(edge,/platform_admin_assign_setup_installer/);
  assert.match(edge,/platform_admin_revoke_setup_installer_assignment/);
  assert.match(migration,/not exists\(select 1 from public\.tenant_members/);
  assert.match(migration,/not exists\(select 1 from public\.platform_admins/);
  assert.doesNotMatch(migration,/alter table public\.platform_admins drop constraint/i);
});

test('Installer device inspection is exact-appointment, MFA-guarded and non-financial',()=>{
  assert.match(edge,/action === 'devices'/);
  assert.match(edge,/identity\.aal !== 'aal2'/);
  assert.match(edge,/p_appointment_id: appointmentId/);
  assert.match(edge,/sellertray_setup_installer_has_assignment/);
  assert.match(edge,/\.eq\('job_type','test'\)/);
  assert.doesNotMatch(edge,/\.from\('orders'\)/);
  assert.doesNotMatch(edge,/\.from\('order_payments'\)/);
});

test('Appointment-scope access is server-only, time and revocation bounded',()=>{
  for(const table of ['sellertray_internal_setup_staff','sellertray_internal_setup_staff_assignments','sellertray_internal_setup_staff_events']){
    assert.match(migration,new RegExp('alter table public\\.'+table+' enable row level security'));
    assert.match(migration,new RegExp('revoke all on public\\.'+table+' from public,anon,authenticated'));
  }
  assert.match(migration,/a\.revoked_at is null and a\.valid_from<=p_as_of/);
  assert.match(migration,/a\.valid_until>p_as_of/);
  assert.match(migration,/ap\.status in \('scheduled','in_progress'\)/);
  assert.match(migration,/x\.line_type='branch_setup'/);
  assert.match(migration,/prevent_sellertray_internal_setup_staff_event_mutation/);
  assert.doesNotMatch(migration,/create or replace function public\.sellertray_user_can_operate_branch/i);
  assert.doesNotMatch(migration,/create or replace function public\.orderdesk_subscription_can_write/i);
});


test('Installer register mutation is command-keyed and appointment-audited',()=>{
  assert.match(registerAudit,/save_sellertray_installer_register/);
  assert.match(registerAudit,/sellertray_installer_register_commands/);
  assert.match(registerAudit,/sellertray_installer_register_events/);
  assert.match(registerAudit,/sellertray_capture_installer_register_change/);
  assert.match(registerAudit,/sellertray_installer_register_mutation_audit/);
  assert.match(registerAudit,/current_setting\('sellertray\.installer_register_command_id'/);
  assert.match(registerAudit,/p_request_key text/);
  assert.match(registerAudit,/v_previous\.request_facts is distinct from v_facts/);
  assert.match(registerAudit,/public\.save_sellertray_register/);
  assert.match(registerAudit,/prevent_sellertray_installer_register_event_mutation/);
});

test('Installer hardware work stays inside appointment-scoped shared printer authority',()=>{
  assert.match(deviceMigration,/sellertray_setup_installer_device_allowed/);
  assert.match(deviceMigration,/auth\.uid\(\)=p_actor_user_id/);
  assert.match(deviceMigration,/auth\.jwt\(\)->>'aal'='aal2'/);
  assert.match(deviceMigration,/auth\.jwt\(\)->>'role'='service_role'/);
  assert.match(deviceMigration,/sellertray_setup_installer_has_assignment/);
  assert.match(deviceMigration,/get_sellertray_accessible_registers/);
  assert.match(deviceMigration,/save_sellertray_register/);
  assert.match(deviceMigration,/save_sellertray_printer_receipt_settings/);
  assert.match(deviceMigration,/request_sellertray_print_job/);
  assert.match(deviceMigration,/transition_sellertray_print_job/);
  assert.match(printerEdge,/if \(!membership\)/);
  assert.match(printerEdge,/verifiedAal2\(token\)/);
  assert.match(printerEdge,/p_appointment_id:appointmentId/);
  assert.match(printerEdge,/action === 'request_business_document_print'/);
  assert.match(printerEdge,/body\.jobType === 'test'/);
  assert.match(printerEdge,/job\?\.job_type === 'test'/);
  assert.doesNotMatch(deviceMigration,/create or replace function public\.orderdesk_subscription_can_write/i);
  assert.doesNotMatch(deviceMigration,/create or replace function public\.sellertray_user_can_operate_branch/i);
});

test('Installer reservations protect identity even after partial invitation delivery',()=>{
  assert.match(edge,/platform_admin_reserve_setup_installer_invitation/);
  assert.match(edge,/platform_admin_begin_setup_installer_delivery/);
  assert.match(edge,/platform_admin_bind_setup_installer_invitation/);
  assert.match(edge,/platform_admin_reconcile_setup_installer_invitation/);
  assert.match(edge,/reconcile_invite/);
  assert.match(exclusion,/before insert or update of user_id on public\.tenant_members/);
  assert.match(exclusion,/before insert or update of user_id on public\.platform_admins/);
  assert.match(exclusion,/sellertray_internal_setup_invitation_reservations/);
  assert.match(exclusion,/get_sellertray_setup_installer_profile/);
  assert.match(staff,/pendingInvitations/);
  assert.match(staff,/Reconcile account/);
  assert.match(staff,/toLocalDateTimeInput\(end\)/);
  assert.doesNotMatch(staff,/setAssignmentExpiresAt\(end\.toISOString\(\)\.slice/);
});

test('Installer printed test is inseparable from the exact assigned appointment',()=>{
  assert.match(printBinding,/sellertray_installer_test_print_bindings/);
  assert.match(printBinding,/request_sellertray_installer_test_print_job/);
  assert.match(printBinding,/assignment_id/);
  assert.match(printBinding,/appointment_id/);
  assert.match(printBinding,/idempotentReplay/);
  assert.match(printBinding,/An earlier unbound test job is not appointment evidence/);
  assert.match(printerEdge,/request_sellertray_installer_test_print_job/);
  assert.match(printerEdge,/sellertray_installer_test_print_bindings/);
  assert.match(edge,/sellertray_installer_test_print_bindings/);
  assert.match(edge,/\.eq\('appointment_id',appointmentId\)/);
  assert.match(handover,/join public\.sellertray_installer_test_print_bindings b/);
  assert.match(handover,/b\.appointment_id=p_appointment_id/);
  assert.match(handover,/b\.assignment_id/);
});

test('Installer handover remains evidence until Admin verifies and completes canonical appointment',()=>{
  assert.match(edge,/action === 'submit_handover'/);
  assert.match(edge,/action === 'handover_list'/);
  assert.match(edge,/identity\.aal !== 'aal2'/);
  assert.match(edge,/platform_installer_submit_handover/);
  assert.match(edge,/platform_admin_list_installer_handovers/);
  assert.match(handover,/sellertray_installer_handover_submissions/);
  assert.match(handover,/prevent_sellertray_installer_handover_mutation/);
  assert.match(handover,/branchConfigured',false/);
  assert.match(handover,/merchantWalkthrough',false/);
  assert.match(handover,/requiresAdminCompletion',true/);
  assert.match(completionLink,/sellertray_validate_installer_handover_completion/);
  assert.match(completionLink,/sellertray_commercial_setup_appointment_events/);
  assert.match(completionLink,/installerHandoverSubmissionId/);
  assert.match(setup,/handover_list/);
  assert.match(setup,/appointmentHandovers/);
  assert.match(setup,/selectedHandover/);
  assert.match(completion,/installerHandoverSubmissionId/);
  assert.match(completion,/branchConfigured: false/);
  assert.match(completion,/merchantWalkthrough: false/);
  assert.match(installerMobile,/submitHandover/);
  assert.match(installerMobile,/AsyncStorage\.setItem/);
  assert.match(installerMobile,/t\.status==='printed'/);
  assert.doesNotMatch(handover,/create or replace function public\.platform_admin_transition_branch_setup/);
});

test('Installer printer mutations and receipt copies preserve immutable exact appointment provenance',()=>{
  assert.match(printerProvenance,/sellertray_installer_printer_commands/);
  assert.match(printerProvenance,/sellertray_installer_printer_events/);
  assert.match(printerProvenance,/sellertray_capture_installer_printer_event/);
  assert.match(printerProvenance,/sellertray_printer_events/);
  assert.match(printerProvenance,/deferrable initially deferred/);
  assert.match(printerProvenance,/prevent_sellertray_installer_printer_events_mutation/);
  assert.match(printerProvenance,/prevent_sellertray_installer_printer_commands_mutation/);
  assert.match(printerProvenance,/sellertray_setup_installer_has_assignment/);
  assert.match(printerProvenance,/v_assignment_id/);
  assert.match(printerProvenance,/new\.before_state,new\.after_state/);
  assert.match(printerProvenance,/save_sellertray_installer_printer/);
  assert.match(printerProvenance,/save_sellertray_installer_receipt_settings/);
  const receiptScope=printerProvenance.slice(printerProvenance.indexOf(
    'create or replace function public.save_sellertray_installer_receipt_settings('));
  assert.match(receiptScope,/pg_advisory_xact_lock[\s\S]*?for update/);
  assert.match(receiptScope,/v_locked_branch is distinct from v_branch/);
  assert.doesNotMatch(receiptScope,/p\.id=p_printer_id for share/);

  assert.match(printerProvenance,/public\.save_sellertray_printer\(/);
  assert.match(printerProvenance,/public\.save_sellertray_printer_receipt_settings\(/);
  assert.match(printerEdge,/rpcName = installerAppointmentId/);
  assert.match(printerEdge,/save_sellertray_installer_printer/);
  assert.match(printerRepository,/save_sellertray_installer_receipt_settings/);
  assert.match(printerRepository,/installerRequestKey/);
  assert.match(printerWorkspace,/printerCommand\.current/);
  assert.match(printerWorkspace,/receiptCommand\.current/);
  assert.match(printerWorkspace,/installerRequestKey/);
});
