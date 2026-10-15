import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import process from 'node:process';

const roots = ['apps/mobile/src', 'apps/merchant-web/src'];
const sourceExtensions = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx']);
const internalAuthorityHelpers = [
  'sellertray_user_can_read_branch',
  'sellertray_user_can_operate_branch',
  'sellertray_user_has_capability',
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
  for (const file of await collectSourceFiles(root)) {
    const content = await readFile(file, 'utf8');
    for (const helper of internalAuthorityHelpers) {
      if (content.includes(helper)) {
        violations.push(`${relative(process.cwd(), file)}: ${helper}`);
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
