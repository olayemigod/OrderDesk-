import { createClient } from 'npm:@supabase/supabase-js@2.115.0';

type JsonRecord = Record<string, unknown>;
type InventoryOperation = 'receive' | 'adjust';
type AdjustmentDirection = 'increase' | 'decrease';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MAX_BODY_BYTES = 12_288;

const RECEIVE_REASONS = new Map<string, string>([
  ['supplier delivery', 'Supplier delivery'],
  ['opening stock', 'Opening stock'],
  ['other approved receipt', 'Other approved receipt'],
]);

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
  const productId = cleanUuid(body.productId);
  const uomId = cleanUuid(body.uomId);
  const operation = cleanOperation(body.operation);
  const quantity = cleanPositiveNumber(body.quantity);
  const adjustmentDirection = cleanDirection(body.adjustmentDirection);
  const reference = cleanText(body.reference, 160);
  const commandId = cleanCommandId(body.commandId);
  const rawReason = cleanText(body.reason, 120);
  const reason = operation && rawReason ? cleanReason(operation, rawReason) : null;

  if (!tenantId || !branchId || !productId || !uomId || !operation || quantity === null || !reference || !commandId || !rawReason) {
    return json({ error: 'Business, branch, product, unit, quantity, reference and reason are required' }, 400);
  }
  if (!reason) {
    return json({ error: 'Choose an approved reason for this stock action' }, 400);
  }
  if (operation === 'adjust' && !adjustmentDirection) {
    return json({ error: 'Choose whether the adjustment increases or decreases stock' }, 400);
  }

  const forcedDirection = operation === 'adjust' ? requiredDirectionForReason(reason) : null;
  if (forcedDirection && adjustmentDirection !== forcedDirection) {
    return json({ error: `${reason} must ${forcedDirection === 'increase' ? 'increase' : 'reduce'} stock` }, 409);
  }

  const { data: membership, error: membershipError } = await admin
    .from('tenant_members')
    .select('role')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .maybeSingle();

  if (membershipError) return json({ error: membershipError.message }, 400);
  if (!membership) return json({ error: 'You do not have access to this business' }, 403);

  const { data: result, error } = await admin.rpc('apply_sellertray_inventory_operation', {
    p_tenant_id: tenantId,
    p_branch_id: branchId,
    p_catalog_item_id: productId,
    p_uom_id: uomId,
    p_operation: operation,
    p_quantity: quantity,
    p_adjustment_direction: operation === 'adjust' ? adjustmentDirection : null,
    p_reference: reference,
    p_reason: reason,
    p_command_id: commandId,
    p_actor_user_id: userId,
  });

  if (error || !isInventoryOperationResult(result)) {
    const message = error?.message ?? 'SellerTray could not post this stock movement';
    const status = /permission|access|role|read-only/i.test(message)
      ? 403
      : /not found/i.test(message)
        ? 404
        : /not enough|does not allow|already used|unavailable|cannot|invalid|must|use stock/i.test(message)
          ? 409
          : 400;
    return json({ error: message }, status);
  }

  return json({ ok: true, ...result });
});

function cleanOperation(value: unknown): InventoryOperation | null {
  return value === 'receive' || value === 'adjust' ? value : null;
}

function cleanDirection(value: unknown): AdjustmentDirection | null {
  return value === 'increase' || value === 'decrease' ? value : null;
}

function cleanUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean)
    ? clean
    : null;
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

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim().replace(/\s+/g, ' ');
  return clean ? clean.slice(0, max) : null;
}

function cleanReason(operation: InventoryOperation, value: string): string | null {
  const key = value.trim().replace(/\s+/g, ' ').toLowerCase();
  return (operation === 'receive' ? RECEIVE_REASONS : ADJUST_REASONS).get(key) ?? null;
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
    && (row.operation === 'receive' || row.operation === 'adjust')
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
    headers: {
      ...corsHeaders,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}