type JsonRecord = Record<string, unknown>;

type OrderFormState = 'confirmed' | 'ready_for_review' | 'preparing' | 'legacy';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MAX_BODY_BYTES = 16_384;
const PURCHASE_STRUCTURES = new Set(['two_installment_70_30', 'three_installment_60_20_20']);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ error: 'Server configuration error' }, 500);

  const authorization = request.headers.get('authorization') ?? '';
  const userId = await verifiedUserId(authorization);
  if (!userId) return json({ error: 'Authentication required' }, 401);

  const bodyRead = await readRequestTextLimited(request, MAX_BODY_BYTES);
  if (!bodyRead.ok) return json({ error: 'Payload too large' }, 413);

  let body: JsonRecord;
  try { body = JSON.parse(bodyRead.text) as JsonRecord; }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const tenantId = cleanUuid(body.tenantId);
  if (!tenantId) return json({ error: 'Business is required' }, 400);

  try {
    if (body.action === 'center') {
      const center = await billingCenter(tenantId, userId);
      return json({ ok: true, center });
    }

    if (body.action === 'create_initial_purchase') {
      const planCode = cleanCode(body.planCode, 64);
      const currency = cleanCurrency(body.currency);
      const structureCode = typeof body.structureCode === 'string' && PURCHASE_STRUCTURES.has(body.structureCode)
        ? body.structureCode
        : null;
      const commandId = cleanUuid(body.commandId);
      const branchIds = cleanUuidArray(body.branchIds, 100);
      if (!planCode) return json({ error: 'Select a SellerTray plan' }, 400);
      if (!currency) return json({ error: 'Select a purchase currency' }, 400);
      if (!structureCode) return json({ error: 'Select a supported installment option' }, 400);
      if (!commandId) return json({ error: 'Purchase command is required' }, 400);
      if (!branchIds?.length) return json({ error: 'Select at least one active Branch' }, 400);

      const purchase = await rpc<JsonRecord>('create_sellertray_initial_installment_purchase_merchant', {
        p_tenant_id: tenantId,
        p_plan_code: planCode,
        p_currency: currency,
        p_branch_ids: branchIds,
        p_structure_code: structureCode,
        p_command_id: commandId,
        p_actor_user_id: userId,
      });
      const center = await billingCenter(tenantId, userId);
      return json({ ok: true, purchase, center });
    }

    return json({ error: 'Unsupported SellerTray billing action' }, 400);
  } catch (error) {
    const message = safeBillingMessage(error);
    const status = /Only the Business Owner|Owner or Manager|access|required|authori[sz]ed|permission/i.test(message)
      ? 403
      : /not found/i.test(message)
        ? 404
        : /already|duplicate|different facts/i.test(message)
          ? 409
          : 400;
    return json({ error: message }, status);
  }
});

async function billingCenter(tenantId: string, userId: string): Promise<JsonRecord> {
  const [billing, agreements, processing] = await Promise.all([
    rpc<JsonRecord>('get_sellertray_commercial_billing_center', {
      p_tenant_id: tenantId,
      p_actor_user_id: userId,
    }),
    rpc<JsonRecord>('get_sellertray_agreement_package_center', {
      p_tenant_id: tenantId,
      p_actor_user_id: userId,
    }),
    rest<Array<JsonRecord>>(`/rest/v1/sellertray_agreement_package_processing?select=commercial_order_id,installment_obligation_id,status&tenant_id=eq.${encodeURIComponent(tenantId)}&limit=200`),
  ]);

  const forms = Array.isArray(agreements.orderForms) ? agreements.orderForms.map(record) : [];
  const processingRows = Array.isArray(processing) ? processing.map(record) : [];
  const orders = Array.isArray(billing.orders) ? billing.orders.map((raw) => {
    const order = record(raw);
    const commercialOrderId = stringValue(order.commercialOrderId);
    const installmentObligationId = stringValue(order.installmentObligationId);
    const form = forms
      .filter((candidate) => stringValue(candidate.commercialOrderId) === commercialOrderId)
      .sort((a, b) => String(b.issuedAt ?? '').localeCompare(String(a.issuedAt ?? '')))[0] ?? null;
    const hasProcessing = processingRows.some((candidate) =>
      stringValue(candidate.commercial_order_id) === commercialOrderId
      || (installmentObligationId && stringValue(candidate.installment_obligation_id) === installmentObligationId));
    const confirmation = form ? record(form.confirmation) : {};
    const orderFormState: OrderFormState = form
      ? (stringValue(confirmation.id) ? 'confirmed' : 'ready_for_review')
      : hasProcessing ? 'preparing' : 'legacy';
    return {
      ...order,
      orderFormId: form ? stringValue(form.id) : null,
      orderFormReference: form ? stringValue(form.orderFormReference) : null,
      orderFormState,
    };
  }) : [];

  return { ...billing, orders };
}

async function rpc<T>(name: string, body: JsonRecord): Promise<T> {
  return await rest<T>(`/rest/v1/rpc/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(body),
  });
}

async function rest<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    let message = `SellerTray billing RPC failed with HTTP ${response.status}`;
    try {
      const payload = await response.json() as JsonRecord;
      if (typeof payload.message === 'string' && payload.message) message = payload.message;
      else if (typeof payload.error === 'string' && payload.error) message = payload.error;
    } catch { /* keep bounded fallback */ }
    throw new Error(message);
  }
  const raw = await response.text();
  return (raw ? JSON.parse(raw) : null) as T;
}

async function verifiedUserId(authorization: string): Promise<string | null> {
  if (!authorization.startsWith('Bearer ')) return null;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_ROLE_KEY, authorization },
  });
  if (!response.ok) return null;
  try {
    const user = await response.json() as JsonRecord;
    return cleanUuid(user.id);
  } catch { return null; }
}

function safeBillingMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : '';
  const allowed = [
    /Only the Business Owner/i,
    /Merchant billing access requires/i,
    /Business (?:and user are|required|not found)/i,
    /Select at least one active Branch/i,
    /Every selected Branch must be active/i,
    /Active SellerTray plan not found/i,
    /No governed .* price is effective/i,
    /Business already has a governed subscription commercial order/i,
    /pre-C2 runtime compatibility state/i,
    /Unsupported installment structure/i,
    /Commercial order reference is already used/i,
  ];
  return allowed.some((pattern) => pattern.test(raw)) ? raw : 'Unable to update SellerTray billing';
}

function cleanUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean) ? clean : null;
}
function cleanUuidArray(value: unknown, max: number): string[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const values = value.map(cleanUuid);
  if (values.some((item) => !item)) return null;
  const clean = values as string[];
  return new Set(clean).size === clean.length ? clean : null;
}
function cleanCode(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return clean && clean.length <= max && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(clean) ? clean : null;
}
function cleanCurrency(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(clean) ? clean : null;
}
function record(value: unknown): JsonRecord { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonRecord : {}; }
function stringValue(value: unknown): string { return typeof value === 'string' ? value : ''; }
async function readRequestTextLimited(request: Request, maxBytes: number): Promise<{ ok: true; text: string } | { ok: false }> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false };
  if (!request.body) return { ok: true, text: '' };
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel(); return { ok: false }; }
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return { ok: true, text: parts.join('') };
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }
}
function json(payload: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
