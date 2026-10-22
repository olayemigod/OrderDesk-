import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { invokeJson } from './supabase';

type AcceptanceEvidence = {
  id: string;
  acceptedAt: string;
  acceptedLegalName: string;
  acceptedRole: string;
  acceptedByUserId: string;
  agreementContentSha256: string;
  templateContentSha256: string;
};

type AgreementRow = {
  id: string;
  reference: string;
  family: string;
  title: string;
  templateVersionId: string;
  templateVersion: string;
  templateContentSha256: string;
  contentSha256: string;
  renderedContent: string;
  commercialOrderId: string;
  installmentObligationId: string | null;
  supersedesAgreementId: string | null;
  isCurrent: boolean;
  issuedAt: string;
  acceptance: AcceptanceEvidence | null;
};

type TemplateRow = {
  id: string;
  family: string;
  versionCode: string;
  title: string;
  contentBody: string;
  contentSha256: string;
  effectiveFrom: string;
  publishedAt: string;
};

type AgreementLifecycle = {
  canManage: boolean;
  agreements: AgreementRow[];
  templates: TemplateRow[];
};

type AdminResponse = { ok?: boolean; overview?: unknown };

type ReplacementForm = {
  agreementId: string;
  templateVersionId: string;
  reference: string;
  renderedContent: string;
  reason: string;
};

