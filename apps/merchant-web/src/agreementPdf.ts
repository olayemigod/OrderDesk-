export type VerifiedPdfSource = {
  signedUrl: string;
  pdfSha256: string;
  byteSize: number;
};

export async function fetchVerifiedPdf(source: VerifiedPdfSource): Promise<Uint8Array> {
  const response = await fetch(source.signedUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Agreement PDF download failed (${response.status}).`);

  const buffer = await response.arrayBuffer();
  if (!looksLikePdf(buffer)) throw new Error('SellerTray received an invalid Agreement PDF response.');
  if (source.byteSize > 0 && buffer.byteLength !== source.byteSize) {
    throw new Error('Agreement PDF size did not match the governed document.');
  }

  const actualHash = await sha256Hex(buffer);
  if (actualHash !== source.pdfSha256.toLowerCase()) {
    throw new Error('Agreement PDF integrity verification failed.');
  }
  return new Uint8Array(buffer);
}

function looksLikePdf(bytes: ArrayBuffer): boolean {
  if (bytes.byteLength < 5) return false;
  return String.fromCharCode(...new Uint8Array(bytes, 0, 5)) === '%PDF-';
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}
