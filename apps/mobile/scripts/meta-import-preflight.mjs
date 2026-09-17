import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const mobileRoot = process.cwd();
const repoRoot = resolve(mobileRoot, '../..');
const failures = [];

function read(path) {
  return readFileSync(path, 'utf8');
}

function requireValue(condition, message) {
  if (!condition) failures.push(message);
}

const metaImportFunction = read(join(repoRoot, 'supabase/functions/meta-catalogue-import/index.ts'));
const metaImportMigration = read(join(repoRoot, 'supabase/migrations/20260917025500_meta_catalogue_import_apply.sql'));
const metaImportRepository = read(join(mobileRoot, 'src/data/metaCatalogueImportRepository.ts'));
const metaImportUi = read(join(mobileRoot, 'src/components/MetaCatalogueImport.tsx'));
const catalogueBulkImport = read(join(mobileRoot, 'src/components/CatalogueBulkImport.tsx'));

requireValue(
  metaImportFunction.includes("body.action === 'preview'") &&
    metaImportFunction.includes("body.action === 'commit'") &&
    metaImportFunction.includes('previewFingerprint') &&
    metaImportFunction.includes('fingerprint !== expectedFingerprint'),
  'Meta catalogue import must remain preview-first and fingerprint-verified at commit',
);

requireValue(
  metaImportFunction.includes("'business_management', 'catalog_management'") &&
    metaImportFunction.includes('business_integration_system_user') &&
    metaImportFunction.includes('whatsapp_management_probe_events'),
  'Meta catalogue import must remain gated by tenant-owned credentials, scopes and management readiness',
);

requireValue(
  metaImportFunction.includes("'/products'") &&
    metaImportFunction.includes('retailer_id,name,price,currency,image_url') &&
    metaImportFunction.includes('MAX_PRODUCTS = 500') &&
    metaImportFunction.includes('currencyExponent') &&
    metaImportFunction.includes('same name') &&
    metaImportFunction.includes('preserve_manual'),
  'Meta import must retain bounded product reads, currency normalization and conservative matching',
);

requireValue(
  metaImportMigration.includes('apply_sellertray_meta_catalogue_import') &&
    metaImportMigration.includes('to service_role') &&
    metaImportMigration.includes('is_active=v_is_active') &&
    metaImportMigration.includes("v_mapping_source='manual'") &&
    metaImportMigration.includes("sync_mode='import_from_meta'"),
  'Meta catalogue apply must remain service-role-only, availability-aware and manual-mapping safe',
);

requireValue(
  metaImportRepository.includes("supabase.functions.invoke('meta-catalogue-import'") &&
    metaImportUi.includes('Preview Meta catalogue') &&
    metaImportUi.includes('Import ') &&
    metaImportUi.includes('Same-name products are never merged automatically') &&
    catalogueBulkImport.includes('<MetaCatalogueImport {...props} />'),
  'Catalogue bulk import UI must retain the governed Meta preview/commit path',
);

if (failures.length) {
  console.error('SellerTray Meta import preflight failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('SellerTray Meta catalogue import preflight passed.');
