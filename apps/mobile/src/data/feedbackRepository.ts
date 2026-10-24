import { supabase } from '../lib/supabase';

export type SellerTrayFeedbackType = 'general' | 'experience' | 'feature_request' | 'problem';

export type SellerTrayFeedbackState = {
  hasSubmitted: boolean;
  submissionCount: number;
  latestSubmittedAt: string | null;
};

export async function loadSellerTrayFeedbackState(tenantId: string): Promise<SellerTrayFeedbackState> {
  if (!tenantId) return { hasSubmitted: false, submissionCount: 0, latestSubmittedAt: null };
  const { data, error } = await supabase.rpc('sellertray_feedback_state', { p_tenant_id: tenantId });
  if (error) throw error;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('SellerTray returned an invalid feedback status.');
  }
  const row = data as Record<string, unknown>;
  const submissionCount = Number(row.submissionCount ?? 0);
  return {
    hasSubmitted: row.hasSubmitted === true,
    submissionCount: Number.isFinite(submissionCount) ? Math.max(0, Math.trunc(submissionCount)) : 0,
    latestSubmittedAt: typeof row.latestSubmittedAt === 'string' ? row.latestSubmittedAt : null,
  };
}

export async function submitSellerTrayFeedback(input: {
  tenantId: string;
  branchId?: string | null;
  feedbackType: SellerTrayFeedbackType;
  rating?: number | null;
  message: string;
  appVersion?: string | null;
  platform?: string | null;
  context?: Record<string, unknown>;
}): Promise<string> {
  const message = input.message.trim();
  if (!input.tenantId) throw new Error('Business is required.');
  if (!message) throw new Error('Tell us what you would like SellerTray to improve.');
  if (message.length > 4000) throw new Error('Feedback must be 4,000 characters or less.');
  if (input.rating !== null && input.rating !== undefined && (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5)) {
    throw new Error('Choose a rating from 1 to 5.');
  }

  const { data, error } = await supabase.rpc('submit_sellertray_feedback', {
    p_tenant_id: input.tenantId,
    p_branch_id: input.branchId ?? null,
    p_feedback_type: input.feedbackType,
    p_rating: input.rating ?? null,
    p_message: message,
    p_app_version: input.appVersion?.trim() || null,
    p_platform: input.platform?.trim() || null,
    p_context: input.context ?? {},
  });
  if (error) throw error;
  if (typeof data !== 'string') throw new Error('SellerTray did not confirm your feedback.');
  return data;
}
