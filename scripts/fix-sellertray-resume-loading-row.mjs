import { readFileSync, writeFileSync } from 'node:fs';

const path = 'apps/mobile/src/redesign/ResumePosDraftWorkspace.tsx';
let source = readFileSync(path, 'utf8');
const from = "  stack:{gap:14},stageStack:{gap:12},heading:{gap:3},priceEditor:";
const to = "  stack:{gap:14},stageStack:{gap:12},loadingRow:{flexDirection:'row',alignItems:'center',gap:8},heading:{gap:3},priceEditor:";
const first = source.indexOf(from);
if (first < 0) throw new Error('Resume Sale styles anchor not found');
if (source.indexOf(from, first + from.length) >= 0) throw new Error('Resume Sale styles anchor is ambiguous');
source = source.slice(0, first) + to + source.slice(first + from.length);
writeFileSync(path, source);
console.log('Added Resume Sale loadingRow style.');
