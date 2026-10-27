import { createClient } from 'npm:@supabase/supabase-js@2.115.0';
import { buildAgreementPackagePdf, inspectUploadedMasterPdf, sha256Hex, type AgreementPdfInput } from './agreement-pdf.ts';

type JsonRecord = Record<string, unknown>;
type ArtifactKind = 'review_pdf' | 'executed_pdf';
type Action =
  | 'merchant_get'
  | 'merchant_get_document'
  | 'merchant_confirm_package'
  | 'merchant_accept'
  | 'admin_get'
  | 'admin_get_document'
  | 'admin_publish'
  | 'admin_publish_pdf'
  | 'admin_publish_order_form_template'
  | 'admin_issue_order_form';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const AGREEMENT_BUCKET = 'sellertray-agreement-artifacts';
const MAX_PDF_BYTES = 8 * 1024 * 1024;
const MAX_BODY_BYTES = 11_500_000;
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const admin = SUPABASE_URL && SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
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
  try { body = JSON.parse(bodyRead.text) as JsonRecord; }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const action = cleanAction(body.action);
  if (!action) return json({ error: 'Unsupported Master Agreement action' }, 400);

  try {
    if (action === 'merchant_get') {
      const tenantId = cleanUuid(body.tenantId);
      if (!tenantId) return json({ error: 'Business is required' }, 400);
      const center = await merchantCenter(tenantId, userId);
      return json({ ok: true, center });
    }

    if (action === 'merchant_get_document') {
      const tenantId = cleanUuid(body.tenantId);
      const orderFormId = cleanUuid(body.orderFormId);
      const artifactKind = cleanArtifactKind(body.artifactKind);
      if (!tenantId || !orderFormId || !artifactKind) return json({ error: 'Business, Order Form and document type are required' }, 400);
      const center = await merchantCenter(tenantId, userId);
      const orderForms = Array.isArray(center.orderForms) ? center.orderForms : [];
      if (!orderForms.some((item) => cleanUuid(record(item).id) === orderFormId)) return json({ error: 'Order Form not found' }, 404);
      const masterAcceptanceRequired = center.masterAcceptanceRequired === true;
      const document = await ensureAgreementArtifact({
        tenantId,
        orderFormId,
        artifactKind,
        actorUserId: userId,
        preferCurrentMaster: artifactKind === 'review_pdf' || masterAcceptanceRequired,
      });
      return json({ ok: true, document });
    }

    if (action === 'merchant_accept') {
      return json({
        error: 'Master Agreement acceptance now completes with the exact current Order Form. Refresh Agreements and confirm the purchase package.',
      }, 409);
    }

    if (action === 'merchant_confirm_package') {
      const tenantId = cleanUuid(body.tenantId);
      const orderFormId = cleanUuid(body.orderFormId);
      const expectedPackageId = cleanUuid(body.expectedPackageId);
      const expectedPackageFingerprint = cleanHash(body.expectedPackageFingerprint);
      const commandId = cleanUuid(body.commandId);
      const legalName = cleanText(body.legalName, 200);
      if (!tenantId || !orderFormId || !expectedPackageId || !expectedPackageFingerprint || !commandId || !legalName) {
        return json({ error: 'Business, reviewed Agreement Package, current Order Form, legal name and command are required' }, 400);
      }
      if (body.authorityConfirmed !== true) return json({ error: 'Confirm your authority and purchase approval before continuing' }, 400);

      const userAgent = cleanText(request.headers.get('user-agent'), 512);
      const result = await rpc<JsonRecord>('confirm_sellertray_agreement_package_reviewed', {
        p_tenant_id: tenantId,
        p_order_form_id: orderFormId,
        p_expected_package_id: expectedPackageId,
        p_expected_package_fingerprint: expectedPackageFingerprint,
        p_confirmed_legal_name: legalName,
        p_request_evidence: {
          channel: 'merchant_web',
          authority_confirmed: true,
          electronic_signature_method: 'authenticated_typed_legal_name',
          ...(userAgent ? { user_agent: userAgent } : {}),
        },
        p_command_id: commandId,
        p_actor_user_id: userId,
      });

      await reconcileTenantInstallmentsBestEffort(tenantId, 'Agreement Package confirmation');
      const center = await merchantCenter(tenantId, userId);
      return json({ ok: true, result, center });
    }

    if (action === 'admin_get') {
      const tenantId = optionalUuid(body.tenantId);
      if (body.tenantId !== null && body.tenantId !== undefined && body.tenantId !== '' && !tenantId) {
        return json({ error: 'A valid Business is required' }, 400);
      }
      const overview = await adminOverview(userId, tenantId);
      return json({ ok: true, overview });
    }

    if (jwtAal(token) !== 'aal2') {
      return json({ error: 'MFA verification is required for this legal/commercial administrator action' }, 403);
    }

    if (action === 'admin_get_document') {
      const tenantId = cleanUuid(body.tenantId);
      const orderFormId = cleanUuid(body.orderFormId);
      const artifactKind = cleanArtifactKind(body.artifactKind);
      if (!tenantId || !orderFormId || !artifactKind) return json({ error: 'Business, Order Form and document type are required' }, 400);
      const overview = await adminOverview(userId, tenantId);
      const forms = Array.isArray(overview.orderForms) ? overview.orderForms : [];
      if (!forms.some((item) => cleanUuid(record(item).id) === orderFormId)) return json({ error: 'Order Form not found' }, 404);
      const document = await ensureAgreementArtifact({ tenantId, orderFormId, artifactKind, actorUserId: userId, preferCurrentMaster: false });
      return json({ ok: true, document });
    }

    if (action === 'admin_issue_order_form') {
      const tenantId = cleanUuid(body.tenantId);
      const commercialOrderId = cleanUuid(body.commercialOrderId);
      const installmentObligationId = optionalUuid(body.installmentObligationId);
      const templateVersionId = cleanUuid(body.templateVersionId);
      const orderFormReference = cleanText(body.orderFormReference, 128);
      const supersedesOrderFormId = optionalUuid(body.supersedesOrderFormId);
      const reason = cleanReason(body.reason);
      if (!tenantId || !commercialOrderId || !templateVersionId || !orderFormReference || !reason) {
        return json({ error: 'Business, commercial order, Order Form template, reference and reason are required' }, 400);
      }
      if (body.installmentObligationId && !installmentObligationId) return json({ error: 'A valid installment obligation is required' }, 400);
      if (body.supersedesOrderFormId && !supersedesOrderFormId) return json({ error: 'A valid superseded Order Form is required' }, 400);

      const orderFormId = await rpc<string>('issue_sellertray_commercial_order_form_admin', {
        p_tenant_id: tenantId,
        p_commercial_order_id: commercialOrderId,
        p_installment_obligation_id: installmentObligationId,
        p_template_version_id: templateVersionId,
        p_order_form_reference: orderFormReference,
        p_supersedes_order_form_id: supersedesOrderFormId,
        p_reason: reason,
        p_actor_user_id: userId,
      });
      const overview = await adminOverview(userId, tenantId);
      return json({ ok: true, orderFormId, overview }, 201);
    }

    if (action === 'admin_publish_order_form_template') {
      const family = cleanText(body.family, 64);
      const versionCode = cleanText(body.versionCode, 64);
      const title = cleanText(body.title, 200);
      const contentBody = cleanRawText(body.contentBody, 200_000);
      const effectiveFrom = cleanIsoTimestamp(body.effectiveFrom);
      const reason = cleanReason(body.reason);
      if (!family || !versionCode || !title || !contentBody || !effectiveFrom || !reason) {
        return json({ error: 'Order Form family, version, title, content, effective time and publication reason are required' }, 400);
      }
      const templateVersionId = await rpc<string>('publish_sellertray_order_form_template_admin', {
        p_agreement_family: family,
        p_version_code: versionCode,
        p_title: title,
        p_content_body: contentBody,
        p_effective_from: effectiveFrom,
        p_reason: reason,
        p_actor_user_id: userId,
      });
      const overview = await adminOverview(userId, optionalUuid(body.tenantId));
      return json({ ok: true, templateVersionId, overview }, 201);
    }

    if (action === 'admin_publish_pdf') {
      const versionCode = cleanText(body.versionCode, 64);
      const title = cleanText(body.title, 200);
      const effectiveFrom = cleanIsoTimestamp(body.effectiveFrom);
      const reason = cleanReason(body.reason);
      const sourceFileName = cleanFileName(body.sourceFileName);
      const commandId = cleanUuid(body.commandId);
      const pdfBase64 = typeof body.sourcePdfBase64 === 'string' ? body.sourcePdfBase64 : '';
      if (!versionCode || !title || !effectiveFrom || !reason || !sourceFileName || !commandId || !pdfBase64) {
        return json({ error: 'Version, title, effective time, reason and reviewed PDF are required' }, 400);
      }
      const pdfBytes = decodeBase64Pdf(pdfBase64);
      if (!pdfBytes || pdfBytes.byteLength > MAX_PDF_BYTES) return json({ error: 'Reviewed Master Agreement PDF must be 8 MB or smaller' }, 413);

      const inspected = await inspectUploadedMasterPdf(pdfBytes);
      const storagePath = `master-sources/${commandId}/source.pdf`;
      const createdStorageObject = await uploadSourcePdf(storagePath, pdfBytes, inspected.pdfSha256);
      try {
        const agreementVersionId = await rpc<string>('publish_sellertray_master_agreement_pdf_admin', {
          p_version_code: versionCode,
          p_title: title,
          p_content_body: inspected.text,
          p_effective_from: effectiveFrom,
          p_reason: reason,
          p_source_filename: sourceFileName,
          p_source_pdf_sha256: inspected.pdfSha256,
          p_source_byte_size: pdfBytes.byteLength,
          p_source_page_count: inspected.pageCount,
          p_source_storage_path: storagePath,
          p_command_id: commandId,
          p_actor_user_id: userId,
        });
        const overview = await adminOverview(userId, optionalUuid(body.tenantId));
        return json({ ok: true, agreementVersionId, sourcePdfSha256: inspected.pdfSha256, overview }, 201);
      } catch (error) {
        if (createdStorageObject) await admin.storage.from(AGREEMENT_BUCKET).remove([storagePath]).catch(() => undefined);
        throw error;
      }
    }

    const versionCode = cleanText(body.versionCode, 64);
    const title = cleanText(body.title, 200);
    const contentBody = cleanRawText(body.contentBody, 200_000);
    const effectiveFrom = cleanIsoTimestamp(body.effectiveFrom);
    const reason = cleanReason(body.reason);
    if (!versionCode || !title || !contentBody || !effectiveFrom || !reason) {
      return json({ error: 'Version, title, agreement content, effective time and publication reason are required' }, 400);
    }

    const agreementVersionId = await rpc<string>('publish_sellertray_master_agreement_admin', {
      p_version_code: versionCode,
      p_title: title,
      p_content_body: contentBody,
      p_effective_from: effectiveFrom,
      p_reason: reason,
      p_actor_user_id: userId,
    });
    const overview = await adminOverview(userId, optionalUuid(body.tenantId));
    return json({ ok: true, agreementVersionId, overview }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Master Agreement request failed';
    return json({ error: message }, statusForError(message));
  }
});

