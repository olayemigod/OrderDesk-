import { createClient } from 'npm:@supabase/supabase-js@2.115.0';

type JsonRecord = Record<string, unknown>;
type LifecycleAction = 'legal_status' | 'accept_legal' | 'export_business' | 'delete_account';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MAX_BODY_BYTES = 65_536;
const MAX_EXPORT_ROWS_PER_COLLECTION = 5_000;
const SELLERTRAY_TERMS_VERSION = '2026-09-12';
const SELLERTRAY_PRIVACY_VERSION = '2026-09-12';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const admin = SUPABASE_URL && SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    })
  : null;

const passwordVerifier = SUPABASE_URL && SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    })
  : null;

Deno.serve(withObservability('account-lifecycle', async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!admin || !passwordVerifier || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ error: 'Server configuration error' }, 500);
  }

  const authorization = request.headers.get('authorization') ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return json({ error: 'Authentication required' }, 401);

  const { data: authData, error: authError } = await admin.auth.getUser(token);
  const identity = {
    userId: authData.user?.id ?? null,
    email: authData.user?.email?.toLowerCase() ?? null,
  };
  if (authError || !identity.userId || !identity.email) {
    return json({ error: 'Authentication required' }, 401);
  }

  const bodyRead = await readRequestTextLimited(request, MAX_BODY_BYTES);
  if (!bodyRead.ok) return json({ error: 'Payload too large' }, 413);

  let body: JsonRecord;
  try {
    body = JSON.parse(bodyRead.text) as JsonRecord;
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const action = cleanAction(body.action);
  if (!action) return json({ error: 'Unsupported account action' }, 400);

  try {
    if (action === 'legal_status') {
      return json(await legalAcceptanceStatus(identity.userId));
    }

    if (action === 'accept_legal') {
      const { error: acceptanceError } = await admin
        .from('user_legal_acceptances')
        .upsert({
          user_id: identity.userId,
          terms_version: SELLERTRAY_TERMS_VERSION,
          privacy_version: SELLERTRAY_PRIVACY_VERSION,
          accepted_via: 'sellertray_mobile',
        }, {
          onConflict: 'user_id,terms_version,privacy_version',
          ignoreDuplicates: true,
        });
      if (acceptanceError) throw acceptanceError;
      return json(await legalAcceptanceStatus(identity.userId));
    }

    if (action === 'export_business') {
      const tenantId = cleanUuid(body.tenantId);
      if (!tenantId) return json({ error: 'tenantId is required' }, 400);
      const role = await membershipRole(identity.userId, tenantId);
      if (role !== 'owner') {
        return json({ error: 'Only the business Owner can export the complete business dataset' }, 403);
      }

      const exportPayload = await buildBusinessExport(tenantId, identity.userId);
      return json({ export: exportPayload });
    }

    const confirmation = typeof body.confirmation === 'string' ? body.confirmation.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const confirmationAccepted =
      confirmation === 'DELETE MY SELLERTRAY ACCOUNT' ||
      confirmation === 'DELETE MY ORDERDESK ACCOUNT';
    if (!confirmationAccepted) {
      return json({ error: 'Type DELETE MY SELLERTRAY ACCOUNT exactly to confirm' }, 400);
    }
    if (!password) return json({ error: 'Enter your current password to confirm account deletion' }, 400);

    const { data: passwordCheck, error: passwordError } = await passwordVerifier.auth.signInWithPassword({
      email: identity.email,
      password,
    });
    if (passwordError || passwordCheck.user?.id !== identity.userId) {
      return json({ error: 'Current password is incorrect' }, 403);
    }

    const deletion = await deleteAccount(identity.userId);
    return json({ deleted: true, ...deletion });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Account operation failed';
    const status = /Only the business Owner|administrator account/i.test(message)
      ? 403
      : /active paid subscription|too large|self-service export limit|support is required/i.test(message)
        ? 409
        : 400;
    return json({ error: message }, status);
  }
}));

