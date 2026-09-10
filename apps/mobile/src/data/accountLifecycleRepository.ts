import { supabase } from '../lib/supabase';

export type BusinessExport = Record<string, unknown>;

export async function exportBusinessData(tenantId: string): Promise<BusinessExport> {
  const { data, error } = await supabase.functions.invoke('account-lifecycle', {
    body: { action: 'export_business', tenantId },
  });

  if (error) throw new Error(await functionError(error, 'Unable to export business data.'));
  if (!isRecord(data) || !isRecord(data.export)) {
    throw new Error('SellerTray returned an invalid business export.');
  }
  return data.export;
}

export async function deleteSellerTrayAccount(password: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('account-lifecycle', {
    body: {
      action: 'delete_account',
      password,
      confirmation: 'DELETE MY SELLERTRAY ACCOUNT',
    },
  });

  if (error) throw new Error(await functionError(error, 'Unable to delete this SellerTray account.'));
  if (!isRecord(data) || data.deleted !== true) {
    throw new Error('SellerTray did not confirm account deletion.');
  }
}

async function functionError(error: unknown, fallback: string): Promise<string> {
  if (isRecord(error) && isRecord(error.context)) {
    const response = error.context as unknown as Response;
    if (typeof response.clone === 'function') {
      try {
        const payload = await response.clone().json() as unknown;
        if (isRecord(payload) && typeof payload.error === 'string' && payload.error) return payload.error;
      } catch {
        // Fall back to the SDK error message below.
      }
    }
  }

  if (isRecord(error) && typeof error.message === 'string' && error.message) return error.message;
  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
