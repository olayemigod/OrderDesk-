import { supabase } from '../lib/supabase';

export type BusinessExport = Record<string, unknown>;

export const SELLERTRAY_TERMS_VERSION = '2026-09-10';
export const SELLERTRAY_PRIVACY_VERSION = '2026-09-10';

export type LegalAcceptanceStatus = {
  accepted: boolean;
  termsVersion: string;
  privacyVersion: string;
  acceptedAt: string | null;
};

export async function getSellerTrayLegalAcceptance(): Promise<LegalAcceptanceStatus> {
  const { data, error } = await supabase.functions.invoke('account-lifecycle', {
    body: { action: 'legal_status' },
  });
  if (error) throw new Error(await functionError(error, 'Unable to check SellerTray legal acceptance.'));
  return parseLegalAcceptance(data);
}

export async function acceptSellerTrayLegal(): Promise<LegalAcceptanceStatus> {
  const { data, error } = await supabase.functions.invoke('account-lifecycle', {
    body: { action: 'accept_legal' },
  });
  if (error) throw new Error(await functionError(error, 'Unable to record SellerTray legal acceptance.'));
  return parseLegalAcceptance(data);
}

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

function parseLegalAcceptance(data: unknown): LegalAcceptanceStatus {
  if (!isRecord(data) || typeof data.accepted !== 'boolean') {
    throw new Error('SellerTray returned an invalid legal acceptance status.');
  }
  return {
    accepted: data.accepted,
    termsVersion: typeof data.termsVersion === 'string' ? data.termsVersion : SELLERTRAY_TERMS_VERSION,
    privacyVersion: typeof data.privacyVersion === 'string' ? data.privacyVersion : SELLERTRAY_PRIVACY_VERSION,
    acceptedAt: typeof data.acceptedAt === 'string' ? data.acceptedAt : null,
  };
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
