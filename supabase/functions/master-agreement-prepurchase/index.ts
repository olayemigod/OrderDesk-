import { createClient } from 'npm:@supabase/supabase-js@2.115.0';
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'npm:pdf-lib@1.17.1';

type JsonRecord = Record<string, unknown>;
type Action = 'merchant_get_document' | 'merchant_accept';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const AGREEMENT_BUCKET = 'sellertray-agreement-artifacts';
const admin = SUPABASE_URL && SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
  : null;
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!admin) return json({ error: 'Server configuration error' }, 500);

  const token = bearer(request.headers.get('authorization'));
  if (!token) return json({ error: 'Authentication required' }, 401);
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  const userId = authData.user?.id ?? null;
  if (authError || !userId) return json({ error: 'Authentication required' }, 401);

  let body: JsonRecord;
  try { body = await request.json() as JsonRecord; }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const action: Action = body.action === 'merchant_get_document' ? 'merchant_get_document' : 'merchant_accept';
  const tenantId = uuid(body.tenantId);
  const agreementVersionId = uuid(body.agreementVersionId);
  if (!tenantId || !agreementVersionId) return json({ error: 'Business and current Master Agreement are required' }, 400);

  try {
    const center = await rpc<JsonRecord>('get_sellertray_agreement_package_center', {
      p_tenant_id: tenantId,
      p_actor_user_id: userId,
    });
    const orderForms = Array.isArray(center.orderForms) ? center.orderForms : [];
    const master = record(center.masterAgreement);
    if (center.masterAcceptanceRequired !== true || master.id !== agreementVersionId) {
      throw new Error('The current Master Agreement does not require acceptance for this Business');
    }

    let onboarding: JsonRecord | null = null;
    if (orderForms.length === 0) {
      onboarding = await rpc<JsonRecord>('get_sellertray_onboarding_state_core', { p_tenant_id: tenantId });
      if (record(onboarding.nextAction).code !== 'review_master_agreement') {
        throw new Error('Master Agreement acceptance is not the current onboarding action for this Business');
      }
      if (record(onboarding.nextAction).surface !== 'merchant_web') {
        throw new Error('Master Agreement acceptance is not available on Merchant Web for this Business');
      }
    }

    const document = await ensureMasterReviewDocument(agreementVersionId);
    if (action === 'merchant_get_document') return json({ ok: true, document });

    const commandId = uuid(body.commandId);
    const legalName = text(body.legalName, 200);
    const reviewedPdfSha256 = hash(body.reviewedPdfSha256);
    const reviewedContentSha256 = hash(body.reviewedContentSha256);
    if (!commandId || !legalName || !reviewedPdfSha256 || !reviewedContentSha256) {
      return json({ error: 'Legal name, reviewed Master Agreement PDF and command are required' }, 400);
    }
    if (body.authorityConfirmed !== true) return json({ error: 'Confirm your authority and Master Agreement acceptance before continuing' }, 400);
    if (reviewedPdfSha256 !== document.pdfSha256 || reviewedContentSha256 !== document.contentSha256) {
      throw new Error('The Master Agreement changed or the reviewed PDF is no longer current. Open the current Master Agreement PDF again before accepting.');
    }

    const userAgent = text(request.headers.get('user-agent'), 512);
    const acceptanceId = await rpc<string>('accept_sellertray_master_agreement', {
      p_tenant_id: tenantId,
      p_agreement_version_id: agreementVersionId,
      p_accepted_legal_name: legalName,
      p_request_evidence: {
        channel: 'merchant_web',
        flow: orderForms.length === 0 ? 'prepurchase_master_pdf_acceptance' : 'master_version_pdf_acceptance',
        authority_confirmed: true,
        reviewed_pdf_sha256: document.pdfSha256,
        reviewed_content_sha256: document.contentSha256,
        reviewed_document_kind: 'master_agreement_pdf',
        ...(userAgent ? { user_agent: userAgent } : {}),
      },
      p_command_id: commandId,
      p_actor_user_id: userId,
    });

    const nextCenter = await rpc<JsonRecord>('get_sellertray_agreement_package_center', {
      p_tenant_id: tenantId,
      p_actor_user_id: userId,
    });
    let nextAction: unknown = null;
    if (orderForms.length === 0) {
      const nextOnboarding = await rpc<JsonRecord>('get_sellertray_onboarding_state_core', { p_tenant_id: tenantId });
      if (record(nextOnboarding.nextAction).code !== 'select_plan') {
        throw new Error('Master Agreement acceptance was recorded but SellerTray Billing is not yet the governed next step');
      }
      nextAction = nextOnboarding.nextAction;
    }

    return json({ ok: true, acceptanceId, center: nextCenter, nextAction });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Master Agreement request failed';
    return json({ error: message }, /access|required|authori[sz]ed|owner|manager|available/i.test(message) ? 403 : /exists|current|changed|next step/i.test(message) ? 409 : 400);
  }
});

