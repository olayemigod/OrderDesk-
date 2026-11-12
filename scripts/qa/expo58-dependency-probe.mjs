/**
 * EXACT SDK58 dependency resolution experiment, not an APK or release.
 * Runs only on an isolated GitHub Actions runner, never against Production.
 * Compatible versions are from expo/expo sdk-58 bundledNativeModules.json
 * initially inspected on 08/11/2026; patch refresh derived from exact-head
 * Expo Doctor 12/11/2026 mismatch evidence. Npm resolves published packages.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectExpoZodLock } from '../../apps/mobile/scripts/expo-zod-advisory-contract.mjs';

const repoRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const mobileRoot = resolve(repoRoot, 'apps/mobile');
const packagePath = resolve(mobileRoot, 'package.json');
const lockPath = resolve(mobileRoot, 'package-lock.json');

export const SDK58_PINS = Object.freeze({
  expo: '~58.0.25',
  '@expo/metro-runtime': '~58.0.17',
  'expo-camera': '~58.0.14',
  'expo-constants': '~58.0.16',
  'expo-image-picker': '~58.0.10',
  'expo-notifications': '~58.1.9',
  'expo-secure-store': '~58.0.3',
  'expo-font': '~58.0.12',
  'expo-splash-screen': '~58.0.14',
  'expo-system-ui': '~58.0.6',
  react: '19.3.0',
  'react-dom': '19.3.0',
  'react-native': '0.88.1',
  'react-native-web': '~0.21.4',
});

export function proposedManifest(current) {
  const proposed = structuredClone(current);
  if (!proposed?.dependencies?.expo || !proposed.dependencies['react-native'])
    throw Error('Unexpected mobile dependency contract; refuse SDK migration');
  for (const [name, version] of Object.entries(SDK58_PINS)) proposed.dependencies[name] = version;
  proposed.devDependencies['@types/react'] = '~19.3.0';
  // Keep @expo/vector-icons 15.1.1, supported by Expo SDK58's ^15.0.2.
  // Keep Supabase, camera/notification business code, and node-forge override.
  return proposed;
}

export function inspectResolvedCandidate(manifest, lock) {
  const report = inspectExpoZodLock(manifest, lock);
  if (!String(report.expoVersion).startsWith('58.'))
    throw Error('Resolved Expo is not SDK 58');
  if (!String(report.cliVersion).startsWith('58.'))
    throw Error('Resolved Expo CLI is not SDK 58');
  if (report.status !== 'CANDIDATE_ONLY' || report.productionVulnerable.length)
    throw Error('Production dependency graph still includes vulnerable Zod; stop, do not commit');
  if (report.consumers.some(entry =>
    entry.path.endsWith('/@expo/cli') && entry.requirement.startsWith('^3.')
  )) throw Error('Expo CLI still declares runtime Zod 3; stop');
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2];
  if (cmd === '--prepare') {
    if (process.env.GITHUB_ACTIONS !== 'true')
      throw Error('Preparation is restricted to a CI sandbox; do not edit local Production release files');
    const manifest = JSON.parse(readFileSync(packagePath, 'utf8'));
    const next = proposedManifest(manifest);
    writeFileSync(packagePath, JSON.stringify(next, null, 2) + '\n');
    console.log('Prepared SDK58 proposal in ephemeral CI checkout; lockfile regeneration required');
  } else if (cmd === '--verify') {
    const manifest = JSON.parse(readFileSync(packagePath, 'utf8'));
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    const report = inspectResolvedCandidate(manifest, lock);
    console.log(JSON.stringify({status:report.status,expo:report.expoVersion,cli:report.cliVersion,
      zodPackages:report.zodPackages,consumers:report.consumers,productionVulnerable:report.productionVulnerable},null,2));
    console.log('Candidate only: must pass unchanged npm audit, Expo Doctor, full Mobile CI and native QA');
  } else {
    throw Error('Expected --prepare or --verify');
  }
}
