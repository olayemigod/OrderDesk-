// QA-only Meta webhook fail-closed controls; Production routing is unchanged.
// Verification of the Test Meta app->phone ownership remains an external gate.
const TEST_HOST = 'iukgsukdoowvnhlfmpml.supabase.co';
const EXPECTED_TEST_APP_ID = '1429945732160146';
const EXPECTED_TEST_PHONE_ID = '1271836092686870';

export function metaTestWebhookConfiguration(supabaseUrl, appId, phoneNumberId) {
  let url;
  try { url = new URL(supabaseUrl); } catch { return { ok: true, isTest: false }; }
  if (url.hostname !== TEST_HOST) return { ok: true, isTest: false };

  const validOrigin = url.protocol === 'https:' && !url.username && !url.password
    && !url.port && url.pathname === '/' && !url.search && !url.hash;
  const validIdentity = appId === EXPECTED_TEST_APP_ID
    && phoneNumberId === EXPECTED_TEST_PHONE_ID;
  return { ok: validOrigin && validIdentity, isTest: true };
}

export function metaTestWebhookPayloadAllowed(configuration, phoneNumberIds) {
  if (!configuration?.ok) return false;
  if (!configuration.isTest) return true;
  return Array.isArray(phoneNumberIds)
    && phoneNumberIds.length > 0
    && phoneNumberIds.every((id) => id === EXPECTED_TEST_PHONE_ID);
}
