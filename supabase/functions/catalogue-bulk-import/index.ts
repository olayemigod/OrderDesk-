import { createClient } from 'npm:@supabase/supabase-js@2.115.0';

type JsonRecord = Record<string, unknown>;
type Action = 'preview' | 'commit';

type ParsedRow = {
  rowNumber: number;
  name: string;
  sku: string | null;
  category: string | null;
  price: number;
  aliases: string[];
  imageUrl: string | null;
};

type PreviewRow = ParsedRow & {
  operation: 'create' | 'update' | 'error';
  existingItemId: string | null;
  errors: string[];
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MAX_BODY_BYTES = 512_000;
const MAX_ROWS = 500;

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
  if (request.method === 'OPTIONS') return json({ ok: true });
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
  const action = body.action === 'commit' ? 'commit' : body.action === 'preview' ? 'preview' : null;
  const sourceText = typeof body.sourceText === 'string' ? body.sourceText : '';
  if (!tenantId || !action || !sourceText.trim()) {
    return json({ error: 'Business, action and catalogue data are required' }, 400);
  }

  const { data: membership, error: membershipError } = await admin
    .from('tenant_members')
    .select('role')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .maybeSingle();

  if (membershipError) return json({ error: membershipError.message }, 400);
  if (!membership || !['owner', 'manager'].includes(String(membership.role))) {
    return json({ error: 'Only the business Owner or Manager can import catalogue products' }, 403);
  }

  const { data: rateAllowed, error: rateError } = await admin.rpc('consume_sellertray_rate_limit', {
    p_scope: 'catalogue_bulk_import',
    p_key: tenantId + ':' + userId,
    p_limit: 20,
    p_window_seconds: 60,
  });
  if (rateError) return json({ error: rateError.message }, 400);
  if (rateAllowed !== true) return json({ error: 'Too many catalogue import attempts. Try again shortly.' }, 429);

  let parsed: ParsedRow[];
  try {
    parsed = parseCatalogueText(sourceText);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Unable to parse catalogue data' }, 400);
  }

  if (parsed.length < 1) return json({ error: 'No product rows were found' }, 400);
  if (parsed.length > MAX_ROWS) return json({ error: 'Import up to 500 products at a time' }, 400);

  const preview = await buildPreview(tenantId, parsed);
  const errors = preview.filter((row) => row.errors.length > 0).length;
  const creates = preview.filter((row) => row.operation === 'create').length;
  const updates = preview.filter((row) => row.operation === 'update').length;

  if (action === 'preview') {
    return json({
      ok: errors === 0,
      summary: {
        total: preview.length,
        create: creates,
        update: updates,
        error: errors,
      },
      rows: preview,
    });
  }

  if (errors > 0) {
    return json({
      error: 'Fix catalogue import errors before committing',
      summary: {
        total: preview.length,
        create: creates,
        update: updates,
        error: errors,
      },
      rows: preview,
    }, 409);
  }

  const payload = preview.map((row) => ({
    name: row.name,
    sku: row.sku,
    category: row.category,
    price: row.price,
    aliases: row.aliases,
    imageUrl: row.imageUrl,
  }));

  const { data: result, error: importError } = await admin.rpc('import_sellertray_catalogue_rows', {
    p_tenant_id: tenantId,
    p_actor_user_id: userId,
    p_rows: payload,
  });

  if (importError) return json({ error: importError.message }, 400);

  return json({
    ok: true,
    result,
    summary: {
      total: preview.length,
      create: creates,
      update: updates,
      error: 0,
    },
  }, 200);
});

async function buildPreview(tenantId: string, rows: ParsedRow[]): Promise<PreviewRow[]> {
  const [{ data: existingItems, error: itemError }, { data: existingAliases, error: aliasError }] = await Promise.all([
    admin!
      .from('catalog_items')
      .select('id,name,sku')
      .eq('tenant_id', tenantId)
      .limit(5000),
    admin!
      .from('catalog_item_aliases')
      .select('catalog_item_id,alias')
      .eq('tenant_id', tenantId)
      .limit(10000),
  ]);

  if (itemError) throw itemError;
  if (aliasError) throw aliasError;

  const items = existingItems ?? [];
  const aliases = existingAliases ?? [];
  const importedSkuKeys = new Map<string, number>();
  const importedNameKeys = new Map<string, number>();
  const importedAliasKeys = new Map<string, number>();

  return rows.map((row) => {
    const errors: string[] = [];
    const skuKey = normalizeKey(row.sku);
    const nameKey = normalizeKey(row.name);

    if (!row.name) errors.push('Product name is required.');
    if (!Number.isFinite(row.price) || row.price < 0) errors.push('Selling price must be zero or greater.');

    if (skuKey) {
      if (importedSkuKeys.has(skuKey)) {
        errors.push('SKU is duplicated in this import (also row ' + importedSkuKeys.get(skuKey) + ').');
      } else {
        importedSkuKeys.set(skuKey, row.rowNumber);
      }
    } else if (nameKey) {
      if (importedNameKeys.has(nameKey)) {
        errors.push('Product name is duplicated in this import; add SKU to distinguish variants.');
      } else {
        importedNameKeys.set(nameKey, row.rowNumber);
      }
    }

    const skuMatches = skuKey
      ? items.filter((item) => normalizeKey(item.sku) === skuKey)
      : [];
    const nameMatches = !skuKey
      ? items.filter((item) => normalizeKey(item.name) === nameKey)
      : [];

    if (skuMatches.length > 1) errors.push('SKU matches more than one existing product.');
    if (!skuKey && nameMatches.length > 1) {
      errors.push('Name matches more than one existing product; add SKU to disambiguate.');
    }

    const existing = skuMatches[0] ?? nameMatches[0] ?? null;

    for (const alias of row.aliases) {
      const aliasKey = normalizeKey(alias);
      if (!aliasKey) continue;

      if (importedAliasKeys.has(aliasKey) && importedAliasKeys.get(aliasKey) !== row.rowNumber) {
        errors.push('Alias "' + alias + '" is also used on row ' + importedAliasKeys.get(aliasKey) + '.');
      } else {
        importedAliasKeys.set(aliasKey, row.rowNumber);
      }

      const conflicting = aliases.find((entry) =>
        normalizeKey(entry.alias) === aliasKey &&
        (!existing || String(entry.catalog_item_id) !== String(existing.id))
      );
      if (conflicting) errors.push('Alias "' + alias + '" already belongs to another catalogue product.');
    }

    return {
      ...row,
      operation: errors.length > 0 ? 'error' : existing ? 'update' : 'create',
      existingItemId: existing ? String(existing.id) : null,
      errors: unique(errors),
    };
  });
}

