import { SellerTraySelect } from './SellerTrayElements';
import { useEffect, useMemo, useState } from 'react';
import { errorMessage, supabase } from './supabase';

type MerchantRole = 'owner' | 'manager';
type Branch = { id: string; code: string; name: string; isDefault: boolean };
type Route = {
  connectionId: string;
  connectionStatus: string;
  branchId: string;
  branchName: string | null;
  branchCode: string | null;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  connectedAt: string | null;
  lastVerifiedAt: string | null;
  updatedAt: string | null;
};
type Readiness = {
  inboundReady: boolean;
  outboundReady: boolean;
  messagingReady: boolean;
  webhookReady: boolean;
  credentialReady: boolean;
  reason: string | null;
  checkedAt: string | null;
};
type ManagementReadiness = {
  managementApiReady: boolean;
  reason: string | null;
  checkedAt: string | null;
  evidence: string | null;
  phoneCount: number | null;
};
type Connection = {
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  connectionStatus: string;
  webhookSubscriptionStatus: string | null;
  connectedAt: string | null;
  lastVerifiedAt: string | null;
  lastErrorMessage: string | null;
};

export default function WhatsAppManagement({
  tenantId,
  role,
  branches,
  connectionStatusHint,
}: {
  tenantId: string;
  role: MerchantRole;
  branches: Branch[];
  connectionStatusHint: string;
}) {
  const [route, setRoute] = useState<Route | null>(null);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [managementReadiness, setManagementReadiness] = useState<ManagementReadiness | null>(null);
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const connected = (connection?.connectionStatus ?? route?.connectionStatus ?? connectionStatusHint) === 'connected';
  const currentBranch = useMemo(
    () => branches.find((branch) => branch.id === route?.branchId) ?? null,
    [branches, route?.branchId],
  );

  useEffect(() => {
    void load();
  }, [tenantId]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [routeResult, statusResult] = await Promise.all([
        supabase.rpc('get_sellertray_whatsapp_management_route', { p_tenant_id: tenantId }),
        supabase.functions.invoke('whatsapp-connection', { body: { action: 'status', tenantId } }),
      ]);
      if (routeResult.error) throw routeResult.error;
      if (statusResult.error) throw statusResult.error;

      const nextRoute = parseRoute(routeResult.data);
      const status = parseStatus(statusResult.data);
      setRoute(nextRoute);
      setConnection(status.connection);
      setReadiness(status.readiness);
      setManagementReadiness(status.managementReadiness);
      setSelectedBranchId(nextRoute?.branchId ?? branches.find((branch) => branch.isDefault)?.id ?? branches[0]?.id ?? '');
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to load WhatsApp management status.'));
    } finally {
      setLoading(false);
    }
  }

  async function saveReceivingBranch() {
    if (!selectedBranchId || !connected) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const { error: routeError } = await supabase.rpc('set_sellertray_whatsapp_branch', {
        p_tenant_id: tenantId,
        p_branch_id: selectedBranchId,
      });
      if (routeError) throw routeError;
      await load();
      setMessage('WhatsApp receiving Branch updated. New inbound conversations and orders will use this Branch.');
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to change the WhatsApp receiving Branch.'));
    } finally {
      setSaving(false);
    }
  }

  async function disconnectWhatsApp() {
    if (role !== 'owner' || !connected || disconnecting) return;
    const confirmed = window.confirm('Disconnect this WhatsApp Business account from SellerTray? New WhatsApp messages and orders will stop until the business is connected again. Existing orders, customers and history are preserved.');
    if (!confirmed) return;

    setDisconnecting(true);
    setError(null);
    setMessage(null);
    try {
      const { error: functionError } = await supabase.functions.invoke('whatsapp-connection', {
        body: { action: 'disconnect', tenantId },
      });
      if (functionError) throw functionError;
      await load();
      setMessage('WhatsApp disconnected. Existing SellerTray orders, customers and history were preserved.');
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to disconnect WhatsApp.'));
    } finally {
      setDisconnecting(false);
    }
  }

  return <div className="page-stack">
    <div className="section-heading">
      <div><p className="eyebrow">Customer channel</p><h2>WhatsApp</h2></div>
      <p className="muted">Manage the connected business number and the Branch that receives future WhatsApp conversations and orders.</p>
    </div>

    {error ? <div className="error-banner">{error}<button onClick={() => setError(null)}>Dismiss</button></div> : null}
    {message ? <div className="success-banner">{message}<button onClick={() => setMessage(null)}>Dismiss</button></div> : null}

    <article className="panel whatsapp-hero">
      <div className="whatsapp-number">
        <div className="whatsapp-mark">WA</div>
        <div>
          <p className="eyebrow">Business number</p>
          <h3>{connection?.verifiedName || route?.verifiedName || 'WhatsApp Business'}</h3>
          <p>{connection?.displayPhoneNumber || route?.displayPhoneNumber || (loading ? 'Checking connection…' : 'No connected number')}</p>
        </div>
      </div>
      <div className="whatsapp-status-stack">
        <span className={connected ? 'status-pill good' : 'status-pill neutral'}>{statusText(connection?.connectionStatus ?? route?.connectionStatus ?? connectionStatusHint)}</span>
        <button className="secondary-button" disabled={loading || disconnecting} onClick={() => void load()}>{loading ? 'Checking…' : 'Check status'}</button>
      </div>
    </article>

    <div className="whatsapp-grid">
      <article className="panel route-panel">
        <div className="panel-head"><div><p className="eyebrow">Receiving Branch</p><h3>{currentBranch?.name || route?.branchName || 'Choose Branch'}</h3></div></div>
        <p className="muted">Future inbound messages are stamped with this Branch. WhatsApp orders inherit that immutable Branch and use the same stock, payments and reporting core as POS.</p>
        <label className="field route-field"><span>Branch for future WhatsApp conversations</span><SellerTraySelect value={selectedBranchId} disabled={!connected || saving || disconnecting || !branches.length} onChange={(event) => setSelectedBranchId(event.target.value)}>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}{branch.isDefault ? ' · Default' : ''}</option>)}</SellerTraySelect></label>
        {!connected ? <div className="access-mode-note">Connect WhatsApp before choosing a receiving Branch.</div> : null}
        {connected && !branches.length ? <div className="access-mode-note">Create an active Branch before changing WhatsApp routing.</div> : null}
        <div className="form-actions"><button className="primary-button" disabled={!connected || saving || disconnecting || !selectedBranchId || selectedBranchId === route?.branchId} onClick={() => void saveReceivingBranch()}>{saving ? 'Saving…' : 'Save receiving Branch'}</button></div>
      </article>

      <article className="panel readiness-panel">
        <div className="panel-head"><div><p className="eyebrow">Messaging readiness</p><h3>{readiness?.messagingReady ? 'Ready for messaging' : 'Needs attention'}</h3></div></div>
        <div className="readiness-list">
          <ReadinessRow label="Inbound messages" ready={readiness?.inboundReady === true} />
          <ReadinessRow label="Outbound messages" ready={readiness?.outboundReady === true} />
          <ReadinessRow label="Webhook" ready={readiness?.webhookReady === true} />
          <ReadinessRow label="Credentials" ready={readiness?.credentialReady === true} />
          <ReadinessRow label="Management API" ready={managementReadiness?.managementApiReady === true} />
        </div>
        {readiness?.reason ? <p className="readiness-reason">Messaging: {readiness.reason}</p> : null}
        {managementReadiness?.reason ? <p className="readiness-reason">Management API: {managementReadiness.reason}</p> : null}
        {managementReadiness?.managementApiReady && managementReadiness.phoneCount != null ? <p className="muted last-check">Verified {managementReadiness.phoneCount} phone number{managementReadiness.phoneCount === 1 ? '' : 's'} on the connected WhatsApp Business Account.</p> : null}
        {(managementReadiness?.checkedAt || readiness?.checkedAt) ? <p className="muted last-check">Last checked {dateTime(managementReadiness?.checkedAt || readiness?.checkedAt || '')}</p> : null}
      </article>
    </div>

    <div className="two-column whatsapp-detail-grid">
      <article className="panel">
        <div className="panel-head"><div><p className="eyebrow">Connection details</p><h3>WhatsApp Business</h3></div></div>
        <Detail label="Status" value={statusText(connection?.connectionStatus ?? route?.connectionStatus ?? connectionStatusHint)} />
        <Detail label="Webhook subscription" value={connection?.webhookSubscriptionStatus ? statusText(connection.webhookSubscriptionStatus) : '—'} />
        <Detail label="Management API" value={managementReadiness?.managementApiReady ? 'Ready' : 'Not ready'} />
        <Detail label="Connected" value={connection?.connectedAt ? dateTime(connection.connectedAt) : route?.connectedAt ? dateTime(route.connectedAt) : '—'} />
        <Detail label="Last verified" value={connection?.lastVerifiedAt ? dateTime(connection.lastVerifiedAt) : route?.lastVerifiedAt ? dateTime(route.lastVerifiedAt) : '—'} />
        {connection?.lastErrorMessage ? <div className="whatsapp-error-note"><strong>Last connection issue</strong><p>{connection.lastErrorMessage}</p></div> : null}
      </article>
      <article className="panel">
        <div className="panel-head"><div><p className="eyebrow">Connection control</p><h3>{role === 'owner' ? 'Owner-managed setup' : 'Owner approval required'}</h3></div></div>
        <p className="muted">Connecting or disconnecting the WhatsApp Business account remains an Owner-only security action. Managers can review status and change the receiving Branch, but cannot replace provider credentials.</p>
        {role === 'owner' && connected ? <div className="form-actions"><button className="secondary-button" disabled={disconnecting || loading} onClick={() => void disconnectWhatsApp()}>{disconnecting ? 'Disconnecting…' : 'Disconnect WhatsApp'}</button></div> : null}
        {role === 'owner' && !connected ? <div className="access-mode-note">Web connection setup is not exposed until SellerTray Meta Embedded Signup is configured for this management surface. No access token or provider secret should be entered in Merchant Web.</div> : null}
        {role === 'manager' ? <div className="access-mode-note">Ask the business Owner to connect or disconnect the WhatsApp Business account.</div> : null}
        <div className="channel-rule"><strong>One commerce core</strong><span>WhatsApp does not create a parallel catalogue, order, payment or inventory model.</span></div>
      </article>
    </div>
  </div>;
}

