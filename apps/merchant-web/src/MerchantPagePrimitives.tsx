import type { ReactNode } from 'react';
import './merchant-page-primitives.css';

type NoticeTone = 'info' | 'success' | 'warning' | 'error';
type StatusTone = 'neutral' | 'success' | 'warning' | 'danger';

export function MerchantPageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return <header className="merchant-page-header">
    <div className="merchant-page-header-copy">
      {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      <h2>{title}</h2>
      {description ? <p className="muted">{description}</p> : null}
    </div>
    {actions ? <div className="merchant-page-header-actions">{actions}</div> : null}
  </header>;
}

export function MerchantSectionHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return <div className="merchant-section-header">
    <div><h3>{title}</h3>{description ? <p className="muted">{description}</p> : null}</div>
    {actions ? <div className="merchant-section-header-actions">{actions}</div> : null}
  </div>;
}

export function MerchantPanelHeader({ eyebrow, title, description, status }: { eyebrow?: string; title: string; description?: string; status?: ReactNode }) {
  return <div className="merchant-panel-header">
    <div className="merchant-panel-header-copy">
      {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      <h3>{title}</h3>
      {description ? <p className="muted">{description}</p> : null}
    </div>
    {status ? <div className="merchant-panel-header-status">{status}</div> : null}
  </div>;
}

export function MerchantLoadingState({ label = 'Loading…' }: { label?: string }) {
  return <article className="panel merchant-state-panel" aria-live="polite" aria-busy="true">
    <span className="merchant-loading-dot" aria-hidden="true" />
    <p>{label}</p>
  </article>;
}

export function MerchantShellState({ mark, eyebrow = 'SellerTray', title, body, action, loading = false }: { mark?: ReactNode; eyebrow?: string; title: string; body: string; action?: ReactNode; loading?: boolean }) {
  return <div className="status-page">
    <div className="status-card" aria-live="polite" aria-busy={loading || undefined}>
      {mark}
      {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      <h1>{title}</h1>
      <p>{body}</p>
      {loading ? <div className="merchant-shell-state-loading"><span className="merchant-loading-dot" aria-hidden="true" /><span>Loading…</span></div> : null}
      {action ? <div className="merchant-shell-state-action">{action}</div> : null}
    </div>
  </div>;
}

export function MerchantEmptyState({ title, body, action, surface = true }: { title: string; body: string; action?: ReactNode; surface?: boolean }) {
  const content = <div className="merchant-empty-state">
    <div className="merchant-empty-state-mark" aria-hidden="true">—</div>
    <strong>{title}</strong>
    <p>{body}</p>
    {action ? <div className="merchant-empty-state-action">{action}</div> : null}
  </div>;
  return surface ? <article className="panel">{content}</article> : content;
}

export function MerchantNotice({ tone = 'info', children, onDismiss }: { tone?: NoticeTone; children: ReactNode; onDismiss?: () => void }) {
  return <div className={`merchant-notice ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
    <div>{children}</div>
    {onDismiss ? <button type="button" onClick={onDismiss}>Dismiss</button> : null}
  </div>;
}

export function MerchantStatusBadge({ children, tone = 'neutral' }: { children: ReactNode; tone?: StatusTone }) {
  return <span className={`merchant-status-badge ${tone}`}>{children}</span>;
}

export function MerchantFactGrid({ children }: { children: ReactNode }) {
  return <div className="merchant-fact-grid">{children}</div>;
}

export function MerchantFact({ label, value }: { label: string; value: ReactNode }) {
  return <div className="merchant-fact"><span>{label}</span><strong>{value}</strong></div>;
}
