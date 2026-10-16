import fs from 'node:fs';

const branchFiles = {
  auth: 'apps/mobile/src/components/AuthGate.tsx',
  legal: 'apps/mobile/src/components/LegalAcceptanceGate.tsx',
  redesign: 'apps/mobile/src/redesign/RedesignWorkspace.tsx',
};

function replaceOnce(path, before, after, label) {
  const source = fs.readFileSync(path, 'utf8');
  const matches = source.split(before).length - 1;
  if (matches !== 1) {
    throw new Error(`${label}: expected exactly one match in ${path}, found ${matches}`);
  }
  fs.writeFileSync(path, source.replace(before, after));
}

function ensureImport(path, anchor, line) {
  const source = fs.readFileSync(path, 'utf8');
  if (source.includes(line)) return;
  if (!source.includes(anchor)) throw new Error(`Import anchor not found in ${path}`);
  fs.writeFileSync(path, source.replace(anchor, `${anchor}\n${line}`));
}

ensureImport(
  branchFiles.auth,
  "import { SellerTrayBrand } from './SellerTrayBrand';",
  "import { SellerTrayLoadingScreen } from './SellerTrayLoadingScreen';",
);
replaceOnce(
  branchFiles.auth,
  `  if (booting) {\n    return (\n      <SafeAreaView style={styles.centered}>\n        <ActivityIndicator size="large" />\n        <Text style={styles.muted}>Opening SellerTray…</Text>\n      </SafeAreaView>\n    );\n  }`,
  `  if (booting) return <SellerTrayLoadingScreen message="Opening SellerTray…" />;`,
  'Auth boot loader',
);

ensureImport(
  branchFiles.legal,
  "import { supabase } from '../lib/supabase';",
  "import { SellerTrayLoadingScreen } from './SellerTrayLoadingScreen';",
);
replaceOnce(
  branchFiles.legal,
  `  if (checking) {\n    return (\n      <SafeAreaView style={[styles.centered, appearance.dark && darkStyles.screen]}>\n        <ActivityIndicator size="large" />\n        <Text style={[styles.muted, appearance.dark && darkStyles.bodyText]}>Checking SellerTray account terms…</Text>\n      </SafeAreaView>\n    );\n  }`,
  `  if (checking) return <SellerTrayLoadingScreen message="Checking SellerTray account terms…" />;`,
  'Legal acceptance loader',
);

ensureImport(
  branchFiles.redesign,
  "import { supabase } from '../lib/supabase';",
  "import { SellerTrayLoadingScreen } from '../components/SellerTrayLoadingScreen';",
);
replaceOnce(
  branchFiles.redesign,
  `  if (!activeBusiness) {\n    return (\n      <View style={[styles.centered, appearance.dark && darkStyles.page]}>\n        <ActivityIndicator />\n        <Text style={[styles.muted, appearance.dark && darkStyles.bodyText]}>Opening your business…</Text>\n      </View>\n    );\n  }`,
  `  if (!activeBusiness) return <SellerTrayLoadingScreen message="Opening your business…" />;`,
  'Business workspace loader',
);

const migrations = [
  [
    'supabase/migrations/20261016043000_pos_partial_return_governance.sql',
    'supabase/migrations/20261016074945_pos_partial_return_governance.sql',
  ],
  [
    'supabase/migrations/20261016053000_purchase_receiving_management_authority.sql',
    'supabase/migrations/20261016075000_purchase_receiving_management_authority.sql',
  ],
  [
    'supabase/migrations/20261016063000_purchase_receiving_command_management_authority.sql',
    'supabase/migrations/20261016075024_purchase_receiving_command_management_authority.sql',
  ],
];

for (const [from, to] of migrations) {
  if (!fs.existsSync(from)) throw new Error(`Missing source migration ${from}`);
  if (fs.existsSync(to)) throw new Error(`Target migration already exists ${to}`);
  fs.renameSync(from, to);
}

fs.rmSync('scripts/finalize-sellertray-qa-build24.mjs');
fs.rmSync('.github/workflows/sellertray-qa-build24-finalize.yml');
