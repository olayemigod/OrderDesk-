import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const read = (path) => readFileSync(resolve(import.meta.dirname, '../..', path), 'utf8');
const transport = read('admin-web/src/supabase.ts');
const workspace = read('admin-web/src/AdminWorkspace.tsx');

test('rejected persisted Admin sessions recover or return to sign in', () => {
  assert.match(transport, /if \(response\.status === 401\)/);
  assert.match(transport, /supabase\.auth\.refreshSession\(\)/);
  assert.match(transport, /sendRequest\(refreshedSession\.access_token\)/);
  assert.match(transport, /supabase\.auth\.signOut\(\{ scope: 'local' \}\)/);
  assert.match(transport, /Authentication required\. Sign in again\./);
  assert.match(workspace, /if \(!session\) return <LoginScreen \/>;/);

  const authRecovery = transport.indexOf('if (response.status === 401)');
  const genericFailure = transport.indexOf('if (!response.ok)');
  assert.ok(authRecovery >= 0 && genericFailure >= 0 && authRecovery < genericFailure, '401 recovery must run before generic request failure handling');
});

test('authentication recovery preserves request idempotency and does not weaken authorization', () => {
  assert.match(transport, /requestBody\.requestId = requestId/);
  assert.match(transport, /const sendRequest = async \(accessToken: string\)/);
  assert.doesNotMatch(transport, /service[_-]?role/i);
  assert.doesNotMatch(transport, /status === 403[\s\S]*signOut/);
});
