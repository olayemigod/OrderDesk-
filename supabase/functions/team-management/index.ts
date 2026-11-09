type JsonRecord = Record<string, unknown>;

type TeamAction =
  | 'claim'
  | 'pending_invites'
  | 'accept_invite'
  | 'decline_invite'
  | 'list'
  | 'history'
  | 'invite'
  | 'set_role'
  | 'remove'
  | 'cancel_invite';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')?.trim() ?? '';
const TEAM_INVITE_EMAIL_FROM = sellerTraySender(
  Deno.env.get('SELLERTRAY_EMAIL_FROM')
    ?? Deno.env.get('TEAM_INVITE_EMAIL_FROM')
    ?? Deno.env.get('AUTH_EMAIL_FROM')
    ?? '',
);
const SELLERTRAY_MERCHANT_URL = (Deno.env.get('SELLERTRAY_MERCHANT_URL') ?? 'https://app.sellertray.com').replace(/\/+$/, '');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(withObservability('team-management', async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('SellerTray team management is missing server configuration.');
    return json({ error: 'Server configuration error' }, 500);
  }

  const authorization = request.headers.get('authorization') ?? '';
  const identity = await verifiedIdentity(authorization);
  if (!identity) {
    return json({ error: 'Authentication required' }, 401);
  }

  const bodyRead = await readRequestTextLimited(request, 65_536);
  if (!bodyRead.ok) {
    return json({ error: 'Payload too large' }, 413);
  }

  let body: JsonRecord;
  try {
    body = JSON.parse(bodyRead.text) as JsonRecord;
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const action = cleanAction(body.action);
  if (!action) {
    return json({ error: 'Unsupported team action' }, 400);
  }

  try {
    // Compatibility only: already-installed Mobile clients call `claim` while refreshing
    // Businesses. Never mutate membership here. New clients must show the pending invitation
    // and call accept_invite for one explicit invitation.
    if (action === 'claim') {
      return json({ claimed: 0, requiresExplicitAcceptance: true });
    }

    if (action === 'pending_invites') {
      const invitations = await rpc<JsonRecord[]>('list_orderdesk_pending_team_invitations', {
        p_user_id: identity.userId,
      });
      return json({ invitations: Array.isArray(invitations) ? invitations : [] });
    }

    if (action === 'accept_invite' || action === 'decline_invite') {
      const invitationId = cleanUuid(body.invitationId);
      if (!invitationId) return json({ error: 'invitationId is required' }, 400);

      const result = await rpc<JsonRecord>(
        action === 'accept_invite'
          ? 'accept_orderdesk_team_invitation'
          : 'decline_orderdesk_team_invitation',
        {
          p_invitation_id: invitationId,
          p_user_id: identity.userId,
        },
      );
      return json({ result });
    }

    const tenantId = cleanUuid(body.tenantId);
    if (!tenantId) return json({ error: 'tenantId is required' }, 400);

    if (action === 'list') {
      const team = await rpc<JsonRecord>('list_orderdesk_team', {
        p_tenant_id: tenantId,
        p_actor_user_id: identity.userId,
      });
      return json({ team });
    }

    if (action === 'history') {
      const requestedLimit = Number(body.limit ?? 100);
      const limit = Number.isFinite(requestedLimit)
        ? Math.min(250, Math.max(1, Math.trunc(requestedLimit)))
        : 100;
      const history = await rpc<JsonRecord[]>('list_orderdesk_team_membership_history', {
        p_tenant_id: tenantId,
        p_actor_user_id: identity.userId,
        p_limit: limit,
      });
      return json({ history: Array.isArray(history) ? history : [] });
    }

    const canWrite = await rpc<boolean>('orderdesk_subscription_can_write', {
      p_tenant_id: tenantId,
    });
    if (canWrite !== true) {
      return json({ error: 'SellerTray subscription is read-only. Reactivate the business to change team access.' }, 403);
    }

    if (action === 'invite') {
      const email = cleanEmail(body.email);
      const role = cleanTeamRole(body.role);
      if (!email) return json({ error: 'Enter a valid email address' }, 400);
      if (!role) return json({ error: 'Role must be Manager or Staff' }, 400);
      if (!RESEND_API_KEY || !TEAM_INVITE_EMAIL_FROM) {
        console.error(JSON.stringify({ event: 'team_invitation_email_not_configured' }));
        return json({ error: 'Team invitation email is temporarily unavailable. This request did not create or refresh an invitation. Try again later.' }, 503);
      }

      const businessName = await tenantDisplayName(tenantId);
      const result = await rpc<JsonRecord>('invite_orderdesk_team_member', {
        p_tenant_id: tenantId,
        p_actor_user_id: identity.userId,
        p_email: email,
        p_role: role,
      });

      try {
        const invitationId = cleanUuid(result.invitationId);
        if (!invitationId) throw new Error('Governed invitation response did not include an invitation id.');
        await sendTeamInvitationEmail({
          to: email,
          businessName,
          role,
          invitationId,
        });
      } catch (error) {
        console.error(JSON.stringify({
          event: 'team_invitation_email_failed',
          tenant_id: tenantId,
          invitation_id: cleanUuid(result.invitationId) ?? null,
          error: sanitizeObservabilityError(error),
        }));
        return json({
          error: 'The invitation remains pending, but SellerTray could not confirm the email provider accepted the message. Check the recipient inbox and Spam before resending; a retry reuses the existing pending invitation.',
          invitationPending: true,
        }, 503);
      }

      // Keep the legacy emailDelivery field for existing clients, but never claim
      // that provider acceptance means recipient mailbox delivery.
      return json({ result, emailDelivery: 'sent', providerAccepted: true, recipientDeliveryVerified: false }, 201);
    }

    if (action === 'set_role') {
      const targetUserId = cleanUuid(body.targetUserId);
      const role = cleanTeamRole(body.role);
      if (!targetUserId) return json({ error: 'targetUserId is required' }, 400);
      if (!role) return json({ error: 'Role must be Manager or Staff' }, 400);

      await rpc<unknown>('change_orderdesk_team_member', {
        p_tenant_id: tenantId,
        p_actor_user_id: identity.userId,
        p_target_user_id: targetUserId,
        p_action: 'set_role',
        p_role: role,
      });
      return json({ ok: true });
    }

    if (action === 'remove') {
      const targetUserId = cleanUuid(body.targetUserId);
      if (!targetUserId) return json({ error: 'targetUserId is required' }, 400);

      await rpc<unknown>('change_orderdesk_team_member', {
        p_tenant_id: tenantId,
        p_actor_user_id: identity.userId,
        p_target_user_id: targetUserId,
        p_action: 'remove',
        p_role: null,
      });
      return json({ ok: true });
    }

    const invitationId = cleanUuid(body.invitationId);
    if (!invitationId) return json({ error: 'invitationId is required' }, 400);

    await rpc<unknown>('cancel_orderdesk_team_invitation', {
      p_tenant_id: tenantId,
      p_actor_user_id: identity.userId,
      p_invitation_id: invitationId,
    });
    return json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Team management request failed';
    const status = /not a member|only an owner|only an Owner|Managers can|protected|cannot change your own|read-only|belongs to another identity/i.test(message)
      ? 403
      : /already a member|already|conflicts/i.test(message)
        ? 409
        : /not found/i.test(message)
          ? 404
          : 400;
    return json({ error: message }, status);
  }
}));

