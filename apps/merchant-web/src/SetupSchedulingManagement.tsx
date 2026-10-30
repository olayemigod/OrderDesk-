import { useEffect, useRef, useState } from 'react';
import { SellerTrayInput } from './SellerTrayElements';
import { errorMessage, supabase } from './supabase';

type Appointment = {
  id: string;
  commercialOrderId: string;
  branchId: string;
  branchName: string;
  scheduledStartAt: string;
  scheduledEndAt: string;
  status: string;
  merchantNote: string | null;
  serviceAreaName: string;
  ready: boolean;
  readyAt: string | null;
  pendingRescheduleRequest: boolean;
};

type ScheduleState = { tenantId: string; appointments: Appointment[]; generatedAt: string };
type RequestDraft = { appointmentId: string; startLocal: string; endLocal: string; note: string };

export default function SetupSchedulingManagement({ tenantId }: { tenantId: string }) {
  const [onboarding, setOnboarding] = useState<Record<string, unknown> | null>(null);
  const [state, setState] = useState<ScheduleState | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState<RequestDraft | null>(null);
  const commandIds = useRef(new Map<string,string>());
  const currentTenant = useRef(tenantId);
  currentTenant.current = tenantId;

  useEffect(() => { setDraft(null); setState(null); setOnboarding(null); commandIds.current.clear(); void load(); }, [tenantId]);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [schedule, status] = await Promise.all([
        supabase.rpc('get_sellertray_setup_schedule', { p_tenant_id: tenantId }),
        supabase.rpc('get_sellertray_onboarding_state', { p_tenant_id: tenantId }),
      ]);
      if (schedule.error) throw schedule.error;
      if (status.error) throw status.error;
      if (currentTenant.current !== tenantId) return;
      setState(parseState(schedule.data)); setOnboarding(record(status.data));
    } catch (cause) { setError(errorMessage(cause, 'Unable to load setup scheduling.')); }
    finally { setLoading(false); }
  }

  function openRequest(appointment: Appointment) {
    setDraft({ appointmentId: appointment.id, startLocal: toLocal(appointment.scheduledStartAt), endLocal: toLocal(appointment.scheduledEndAt), note: '' });
    setError(null); setMessage(null);
  }

  async function submitRequest(appointment: Appointment) {
    if (!draft || draft.appointmentId !== appointment.id || saving) return;
    const note = draft.note.trim().replace(/\s+/g,' ');
    const start = fromLocal(draft.startLocal); const end = fromLocal(draft.endLocal);
    if (note.length < 6) return setError('Tell ProcessEdge why the setup appointment needs to change.');
    if (!start || !end || Date.parse(end) <= Date.parse(start)) return setError('Choose a valid preferred setup start and end time.');
    const commandId = commandIds.current.get(appointment.id) ?? crypto.randomUUID(); commandIds.current.set(appointment.id, commandId);
    setSaving(true); setError(null); setMessage(null);
    try {
      const { error: rpcError } = await supabase.rpc('request_sellertray_setup_reschedule', {
        p_tenant_id: tenantId,
        p_appointment_id: appointment.id,
        p_requested_start_at: start,
        p_requested_end_at: end,
        p_merchant_note: note,
        p_command_id: commandId,
      });
      if (rpcError) throw rpcError;
      commandIds.current.delete(appointment.id); setDraft(null);
      await load(); setMessage('Your setup appointment change request has been sent to ProcessEdge.');
    } catch (cause) { setError(errorMessage(cause, 'Unable to send the setup appointment change request. Retry keeps the same request identity.')); }
    finally { setSaving(false); }
  }

  return <section className="page-stack" aria-label="Setup and activation">
    <div className="section-heading"><div><p className="eyebrow">Business onboarding</p><h2>Setup & Activation</h2></div><p className="muted">Finalise the purchased Branch setup with ProcessEdge and track readiness through activation.</p></div>
    <article className="panel" aria-label="Commercial onboarding workflow">
      <div className="section-heading"><div><p className="eyebrow">Commercial onboarding</p><h3>Step 3 of 3 · Setup & Activation</h3></div><span className="status-chip">Current step</span></div>
      <div className="summary-grid"><Summary label="Step 1" value="Agreements" /><Summary label="Step 2" value="Billing" /><Summary label="Step 3" value="Setup & Activation" /></div>
      <p className="muted">Agreements establish the legal framework. Billing confirms the commercial purchase and settlement. Setup & Activation completes the operational readiness workflow.</p>
    </article>
    {error ? <div className="error-banner compact">{error}</div> : null}
    <button className="secondary-button" disabled={loading} onClick={() => void load()}>Refresh setup status</button>
    {onboarding ? <article className="panel" aria-label="Activation status"><h3>{record(onboarding.activation).operationallyActive === true ? 'SellerTray is ready' : 'Setup & activation'}</h3>
      {array(onboarding.blockers).map((b, i) => <p key={i}>{text(record(b).message)}</p>)}
      {array(record(onboarding.branchSetup).branches).map((b) => { const branch = record(b); return <p key={text(branch.branchId)}><strong>{text(branch.branchName)}</strong> — {text(branch.setupStatus)}</p>; })}
      <p>{text(record(onboarding.nextAction).label)}</p>
      {record(onboarding.activation).guaranteeStart ? <p>One-month guarantee: {formatDate(text(record(onboarding.activation).guaranteeStart))} to {formatDate(text(record(onboarding.activation).guaranteeEnd))}</p> : null}
    </article> : null}
    {message ? <div className="success-banner compact">{message}</div> : null}
    {loading && !state ? <article className="panel"><p className="muted">Loading setup appointments…</p></article> : null}
    {state?.appointments.length ? <div className="page-stack">{state.appointments.map((appointment) => <article className="panel" key={appointment.id}>
      <div className="section-heading"><div><p className="eyebrow">{appointment.branchName}</p><h3>{statusLabel(appointment.status)}</h3></div><span className={`status-chip ${appointment.ready ? 'success' : ''}`}>{appointment.ready ? 'Ready' : statusLabel(appointment.status)}</span></div>
      <div className="summary-grid"><Summary label="Starts" value={formatDate(appointment.scheduledStartAt)} /><Summary label="Ends" value={formatDate(appointment.scheduledEndAt)} /><Summary label="Service area" value={appointment.serviceAreaName || 'Assigned'} /><Summary label="Branch readiness" value={appointment.ready ? `Complete${appointment.readyAt ? ` · ${formatDate(appointment.readyAt)}` : ''}` : 'Pending setup completion'} /></div>
      {appointment.merchantNote ? <p className="muted"><strong>ProcessEdge note:</strong> {appointment.merchantNote}</p> : null}
      {!appointment.ready && appointment.status === 'scheduled' ? appointment.pendingRescheduleRequest ? <div className="info-banner compact">A change request is already pending with ProcessEdge.</div> : <button className="secondary-button" onClick={() => openRequest(appointment)}>Request a different time</button> : null}
      {draft?.appointmentId === appointment.id ? <div className="form-stack"><div className="field-grid two"><label>Preferred start<SellerTrayInput type="datetime-local" value={draft.startLocal} onChange={(event) => setDraft({ ...draft, startLocal: event.target.value })} /></label><label>Preferred end<SellerTrayInput type="datetime-local" value={draft.endLocal} onChange={(event) => setDraft({ ...draft, endLocal: event.target.value })} /></label></div><label>Reason<SellerTrayInput value={draft.note} maxLength={2000} onChange={(event) => setDraft({ ...draft, note: event.target.value })} placeholder="Tell ProcessEdge what needs to change" /></label><div className="button-row"><button className="primary-button" disabled={saving} onClick={() => void submitRequest(appointment)}>{saving ? 'Sending…' : 'Send change request'}</button><button className="secondary-button" disabled={saving} onClick={() => setDraft(null)}>Cancel</button></div></div> : null}
    </article>)}</div> : state && !state.appointments.length ? <article className="panel"><div className="empty-state"><strong>No setup appointment scheduled yet</strong><p>When ProcessEdge schedules a purchased Branch setup, the appointment will appear here.</p></div></article> : null}
  </section>;
}

