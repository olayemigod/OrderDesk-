import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];

function read(path) {
  return readFileSync(join(root, path), 'utf8');
}

function requireValue(condition, message) {
  if (!condition) failures.push(message);
}

const profile = read('src/components/BusinessProfileView.tsx');
const logoRepository = read('src/data/businessLogoRepository.ts');
const support = read('src/components/SettingsHub.tsx');
const reconciliation = read('src/components/PaymentReconciliationPanel.tsx');
const printers = read('src/redesign/PrinterWorkspace.tsx');
const redesign = read('src/redesign/RedesignWorkspace.tsx');
const app = JSON.parse(read('app.json'));

requireValue(!profile.includes('label="Logo URL"'), 'Business Profile must not expose a raw logo URL field');
requireValue(profile.includes('launchImageLibraryAsync'), 'Business Profile must provide native logo selection');
requireValue(profile.includes('uploadBusinessLogo('), 'Business Profile must upload through the governed business-logo helper');
requireValue(profile.includes('backgroundColor: theme.dark.surfaceSubtle'), 'Business Profile dark inputs must use a dark surface');
requireValue(logoRepository.includes("BUSINESS_LOGO_BUCKET = 'business-logos'"), 'Mobile business logos must use the shared business-logos bucket');
requireValue(logoRepository.includes('BUSINESS_LOGO_MAX_BYTES = 5 * 1024 * 1024'), 'Mobile business logos must preserve the shared 5 MB limit');
requireValue(logoRepository.includes('business-logo-'), 'Mobile business-logo objects must use the governed tenant object naming contract');

requireValue(!support.includes('SellerTray support chat uses EXPO_PUBLIC_SUPPORT_CHAT_URL'), 'Support UI must not expose Expo environment variable names');
requireValue(!support.includes('ProcessEdge WhatsApp support conversation'), 'SellerTray support UI must not expose internal fallback wording');
requireValue(support.includes('Live chat opens WhatsApp whenever the in-app support inbox is unavailable'), 'Support UI must explain fallback behavior in merchant-facing language');

requireValue(reconciliation.includes('useSellerTrayAppearance()'), 'Payment Inbox must consume SellerTray appearance state');
requireValue(reconciliation.includes('style={[styles.item, dark && darkStyles.card]}'), 'Payment Inbox payment cards must use a dark surface');
requireValue(reconciliation.includes('dark && darkStyles.metric'), 'Payment Inbox metric cards must use dark surfaces');
requireValue(reconciliation.includes('dark && active && darkStyles.filterButtonActive'), 'Payment Inbox active filters must preserve dark-mode contrast');

requireValue(printers.includes('dark && darkStyles.outlineButton'), 'Printer outline controls must have a dark-mode surface');
requireValue(printers.includes('dark && active && darkStyles.chipActive'), 'Printer chips must preserve selected-state contrast in dark mode');
requireValue(printers.includes('ToggleRow label="Default printer" value={isDefault} onChange={setIsDefault} dark={dark}'), 'Printer toggle labels must receive dark-mode state');
requireValue(printers.includes('style={[styles.copyCard, dark && darkStyles.copyCard]}'), 'Receipt copy cards must use a dark surface');

requireValue(redesign.includes('appearance.dark && active && darkStyles.branchRowActive'), 'Selected Branch row must use a dark selected-state surface');
requireValue(redesign.includes('appearance.dark && darkStyles.branchIcon'), 'Branch selector icon must use a dark-mode surface');

requireValue(app.expo?.android?.versionCode >= 46, 'Android QA build must advance beyond build 45 for these corrections');
requireValue(app.expo?.plugins?.some((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-image-picker' && String(plugin[1]?.photosPermission ?? '').includes('business logo')), 'Photo permission copy must cover business-logo selection');

if (failures.length) {
  console.error('SellerTray Mobile QA regression preflight failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('SellerTray Mobile QA regression preflight passed.');
