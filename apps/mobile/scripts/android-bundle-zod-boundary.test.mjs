import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { inspectAndroidJsBundle } from './android-bundle-zod-boundary.mjs';

test('fails closed if the export is missing or contains no JS', () => {
  const root = mkdtempSync(join(tmpdir(), 'sellertray-zod-'));
  try {
    assert.equal(inspectAndroidJsBundle(join(root, 'no-export')).ok, false);
    writeFileSync(join(root, 'android.hbc'), 'opaque bytecode');
    const result = inspectAndroidJsBundle(root);
    assert.equal(result.scanned, 0);
    assert.equal(result.ok, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('permits a normal Android JS bundle without legacy Zod symbols', () => {
  const root = mkdtempSync(join(tmpdir(), 'sellertray-zod-'));
  try {
    const nested = join(root, '_expo', 'static', 'js', 'android');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, 'index.js'), 'const greeting = "SellerTray";');
    const result = inspectAndroidJsBundle(root);
    assert.equal(result.ok, true);
    assert.equal(result.scanned, 1);
    assert.deepEqual(result.suspectFiles, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('blocks a legacy Zod v3 marker without dumping JS contents', () => {
  const root = mkdtempSync(join(tmpdir(), 'sellertray-zod-'));
  try {
    const path = join(root, 'index.jsbundle');
    writeFileSync(path, 'var ZodFirstPartyTypeKind = {};');
    const result = inspectAndroidJsBundle(root);
    assert.equal(result.ok, false);
    assert.equal(result.scanned, 1);
    assert.equal(result.suspectFiles.length, 1);
    assert.deepEqual(result.suspectFiles[0].markers, ['ZodFirstPartyTypeKind']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
