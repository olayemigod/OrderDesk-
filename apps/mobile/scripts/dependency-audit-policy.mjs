import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const exceptions = new Map([
  [
    'GHSA-VFJ7-8CJW-P6XM',
    {
      packageName: 'braces',
      version: '3.0.3',
      expiresOn: '2026-11-13',
      reason:
        'Expo/Metro build tooling reaches braces through micromatch. No patched braces release exists yet; repository-controlled build globs are not merchant input.',
    },
  ],
  [
    'GHSA-86W9-CPQP-85RV',
    {
      packageName: 'node-forge',
      version: '1.4.0',
      expiresOn: '2026-11-13',
      reason:
        'Expo CLI/code-signing tooling uses node-forge. The published 1.4.0 release has no patched successor yet, and this package is not part of the SellerTray Android runtime bundle.',
    },
  ],
  [
    'GHSA-MRHX-C7XC-M3W5',
    {
      packageName: 'zod',
      version: '3.25.76',
      expiresOn: '2026-11-07',
      reason:
        'Expo SDK 57 CLI currently requires zod ^3.25.76 while the published fix is on the incompatible Zod 4 line. This transitive CLI dependency is build tooling, not part of SellerTray merchant-input validation in the Android runtime; review as soon as Expo publishes a compatible patched dependency.',
    },
  ],
]);

const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
const audit = spawnSync('npm', ['--prefix', '.', 'audit', '--omit=dev', '--json'], {
  cwd: new URL('..', import.meta.url),
  encoding: 'utf8',
  shell: process.platform === 'win32',
});

if (audit.error) {
  console.error('Unable to start npm audit:', audit.error);
  process.exit(1);
}

if (!audit.stdout?.trim()) {
  console.error(audit.stderr || 'npm audit did not return JSON output');
  process.exit(1);
}

let report;
try {
  report = JSON.parse(audit.stdout);
} catch (error) {
  console.error('Unable to parse npm audit output:', error);
  console.error(audit.stdout.slice(0, 4000));
  process.exit(1);
}

if (report?.error || !report?.vulnerabilities || typeof report.vulnerabilities !== 'object') {
  console.error('npm audit did not return a valid vulnerability report.');
  if (report?.error) console.error(JSON.stringify(report.error, null, 2));
  process.exit(1);
}

const vulnerabilities = report.vulnerabilities;
const blocking = Object.entries(vulnerabilities).filter(([, finding]) =>
  ['high', 'critical'].includes(finding?.severity),
);

if (!blocking.length) {
  console.log('SellerTray mobile dependency audit: no high or critical findings.');
  process.exit(0);
}

const advisoryIdsFor = (packageName, seen = new Set()) => {
  if (seen.has(packageName)) return new Set();
  seen.add(packageName);

  const finding = vulnerabilities[packageName];
  if (!finding) return new Set();

  const ids = new Set();
  for (const via of finding.via ?? []) {
    if (typeof via === 'string') {
      for (const id of advisoryIdsFor(via, seen)) ids.add(id);
      continue;
    }

    if (!via || typeof via !== 'object') continue;
    if (!['high', 'critical'].includes(via.severity)) continue;

    const match = String(via.url ?? '').match(/GHSA-[0-9a-z-]+/i);
    if (match) ids.add(match[0].toUpperCase());
  }
  return ids;
};

const failures = [];
const usedExceptions = new Set();

for (const [packageName, finding] of blocking) {
  if (finding.severity === 'critical') {
    failures.push(`${packageName}: critical finding is never excepted`);
    continue;
  }

  const advisoryIds = [...advisoryIdsFor(packageName)];
  if (!advisoryIds.length) {
    failures.push(`${packageName}: high finding has no traceable high-severity advisory identity`);
    continue;
  }

  for (const advisoryId of advisoryIds) {
    const exception = exceptions.get(advisoryId);
    if (!exception) {
      failures.push(`${packageName}: ${advisoryId} is not an approved temporary exception`);
      continue;
    }

    const installed = lock.packages?.[`node_modules/${exception.packageName}`]?.version;
    if (installed !== exception.version) {
      failures.push(
        `${packageName}: ${advisoryId} expected ${exception.packageName}@${exception.version}, found ${installed ?? 'missing'}`,
      );
      continue;
    }

    const expiry = new Date(`${exception.expiresOn}T23:59:59Z`);
    if (!Number.isFinite(expiry.getTime()) || Date.now() > expiry.getTime()) {
      failures.push(`${packageName}: ${advisoryId} exception expired on ${exception.expiresOn}`);
      continue;
    }

    usedExceptions.add(advisoryId);
  }
}

if (failures.length) {
  console.error('SellerTray mobile dependency audit failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.warn('SellerTray mobile dependency audit passed with temporary upstream-only exceptions:');
for (const advisoryId of [...usedExceptions].sort()) {
  const exception = exceptions.get(advisoryId);
  console.warn(
    `- ${advisoryId}: ${exception.packageName}@${exception.version}; review by ${exception.expiresOn}. ${exception.reason}`,
  );
}
console.warn('Any new high/critical advisory, version drift, or expired exception fails this gate.');
