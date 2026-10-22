import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { loadMerchantDetail, type MerchantRow } from './merchant-read-model';
import { invokeJson, isRecord } from './supabase';

type PortfolioTab = 'installments' | 'agreements';
type InstallmentFilter = 'open' | 'awaiting_first_payment' | 'in_progress' | 'settled' | 'all';
type AgreementFilter = 'awaiting_acceptance' | 'accepted' | 'replaced' | 'all';
type Cursor = { beforeCreatedAt?: string; beforeIssuedAt?: string; beforeId: string };

type InstallmentRow = {
  id: string;
  tenantId: string;
  merchantName: string;
  orderReference: string;
  planCode: string | null;
  structureCode: string;
  currency: string;
  obligatedAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  installmentCount: number;
  paidCount: number;
  nextSequenceNo: number | null;
  nextAmountDue: number | null;
  agreementAccepted: boolean;
  setupRequiredCount: number;
  setupReadyCount: number;
  entitlementState: string;
  portfolioState: string;
  createdAt: string;
};

type AgreementRow = {
  id: string;
  tenantId: string;
  merchantName: string;
  orderReference: string;
  reference: string;
  family: string;
  title: string;
  templateVersion: string;
  portfolioState: string;
  issuedAt: string;
  acceptedAt: string | null;
  acceptedLegalName: string | null;
  acceptedRole: string | null;
};

type PortfolioPage<T> = {
  items: T[];
  hasMore: boolean;
  nextCursor: Cursor | null;
};

type Props = {
  session: Session;
  onOpenMerchant: (merchant: MerchantRow) => void;
};

const INSTALLMENT_FILTERS: Array<[InstallmentFilter, string]> = [
  ['open', 'Open'],
  ['awaiting_first_payment', 'Awaiting first payment'],
  ['in_progress', 'In progress'],
  ['settled', 'Settled'],
  ['all', 'All'],
];

const AGREEMENT_FILTERS: Array<[AgreementFilter, string]> = [
  ['awaiting_acceptance', 'Awaiting acceptance'],
  ['accepted', 'Accepted'],
  ['replaced', 'Replaced'],
  ['all', 'All'],
];

