import { useCallback, useEffect, useState } from 'react';

import {
  loadNotificationSettings,
  updateNotificationSettings,
  type NotificationSettings,
} from '../data/notificationRepository';

export function useNotificationSettings(tenantId: string | null) {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!tenantId) {
      setSettings(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    try {
      const next = await loadNotificationSettings(tenantId);
      setSettings(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load notification settings.');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(
    async (next: NotificationSettings) => {
      if (!tenantId) throw new Error('No active business selected.');

      setSaving(true);
      setError(null);
      try {
        await updateNotificationSettings(tenantId, next);
        setSettings(next);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to update notification settings.');
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [tenantId],
  );

  return { settings, loading, saving, error, refresh, save };
}
