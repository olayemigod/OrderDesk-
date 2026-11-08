import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { activeWhatsAppTenantLookupQuery } from './routing-boundary.mjs';

test('inbound WhatsApp lookup excludes retired and disconnected tenants', () => {
  const q = activeWhatsAppTenantLookupQuery('1271836092686870');
  const parsed = new URL('https://dummy.example' + q);
  assert.equal(parsed.pathname, '/rest/v1/tenants');
  assert.equal(parsed.searchParams.get('select'), 'id');
  assert.equal(parsed.searchParams.get('whatsapp_phone_number_id'), 'eq.1271836092686870');
  assert.equal(parsed.searchParams.get('retired_at'), 'is.null');
  assert.equal(parsed.searchParams.get('whatsapp_connection_status'), 'eq.connected');
  assert.equal(parsed.searchParams.get('limit'), '1');
});

test('lookups escape provider IDs and reject empty/non-string IDs', () => {
  assert.equal(new URL('https://dummy.example' + activeWhatsAppTenantLookupQuery('id&retired_at=not.is.null'))
    .searchParams.get('whatsapp_phone_number_id'), 'eq.id&retired_at=not.is.null');
  for (const invalid of ['', null, undefined, 123]) {
    assert.throws(() => activeWhatsAppTenantLookupQuery(invalid), TypeError);
  }
});

test('webhook consults the guarded lookup before legal policy consent', () => {
  const src = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  const start = src.indexOf('async function resolveConsentedWebhookPhoneNumbers(');
  const end = src.indexOf('\nfunction extractInboundMessages(', start);
  assert.ok(start > 0 && end > start);
  const scoped = src.slice(start, end);
  const lookup = scoped.indexOf('activeWhatsAppTenantLookupQuery(phoneNumberId)');
  const consent = scoped.indexOf('sellertray_whatsapp_consent_active');
  assert.ok(lookup > 0 && consent > lookup);
  assert.ok(!scoped.includes("'&whatsapp_phone_number_id=eq.'"), 'never bypass the guarded lookup');
});