export default function CommercialPortfolio({ session, onOpenMerchant }: Props) {
  const [tab, setTab] = useState<PortfolioTab>('installments');
  const [installmentFilter, setInstallmentFilter] = useState<InstallmentFilter>('open');
  const [agreementFilter, setAgreementFilter] = useState<AgreementFilter>('awaiting_acceptance');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [cursorHistory, setCursorHistory] = useState<Array<Cursor | null>>([]);
  const [items, setItems] = useState<Array<InstallmentRow | AgreementRow>>([]);
  const [nextCursor, setNextCursor] = useState<Cursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [openingTenantId, setOpeningTenantId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const filter = tab === 'installments' ? installmentFilter : agreementFilter;

  useEffect(() => {
    setCursor(null);
    setCursorHistory([]);
  }, [tab, filter, search]);

  useEffect(() => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError(null);
    const payload: Record<string, unknown> = {
      action: tab,
      filter,
      search: search || null,
      limit: 20,
      beforeId: cursor?.beforeId ?? null,
    };
    if (tab === 'installments') payload.beforeCreatedAt = cursor?.beforeCreatedAt ?? null;
    else payload.beforeIssuedAt = cursor?.beforeIssuedAt ?? null;

    void invokeJson<{ portfolio?: unknown }>('platform-admin-commercial', payload, session)
      .then((response) => {
        if (sequence !== requestSequence.current) return;
        const page = tab === 'installments'
          ? parseInstallmentPage(response.portfolio)
          : parseAgreementPage(response.portfolio);
        setItems(page.items);
        setNextCursor(page.hasMore ? page.nextCursor : null);
      })
      .catch((cause) => {
        if (sequence !== requestSequence.current) return;
        setItems([]);
        setNextCursor(null);
        setError(cause instanceof Error ? cause.message : 'Unable to load commercial portfolio.');
      })
      .finally(() => {
        if (sequence === requestSequence.current) setLoading(false);
      });
  }, [cursor, filter, search, session, tab]);

  function submitSearch(event: React.FormEvent) {
    event.preventDefault();
    setSearch(searchInput.trim());
  }

  function clearSearch() {
    setSearchInput('');
    setSearch('');
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

  async function openMerchant(tenantId: string) {
    setOpeningTenantId(tenantId);
    setError(null);
    try {
      const detail = await loadMerchantDetail(session, tenantId);
      onOpenMerchant(detail.merchant);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to open the selected Business.');
    } finally {
      setOpeningTenantId(null);
    }
  }

  return (
    <div className="workspace-module-card" style={{ marginBottom: 18 }}>
      <div className="workspace-panel-heading">
        <div>
          <h3>Commercial portfolio</h3>
          <p>Review cross-merchant installment collection progress and agreement lifecycle. Actions remain in each Business&apos;s governed commercial workspace.</p>
        </div>
      </div>

      <div className="workspace-filter-row" style={{ marginBottom: 12 }}>
        <button type="button" className={tab === 'installments' ? 'workspace-filter active' : 'workspace-filter'} onClick={() => setTab('installments')}>Installments</button>
        <button type="button" className={tab === 'agreements' ? 'workspace-filter active' : 'workspace-filter'} onClick={() => setTab('agreements')}>Agreements</button>
      </div>

      <form className="workspace-toolbar" onSubmit={submitSearch}>
        <div className="workspace-search">
          <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} maxLength={120} placeholder="Search Business, order or agreement" aria-label="Search commercial portfolio" />
        </div>
        <div className="workspace-filter-row">
          <button className="workspace-button subtle compact" type="submit" disabled={loading}>Search</button>
          {search ? <button className="workspace-button text compact" type="button" onClick={clearSearch}>Clear</button> : null}
        </div>
      </form>

      <div className="workspace-filter-row" style={{ marginBottom: 12 }}>
        {(tab === 'installments' ? INSTALLMENT_FILTERS : AGREEMENT_FILTERS).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={filter === value ? 'workspace-filter active' : 'workspace-filter'}
            onClick={() => tab === 'installments' ? setInstallmentFilter(value as InstallmentFilter) : setAgreementFilter(value as AgreementFilter)}
          >{label}</button>
        ))}
      </div>

      <div className="workspace-banner info" style={{ marginBottom: 12 }}>
        Installment progress uses confirmed payment facts only. No due-date, grace, aging or cross-currency policy is inferred here.
      </div>
      {error ? <div className="workspace-banner error">{error}</div> : null}

      <div className="workspace-table-wrap" aria-busy={loading}>
        {tab === 'installments' ? (
          <table className="workspace-table">
            <thead><tr><th>Business</th><th>Purchase</th><th>Confirmed</th><th>Outstanding</th><th>Readiness</th><th /></tr></thead>
            <tbody>
              {(items as InstallmentRow[]).map((row) => (
                <tr key={row.id}>
                  <td><strong>{row.merchantName}</strong><small>{friendly(row.portfolioState)}</small></td>
                  <td><strong>{row.orderReference}</strong><small>{row.planCode ? `${row.planCode} · ` : ''}{structureLabel(row.structureCode)}</small></td>
                  <td>{row.paidCount}/{row.installmentCount}<small>{money(row.paidAmount, row.currency)} confirmed</small></td>
                  <td><strong>{money(row.outstandingAmount, row.currency)}</strong><small>{row.nextSequenceNo ? `Next installment ${row.nextSequenceNo}: ${money(row.nextAmountDue ?? 0, row.currency)}` : 'No remaining installment'}</small></td>
                  <td><Status value={row.agreementAccepted ? 'Agreement accepted' : 'Agreement pending'} /><small>{row.setupReadyCount}/{row.setupRequiredCount} Branch setup ready · {friendly(row.entitlementState)}</small></td>
                  <td><button type="button" className="workspace-button subtle compact" disabled={openingTenantId === row.tenantId} onClick={() => void openMerchant(row.tenantId)}>{openingTenantId === row.tenantId ? 'Opening…' : 'Open Business'}</button></td>
                </tr>
              ))}
              {!loading && !items.length ? <tr><td colSpan={6}><Empty text="No installments match this queue." /></td></tr> : null}
            </tbody>
          </table>
        ) : (
          <table className="workspace-table">
            <thead><tr><th>Business</th><th>Agreement</th><th>Version</th><th>Status</th><th>Issued / accepted</th><th /></tr></thead>
            <tbody>
              {(items as AgreementRow[]).map((row) => (
                <tr key={row.id}>
                  <td><strong>{row.merchantName}</strong><small>{row.orderReference}</small></td>
                  <td><strong>{row.title}</strong><small>{friendly(row.family)} · {row.reference}</small></td>
                  <td>{row.templateVersion}</td>
                  <td><Status value={friendly(row.portfolioState)} />{row.acceptedLegalName ? <small>{row.acceptedLegalName}{row.acceptedRole ? ` · ${friendly(row.acceptedRole)}` : ''}</small> : null}</td>
                  <td><small>Issued {formatDate(row.issuedAt)}</small><small>{row.acceptedAt ? `Accepted ${formatDate(row.acceptedAt)}` : 'Not accepted'}</small></td>
                  <td><button type="button" className="workspace-button subtle compact" disabled={openingTenantId === row.tenantId} onClick={() => void openMerchant(row.tenantId)}>{openingTenantId === row.tenantId ? 'Opening…' : 'Open Business'}</button></td>
                </tr>
              ))}
              {!loading && !items.length ? <tr><td colSpan={6}><Empty text="No agreements match this queue." /></td></tr> : null}
            </tbody>
          </table>
        )}
      </div>

      <div className="workspace-pagination">
        <span>{loading ? 'Loading commercial portfolio…' : `Page ${cursorHistory.length + 1} · ${items.length} shown`}</span>
        <div>
          <button className="workspace-button subtle compact" type="button" disabled={loading || !cursorHistory.length} onClick={previousPage}>Previous</button>
          <button className="workspace-button subtle compact" type="button" disabled={loading || !nextCursor} onClick={nextPage}>Next</button>
        </div>
      </div>
    </div>
  );
}

