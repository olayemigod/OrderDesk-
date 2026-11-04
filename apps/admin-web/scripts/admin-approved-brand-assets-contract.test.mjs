import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const entry = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const brandCorrection = readFileSync(new URL('../src/admin-brand-asset-convergence.css', import.meta.url), 'utf8');
const approvedMark = readFileSync(new URL('../public/brand/sellertray-v2-mark.svg', import.meta.url), 'utf8');

test('Admin browser favicon uses the approved SellerTray v2 mark', () => {
  assert.match(html, /rel="icon"[^>]+href="\/brand\/sellertray-v2-mark\.svg"/);
  assert.doesNotMatch(html, /sellertray-admin-icon\.png/);
  assert.match(approvedMark, /viewBox="0 0 128 128"/);
});

test('authenticated Admin shell resolves the approved v2 mark after legacy presentation layers', () => {
  const contextIndex = entry.indexOf("import './admin-context-convergence.css'");
  const brandIndex = entry.indexOf("import './admin-brand-asset-convergence.css'");
  assert.ok(contextIndex >= 0 && brandIndex > contextIndex, 'approved brand correction must load after historical Admin convergence layers');
  assert.match(brandCorrection, /workspace-sidebar \.workspace-sidebar-brand::before/);
  assert.match(brandCorrection, /sellertray-v2-mark\.svg/);
  assert.doesNotMatch(brandCorrection, /sellertray-admin-icon\.png/);
});

test('Admin embedded favicon artwork matches the approved Mobile v2 mark byte for byte', () => {
  const embedded = approvedMark.match(/href="data:image\/png;base64,([A-Za-z0-9+/=]+)"/);
  assert.ok(embedded, 'Admin favicon must embed the approved PNG artwork');
  const actual = Buffer.from(embedded[1], 'base64');
  const approved = readFileSync(new URL('../../mobile/assets/sellertray-v2-mark-128.png', import.meta.url));
  assert.deepEqual(actual, approved, 'Do not corrupt or fork the approved SellerTray v2 brand artwork');
});
