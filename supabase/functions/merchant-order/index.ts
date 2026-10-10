import { createClient } from 'npm:@supabase/supabase-js@2.115.0';

type JsonRecord = Record<string, unknown>;

type ManualLine = {
  catalogItemId: string;
  quantity: number;
};

type PosLine = ManualLine & {
  uomId: string;
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

  const mode = body.mode === 'pos' ? 'pos' : 'manual';
  const tenantId = cleanUuid(body.tenantId);
  const customerName = cleanText(body.customerName, 120);
  const customerPhone = normalizePhone(body.customerPhone);
  const note = cleanText(body.note, 500);
  const requestId = cleanUuid(body.requestId);

  if (!tenantId) return json({ error: 'Business is required' }, 400);

  const { data: membership, error: membershipError } = await admin
    .from('tenant_members')
    .select('role')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .maybeSingle();

  if (membershipError) return json({ error: membershipError.message }, 400);
  if (!membership) return json({ error: 'You do not have access to this business' }, 403);

  if (mode === 'pos') {
    const branchId = cleanUuid(body.branchId);
    const lines = parsePosLines(body.items);

    if (!branchId) return json({ error: 'Branch is required' }, 400);
    if (!lines.length) return json({ error: 'Add at least one product' }, 400);
    if ((customerName === null) !== (customerPhone === null)) {
      return json({ error: 'Enter both customer name and phone, or leave both blank for a walk-in sale' }, 400);
    }

    const { data: branch, error: branchError } = await admin
      .from('branches')
      .select('id,is_default,is_active')
      .eq('tenant_id', tenantId)
      .eq('id', branchId)
      .maybeSingle();

    if (branchError) return json({ error: branchError.message }, 400);
    if (!branch?.is_active) return json({ error: 'Selected branch is unavailable' }, 400);

    if (String(membership.role) === 'staff') {
      const { data: assignments, error: accessError } = await admin
        .from('branch_user_access')
        .select('branch_id,can_operate')
        .eq('tenant_id', tenantId)
        .eq('user_id', userId);

      if (accessError) return json({ error: accessError.message }, 400);
      const branchAssignments = assignments ?? [];
      const hasExplicitAssignments = branchAssignments.length > 0;
      const hasBranchAccess = branchAssignments.some(
        (entry) => entry.branch_id === branchId && entry.can_operate === true,
      );

      if ((hasExplicitAssignments && !hasBranchAccess) || (!hasExplicitAssignments && !branch.is_default)) {
        return json({ error: 'You do not have access to sell from this branch' }, 403);
      }
    }

    const rpcItems = lines.map((line) => ({
      catalog_item_id: line.catalogItemId,
      uom_id: line.uomId,
      quantity: line.quantity,
    }));
    let orderId: string | null = null;
    let idempotentReplay = false;
    let createErrorMessage: string | null = null;

    if (requestId) {
      const { data: createResult, error: createError } = await admin.rpc('create_sellertray_pos_order_idempotent', {
        p_tenant_id: tenantId,
        p_branch_id: branchId,
        p_customer_name: customerName,
        p_customer_phone: customerPhone,
        p_note: note,
        p_items: rpcItems,
        p_request_id: requestId,
      });
      if (createError) createErrorMessage = createError.message;
      if (createResult && typeof createResult === 'object' && !Array.isArray(createResult)) {
        const row = createResult as JsonRecord;
        if (typeof row.orderId === 'string') orderId = row.orderId;
        idempotentReplay = row.idempotentReplay === true;
      }
    } else {
      const { data: createdOrderId, error: createError } = await admin.rpc('create_sellertray_pos_order_atomic', {
        p_tenant_id: tenantId,
        p_branch_id: branchId,
        p_customer_name: customerName,
        p_customer_phone: customerPhone,
        p_note: note,
        p_items: rpcItems,
      });
      if (createError) createErrorMessage = createError.message;
      if (typeof createdOrderId === 'string') orderId = createdOrderId;
    }

    if (createErrorMessage || !orderId) {
      const message = createErrorMessage ?? 'Unable to create sale';
      return json({ error: message }, /already used for different sale details/i.test(message) ? 409 : 400);
    }

    await writeOrderCreationAudit({
      tenantId,
      userId,
      role: String(membership.role),
      orderId,
      actionKey: 'pos-draft:' + orderId,
      actionType: 'pos_draft_created',
      customerName: customerName ?? 'Walk-in Customer',
      customerPhone,
      lineCount: lines.length,
      metadata: {
        source: 'pos',
        branch_id: branchId,
        request_id: requestId,
        idempotent_replay: idempotentReplay,
      },
    });

    return json({ orderId, status: 'draft', source: 'pos', idempotentReplay }, idempotentReplay ? 200 : 201);
  }

  const lines = parseManualLines(body.items);
  if (!customerName) return json({ error: 'Customer name is required' }, 400);
  if (!customerPhone) return json({ error: 'Customer phone is required' }, 400);
  if (!lines.length) return json({ error: 'Add at least one product' }, 400);

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

  await writeOrderCreationAudit({
    tenantId,
    userId,
    role: String(membership.role),
    orderId,
    actionKey: 'manual-order:' + orderId,
    actionType: 'manual_order_created',
    customerName,
    customerPhone,
    lineCount: lines.length,
    metadata: { source: 'merchant_app' },
  });

  return json({ orderId }, 201);
});

