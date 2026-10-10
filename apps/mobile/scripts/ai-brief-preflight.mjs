import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const appRoot = process.cwd();
const repository = readFileSync(resolve(appRoot, 'src/data/aiBriefRepository.ts'), 'utf8');
const workspace = readFileSync(resolve(appRoot, 'src/redesign/AiBriefWorkspace.tsx'), 'utf8');
const more = readFileSync(resolve(appRoot, 'src/redesign/MoreWorkspace.tsx'), 'utf8');
const failures = [];

function requireValue(condition, message) {
  if (!condition) failures.push(message);
}

const clientSource = `${repository}\n${workspace}\n${more}`;
requireValue(
  repository.includes("functions.invoke('ai-brief'") &&
    !clientSource.includes('OPENAI_API_KEY') &&
    !clientSource.includes('api.openai.com') &&
    !clientSource.includes('gpt-5.6-luna') &&
    !clientSource.includes('SELLERTRAY_AI_BRIEF_DAILY_LIMIT'),
  'Mobile AI Brief must use the governed Edge Function and must not own provider credentials, model selection or budget policy.',
);

requireValue(
  more.includes("business.role === 'owner' || business.role === 'manager'") &&
    more.includes('canUseAiBrief ?') &&
    more.includes('<AiBriefWorkspace'),
  'Mobile AI Brief entry must remain limited to Owner and Manager accounts.',
);

requireValue(
  !clientSource.includes("from('orders').insert") &&
    !clientSource.includes("from('orders').update") &&
    !clientSource.includes("from('inventory_movements').insert") &&
    !clientSource.includes("from('order_payments').update") &&
    !clientSource.includes('save_sellertray_') &&
    !clientSource.includes('post_sellertray_purchase_receipt'),
  'Mobile AI Brief must remain advisory and cannot mutate commerce, inventory, purchasing or payments.',
);

requireValue(
  workspace.includes('Source-backed decision support from SellerTray reports') &&
    workspace.includes('Do not enter customer personal data, passwords or secret keys') &&
    workspace.includes('Evidence used') &&
    workspace.includes('Verified metrics fallback'),
  'Mobile AI Brief must communicate its report provenance, privacy boundary and deterministic fallback.',
);

if (failures.length) {
  console.error('SellerTray mobile AI Brief preflight failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('SellerTray mobile AI Brief preflight passed.');
