import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [appJsonText, linkSource, provisionedSource, businessHookSource] = await Promise.all([
  readFile(path.join(mobileRoot, 'app.json'), 'utf8'),
  readFile(path.join(mobileRoot, 'src/lib/invitationLink.ts'), 'utf8'),
  readFile(path.join(mobileRoot, 'src/ProvisionedApp.tsx'), 'utf8'),
  readFile(path.join(mobileRoot, 'src/hooks/useBusinesses.ts'), 'utf8'),
]);

const appJson = JSON.parse(appJsonText);
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

const expo = appJson.expo ?? {};
const schemes = Array.isArray(expo.scheme) ? expo.scheme : [expo.scheme].filter(Boolean);
const filters = expo.android?.intentFilters ?? [];
const inviteFilter = filters.find((filter) => Array.isArray(filter?.data) && filter.data.some((entry) =>
  entry?.scheme === 'https' && entry?.host === 'app.sellertray.com' && entry?.pathPrefix === '/invite'));

expect(schemes.includes('sellertray'), 'Mobile must preserve the SellerTray custom deep-link scheme');
expect(inviteFilter?.autoVerify === true, 'Mobile must register the canonical SellerTray invitation HTTPS App Link for verification');
expect(linkSource.includes("sellertray.pendingInvitationId"), 'invitation locator must persist through authentication/restart');
expect(linkSource.includes("Linking.getInitialURL()"), 'cold-start invitation URLs must be captured');
expect(linkSource.includes("Linking.addEventListener('url'"), 'runtime invitation URLs must be captured');
expect(linkSource.includes("app.sellertray.com"), 'only the canonical Merchant Web production origin may be treated as an HTTPS invitation URL');
expect(linkSource.includes("sellertray://") || linkSource.includes("sellertray|orderdesk"), 'custom SellerTray invitation links must be supported');
expect(provisionedSource.includes('useInvitationLink'), 'ProvisionedApp must consume the invitation locator');
expect(provisionedSource.includes("useEffect(() => {\n    let active = true;\n    setLoadedFocusedInvitationId(null);"), 'a newly focused runtime invitation must invalidate the previously loaded invitation snapshot');
expect(provisionedSource.includes("}, [focusedInvitationId, refreshInvitations]);"), 'pending invitations must reload whenever the focused invitation link changes');
expect(provisionedSource.includes('focusedInvitationRefreshing'), 'Mobile must distinguish invitation refresh from a resolved invitation');
expect(provisionedSource.includes('Loading invitation…'), 'Mobile must not report a runtime invitation as resolved while its latest status is loading');
expect(provisionedSource.includes("value === 'staff' ? 'Cashier' : 'Manager'"), 'internal staff role must remain merchant-facing Cashier');
expect(provisionedSource.includes("refresh(decision === 'accept' ? invitation?.tenantId : undefined)"), 'accepted invitation must refresh and prefer the newly joined Business');
expect(provisionedSource.includes('Your other Businesses and sign-in stay unchanged.'), 'multi-Business acceptance copy must preserve the one-identity model');
expect(businessHookSource.includes('preferredBusinessId'), 'Business refresh must support a newly accepted preferred Business without replacing memberships');

if (failures.length) {
  console.error('SellerTray Mobile invitation-link preflight failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('SellerTray Mobile invitation-link preflight passed.');
