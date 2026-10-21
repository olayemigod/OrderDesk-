import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../src/', import.meta.url));
const allowed = new Set(['SellerTrayElements.tsx']);
const offenders = [];

for (const file of await walk(root)) {
  if (!/\.(?:tsx|jsx)$/.test(file)) continue;
  if (allowed.has(relative(root, file).replaceAll('\\', '/'))) continue;
  const source = await readFile(file, 'utf8');
  for (const match of source.matchAll(/<\s*(input|select|textarea)\b/gi)) {
    const before = source.slice(0, match.index ?? 0);
    const line = before.split('\n').length;
    offenders.push(`${relative(root, file).replaceAll('\\', '/')}:${line} raw <${match[1].toLowerCase()}>`);
  }
}

if (offenders.length) {
  console.error('Merchant Web form fields must use SellerTrayElements.');
  for (const offender of offenders) console.error(`- ${offender}`);
  process.exit(1);
}

console.log('SellerTray Merchant Web field primitive guard passed.');

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}
