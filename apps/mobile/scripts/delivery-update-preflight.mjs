import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const mobileRoot = process.cwd();
const repoRoot = resolve(mobileRoot, '../..');
const migration = readFileSync(
  join(repoRoot, 'supabase/migrations/20260917032000_delivery_whatsapp_dispatch_details.sql'),
  'utf8',
);

const required = [
  'queue_sellertray_fulfillment_notification',
  'delivery_provider',
  'delivery_contact_name',
  'delivery_contact_phone',
  'delivery_reference',
  'estimated_delivery_at',
  "new.fulfillment_status <> 'out_for_delivery'",
  'conversation_window_expires_at',
  'template_required',
  'reply RECEIVED',
  'on conflict (order_id, event_key) do nothing',
];

const missing = required.filter((needle) => !migration.includes(needle));
if (missing.length) {
  console.error('SellerTray delivery-update preflight failed:');
  for (const needle of missing) console.error('- missing contract: ' + needle);
  process.exit(1);
}

if (!migration.includes("enabled is distinct from true") || !migration.includes("customer_wa_id like 'manual:%'")) {
  console.error('SellerTray delivery-update preflight failed: notification preference/manual-customer guard missing.');
  process.exit(1);
}

console.log('SellerTray rich delivery WhatsApp update preflight passed.');