async function legalAcceptanceStatus(userId: string): Promise<JsonRecord> {
  const { data, error } = await admin!
    .from('user_legal_acceptances')
    .select('accepted_at')
    .eq('user_id', userId)
    .eq('terms_version', SELLERTRAY_TERMS_VERSION)
    .eq('privacy_version', SELLERTRAY_PRIVACY_VERSION)
    .maybeSingle();
  if (error) throw error;

  return {
    accepted: Boolean(data),
    termsVersion: SELLERTRAY_TERMS_VERSION,
    privacyVersion: SELLERTRAY_PRIVACY_VERSION,
    acceptedAt: typeof data?.accepted_at === 'string' ? data.accepted_at : null,
  };
}

async function buildBusinessExport(tenantId: string, requestedByUserId: string): Promise<JsonRecord> {
  const { data: tenant, error: tenantError } = await admin!
    .from('tenants')
    .select('id,name,slug,business_email,business_phone,business_type,currency,timezone,onboarding_status,subscription_status,whatsapp_connection_status,created_at,updated_at')
    .eq('id', tenantId)
    .maybeSingle();
  if (tenantError) throw tenantError;
  if (!tenant) throw new Error('Business not found');

  const [
    catalogItems,
    catalogAliases,
    customers,
    inboundMessages,
    orders,
    orderItems,
    orderStatusEvents,
    outboundNotifications,
    notificationSettings,
    tenantMembers,
    tenantInvitations,
    tenantSubscriptions,
    usageEvents,
    usageSettlements,
    aiParserAttempts,
    checkoutSessions,
    merchantPaymentMethods,
    orderPayments,
    orderPaymentEvents,
    orderFinancialDocuments,
  ] = await Promise.all([
    loadTenantRows('catalog_items', tenantId),
    loadTenantRows('catalog_item_aliases', tenantId),
    loadTenantRows('customers', tenantId),
    loadTenantRows('inbound_messages', tenantId),
    loadTenantRows('orders', tenantId),
    loadTenantRows('order_items', tenantId),
    loadTenantRows('order_status_events', tenantId),
    loadTenantRows('outbound_notifications', tenantId),
    loadTenantRows('tenant_notification_settings', tenantId),
    loadTenantRows('tenant_members', tenantId),
    loadTenantRows('tenant_invitations', tenantId),
    loadTenantRows('tenant_subscriptions', tenantId),
    loadTenantRows('usage_events', tenantId),
    loadTenantRows('usage_settlements', tenantId),
    loadTenantRows('ai_parser_attempts', tenantId),
    loadTenantRows('billing_checkout_sessions', tenantId),
    loadTenantRows('merchant_payment_methods', tenantId),
    loadTenantRows('order_payments', tenantId),
    loadTenantRows('order_payment_events', tenantId),
    loadTenantRows('order_financial_documents', tenantId),
  ]);

  return {
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    requestedByUserId,
    business: tenant,
    catalogue: {
      items: catalogItems,
      aliases: catalogAliases,
    },
    customers,
    communications: {
      inboundMessages,
      outboundNotifications,
      notificationSettings,
    },
    orders: {
      records: orders,
      items: orderItems,
      statusHistory: orderStatusEvents,
    },
    payments: {
      methods: merchantPaymentMethods,
      attempts: orderPayments.map(sanitizeOrderPayment),
      events: orderPaymentEvents.map(sanitizePaymentEvent),
      financialDocuments: orderFinancialDocuments,
    },
    team: {
      members: tenantMembers,
      invitations: tenantInvitations,
    },
    subscription: {
      records: tenantSubscriptions,
      usageEvents,
      usageSettlements: usageSettlements.map(sanitizeUsageSettlement),
      checkoutSessions: checkoutSessions.map(sanitizeCheckoutSession),
    },
    aiProcessing: {
      parserAttempts: aiParserAttempts,
    },
  };
}

async function loadTenantRows(table: string, tenantId: string): Promise<JsonRecord[]> {
  const rows: JsonRecord[] = [];
  const pageSize = 500;

  for (let from = 0; from <= MAX_EXPORT_ROWS_PER_COLLECTION; from += pageSize) {
    const to = Math.min(from + pageSize - 1, MAX_EXPORT_ROWS_PER_COLLECTION);
    const { data, error } = await admin!
      .from(table)
      .select('*')
      .eq('tenant_id', tenantId)
      .range(from, to);

    if (error) throw new Error(`Unable to export ${table}: ${error.message}`);
    const page = Array.isArray(data) ? data as JsonRecord[] : [];
    rows.push(...page);

    if (rows.length > MAX_EXPORT_ROWS_PER_COLLECTION) {
      throw new Error(`${table} exceeds the self-service export limit; ProcessEdge support is required for a complete export`);
    }
    if (page.length < pageSize) break;
  }

  return rows;
}

