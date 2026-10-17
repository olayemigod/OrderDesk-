import { createClient } from 'npm:@supabase/supabase-js@2.115.0';

type JsonRecord = Record<string, unknown>;
type InventoryAction = 'adjust' | 'policy';
type AdjustmentDirection = 'increase' | 'decrease';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MAX_BODY_BYTES = 12_288;

const ADJUST_REASONS = new Map<string, string>([
  ['data correction', 'Data correction'],
  ['damage', 'Damage'],
  ['expiry', 'Expiry'],
  ['missing / shrinkage', 'Missing / shrinkage'],
  ['inventory recovery', 'Inventory recovery'],
  ['other approved adjustment', 'Other approved adjustment'],
]);

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
  const branchId = cleanUuid(body.branchId);
  const action = cleanAction(body.operation);
  if (!tenantId || !branchId || !action) {
    return json({ error: 'Business, branch and stock action are required' }, 400);
  }

  const { data: membership, error: membershipError } = await admin
    .from('tenant_members')
    .select('role')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .maybeSingle();

  if (membershipError) return json({ error: membershipError.message }, 400);
  if (!membership) return json({ error: 'You do not have access to this business' }, 403);

  if (action === 'policy') {
    const productId = cleanUuid(body.productId);
    const lowStockThreshold = cleanNonNegativeNumber(body.lowStockThreshold);
    const reorderTarget = body.reorderTarget == null || body.reorderTarget === ''
      ? null
      : cleanNonNegativeNumber(body.reorderTarget);
    if (!productId || lowStockThreshold === null || (body.reorderTarget != null && body.reorderTarget !== '' && reorderTarget === null)) {
      return json({ error: 'Product and valid low-stock quantities are required' }, 400);
    }
    const { data, error } = await admin.rpc('set_sellertray_low_stock_policy', {
      p_tenant_id: tenantId,
      p_branch_id: branchId,
      p_catalog_item_id: productId,
      p_low_stock_threshold: lowStockThreshold,
      p_reorder_target: reorderTarget,
      p_actor_user_id: userId,
    });
    if (error || !data || typeof data !== 'object') return rpcError(error?.message, 'SellerTray could not update this low-stock policy');
    return json({ ok: true, ...(data as JsonRecord) });
  }

  const productId = cleanUuid(body.productId);
  const uomId = cleanUuid(body.uomId);
  const quantity = cleanPositiveNumber(body.quantity);
  const adjustmentDirection = cleanDirection(body.adjustmentDirection);
  const reference = cleanText(body.reference, 160);
  const commandId = cleanCommandId(body.commandId);
  const rawReason = cleanText(body.reason, 120);
  const reason = rawReason ? cleanReason(rawReason) : null;

  if (!productId || !uomId || quantity === null || !adjustmentDirection || !reference || !commandId || !rawReason) {
    return json({ error: 'Product, unit, quantity, direction, reference and reason are required' }, 400);
  }
  if (!reason) return json({ error: 'Choose an approved reason for this stock adjustment' }, 400);

  const forcedDirection = requiredDirectionForReason(reason);
  if (forcedDirection && adjustmentDirection !== forcedDirection) {
    return json({ error: `${reason} must ${forcedDirection === 'increase' ? 'increase' : 'reduce'} stock` }, 409);
  }

  const { data: result, error } = await admin.rpc('apply_sellertray_stock_adjustment', {
    p_tenant_id: tenantId,
    p_branch_id: branchId,
    p_catalog_item_id: productId,
    p_uom_id: uomId,
    p_quantity: quantity,
    p_adjustment_direction: adjustmentDirection,
    p_reference: reference,
    p_reason: reason,
    p_command_id: commandId,
    p_actor_user_id: userId,
  });

  if (error || !isInventoryOperationResult(result)) {
    return rpcError(error?.message, 'SellerTray could not post this stock adjustment');
  }
  return json({ ok: true, ...result });
});

function rpcError(messageValue: string | undefined, fallback: string): Response {
  const message = messageValue ?? fallback;
  const status = /permission|access|role|read-only/i.test(message)
    ? 403
    : /not found/i.test(message)
      ? 404
      : /not enough|does not allow|already used|unavailable|cannot|invalid|must|use stock|reorder/i.test(message)
        ? 409
        : 400;
  return json({ error: message }, status);
}

function cleanAction(value: unknown): InventoryAction | null {
  return value === 'adjust' || value === 'policy' ? value : null;
}
function cleanDirection(value: unknown): AdjustmentDirection | null {
  return value === 'increase' || value === 'decrease' ? value : null;
}
function cleanUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean) ? clean : null;
}
function cleanCommandId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9:_-]{7,159}$/.test(clean) ? clean : null;
}
function cleanPositiveNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
function cleanNonNegativeNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim().replace(/\s+/g, ' ');
  return clean ? clean.slice(0, max) : null;
}
function cleanReason(value: string): string | null {
  return ADJUST_REASONS.get(value.trim().replace(/\s+/g, ' ').toLowerCase()) ?? null;
}
function requiredDirectionForReason(reason: string): AdjustmentDirection | null {
  if (reason === 'Damage' || reason === 'Expiry' || reason === 'Missing / shrinkage') return 'decrease';
  if (reason === 'Inventory recovery') return 'increase';
  return null;
}
function isInventoryOperationResult(value: unknown): value is JsonRecord {
  if (!value || typeof value !== 'object') return false;
  const row = value as JsonRecord;
  return typeof row.movementId === 'string'
    && row.operation === 'adjust'
    && typeof row.productId === 'string'
    && typeof row.productName === 'string'
    && typeof row.sourceUom === 'string'
    && typeof row.sourceQuantity === 'number'
    && typeof row.conversionFactor === 'number'
    && typeof row.stockUom === 'string'
    && typeof row.quantityDelta === 'number'
    && typeof row.quantityOnHand === 'number'
    && typeof row.reference === 'string'
    && typeof row.idempotentReplay === 'boolean';
}

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
    try { reader.releaseLock(); } catch { /* no-op */ }
  }
}

function json(payload: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
