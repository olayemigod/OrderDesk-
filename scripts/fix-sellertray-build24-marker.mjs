import fs from 'node:fs';

const path = 'apps/mobile/src/redesign/MoreWorkspace.tsx';
const before = 'SellerTray 1.0.0 · Android build 23';
const after = 'SellerTray 1.0.0 · Android build 24';
const source = fs.readFileSync(path, 'utf8');
const matches = source.split(before).length - 1;
if (matches !== 1) throw new Error(`Expected exactly one Build 23 marker, found ${matches}`);
fs.writeFileSync(path, source.replace(before, after));
fs.rmSync('scripts/fix-sellertray-build24-marker.mjs');
fs.rmSync('.github/workflows/sellertray-build24-marker-fix.yml');