function sanitizeUsageSettlement(row: JsonRecord): JsonRecord {
  const { last_error: _lastError, ...safe } = row;
  return safe;
}

function sanitizeCheckoutSession(row: JsonRecord): JsonRecord {
  const { authorization_url: _authorizationUrl, ...safe } = row;
  return safe;
}

function sanitizeOrderPayment(row: JsonRecord): JsonRecord {
  const {
    checkout_url: _checkoutUrl,
    ...safe
  } = row;
  return safe;
}

function sanitizePaymentEvent(row: JsonRecord): JsonRecord {
  const {
    payload_sha256: _payloadSha256,
    ...safe
  } = row;
  return safe;
}

async function deleteAccount(userId: string): Promise<JsonRecord> {
  const { data: platformAdmin, error: adminLookupError } = await admin!
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (adminLookupError) throw adminLookupError;
  if (platformAdmin) {
    throw new Error('ProcessEdge administrator accounts cannot be deleted from the merchant self-service flow');
  }

  const { data: platformAudit, error: auditLookupError } = await admin!
    .from('platform_admin_audit')
    .select('id')
    .eq('actor_user_id', userId)
    .limit(1);
  if (auditLookupError) throw auditLookupError;
  if ((platformAudit?.length ?? 0) > 0) {
    throw new Error('This account has platform-administration audit history; ProcessEdge support is required to close it safely');
  }


  const { data: memberships, error: membershipError } = await admin!
    .from('tenant_members')
    .select('tenant_id,role')
    .eq('user_id', userId);
  if (membershipError) throw membershipError;

  const ownedTenantIds = (memberships ?? [])
    .filter((row) => row.role === 'owner')
    .map((row) => String(row.tenant_id));

  if (ownedTenantIds.length > 0) {
    for (const tenantId of ownedTenantIds) {
      const { data: hasUnsettledUsage, error: usageSettlementError } = await admin!
        .rpc('orderdesk_has_unsettled_usage', { p_tenant_id: tenantId });
      if (usageSettlementError) throw usageSettlementError;
      if (hasUnsettledUsage === true) {
        throw new Error('Settle outstanding AI usage charges before deleting this account');
      }
    }

    const { data: paidSubscriptions, error: subscriptionError } = await admin!
      .from('tenant_subscriptions')
      .select('tenant_id,status,provider_subscription_ref')
      .in('tenant_id', ownedTenantIds)
      .neq('status', 'cancelled')
      .not('provider_subscription_ref', 'is', null);
    if (subscriptionError) throw subscriptionError;
    if ((paidSubscriptions?.length ?? 0) > 0) {
      throw new Error('Cancel the active paid subscription before deleting this account');
    }
  }

  for (const tenantId of ownedTenantIds) {
    const { error: archiveError } = await admin!
      .rpc('archive_sellertray_financial_records', { p_tenant_id: tenantId });
    if (archiveError) throw archiveError;

    const receiptPaths = await loadTenantReceiptStoragePaths(tenantId);
    await removeReceiptStorageObjects(receiptPaths);

    const { error: billingAuditError } = await admin!
      .from('billing_provider_events')
      .delete()
      .eq('tenant_id', tenantId);
    if (billingAuditError) throw billingAuditError;

    const { error: adminAuditError } = await admin!
      .from('platform_admin_audit')
      .delete()
      .eq('tenant_id', tenantId);
    if (adminAuditError) throw adminAuditError;

    const { error: tenantDeleteError } = await admin!
      .from('tenants')
      .delete()
      .eq('id', tenantId);
    if (tenantDeleteError) throw tenantDeleteError;
  }

  const cleanupResults = await Promise.all([
    admin!.from('tenant_invitations').delete().eq('invited_by_user_id', userId),
    admin!.from('billing_checkout_sessions').delete().eq('requested_by_user_id', userId),
    admin!.from('tenant_members').delete().eq('user_id', userId),
  ]);
  const cleanupError = cleanupResults.find((result) => result.error)?.error;
  if (cleanupError) throw cleanupError;

  const { error: deleteUserError } = await admin!.auth.admin.deleteUser(userId);
  if (deleteUserError) {
    throw new Error(`Business data was removed but account closure could not finish: ${deleteUserError.message}. Contact ProcessEdge support so the remaining Auth account can be closed safely.`);
  }

  return {
    ownedBusinessesDeleted: ownedTenantIds.length,
    membershipsRemoved: Math.max(0, (memberships?.length ?? 0) - ownedTenantIds.length),
  };
}

