import { supabase } from '../lib/supabase';

export type MetaCatalogueImportOperation =
  | 'create'
  | 'update'
  | 'link'
  | 'preserve_manual'
  | 'error';

export type MetaCatalogueImportRow = {
  metaProductId: string | null;
  retailerId: string;
  name: string;
  price: number;
  currency: string;
  category: string | null;
  imageUrl: string | null;
  availability: string | null;
  isActive: boolean;
  operation: MetaCatalogueImportOperation;
  existingItemId: string | null;
  errors: string[];
};

export type MetaCatalogueImportSummary = {
  total: number;
  create: number;
  update: number;
  link: number;
  preserveManual: number;
  inactive: number;
  error: number;
};

export type MetaCatalogueImportPreview = {
  ok: boolean;
  catalog: {
    id: string;
    name: string | null;
    vertical: string | null;
    currency: string;
  };
  summary: MetaCatalogueImportSummary;
  fingerprint: string;
  rows: MetaCatalogueImportRow[];
};

export type MetaCatalogueImportCommit = {
  ok: boolean;
  catalog: { id: string; name: string | null };
  summary: MetaCatalogueImportSummary;
  result: {
    created?: number;
    updated?: number;
    linked?: number;
    preservedManual?: number;
    total?: number;
  } | null;
};

export async function previewMetaCatalogueImport(
  tenantId: string,
): Promise<MetaCatalogueImportPreview> {
  return invoke({ action: 'preview', tenantId });
}

export async function commitMetaCatalogueImport(
  tenantId: string,
  previewFingerprint: string,
): Promise<MetaCatalogueImportCommit> {
  return invoke({ action: 'commit', tenantId, previewFingerprint });
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('meta-catalogue-import', { body });
  if (!error) return data as T;

  let message = error.message || 'SellerTray Meta catalogue import failed.';
  if (error.context && typeof error.context === 'object' && 'clone' in error.context) {
    try {
      const payload = await (error.context as Response).clone().json() as { error?: string };
      if (payload?.error) message = payload.error;
    } catch {
      // Keep the SDK error message.
    }
  }
  throw new Error(message);
}
