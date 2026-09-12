import { createClient } from 'npm:@supabase/supabase-js@2.115.0';

type JsonRecord = Record<string, unknown>;

type ManualLine = {
  catalogItemId: string;
  quantity: number;
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MAX_BODY_BYTES = 65_536;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const admin = SUPABASE_URL && SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    })
  : null;

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!admin) return json({ error: 'Server configuration error' }, 500);

  const authorization = request.headers.get('authorization') ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return json({ error: 'Authentication required' }, 401);

  const { data: authData, error: authError } = await admin.auth.getUser(token);
  const userId = authData.user?.id ?? null;
  if (authError || !userId) return json({ error: 'Authentication required' }, 401);

  const bodyRead = await readRequestTextLimited(request, MAX_BODY_BYTES);
  if (!bodyRead.ok) return json({ error: 'Payload too large' }, 413);

  let body: JsonRecord;
  try {
    body = JSON.parse(bodyRead.text) as JsonRecord;
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const tenantId = cleanUuid(body.tenantId);
  const customerName = cleanText(body.customerName, 120);
  const customerPhone = normalizePhone(body.customerPhone);
  const note = cleanText(body.note, 500);
  const lines = parseLines(body.items);

  if (!tenantId) return json({ error: 'Business is required' }, 400);
  if (!customerName) return json({ error: 'Customer name is required' }, 400);
  if (!customerPhone) return json({ error: 'Customer phone is required' }, 400);
  if (!lines.length) return json({ error: 'Add at least one product' }, 400);

  const { data: membership, error: membershipError } = await admin
    .from('tenant_members')
    .select('role')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .maybeSingle();

  if (membershipError) return json({ error: membershipError.message }, 400);
  if (!membership) return json({ error: 'You do not have access to this business' }, 403);

  const { data: orderId, error: createError } = await admin.rpc('create_sellertray_manual_order_atomic', {
    p_tenant_id: tenantId,
    p_customer_name: customerName,
    p_customer_phone: customerPhone,
    p_note: note,
    p_items: lines.map((line) => ({
      catalog_item_id: line.catalogItemId,
      quantity: line.quantity,
    })),
  });

  if (createError || typeof orderId !== 'string') {
    return json({ error: createError?.message ?? 'Unable to create order' }, 400);
  }

  return json({ orderId }, 201);
});

function parseLines(value: unknown): ManualLine[] {
  if (!Array.isArray(value)) return [];
  const lines: ManualLine[] = [];
  for (const entry of value.slice(0, 50)) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as JsonRecord;
    const catalogItemId = cleanUuid(row.catalogItemId);
    const quantity = typeof row.quantity === 'number' ? row.quantity : Number(row.quantity);
    if (!catalogItemId || !Number.isFinite(quantity) || quantity <= 0 || quantity > 9999) continue;
    lines.push({ catalogItemId, quantity });
  }
  return lines;
}

function normalizePhone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim().replace(/[\s()-]/g, '');
  if (!/^\+?[0-9]{7,15}$/.test(clean)) return null;
  return clean;
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim().replace(/\s+/g, ' ');
  return clean ? clean.slice(0, max) : null;
}

function cleanUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean) ? clean : null;
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
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { ok: false };
      }
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return { ok: true, text: parts.join('') };
  } finally {
    try { reader.releaseLock(); } catch { /* no-op */ }
  }
}

function json(payload: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
