import { useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { invokeJson } from './supabase';

type TemplateFamily = 'subscription_order' | 'installment_agreement';

type TemplateForm = {
  family: TemplateFamily;
  versionCode: string;
  title: string;
  contentBody: string;
  effectiveFrom: string;
  reason: string;
};

const INITIAL_FORM = (): TemplateForm => ({
  family: 'subscription_order',
  versionCode: '',
  title: '',
  contentBody: '',
  effectiveFrom: localDateTime(new Date()),
  reason: '',
});

export default function OrderFormTemplateAdministration({ session }: { session: Session }) {
  const [form, setForm] = useState<TemplateForm>(INITIAL_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function publish(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    const effectiveFrom = isoFromLocal(form.effectiveFrom);
    if (!form.versionCode.trim() || !form.title.trim() || !form.contentBody.trim()) {
      setError('Order Form version, title and reviewed template content are required.');
      return;
    }
    if (!effectiveFrom || form.reason.trim().length < 6) {
      setError('Enter a valid effective time and a publication reason of at least 6 characters.');
      return;
    }

    setSaving(true);
    try {
      await invokeJson('master-agreements', {
        action: 'admin_publish_order_form_template',
        family: form.family,
        versionCode: form.versionCode.trim(),
        title: form.title.trim(),
        contentBody: form.contentBody,
        effectiveFrom,
        reason: form.reason.trim(),
      }, session);
      setMessage('Reusable Order Form template published as a new immutable version. New eligible purchases will resolve it through the governed zero-touch agreement flow.');
      setForm((current) => ({ ...INITIAL_FORM(), family: current.family }));
    } catch (cause) {
      setError(messageFrom(cause, 'Unable to publish the Order Form template.'));
    } finally {
      setSaving(false);
    }
  }

  return <section className="workspace-panel workspace-form-stack">
    <div className="workspace-panel-heading">
      <div>
        <p className="workspace-eyebrow">Reusable commercial document</p>
        <h2>Order Form templates</h2>
        <p>Publish reusable immutable templates once. SellerTray automatically instantiates the applicable exact Order Form and Agreement Package from governed purchase facts.</p>
      </div>
    </div>
    <div className="workspace-banner info">Zero-touch normal path: ProcessEdge configures reusable Order Form templates here. Do not issue merchant-specific Order Forms manually.</div>
    {error ? <div className="workspace-banner error">{error}</div> : null}
    {message ? <div className="workspace-banner success">{message}</div> : null}
    <form className="workspace-form-stack" onSubmit={publish}>
      <div className="workspace-field-grid two">
        <label>Order Form family<select value={form.family} onChange={(event) => setForm({ ...form, family: event.target.value as TemplateFamily })}><option value="subscription_order">Subscription order</option><option value="installment_agreement">Installment agreement</option></select></label>
        <label>Version code<input maxLength={64} required value={form.versionCode} onChange={(event) => setForm({ ...form, versionCode: event.target.value })} placeholder="e.g. 2026.1" /></label>
        <label>Title<input maxLength={200} required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
        <label>Effective from<input type="datetime-local" required value={form.effectiveFrom} onChange={(event) => setForm({ ...form, effectiveFrom: event.target.value })} /></label>
      </div>
      <label>Reviewed template content<textarea rows={12} maxLength={200000} required value={form.contentBody} onChange={(event) => setForm({ ...form, contentBody: event.target.value })} placeholder="Enter the reviewed reusable Order Form wording. Merchant-specific price, Branch, payment and purchase facts are injected from governed commercial snapshots." /></label>
      <label>Publication reason<input maxLength={1000} required value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} /></label>
      <div className="workspace-banner warning">Publishing creates a new immutable template version. Existing Order Forms, Agreement Packages and merchant confirmations remain historical evidence and are not rewritten.</div>
      <div className="workspace-actions"><button type="submit" className="workspace-button primary" disabled={saving}>{saving ? 'Publishing…' : 'Publish Order Form template'}</button></div>
    </form>
  </section>;
}

function isoFromLocal(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function localDateTime(date: Date): string {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

function messageFrom(value: unknown, fallback: string): string {
  return value instanceof Error && value.message ? value.message : fallback;
}
