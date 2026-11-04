import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (relative) => readFileSync(resolve(import.meta.dirname,relative),'utf8');
const workspace = read('../src/redesign/PrinterWorkspace.tsx');
const migration = read('../../../supabase/migrations/20261103213000_oa5_inactive_purchased_branch_device_preparation.sql');
const proof = read('../../../supabase/migrations/20261103210000_oa5_branch_setup_hardware_proof_gate.sql');

assert.match(workspace,/get_sellertray_manageable_branches/);
assert.match(workspace,/setDeviceBranchId\(nextId\)/);
assert.match(workspace,/deviceEditEpoch/);
assert.match(workspace,/setDeviceAddress/);
assert.match(workspace,/setMerchantFooter/);
assert.match(workspace,/if\(deviceEditEpoch\.current!==editEpoch\)return/);
assert.match(workspace,/if\(deviceEditEpoch\.current===editEpoch\)setError/);
assert.match(workspace,/const saveEpoch=deviceEditEpoch\.current/);
assert.match(workspace,/const saveTenant=tenantId,saveBranch=deviceBranchId,saveRegister=registerId/);
assert.match(workspace,/refreshPrinters\(saveTenant,saveBranch,saveRegister,saveEpoch\)/);
assert.match(workspace,/if\(deviceEditEpoch\.current===epochAtRequest\)setPrinters\(rows\)/);
assert.ok((workspace.match(/if\(deviceEditEpoch\.current!==saveEpoch\)return/g)??[]).length >= 2,
  'Save must discard stale completion and refresh when setup Branch changes');
assert.match(workspace,/setPrinters\(\[\]\);resetForm\(true\)/);
assert.match(workspace,/disabled=\{saving\|\|printingId!==null\} onPress=\{\(\)=>chooseDeviceBranch\(b\.id\)\}/);
assert.match(workspace,/disabled=\{saving\|\|printingId!==null\} onPress=\{\(\)=>\{if\(r\.id===registerId\)return;/);
assert.match(workspace,/const testEpoch=deviceEditEpoch\.current/);
assert.match(workspace,/const testTenant=tenantId/);
assert.match(workspace,/if\(deviceEditEpoch\.current===testEpoch\)setNotice/);
assert.match(workspace,/if\(deviceEditEpoch\.current===testEpoch\)setError/);
assert.match(workspace,/if\(nextId===deviceBranchId\|\|saving\|\|printingId!==null\)return/);
assert.match(workspace,/disabled=\{saving\|\|printingId!==null\}/);

assert.match(workspace,/if\(deviceEditEpoch\.current===saveEpoch\)setError/);
assert.match(workspace,/loadCashRegisters\(tenantId,deviceBranchId\)/);
assert.match(workspace,/loadPrintingCapabilities\(tenantId,deviceBranchId\)/);
assert.match(workspace,/branchId:saveBranch/);
assert.match(workspace,/Setup only/);
assert.match(workspace,/not active for sales/);
assert.doesNotMatch(workspace,/setActiveBranch\(/);
assert.match(migration,/sellertray_can_prepare_purchased_branch_devices/);
assert.match(migration,/s\.line_type='branch_setup'/);
assert.match(migration,/v_job_type='test' and public\.sellertray_can_prepare_purchased_branch_devices/);
assert.match(migration,/v_job\.job_type='test' and public\.sellertray_can_prepare_purchased_branch_devices/);
assert.doesNotMatch(migration,/create or replace function public\.sellertray_user_can_operate_branch/i);
assert.match(proof,/j\.status='printed'/);
assert.match(proof,/j\.completed_at<=p_ready_at/);
console.log('Mobile device-only inactive Branch preparation preflight passed.');
