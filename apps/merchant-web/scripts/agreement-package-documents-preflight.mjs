import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const repo = path.resolve(root, '../..');
const read = (relative) => fs.readFileSync(path.resolve(root, relative), 'utf8');
const readRepo = (relative) => fs.readFileSync(path.resolve(repo, relative), 'utf8');
const merchant = read('src/CommercialAgreementsManagement.tsx');
const gateway = readRepo('supabase/functions/master-agreements/index.ts');
const pdf = readRepo('supabase/functions/master-agreements/agreement-pdf.ts');
const migration = readRepo('supabase/migrations/20261027170000_agreement_document_artifacts.sql');
const governance = readRepo('.agents/skills/sellertray-project-implementation/AGREEMENTS.md');

const failures = [];
const requireValue = (condition, message) => { if (!condition) failures.push(message); };

requireValue(
  merchant.includes("artifactKind: 'review_pdf' | 'executed_pdf'")
    && merchant.includes('Prepare Agreement PDF')
    && merchant.includes('Open & review PDF')
    && merchant.includes('Accept & Sign')
    && merchant.includes('Confirm & Sign')
    && merchant.includes('/brand/sellertray-logo-v2.svg'),
  'Merchant Agreement UX must use the branded server-generated PDF review/signing flow.',
);
requireValue(
  merchant.includes('expectedPackageId: reviewDocument.packageId')
    && merchant.includes('expectedPackageFingerprint: reviewDocument.packageFingerprint')
    && merchant.includes('reviewedFingerprint'),
  'Merchant signing must bind the exact reviewed package id/fingerprint.',
);
requireValue(
  !merchant.includes("from 'pdf-lib'")
    && !merchant.includes("from 'jspdf'")
    && !merchant.includes('new PDFDocument'),
  'Merchant browser must not create canonical Agreement Package PDF bytes.',
);
requireValue(
  gateway.includes("action === 'merchant_get_document'")
    && gateway.includes('confirm_sellertray_agreement_package_reviewed')
    && gateway.includes('ensureAgreementArtifact')
    && gateway.includes('createSignedUrl'),
  'Master Agreement gateway must own secure artifact preparation and reviewed-package confirmation.',
);
requireValue(
  pdf.includes("npm:pdf-lib@1.17.1")
    && pdf.includes('Electronic Execution Certificate')
    && pdf.includes('Package fingerprint')
    && pdf.includes('ProcessEdge Solutions Limited'),
  'Server PDF renderer must produce branded package integrity and execution evidence.',
);
requireValue(
  migration.includes('sellertray_agreement_package_artifacts')
    && migration.includes("'sellertray-agreement-artifacts'")
    && migration.includes("'review_pdf','executed_pdf'")
    && migration.includes('prevent_sellertray_agreement_package_artifact_mutation')
    && migration.includes('confirm_sellertray_agreement_package_reviewed'),
  'Database authority must preserve immutable review/executed PDF metadata and reviewed-package confirmation.',
);
requireValue(
  governance.includes('Rendered Agreement Package documents')
    && governance.includes('review PDF')
    && governance.includes('executed PDF'),
  'Agreement governance must record the rendered PDF artifact contract.',
);

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'));
  process.exit(1);
}
console.log('Agreement Package PDF preflight passed.');
