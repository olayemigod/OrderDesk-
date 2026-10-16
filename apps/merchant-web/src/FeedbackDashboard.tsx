import { useEffect, useState } from 'react';
import { errorMessage, supabase } from './supabase';

type FeedbackSummary = {
  memberCount: number;
  feedbackUsers: number;
  submissionCount: number;
  newCount: number;
  averageRating: number | null;
};

type FeedbackMember = {
  userId: string;
  displayName: string;
  email: string | null;
  role: string;
  hasSubmitted: boolean;
  submissionCount: number;
  latestSubmittedAt: string | null;
};

type FeedbackSubmission = {
  id: string;
  userId: string;
  displayName: string;
  email: string | null;
  role: string;
  branchId: string | null;
  branchName: string | null;
  feedbackType: string;
  rating: number | null;
  message: string;
  status: string;
  appVersion: string | null;
  platform: string | null;
  createdAt: string;
};

type FeedbackDashboardData = {
  summary: FeedbackSummary;
  members: FeedbackMember[];
  submissions: FeedbackSubmission[];
};

export default function FeedbackDashboard({ tenantId }: { tenantId: string }) {
  const [data, setData] = useState<FeedbackDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void loadDashboard(tenantId)
      .then((next) => { if (active) setData(next); })
      .catch((cause) => { if (active) setError(errorMessage(cause, 'Unable to load feedback.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [tenantId]);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setData(await loadDashboard(tenantId));
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to refresh feedback.'));
    } finally {
      setLoading(false);
    }
  }

  const summary = data?.summary ?? { memberCount: 0, feedbackUsers: 0, submissionCount: 0, newCount: 0, averageRating: null };
  const participation = summary.memberCount > 0 ? Math.round((summary.feedbackUsers / summary.memberCount) * 100) : 0;

  return <div className="page-stack">
    <div className="section-heading">
      <div><p className="eyebrow">Customer voice</p><h2>Feedback</h2></div>
      <div><p className="muted">See who has shared feedback and what the SellerTray team should review.</p><button className="secondary-button" disabled={loading} onClick={() => void refresh()}>{loading ? 'Refreshing' : 'Refresh feedback'}</button></div>
    </div>

    {error ? <div className="error-banner">{error}<button onClick={() => setError(null)}>Dismiss</button></div> : null}

    <div className="metric-grid">
      <Metric label="Participation" value={`${participation}%`} note={`${summary.feedbackUsers} of ${summary.memberCount} team members`} />
      <Metric label="Submissions" value={String(summary.submissionCount)} note={`${summary.newCount} new`} />
      <Metric label="Average rating" value={summary.averageRating === null ? '—' : `${summary.averageRating}/5`} note="Rated submissions only" />
      <Metric label="Still to hear from" value={String(Math.max(0, summary.memberCount - summary.feedbackUsers))} note="Signed-in business members" />
    </div>

    <article className="panel">
      <div className="panel-head"><div><p className="eyebrow">Participation</p><h3>Who has shared feedback</h3></div></div>
      {loading && !data ? <div className="empty-state"><p>Loading feedback participation…</p></div> : data?.members.length ? <div className="table-wrap"><table><thead><tr><th>Team member</th><th>Role</th><th>Status</th><th>Submissions</th><th>Last shared</th></tr></thead><tbody>{data.members.map((member) => <tr key={member.userId}><td><strong>{member.displayName}</strong><br /><span className="muted">{member.email || 'No email'}</span></td><td>{title(member.role)}</td><td><span className={`status-pill ${member.hasSubmitted ? 'good' : ''}`}>{member.hasSubmitted ? 'Shared' : 'Not yet'}</span></td><td>{member.submissionCount}</td><td>{member.latestSubmittedAt ? dateTime(member.latestSubmittedAt) : '—'}</td></tr>)}</tbody></table></div> : <div className="empty-state"><p>No business members found.</p></div>}
    </article>

    <article className="panel">
      <div className="panel-head"><div><p className="eyebrow">Recent submissions</p><h3>What people are saying</h3></div></div>
      {data?.submissions.length ? <div className="table-wrap"><table><thead><tr><th>Submitted</th><th>Team member</th><th>Branch</th><th>Type</th><th>Rating</th><th>Feedback</th><th>Status</th></tr></thead><tbody>{data.submissions.map((entry) => <tr key={entry.id}><td>{dateTime(entry.createdAt)}</td><td><strong>{entry.displayName}</strong><br /><span className="muted">{entry.email || title(entry.role)}</span></td><td>{entry.branchName || 'Business-wide'}</td><td>{title(entry.feedbackType)}</td><td>{entry.rating === null ? '—' : `${entry.rating}/5`}</td><td style={{ maxWidth: 440, whiteSpace: 'normal', lineHeight: 1.5 }}>{entry.message}</td><td><span className={`status-pill ${entry.status === 'new' ? '' : 'good'}`}>{title(entry.status)}</span></td></tr>)}</tbody></table></div> : <div className="empty-state"><div><strong>No feedback yet</strong><p>Feedback submitted from the SellerTray mobile app will appear here.</p></div></div>}
    </article>
  </div>;
}

async function loadDashboard(tenantId: string): Promise<FeedbackDashboardData> {
  const { data, error } = await supabase.rpc('get_sellertray_feedback_dashboard', {
    p_tenant_id: tenantId,
    p_limit: 100,
  });
  if (error) throw error;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('SellerTray returned an invalid feedback dashboard.');
  const row = data as Record<string, unknown>;
  const summary = asRecord(row.summary);
  return {
    summary: {
      memberCount: integer(summary.memberCount),
      feedbackUsers: integer(summary.feedbackUsers),
      submissionCount: integer(summary.submissionCount),
      newCount: integer(summary.newCount),
      averageRating: nullableNumber(summary.averageRating),
    },
    members: Array.isArray(row.members) ? row.members.map(parseMember) : [],
    submissions: Array.isArray(row.submissions) ? row.submissions.map(parseSubmission) : [],
  };
}

function parseMember(value: unknown): FeedbackMember {
  const row = asRecord(value);
  return {
    userId: String(row.userId ?? ''),
    displayName: String(row.displayName ?? 'Team member'),
    email: typeof row.email === 'string' ? row.email : null,
    role: String(row.role ?? 'staff'),
    hasSubmitted: row.hasSubmitted === true,
    submissionCount: integer(row.submissionCount),
    latestSubmittedAt: typeof row.latestSubmittedAt === 'string' ? row.latestSubmittedAt : null,
  };
}

function parseSubmission(value: unknown): FeedbackSubmission {
  const row = asRecord(value);
  return {
    id: String(row.id ?? ''),
    userId: String(row.userId ?? ''),
    displayName: String(row.displayName ?? 'Team member'),
    email: typeof row.email === 'string' ? row.email : null,
    role: String(row.role ?? 'staff'),
    branchId: typeof row.branchId === 'string' ? row.branchId : null,
    branchName: typeof row.branchName === 'string' ? row.branchName : null,
    feedbackType: String(row.feedbackType ?? 'general'),
    rating: nullableNumber(row.rating),
    message: String(row.message ?? ''),
    status: String(row.status ?? 'new'),
    appVersion: typeof row.appVersion === 'string' ? row.appVersion : null,
    platform: typeof row.platform === 'string' ? row.platform : null,
    createdAt: String(row.createdAt ?? ''),
  };
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="metric-card"><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function integer(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || '—';
  return date.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' });
}

function title(value: string): string {
  return value.replaceAll('_', ' ').split(' ').filter(Boolean).map((part) => part[0]!.toUpperCase() + part.slice(1)).join(' ');
}
