import { useEffect, useState } from 'react';
import { errorMessage, numberValue, supabase } from './supabase';
import './AiBriefManagement.css';

type SourceKey = 'summary' | 'branchPerformance' | 'salesTrend' | 'channels' | 'paymentMethods' | 'topCustomers';

type BriefItem = {
  title: string;
  detail: string;
  priority: 'high' | 'medium' | 'low';
  sourceKeys: SourceKey[];
};

type Brief = {
  headline: string;
  summary: string;
  attention: BriefItem[];
  opportunities: BriefItem[];
  answer: string;
};

type BriefResult = {
  requestId: string;
  mode: 'ai' | 'deterministic';
  periodDays: 7 | 30 | 90;
  generatedAt: string;
  brief: Brief;
  sources: Array<{ key: SourceKey; label: string }>;
  budget: { dailyLimit: number; providerCallsToday: number; remainingProviderCalls: number };
  provider: { name: string; model: string | null } | null;
  fallbackReason: string | null;
};

type Usage = {
  generatedToday: number;
  providerCallsToday: number;
  lastGeneratedAt: string | null;
};

export default function AiBriefManagement({ tenantId }: { tenantId: string }) {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<BriefResult | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void loadUsage(tenantId).then((next) => {
      if (active) setUsage(next);
    }).catch(() => {
      if (active) setUsage(null);
    });
    return () => { active = false; };
  }, [tenantId]);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const requestId = crypto.randomUUID();
      const { data, error: invokeError } = await supabase.functions.invoke('ai-brief', {
        body: {
          tenantId,
          days,
          question: question.trim() || null,
          requestId,
        },
      });
      if (invokeError) throw invokeError;
      setResult(parseResult(data));
      setUsage(await loadUsage(tenantId).catch(() => null));
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to generate the AI Brief.'));
    } finally {
      setLoading(false);
    }
  }

  return <div className="page-stack ai-brief-page">
    <div className="section-heading">
      <div>
        <p className="eyebrow">Decision support</p>
        <h2>AI Brief</h2>
        <p className="muted">SellerTray summarizes verified Report Center metrics. It cannot create, edit or approve business records.</p>
      </div>
      <button className="primary-button" disabled={loading} onClick={() => void generate()}>{loading ? 'Generating brief' : 'Generate AI Brief'}</button>
    </div>

    {error ? <div className="error-banner">{error}<button onClick={() => setError(null)}>Dismiss</button></div> : null}

    <article className="panel ai-brief-controls">
      <div>
        <span className="field-label">Report period</span>
        <div className="ai-period-options">
          {([7, 30, 90] as const).map((value) => <button key={value} className={days === value ? 'secondary-button selected' : 'secondary-button'} onClick={() => setDays(value)}>{value} days</button>)}
        </div>
      </div>
      <label>
        <span>Optional question</span>
        <textarea
          maxLength={500}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Example: Which part of the business needs management attention?"
        />
        <small>Ask only about SellerTray business metrics. Do not paste customer personal data, passwords or secret keys.</small>
      </label>
      <div className="ai-brief-usage">
        <span>Briefs today <strong>{usage?.generatedToday ?? '—'}</strong></span>
        <span>AI provider calls <strong>{usage?.providerCallsToday ?? '—'}</strong></span>
        {usage?.lastGeneratedAt ? <span>Last generated <strong>{formatDateTime(usage.lastGeneratedAt)}</strong></span> : null}
      </div>
    </article>

    {!result ? <article className="panel"><div className="empty-state"><strong>No AI Brief generated yet</strong><p>Choose a period and generate a brief. SellerTray sends only bounded management metrics, with top-customer identities removed from the AI context.</p></div></article> : <>
      {result.mode === 'deterministic' ? <div className="ai-fallback-banner"><strong>Verified metrics fallback</strong><span>{result.fallbackReason || 'AI generation was unavailable, so SellerTray used deterministic report metrics.'}</span></div> : null}

      <article className="panel ai-brief-hero">
        <div className="ai-brief-meta"><span className={result.mode === 'ai' ? 'status-pill good' : 'status-pill'}>{result.mode === 'ai' ? 'AI generated' : 'Verified metrics'}</span><span>{result.periodDays} days</span><span>{formatDateTime(result.generatedAt)}</span></div>
        <h3>{result.brief.headline}</h3>
        <p>{result.brief.summary}</p>
        {result.brief.answer ? <div className="ai-answer"><strong>Answer</strong><p>{result.brief.answer}</p></div> : null}
      </article>

      <div className="ai-brief-grid">
        <BriefSection title="Needs attention" items={result.brief.attention} sources={result.sources} empty="No attention item was supported by the selected report data." />
        <BriefSection title="Opportunities" items={result.brief.opportunities} sources={result.sources} empty="No opportunity was supported strongly enough by the selected report data." />
      </div>

      <article className="panel ai-source-panel">
        <div className="panel-head"><div><h3>Evidence used</h3><p className="muted">Every AI point above must cite one or more of these SellerTray report sections.</p></div></div>
        <div className="ai-source-list">{result.sources.map((source) => <span key={source.key}>{source.label}</span>)}</div>
        <div className="ai-budget-line">
          <span>Daily AI budget</span>
          <strong>{result.budget.remainingProviderCalls} of {result.budget.dailyLimit} provider calls remaining</strong>
          {result.provider?.model ? <small>Model: {result.provider.model}</small> : null}
        </div>
      </article>
    </>}
  </div>;
}

