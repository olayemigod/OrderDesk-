import { supabase } from '../lib/supabase';

const BUSINESS_LOGO_BUCKET = 'business-logos';
const BUSINESS_LOGO_MAX_BYTES = 5 * 1024 * 1024;
const BUSINESS_LOGO_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export type BusinessLogoUpload = {
  publicUrl: string;
  objectPath: string;
};

export async function uploadBusinessLogo(
  tenantId: string,
  uri: string,
  mimeType = 'image/jpeg',
): Promise<BusinessLogoUpload> {
  const cleanTenantId = tenantId.trim();
  if (!cleanTenantId) throw new Error('SellerTray could not identify this business.');

  const safeMime = mimeType.trim().toLowerCase();
  if (!BUSINESS_LOGO_MIME_TYPES.has(safeMime)) {
    throw new Error('Business logo must be a PNG, JPG, or WebP image.');
  }

  const response = await fetch(uri);
  if (!response.ok) throw new Error('SellerTray could not read the selected business logo.');
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength === 0) throw new Error('The selected business logo is empty.');
  if (bytes.byteLength > BUSINESS_LOGO_MAX_BYTES) {
    throw new Error('Choose a business logo that is 5 MB or smaller.');
  }

  const extension = safeMime === 'image/png' ? 'png' : safeMime === 'image/webp' ? 'webp' : 'jpg';
  const objectPath = `${cleanTenantId}/business-logo-${makeUploadToken()}.${extension}`;
  const { error } = await supabase.storage
    .from(BUSINESS_LOGO_BUCKET)
    .upload(objectPath, bytes, {
      contentType: safeMime,
      cacheControl: '3600',
      upsert: false,
    });

  if (error) throw error;

  const { data } = supabase.storage.from(BUSINESS_LOGO_BUCKET).getPublicUrl(objectPath);
  if (!data.publicUrl) {
    await removeBusinessLogo(objectPath).catch(() => undefined);
    throw new Error('SellerTray could not prepare the uploaded business logo.');
  }

  return { publicUrl: data.publicUrl, objectPath };
}

export async function removeBusinessLogo(objectPath: string): Promise<void> {
  const cleanPath = objectPath.trim();
  if (!cleanPath) return;
  const { error } = await supabase.storage.from(BUSINESS_LOGO_BUCKET).remove([cleanPath]);
  if (error) throw error;
}

export function governedBusinessLogoPath(tenantId: string, publicUrl: string | null | undefined): string | null {
  const cleanTenantId = tenantId.trim();
  const cleanUrl = publicUrl?.trim() ?? '';
  if (!cleanTenantId || !cleanUrl) return null;

  const marker = `/storage/v1/object/public/${BUSINESS_LOGO_BUCKET}/`;
  const markerIndex = cleanUrl.indexOf(marker);
  if (markerIndex < 0) return null;

  const encodedPath = cleanUrl.slice(markerIndex + marker.length).split(/[?#]/, 1)[0] ?? '';
  let objectPath = encodedPath;
  try {
    objectPath = decodeURIComponent(encodedPath);
  } catch {
    return null;
  }

  const prefix = `${cleanTenantId}/business-logo-`;
  if (!objectPath.startsWith(prefix)) return null;
  const fileName = objectPath.slice(cleanTenantId.length + 1);
  if (!/^business-logo-[A-Za-z0-9-]+\.(png|jpg|jpeg|webp)$/i.test(fileName)) return null;
  return objectPath;
}

function makeUploadToken(): string {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
}
