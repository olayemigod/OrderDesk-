import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { invokeJson, isRecord } from './supabase';

type AdminRole = 'admin' | 'support';
type OperationsSummary = {
  merchantCount: number;
  whatsappConnected: number;
  whatsappErrors: number;
  whatsappPending: number;
  whatsappNotConnected: number;
};
type AiReadiness = {
  configured: boolean;
  configuredModel: string;
  attempts: number;
  successes: number;
  nonSuccess: number;
  totalTokens: number;
  meteredExternalOrderUnits: number;
  productionAcceptanceReady: boolean;
  generatedAt: string;
};
type AiProbe = {
  ok: boolean;
  status: string;
  durationMs: number | null;
  httpStatus: number | null;
  configuredModel: string | null;
  structuredOutputValid: boolean | null;
};

export function WhatsAppOperations({ session }: { session: Session }) {
  const [summary, setSummary] = useState<OperationsSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void load(); }, [session.access_token]);

  async function load() {
    setLoading(true); setError(null);
    try {
      const result = await invokeJson<{ summary?: unknown }>('platform-admin', { action: 'operations_summary' }, session);
      setSummary(normalizeOperationsSummary(result.summary));
    } catch (cause) { setError(messageFrom(cause, 'Unable to load WhatsApp platform operations.')); }
    finally { setLoading(false); }
  }

  return <section className="workspace-panel">
    <PanelHeading title="WhatsApp estate" description="Cross-merchant connection-state supervision. Merchant-specific WhatsApp configuration remains in Merchant Web." action={<button className="workspace-button subtle compact" onClick={() => void load()} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>} />
    {error ? <div className="workspace-banner error">{error}</div> : null}
    <div className="workspace-stat-grid mini">
      <StatCard label="Connected" value={summary?.whatsappConnected ?? 0} detail="Merchant connections" />
      <StatCard label="Errors" value={summary?.whatsappErrors ?? 0} detail="Need ProcessEdge attention" />
      <StatCard label="Pending" value={summary?.whatsappPending ?? 0} detail="Connections in progress" />
      <StatCard label="Not connected" value={summary?.whatsappNotConnected ?? 0} detail="Merchant configuration" />
    </div>
  </section>;
}

export function AiOperations({ session, actorRole }: { session: Session; actorRole: AdminRole }) {
  const [readiness, setReadiness] = useState<AiReadiness | null>(null);
  const [probe, setProbe] = useState<AiProbe | null>(null);
  const [loading, setLoading] = useState(false);
  const [probing, setProbing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void load(); }, [session.access_token]);

  async function load() {
    setLoading(true); setError(null);
    try {
      const result = await invokeJson<{ readiness?: unknown }>('platform-admin', { action: 'operations_summary' }, session);
      setReadiness(normalizeAiReadiness(result.readiness));
    } catch (cause) { setError(messageFrom(cause, 'Unable to load AI parser readiness.')); }
    finally { setLoading(false); }
  }

  async function runProbe() {
    setProbing(true); setError(null);
    try {
      const result = await invokeJson<{ probe?: unknown }>('platform-admin', { action: 'ai_parser_probe' }, session);
      setProbe(normalizeAiProbe(result.probe));
    } catch (cause) { setError(messageFrom(cause, 'Unable to run the AI parser probe.')); }
    finally { setProbing(false); }
  }

  return <section className="workspace-panel">
    <PanelHeading title="AI parser health" description="Server-side readiness and controlled diagnostics. AI remains an assisting channel, not a separate business-truth engine." action={<button className="workspace-button subtle compact" onClick={() => void load()} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>} />
    {error ? <div className="workspace-banner error">{error}</div> : null}
    {readiness ? <div className="workspace-detail-grid">
      <Detail label="Configured" value={readiness.configured ? 'Yes' : 'No'} />
      <Detail label="Model" value={readiness.configuredModel || '—'} />
      <Detail label="Attempts" value={readiness.attempts.toLocaleString()} />
      <Detail label="Successful parses" value={readiness.successes.toLocaleString()} />
      <Detail label="Metered orders" value={readiness.meteredExternalOrderUnits.toLocaleString()} />
      <Detail label="Acceptance ready" value={readiness.productionAcceptanceReady ? 'Yes' : 'No'} />
    </div> : <EmptyState title="AI readiness unavailable" body="Refresh to retrieve current parser readiness." />}
    {actorRole === 'admin' ? <div className="workspace-operation-action"><button className="workspace-button primary" onClick={() => void runProbe()} disabled={probing}>{probing ? 'Running probe…' : 'Run controlled parser probe'}</button>{probe ? <span className={probe.ok ? 'workspace-inline-status success' : 'workspace-inline-status warning'}>{friendlyLabel(probe.status)}{probe.durationMs !== null ? ` · ${probe.durationMs}ms` : ''}</span> : null}</div> : <div className="workspace-banner warning">Platform Support can view readiness. Controlled probes remain restricted.</div>}
  </section>;
}

