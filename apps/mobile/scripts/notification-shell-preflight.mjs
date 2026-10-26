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
const notificationRepository = read(join(mobileRoot, 'src/data/merchantNotificationsRepository.ts'));
const notificationHook = read(join(mobileRoot, 'src/hooks/useMerchantNotifications.ts'));

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
requireValue(
  notificationRepository.includes("supabase.rpc('sellertray_merchant_unread_notification_count'") &&
    notificationHook.includes('loadMerchantUnreadNotificationCount(tenantId)') &&
    notificationHook.includes('setUnreadCount(count)'),
  'Mobile unread badge count must come from the exact governed server count RPC',
);
requireValue(
  !notificationHook.includes('const unreadCount = useMemo(() => notifications.length') &&
    !notificationHook.includes('const unreadCount = notifications.length'),
  'Mobile must not derive the notification bell count from the bounded inbox list',
);
requireValue(
  notificationRepository.includes("table: 'merchant_notifications'") &&
    notificationRepository.includes("table: 'merchant_notification_reads'"),
  'Mobile notification refresh must observe both notification facts and per-user read facts',
);
requireValue(
  notificationRepository.includes("| 'commercial_order_created'") &&
    notificationRepository.includes("| 'master_agreement_required'") &&
    notificationRepository.includes("| 'activation_succeeded'") &&
    notificationRepository.includes("| 'entitlement_expired'"),
  'Mobile notification typing must include the governed OA5A lifecycle vocabulary',
);

if (failures.length > 0) {
  console.error('SellerTray notification shell preflight failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('SellerTray notification shell preflight passed.');
