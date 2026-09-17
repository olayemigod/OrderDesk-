import { supabase } from '../lib/supabase';

export type CatalogueImportOperation = 'create' | 'update' | 'error';

export type CatalogueImportPreviewRow = {
  rowNumber: number;
  name: string;
  sku: string | null;
  category: string | null;
  price: number;
  aliases: string[];
  imageUrl: string | null;
  operation: CatalogueImportOperation;
  existingItemId: string | null;
  errors: string[];
};

export type CatalogueImportSummary = {
  total: number;
  create: number;
  update: number;
  error: number;
};

export type CatalogueImportPreview = {
  ok: boolean;
  summary: CatalogueImportSummary;
  rows: CatalogueImportPreviewRow[];
};

export type CatalogueImportCommitResult = {
  ok: boolean;
  summary: CatalogueImportSummary;
  result?: {
    created?: number;
    updated?: number;
    total?: number;
  };
};

export async function previewCatalogueImport(
  tenantId: string,
  sourceText: string,
): Promise<CatalogueImportPreview> {
  return invoke({ action: 'preview', tenantId, sourceText }) as Promise<CatalogueImportPreview>;
}

export async function commitCatalogueImport(
  tenantId: string,
  sourceText: string,
): Promise<CatalogueImportCommitResult> {
  return invoke({ action: 'commit', tenantId, sourceText }) as Promise<CatalogueImportCommitResult>;
}

async function invoke(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke('catalogue-bulk-import', { body });
  if (!error) return isRecord(data) ? data : {};

  let message = error.message || 'SellerTray catalogue import failed.';
  if (error.context && typeof error.context === 'object' && 'clone' in error.context) {
    try {
      const payload = await (error.context as Response).clone().json() as { error?: string };
      if (payload?.error) message = payload.error;
    } catch {
      // Keep SDK message.
    }
  }
  throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