async function merchantCenter(tenantId: string, userId: string): Promise<JsonRecord> {
  return rpc<JsonRecord>('get_sellertray_agreement_package_center', { p_tenant_id: tenantId, p_actor_user_id: userId });
}
async function adminOverview(userId: string, tenantId: string | null): Promise<JsonRecord> {
  return rpc<JsonRecord>('get_sellertray_order_forms_admin', { p_actor_user_id: userId, p_tenant_id: tenantId });
}

async function ensureAgreementArtifact(input: {
  tenantId: string;
  orderFormId: string;
  artifactKind: ArtifactKind;
  actorUserId: string;
  preferCurrentMaster: boolean;
}): Promise<JsonRecord> {
  if (!admin) throw new Error('Server configuration error');

  const currentMasterId = await rpc<string | null>('resolve_sellertray_master_agreement_version_id', { p_as_of: new Date().toISOString() });
  if (!currentMasterId) throw new Error('SellerTray Master Agreement is not yet published');

  const { data: form, error: formError } = await admin.from('sellertray_commercial_order_forms')
    .select('id,tenant_id,commercial_order_id,order_form_template_version_id,template_version_code,order_form_reference,rendered_content,commercial_snapshot,commercial_snapshot_sha256,content_sha256,issued_at')
    .eq('tenant_id', input.tenantId).eq('id', input.orderFormId).single();
  if (formError || !form) throw new Error(formError?.message ?? 'Order Form not found');

  const { data: confirmation } = await admin.from('sellertray_order_form_confirmations')
    .select('id,agreement_package_id,confirmed_legal_name,confirmed_role,confirmed_at,confirmed_by_user_id,package_fingerprint')
    .eq('tenant_id', input.tenantId).eq('order_form_id', input.orderFormId).maybeSingle();

  const { data: currentAcceptance } = await admin.from('sellertray_master_agreement_acceptances')
    .select('id,agreement_version_id,accepted_legal_name,accepted_role,accepted_at,accepted_by_user_id,request_evidence')
    .eq('tenant_id', input.tenantId).eq('agreement_version_id', currentMasterId).maybeSingle();

  let packageId: string | null = null;
  if (!input.preferCurrentMaster && currentAcceptance) {
    const evidence = record(currentAcceptance.request_evidence);
    packageId = cleanUuid(evidence.agreement_package_id);
    if (packageId) {
      const { data: evidencePackage } = await admin.from('sellertray_agreement_packages')
        .select('id,order_form_id,master_agreement_version_id')
        .eq('tenant_id', input.tenantId).eq('id', packageId).maybeSingle();
      if (!evidencePackage || evidencePackage.order_form_id !== input.orderFormId) packageId = null;
    }
  }
  if (!packageId && !input.preferCurrentMaster && confirmation?.agreement_package_id) packageId = confirmation.agreement_package_id;
  if (!packageId) packageId = await rpc<string>('create_sellertray_agreement_package', {
    p_tenant_id: input.tenantId,
    p_order_form_id: input.orderFormId,
    p_master_agreement_version_id: currentMasterId,
  });

  const { data: packageRow, error: packageError } = await admin.from('sellertray_agreement_packages')
    .select('id,tenant_id,master_agreement_version_id,package_fingerprint,manifest,created_at')
    .eq('tenant_id', input.tenantId).eq('id', packageId).single();
  if (packageError || !packageRow) throw new Error(packageError?.message ?? 'Agreement Package not found');

  const { data: master, error: masterError } = await admin.from('sellertray_master_agreement_versions')
    .select('id,version_code,title,content_body,content_sha256,effective_from')
    .eq('id', packageRow.master_agreement_version_id).single();
  if (masterError || !master) throw new Error(masterError?.message ?? 'Master Agreement version not found');

  const { data: template } = await admin.from('sellertray_commercial_agreement_template_versions')
    .select('title').eq('id', form.order_form_template_version_id).maybeSingle();
  const { data: source } = await admin.from('sellertray_master_agreement_source_documents')
    .select('storage_bucket,storage_path,original_filename,pdf_sha256,byte_size,page_count')
    .eq('agreement_version_id', master.id).maybeSingle();
  const { data: packageAcceptance } = await admin.from('sellertray_master_agreement_acceptances')
    .select('accepted_legal_name,accepted_role,accepted_at,accepted_by_user_id')
    .eq('tenant_id', input.tenantId).eq('agreement_version_id', master.id).maybeSingle();

  if (input.artifactKind === 'executed_pdf' && (!packageAcceptance || !confirmation)) {
    throw new Error('Executed Agreement Package PDF is available after Master Agreement acceptance and Order Form confirmation');
  }

  const { data: existing } = await admin.from('sellertray_agreement_package_artifacts')
    .select('id,storage_bucket,storage_path,pdf_sha256,byte_size,package_fingerprint,generated_at')
    .eq('tenant_id', input.tenantId).eq('agreement_package_id', packageRow.id).eq('artifact_kind', input.artifactKind).maybeSingle();

  if (existing) return signedArtifact(existing, input.artifactKind, form.order_form_reference, packageRow.id);

  let sourceDocument: AgreementPdfInput['masterAgreement']['sourceDocument'] = null;
  if (source) {
    const downloaded = await admin.storage.from(source.storage_bucket).download(source.storage_path);
    if (downloaded.error || !downloaded.data) throw new Error(downloaded.error?.message ?? 'Unable to load reviewed Master Agreement PDF');
    const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
    const actualHash = await sha256Hex(bytes);
    if (actualHash !== source.pdf_sha256) throw new Error('Reviewed Master Agreement PDF integrity check failed');
    sourceDocument = {
      filename: source.original_filename,
      pdfSha256: source.pdf_sha256,
      byteSize: Number(source.byte_size),
      pageCount: Number(source.page_count),
      bytes,
    };
  }

  const generatedAt = input.artifactKind === 'executed_pdf'
    ? latestIso(packageAcceptance?.accepted_at, confirmation?.confirmed_at)
    : packageRow.created_at;
  const pdfBytes = await buildAgreementPackagePdf({
    artifactKind: input.artifactKind,
    tenantId: input.tenantId,
    packageId: packageRow.id,
    packageFingerprint: packageRow.package_fingerprint,
    generatedAt,
    masterAgreement: {
      id: master.id,
      versionCode: master.version_code,
      title: master.title,
      contentBody: master.content_body,
      contentSha256: master.content_sha256,
      effectiveFrom: master.effective_from,
      sourceDocument,
    },
    orderForm: {
      id: form.id,
      reference: form.order_form_reference,
      title: template?.title ?? 'SellerTray Order Form',
      templateVersion: form.template_version_code,
      renderedContent: form.rendered_content,
      contentSha256: form.content_sha256,
      commercialSnapshotSha256: form.commercial_snapshot_sha256,
      commercialSnapshot: record(form.commercial_snapshot),
      issuedAt: form.issued_at,
    },
    masterAcceptance: packageAcceptance ? {
      acceptedLegalName: packageAcceptance.accepted_legal_name,
      acceptedRole: packageAcceptance.accepted_role,
      acceptedAt: packageAcceptance.accepted_at,
      acceptedByUserId: packageAcceptance.accepted_by_user_id,
    } : null,
    orderFormConfirmation: confirmation ? {
      confirmedLegalName: confirmation.confirmed_legal_name,
      confirmedRole: confirmation.confirmed_role,
      confirmedAt: confirmation.confirmed_at,
      confirmedByUserId: confirmation.confirmed_by_user_id,
    } : null,
  });

  const pdfSha256 = await sha256Hex(pdfBytes);
  const storagePath = `${input.tenantId}/${packageRow.id}/${input.artifactKind}.pdf`;
  const upload = await admin.storage.from(AGREEMENT_BUCKET).upload(storagePath, pdfBytes, {
    contentType: 'application/pdf',
    cacheControl: '0',
    upsert: false,
  });
  if (upload.error && !/already exists|duplicate/i.test(upload.error.message)) throw new Error(upload.error.message);
  if (upload.error) {
    const downloaded = await admin.storage.from(AGREEMENT_BUCKET).download(storagePath);
    if (downloaded.error || !downloaded.data) throw new Error('Unable to verify existing Agreement Package PDF');
    const existingHash = await sha256Hex(new Uint8Array(await downloaded.data.arrayBuffer()));
    if (existingHash !== pdfSha256) throw new Error('Existing Agreement Package PDF does not match the governed package');
  }

  const inserted = await admin.from('sellertray_agreement_package_artifacts').insert({
    tenant_id: input.tenantId,
    agreement_package_id: packageRow.id,
    order_form_id: input.orderFormId,
    artifact_kind: input.artifactKind,
    storage_bucket: AGREEMENT_BUCKET,
    storage_path: storagePath,
    pdf_sha256: pdfSha256,
    byte_size: pdfBytes.byteLength,
    package_fingerprint: packageRow.package_fingerprint,
    generated_by_user_id: input.actorUserId,
    generated_at: generatedAt,
  }).select('id,storage_bucket,storage_path,pdf_sha256,byte_size,package_fingerprint,generated_at').maybeSingle();

  if (inserted.error && !/duplicate|unique/i.test(inserted.error.message)) throw new Error(inserted.error.message);
  if (inserted.data) return signedArtifact(inserted.data, input.artifactKind, form.order_form_reference, packageRow.id);

  const { data: raced, error: racedError } = await admin.from('sellertray_agreement_package_artifacts')
    .select('id,storage_bucket,storage_path,pdf_sha256,byte_size,package_fingerprint,generated_at')
    .eq('tenant_id', input.tenantId).eq('agreement_package_id', packageRow.id).eq('artifact_kind', input.artifactKind).single();
  if (racedError || !raced) throw new Error(racedError?.message ?? 'Unable to record Agreement Package PDF');
  return signedArtifact(raced, input.artifactKind, form.order_form_reference, packageRow.id);
}

