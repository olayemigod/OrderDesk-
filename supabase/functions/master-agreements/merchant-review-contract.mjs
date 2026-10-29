import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const pdf = read('supabase/functions/master-agreements/agreement-pdf.ts');
const migration = read('supabase/migrations/20261029060000_merchant_agreement_review_performance_hardening.sql');
const failures = [];
const requireValue = (condition, message) => { if (!condition) failures.push(message); };
const excludes = (source, values) => values.every((value) => !source.includes(value));

requireValue(
  pdf.includes('function pdfSafeText(value: string): string')
    && pdf.includes(".replace(/₦/g, 'NGN ')")
    && pdf.includes(".replace(/[^\\x20-\\x7e]/g, '?')")
    && pdf.includes('const code = (currency || \'NGN\')')
    && pdf.includes('return `${code} ${amount}`;')
    && excludes(pdf, ["style: 'currency'"]),
  'Agreement Package PDF generation must remain safe for pdf-lib standard WinAnsi fonts and must render currency using ISO codes rather than unsupported symbols.',
);

requireValue(
  pdf.includes('drawWrappedText(doc, page, regular, clean')
    && pdf.includes('const lines = wrapText(font, pdfSafeText(text), maxWidth, size)')
    && pdf.includes('page.drawText(pdfSafeText(confirmation.confirmedLegalName)'),
  'All merchant-controlled or legal text rendered with standard PDF fonts must pass through the safe-text boundary.',
);

requireValue(
  migration.includes('create or replace function public.get_sellertray_agreement_package_center')
    && migration.includes("'actorRole',v_role")
    && migration.includes("'canAccept',v_can_accept")
    && migration.includes("'masterAgreement',v_master")
    && migration.includes("'masterAcceptanceRequired',v_master_id is not null and not v_master_accepted")
    && migration.includes("'orderForms',v_forms"),
  'Merchant Agreement Center must preserve the governed role, acceptance capability, current Master, action-required and Order Form summary contract.',
);

requireValue(
  excludes(migration, [
    "'contentBody'",
    "'renderedContent'",
    "'legacyAgreements'",
    'get_sellertray_master_agreement_center(p_tenant_id,p_actor_user_id)',
    'get_sellertray_commercial_agreement_center(p_tenant_id,p_actor_user_id)',
  ]),
  'Merchant Agreement Center must not reintroduce full Master text, rendered Order Form text, legacy agreement payloads, or the heavyweight legacy center composition.',
);

requireValue(
  migration.includes("coalesce(v_role,'') not in ('owner','manager')")
    && migration.includes("'can_accept_commercial_agreements'")
    && migration.includes('resolve_sellertray_master_agreement_version_id(now())')
    && migration.includes('sellertray_order_form_confirmations'),
  'Compact Merchant Agreement Center must preserve Owner/Manager access, explicit acceptance capability, current Master resolution and exact Order Form confirmation evidence.',
);

if (failures.length) {
  console.error('SellerTray Merchant Agreement review/performance contract failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('SellerTray Merchant Agreement review/performance contract passed.');
