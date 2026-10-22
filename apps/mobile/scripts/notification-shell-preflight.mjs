import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mobileRoot = process.cwd();
const failures = [];

function read(path) {
  return readFileSync(path, 'utf8');
}

function requireValue(condition, message) {
  if (!condition) failures.push(message);
}

const redesignWorkspace = read(join(mobileRoot, 'src/redesign/RedesignWorkspace.tsx'));
const mobileShell = read(join(mobileRoot, 'src/redesign/MobileShell.tsx'));
const notificationsWorkspace = read(join(mobileRoot, 'src/redesign/NotificationsWorkspace.tsx'));

requireValue(
  redesignWorkspace.includes('notificationCount={notifications.unreadCount}'),
  'The notification bell badge must use unread governed notifications only',
);
requireValue(
  redesignWorkspace.includes('orderAttentionCount={home.ordersNeedingAttention}'),
  'Operational order attention must remain on the Orders surface',
);
requireValue(
  redesignWorkspace.includes('setShowNotifications(true)') &&
    redesignWorkspace.includes('<NotificationsWorkspace'),
  'The notification bell must open the Notifications secondary surface',
);
requireValue(
  !/onOpenNotifications\s*=\s*\{[^}]*setTab\(['"]orders['"]\)/s.test(redesignWorkspace),
  'The notification bell must never route directly to Orders',
);
requireValue(
  mobileShell.includes("{notificationCount > 0 ? (") &&
    mobileShell.includes("count={tab.key === 'orders' ? orderAttentionCount : 0}"),
  'Notification and Orders badges must remain separate shell authorities',
);
requireValue(
  notificationsWorkspace.includes('onMarkRead') &&
    notificationsWorkspace.includes('onMarkAllRead') &&
    notificationsWorkspace.includes('Open order'),
  'Notifications must support governed read state and explicit record navigation',
);
requireValue(
  redesignWorkspace.includes('notifications.notifications.filter((notification) => !notification.isRead)') &&
    redesignWorkspace.includes('notifications={unreadNotifications}'),
  'The Mobile notification tray must render unread notifications only so read items leave the tray',
);
requireValue(
  redesignWorkspace.includes('setFocusedOrderId(orderId)') &&
    redesignWorkspace.includes('orders={ordersForWorkspace}') &&
    redesignWorkspace.includes('focusedOrder ? [focusedOrder] : branchOrders'),
  'Opening an order notification must focus the referenced order instead of opening the generic order list',
);
requireValue(
  notificationsWorkspace.includes('await onMarkRead(notification.id)') &&
    notificationsWorkspace.includes('if (notification.orderId) onOpenOrder(notification.orderId);'),
  'Opening an order notification must mark it read before routing to the referenced order',
);

if (failures.length > 0) {
  console.error('SellerTray notification shell preflight failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('SellerTray notification shell preflight passed.');
