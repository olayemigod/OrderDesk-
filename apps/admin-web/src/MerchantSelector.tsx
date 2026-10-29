import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import AgreementLifecycleManagement from './AgreementLifecycleManagement';
import CommercialPortfolio from './CommercialPortfolio';
import {
  loadMerchantPortfolio,
  type MerchantCursor,
  type MerchantRow,
} from './merchant-read-model';

type MerchantSelectorProps = {
  session: Session;
  selectedIds: ReadonlySet<string>;
  onChange: (next: Set<string>, changedMerchant?: MerchantRow) => void;
  mode?: 'single' | 'multiple';
  pageSize?: number;
  showCommercialPortfolio?: boolean;
};

export default function MerchantSelector({
  session,
  selectedIds,
  onChange,
  mode = 'multiple',
  pageSize = 20,
  showCommercialPortfolio,
}: MerchantSelectorProps) {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<MerchantRow[]>([]);
  const [cursor, setCursor] = useState<MerchantCursor | null>(null);
  const [cursorHistory, setCursorHistory] = useState<Array<MerchantCursor | null>>([]);
  const [nextCursor, setNextCursor] = useState<MerchantCursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const shouldShowCommercialPortfolio = showCommercialPortfolio === true;
  const selectedTenantId = mode === 'single' ? [...selectedIds][0] ?? null : null;

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setCursor(null);
    setCursorHistory([]);
  }, [query]);

  useEffect(() => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError(null);
    void loadMerchantPortfolio(session, { search: query, cursor, limit: pageSize })
      .then((page) => {
        if (sequence !== requestSequence.current) return;
        setItems(page.items);
        setNextCursor(page.hasMore ? page.nextCursor : null);
      })
      .catch((cause) => {
        if (sequence !== requestSequence.current) return;
        setItems([]);
        setNextCursor(null);
        setError(cause instanceof Error ? cause.message : 'Unable to load businesses.');
      })
      .finally(() => {
        if (sequence === requestSequence.current) setLoading(false);
      });
  }, [cursor, pageSize, query, session]);

  function toggle(merchant: MerchantRow) {
    if (mode === 'single') {
      onChange(selectedIds.has(merchant.id) ? new Set() : new Set([merchant.id]), merchant);
      return;
    }
    const next = new Set(selectedIds);
    if (next.has(merchant.id)) next.delete(merchant.id); else next.add(merchant.id);
    onChange(next, merchant);
  }

  function nextPage() {
    if (!nextCursor) return;
    setCursorHistory((current) => [...current, cursor]);
    setCursor(nextCursor);
  }

  function previousPage() {
    if (!cursorHistory.length) return;
    setCursor(cursorHistory[cursorHistory.length - 1]);
    setCursorHistory(cursorHistory.slice(0, -1));
  }

  return (
    <>
      {shouldShowCommercialPortfolio ? (
        <CommercialPortfolio
          session={session}
          onOpenMerchant={(merchant) => onChange(new Set([merchant.id]), merchant)}
        />
      ) : null}
      <div className="workspace-tenant-selector">
        <div className="workspace-toolbar">
          <div className="workspace-search">
            <input
              aria-label="Search businesses"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search business, email, phone or status"
            />
          </div>
          {mode === 'multiple' ? (
            <div className="workspace-filter-row">
              <button className="workspace-button subtle compact" type="button" disabled={!items.length} onClick={() => onChange(new Set([...selectedIds, ...items.map((item) => item.id)]))}>Select page</button>
              <button className="workspace-button subtle compact" type="button" disabled={!selectedIds.size} onClick={() => onChange(new Set())}>Clear</button>
            </div>
          ) : null}
        </div>
        {error ? <div className="workspace-banner error">{error}</div> : null}
        <div className="workspace-tenant-list" aria-busy={loading}>
          {items.map((merchant) => {
            const selected = selectedIds.has(merchant.id);
            return (
              <button key={merchant.id} type="button" className={selected ? 'workspace-tenant-row selected' : 'workspace-tenant-row'} onClick={() => toggle(merchant)} aria-pressed={selected}>
                <span className="workspace-tenant-check" aria-hidden="true">{selected ? '✓' : ''}</span>
                <span><strong>{merchant.name}</strong><small>{merchant.businessEmail ?? merchant.businessPhone ?? merchant.slug}</small></span>
                <StatusPill value={merchant.subscriptionStatus} />
                <StatusPill value={merchant.whatsappStatus} />
              </button>
            );
          })}
          {!loading && !items.length ? <div className="workspace-empty"><strong>No businesses found</strong><p>Adjust the search.</p></div> : null}
        </div>
        <div className="workspace-pagination">
          <span>{loading ? 'Loading businesses…' : `Page ${cursorHistory.length + 1} · ${items.length} shown`}</span>
          <div>
            <button className="workspace-button subtle compact" type="button" disabled={loading || !cursorHistory.length} onClick={previousPage}>Previous</button>
            <button className="workspace-button subtle compact" type="button" disabled={loading || !nextCursor} onClick={nextPage}>Next</button>
          </div>
        </div>
      </div>
      {shouldShowCommercialPortfolio && selectedTenantId ? <AgreementLifecycleManagement session={session} tenantId={selectedTenantId} /> : null}
    </>
  );
}

function StatusPill({ value }: { value: string }) {
  const normalized = value.toLowerCase();
  const tone = ['active', 'connected', 'full', 'paid'].includes(normalized)
    ? 'good'
    : ['error', 'suspended', 'cancelled', 'past_due'].includes(normalized)
      ? 'bad'
      : ['pending', 'grace', 'trial'].includes(normalized)
        ? 'warn'
        : 'neutral';
  return <span className={`workspace-status-pill ${tone}`}>{value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())}</span>;
}