async function loadTenantReceiptStoragePaths(tenantId: string): Promise<string[]> {
  const paths = new Set<string>();
  const pageSize = 500;
  const maxObjects = 5000;

  for (let from = 0; from < maxObjects; from += pageSize) {
    const { data, error } = await admin!
      .from('orders')
      .select('receipt_storage_path')
      .eq('tenant_id', tenantId)
      .not('receipt_storage_path', 'is', null)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Unable to enumerate order receipt files: ${error.message}`);
    const page = Array.isArray(data) ? data : [];
    for (const row of page) {
      if (typeof row.receipt_storage_path === 'string' && row.receipt_storage_path.trim()) {
        paths.add(row.receipt_storage_path.trim());
      }
    }
    if (page.length < pageSize) break;
    if (from + pageSize >= maxObjects) {
      throw new Error('Receipt Storage cleanup exceeds the self-service limit; ProcessEdge support is required');
    }
  }

  for (let from = 0; from < maxObjects; from += pageSize) {
    const { data, error } = await admin!
      .from('order_financial_documents')
      .select('pdf_storage_path')
      .eq('tenant_id', tenantId)
      .not('pdf_storage_path', 'is', null)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Unable to enumerate financial document files: ${error.message}`);
    const page = Array.isArray(data) ? data : [];
    for (const row of page) {
      if (typeof row.pdf_storage_path === 'string' && row.pdf_storage_path.trim()) {
        paths.add(row.pdf_storage_path.trim());
      }
    }
    if (page.length < pageSize) break;
    if (from + pageSize >= maxObjects) {
      throw new Error('Financial PDF Storage cleanup exceeds the self-service limit; ProcessEdge support is required');
    }
  }

  return [...paths];
}

async function removeReceiptStorageObjects(paths: string[]): Promise<void> {
  const chunkSize = 100;
  for (let index = 0; index < paths.length; index += chunkSize) {
    const chunk = paths.slice(index, index + chunkSize);
    const { error } = await admin!.storage.from('receipts').remove(chunk);
    if (error) {
      throw new Error(`Unable to delete SellerTray receipt files: ${error.message}`);
    }
  }
}

async function membershipRole(userId: string, tenantId: string): Promise<string | null> {
  const { data, error } = await admin!
    .from('tenant_members')
    .select('role')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return typeof data?.role === 'string' ? data.role : null;
}

function cleanAction(value: unknown): LifecycleAction | null {
  return value === 'legal_status' ||
      value === 'accept_legal' ||
      value === 'export_business' ||
      value === 'delete_account'
    ? value
    : null;
}

function cleanUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean)
    ? clean
    : null;
}

async function readRequestTextLimited(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false }> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength > maxBytes) return { ok: false };
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
    emitObservability('info', { service, event: 'request_started', request_id: requestId, method: request.method, path });

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
      headers.set('x-sellertray-request-id', requestId);
      if (headers.has('access-control-allow-origin')) {
        const existing = headers.get('access-control-expose-headers');
        const exposed = new Set((existing ?? '').split(',').map((value) => value.trim()).filter(Boolean));
        exposed.add('x-sellertray-request-id');
        headers.set('access-control-expose-headers', [...exposed].join(', '));
      }
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
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
  return { name: error.name || 'Error', message: message || 'Unhandled server error' };
}

function emitObservability(level: 'info' | 'warn' | 'error', fields: Record<string, unknown>): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
}

function json(payload: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