async function signedArtifact(row: JsonRecord, artifactKind: ArtifactKind, orderReference: string, packageId: string): Promise<JsonRecord> {
  if (!admin) throw new Error('Server configuration error');
  const bucket = cleanText(row.storage_bucket, 100) ?? AGREEMENT_BUCKET;
  const path = cleanText(row.storage_path, 500);
  if (!path) throw new Error('Agreement Package PDF storage evidence is incomplete');
  const { data, error } = await admin.storage.from(bucket).createSignedUrl(path, 600);
  if (error || !data?.signedUrl) throw new Error(error?.message ?? 'Unable to create secure Agreement Package PDF link');
  const suffix = artifactKind === 'executed_pdf' ? 'Executed' : 'Review';
  return {
    artifactId: row.id,
    artifactKind,
    packageId,
    packageFingerprint: row.package_fingerprint,
    pdfSha256: row.pdf_sha256,
    byteSize: Number(row.byte_size ?? 0),
    generatedAt: row.generated_at,
    fileName: `SellerTray-${safeFilePart(orderReference)}-${suffix}.pdf`,
    signedUrl: data.signedUrl,
    expiresInSeconds: 600,
  };
}

async function uploadSourcePdf(path: string, bytes: Uint8Array, expectedHash: string): Promise<boolean> {
  if (!admin) throw new Error('Server configuration error');
  const upload = await admin.storage.from(AGREEMENT_BUCKET).upload(path, bytes, {
    contentType: 'application/pdf', cacheControl: '0', upsert: false,
  });
  if (!upload.error) return true;
  if (!/already exists|duplicate/i.test(upload.error.message)) throw new Error(upload.error.message);
  const downloaded = await admin.storage.from(AGREEMENT_BUCKET).download(path);
  if (downloaded.error || !downloaded.data) throw new Error('Unable to verify existing reviewed Master Agreement PDF');
  const actualHash = await sha256Hex(new Uint8Array(await downloaded.data.arrayBuffer()));
  if (actualHash !== expectedHash) throw new Error('Publication command already points to a different reviewed PDF');
  return false;
}

