type Json = Record<string, unknown>;

type ClaimedDispatch = {
  id: string;
  tenant_id: string;
  notification_id: string;
  user_id: string;
  attempt_count: number;
};

type MerchantNotification = {
  id: string;
  tenant_id: string;
  event_key: string;
  severity: 'info' | 'attention' | 'urgent';
  title: string;
  body: string;
  order_id: string | null;
  change_request_id: string | null;
};

type PushDevice = {
  id: string;
  expo_push_token: string;
  platform: 'android' | 'ios';
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ error: 'Push worker not configured' }, 503);
  }

  const bodyRead = await readRequestTextLimited(request, 8192);
  if (!bodyRead.ok) return json({ error: 'Payload too large' }, 413);

  let invocationNonce: string | null = null;
  try {
    const payload = bodyRead.text ? JSON.parse(bodyRead.text) as Json : {};
    invocationNonce = typeof payload.invocationNonce === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.invocationNonce)
      ? payload.invocationNonce
      : null;
  } catch {
    invocationNonce = null;
  }

  if (!invocationNonce || !(await claimInvocation(invocationNonce))) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const claimed = await rest<ClaimedDispatch[]>(
    '/rest/v1/rpc/claim_sellertray_merchant_push_dispatches',
    {
      method: 'POST',
      body: JSON.stringify({ p_limit: 20 }),
    },
  );

  const results: Array<{ id: string; status: string }> = [];
  for (const dispatch of claimed) {
    const status = await deliver(dispatch);
    results.push({ id: dispatch.id, status });
  }

  return json({ claimed: claimed.length, results });
});

async function claimInvocation(nonce: string): Promise<boolean> {
  try {
    const result = await rest<boolean>(
      '/rest/v1/rpc/claim_sellertray_merchant_push_worker_invocation',
      {
        method: 'POST',
        body: JSON.stringify({ p_nonce: nonce }),
      },
    );
    return result === true;
  } catch {
    return false;
  }
}

async function deliver(dispatch: ClaimedDispatch): Promise<string> {
  try {
    const notifications = await rest<MerchantNotification[]>(
      '/rest/v1/merchant_notifications?' +
      'select=id,tenant_id,event_key,severity,title,body,order_id,change_request_id' +
      '&id=eq.' + encodeURIComponent(dispatch.notification_id) +
      '&tenant_id=eq.' + encodeURIComponent(dispatch.tenant_id) +
      '&limit=1',
    );
    const notification = notifications[0];
    if (!notification) {
      await finish(dispatch.id, {
        delivery_status: 'skipped',
        last_error: 'Merchant notification no longer exists.',
      });
      return 'skipped';
    }

    const devices = await rest<PushDevice[]>(
      '/rest/v1/merchant_push_devices?' +
      'select=id,expo_push_token,platform' +
      '&user_id=eq.' + encodeURIComponent(dispatch.user_id) +
      '&enabled=eq.true',
    );

    if (devices.length === 0) {
      await finish(dispatch.id, {
        delivery_status: 'skipped',
        last_error: 'No active push device is registered for this merchant user.',
      });
      return 'skipped';
    }

    const unreadCount = await rest<number>(
      '/rest/v1/rpc/sellertray_unread_notification_count_for_user',
      {
        method: 'POST',
        body: JSON.stringify({ p_user_id: dispatch.user_id }),
      },
    );

    const messages = devices.map((device) => ({
      to: device.expo_push_token,
      sound: 'default',
      title: notification.title,
      body: notification.body,
      priority: notification.severity === 'urgent' ? 'high' : 'default',
      badge: Math.max(0, unreadCount || 0),
      channelId: 'sellertray-alerts',
      data: {
        tenantId: notification.tenant_id,
        notificationId: notification.id,
        eventKey: notification.event_key,
        orderId: notification.order_id,
        changeRequestId: notification.change_request_id,
      },
    }));

    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(15000),
    });

    const raw = await response.text();
    if (!response.ok) {
      throw new Error(('Expo push request failed: ' + raw).slice(0, 500));
    }

    let payload: unknown = null;
    try { payload = JSON.parse(raw); } catch {}
    const tickets = isRecord(payload) && Array.isArray(payload.data) ? payload.data : [];

    let successCount = 0;
    let firstTicketId: string | null = null;
    const errors: string[] = [];

    for (let index = 0; index < devices.length; index += 1) {
      const device = devices[index];
      const ticket = tickets[index];

      if (isRecord(ticket) && ticket.status === 'ok') {
        successCount += 1;
        if (!firstTicketId && typeof ticket.id === 'string') firstTicketId = ticket.id;
        continue;
      }

      const message = isRecord(ticket) && typeof ticket.message === 'string'
        ? ticket.message
        : 'Expo push provider rejected the device message.';
      errors.push(message.slice(0, 180));

      if (
        isRecord(ticket) &&
        isRecord(ticket.details) &&
        ticket.details.error === 'DeviceNotRegistered'
      ) {
        await disableDevice(device.id);
      }
    }

    if (successCount > 0) {
      await finish(dispatch.id, {
        delivery_status: 'sent',
        provider_ticket_id: firstTicketId,
        last_error: errors.length ? errors.join(' | ').slice(0, 500) : null,
        sent_at: new Date().toISOString(),
      });
      return 'sent';
    }

    const retryMinutes = Math.min(30, Math.max(2, dispatch.attempt_count * 5));
    await finish(dispatch.id, {
      delivery_status: 'failed',
      last_error: (errors.join(' | ') || 'Expo push provider returned no successful tickets.').slice(0, 500),
      available_at: new Date(Date.now() + retryMinutes * 60_000).toISOString(),
    });
    return 'failed';
  } catch (error) {
    const retryMinutes = Math.min(30, Math.max(2, dispatch.attempt_count * 5));
    await finish(dispatch.id, {
      delivery_status: 'failed',
      last_error: (error instanceof Error ? error.message : 'Merchant push delivery failed').slice(0, 500),
      available_at: new Date(Date.now() + retryMinutes * 60_000).toISOString(),
    });
    return 'failed';
  }
}

async function finish(id: string, patch: Json): Promise<void> {
  await rest<unknown>(
    '/rest/v1/merchant_push_dispatches?id=eq.' + encodeURIComponent(id),
    {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
    },
  );
}

async function disableDevice(id: string): Promise<void> {
  await rest<unknown>(
    '/rest/v1/merchant_push_devices?id=eq.' + encodeURIComponent(id),
    {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        enabled: false,
        updated_at: new Date().toISOString(),
      }),
    },
  );
}

async function rest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(SUPABASE_URL + path, {
    ...init,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      authorization: 'Bearer ' + SERVICE_ROLE_KEY,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
    signal: init.signal ?? AbortSignal.timeout(10000),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(('SellerTray push worker database request failed: ' + raw).slice(0, 500));
  }
  return (raw ? JSON.parse(raw) : null) as T;
}

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readRequestTextLimited(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false }> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false };
  if (!request.body) return { ok: true, text: '' };

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { ok: false };
      }
      parts.push(decoder.decode(result.value, { stream: true }));
    }
    parts.push(decoder.decode());
    return { ok: true, text: parts.join('') };
  } finally {
    try { reader.releaseLock(); } catch {}
  }
}

function json(payload: Json, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
