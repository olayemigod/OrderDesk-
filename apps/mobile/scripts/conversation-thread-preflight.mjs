import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const mobileRoot = process.cwd();
const repoRoot = resolve(mobileRoot, '../..');
const migration = readFileSync(join(repoRoot, 'supabase/migrations/20260917033000_conversation_thread_history.sql'), 'utf8');
const repository = readFileSync(join(mobileRoot, 'src/data/conversationsRepository.ts'), 'utf8');
const view = readFileSync(join(mobileRoot, 'src/components/ConversationsView.tsx'), 'utf8');
const failures = [];

function requireValue(condition, message) {
  if (!condition) failures.push(message);
}

requireValue(
  migration.includes('sellertray_list_conversation_messages') &&
    migration.includes('tenant_members') &&
    migration.includes('(select auth.uid())') &&
    migration.includes('inbound_messages') &&
    migration.includes('outbound_notifications') &&
    migration.includes("n.event_key='merchant_conversation_reply'") &&
    migration.includes('limit v_limit') &&
    migration.includes('to authenticated'),
  'Conversation thread RPC must remain membership-guarded, bounded and chronologically reconstructed',
);

requireValue(
  repository.includes("supabase.rpc('sellertray_list_conversation_messages'") &&
    repository.includes('ConversationMessage') &&
    !repository.includes(".from('inbound_messages')") &&
    !repository.includes(".from('outbound_notifications')"),
  'Mobile conversation history must use the guarded RPC instead of direct message-table reads',
);

requireValue(
  view.includes('Conversation history') &&
    view.includes('loadConversationMessages') &&
    view.includes('<ThreadMessage') &&
    view.includes('Customer, merchant and SellerTray messages in chronological order.') &&
    view.includes('onMarkConversationRead'),
  'Shared inbox must render full governed thread history and preserve read tracking',
);

if (failures.length) {
  console.error('SellerTray conversation-thread preflight failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('SellerTray full conversation-thread preflight passed.');