async function reconcileTenantInstallmentsBestEffort(tenantId: string, source: string): Promise<void> {
  try {
    const results = await rpc<JsonRecord[]>('reconcile_sellertray_installment_entitlements_for_tenant', { p_tenant_id: tenantId });
    const failures = Array.isArray(results) ? results.filter((row) => row?.ok !== true) : [];
    if (failures.length) console.error(`SellerTray entitlement reconciliation after ${source} requires review`, { tenantId, failures });
  } catch (error) {
    console.error(`SellerTray entitlement reconciliation after ${source} requires review`, {
      tenantId,
      error: error instanceof Error ? error.message.slice(0, 300) : 'Unknown reconciliation error',
    });
  }
}

async function rpc<T>(name: string, args: JsonRecord): Promise<T> {
  if (!admin) throw new Error('Server configuration error');
  const { data, error } = await admin.rpc(name, args);
  if (error) throw new Error(error.message ?? 'Master Agreement RPC failed');
  return data as T;
}

function cleanAction(value: unknown): Action | null {
  return value === 'merchant_get'
    || value === 'merchant_get_document'
    || value === 'merchant_confirm_package'
    || value === 'merchant_accept'
    || value === 'admin_get'
    || value === 'admin_get_document'
    || value === 'admin_publish'
    || value === 'admin_publish_pdf'
    || value === 'admin_publish_order_form_template'
    || value === 'admin_issue_order_form'
    ? value
    : null;
}
function cleanArtifactKind(value: unknown): ArtifactKind | null { return value === 'review_pdf' || value === 'executed_pdf' ? value : null; }
function cleanUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean) ? clean : null;
}
function optionalUuid(value: unknown): string | null { return value === null || value === undefined || value === '' ? null : cleanUuid(value); }
function cleanHash(value: unknown): string | null { return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value.trim()) ? value.trim() : null; }
function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim().replace(/\s+/g, ' ');
  return clean && clean.length <= max ? clean : null;
}
function cleanRawText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return clean && clean.length <= max ? clean : null;
}
function cleanReason(value: unknown): string | null {
  const clean = cleanText(value, 1000);
  return clean && clean.length >= 6 ? clean : null;
}
function cleanFileName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return clean && clean.length <= 255 && !/[\\/\u0000-\u001f]/.test(clean) && /\.pdf$/i.test(clean) ? clean : null;
}
function cleanIsoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  const parsed = Date.parse(clean);
  return clean && Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