async function ensureMasterReviewDocument(agreementVersionId: string): Promise<JsonRecord> {
  if (!admin) throw new Error('Server configuration error');
  const { data: master, error: masterError } = await admin.from('sellertray_master_agreement_versions')
    .select('id,version_code,title,content_body,content_sha256,effective_from')
    .eq('id', agreementVersionId).single();
  if (masterError || !master) throw new Error(masterError?.message ?? 'Master Agreement version not found');

  const { data: source } = await admin.from('sellertray_master_agreement_source_documents')
    .select('storage_bucket,storage_path,original_filename,pdf_sha256,byte_size')
    .eq('agreement_version_id', agreementVersionId).maybeSingle();
  if (source) {
    const signed = await admin.storage.from(source.storage_bucket).createSignedUrl(source.storage_path, 600);
    if (signed.error || !signed.data?.signedUrl) throw new Error(signed.error?.message ?? 'Unable to open the reviewed Master Agreement PDF');
    return {
      documentKind: 'master_agreement_pdf', agreementVersionId, versionCode: master.version_code, title: master.title,
      contentSha256: master.content_sha256, pdfSha256: source.pdf_sha256, byteSize: Number(source.byte_size ?? 0),
      fileName: source.original_filename || `SellerTray-Master-Agreement-${safeFilePart(master.version_code)}.pdf`,
      signedUrl: signed.data.signedUrl, expiresInSeconds: 600,
    };
  }

  const pdfBytes = await buildMasterPdf({
    title: master.title, versionCode: master.version_code, contentBody: master.content_body,
    effectiveFrom: master.effective_from, contentSha256: master.content_sha256,
  });
  const pdfSha256 = await sha256Hex(pdfBytes);
  const storagePath = `master-review/${agreementVersionId}/${master.content_sha256}.pdf`;
  const upload = await admin.storage.from(AGREEMENT_BUCKET).upload(storagePath, pdfBytes, {
    contentType: 'application/pdf', cacheControl: '0', upsert: false,
  });
  if (upload.error && !/already exists|duplicate/i.test(upload.error.message)) throw new Error(upload.error.message);
  if (upload.error) {
    const existing = await admin.storage.from(AGREEMENT_BUCKET).download(storagePath);
    if (existing.error || !existing.data) throw new Error('Unable to verify the governed Master Agreement PDF');
    const existingHash = await sha256Hex(new Uint8Array(await existing.data.arrayBuffer()));
    if (existingHash !== pdfSha256) throw new Error('Stored Master Agreement PDF does not match the current published content');
  }
  const signed = await admin.storage.from(AGREEMENT_BUCKET).createSignedUrl(storagePath, 600);
  if (signed.error || !signed.data?.signedUrl) throw new Error(signed.error?.message ?? 'Unable to open the Master Agreement PDF');
  return {
    documentKind: 'master_agreement_pdf', agreementVersionId, versionCode: master.version_code, title: master.title,
    contentSha256: master.content_sha256, pdfSha256, byteSize: pdfBytes.byteLength,
    fileName: `SellerTray-Master-Agreement-${safeFilePart(master.version_code)}.pdf`, signedUrl: signed.data.signedUrl, expiresInSeconds: 600,
  };
}

async function buildMasterPdf(input: { title: string; versionCode: string; contentBody: string; effectiveFrom: string; contentSha256: string }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(input.title);
  doc.setAuthor('ProcessEdge Solutions Limited');
  doc.setSubject(`SellerTray Master Agreement ${input.versionCode}`);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(16 / 255, 42 / 255, 67 / 255);
  const green = rgb(18 / 255, 183 / 255, 106 / 255);
  const slate = rgb(71 / 255, 84 / 255, 103 / 255);
  let page = doc.addPage([595.28, 841.89]);
  let y = 785;
  page.drawText('SellerTray', { x: 54, y, size: 28, font: bold, color: navy });
  page.drawText('ProcessEdge Solutions Limited', { x: 54, y: y - 24, size: 10, font: regular, color: slate });
  page.drawText(pdfText(input.title), { x: 54, y: y - 72, size: 17, font: bold, color: navy, maxWidth: 485 });
  page.drawText(pdfText(`Version ${input.versionCode} - Effective ${formatDate(input.effectiveFrom)}`), { x: 54, y: y - 98, size: 9.5, font: regular, color: green });
  y -= 138;

  for (const paragraph of input.contentBody.split(/\n\s*\n/)) {
    const lines = wrap(pdfText(paragraph.replace(/\s+/g, ' ').trim()), regular, 10, 487);
    if (!lines.length) continue;
    for (const line of lines) {
      if (y < 70) { page = doc.addPage([595.28, 841.89]); y = 785; }
      page.drawText(line, { x: 54, y, size: 10, font: regular, color: slate });
      y -= 14;
    }
    y -= 8;
  }
  if (y < 120) { page = doc.addPage([595.28, 841.89]); y = 785; }
  page.drawText('Document integrity', { x: 54, y, size: 10, font: bold, color: navy });
  page.drawText(`Master content SHA-256: ${input.contentSha256}`, { x: 54, y: y - 20, size: 7.5, font: regular, color: slate, maxWidth: 487 });
  return doc.save({ useObjectStreams: true, addDefaultPage: false });
}

function wrap(value: string, font: PDFFont, size: number, maxWidth: number): string[] {
  if (!value) return [];
  const words = value.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) line = candidate;
    else { if (line) lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

function pdfText(value: string): string {
  return value
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u2022/g, '*')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '?');
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, '0')).join('');
}
async function rpc<T>(name: string, args: JsonRecord): Promise<T> {
  if (!admin) throw new Error('Server configuration error');
  const { data, error } = await admin.rpc(name, args);
  if (error) throw new Error(error.message ?? 'SellerTray agreement RPC failed');
  return data as T;
}
function bearer(value: string | null): string | null { return value?.startsWith('Bearer ') ? value.slice(7) : null; }
function uuid(value: unknown): string | null { const clean = typeof value === 'string' ? value.trim() : ''; return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean) ? clean : null; }
function hash(value: unknown): string | null { const clean = typeof value === 'string' ? value.trim().toLowerCase() : ''; return /^[0-9a-f]{64}$/.test(clean) ? clean : null; }
function text(value: unknown, max: number): string | null { const clean = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''; return clean && clean.length <= max ? clean : null; }
function record(value: unknown): JsonRecord { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonRecord : {}; }
function json(payload: JsonRecord, status = 200): Response { return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } }); }
function safeFilePart(value: string): string { return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'Current'; }
function formatDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0, 10); }
