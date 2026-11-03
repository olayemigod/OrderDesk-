import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const selector = readFileSync(resolve(import.meta.dirname, '../src/redesign/PosCustomerSelector.tsx'), 'utf8');
assert.match(selector, /newPhone\.trim\(\) && !phone/);
assert.match(selector, /Phone number \(optional\)/);
assert.match(selector, /phone is blank|phone is blank|Phone is optional/);
assert.doesNotMatch(selector, /if \(!phone\) \{/);
assert.match(selector, /onChange\(\{ id: null, name, phone \}\)/);
console.log('Mobile name-only POS customer selection preflight passed.');
