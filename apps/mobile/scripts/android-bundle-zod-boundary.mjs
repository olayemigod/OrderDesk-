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
const INSPECTABLE_BUNDLE = /\.(?:js|jsbundle|bundle|mjs)$/i;

export function inspectAndroidJsBundle(directory) {
  const root = resolve(directory);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    return { ok: false, scanned: 0, suspectFiles: [], reason: 'Missing Android export directory' };
  }
  const queue = [root];
  let scanned = 0;
  const suspectFiles = [];
  while (queue.length) {
    const dir = queue.pop();
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, item.name);
      if (item.isDirectory()) {
        queue.push(path);
      } else if (item.isFile() && INSPECTABLE_BUNDLE.test(item.name)) {
        scanned++;
        const source = readFileSync(path, 'utf8');
        const hits = LEGACY_ZOD_MARKERS.filter((marker) => source.includes(marker));
        if (hits.length) {
          suspectFiles.push({ path, markers: hits });
        }
      }
    }
  }
  if (!scanned) {
    return {
      ok: false, scanned, suspectFiles,
      reason: 'No inspectable JS bundle found; binary-only exports require a separate native inspection',
    };
  }
  return {
    ok: suspectFiles.length === 0, scanned, suspectFiles,
    reason: suspectFiles.length ? 'Legacy Zod 3 markers found in merchant Android JS export' : null,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = inspectAndroidJsBundle(process.argv[2] ?? '.ci-dist');
  console.log('Inspected Android JS files:', result.scanned);
  for (const item of result.suspectFiles) {
    console.error('Unexpected legacy Zod marker(s):', item.path, item.markers.join(', '));
  }
  if (!result.ok) {
    console.error(result.reason);
    process.exitCode = 1;
  } else {
    console.log('No legacy Zod v3 indicators found in Android JS output.');
    console.log('This is not a dependency-advisory waiver or proof of a patched Expo CLI.');
  }
}
