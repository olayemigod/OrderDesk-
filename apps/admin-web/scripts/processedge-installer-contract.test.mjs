import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const read = (relative) => readFileSync(resolve(import.meta.dirname,relative),'utf8');
const setup = read('../src/SetupSchedulingAdministration.tsx');
const staff = read('../src/ProcessEdgeInstallerStaffManagement.tsx');
const edge = read('../../../supabase/functions/platform-setup-installer/index.ts');
const migration = read('../../../supabase/migrations/20261104050000_oa5_internal_setup_installer_identity_foundation.sql');

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
