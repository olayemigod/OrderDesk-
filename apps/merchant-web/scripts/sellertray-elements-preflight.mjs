import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../src/', import.meta.url));
const allowed = new Set(['SellerTrayElements.tsx']);
const fixMode = process.argv.includes('--fix');
const componentByTag = {
  input: 'SellerTrayInput',
  select: 'SellerTraySelect',
  textarea: 'SellerTrayTextarea',
};

if (fixMode) {
  let changed = 0;
  for (const file of await walk(root)) {
    if (!/\.(?:tsx|jsx)$/.test(file)) continue;
    const relativePath = relative(root, file).replaceAll('\\', '/');
    if (allowed.has(relativePath)) continue;

    const source = await readFile(file, 'utf8');
    const tags = new Set([...source.matchAll(/<\s*(input|select|textarea)\b/gi)].map((match) => match[1].toLowerCase()));
    if (!tags.size) continue;

    let next = source
      .replace(/<\s*input\b/gi, '<SellerTrayInput')
      .replace(/<\s*\/\s*input\s*>/gi, '</SellerTrayInput>')
      .replace(/<\s*select\b/gi, '<SellerTraySelect')
      .replace(/<\s*\/\s*select\s*>/gi, '</SellerTraySelect>')
      .replace(/<\s*textarea\b/gi, '<SellerTrayTextarea')
      .replace(/<\s*\/\s*textarea\s*>/gi, '</SellerTrayTextarea>');

    next = ensureSellerTrayImport(next, [...tags].map((tag) => componentByTag[tag]));
    if (next !== source) {
      await writeFile(file, next);
      changed += 1;
      console.log(`Updated ${relativePath}`);
    }
  }
  console.log(`SellerTray field codemod updated ${changed} file${changed === 1 ? '' : 's'}.`);
}

const offenders = [];
for (const file of await walk(root)) {
  if (!/\.(?:tsx|jsx)$/.test(file)) continue;
  const relativePath = relative(root, file).replaceAll('\\', '/');
  if (allowed.has(relativePath)) continue;
  const source = await readFile(file, 'utf8');
  for (const match of source.matchAll(/<\s*(input|select|textarea)\b/gi)) {
    const before = source.slice(0, match.index ?? 0);
    const line = before.split('\n').length;
    offenders.push(`${relativePath}:${line} raw <${match[1].toLowerCase()}>`);
  }
}

if (offenders.length) {
  console.error('Merchant Web form fields must use SellerTrayElements.');
  for (const offender of offenders) console.error(`- ${offender}`);
  process.exit(1);
}

console.log('SellerTray Merchant Web field primitive guard passed.');

function ensureSellerTrayImport(source, requiredComponents) {
  const importPattern = /import\s*\{([^}]*)\}\s*from\s*['"]\.\/SellerTrayElements['"];?/m;
  const match = source.match(importPattern);
  if (match) {
    const names = match[1].split(',').map((value) => value.trim()).filter(Boolean);
    for (const component of requiredComponents) {
      if (!names.includes(component)) names.push(component);
    }
    const replacement = `import { ${names.join(', ')} } from './SellerTrayElements';`;
    return source.replace(match[0], replacement);
  }

  const names = [...new Set(requiredComponents)];
  return `import { ${names.join(', ')} } from './SellerTrayElements';\n${source}`;
}

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
