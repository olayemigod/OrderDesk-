import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { inspectAndroidJsBundle } from './android-bundle-zod-boundary.mjs';

test('fails closed if the export is missing or lacks JavaScript/Hermes artifacts', () => {
  const root = mkdtempSync(join(tmpdir(), 'sellertray-zod-'));
  try {
    assert.equal(inspectAndroidJsBundle(join(root, 'no-export')).ok, false);
    writeFileSync(join(root, 'android.png'), 'opaque asset');
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

test('scans Hermes .hbc bytecode for readable legacy Zod v3 markers', () => {
  const root = mkdtempSync(join(tmpdir(), 'sellertray-hermes-'));
  try {
    writeFileSync(join(root, 'index.hbc'), Buffer.concat([
      Buffer.from([0, 1, 2, 3]),
      Buffer.from('ZodEffects'),
      Buffer.from([4, 5, 6]),
    ]));
    const result = inspectAndroidJsBundle(root);
    assert.equal(result.scanned, 1);
    assert.equal(result.hermesFiles, 1);
    assert.equal(result.ok, false);
    assert.deepEqual(result.suspectFiles[0].markers, ['ZodEffects']);
    writeFileSync(join(root, 'index.hbc'), Buffer.from([0, 1, 2, 3, 4]));
    const clean = inspectAndroidJsBundle(root);
    assert.equal(clean.ok, true);
    assert.equal(clean.hermesFiles, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