async function writeOrderCreationAudit(input: {
  tenantId: string;
  userId: string;
  role: string;
  orderId: string;
  actionKey: string;
  actionType: string;
  customerName: string;
  customerPhone: string | null;
  lineCount: number;
  metadata: JsonRecord;
}): Promise<void> {
  if (!admin) return;

  const { data: createdOrder } = await admin
    .from('orders')
    .select('id,customer_id,branch_id,public_order_id,status,payment_status,amount_paid,total_amount,currency,fulfillment_status,fulfillment_method,source')
    .eq('id', input.orderId)
    .eq('tenant_id', input.tenantId)
    .maybeSingle();

  if (!createdOrder) return;

  const requestedBy = input.role === 'staff' ? 'staff' : 'merchant';
  const { error: auditError } = await admin
    .from('commercial_action_ledger')
    .upsert({
      tenant_id: input.tenantId,
      action_key: input.actionKey,
      channel: 'merchant_app',
      customer_id: createdOrder.customer_id,
      target_order_id: input.orderId,
      action_type: input.actionType,
      risk_class: 'medium',
      requested_by: requestedBy,
      actor_user_id: input.userId,
      policy_result: 'allowed',
      action_status: 'applied',
      financial_impact: null,
      currency: createdOrder.currency,
      before_state: {},
      after_state: {
        public_order_id: createdOrder.public_order_id,
        status: createdOrder.status,
        payment_status: createdOrder.payment_status,
        amount_paid: createdOrder.amount_paid,
        total_amount: createdOrder.total_amount,
        currency: createdOrder.currency,
        fulfillment_status: createdOrder.fulfillment_status,
        fulfillment_method: createdOrder.fulfillment_method,
        branch_id: createdOrder.branch_id,
        source: createdOrder.source,
      },
      metadata: {
        customer_name: input.customerName,
        customer_phone: input.customerPhone,
        line_count: input.lineCount,
        ...input.metadata,
      },
      applied_at: new Date().toISOString(),
    }, {
      onConflict: 'tenant_id,action_key',
      ignoreDuplicates: true,
    });

  if (auditError) {
    console.warn('SellerTray order creation audit write failed', auditError.message);
  }
}

function parseManualLines(value: unknown): ManualLine[] {
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

function parsePosLines(value: unknown): PosLine[] {
  if (!Array.isArray(value)) return [];
  const lines: PosLine[] = [];
  for (const entry of value.slice(0, 100)) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as JsonRecord;
    const catalogItemId = cleanUuid(row.catalogItemId);
    const uomId = cleanUuid(row.uomId);
    const quantity = typeof row.quantity === 'number' ? row.quantity : Number(row.quantity);
    if (!catalogItemId || !uomId || !Number.isFinite(quantity) || quantity <= 0 || quantity > 9999) continue;
    lines.push({ catalogItemId, uomId, quantity });
  }
  return lines;
}

function normalizePhone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim().replace(/[\s()-]/g, '');
  if (!clean) return null;
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