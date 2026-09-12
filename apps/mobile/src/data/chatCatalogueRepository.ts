import { supabase } from '../lib/supabase';

export type ChatCatalogueCandidate = {
  id: string;
  status: 'pending';
  suggested_name: string | null;
  suggested_category: string | null;
  suggested_price_ngn: number | string | null;
  catalog_item_id: string | null;
  created_at: string;
};

export type ChatCatalogueCapture = {
  mediaId: string;
  inboundMessageId: string;
  customerId: string;
  customerName: string | null;
  customerWaId: string | null;
  caption: string | null;
  mimeType: string | null;
  expiresAt: string;
  createdAt: string;
  previewUrl: string | null;
  candidate: ChatCatalogueCandidate | null;
};

export async function loadChatCatalogueCaptures(tenantId: string): Promise<ChatCatalogueCapture[]> {
  const data = await invoke({ action: 'list_captures', tenantId });
  return Array.isArray(data?.captures) ? data.captures : [];
}

export async function previewChatCatalogueCapture(
  tenantId: string,
  inboundMessageId: string,
): Promise<string> {
  const data = await invoke({ action: 'preview_capture', tenantId, inboundMessageId });
  if (!data?.previewUrl) throw new Error('SellerTray could not create a private image preview.');
  return String(data.previewUrl);
}

export async function createChatCatalogueCandidate(
  tenantId: string,
  inboundMessageId: string,
): Promise<ChatCatalogueCandidate> {
  const data = await invoke({ action: 'create_candidate', tenantId, inboundMessageId });
  if (!data?.candidate?.id) throw new Error('SellerTray could not create a catalogue review candidate.');
  return data.candidate as ChatCatalogueCandidate;
}

export async function convertChatCatalogueCandidate(
  tenantId: string,
  candidateId: string,
  input: { name: string; sku?: string | null; category?: string | null; priceNgn: number },
): Promise<{ catalogItemId: string; imageUrl: string }> {
  const data = await invoke({
    action: 'convert_candidate',
    tenantId,
    candidateId,
    name: input.name,
    sku: input.sku ?? null,
    category: input.category ?? null,
    priceNgn: input.priceNgn,
  });

  if (!data?.catalogItemId || !data?.imageUrl) {
    throw new Error('SellerTray could not publish the reviewed WhatsApp product.');
  }
  return { catalogItemId: String(data.catalogItemId), imageUrl: String(data.imageUrl) };
}

export async function rejectChatCatalogueCandidate(
  tenantId: string,
  candidateId: string,
  reviewNote?: string | null,
): Promise<void> {
  await invoke({
    action: 'reject_candidate',
    tenantId,
    candidateId,
    reviewNote: reviewNote?.trim() || null,
  });
}

async function invoke(body: Record<string, unknown>): Promise<any> {
  const { data, error } = await supabase.functions.invoke('catalogue-from-chat', { body });
  if (!error) return data;

  let message = error.message || 'SellerTray catalogue-from-chat request failed.';
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
