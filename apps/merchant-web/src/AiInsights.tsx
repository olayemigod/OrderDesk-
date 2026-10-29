import { useState, type FormEvent } from 'react';
import { SellerTraySelect, SellerTrayTextarea } from './SellerTrayElements';
import { errorMessage, supabase } from './supabase';
import './ai-insights.css';

type Insight = {
  requestId: string;
  days: number;
  generatedAt: string;
  answer: string;
  highlights: string[];
  dataNotes: string[];
  followUps: string[];
  confidence: 'high' | 'medium' | 'low';
};

const SUGGESTIONS = [
  'Which products are moving fastest?',
  'What needs restocking now?',
  'Which Branch needs my attention?',
  'What do we still owe suppliers?',
];

export default function AiInsights({ tenantId }: { tenantId: string }) {
  const [question, setQuestion] = useState('');
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Insight | null>(null);

  async function ask(event?: FormEvent) {
    event?.preventDefault();
    const clean = question.trim();
    if (!clean) {
      setError('Ask a business question first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('merchant-ai', {
        body: { tenantId, question: clean, days },
      });
      if (invokeError) throw invokeError;
      const next = parseInsight(data);
      if (!next) throw new Error('SellerTray AI returned an unreadable response.');
      setResult(next);
    } catch (cause) {
      setError(await functionError(cause));
    } finally {
      setBusy(false);
    }
  }

  function chooseSuggestion(value: string) {
    setQuestion(value);
    setError(null);
  }

  return <div className="page-stack ai-insights-page">
    <div className="section-heading">
      <div><p className="eyebrow">Business intelligence</p><h2>Ask SellerTray</h2></div>
      <p className="muted">Analyse your SellerTray sales, stock, cash, Branch and purchasing data. This assistant is read-only and cannot change business records.</p>
    </div>

    <article className="panel ai-question-panel">
      <form onSubmit={(event) => void ask(event)} aria-busy={busy}>
        <div className="ai-question-head">
          <div><h3 id="sellertray-ai-question-heading">What do you want to know?</h3><p id="sellertray-ai-question-help" className="muted">SellerTray answers from the selected business only.</p></div>
          <label className="select-field ai-period"><span>Analysis period</span><SellerTraySelect value={days} onChange={(event) => setDays(Number(event.target.value))} disabled={busy}>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={365}>Last 365 days</option>
          </SellerTraySelect></label>
        </div>
        <SellerTrayTextarea
          id="sellertray-ai-question"
          className="ai-question-input"
          rows={4}
          maxLength={1200}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Example: Which products are moving fastest and which ones need restocking?"
          aria-labelledby="sellertray-ai-question-heading"
          aria-describedby="sellertray-ai-question-help"
          disabled={busy}
        />
        <div className="ai-suggestions">
          {SUGGESTIONS.map((suggestion) => <button key={suggestion} type="button" className="ai-suggestion" onClick={() => chooseSuggestion(suggestion)} disabled={busy}>{suggestion}</button>)}
        </div>
        {error ? <div className="error-banner compact" role="alert" aria-live="assertive">{error}</div> : null}
        <div className="ai-submit-row">
          <span className="muted">SellerTray AI can recommend what to review, but it cannot execute sales, stock, payment, purchasing or settings changes.</span>
          <button className="primary-button" type="submit" disabled={busy || !question.trim()}>{busy ? 'Analysing' : 'Ask SellerTray'}</button>
        </div>
      </form>
    </article>

    {result ? <article className="panel ai-answer-panel" aria-live="polite">
      <div className="panel-head">
        <div><p className="eyebrow">SellerTray answer</p><h3>{periodLabel(result.days)}</h3></div>
        <span className={`status-pill ${result.confidence === 'high' ? 'good' : result.confidence === 'low' ? 'bad' : 'neutral'}`}>{title(result.confidence)} confidence</span>
      </div>
      <p className="ai-answer">{result.answer}</p>

      {result.highlights.length ? <section className="ai-result-section"><h4>Highlights</h4><ul>{result.highlights.map((item) => <li key={item}>{item}</li>)}</ul></section> : null}
      {result.dataNotes.length ? <section className="ai-result-section"><h4>Data notes</h4><ul>{result.dataNotes.map((item) => <li key={item}>{item}</li>)}</ul></section> : null}
      {result.followUps.length ? <section className="ai-result-section"><h4>Ask next</h4><div className="ai-suggestions">{result.followUps.map((item) => <button key={item} type="button" className="ai-suggestion" onClick={() => chooseSuggestion(item)}>{item}</button>)}</div></section> : null}
      <p className="ai-generated muted">Generated {dateTime(result.generatedAt)} · Request {result.requestId.slice(0, 8)}</p>
    </article> : <article className="panel ai-empty"><strong>No AI analysis yet</strong><p className="muted">Choose a suggested question or ask your own. SellerTray sends only governed business context needed for the answer.</p></article>}
  </div>;
}

function parseInsight(value: unknown): Insight | null {
  const row = object(value);
  const requestId = string(row.requestId);
  const generatedAt = string(row.generatedAt);
  const answer = string(row.answer);
  const confidence = row.confidence;
  const days = Number(row.days);
  if (!requestId || !generatedAt || !answer || !Number.isFinite(days)) return null;
  if (confidence !== 'high' && confidence !== 'medium' && confidence !== 'low') return null;
  return {
    requestId,
    generatedAt,
    answer,
    confidence,
    days,
    highlights: strings(row.highlights),
    dataNotes: strings(row.dataNotes),
    followUps: strings(row.followUps),
  };
}

async function functionError(cause: unknown): Promise<string> {
  if (cause && typeof cause === 'object' && 'context' in cause) {
    const context = (cause as { context?: unknown }).context;
    if (context instanceof Response) {
      try {
        const payload = await context.clone().json() as { error?: unknown };
        if (typeof payload.error === 'string' && payload.error.trim()) return payload.error;
      } catch {
        // Fall back to the SDK error message.
      }
    }
  }
  return errorMessage(cause, 'SellerTray AI is temporarily unavailable.');
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function string(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())) : []; }
function title(value: string): string { return value ? value[0].toUpperCase() + value.slice(1) : value; }
function periodLabel(days: number): string { return days === 1 ? 'Last day' : `Last ${days} days`; }
function dateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'just now' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
