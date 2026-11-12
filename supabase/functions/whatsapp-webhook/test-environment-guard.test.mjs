import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  metaTestWebhookConfiguration,
  metaTestWebhookPayloadAllowed,
} from './test-environment-guard.mjs';

const QA = 'https://iukgsukdoowvnhlfmpml.supabase.co';
const LIVE = 'https://eujxswjspolugrzlsjnn.supabase.co';
const APP = '1429945732160146';
const PHONE = '1271836092686870';

test('Test disallows the old Production-linked phone even with prior QA app configuration', () => {
  for (const args of [
    [QA, '', PHONE], [QA, '955360573542769', PHONE],
    [QA, APP, ''], [QA, APP, '123456'],
    [QA, APP, PHONE], [QA + '/', APP, PHONE],
    [QA + '/functions/v1/whatsapp-webhook', APP, PHONE],
    [QA + '?redirect=production', APP, PHONE],
    [QA, APP, '987654321000001'],
  ]) {
    assert.deepEqual(metaTestWebhookConfiguration(...args), { ok: false, isTest: true });
  }
});

test('Test inbound events stay blocked until a separately attested unique QA phone is allowlisted', () => {
  const config = metaTestWebhookConfiguration(QA, APP, PHONE);
  for (const ids of [[], ['other'], [PHONE], [PHONE, 'other'], null, undefined, 'not-an-array']) {
    assert.equal(metaTestWebhookPayloadAllowed(config, ids), false);
  }
  // No successful Test config can be synthesized merely by flipping the
  // configuration flag; payload phone allowlisting remains a separate gate.
  assert.equal(metaTestWebhookPayloadAllowed({ ok: true, isTest: true }, [PHONE]), false);
  assert.equal(metaTestWebhookPayloadAllowed({ ok: true, isTest: true }, ['987654321000001']), false);
});

test('Production and local development keep their existing routing behavior', () => {
  for (const url of [LIVE, 'http://localhost:54321']) {
    const config = metaTestWebhookConfiguration(url, APP, PHONE);
    assert.deepEqual(config, { ok: true, isTest: false });
    assert.equal(metaTestWebhookPayloadAllowed(config, []), true);
  }
});

test('Test host guard precedes GET verification and PostgREST receipt writes', () => {
  const s = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  const handler = s.indexOf("Deno.serve(withObservability('whatsapp-webhook'");
  const setup = s.indexOf('metaTestWebhookConfiguration(', handler);
  const get = s.indexOf("if (request.method === 'GET')", handler);
  const post = s.indexOf('metaTestWebhookPayloadAllowed(', get);
  const receipt = s.indexOf('recordWebhookReceipt(payload)', post);
  const hmac = s.indexOf('verifyMetaSignature(rawBody, signature, META_APP_SECRET)', get);
  assert.ok(handler > 0 && setup > handler && get > setup, 'Test app config before GET');
  assert.ok(post > hmac && receipt > post, 'signed payload checked before receipt write');
  assert.ok(s.includes('extractWebhookPhoneNumberIds(payload)'));
});
