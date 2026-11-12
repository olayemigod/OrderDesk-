import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const merchantRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(merchantRoot, '../..');
const [source, authEmailSource, inviteHtml, inviteJs, inviteCss, incomingInvitationsSource, merchantAppSource, merchantAuthSource, portalRootSource] = await Promise.all([
  readFile(path.join(repoRoot, 'supabase/functions/team-management/index.ts'), 'utf8'),
  readFile(path.join(repoRoot, 'supabase/functions/send-auth-email/index.ts'), 'utf8'),
  readFile(path.join(merchantRoot, 'public/invite.html'), 'utf8'),
  readFile(path.join(merchantRoot, 'public/invite.js'), 'utf8'),
  readFile(path.join(merchantRoot, 'public/invite.css'), 'utf8'),
  readFile(path.join(merchantRoot, 'src/IncomingBusinessInvitations.tsx'), 'utf8'),
  readFile(path.join(merchantRoot, 'src/MerchantApp.tsx'), 'utf8'),
  readFile(path.join(merchantRoot, 'src/MerchantAuth.tsx'), 'utf8'),
  readFile(path.join(merchantRoot, 'src/MerchantPortalRoot.tsx'), 'utf8'),
]);

const failures = [];
function expect(condition, message) {
  if (!condition) failures.push(message);
}

const configGuard = source.indexOf('if (!RESEND_API_KEY || !TEAM_INVITE_EMAIL_FROM)');
const inviteRpc = source.indexOf("const result = await rpc<JsonRecord>('invite_orderdesk_team_member'");
const emailSend = source.indexOf('await sendTeamInvitationEmail({');
const successResponse = source.indexOf("return json({ result, emailDelivery: 'sent' }, 201)");

expect(source.includes("Deno.env.get('RESEND_API_KEY')"), 'team invitations must use the configured Resend provider');
expect(source.includes("Deno.env.get('SELLERTRAY_EMAIL_FROM')"), 'team invitations must prefer the SellerTray sender configuration');
expect(source.includes("Deno.env.get('TEAM_INVITE_EMAIL_FROM')"), 'team invitation sender must retain backward-compatible configured-address fallback');
expect(source.includes('function sellerTraySender(value: string)'), 'team invitation sender must normalize the visible sender identity');
expect(source.includes('`SellerTray <${address}>`'), 'team invitation sender must display SellerTray rather than ProcessEdge');
expect(configGuard >= 0 && inviteRpc >= 0 && configGuard < inviteRpc, 'known email configuration failures must fail before creating or refreshing an invitation');
expect(inviteRpc >= 0 && emailSend > inviteRpc, 'the governed invitation record must be created before attempting external email delivery');
expect(emailSend >= 0 && successResponse > emailSend, 'the API must report invitation success only after email delivery succeeds');
expect(source.includes("fetch('https://api.resend.com/emails'"), 'team invitations must call the existing Resend transport');
expect(source.includes('Invitation is pending, but the email could not be delivered.'), 'post-write delivery failures must report the pending invitation state explicitly');
expect(source.includes('the existing pending invitation will be reused'), 'delivery failure copy must tell merchants that retry reuses the pending invitation');
expect(source.includes("subject: `${subjectBusinessName} invited you to SellerTray`"), 'email subjects must use the normalized Business name');
expect(source.includes('function cleanEmailHeader(value: string)'), 'merchant-controlled Business names must be normalized before entering email headers');
expect(source.includes('const invitationId = cleanUuid(result.invitationId)'), 'email links must be bound to the governed invitation locator returned by the database authority');
expect(source.includes('/invite.html?invitation=${encodeURIComponent(invitationId)}'), 'email CTA must use the canonical invitation-specific browser/app smart link');
expect(source.includes('>Review invitation</a>'), 'invitation CTA must say Review invitation');
expect(source.includes('Access starts only after you review and accept this invitation.'), 'email copy must preserve explicit invitation acceptance');
expect(source.includes('The invitation expires after 7 days.'), 'email copy must communicate the governed invitation expiry');
expect(source.includes('https://sellertray.com/privacy'), 'invitation email must use the canonical SellerTray privacy origin');
expect(source.includes('https://sellertray.com/terms'), 'invitation email must use the canonical SellerTray terms origin');
expect(!source.includes('SellerTray by ProcessEdge</p>'), 'ProcessEdge must not be the primary invitation-email brand identity');
expect(!source.includes('inviteUserByEmail'), 'business invitation delivery must not bypass SellerTray membership acceptance through Supabase Auth admin invites');

expect(authEmailSource.includes("Deno.env.get('SELLERTRAY_EMAIL_FROM')"), 'authentication emails must prefer the same SellerTray sender configuration');
expect(authEmailSource.includes('function sellerTraySender(value: string)'), 'authentication emails must normalize the visible sender identity');
expect(authEmailSource.includes('`SellerTray <${address}>`'), 'authentication emails must display SellerTray rather than ProcessEdge');
expect(authEmailSource.includes("'https://app.sellertray.com'"), 'authentication email fallback redirect must use canonical Merchant Web');
expect(authEmailSource.includes('https://sellertray.com/privacy'), 'authentication email footer must use canonical SellerTray privacy');
expect(authEmailSource.includes('https://sellertray.com/terms'), 'authentication email footer must use canonical SellerTray terms');
expect(!authEmailSource.includes('SellerTray by ProcessEdge</p>'), 'authentication emails must not use ProcessEdge as primary brand identity');

