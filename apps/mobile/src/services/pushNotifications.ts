import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from '../lib/supabase';

export type PushRoute = {
  tenantId: string | null;
  notificationId: string | null;
  orderId: string | null;
  changeRequestId: string | null;
};

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function registerSellerTrayPushDevice(): Promise<{
  status: 'registered' | 'permission_denied' | 'not_configured' | 'unsupported';
  token?: string;
}> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    return { status: 'unsupported' };
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('sellertray-alerts', {
      name: 'SellerTray alerts',
      description: 'Orders, customer messages, payments and important SellerTray activity.',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 200, 250],
      lightColor: '#12B76A',
      sound: 'default',
      showBadge: true,
    });
  }

  const current = await Notifications.getPermissionsAsync();
  let finalStatus = current.status;
  if (finalStatus !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync();
    finalStatus = requested.status;
  }
  if (finalStatus !== 'granted') return { status: 'permission_denied' };

  const projectId = resolveProjectId();
  if (!projectId) return { status: 'not_configured' };

  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  if (!token) return { status: 'not_configured' };

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const userId = authData.user?.id;
  if (!userId) return { status: 'not_configured' };

  const now = new Date().toISOString();
  const { error } = await supabase
    .from('merchant_push_devices')
    .upsert(
      {
        user_id: userId,
        expo_push_token: token,
        platform: Platform.OS,
        enabled: true,
        last_seen_at: now,
        updated_at: now,
      },
      { onConflict: 'expo_push_token' },
    );

  if (error) throw error;
  return { status: 'registered', token };
}

export async function syncSellerTrayAppBadge(unreadCount: number): Promise<void> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return;
  try {
    await Notifications.setBadgeCountAsync(Math.max(0, Math.min(999, Math.floor(unreadCount))));
  } catch {
    // Badge support varies by Android launcher; in-app unread bubbles remain authoritative.
  }
}

export function subscribeToPushResponses(
  onOpen: (route: PushRoute) => void,
): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    onOpen(routeFromData(response.notification.request.content.data));
  });

  void Notifications.getLastNotificationResponseAsync().then(async (response) => {
    if (!response) return;
    onOpen(routeFromData(response.notification.request.content.data));
    try {
      await Notifications.clearLastNotificationResponseAsync();
    } catch {
      // A stale response must never block normal app startup.
    }
  });

  return () => subscription.remove();
}

function routeFromData(data: Record<string, unknown> | null | undefined): PushRoute {
  return {
    tenantId: text(data?.tenantId),
    notificationId: text(data?.notificationId),
    orderId: text(data?.orderId),
    changeRequestId: text(data?.changeRequestId),
  };
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function resolveProjectId(): string | null {
  const easConfig = Constants.easConfig as { projectId?: string } | null | undefined;
  const expoExtra = Constants.expoConfig?.extra as
    | { eas?: { projectId?: string } }
    | undefined;
  const candidate =
    easConfig?.projectId ??
    expoExtra?.eas?.projectId ??
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID ??
    '';
  return candidate.trim() || null;
}