function parseInstallmentPage(value: unknown): PortfolioPage<InstallmentRow> {
  if (!isRecord(value) || !Array.isArray(value.items)) throw new Error('SellerTray returned an invalid installment portfolio.');
  const items = value.items.map((entry) => {
    if (!isRecord(entry)) throw new Error('SellerTray returned an invalid installment row.');
    return {
      id: text(entry.id), tenantId: text(entry.tenantId), merchantName: text(entry.merchantName),
      orderReference: text(entry.orderReference), planCode: nullableText(entry.planCode), structureCode: text(entry.structureCode),
      currency: text(entry.currency), obligatedAmount: number(entry.obligatedAmount), paidAmount: number(entry.paidAmount),
      outstandingAmount: number(entry.outstandingAmount), installmentCount: integer(entry.installmentCount), paidCount: integer(entry.paidCount),
      nextSequenceNo: nullableInteger(entry.nextSequenceNo), nextAmountDue: nullableNumber(entry.nextAmountDue),
      agreementAccepted: entry.agreementAccepted === true, setupRequiredCount: integer(entry.setupRequiredCount), setupReadyCount: integer(entry.setupReadyCount),
      entitlementState: text(entry.entitlementState), portfolioState: text(entry.portfolioState), createdAt: text(entry.createdAt),
    } satisfies InstallmentRow;
  });
  return { items, hasMore: value.hasMore === true, nextCursor: parseCursor(value.nextCursor, 'beforeCreatedAt') };
}

function parseAgreementPage(value: unknown): PortfolioPage<AgreementRow> {
  if (!isRecord(value) || !Array.isArray(value.items)) throw new Error('SellerTray returned an invalid agreement portfolio.');
  const items = value.items.map((entry) => {
    if (!isRecord(entry)) throw new Error('SellerTray returned an invalid agreement row.');
    return {
      id: text(entry.id), tenantId: text(entry.tenantId), merchantName: text(entry.merchantName), orderReference: text(entry.orderReference),
      reference: text(entry.reference), family: text(entry.family), title: text(entry.title), templateVersion: text(entry.templateVersion),
      portfolioState: text(entry.portfolioState), issuedAt: text(entry.issuedAt), acceptedAt: nullableText(entry.acceptedAt),
      acceptedLegalName: nullableText(entry.acceptedLegalName), acceptedRole: nullableText(entry.acceptedRole),
    } satisfies AgreementRow;
  });
  return { items, hasMore: value.hasMore === true, nextCursor: parseCursor(value.nextCursor, 'beforeIssuedAt') };
}

function parseCursor(value: unknown, timeKey: 'beforeCreatedAt' | 'beforeIssuedAt'): Cursor | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) throw new Error('SellerTray returned an invalid commercial portfolio cursor.');
  const beforeId = text(value.beforeId);
  const time = text(value[timeKey]);
  return timeKey === 'beforeCreatedAt' ? { beforeCreatedAt: time, beforeId } : { beforeIssuedAt: time, beforeId };
}

function Status({ value }: { value: string }) {
  const normalized = value.toLowerCase().replace(/\s+/g, '_');
  const tone = ['accepted', 'settled', 'agreement_accepted', 'full'].includes(normalized)
    ? 'good'
    : ['awaiting_acceptance', 'agreement_pending', 'awaiting_first_payment'].includes(normalized)
      ? 'warn'
      : 'neutral';
  return <span className={`workspace-status-pill ${tone}`}>{value}</span>;
}

function Empty({ text: value }: { text: string }) {
  return <div className="workspace-empty"><strong>No records</strong><p>{value}</p></div>;
}

function structureLabel(value: string): string {
  if (value === 'two_installment_70_30') return '70% + 30%';
  if (value === 'three_installment_60_20_20') return '60% + 20% + 20%';
  return friendly(value);
}

function money(value: number, currency: string): string {
  try { return new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value); }
  catch { return `${currency} ${value.toLocaleString()}`; }
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function friendly(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function text(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new Error('SellerTray returned incomplete commercial portfolio data.');
  return value;
}
function nullableText(value: unknown): string | null { return typeof value === 'string' && value ? value : null; }
function number(value: unknown): number { const result = typeof value === 'number' ? value : Number(value); if (!Number.isFinite(result)) throw new Error('SellerTray returned invalid commercial amounts.'); return result; }
function nullableNumber(value: unknown): number | null { if (value === null || value === undefined) return null; return number(value); }
function integer(value: unknown): number { const result = number(value); if (!Number.isInteger(result) || result < 0) throw new Error('SellerTray returned invalid commercial counts.'); return result; }
function nullableInteger(value: unknown): number | null { if (value === null || value === undefined) return null; return integer(value); }