function decodeBase64Pdf(value: string): Uint8Array | null {
  try {
    const normalized = value.replace(/^data:application\/pdf;base64,/i, '').replace(/\s+/g, '');
    if (!normalized || normalized.length > Math.ceil(MAX_PDF_BYTES * 4 / 3) + 16) return null;
    const binary = atob(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch { return null; }
}
function jwtAal(token: string): string | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=');
    const parsed = JSON.parse(atob(normalized)) as JsonRecord;
    return typeof parsed.aal === 'string' ? parsed.aal : null;
  } catch { return null; }
}
function statusForError(message: string): number {
  if (/access|required|authori[sz]ed|owner|manager|capability|mfa/i.test(message)) return 403;
  if (/not found/i.test(message)) return 404;
  if (/already|different|conflict|current|replaced|superseded|changed after review/i.test(message)) return 409;
  if (/too large|8 mb/i.test(message)) return 413;
  return 400;
}
function record(value: unknown): JsonRecord { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonRecord : {}; }
function latestIso(...values: (string | null | undefined)[]): string {
  const dates = values.filter((value): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value))).map((value) => new Date(value));
  return dates.length ? new Date(Math.max(...dates.map((date) => date.getTime()))).toISOString() : new Date().toISOString();
}
function safeFilePart(value: string): string { return (value || 'Agreement').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'Agreement'; }
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