function ReadinessRow({ label, ready }: { label: string; ready: boolean }) {
  return <div className="readiness-row"><span>{label}</span><strong className={ready ? 'ready-yes' : 'ready-no'}>{ready ? 'Ready' : 'Not ready'}</strong></div>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="detail-row"><span>{label}</span><strong>{value}</strong></div>;
}

function parseRoute(value: unknown): Route | null {
  if (!isRecord(value) || typeof value.connectionId !== 'string') return null;
  return {
    connectionId: value.connectionId,
    connectionStatus: text(value.connectionStatus) || 'not_connected',
    branchId: text(value.branchId),
    branchName: optionalText(value.branchName),
    branchCode: optionalText(value.branchCode),
    displayPhoneNumber: optionalText(value.displayPhoneNumber),
    verifiedName: optionalText(value.verifiedName),
    connectedAt: optionalText(value.connectedAt),
    lastVerifiedAt: optionalText(value.lastVerifiedAt),
    updatedAt: optionalText(value.updatedAt),
  };
}

function parseStatus(value: unknown): { connection: Connection | null; readiness: Readiness | null; managementReadiness: ManagementReadiness | null } {
  const root = isRecord(value) ? value : {};
  const rawConnection = isRecord(root.connection) ? root.connection : null;
  const rawReadiness = isRecord(root.readiness) ? root.readiness : null;
  const rawManagement = isRecord(root.managementReadiness) ? root.managementReadiness : null;
  return {
    connection: rawConnection ? {
      displayPhoneNumber: optionalText(rawConnection.display_phone_number),
      verifiedName: optionalText(rawConnection.verified_name),
      connectionStatus: text(rawConnection.connection_status) || 'not_connected',
      webhookSubscriptionStatus: optionalText(rawConnection.webhook_subscription_status),
      connectedAt: optionalText(rawConnection.connected_at),
      lastVerifiedAt: optionalText(rawConnection.last_verified_at),
      lastErrorMessage: optionalText(rawConnection.last_error_message),
    } : null,
    readiness: rawReadiness ? {
      inboundReady: rawReadiness.inboundReady === true,
      outboundReady: rawReadiness.outboundReady === true,
      messagingReady: rawReadiness.messagingReady === true,
      webhookReady: rawReadiness.webhookReady === true,
      credentialReady: rawReadiness.credentialReady === true,
      reason: optionalText(rawReadiness.reason),
      checkedAt: optionalText(rawReadiness.checkedAt),
    } : null,
    managementReadiness: rawManagement ? {
      managementApiReady: rawManagement.managementApiReady === true,
      reason: optionalText(rawManagement.reason),
      checkedAt: optionalText(rawManagement.checkedAt),
      evidence: optionalText(rawManagement.evidence),
      phoneCount: typeof rawManagement.phoneCount === 'number' && Number.isFinite(rawManagement.phoneCount) ? rawManagement.phoneCount : null,
    } : null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function statusText(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
