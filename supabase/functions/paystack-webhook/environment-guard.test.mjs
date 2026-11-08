import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { paystackWebhookModeForProject, paystackWebhookDomainMatches } from './environment-guard.mjs';

const prod = 'https://eujxswjspolugrzlsjnn.supabase.co';
const qa = 'https://iukgsukdoowvnhlfmpml.supabase.co';
const liveKey = 'sk_live_' + 'a'.repeat(24);
const testKey = 'sk_test_' + 'b'.repeat(24);

test('platform Paystack webhook only accepts matching project and key modes', () => {
  assert.equal(paystackWebhookModeForProject(prod, liveKey), 'live');
  assert.equal(paystackWebhookModeForProject(qa, testKey), 'test');
  assert.equal(paystackWebhookModeForProject(prod, testKey), null);
  assert.equal(paystackWebhookModeForProject(qa, liveKey), null);
  assert.equal(paystackWebhookModeForProject('https://other.supabase.co', testKey), null);
  assert.equal(paystackWebhookModeForProject('http://localhost:54321', testKey), null);
  assert.equal(paystackWebhookModeForProject(prod + '/rest/v1', liveKey), null);
  assert.equal(paystackWebhookModeForProject(prod, 'garbage'), null);
  assert.equal(paystackWebhookModeForProject(qa, 'sk_test_'), null);
});

test('signed charge events require the correct explicit provider domain', () => {
  for (const mode of ['live', 'test']) {
    assert.equal(paystackWebhookDomainMatches(mode, 'charge.success', mode), true);
    assert.equal(paystackWebhookDomainMatches(mode, 'charge.success', mode === 'live' ? 'test' : 'live'), false);
    assert.equal(paystackWebhookDomainMatches(mode, 'charge.success', undefined), false);
    assert.equal(paystackWebhookDomainMatches(mode, 'charge.success', null), false);
    assert.equal(paystackWebhookDomainMatches(mode, 'charge.success', 'LIVE'), false);
  }
});

test('subscription and invoice events reject explicit cross-mode domains but tolerate legacy omissions', () => {
  for (const type of ['subscription.create', 'subscription.disable', 'subscription.not_renew', 'invoice.update', 'invoice.payment_failed']) {
    assert.equal(paystackWebhookDomainMatches('test', type, 'test'), true);
    assert.equal(paystackWebhookDomainMatches('live', type, 'live'), true);
    assert.equal(paystackWebhookDomainMatches('test', type, 'live'), false);
    assert.equal(paystackWebhookDomainMatches('live', type, 'test'), false);
    assert.equal(paystackWebhookDomainMatches('test', type, undefined), true);
    assert.equal(paystackWebhookDomainMatches('live', type, undefined), true);
  }
  assert.equal(paystackWebhookDomainMatches(null, 'invoice.update', undefined), false);
  assert.equal(paystackWebhookDomainMatches('test', 'invoice.update', 42), false);
});

test('handler validates both environment gates after signature and before database access', () => {
  const src = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  const sig = src.indexOf("if (!(await verifySignature(rawBody, signature)))");
  const mode = src.indexOf('const webhookMode = paystackWebhookModeForProject(');
  const domain = src.indexOf('if (!paystackWebhookDomainMatches(webhookMode, eventType, data.domain))');
  const firstDb = src.indexOf('const existing = await rest<');
  assert.ok(mode > 0 && mode < sig);
  assert.ok(sig > 0 && sig < domain);
  assert.ok(domain > sig && domain < firstDb);
});
