import fs from 'node:fs';

const whatsappPath = 'apps/mobile/src/components/WhatsAppConnectionView.tsx';
const saasAppPath = 'apps/mobile/src/SaasApp.tsx';

const whatsapp = fs.readFileSync(whatsappPath, 'utf8');
const unsafeReadinessMatches = whatsapp.match(/connection\?\.readiness\./g) ?? [];
if (unsafeReadinessMatches.length !== 4) {
  throw new Error(`Expected exactly 4 unsafe WhatsApp readiness reads, found ${unsafeReadinessMatches.length}.`);
}
const safeWhatsapp = whatsapp.replaceAll('connection?.readiness.', 'connection?.readiness?.');
if (safeWhatsapp.includes('connection?.readiness.')) {
  throw new Error('Unsafe WhatsApp readiness access remains after patch.');
}
fs.writeFileSync(whatsappPath, safeWhatsapp);

let saasApp = fs.readFileSync(saasAppPath, 'utf8');
const brandImport = "import { SellerTrayBrand } from './components/SellerTrayBrand';\n";
const loadingImport = "import { SellerTrayLoadingScreen } from './components/SellerTrayLoadingScreen';\n";
if (!saasApp.includes(loadingImport)) {
  if (!saasApp.includes(brandImport)) {
    throw new Error('SellerTrayBrand import anchor not found in SaasApp.');
  }
  saasApp = saasApp.replace(brandImport, `${brandImport}${loadingImport}`);
}

const startupLoadingPattern = /  if \(businessesLoading && !activeBusiness\) \{\n    return \(\n      <SafeAreaView style=\{styles\.centered\}>\n        <ActivityIndicator size="large" \/>\n        <Text style=\{styles\.muted\}>Opening SellerTray[^<]*<\/Text>\n      <\/SafeAreaView>\n    \);\n  \}/;
if (!startupLoadingPattern.test(saasApp)) {
  throw new Error('Expected white SellerTray startup loading screen was not found.');
}
saasApp = saasApp.replace(
  startupLoadingPattern,
  '  if (businessesLoading && !activeBusiness) {\n    return <SellerTrayLoadingScreen message="Opening SellerTray…" />;\n  }',
);
fs.writeFileSync(saasAppPath, saasApp);

console.log('Applied SellerTray WhatsApp readiness and branded loading follow-up.');