function parseCatalogueText(sourceText: string): ParsedRow[] {
  const clean = sourceText.replace(/
/g, '
').replace(//g, '
').trim();
  if (!clean) return [];

  const firstLine = clean.split('
')[0] ?? '';
  const delimiter = detectDelimiter(firstLine);
  const records = parseDelimited(clean, delimiter);
  if (records.length < 2) {
    throw new Error('Include a header row and at least one product row.');
  }

  const headers = records[0].map(normalizeHeader);
  const nameIndex = findHeader(headers, ['name', 'product', 'productname', 'item', 'itemname']);
  const priceIndex = findHeader(headers, ['price', 'sellingprice', 'unitprice', 'amount']);
  const skuIndex = findHeader(headers, ['sku', 'code', 'productcode', 'itemcode']);
  const categoryIndex = findHeader(headers, ['category', 'group', 'productcategory', 'itemgroup']);
  const aliasesIndex = findHeader(headers, ['aliases', 'alias', 'customerwords', 'keywords', 'searchterms']);
  const imageIndex = findHeader(headers, ['image', 'imageurl', 'photo', 'photourl']);

  if (nameIndex < 0 || priceIndex < 0) {
    throw new Error('Header must include Product Name and Selling Price columns.');
  }

  return records.slice(1).flatMap((record, index) => {
    if (record.every((cell) => !cell.trim())) return [];

    const name = cleanCell(record[nameIndex], 240);
    const rawPrice = cleanMoney(record[priceIndex]);
    const price = rawPrice === '' ? NaN : Number(rawPrice);
    const sku = skuIndex >= 0 ? cleanOptional(record[skuIndex], 120, true) : null;
    const category = categoryIndex >= 0 ? cleanOptional(record[categoryIndex], 120) : null;
    const aliases = aliasesIndex >= 0 ? splitAliases(record[aliasesIndex]) : [];
    const imageUrl = imageIndex >= 0 ? cleanOptional(record[imageIndex], 1000) : null;

    return [{
      rowNumber: index + 2,
      name,
      sku,
      category,
      price,
      aliases,
      imageUrl,
    }];
  });
}

function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (quoted && next === '"') {
        cell += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (!quoted && char === delimiter) {
      row.push(cell);
      cell = '';
      continue;
    }

    if (!quoted && char === '
') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  if (quoted) throw new Error('The catalogue data has an unclosed quoted value.');
  row.push(cell);
  rows.push(row);
  return rows;
}

function detectDelimiter(header: string): string {
  const tabs = countOutsideQuotes(header, '	');
  const commas = countOutsideQuotes(header, ',');
  const semicolons = countOutsideQuotes(header, ';');
  if (tabs >= commas && tabs >= semicolons && tabs > 0) return '	';
  if (semicolons > commas && semicolons > 0) return ';';
  return ',';
}

function countOutsideQuotes(text: string, target: string): number {
  let quoted = false;
  let count = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === target) count += 1;
  }
  return count;
}

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function findHeader(headers: string[], candidates: string[]): number {
  return headers.findIndex((header) => candidates.includes(header));
}

function cleanMoney(value: string | undefined): string {
  return (value ?? '')
    .trim()
    .replace(/[₦$£€]/g, '')
    .replace(/,/g, '')
    .replace(/s+/g, '');
}

function splitAliases(value: string | undefined): string[] {
  const raw = value?.trim() ?? '';
  if (!raw) return [];
  return unique(
    raw
      .split(/[|;]/)
      .map((entry) => cleanCell(entry, 240))
      .filter(Boolean),
  );
}

function cleanCell(value: string | undefined, max: number): string {
  return (value ?? '').trim().replace(/s+/g, ' ').slice(0, max);
}

function cleanOptional(value: string | undefined, max: number, uppercase = false): string | null {
  const clean = cleanCell(value, max);
  if (!clean) return null;
  return uppercase ? clean.toLocaleUpperCase() : clean;
}

function normalizeKey(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().replace(/s+/g, ' ').toLocaleLowerCase()
    : '';
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
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
