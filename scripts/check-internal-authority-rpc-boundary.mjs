import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const roots = ['apps/mobile/src', 'apps/merchant-web/src'];
const sourceExtensions = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx']);
const internalAuthorityHelpers = [
  'sellertray_user_can_access_branch',
  'sellertray_user_can_read_branch',
  'sellertray_current_user_can_read_branch',
  'sellertray_user_can_operate_branch',
  'sellertray_user_has_capability',
  'sellertray_user_can_access_notification_scope',
  'sellertray_current_user_can_access_notification_scope',
  'sellertray_user_can_receive_notification_scope',
];

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectSourceFiles(path));
    } else if (entry.isFile() && sourceExtensions.has(extname(entry.name))) {
      files.push(path);
    }
  }

  return files;
}

const violations = [];

for (const root of roots) {
  for (const file of await collectSourceFiles(resolve(repoRoot, root))) {
    const content = await readFile(file, 'utf8');
    for (const helper of internalAuthorityHelpers) {
      if (content.includes(helper)) {
        violations.push(`${relative(repoRoot, file)}: ${helper}`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error('SellerTray clients must not call internal authority helpers directly.');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log('Internal SellerTray authority helpers are not referenced by client source.');