function Summary({ label, value }: { label: string; value: string }) { return <div><span className="muted">{label}</span><strong>{value}</strong></div>; }
function parseState(value: unknown): ScheduleState {
  const row = record(value);
  return { tenantId: text(row.tenantId), generatedAt: text(row.generatedAt), appointments: array(row.appointments).map((item) => { const v = record(item); return { id: text(v.id), commercialOrderId: text(v.commercialOrderId), branchId: text(v.branchId), branchName: text(v.branchName), scheduledStartAt: text(v.scheduledStartAt), scheduledEndAt: text(v.scheduledEndAt), status: text(v.status), merchantNote: nullableText(v.merchantNote), serviceAreaName: text(v.serviceAreaName), ready: v.ready === true, readyAt: nullableText(v.readyAt), pendingRescheduleRequest: v.pendingRescheduleRequest === true }; }).filter((item) => item.id) };
}
function record(value: unknown): Record<string,unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string,unknown> : {}; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function text(value: unknown): string { return typeof value === 'string' ? value : ''; }
function nullableText(value: unknown): string | null { return typeof value === 'string' && value ? value : null; }
function statusLabel(value: string): string { return ({ scheduled: 'Scheduled', in_progress: 'Setup in progress', completed: 'Setup complete', cancelled: 'Cancelled', no_show: 'Needs rescheduling' } as Record<string,string>)[value] ?? 'Pending'; }
function formatDate(value: string | null | undefined) { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString(); }
function toLocal(value: string): string { const date = new Date(value); const offset = date.getTimezoneOffset() * 60_000; return new Date(date.getTime() - offset).toISOString().slice(0,16); }
function fromLocal(value: string): string | null { const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }
