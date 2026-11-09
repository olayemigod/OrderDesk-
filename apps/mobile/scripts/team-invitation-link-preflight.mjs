import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [appJsonText, linkSource, provisionedSource, authGateSource, businessHookSource] = await Promise.all([
  readFile(path.join(mobileRoot, 'app.json'), 'utf8'),
  readFile(path.join(mobileRoot, 'src/lib/invitationLink.ts'), 'utf8'),
  readFile(path.join(mobileRoot, 'src/ProvisionedApp.tsx'), 'utf8'),
  readFile(path.join(mobileRoot, 'src/components/AuthGate.tsx'), 'utf8'),
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
expect(provisionedSource.includes('<AuthGate hasPendingInvitation={Boolean(invitationLink.invitationId)}>'), 'Mobile must keep the pending invitation visible before authentication');
expect(authGateSource.includes('if (!session && hasPendingInvitation && mode === \'welcome\')'), 'Invited guests must see a dedicated review/signup screen rather than generic welcome');
expect(authGateSource.includes('Create an account to review'), 'New invitees must be offered account creation with invited email');
expect(authGateSource.includes('Use the invited email address to review your pending Business invitation.'), 'Invited sign-in screen must explain the email match requirement');
expect(provisionedSource.includes('Invitation not available to this account'), 'Wrong signed-in identity must not falsely report that an invitation is resolved');
expect(provisionedSource.includes('Sign in with invited email') && provisionedSource.includes("supabase.auth.signOut({ scope: 'local' })"), 'Wrong signed-in identity must have an explicit non-impersonating account switch');
expect(!provisionedSource.includes('This invitation is no longer pending'), 'Missing current-user visibility must not be confused with terminal invitation state');
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
