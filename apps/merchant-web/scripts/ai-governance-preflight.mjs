import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const appRoot = process.cwd();
const browser = readFileSync(resolve(appRoot, 'src/AiBriefManagement.tsx'), 'utf8');
const server = readFileSync(resolve(appRoot, '../../supabase/functions/ai-brief/index.ts'), 'utf8');
const telemetry = readFileSync(resolve(appRoot, '../../supabase/migrations/20261010210000_ai_brief_telemetry.sql'), 'utf8');
const budget = readFileSync(resolve(appRoot, '../../supabase/migrations/20261010210100_ai_brief_provider_budget_reservations.sql'), 'utf8');
const failures = [];

function requireValue(condition, message) {
  if (!condition) failures.push(message);
}

requireValue(
  browser.includes("functions.invoke('ai-brief'") &&
    browser.includes("rpc('get_sellertray_ai_brief_usage'") &&
    !browser.includes('OPENAI_API_KEY') &&
    !browser.includes('api.openai.com') &&
    !browser.includes("from('sellertray_ai_brief_attempts')") &&
    !browser.includes("from('sellertray_ai_brief_provider_reservations')"),
  'AI Brief browser code must use only the governed SellerTray AI boundary and cannot access provider credentials or raw AI telemetry.',
);

const reservationIndex = server.indexOf("reserveProviderCall(tenantId, requestId)");
const providerIndex = server.indexOf("fetch('https://api.openai.com/v1/responses'");
requireValue(
  reservationIndex >= 0 && providerIndex > reservationIndex,
  'AI Brief must reserve provider budget before any OpenAI provider request.',
);

requireValue(
  server.includes("role !== 'owner' && role !== 'manager'") &&
    server.includes("userRpc<J>('sellertray_report_center'") &&
    server.includes("serviceRpc<boolean>('orderdesk_subscription_can_write'") &&
    server.includes('topCustomers: anonymizeCustomers') &&
    server.includes('store: false') &&
    server.includes("reasoning: { effort: 'none' }") &&
    server.includes("type: 'json_schema'") &&
    server.includes('strict: true') &&
    !server.includes('tools:'),
  'AI Brief must stay management-only, report-backed, privacy-minimized, structured, non-persistent and tool-free.',
);

requireValue(
  !server.includes("from('orders')") &&
    !server.includes("from('inventory_movements')") &&
    !server.includes("from('order_payments')") &&
    !server.includes('save_sellertray_') &&
    !server.includes('post_sellertray_purchase_receipt') &&
    !server.includes('record_sellertray_inventory_movement'),
  'AI Brief server code must not bypass shared read models or mutate commerce, inventory, purchasing or payments.',
);

requireValue(
  telemetry.includes('context_fingerprint') &&
    !telemetry.includes('prompt text') &&
    !telemetry.includes('question text') &&
    !telemetry.includes('report_payload') &&
    telemetry.includes('SellerTray AI Brief telemetry is immutable'),
  'AI Brief telemetry must retain fingerprints/usage rather than prompt/report content and remain immutable.',
);

requireValue(
  budget.includes('pg_advisory_xact_lock') &&
    budget.includes('request_already_reserved') &&
    budget.includes('daily_budget_reached') &&
    budget.includes('SellerTray AI provider reservations are immutable') &&
    budget.includes('grant execute on function public.reserve_sellertray_ai_brief_provider_call(uuid,uuid,integer)') &&
    budget.includes('to service_role'),
  'AI provider budget reservations must be atomic, replay-safe, capped, immutable and service-only.',
);

if (failures.length) {
  console.error('SellerTray AI governance preflight failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('SellerTray AI governance preflight passed.');
