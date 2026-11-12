/**
 * Expo Doctor finds the monorepo root package.json before searching for
 * package-lock.json, while SellerTray intentionally pins the Mobile workspace
 * with apps/mobile/package-lock.json. Accept *only* that precise locator
 * false-positive after a real locked npm ci and unchanged security audit.
 * Every other Doctor failure remains a CI blocker.
 */
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const mobile = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repository = resolve(mobile, '../..');
function json(path) { return JSON.parse(readFileSync(path, 'utf8')); }

export function classifyDoctor({status, output, rootManifest, rootLockExists, mobileManifest, mobileLock, installedExpoVersion}) {
  if (status === 0) return {accepted: true, reason: 'All Expo Doctor checks passed'};
  if (!Number.isInteger(status) || status === null) return {accepted: false, reason: 'Expo Doctor failed without a valid exit status'};
  const failures = output.split(/\r?\n/).filter(line => line.trim().startsWith('✖ '));
  if (failures.length !== 1 || failures[0].trim() !== '✖ Check for lock file' ||
      !/No lock file detected\./.test(output) ||
      !/\b1 checks? failed\b/.test(output)) {
    return {accepted: false, reason: 'Expo Doctor reported errors beyond the known workspace lockfile locator'};
  }
  if (!Array.isArray(rootManifest?.workspaces) ||
      !rootManifest.workspaces.includes('apps/mobile') || rootLockExists ||
      mobileManifest?.name !== '@sellertray/mobile' ||
      !Number.isInteger(mobileLock?.lockfileVersion) || mobileLock.lockfileVersion < 3 ||
      mobileLock.packages?.['']?.name !== mobileManifest.name) {
    return {accepted: false, reason: 'Unproven nested npm workspace/lockfile integrity'};
  }
  for (const group of ['dependencies','devDependencies']) {
    const specified = mobileManifest[group] ?? {};
    const locked = mobileLock.packages[''][group] ?? {};
    if (Object.keys(specified).length !== Object.keys(locked).length ||
        Object.entries(specified).some(([name,version]) => locked[name] !== version)) {
      return {accepted: false, reason: 'Mobile manifest/lock root dependency mismatch'};
    }
  }
  const lockedExpo = mobileLock.packages?.['node_modules/expo']?.version;
  if (!lockedExpo || !installedExpoVersion || installedExpoVersion !== lockedExpo ||
      !lockedExpo.startsWith('58.')) {
    return {accepted: false, reason: 'Expo installation is not the locked SDK 58 version'};
  }
  return {accepted: true, reason: '19/20-style Expo Doctor result: only known monorepo root-lock locator false-positive; nested npm ci lock verified'};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const doctor = spawnSync('npx',['--yes','expo-doctor'],{
    cwd: mobile, encoding:'utf8', shell:process.platform==='win32',
    env:{...process.env,FORCE_COLOR:'0'}
  });
  const output = String(doctor.stdout ?? '') + '\n' + String(doctor.stderr ?? '');
  process.stdout.write(output);
  const integrity = {
    status: doctor.error ? null : doctor.status,
    output,
    rootManifest: json(resolve(repository,'package.json')),
    rootLockExists: existsSync(resolve(repository,'package-lock.json')),
    mobileManifest: json(resolve(mobile,'package.json')),
    mobileLock: json(resolve(mobile,'package-lock.json')),
    installedExpoVersion: existsSync(resolve(mobile,'node_modules/expo/package.json'))
      ? json(resolve(mobile,'node_modules/expo/package.json')).version : null,
  };
  const result = classifyDoctor(integrity);
  if (!result.accepted) { console.error('Expo Doctor gate BLOCKED:',result.reason); process.exitCode=1; }
  else console.log('Expo Doctor workspace gate:',result.reason);
}
