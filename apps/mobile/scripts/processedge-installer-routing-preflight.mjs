import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read=(path)=>readFileSync(resolve(import.meta.dirname,path),'utf8');
const entry=read('../src/ProvisionedApp.tsx');
const identity=read('../src/components/ProcessEdgeIdentityGate.tsx');
const installer=read('../src/components/ProcessEdgeInstallationsView.tsx');
const edge=read('../../../supabase/functions/platform-setup-installer/index.ts');
const sql=read('../../../supabase/migrations/20261104050000_oa5_internal_setup_installer_identity_foundation.sql');

assert.match(entry,/import \{ ProcessEdgeIdentityGate \} from '\.\/components\/ProcessEdgeIdentityGate'/);
assert.match(entry,/<AuthGate>\s*<ProcessEdgeIdentityGate>\s*<LegalAcceptanceGate>/);
assert.match(identity,/action: 'profile'/);
assert.match(identity,/if \(profile\.isInstaller\)/);
assert.match(identity,/state\.kind === 'installer'/);
assert.match(identity,/ProcessEdgeInstallationsView/);
assert.match(identity,/kind: 'error'/);
assert.match(identity,/state\.message/);
assert.match(identity,/Retry account check/);
assert.match(identity,/if \(request !== epoch\.current\) return/);
assert.match(identity,/sessionResult\.session\?\.user\?\.id/);
assert.match(identity,/setState\(\{ kind: 'merchant' \}\)/);
assert.doesNotMatch(identity,/createBusiness|tenant_members|setActiveBusiness/);

assert.match(installer,/getAuthenticatorAssuranceLevel/);
assert.match(installer,/listFactors/);
assert.match(installer,/factorType:'totp'/);
assert.match(installer,/challengeAndVerify/);
assert.match(installer,/status==='active'/);
assert.match(installer,/action:'mine'/);
assert.doesNotMatch(installer,/save_sellertray_register|save_sellertray_printer|sellertray_user_can_operate_branch/);

assert.match(edge,/if\(action === 'profile'\)/);
assert.match(edge,/get_sellertray_setup_installer_profile/);
assert.match(edge,/identity\.aal !== 'aal2'/);
assert.match(sql,/get_sellertray_setup_installer_profile/);
assert.match(sql,/get_sellertray_setup_installer_work/);
assert.match(sql,/revoke all on function public\.get_sellertray_setup_installer_profile\(uuid\)/);
assert.match(sql,/revoke all on function public\.get_sellertray_setup_installer_work\(uuid\)/);
console.log('ProcessEdge installer account routing and AAL2 isolation preflight passed.');
