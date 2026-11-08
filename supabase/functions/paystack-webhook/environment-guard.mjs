// Platform Paystack billing webhook isolation. Only the two governed hosted
// projects may receive provider events; unknown/local projects fail closed.
// Unlike merchant payment callbacks, this handler uses one platform key.
const LIVE_HOST = 'eujxswjspolugrzlsjnn.supabase.co';
const TEST_HOST = 'iukgsukdoowvnhlfmpml.supabase.co';

export function paystackWebhookModeForProject(supabaseUrl, secretKey) {
  if (typeof supabaseUrl !== 'string' || typeof secretKey !== 'string') return null;
  let url;
  try { url = new URL(supabaseUrl); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) return null;
  const mode = url.hostname === LIVE_HOST ? 'live' : url.hostname === TEST_HOST ? 'test' : null;
  if (!mode) return null;
  const prefix = mode === 'live' ? 'sk_live_' : 'sk_test_';
  // Prefix only establishes key *mode*; real authority is checked by HMAC.
  if (!secretKey.startsWith(prefix) || secretKey.length <= prefix.length + 7) return null;
  return mode;
}

export function paystackWebhookDomainMatches(mode, eventType, dataDomain) {
  if (mode !== 'live' && mode !== 'test') return false;
  // Paystack charge-success transactions normally expose data.domain.
  // Fail closed if that security marker is absent on a charge.
  if (dataDomain == null) return eventType !== 'charge.success';
  // Historical subscription/invoice events can omit this attribute;
  // when present, every event must match the verified platform key/project.
  return typeof dataDomain === 'string' && dataDomain === mode;
}
