import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const main = read('src/main.tsx');
const gate = read('src/MerchantPortalRoot.tsx');
const auth = read('src/MerchantAuth.tsx');
const supabase = read('src/supabase.ts');
const failures = [];
const requireValue = (condition, message) => { if (!condition) failures.push(message); };

requireValue(main.includes("import MerchantApp from './MerchantApp'") && main.includes('<MerchantPortalRoot>') && main.includes('<MerchantApp />'), 'Merchant Web must preserve the governed MerchantApp behind the shared auth gate.');
requireValue(gate.includes('supabase.auth.getSession()') && gate.includes('supabase.auth.getUser(nextSession.access_token)') && gate.includes("rpc('sellertray_list_businesses_for_current_user')"), 'Portal entry must verify the server-side Auth identity and governed Business membership before opening management.');
requireValue(auth.includes('signInWithPassword') && auth.includes('supabase.auth.getUser(result.data.session.access_token)'), 'Password login must verify the returned session with Supabase Auth before admitting the merchant workspace.');
requireValue(auth.includes('resetPasswordForEmail') && auth.includes("merchantPortalUrl('reset-password')") && auth.includes('supabase.auth.updateUser({ password })'), 'Forgot Password and Reset Password must use the shared Supabase Auth recovery lifecycle.');
requireValue(auth.includes('If an account exists for that email') && !auth.includes('User not found'), 'Forgot Password response must avoid account enumeration.');
requireValue(auth.includes("supabase.auth.signUp") && auth.includes("functions.invoke('provision-business'") && auth.includes('Create My Business'), 'Create My Business must use Auth plus the governed provision-business server boundary.');
requireValue(auth.includes('aria-pressed={visible}') && auth.includes("type={visible ? 'text' : 'password'}") && auth.includes("visible ? 'Hide' : 'Show'"), 'Password fields must expose an accessible Show/Hide Password control.');
requireValue(auth.includes("url.searchParams.set('auth', mode)") && auth.includes('new URL(window.location.href)'), 'Auth redirects must preserve the live portal origin/path so Vercel and custom-domain entrypoints use the same flow.');
requireValue(supabase.includes('persistSession: true') && supabase.includes('autoRefreshToken: true') && supabase.includes('detectSessionInUrl: true'), 'Merchant Web must retain one persisted shared Supabase Auth session with recovery URL detection.');
requireValue(![main, gate, auth, supabase].join('\n').match(/SERVICE_ROLE|SUPABASE_SERVICE_ROLE_KEY|sb_secret_/), 'Merchant Web authentication must never expose service-role credentials.');

if (failures.length) {
  console.error('SellerTray Merchant Web auth-management preflight failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('SellerTray Merchant Web auth-management preflight passed.');
