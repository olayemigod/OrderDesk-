import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(process.cwd(), '../..');
const manifestPath = resolve(repoRoot, 'docs/release_acceptance.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const allowedStatuses = new Set(['pending', 'accepted', 'waived']);
const invalid = manifest.gates.filter((gate) => !allowedStatuses.has(gate.status));
if (invalid.length) {
  console.error('Invalid release-gate status values:');
  for (const gate of invalid) console.error('- '+gate.id+': '+gate.status);
  process.exit(2);
}

const requiredPending = manifest.gates.filter((gate) => gate.required && gate.status !== 'accepted');
const accepted = manifest.gates.filter((gate) => gate.status === 'accepted');

console.log('SellerTray '+manifest.version+' release acceptance');
console.log('Code checkpoint: '+manifest.codeCheckpoint.status+' — '+manifest.codeCheckpoint.evidence);
console.log('');
console.log('Accepted gates: '+accepted.length+'/'+manifest.gates.length);
for (const gate of accepted) {
  console.log('  PASS  '+gate.id+(gate.evidence ? ' — '+gate.evidence : ''));
}

if (requiredPending.length) {
  console.log('');
  console.log('Required gates still open: '+requiredPending.length);
  for (const gate of requiredPending) {
    console.log('  HOLD  '+gate.id+' — '+(gate.acceptance ?? 'Acceptance evidence required.'));
  }
  console.log('');
  console.error('SellerTray RELEASE HOLD: required external acceptance gates are still open.');
  process.exit(1);
}

console.log('');
console.log('SellerTray RELEASE ACCEPTANCE PASS');
