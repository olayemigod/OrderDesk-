import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const app = read('src/MerchantApp.tsx');
const inbox = read('src/MerchantNotificationsManagement.tsx');
const navigation = read('src/portalNavigation.ts');
const shell = read('src/merchantShell.tsx');
const failures = [];
const requireValue = (condition, message) => { if (!condition) failures.push(message); };

requireValue(
  app.includes("supabase.rpc('sellertray_merchant_unread_notification_count'")
    && app.includes('setUnreadCount(')
    && app.includes("navigate('notifications')")
    && app.includes('<ShellIcon name="bell" />'),
  'Merchant Web bell must use the exact governed unread-count RPC and open the notification inbox.',
);
requireValue(
  navigation.includes("| 'notifications'")
    && !navigation.includes("{ id: 'notifications', label: 'Notifications'"),
  'Notifications must be a secondary bell-owned surface, not a new primary Merchant Web navigation item.',
);
requireValue(
  shell.includes("| 'bell'") && shell.includes("bell: ["),
  'Merchant Web must render the notification bell through the governed shell icon vocabulary.',
);
requireValue(
  inbox.includes("supabase.rpc('sellertray_list_merchant_notifications'")
    && inbox.includes("supabase.rpc('sellertray_mark_merchant_notification_read'")
    && inbox.includes("supabase.rpc('sellertray_mark_all_merchant_notifications_read'"),
  'Merchant Web inbox must reuse the canonical shared list/read RPCs.',
);
requireValue(
  inbox.includes("table: 'merchant_notifications'")
    && inbox.includes("table: 'merchant_notification_reads'"),
  'Merchant Web notification refresh must observe notification facts and per-user read facts.',
);
requireValue(
  !inbox.includes("from('merchant_notifications')")
    && !inbox.includes("from('merchant_notification_reads')")
    && !app.includes('notifications.length'),
  'Merchant Web must not read notification tables directly or derive the badge from a bounded list.',
);
requireValue(
  inbox.includes('Commercial, agreement, setup, activation and service-term notices')
    && inbox.includes('Operational Admin queues remain separate.'),
  'Merchant Web must keep merchant lifecycle notifications distinct from Admin operational queues.',
);

if (failures.length) {
  console.error('SellerTray lifecycle notification preflight failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('SellerTray lifecycle notification preflight passed.');
