import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const merchantRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(merchantRoot, '../..');
const source = await readFile(path.join(repoRoot, 'supabase/functions/team-management/index.ts'), 'utf8');

const failures = [];
function expect(condition, message) {
  if (!condition) failures.push(message);
}

const configGuard = source.indexOf('if (!RESEND_API_KEY || !TEAM_INVITE_EMAIL_FROM)');
const inviteRpc = source.indexOf("const result = await rpc<JsonRecord>('invite_orderdesk_team_member'");
const emailSend = source.indexOf('await sendTeamInvitationEmail({');
const successResponse = source.indexOf("return json({ result, emailDelivery: 'sent' }, 201)");

expect(source.includes("Deno.env.get('RESEND_API_KEY')"), 'team invitations must use the configured Resend provider');
expect(source.includes("Deno.env.get('TEAM_INVITE_EMAIL_FROM') ?? Deno.env.get('AUTH_EMAIL_FROM')"), 'team invitations must reuse the governed SellerTray sender configuration by default');
expect(configGuard >= 0 && inviteRpc >= 0 && configGuard < inviteRpc, 'known email configuration failures must fail before creating or refreshing an invitation');
expect(inviteRpc >= 0 && emailSend > inviteRpc, 'the governed invitation record must be created before attempting external email delivery');
expect(emailSend >= 0 && successResponse > emailSend, 'the API must report invitation success only after email delivery succeeds');
expect(source.includes("fetch('https://api.resend.com/emails'"), 'team invitations must call the existing Resend transport');
expect(source.includes('Invitation was created, but the email could not be delivered.'), 'post-create delivery failures must report the partial-success state explicitly');
expect(source.includes('the existing pending invitation will be reused'), 'delivery failure copy must tell merchants that retry is idempotent at the invitation level');
expect(source.includes('Access starts only after you accept it.'), 'email copy must preserve explicit invitation acceptance');
expect(source.includes('The invitation expires after 7 days.'), 'email copy must communicate the governed invitation expiry');
expect(!source.includes('inviteUserByEmail'), 'business invitation delivery must not bypass SellerTray membership acceptance through Supabase Auth admin invites');

if (failures.length) {
  console.error('SellerTray team invitation email preflight failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('SellerTray team invitation email preflight passed.');