export default function AgreementLifecycleManagement({
  session,
  tenantId,
}: {
  session: Session;
  tenantId: string;
}) {
  const [state, setState] = useState<AgreementLifecycle | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [replacement, setReplacement] = useState<ReplacementForm | null>(null);
  const requestSequence = useRef(0);

  useEffect(() => {
    setReplacement(null);
    setMessage(null);
    void load();
  }, [tenantId, session]);

  async function load() {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError(null);
    try {
      const response = await invokeJson<AdminResponse>('commercial-agreements', {
        action: 'admin_overview',
        tenantId,
      }, session);
      if (sequence !== requestSequence.current) return;
      setState(parseLifecycle(response.overview));
    } catch (cause) {
      if (sequence !== requestSequence.current) return;
      setState(null);
      setError(messageFrom(cause, 'Unable to load agreement lifecycle.'));
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }

  function templatesFor(agreement: AgreementRow) {
    const now = Date.now();
    return (state?.templates ?? []).filter((template) => {
      const effectiveAt = new Date(template.effectiveFrom).getTime();
      return template.family === agreement.family && !Number.isNaN(effectiveAt) && effectiveAt <= now;
    });
  }

  function prepareReplacement(agreement: AgreementRow) {
    if (!state?.canManage || !agreement.isCurrent) return;
    const candidates = templatesFor(agreement);
    const template = candidates[0] ?? null;
    if (!template) {
      setError(`Publish an effective ${familyLabel(agreement.family)} template before replacing this agreement.`);
      return;
    }
    setError(null);
    setMessage(null);
    setReplacement({
      agreementId: agreement.id,
      templateVersionId: template.id,
      reference: '',
      renderedContent: template.contentBody,
      reason: '',
    });
  }

  function chooseTemplate(templateVersionId: string) {
    if (!replacement || !state) return;
    const agreement = state.agreements.find((row) => row.id === replacement.agreementId);
    if (!agreement) return;
    const template = templatesFor(agreement).find((row) => row.id === templateVersionId);
    if (!template) return;
    setReplacement({
      ...replacement,
      templateVersionId,
      renderedContent: template.contentBody,
    });
  }

  async function issueReplacement() {
    if (!replacement || !state?.canManage || saving) return;
    const agreement = state.agreements.find((row) => row.id === replacement.agreementId);
    if (!agreement || !agreement.isCurrent) {
      setError('The selected agreement is no longer current. Reload before continuing.');
      return;
    }
    const template = templatesFor(agreement).find((row) => row.id === replacement.templateVersionId);
    if (!template) {
      setError('Select an effective replacement template from the same agreement family.');
      return;
    }
    if (!replacement.reference.trim() || !replacement.renderedContent.trim()) {
      setError('Enter a new immutable agreement reference and replacement agreement content.');
      return;
    }
    if (replacement.reason.trim().replace(/\s+/g, ' ').length < 6) {
      setError('Enter a replacement reason of at least 6 characters.');
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await invokeJson<AdminResponse>('commercial-agreements', {
        action: 'admin_issue',
        tenantId,
        commercialOrderId: agreement.commercialOrderId,
        installmentObligationId: agreement.installmentObligationId,
        templateVersionId: template.id,
        supersedesAgreementId: agreement.id,
        reference: replacement.reference.trim(),
        renderedContent: replacement.renderedContent,
        reason: replacement.reason.trim().replace(/\s+/g, ' '),
      }, session);
      setReplacement(null);
      await load();
      setMessage('Replacement agreement issued. The merchant must accept the new current agreement before it satisfies the governed acceptance prerequisite.');
    } catch (cause) {
      setError(messageFrom(cause, 'Unable to issue the governed replacement agreement.'));
    } finally {
      setSaving(false);
    }
  }

  const replacementAgreement = replacement && state
    ? state.agreements.find((row) => row.id === replacement.agreementId) ?? null
    : null;

  return (
    <section className="workspace-panel" style={{ marginTop: 16 }}>
      <div className="workspace-panel-heading">
        <div>
          <h3>Agreement lifecycle</h3>
          <p>Review immutable issuance and acceptance history. Corrections use explicit replacement; accepted records are never edited in place.</p>
        </div>
      </div>

      {loading ? <div className="workspace-empty"><strong>Loading agreements</strong><p>Reading governed commercial agreement history…</p></div> : null}
      {error ? <div className="workspace-banner error">{error}</div> : null}
      {message ? <div className="workspace-banner success">{message}</div> : null}
      {!loading && state && !state.canManage ? <div className="workspace-banner info">Platform Support can review agreement history and acceptance evidence. Only Platform Admin may issue a replacement.</div> : null}

      {!loading && state ? (
        <div className="workspace-table-wrap">
          <table className="workspace-table compact-table">
            <thead><tr><th>Agreement</th><th>Subject</th><th>Lifecycle</th><th>Acceptance</th><th>Issued</th><th>Action</th></tr></thead>
            <tbody>
              {state.agreements.map((agreement) => (
                <tr key={agreement.id}>
                  <td><strong>{agreement.title}</strong><small>{agreement.reference} · {agreement.templateVersion}</small></td>
                  <td>{familyLabel(agreement.family)}<small>Order {shortId(agreement.commercialOrderId)}</small></td>
                  <td><span className={`workspace-status ${agreement.isCurrent ? 'success' : 'neutral'}`}>{agreement.isCurrent ? 'Current' : 'Replaced'}</span>{agreement.supersedesAgreementId ? <small>Replaces {shortId(agreement.supersedesAgreementId)}</small> : null}</td>
                  <td>{agreement.acceptance ? <><strong>{agreement.acceptance.acceptedLegalName}</strong><small>{label(agreement.acceptance.acceptedRole)} · {formatDate(agreement.acceptance.acceptedAt)}</small></> : <span className="workspace-status attention">Awaiting acceptance</span>}</td>
                  <td>{formatDate(agreement.issuedAt)}<small>Hash {shortHash(agreement.contentSha256)}</small></td>
                  <td>{agreement.isCurrent && state.canManage ? <button className="workspace-button subtle compact" type="button" disabled={saving} onClick={() => prepareReplacement(agreement)}>Prepare replacement</button> : agreement.isCurrent ? 'Review only' : 'Immutable history'}</td>
                </tr>
              ))}
              {!state.agreements.length ? <tr><td colSpan={6}>No merchant-specific agreements have been issued for this Business.</td></tr> : null}
            </tbody>
          </table>
        </div>
      ) : null}

      {replacement && replacementAgreement && state ? (
        <div className="workspace-form-stack" style={{ marginTop: 16 }}>
          <div className="workspace-banner warning"><strong>Explicit replacement.</strong> {replacementAgreement.reference} remains immutable historical evidence. The new agreement must preserve the same commercial subject and requires fresh merchant acceptance.</div>
          <div className="workspace-detail-grid">
            <Detail label="Agreement family" value={familyLabel(replacementAgreement.family)} />
            <Detail label="Commercial order" value={shortId(replacementAgreement.commercialOrderId)} />
            <Detail label="Previous acceptance" value={replacementAgreement.acceptance ? `${replacementAgreement.acceptance.acceptedLegalName} · ${formatDate(replacementAgreement.acceptance.acceptedAt)}` : 'Not accepted'} />
            <Detail label="Previous content hash" value={shortHash(replacementAgreement.contentSha256)} />
          </div>
          <label>Replacement template
            <select value={replacement.templateVersionId} onChange={(event) => chooseTemplate(event.target.value)}>
              {templatesFor(replacementAgreement).map((template) => <option key={template.id} value={template.id}>{template.title} · {template.versionCode}</option>)}
            </select>
          </label>
          <label>New agreement reference<input maxLength={128} value={replacement.reference} onChange={(event) => setReplacement({ ...replacement, reference: event.target.value })} placeholder="Enter a new immutable reference" /></label>
          <label>Replacement agreement content<textarea rows={10} maxLength={300000} value={replacement.renderedContent} onChange={(event) => setReplacement({ ...replacement, renderedContent: event.target.value })} /></label>
          <label>Replacement reason<input maxLength={1000} value={replacement.reason} onChange={(event) => setReplacement({ ...replacement, reason: event.target.value })} /></label>
          <div className="workspace-filter-row">
            <button className="workspace-button primary" type="button" disabled={saving} onClick={() => void issueReplacement()}>{saving ? 'Issuing replacement…' : 'Issue replacement agreement'}</button>
            <button className="workspace-button subtle" type="button" disabled={saving} onClick={() => setReplacement(null)}>Cancel</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function parseLifecycle(value: unknown): AgreementLifecycle {
  const root = record(value);
  return {
    canManage: root.canManage === true,
    agreements: array(root.agreements).map((value) => {
      const row = record(value);
      const acceptance = recordOrNull(row.acceptance);
      return {
        id: stringValue(row.id),
        reference: stringValue(row.reference),
        family: stringValue(row.family),
        title: stringValue(row.title, 'Commercial agreement'),
        templateVersionId: stringValue(row.templateVersionId),
        templateVersion: stringValue(row.templateVersion),
        templateContentSha256: stringValue(row.templateContentSha256),
        contentSha256: stringValue(row.contentSha256),
        renderedContent: stringValue(row.renderedContent),
        commercialOrderId: stringValue(row.commercialOrderId),
        installmentObligationId: nullableString(row.installmentObligationId),
        supersedesAgreementId: nullableString(row.supersedesAgreementId),
        isCurrent: row.isCurrent === true,
        issuedAt: stringValue(row.issuedAt),
        acceptance: acceptance ? {
          id: stringValue(acceptance.id),
          acceptedAt: stringValue(acceptance.acceptedAt),
          acceptedLegalName: stringValue(acceptance.acceptedLegalName),
          acceptedRole: stringValue(acceptance.acceptedRole),
          acceptedByUserId: stringValue(acceptance.acceptedByUserId),
          agreementContentSha256: stringValue(acceptance.agreementContentSha256),
          templateContentSha256: stringValue(acceptance.templateContentSha256),
        } : null,
      } as AgreementRow;
    }).filter((row) => row.id && row.commercialOrderId),
    templates: array(root.templates).map((value) => {
      const row = record(value);
      return {
        id: stringValue(row.id),
        family: stringValue(row.family),
        versionCode: stringValue(row.versionCode),
        title: stringValue(row.title),
        contentBody: stringValue(row.contentBody),
        contentSha256: stringValue(row.contentSha256),
        effectiveFrom: stringValue(row.effectiveFrom),
        publishedAt: stringValue(row.publishedAt),
      } as TemplateRow;
    }).filter((row) => row.id && row.family),
  };
}

function Detail({ label: text, value }: { label: string; value: string }) { return <div><span>{text}</span><strong>{value}</strong></div>; }
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function recordOrNull(value: unknown): Record<string, unknown> | null { const result = record(value); return Object.keys(result).length ? result : null; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function stringValue(value: unknown, fallback = ''): string { return typeof value === 'string' ? value : fallback; }
function nullableString(value: unknown): string | null { return typeof value === 'string' && value ? value : null; }
function familyLabel(value: string) { return label(value.replace(/_agreement$/, ' agreement').replace(/_/g, ' ')); }
function label(value: string) { return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
function shortId(value: string) { return value.length > 12 ? `${value.slice(0, 8)}…` : value; }
function shortHash(value: string) { return value.length > 16 ? `${value.slice(0, 12)}…` : value || 'Not available'; }
function messageFrom(cause: unknown, fallback: string) { return cause instanceof Error && cause.message ? cause.message : fallback; }
