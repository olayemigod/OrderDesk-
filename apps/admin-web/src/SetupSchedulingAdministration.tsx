import { useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import MerchantSelector from './MerchantSelector';
import { invokeJson } from './supabase';

type ServiceArea = { id: string; code: string; name: string; active: boolean };
type Worker = { id: string; code: string; name: string; active: boolean; maxConcurrentSetups: number; travelBufferMinutes: number; serviceAreaIds: string[] };
type BranchArea = { branchId: string; branchCode: string; branchName: string; serviceAreaId: string | null };
type SetupSubject = { commercialOrderId: string; branchId: string; branchCode: string; branchName: string; ready: boolean; readyAt: string | null; serviceAreaId: string | null };
type Appointment = { id: string; commercialOrderId: string; branchId: string; branchName: string; workerId: string; workerName: string; serviceAreaId: string; serviceAreaName: string; scheduledStartAt: string; scheduledEndAt: string; status: string; merchantNote: string | null; internalNote: string | null; createdAt: string; completedAt: string | null };
type PendingRequest = { id: string; appointmentId: string; branchId: string; requestedStartAt: string | null; requestedEndAt: string | null; merchantNote: string; requestedAt: string; requestedByUserId: string };
type Center = { canManage: boolean; serviceAreas: ServiceArea[]; workers: Worker[]; branchAreas: BranchArea[]; setupSubjects: SetupSubject[]; appointments: Appointment[]; pendingRequests: PendingRequest[] };
type Response = { ok?: boolean; id?: string; center?: unknown };

type ScheduleDraft = {
  subjectKey: string;
  appointmentId: string | null;
  workerId: string;
  serviceAreaId: string;
  startLocal: string;
  endLocal: string;
  merchantNote: string;
  internalNote: string;
  reason: string;
  rescheduleRequestId: string | null;
};

export default function SetupSchedulingAdministration({ session, initialTenantId }: { session: Session; initialTenantId?: string | null }) {
  const [tenantId, setTenantId] = useState(initialTenantId ?? '');
  const [center, setCenter] = useState<Center | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [areaForm, setAreaForm] = useState({ code: '', name: '', reason: '' });
  const [workerForm, setWorkerForm] = useState({ workerCode: '', displayName: '', maxConcurrentSetups: '1', travelBufferMinutes: '30', serviceAreaIds: [] as string[], reason: '' });
  const [schedule, setSchedule] = useState<ScheduleDraft | null>(null);
  const commandIds = useRef(new Map<string, string>());

  useEffect(() => { if (initialTenantId) setTenantId(initialTenantId); }, [initialTenantId]);
  useEffect(() => { setCenter(null); setSchedule(null); commandIds.current.clear(); if (tenantId) void load(); }, [tenantId]);

  const activeAreas = useMemo(() => center?.serviceAreas.filter((row) => row.active) ?? [], [center]);
  const activeWorkers = useMemo(() => center?.workers.filter((row) => row.active) ?? [], [center]);

  async function invoke(payload: Record<string, unknown>) {
    return await invokeJson<Response>('platform-admin-setup-scheduling', payload, session);
  }

  async function load() {
    if (!tenantId) return;
    setLoading(true); setError(null);
    try {
      const response = await invoke({ action: 'center', tenantId });
      setCenter(parseCenter(response.center));
    } catch (cause) { setError(messageFrom(cause, 'Unable to load governed setup scheduling.')); }
    finally { setLoading(false); }
  }

  async function mutate(key: string, payload: Record<string, unknown>, success: string) {
    if (!tenantId || saving) return;
    setSaving(key); setError(null); setMessage(null);
    try {
      const response = await invoke({ ...payload, tenantId });
      setCenter(parseCenter(response.center)); setMessage(success);
    } catch (cause) { setError(messageFrom(cause, 'Unable to complete the setup scheduling action.')); }
    finally { setSaving(null); }
  }

  function saveArea() {
    if (!areaForm.code.trim() || !areaForm.name.trim() || areaForm.reason.trim().length < 6) return setError('Enter a service area code, name and reason of at least 6 characters.');
    void mutate('area', { action: 'save_service_area', code: areaForm.code, name: areaForm.name, active: true, reason: areaForm.reason }, 'Setup service area saved.');
    setAreaForm({ code: '', name: '', reason: '' });
  }

  function saveWorker() {
    const capacity = Number(workerForm.maxConcurrentSetups); const buffer = Number(workerForm.travelBufferMinutes);
    if (!workerForm.workerCode.trim() || !workerForm.displayName.trim() || !Number.isInteger(capacity) || capacity < 1 || !Number.isInteger(buffer) || buffer < 0 || workerForm.reason.trim().length < 6) return setError('Enter valid worker identity, capacity, travel buffer and reason.');
    void mutate('worker', { action: 'save_worker', workerCode: workerForm.workerCode, displayName: workerForm.displayName, active: true, maxConcurrentSetups: capacity, travelBufferMinutes: buffer, serviceAreaIds: workerForm.serviceAreaIds, reason: workerForm.reason }, 'Setup worker saved.');
    setWorkerForm({ workerCode: '', displayName: '', maxConcurrentSetups: '1', travelBufferMinutes: '30', serviceAreaIds: [], reason: '' });
  }

  function assignArea(branchId: string, serviceAreaId: string) {
    if (!serviceAreaId) return;
    void mutate(`branch-area:${branchId}`, { action: 'assign_branch_area', branchId, serviceAreaId, reason: 'Assign Branch setup service area' }, 'Branch setup service area assigned.');
  }

  function openSchedule(subject: SetupSubject, appointment?: Appointment, request?: PendingRequest) {
    const serviceAreaId = appointment?.serviceAreaId ?? subject.serviceAreaId ?? '';
    const workerId = appointment?.workerId ?? activeWorkers.find((worker) => !serviceAreaId || worker.serviceAreaIds.includes(serviceAreaId))?.id ?? '';
    const start = request?.requestedStartAt ?? appointment?.scheduledStartAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const end = request?.requestedEndAt ?? appointment?.scheduledEndAt ?? new Date(new Date(start).getTime() + 2 * 60 * 60 * 1000).toISOString();
    setSchedule({ subjectKey: key(subject), appointmentId: appointment?.id ?? null, workerId, serviceAreaId, startLocal: toLocal(start), endLocal: toLocal(end), merchantNote: appointment?.merchantNote ?? request?.merchantNote ?? '', internalNote: appointment?.internalNote ?? '', reason: '', rescheduleRequestId: request?.id ?? null });
  }

  function saveSchedule(subject: SetupSubject) {
    if (!schedule || schedule.subjectKey !== key(subject) || !schedule.workerId || !schedule.serviceAreaId || schedule.reason.trim().length < 6) return setError('Choose service area and worker, then enter a scheduling reason of at least 6 characters.');
    const start = fromLocal(schedule.startLocal); const end = fromLocal(schedule.endLocal);
    if (!start || !end || Date.parse(end) <= Date.parse(start)) return setError('Enter a valid appointment start and end time.');
    const commandKey = schedule.appointmentId ? `reschedule:${schedule.appointmentId}` : `schedule:${schedule.subjectKey}`;
    const commandId = commandIds.current.get(commandKey) ?? crypto.randomUUID(); commandIds.current.set(commandKey, commandId);
    const action = schedule.appointmentId ? 'reschedule' : 'schedule';
    void mutate(commandKey, {
      action, commercialOrderId: subject.commercialOrderId, branchId: subject.branchId,
      appointmentId: schedule.appointmentId, workerId: schedule.workerId, serviceAreaId: schedule.serviceAreaId,
      scheduledStartAt: start, scheduledEndAt: end, merchantNote: schedule.merchantNote, internalNote: schedule.internalNote,
      rescheduleRequestId: schedule.rescheduleRequestId, commandId, reason: schedule.reason,
    }, schedule.appointmentId ? 'Branch setup rescheduled.' : 'Branch setup scheduled.').then(() => { commandIds.current.delete(commandKey); setSchedule(null); });
  }

  function transition(appointment: Appointment, status: 'in_progress' | 'completed' | 'cancelled' | 'no_show') {
    const reason = window.prompt(`Reason for ${status.replace('_', ' ')}?`)?.trim() ?? '';
    if (reason.length < 6) return;
    const commandKey = `transition:${appointment.id}:${status}`;
    const commandId = commandIds.current.get(commandKey) ?? crypto.randomUUID(); commandIds.current.set(commandKey, commandId);
    void mutate(commandKey, { action: 'transition', appointmentId: appointment.id, status, commandId, reason, evidence: { source: 'sellertray_admin_web' } }, `Setup appointment ${status.replace('_', ' ')}.`).then(() => commandIds.current.delete(commandKey));
  }

  function declineRequest(request: PendingRequest) {
    const reason = window.prompt('Reason for declining this reschedule request?')?.trim() ?? '';
    if (reason.length < 6) return;
    void mutate(`request:${request.id}`, { action: 'resolve_request', requestId: request.id, decision: 'declined', reason }, 'Reschedule request declined.');
  }

  return <div className="workspace-stack">
    <section className="workspace-panel">
      <div className="workspace-panel-heading"><div><h2>Setup scheduling</h2><p>Schedule ProcessEdge setup work against the exact governed Branch setup obligation. Completion feeds the existing readiness and activation authority.</p></div></div>
      <MerchantSelector session={session} mode="single" selectedIds={tenantId ? new Set([tenantId]) : new Set()} onChange={(next) => setTenantId([...next][0] ?? '')} />
      {error ? <div className="workspace-banner error">{error}</div> : null}
      {message ? <div className="workspace-banner success">{message}</div> : null}
      {loading ? <div className="workspace-banner info">Loading governed scheduling authority…</div> : null}
    </section>

    {center ? <>
      <section className="workspace-panel">
        <div className="workspace-panel-heading"><div><h3>Coverage & capacity</h3><p>Service-area coverage and worker capacity are enforced by the shared scheduling authority, including travel buffers.</p></div></div>
        <div className="workspace-field-grid two"><label>Service area code<input value={areaForm.code} onChange={(e) => setAreaForm({ ...areaForm, code: e.target.value })} /></label><label>Service area name<input value={areaForm.name} onChange={(e) => setAreaForm({ ...areaForm, name: e.target.value })} /></label></div>
        <label>Reason<input value={areaForm.reason} onChange={(e) => setAreaForm({ ...areaForm, reason: e.target.value })} /></label>
        <button type="button" className="workspace-button subtle" disabled={saving !== null} onClick={saveArea}>Add service area</button>
        <div className="workspace-divider" />
        <div className="workspace-field-grid two"><label>Worker code<input value={workerForm.workerCode} onChange={(e) => setWorkerForm({ ...workerForm, workerCode: e.target.value })} /></label><label>Worker name<input value={workerForm.displayName} onChange={(e) => setWorkerForm({ ...workerForm, displayName: e.target.value })} /></label><label>Concurrent setups<input type="number" min={1} max={20} value={workerForm.maxConcurrentSetups} onChange={(e) => setWorkerForm({ ...workerForm, maxConcurrentSetups: e.target.value })} /></label><label>Travel buffer (minutes)<input type="number" min={0} max={480} value={workerForm.travelBufferMinutes} onChange={(e) => setWorkerForm({ ...workerForm, travelBufferMinutes: e.target.value })} /></label></div>
        <div className="workspace-filter-row">{activeAreas.map((area) => <label key={area.id} className="workspace-check-pill"><input type="checkbox" checked={workerForm.serviceAreaIds.includes(area.id)} onChange={() => setWorkerForm((current) => ({ ...current, serviceAreaIds: current.serviceAreaIds.includes(area.id) ? current.serviceAreaIds.filter((id) => id !== area.id) : [...current.serviceAreaIds, area.id] }))} />{area.name}</label>)}</div>
        <label>Reason<input value={workerForm.reason} onChange={(e) => setWorkerForm({ ...workerForm, reason: e.target.value })} /></label>
        <button type="button" className="workspace-button subtle" disabled={saving !== null} onClick={saveWorker}>Add setup worker</button>
      </section>

      <section className="workspace-panel">
        <div className="workspace-panel-heading"><div><h3>Branch setup obligations</h3><p>Each appointment stays linked to its purchased Branch setup line. Ready facts remain immutable.</p></div></div>
        <div className="workspace-table-wrap"><table className="workspace-table compact-table"><thead><tr><th>Branch</th><th>Service area</th><th>Appointment</th><th>Status</th><th>Action</th></tr></thead><tbody>{center.setupSubjects.map((subject) => {
          const appointment = center.appointments.find((item) => item.commercialOrderId === subject.commercialOrderId && item.branchId === subject.branchId && ['scheduled','in_progress'].includes(item.status)) ?? center.appointments.find((item) => item.commercialOrderId === subject.commercialOrderId && item.branchId === subject.branchId && item.status === 'completed');
          const request = appointment ? center.pendingRequests.find((item) => item.appointmentId === appointment.id) : undefined;
          return <tr key={key(subject)}><td><strong>{subject.branchName}</strong><small>{subject.branchCode}</small></td><td>{subject.serviceAreaId ? activeAreas.find((area) => area.id === subject.serviceAreaId)?.name ?? 'Assigned' : <select value="" onChange={(e) => assignArea(subject.branchId, e.target.value)}><option value="">Assign area</option>{activeAreas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select>}</td><td>{appointment ? <><strong>{formatDate(appointment.scheduledStartAt)}</strong><small>{appointment.workerName}</small></> : 'Not scheduled'}</td><td>{subject.ready ? 'Ready' : appointment?.status ?? 'Pending'}</td><td>{subject.ready ? 'Immutable' : appointment ? <div className="workspace-filter-row"><button className="workspace-button subtle compact" onClick={() => openSchedule(subject, appointment, request)}>Reschedule</button>{appointment.status === 'scheduled' ? <button className="workspace-button subtle compact" onClick={() => transition(appointment,'in_progress')}>Start</button> : null}{['scheduled','in_progress'].includes(appointment.status) ? <button className="workspace-button primary compact" onClick={() => transition(appointment,'completed')}>Complete</button> : null}{appointment.status === 'scheduled' ? <button className="workspace-button subtle compact" onClick={() => transition(appointment,'cancelled')}>Cancel</button> : null}</div> : subject.serviceAreaId ? <button className="workspace-button primary compact" onClick={() => openSchedule(subject)}>Schedule</button> : 'Assign area first'}</td></tr>;
        })}</tbody></table></div>
      </section>

      {schedule ? (() => { const subject = center.setupSubjects.find((item) => key(item) === schedule.subjectKey); return subject ? <section className="workspace-panel"><div className="workspace-panel-heading"><div><h3>{schedule.appointmentId ? 'Reschedule' : 'Schedule'} {subject.branchName}</h3><p>Capacity and travel-buffer conflicts are checked transactionally when saved.</p></div></div><div className="workspace-field-grid two"><label>Service area<select value={schedule.serviceAreaId} onChange={(e) => setSchedule({ ...schedule, serviceAreaId: e.target.value, workerId: '' })}><option value="">Choose area</option>{activeAreas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></label><label>Setup worker<select value={schedule.workerId} onChange={(e) => setSchedule({ ...schedule, workerId: e.target.value })}><option value="">Choose worker</option>{activeWorkers.filter((worker) => !schedule.serviceAreaId || worker.serviceAreaIds.includes(schedule.serviceAreaId)).map((worker) => <option key={worker.id} value={worker.id}>{worker.name} · capacity {worker.maxConcurrentSetups}</option>)}</select></label><label>Starts<input type="datetime-local" value={schedule.startLocal} onChange={(e) => setSchedule({ ...schedule, startLocal: e.target.value })} /></label><label>Ends<input type="datetime-local" value={schedule.endLocal} onChange={(e) => setSchedule({ ...schedule, endLocal: e.target.value })} /></label><label>Merchant-visible note<textarea value={schedule.merchantNote} onChange={(e) => setSchedule({ ...schedule, merchantNote: e.target.value })} /></label><label>ProcessEdge internal note<textarea value={schedule.internalNote} onChange={(e) => setSchedule({ ...schedule, internalNote: e.target.value })} /></label></div><label>Reason<input value={schedule.reason} onChange={(e) => setSchedule({ ...schedule, reason: e.target.value })} /></label><div className="workspace-filter-row"><button className="workspace-button primary" disabled={saving !== null} onClick={() => saveSchedule(subject)}>Save appointment</button><button className="workspace-button subtle" onClick={() => setSchedule(null)}>Close</button></div></section> : null; })() : null}

      {center.pendingRequests.length ? <section className="workspace-panel"><div className="workspace-panel-heading"><div><h3>Merchant reschedule requests</h3><p>Requests never alter the appointment directly. ProcessEdge accepts them only through a governed reschedule.</p></div></div>{center.pendingRequests.map((request) => { const appointment = center.appointments.find((item) => item.id === request.appointmentId); const subject = appointment ? center.setupSubjects.find((item) => item.branchId === appointment.branchId && item.commercialOrderId === appointment.commercialOrderId) : undefined; return <article className="workspace-operation-action" key={request.id}><div><strong>{appointment?.branchName ?? 'Branch setup'}</strong><p>{request.merchantNote}</p><small>{request.requestedStartAt ? `${formatDate(request.requestedStartAt)} → ${formatDate(request.requestedEndAt)}` : 'Merchant requested a new appointment time.'}</small></div><div className="workspace-filter-row">{appointment && subject ? <button className="workspace-button primary compact" onClick={() => openSchedule(subject, appointment, request)}>Review & reschedule</button> : null}<button className="workspace-button subtle compact" onClick={() => declineRequest(request)}>Decline</button></div></article>; })}</section> : null}
    </> : null}
  </div>;
}

function parseCenter(value: unknown): Center {
  const row = record(value);
  return {
    canManage: row.canManage === true,
    serviceAreas: array(row.serviceAreas).map((item) => { const v = record(item); return { id: text(v.id), code: text(v.code), name: text(v.name), active: v.active !== false }; }).filter((item) => item.id),
    workers: array(row.workers).map((item) => { const v = record(item); return { id: text(v.id), code: text(v.code), name: text(v.name), active: v.active !== false, maxConcurrentSetups: number(v.maxConcurrentSetups,1), travelBufferMinutes: number(v.travelBufferMinutes,0), serviceAreaIds: array(v.serviceAreaIds).map(text).filter(Boolean) }; }).filter((item) => item.id),
    branchAreas: array(row.branchAreas).map((item) => { const v = record(item); return { branchId: text(v.branchId), branchCode: text(v.branchCode), branchName: text(v.branchName), serviceAreaId: nullableText(v.serviceAreaId) }; }),
    setupSubjects: array(row.setupSubjects).map((item) => { const v = record(item); return { commercialOrderId: text(v.commercialOrderId), branchId: text(v.branchId), branchCode: text(v.branchCode), branchName: text(v.branchName), ready: v.ready === true, readyAt: nullableText(v.readyAt), serviceAreaId: nullableText(v.serviceAreaId) }; }),
    appointments: array(row.appointments).map((item) => { const v = record(item); return { id: text(v.id), commercialOrderId: text(v.commercialOrderId), branchId: text(v.branchId), branchName: text(v.branchName), workerId: text(v.workerId), workerName: text(v.workerName), serviceAreaId: text(v.serviceAreaId), serviceAreaName: text(v.serviceAreaName), scheduledStartAt: text(v.scheduledStartAt), scheduledEndAt: text(v.scheduledEndAt), status: text(v.status), merchantNote: nullableText(v.merchantNote), internalNote: nullableText(v.internalNote), createdAt: text(v.createdAt), completedAt: nullableText(v.completedAt) }; }),
    pendingRequests: array(row.pendingRequests).map((item) => { const v = record(item); return { id: text(v.id), appointmentId: text(v.appointmentId), branchId: text(v.branchId), requestedStartAt: nullableText(v.requestedStartAt), requestedEndAt: nullableText(v.requestedEndAt), merchantNote: text(v.merchantNote), requestedAt: text(v.requestedAt), requestedByUserId: text(v.requestedByUserId) }; }),
  };
}
function key(row: SetupSubject) { return `${row.commercialOrderId}:${row.branchId}`; }
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function text(value: unknown): string { return typeof value === 'string' ? value : ''; }
function nullableText(value: unknown): string | null { return typeof value === 'string' && value ? value : null; }
function number(value: unknown, fallback: number): number { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function formatDate(value: string | null | undefined): string { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString(); }
function toLocal(value: string): string { const date = new Date(value); const offset = date.getTimezoneOffset() * 60_000; return new Date(date.getTime() - offset).toISOString().slice(0,16); }
function fromLocal(value: string): string | null { const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }
function messageFrom(value: unknown, fallback: string): string { if (value instanceof Error && value.message) return value.message; const row = record(value); return typeof row.message === 'string' ? row.message : fallback; }
