// QA evidence only: a passing check rules out known legacy Zod v3 markers
// from inspectable Android JS output. It is NOT a vulnerability fix and
// never replaces the npm dependency audit or native APK security approval.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Explicit v3 API symbol names survive ordinary Metro minification where
// the corresponding module is bundled. This is an indicator scan, not a
// complete software composition analysis.
const LEGACY_ZOD_MARKERS = [
  'ZodFirstPartyTypeKind',
  'ZodEffects',
  'ZodArray',
];
// Expo SDK 57 normally exports a Hermes .hbc bundle, not a plain .js
// file. Hermes may encode/compress strings, so a negative raw-byte
// scan is only limited evidence, not proof that a library is absent.
const INSPECTABLE_BUNDLE = /\.(?:js|jsbundle|bundle|mjs|hbc)$/i;

export function inspectAndroidJsBundle(directory) {
  const root = resolve(directory);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    return { ok: false, scanned: 0, suspectFiles: [], reason: 'Missing Android export directory' };
  }
  const queue = [root];
  let scanned = 0;
  let hermesFiles = 0;
  const suspectFiles = [];
  while (queue.length) {
    const dir = queue.pop();
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, item.name);
      if (item.isDirectory()) {
        queue.push(path);
      } else if (item.isFile() && INSPECTABLE_BUNDLE.test(item.name)) {
        scanned++;
        if (/\.hbc$/i.test(item.name)) hermesFiles++;
        const bytes = readFileSync(path);
        const hits = LEGACY_ZOD_MARKERS.filter((marker) =>
          bytes.includes(Buffer.from(marker, 'utf8')),
        );
        if (hits.length) {
          suspectFiles.push({ path, markers: hits });
        }
      }
    }
  }
  if (!scanned) {
    return {
      ok: false, scanned, hermesFiles, suspectFiles,
      reason: 'No Android JS or Hermes bytecode bundles found; cannot inspect export',
    };
  }
  return {
    ok: suspectFiles.length === 0, scanned, hermesFiles, suspectFiles,
    reason: suspectFiles.length ? 'Legacy Zod 3 markers found in merchant Android JS export' : null,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = inspectAndroidJsBundle(process.argv[2] ?? '.ci-dist');
  console.log('Inspected Android JS/Hermes bundle artifacts:', result.scanned);
  console.log('Hermes bytecode artifacts (raw-byte marker scan):', result.hermesFiles ?? 0);
  for (const item of result.suspectFiles) {
    console.error('Unexpected legacy Zod marker(s):', item.path, item.markers.join(', '));
  }
  if (!result.ok) {
    console.error(result.reason);
    process.exitCode = 1;
  } else {
    console.log('No readable legacy Zod v3 indicators found in Android export artifacts.');
    console.log('Hermes binary strings can be encoded: this check is heuristic, not an exhaustive runtime dependency inventory.');
    console.log('This does not waive npm audit or establish a patched Expo CLI.');
  }
}