function PanelHeading({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) { return <div className="workspace-panel-heading"><div><h2>{title}</h2><p>{description}</p></div>{action}</div>; }
function StatCard({ label, value, detail }: { label: string; value: string | number; detail: string }) { return <article className="workspace-stat-card"><span>{label}</span><strong>{typeof value === 'number' ? value.toLocaleString() : value}</strong><small>{detail}</small></article>; }
function Detail({ label, value }: { label: string; value: string }) { return <div className="workspace-detail"><span>{label}</span><strong>{value}</strong></div>; }
function EmptyState({ title, body }: { title: string; body: string }) { return <div className="workspace-empty"><strong>{title}</strong><p>{body}</p></div>; }
function normalizeOperationsSummary(value: unknown): OperationsSummary { if (!isRecord(value)) throw new Error('Platform operations returned an invalid summary.'); const whatsapp = isRecord(value.whatsapp) ? value.whatsapp : {}; return { merchantCount: numberValue(value.merchantCount), whatsappConnected: numberValue(whatsapp.connected), whatsappErrors: numberValue(whatsapp.errors), whatsappPending: numberValue(whatsapp.pending), whatsappNotConnected: numberValue(whatsapp.notConnected) }; }
function normalizeAiReadiness(value: unknown): AiReadiness { if (!isRecord(value)) throw new Error('AI readiness returned an invalid response.'); const configuration = isRecord(value.configuration) ? value.configuration : {}; const period = isRecord(value.currentPeriod) ? value.currentPeriod : {}; const acceptance = isRecord(value.acceptanceEvidence) ? value.acceptanceEvidence : {}; return { configured: Boolean(value.configured), configuredModel: stringValue(configuration.configuredModel), attempts: numberValue(period.attempts), successes: numberValue(period.successes), nonSuccess: numberValue(period.nonSuccess), totalTokens: numberValue(period.totalTokens), meteredExternalOrderUnits: numberValue(period.meteredExternalOrderUnits), productionAcceptanceReady: Boolean(acceptance.productionAcceptanceReady), generatedAt: stringValue(value.generatedAt) }; }
function normalizeAiProbe(value: unknown): AiProbe { if (!isRecord(value)) throw new Error('AI parser probe returned an invalid response.'); return { ok: Boolean(value.ok), status: stringValue(value.status) || 'unknown', durationMs: nullableNumber(value.durationMs), httpStatus: nullableNumber(value.httpStatus), configuredModel: optionalString(value.configuredModel), structuredOutputValid: typeof value.structuredOutputValid === 'boolean' ? value.structuredOutputValid : null }; }
function friendlyLabel(value: string): string { if (!value) return 'Unknown'; return value.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase()); }
function messageFrom(value: unknown, fallback: string): string { return value instanceof Error && value.message ? value.message : fallback; }
function stringValue(value: unknown): string { return typeof value === 'string' ? value : ''; }
function optionalString(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value : null; }
function numberValue(value: unknown): number { const parsed = typeof value === 'number' ? value : Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function nullableNumber(value: unknown): number | null { const parsed = typeof value === 'number' ? value : Number(value); return Number.isFinite(parsed) ? parsed : null; }
