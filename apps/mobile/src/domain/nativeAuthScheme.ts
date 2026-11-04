// Expo's resolved app scheme, not the public EAS slug, owns Auth links.
// Production keeps legacy orderdesk:// deep links; isolated QA accepts ONLY
// sellertray-qa:// so its recovery emails cannot open the installed live app.
export type NativeAppIdentity = {
  name?: string | null;
  scheme?: string | string[] | null;
  android?: { package?: string | null } | null;
  ios?: { bundleIdentifier?: string | null } | null;
} | null | undefined;

const PRODUCTION_PACKAGE = 'ng.processedge.sellertray';
const QA_PACKAGE = 'ng.processedge.sellertray.qa';
const PROD_SCHEMES = ['sellertray', 'orderdesk'] as const;
const QA_SCHEME = 'sellertray-qa';

export function nativeAuthSchemes(identity: NativeAppIdentity): string[] {
  const isQA = identity?.android?.package === QA_PACKAGE
    || identity?.ios?.bundleIdentifier === QA_PACKAGE
    || identity?.name === 'SellerTray QA';
  const raw = identity?.scheme;
  const declared = (Array.isArray(raw) ? raw : raw ? [raw] : [])
    .filter((scheme): scheme is string => typeof scheme === 'string');

  if (isQA) return declared.includes(QA_SCHEME) ? [QA_SCHEME] : [];
  const isProd = !identity || identity.android?.package === PRODUCTION_PACKAGE
    || identity.ios?.bundleIdentifier === PRODUCTION_PACKAGE
    || identity.name === 'SellerTray';
  if (!isProd) return []; // Unknown native app must not claim Production Auth.
  if (declared.length) return PROD_SCHEMES.filter(s => declared.includes(s));
  // Backward-compatible fallback when Expo Go has not populated its manifest.
  return [...PROD_SCHEMES];
}

export function isNativeSellerTrayAuthUrl(url: string, identity: NativeAppIdentity): boolean {
  return nativeAuthSchemes(identity).some(scheme => url.startsWith(`${scheme}://`));
}

export function nativeAuthRedirectUrl(path: 'auth-confirm' | 'reset-password', identity: NativeAppIdentity): string {
  const scheme = nativeAuthSchemes(identity)[0];
  if (!scheme) throw new Error('Authentication deep-link scheme is unavailable for this SellerTray app');
  return `${scheme}://${path}`;
}