async function rpc<T>(name: string, body: JsonRecord): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const payload = await safeJson(response);
    const message =
      (payload && typeof payload.message === 'string' && payload.message) ||
      (payload && typeof payload.error === 'string' && payload.error) ||
      `Team RPC failed with HTTP ${response.status}`;
    throw new Error(message);
  }

  const raw = await response.text();
  return (raw ? JSON.parse(raw) : null) as T;
}

async function tenantDisplayName(tenantId: string): Promise<string> {
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/tenants?id=eq.${encodeURIComponent(tenantId)}&select=name&limit=1`,
      {
        headers: {
          apikey: SERVICE_ROLE_KEY,
          authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        },
      },
    );
    if (!response.ok) throw new Error(`Tenant lookup failed with HTTP ${response.status}`);
    const rows = await response.json() as JsonRecord[];
    const name = Array.isArray(rows) && typeof rows[0]?.name === 'string' ? rows[0].name.trim() : '';
    return name || 'a SellerTray business';
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'team_invitation_tenant_name_unavailable',
      tenant_id: tenantId,
      error: sanitizeObservabilityError(error),
    }));
    return 'a SellerTray business';
  }
}

async function sendTeamInvitationEmail({
  to,
  businessName,
  role,
  invitationId,
}: {
  to: string;
  businessName: string;
  role: 'manager' | 'staff';
  invitationId: string;
}): Promise<void> {
  const roleLabel = role === 'staff' ? 'Cashier' : 'Manager';
  const safeBusinessName = escapeHtml(businessName);
  const safeRole = escapeHtml(roleLabel);
  const safeEmail = escapeHtml(to);
  const subjectBusinessName = cleanEmailHeader(businessName) || 'A SellerTray business';
  const actionUrl = `${SELLERTRAY_MERCHANT_URL}/join.html?invitation=${encodeURIComponent(invitationId)}`;
  const html = `
    <!doctype html>
    <html>
      <body style="margin:0;padding:0;background:#f6f8fb;font-family:Arial,sans-serif;color:#17202a">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f8fb;padding:32px 16px">
          <tr><td align="center">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:32px">
              <tr><td>
                <p style="margin:0 0 8px;font-size:14px;font-weight:700;color:#12B76A">SellerTray</p>
                <h2 style="margin:0 0 16px">You're invited to ${safeBusinessName}</h2>
                <p style="font-size:15px;line-height:1.65">You have been invited to join <strong>${safeBusinessName}</strong> in SellerTray as a <strong>${safeRole}</strong>.</p>
                <p style="font-size:15px;line-height:1.65">Use <strong>${safeEmail}</strong> to sign in. If you already use SellerTray for another Business, keep the same account. Access starts only after you review and accept this invitation.</p>
                <p style="margin:24px 0"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#102A43;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700">Review invitation</a></p>
                <p style="font-size:14px;line-height:1.65;color:#475467">On a supported phone, the link opens SellerTray. If the app cannot open, the secure browser fallback lets you continue to SellerTray without granting access automatically.</p>
                <p style="font-size:14px;line-height:1.65;color:#475467">If this email address does not yet have a SellerTray account, create one using this same email address, confirm it if required, then sign in to review the invitation. The invitation expires after 7 days.</p>
                <p style="font-size:14px;line-height:1.65;color:#475467">If you were not expecting this invitation, you can ignore this email.</p>
                <p style="margin:28px 0 0;font-size:12px;line-height:1.6;color:#7b8794">
                  <a href="https://sellertray.com/privacy">Privacy</a> ·
                  <a href="https://sellertray.com/terms">Terms</a><br />
                  SellerTray is a ProcessEdge product.
                </p>
              </td></tr>
            </table>
          </td></tr>
        </table>
      </body>
    </html>
  `;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: TEAM_INVITE_EMAIL_FROM,
      to: [to],
      subject: `${subjectBusinessName} invited you to SellerTray`,
      html,
    }),
    signal: AbortSignal.timeout(3500),
  });

  if (!response.ok) {
    console.error(JSON.stringify({
      event: 'team_invitation_email_provider_error',
      provider: 'resend',
      provider_status: response.status,
    }));
    throw new Error(`Team invitation email provider failed with HTTP ${response.status}`);
  }

  const providerReceipt = await response.json().catch(() => null) as JsonRecord | null;
  const providerMessageId = typeof providerReceipt?.id === 'string' && /^[a-zA-Z0-9_-]{6,100}$/.test(providerReceipt.id)
    ? providerReceipt.id
    : null;
  console.info(JSON.stringify({
    event: 'team_invitation_email_sent', // legacy event key; provider acceptance, not confirmed delivery
    provider: 'resend',
    provider_message_id: providerMessageId,
    recipient_delivery_verified: false,
  }));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function cleanEmailHeader(value: string): string {
  return value
    .replace(/[\r\n]+/g, ' ')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

function sellerTraySender(value: string): string {
  const clean = cleanEmailHeader(value);
  if (!clean) return '';
  const addressMatch = clean.match(/<([^<>]+)>\s*$/);
  const address = cleanEmail(addressMatch?.[1] ?? clean);
  return address ? `SellerTray <${address}>` : '';
}

async function verifiedIdentity(
  authorization: string,
): Promise<{ userId: string; email: string | null } | null> {
  if (!authorization.startsWith('Bearer ')) return null;

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_ROLE_KEY, authorization },
  });
  if (!response.ok) return null;

  let user: JsonRecord;
  try {
    user = await response.json() as JsonRecord;
  } catch {
    return null;
  }

  const userId = cleanUuid(user.id);
  const email = typeof user.email === 'string' ? cleanEmail(user.email) : null;
  return userId ? { userId, email } : null;
}

function cleanAction(value: unknown): TeamAction | null {
  if (typeof value !== 'string') return null;
  const supported: TeamAction[] = [
    'claim',
    'pending_invites',
    'accept_invite',
    'decline_invite',
    'list',
    'history',
    'invite',
    'set_role',
    'remove',
    'cancel_invite',
  ];
  return supported.includes(value as TeamAction) ? value as TeamAction : null;
}

function cleanTeamRole(value: unknown): 'manager' | 'staff' | null {
  return value === 'manager' || value === 'staff' ? value : null;
}

function cleanEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > 320 || !email.includes('@')) return null;
  return email;
}

function cleanUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean)
    ? clean
    : null;
}

async function safeJson(response: Response): Promise<JsonRecord | null> {
  try {
    return await response.json() as JsonRecord;
  } catch {
    return null;
  }
}

function json(payload: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

async function readRequestTextLimited(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false }> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength > maxBytes) {
      return { ok: false };
    }
  }

  if (!request.body) return { ok: true, text: '' };

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return { ok: false };
      }
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return { ok: true, text: parts.join('') };
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Reader may already be released after cancellation.
    }
  }
}

type ObservabilityHandler = (request: Request) => Response | Promise<Response>;

function withObservability(service: string, handler: ObservabilityHandler): ObservabilityHandler {
  return async (request: Request) => {
    const requestId = observabilityRequestId(request);
    const startedAt = Date.now();
    const path = observabilityPath(request.url);

    emitObservability('info', {
      service,
      event: 'request_started',
      request_id: requestId,
      method: request.method,
      path,
    });

    try {
      const response = await handler(request);
      const durationMs = Math.max(0, Date.now() - startedAt);
      const level = response.status >= 500 ? 'error' : response.status >= 400 ? 'warn' : 'info';

      emitObservability(level, {
        service,
        event: 'request_finished',
        request_id: requestId,
        method: request.method,
        path,
        status: response.status,
        duration_ms: durationMs,
      });

      const headers = new Headers(response.headers);
      headers.set('x-orderdesk-request-id', requestId);
      if (headers.has('access-control-allow-origin')) {
        const existing = headers.get('access-control-expose-headers');
        const exposed = new Set(
          (existing ?? '')
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
        );
        exposed.add('x-orderdesk-request-id');
        headers.set('access-control-expose-headers', [...exposed].join(', '));
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (error) {
      emitObservability('error', {
        service,
        event: 'request_exception',
        request_id: requestId,
        method: request.method,
        path,
        duration_ms: Math.max(0, Date.now() - startedAt),
        error: sanitizeObservabilityError(error),
      });
      throw error;
    }
  };
}

function observabilityRequestId(request: Request): string {
  const incoming = request.headers.get('x-request-id')?.trim() ?? '';
  if (/^[A-Za-z0-9._:-]{1,128}$/.test(incoming)) return incoming;
  return crypto.randomUUID();
}

function observabilityPath(urlValue: string): string {
  try {
    return new URL(urlValue).pathname;
  } catch {
    return '/';
  }
}

function sanitizeObservabilityError(error: unknown): Record<string, string> {
  if (!(error instanceof Error)) return { name: 'UnknownError', message: 'Unhandled server error' };

  const message = error.message
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-=]+/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk|sb_secret)_[A-Za-z0-9_-]+\b/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .slice(0, 300);

  return {
    name: error.name || 'Error',
    message: message || 'Unhandled server error',
  };
}

function emitObservability(
  level: 'info' | 'warn' | 'error',
  fields: Record<string, unknown>,
): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    ...fields,
  });

  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
}
