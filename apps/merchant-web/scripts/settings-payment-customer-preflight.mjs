import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path) => readFileSync(resolve(import.meta.dirname, '../..', path), 'utf8');
const management = read('merchant-web/src/ManagementPage.tsx');
const settings = read('merchant-web/src/SettingsManagement.tsx');
const customers = read('merchant-web/src/CustomersManagement.tsx');
const backend = read('../supabase/migrations/20261103194500_pre_c2_customer_optional_phone_identity.sql');
assert.doesNotMatch(management, /<PaymentBranchManagement/);
assert.match(settings, /activeTab === 'payments' \? <section className="page-stack settings-payment-availability"/);
assert.match(settings, /<PaymentBranchManagement tenantId=\{tenantId\}/);
assert.match(settings, /id="settings-panel-payments"/);
assert.match(customers, /Phone <span className="muted">Optional<\/span>/);
assert.doesNotMatch(customers, /<label>Phone<SellerTrayInput required/);
assert.match(customers, /p_phone: newPhone.trim\(\) \|\| null/);
assert.match(backend, /manual:unlinked:/);
assert.match(backend, /if v_phone is not null and v_phone !~/);
console.log('Settings payment tab isolation and optional customer phone preflight passed.');
