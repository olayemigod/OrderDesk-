import { useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import MerchantSelector from './MerchantSelector';
import { invokeJson } from './supabase';

type AdminRole = 'admin' | 'support';
type MessageType = 'update' | 'service' | 'information' | 'promotion';
type Severity = 'info' | 'attention' | 'urgent';
type MerchantRole = 'owner' | 'manager' | 'staff';
type PublishResult = { ok?: boolean; campaignId?: string; notificationCount?: number };
export type AdminAuditEvent = { id: string; action: string; detail: Record<string, unknown>; createdAt: string; actorEmail: string };

const MESSAGE_LABELS: Record<MessageType, string> = {
  update: 'Product update',
  service: 'Service notice',
  information: 'Information',
  promotion: 'Promotion',
};
const ROLE_LABELS: Record<MerchantRole, string> = { owner: 'Owner', manager: 'Manager', staff: 'Cashier' };
const DEFAULT_ROLES: MerchantRole[] = ['owner', 'manager', 'staff'];
const ACTION_URL_PATTERN = /^(https:\/\/[^\s]+|sellertray:\/\/[A-Za-z0-9/_?=&.%-]+)$/;

export function MerchantMessageComposer({
  session,
  actorRole,
  merchantCount,
  onPublished,
}: {
  session: Session;
  actorRole: AdminRole;
  merchantCount: number;
  onPublished: () => Promise<void>;
}) {
  const [messageType, setMessageType] = useState<MessageType>('update');
  const [severity, setSeverity] = useState<Severity>('info');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [actionLabel, setActionLabel] = useState('');
  const [actionUrl, setActionUrl] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [allBusinesses, setAllBusinesses] = useState(true);
  const [selectedTenantIds, setSelectedTenantIds] = useState<Set<string>>(new Set());
  const [audienceRoles, setAudienceRoles] = useState<Set<MerchantRole>>(new Set(DEFAULT_ROLES));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canPublish = actorRole === 'admin';
  const selectedCount = allBusinesses ? merchantCount : selectedTenantIds.size;
  const roleList = Array.from(audienceRoles);

  function toggleRole(role: MerchantRole) {
    setAudienceRoles((current) => {
      const next = new Set(current);
      if (next.has(role)) next.delete(role); else next.add(role);
      return next;
    });
  }

  function validate() {
    if (!canPublish) return 'Only a ProcessEdge Platform Admin can publish merchant messages.';
    if (!title.trim() || title.trim().length > 160) return 'Enter a title between 1 and 160 characters.';
    if (!body.trim() || body.trim().length > 1000) return 'Enter a message between 1 and 1000 characters.';
    if (!audienceRoles.size) return 'Select at least one merchant role.';
    if (!allBusinesses && !selectedTenantIds.size) return 'Select at least one SellerTray business.';
    if (messageType === 'promotion' && severity === 'urgent') return 'Promotional messages cannot be marked urgent.';
    if ((actionLabel.trim() && !actionUrl.trim()) || (!actionLabel.trim() && actionUrl.trim())) return 'CTA label and CTA link must be provided together.';
    if (actionLabel.trim().length > 60) return 'CTA label must be 60 characters or fewer.';
    if (actionUrl.trim() && !ACTION_URL_PATTERN.test(actionUrl.trim())) return 'CTA link must use https:// or sellertray://.';
    if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) return 'Expiry must be in the future.';
    return null;
  }

  function requestPublish() {
    setSuccess(null);
    const validation = validate();
    if (validation) return setError(validation);
    setError(null);
    setConfirmOpen(true);
  }

  async function publish() {
    setPublishing(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = { messageType, severity, title: title.trim(), body: body.trim(), audienceRoles: roleList };
      if (!allBusinesses) payload.tenantIds = Array.from(selectedTenantIds);
      if (actionLabel.trim()) payload.actionLabel = actionLabel.trim();
      if (actionUrl.trim()) payload.actionUrl = actionUrl.trim();
      if (expiresAt) payload.expiresAt = new Date(expiresAt).toISOString();
      const result = await invokeJson<PublishResult>('platform-merchant-message', payload, session);
      const count = Number(result.notificationCount ?? 0);
      setSuccess(`Published to ${count.toLocaleString()} SellerTray business${count === 1 ? '' : 'es'}. Campaign ${result.campaignId ?? ''}`.trim());
      setConfirmOpen(false);
      setTitle(''); setBody(''); setActionLabel(''); setActionUrl(''); setExpiresAt('');
      await onPublished();
    } catch (cause) {
      setError(messageFrom(cause, 'Unable to publish this merchant message.'));
      setConfirmOpen(false);
    } finally {
      setPublishing(false);
    }
  }

  return <>
    {!canPublish ? <div className="workspace-banner warning">Platform Support can review communications but publishing remains restricted to authorised Platform Admin capability.</div> : null}
    {success ? <div className="workspace-banner success">{success}</div> : null}
    {error ? <div className="workspace-banner error">{error}</div> : null}
    <div className="workspace-grid two composer">
      <section className="workspace-panel workspace-form-stack">
        <PanelHeading title="Compose message" description="Create the merchant-facing notification content." />
        <div className="workspace-field-grid two"><label>Message type<select value={messageType} onChange={(event) => { const next = event.target.value as MessageType; setMessageType(next); if (next === 'promotion' && severity === 'urgent') setSeverity('attention'); }}>{Object.entries(MESSAGE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Priority<select value={severity} onChange={(event) => setSeverity(event.target.value as Severity)}><option value="info">Normal</option><option value="attention">Attention</option><option value="urgent" disabled={messageType === 'promotion'}>Urgent</option></select></label></div>
        <label>Title <span className="workspace-counter">{title.trim().length}/160</span><input value={title} onChange={(event) => setTitle(event.target.value.slice(0, 160))} /></label>
        <label>Message <span className="workspace-counter">{body.trim().length}/1000</span><textarea rows={7} value={body} onChange={(event) => setBody(event.target.value.slice(0, 1000))} /></label>
        <div className="workspace-field-grid two"><label>CTA label <span className="workspace-optional">Optional</span><input value={actionLabel} onChange={(event) => setActionLabel(event.target.value.slice(0, 60))} /></label><label>CTA link <span className="workspace-optional">Optional</span><input value={actionUrl} onChange={(event) => setActionUrl(event.target.value)} placeholder="sellertray://… or https://…" /></label></div>
        <label>Expiry <span className="workspace-optional">Optional</span><input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label>
      </section>
      <aside className="workspace-panel">
        <PanelHeading title="Merchant preview" description="Approximate SellerTray notification appearance." />
        <div className={`workspace-notification-preview severity-${severity}`}><div className="workspace-preview-meta"><span>{MESSAGE_LABELS[messageType]}</span><span>{friendlyLabel(severity)}</span></div><h3>{title.trim() || 'Your notification title'}</h3><p>{body.trim() || 'Your merchant message will appear here.'}</p>{actionLabel.trim() ? <button type="button" className="workspace-preview-cta">{actionLabel.trim()}</button> : null}<small>ProcessEdge · just now</small></div>
      </aside>
    </div>
    <section className="workspace-panel">
      <PanelHeading title="Audience" description="Choose businesses and merchant roles." />
      <div className="workspace-filter-row"><button className={allBusinesses ? 'workspace-filter active' : 'workspace-filter'} onClick={() => setAllBusinesses(true)}>All businesses</button><button className={!allBusinesses ? 'workspace-filter active' : 'workspace-filter'} onClick={() => setAllBusinesses(false)}>Selected businesses</button></div>
      <div className="workspace-role-row">{DEFAULT_ROLES.map((role) => <label className="workspace-check-pill" key={role}><input type="checkbox" checked={audienceRoles.has(role)} onChange={() => toggleRole(role)} />{ROLE_LABELS[role]}</label>)}</div>
      {!allBusinesses ? <MerchantSelector session={session} selectedIds={selectedTenantIds} onChange={setSelectedTenantIds} /> : null}
      <div className="workspace-publish-bar"><div><strong>{selectedCount.toLocaleString()} business{selectedCount === 1 ? '' : 'es'}</strong><span>{roleList.length} selected role{roleList.length === 1 ? '' : 's'}</span></div><button className="workspace-button primary" disabled={!canPublish || publishing} onClick={requestPublish}>Review & publish</button></div>
    </section>
    {confirmOpen ? <Modal title="Publish this notification?" onClose={() => setConfirmOpen(false)} actions={<><button className="workspace-button subtle" onClick={() => setConfirmOpen(false)} disabled={publishing}>Cancel</button><button className="workspace-button primary" onClick={() => void publish()} disabled={publishing}>{publishing ? 'Publishing…' : 'Publish notification'}</button></>}><p>This will create notifications for <strong>{selectedCount.toLocaleString()} SellerTray business{selectedCount === 1 ? '' : 'es'}</strong>.</p></Modal> : null}
  </>;
}

export function CampaignHistory({ audit }: { audit: AdminAuditEvent[] }) {
  const notificationAudit = useMemo(() => audit.filter((event) => event.action === 'merchant_message_published'), [audit]);
  return <section className="workspace-panel">
    <PanelHeading title="Campaign history" description="Audited merchant-message publications. This page is review-only; composition belongs in Compose Message." />
    <div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th>Published</th><th>Type</th><th>Priority</th><th>Businesses</th><th>Actor</th><th>Campaign</th></tr></thead><tbody>{notificationAudit.map((event) => <tr key={event.id}><td>{formatDate(event.createdAt)}</td><td>{MESSAGE_LABELS[stringValue(event.detail.message_type) as MessageType] ?? friendlyLabel(stringValue(event.detail.message_type))}</td><td>{friendlyLabel(stringValue(event.detail.severity))}</td><td>{numberValue(event.detail.notification_count).toLocaleString()}</td><td>{event.actorEmail || 'Platform Admin'}</td><td><code>{shortId(stringValue(event.detail.campaign_id))}</code></td></tr>)}{!notificationAudit.length ? <tr><td colSpan={6}><EmptyState title="No campaigns yet" body="Published merchant communications will appear here." /></td></tr> : null}</tbody></table></div>
  </section>;
}

function PanelHeading({ title, description }: { title: string; description: string }) { return <div className="workspace-panel-heading"><div><h2>{title}</h2><p>{description}</p></div></div>; }
function EmptyState({ title, body }: { title: string; body: string }) { return <div className="workspace-empty"><strong>{title}</strong><p>{body}</p></div>; }
function Modal({ title, children, actions, onClose }: { title: string; children: ReactNode; actions: ReactNode; onClose: () => void }) { return <div className="workspace-modal-backdrop" role="presentation" onClick={onClose}><div className="workspace-modal" role="dialog" aria-modal="true" aria-labelledby="workspace-modal-title" onClick={(event) => event.stopPropagation()}><div className="workspace-modal-header"><h2 id="workspace-modal-title">{title}</h2><button className="workspace-icon-button" aria-label="Close dialog" onClick={onClose}>×</button></div>{children}<div className="workspace-modal-actions">{actions}</div></div></div>; }
function friendlyLabel(value: string): string { if (!value) return 'Unknown'; return value.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase()); }
function messageFrom(value: unknown, fallback: string): string { return value instanceof Error && value.message ? value.message : fallback; }
function stringValue(value: unknown): string { return typeof value === 'string' ? value : ''; }
function numberValue(value: unknown): number { const parsed = typeof value === 'number' ? value : Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function shortId(value: string): string { return value ? `${value.slice(0, 8)}…` : '—'; }
function formatDate(value: string | null): string { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
