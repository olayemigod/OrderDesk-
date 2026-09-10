const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('OrderDesk provisioning is missing server configuration.');
    return json({ error: 'Server configuration error' }, 500);
  }

  const authorization = request.headers.get('authorization') ?? '';
  const userId = getJwtSubject(authorization);
  if (!userId) {
    return json({ error: 'Authentication required' }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const name = cleanRequired(body.name);
  if (!name) {
    return json({ error: 'Business name is required' }, 400);
  }

  const rpcResponse = await fetch(`${SUPABASE_URL}/rest/v1/rpc/provision_business_for_user`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      p_user_id: userId,
      p_name: name,
      p_business_email: cleanOptional(body.businessEmail),
      p_business_phone: cleanOptional(body.businessPhone),
      p_business_type: cleanOptional(body.businessType),
    }),
  });

  if (!rpcResponse.ok) {
    const details = await safeJson(rpcResponse);
    const message = typeof details?.message === 'string'
      ? details.message
      : 'Unable to create business workspace';
    const status = message.includes('only available when no workspace exists') ? 409 : 400;
    return json({ error: message }, status);
  }

  const tenantId = await rpcResponse.json();
  if (typeof tenantId !== 'string' || !tenantId) {
    return json({ error: 'Provisioning returned an invalid workspace id' }, 500);
  }

  return json({ tenantId }, 201);
});

function getJwtSubject(authorization: string): string | null {
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const payloadSegment = token.split('.')[1];
  if (!payloadSegment) return null;

  try {
    const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const payload = JSON.parse(atob(padded)) as Record<string, unknown>;
    return typeof payload.sub === 'string' && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

function cleanRequired(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function cleanOptional(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function safeJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    return null;
  }
}

function json(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      'content-type': 'application/json',
    },
  });
}
