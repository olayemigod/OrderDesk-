// QA-only Meta webhook fail-closed controls; Production routing is unchanged.
// Verification of the Test Meta app->phone ownership remains an external gate.
const TEST_HOST = 'iukgsukdoowvnhlfmpml.supabase.co';
const EXPECTED_TEST_APP_ID = '1429945732160146';
// Read-only Production census on 2026-11-12 found this identifier in BOTH
// tenant_whatsapp_connections and tenants.whatsapp_phone_number_id. A
// disconnected connection row does not prove Meta ownership/callback release.
const LEGACY_PRODUCTION_PHONE_ID = '1271836092686870';
// No non-overlapping QA number is currently provider-attested. Keep Test
// ingress fail-closed until a NEW, distinctly-owned Test phone is independently
// approved and explicitly allowlisted in reviewed source. Do not use an env
// variable alone as a bypass; do not modify Production to satisfy this guard.
const APPROVED_ISOLATED_TEST_PHONE_IDS = Object.freeze([]);
const isApprovedTestPhone = (id) =>
  typeof id === 'string'
  && APPROVED_ISOLATED_TEST_PHONE_IDS.includes(id)
  && id !== LEGACY_PRODUCTION_PHONE_ID;

export function metaTestWebhookConfiguration(supabaseUrl, appId, phoneNumberId) {
  let url;
  try { url = new URL(supabaseUrl); } catch { return { ok: true, isTest: false }; }
  if (url.hostname !== TEST_HOST) return { ok: true, isTest: false };

  const validOrigin = url.protocol === 'https:' && !url.username && !url.password
    && !url.port && url.pathname === '/' && !url.search && !url.hash;
  const validIdentity = appId === EXPECTED_TEST_APP_ID
    && isApprovedTestPhone(phoneNumberId);
  return { ok: validOrigin && validIdentity, isTest: true };
}

export function metaTestWebhookPayloadAllowed(configuration, phoneNumberIds) {
  if (!configuration?.ok) return false;
  if (!configuration.isTest) return true;
  return Array.isArray(phoneNumberIds)
    && phoneNumberIds.length > 0
    && phoneNumberIds.every(isApprovedTestPhone);
}