function BriefSection({ title, items, sources, empty }: { title: string; items: BriefItem[]; sources: Array<{ key: SourceKey; label: string }>; empty: string }) {
  const labels = new Map(sources.map((source) => [source.key, source.label]));
  return <article className="panel ai-brief-section">
    <div className="panel-head"><h3>{title}</h3></div>
    {items.length ? <div className="ai-brief-items">{items.map((item, index) => <div className="ai-brief-item" key={`${item.title}-${index}`}>
      <div className="ai-item-title"><span className={`ai-priority ${item.priority}`}>{item.priority}</span><strong>{item.title}</strong></div>
      <p>{item.detail}</p>
      <div className="ai-source-chips">{item.sourceKeys.map((key) => <span key={key}>{labels.get(key) ?? key}</span>)}</div>
    </div>)}</div> : <p className="muted">{empty}</p>}
  </article>;
}

async function loadUsage(tenantId: string): Promise<Usage> {
  const { data, error } = await supabase.rpc('get_sellertray_ai_brief_usage', { p_tenant_id: tenantId });
  if (error) throw error;
  const row = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {};
  return {
    generatedToday: numberValue(row.generatedToday),
    providerCallsToday: numberValue(row.providerCallsToday),
    lastGeneratedAt: typeof row.lastGeneratedAt === 'string' ? row.lastGeneratedAt : null,
  };
}

function parseResult(value: unknown): BriefResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('SellerTray returned an invalid AI Brief.');
  const row = value as Record<string, unknown>;
  const briefRow = object(row.brief);
  const mode = row.mode === 'ai' ? 'ai' : row.mode === 'deterministic' ? 'deterministic' : null;
  const periodDays = row.periodDays === 7 || row.periodDays === 90 ? row.periodDays : 30;
  if (!mode || typeof row.requestId !== 'string' || typeof row.generatedAt !== 'string') throw new Error('SellerTray returned an invalid AI Brief.');
  return {
    requestId: row.requestId,
    mode,
    periodDays,
    generatedAt: row.generatedAt,
    brief: {
      headline: stringValue(briefRow.headline),
      summary: stringValue(briefRow.summary),
      attention: parseItems(briefRow.attention),
      opportunities: parseItems(briefRow.opportunities),
      answer: typeof briefRow.answer === 'string' ? briefRow.answer : '',
    },
    sources: Array.isArray(row.sources) ? row.sources.flatMap((value) => {
      const source = object(value);
      const key = sourceKey(source.key);
      return key && typeof source.label === 'string' ? [{ key, label: source.label }] : [];
    }) : [],
    budget: {
      dailyLimit: numberValue(object(row.budget).dailyLimit),
      providerCallsToday: numberValue(object(row.budget).providerCallsToday),
      remainingProviderCalls: numberValue(object(row.budget).remainingProviderCalls),
    },
    provider: row.provider && typeof row.provider === 'object' && !Array.isArray(row.provider) ? {
      name: stringValue(object(row.provider).name),
      model: typeof object(row.provider).model === 'string' ? String(object(row.provider).model) : null,
    } : null,
    fallbackReason: typeof row.fallbackReason === 'string' ? row.fallbackReason : null,
  };
}

function parseItems(value: unknown): BriefItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    const row = object(candidate);
    const priority = row.priority === 'high' || row.priority === 'medium' || row.priority === 'low' ? row.priority : null;
    const sourceKeys = Array.isArray(row.sourceKeys) ? row.sourceKeys.map(sourceKey).filter((key): key is SourceKey => Boolean(key)) : [];
    if (!priority || typeof row.title !== 'string' || typeof row.detail !== 'string' || !sourceKeys.length) return [];
    return [{ title: row.title, detail: row.detail, priority, sourceKeys }];
  });
}

function sourceKey(value: unknown): SourceKey | null {
  return value === 'summary' || value === 'branchPerformance' || value === 'salesTrend' || value === 'channels' || value === 'paymentMethods' || value === 'topCustomers' ? value : null;
}
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function stringValue(value: unknown): string { return typeof value === 'string' ? value : ''; }
function formatDateTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }); }
