import { useEffect, useState } from 'react';

import {
  registerSellerTrayPushDevice,
  subscribeToPushResponses,
  syncSellerTrayAppBadge,
  type PushRoute,
} from '../services/pushNotifications';

export function usePushNotifications({
  enabled,
  unreadCount,
  onOpen,
}: {
  enabled: boolean;
  unreadCount: number;
  onOpen: (route: PushRoute) => void;
}) {
  const [registrationStatus, setRegistrationStatus] = useState<
    'idle' | 'registered' | 'permission_denied' | 'not_configured' | 'unsupported' | 'error'
  >('idle');

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;

    void registerSellerTrayPushDevice()
      .then((result) => {
        if (active) setRegistrationStatus(result.status);
      })
      .catch(() => {
        if (active) setRegistrationStatus('error');
      });

    const unsubscribe = subscribeToPushResponses(onOpen);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [enabled, onOpen]);

  useEffect(() => {
    if (!enabled) return;
    void syncSellerTrayAppBadge(unreadCount);
  }, [enabled, unreadCount]);

  return { registrationStatus };
}
