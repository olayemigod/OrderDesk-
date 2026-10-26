import type { MerchantNotification } from '../data/merchantNotificationsRepository';

/**
 * Notification Center consumes the canonical shared merchant notification
 * contract. Keep presentation surfaces bound to this type rather than
 * duplicating a narrower event-key union in SaasApp.
 */
export type NotificationCenterNotification = MerchantNotification;
