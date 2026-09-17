import { supabase } from '../lib/supabase';

export type WhatsAppCatalogueSettings = {
  tenant_id: string;
  catalog_id: string;
  catalog_name: string | null;
  sync_mode: 'manual_mapping' | 'import_from_meta';
  is_enabled: boolean;
  last_sync_at: string | null;
  last_sync_status: 'never' | 'success' | 'error';
  last_sync_error: string | null;
  updated_at: string;
};

export type WhatsAppCatalogueImportReadiness = {
  connected: boolean;
  tenantCredentialReady: boolean;
  managementApiReady: boolean;
  catalogConfigured: boolean;
  importReady: boolean;
  reason: string | null;
  managementEvidence: string | null;
  managementCheckedAt: string | null;
};

export type WhatsAppCatalogueStatus = {
  role: string;
  settings: WhatsAppCatalogueSettings | null;
  importReadiness?: WhatsAppCatalogueImportReadiness;
  mappedItems: Array<{
    id: string;
    name: string;
    sku: string | null;
    price_ngn: number | string | null;
    is_active: boolean;
    whatsapp_catalog_id: string | null;
    whatsapp_product_retailer_id: string | null;
    whatsapp_mapping_source: 'manual' | 'meta_import' | null;
    whatsapp_last_synced_at: string | null;
  }>;
};

export async function loadWhatsAppCatalogueStatus(tenantId: string): Promise<WhatsAppCatalogueStatus> {
  return invoke({ action: 'status', tenantId });
}

export async function configureWhatsAppCatalogue(
  tenantId: string,
  input: { catalogId: string; catalogName?: string | null; enabled?: boolean },
): Promise<void> {
  await invoke({
    action: 'configure',
    tenantId,
    catalogId: input.catalogId.trim(),
    catalogName: input.catalogName?.trim() || null,
    syncMode: 'manual_mapping',
    isEnabled: input.enabled !== false,
  });
}

export async function mapWhatsAppCatalogueItem(
  tenantId: string,
  catalogItemId: string,
  catalogId: string,
  productRetailerId: string,
): Promise<void> {
  await invoke({
    action: 'map_item',
    tenantId,
    catalogItemId,
    catalogId,
    productRetailerId: productRetailerId.trim(),
  });
}

export async function unmapWhatsAppCatalogueItem(
  tenantId: string,
  catalogItemId: string,
): Promise<void> {
  await invoke({ action: 'unmap_item', tenantId, catalogItemId });
}

async function invoke(body: Record<string, unknown>): Promise<any> {
  const { data, error } = await supabase.functions.invoke('whatsapp-catalog', { body });
  if (!error) return data;

  let message = error.message || 'SellerTray WhatsApp catalogue request failed.';
  if (error.context && typeof error.context === 'object' && 'clone' in error.context) {
    try {
      const payload = await (error.context as Response).clone().json() as { error?: string };
      if (payload?.error) message = payload.error;
    } catch {
      // Keep the SDK message.
    }
  }
  throw new Error(message);
}
