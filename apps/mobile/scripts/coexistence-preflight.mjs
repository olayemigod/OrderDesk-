import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const mobileRoot = process.cwd();
const repoRoot = resolve(mobileRoot, '../..');
const repository = readFileSync(join(mobileRoot, 'src/data/whatsappConnectionRepository.ts'), 'utf8');
const view = readFileSync(join(mobileRoot, 'src/components/WhatsAppConnectionView.tsx'), 'utf8');
const functionSource = readFileSync(join(repoRoot, 'supabase/functions/whatsapp-coexistence-connect/index.ts'), 'utf8');
const failures = [];

function requireValue(condition, message) {
  if (!condition) failures.push(message);
}

requireValue(
  repository.includes('phoneNumberId: string | null') &&
    repository.includes("onboardingMethod: 'embedded_signup' | 'coexistence'") &&
    repository.includes("onboardingMethod === 'coexistence' && !input.phoneNumberId") &&
    repository.includes("invokeFunction('whatsapp-coexistence-connect'") &&
    repository.includes("onboardingMethod !== 'coexistence' && !phoneNumberId"),
  'Mobile callback must allow a missing phone ID only for a verified coexistence completion event',
);

requireValue(
  functionSource.includes('resolveSingleAuthorizedPhone') &&
    functionSource.includes('phones.length !== 1') &&
    functionSource.includes('SellerTray cannot guess') &&
    functionSource.includes("p_onboarding_method: 'coexistence'") &&
    functionSource.includes('set_sellertray_whatsapp_granted_scopes') &&
    functionSource.includes("{ name: 'AES-GCM', iv }") &&
    functionSource.includes("'/subscribed_apps'") &&
    functionSource.includes("'/phone_numbers'") &&
    functionSource.includes('loadConnectionStatus'),
  'Phone-less coexistence completion must resolve exactly one WABA number, preserve encrypted credential/scopes, subscribe webhooks and reuse readiness verification',
);

requireValue(
  functionSource.includes("['whatsapp_business_management', 'whatsapp_business_messaging']") &&
    functionSource.includes('token was issued for a different application'),
  'Coexistence token exchange must retain application and WhatsApp permission validation',
);

requireValue(
  view.includes('onboardingMethod: callback.onboardingMethod') &&
    view.includes("onboardingMethod === 'coexistence'") &&
    view.includes('Coexistence is active'),
  'WhatsApp settings UI must pass and surface coexistence provenance',
);

if (failures.length) {
  console.error('SellerTray coexistence preflight failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('SellerTray Meta coexistence preflight passed.');