expect(inviteHtml.includes('Review your SellerTray invitation'), 'browser fallback must present a SellerTray invitation review surface');
expect(inviteHtml.includes('Open SellerTray app'), 'browser fallback must expose an app-open action');
expect(inviteHtml.includes('same account'), 'browser fallback must explain the multi-Business identity model');
expect(inviteJs.includes('sellertray://invite/'), 'browser fallback must hand off to the SellerTray custom scheme');
expect(inviteJs.includes('UUID_RE'), 'browser fallback must validate the invitation locator before handoff');
expect(inviteJs.includes('/?invitation='), 'browser fallback must preserve the invitation locator when continuing on Merchant Web');
expect(inviteJs.includes("sellertray.pendingInvitationId"), 'browser fallback must use the governed non-authoritative invitation-locator storage key');
expect(inviteJs.includes('window.localStorage.setItem(PENDING_INVITATION_KEY, invitationId)'), 'browser fallback must persist the invitation locator through signup/auth redirects');
expect(incomingInvitationsSource.includes("sellertray.pendingInvitationId"), 'Merchant Web invitation review must restore the same persisted invitation locator');
expect(incomingInvitationsSource.includes('window.localStorage.getItem(PENDING_INVITATION_KEY)'), 'Merchant Web must restore invitation focus after browser authentication');
expect(incomingInvitationsSource.includes('window.localStorage.removeItem(PENDING_INVITATION_KEY)'), 'Merchant Web must clear the locator after resolution/dismissal');
expect(incomingInvitationsSource.includes('focusedInvitationId === invitationId'), 'Merchant Web must clear only the focused resolved invitation locator');
expect(incomingInvitationsSource.includes("value === 'staff' ? 'Cashier' : 'Manager'"), 'Merchant Web must keep internal staff merchant-facing as Cashier');
expect(incomingInvitationsSource.includes('const [loading, setLoading] = useState(true)'), 'Merchant Web must start invitation review in a loading state');
expect(incomingInvitationsSource.includes('setLoading(true);'), 'Merchant Web must mark every invitation reload as loading');
expect(incomingInvitationsSource.includes('setLoading(false);'), 'Merchant Web must finish the invitation loading state after the server request settles');
expect(incomingInvitationsSource.includes('loading && focusedInvitationId && !error'), 'focused browser invitation must show a loading state while server status is unresolved');
expect(incomingInvitationsSource.includes('!focusedInvitationIsPending && !loading && !error'), 'resolved invitation copy must not appear before a successful invitation fetch completes');
expect(incomingInvitationsSource.includes('Loading invitation…'), 'Merchant Web must explain that invitation status is still being checked');
expect(!inviteHtml.includes('<script>'), 'browser fallback must not require inline script under Merchant Web CSP');
expect(!inviteHtml.includes('<style>'), 'browser fallback must not require inline style under Merchant Web CSP');
expect(inviteCss.length > 0, 'browser fallback must ship self-hosted styles');

// Regression: Production once bundled the review component but never mounted it.
// The recipient could sign in yet could not accept, so the invite stayed pending.
expect(merchantAppSource.includes("import IncomingBusinessInvitations, { pendingInvitationIdFromBrowser } from './IncomingBusinessInvitations'"), 'Production Merchant Web must mount the existing governed invitation review UI');
expect(merchantAppSource.includes('if (!business) return <InvitationAccess') && merchantAppSource.includes('managementBusinesses.length === 0) return <InvitationAccess'), 'Invited users with zero Businesses or Cashier-only membership must be allowed to review invitations');
expect(merchantAppSource.includes('pendingInvitationIdFromBrowser() && <IncomingBusinessInvitations onMembershipChanged={loadBusinesses} />'), 'Existing Owner/Manager users must also be able to review a focused second-Business invitation');
expect(merchantAuthSource.includes('async function createInviteAccount(') && merchantAuthSource.includes('supabase.auth.signUp({') && merchantAuthSource.includes('emailRedirectTo: verificationUrl.toString()') && !merchantAuthSource.slice(merchantAuthSource.indexOf('async function createInviteAccount('), merchantAuthSource.indexOf('async function createBusiness(')).includes("functions.invoke('provision-business'"), 'New invitees must register using the existing verified Auth gate without provisioning a Business');
expect(merchantAuthSource.includes("verificationUrl.searchParams.set('invitation', invitationId)"), 'Sign-up confirmation must preserve the validated invitation locator');
expect(portalRootSource.includes("workspaceState === 'none' && pendingInvitationIdFromBrowser()") && portalRootSource.includes('<IncomingBusinessInvitations onMembershipChanged={() => inspectWorkspace(session)} />'), 'After account verification, the governed Auth portal must show invitation review instead of forced Business creation');
expect(incomingInvitationsSource.includes('export function pendingInvitationIdFromBrowser'), 'Invitation focus must use the existing shared validated browser-locator reader');
expect(incomingInvitationsSource.includes("body: { action, invitationId }"), 'Acceptance/decline must remain server-authoritative');


if (failures.length) {
  console.error('SellerTray team invitation email preflight failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('SellerTray team invitation email preflight passed.');
