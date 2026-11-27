/**
 * Source-only evidence of the npm-lock Expo CLI -> Zod advisory boundary.
 * This is NOT a vulnerability patch, an npm-audit exception, or APK proof.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const ADVISORY = 'GHSA-MRHX-C7XC-M3W5';
export const PATCHED_ZOD_MINIMUM = '4.6.6';

function isPatchedZod(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) return false;
  const parts = version.split('.').map(Number);
  const minimum = [4, 6, 6];
  for (let i = 0; i < 3; i++) {
    if (parts[i] !== minimum[i]) return parts[i] > minimum[i];
  }
  return true;
}

export function inspectExpoZodLock(manifest, lock) {
  if (!manifest || typeof manifest !== 'object' || !lock?.packages || typeof lock.packages !== 'object') {
    throw new Error('Complete mobile package.json and npm lockfile packages are required');
  }
  const packages = lock.packages;
  const expo = packages['node_modules/expo'];
  if (!expo?.version) throw new Error('Lockfile has no installed Expo package');
  const cliPath = 'node_modules/expo/node_modules/@expo/cli';
  const cli = packages[cliPath] ?? packages['node_modules/@expo/cli'];
  if (!cli?.version) throw new Error('Cannot resolve the locked Expo CLI');
  const consumers = Object.entries(packages)
    .filter(([, entry]) => Boolean(entry?.dependencies?.zod || entry?.optionalDependencies?.zod))
    .map(([path, entry]) => ({path, version: entry.version, requirement: entry.dependencies?.zod ?? entry.optionalDependencies?.zod}))
    .sort((a, b) => a.path.localeCompare(b.path));
  const zodPackages = Object.entries(packages)
    .filter(([path]) => /(?:^|\/)node_modules\/zod$/.test(path))
    .map(([path, entry]) => ({path, version: entry.version, devOnly: entry.dev === true}))
    .sort((a, b) => a.path.localeCompare(b.path));
  const productionVulnerable = zodPackages.filter(x => !x.devOnly && !isPatchedZod(x.version));
  const directDependency = Boolean(manifest.dependencies?.zod || manifest.optionalDependencies?.zod);
  const cliRequiresZod3 = typeof cli.dependencies?.zod === 'string' && /(?:\^|~|>=)?3\./.test(cli.dependencies.zod);
  return {
    advisory: ADVISORY,
    expoVersion: expo.version,
    cliVersion: cli.version,
    cliRequiresZod3,
    directDependency,
    consumers,
    zodPackages,
    productionVulnerable,
    status: productionVulnerable.length ? 'BLOCKED' : 'CANDIDATE_ONLY',
    // CANDIDATE_ONLY still requires a fresh npm audit, typecheck and real Android export.
  };
}

const MODULE_EXT = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/i;
const ZOD_IMPORT = /(?:\bfrom\s*['"]zod(?:\/[^'"]*)?['"]|\brequire\s*\(\s*['"]zod(?:\/[^'"]*)?['"]\s*\)|\bimport\s*\(\s*['"]zod(?:\/[^'"]*)?['"]\s*\))/;

export function scanMerchantSourceForDirectZodImports(mobileDirectory) {
  const root = resolve(mobileDirectory);
  const hits = [];
  const roots = ['src', 'modules', 'App.tsx', 'index.ts'];
  const walk = (path, relative) => {
    let entries;
    try { entries = readdirSync(path, {withFileTypes: true}); } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.ci-dist') continue;
      const nextPath = join(path, entry.name);
      const nextRelative = join(relative, entry.name);
      if (entry.isDirectory()) walk(nextPath, nextRelative);
      else if (entry.isFile() && MODULE_EXT.test(entry.name) && ZOD_IMPORT.test(readFileSync(nextPath, 'utf8'))) hits.push(nextRelative);
    }
  };
  for (const item of roots) {
    if (MODULE_EXT.test(item)) {
      try { if (ZOD_IMPORT.test(readFileSync(join(root, item), 'utf8'))) hits.push(item); }
      catch (error) { if (error?.code !== 'ENOENT') throw error; }
    } else walk(join(root, item), item);
  }
  return hits.sort();
}
