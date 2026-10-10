import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const appRoot = process.cwd();
const supabaseClient = readFileSync(resolve(appRoot, 'src/supabase.ts'), 'utf8');
const main = readFileSync(resolve(appRoot, 'src/main.tsx'), 'utf8');
const app = readFileSync(resolve(appRoot, 'src/MerchantApp.tsx'), 'utf8');
const management = readFileSync(resolve(appRoot, 'src/ManagementPage.tsx'), 'utf8');
const products = readFileSync(resolve(appRoot, 'src/ProductsManagement.tsx'), 'utf8');
const purchasing = readFileSync(resolve(appRoot, 'src/PurchasingManagement.tsx'), 'utf8');
const aiBrief = readFileSync(resolve(appRoot, 'src/AiBriefManagement.tsx'), 'utf8');
const aiFunction = readFileSync(resolve(appRoot, '../../supabase/functions/ai-brief/index.ts'), 'utf8');
const team = readFileSync(resolve(appRoot, 'src/TeamBranchesManagement.tsx'), 'utf8');
const whatsapp = readFileSync(resolve(appRoot, 'src/WhatsAppManagement.tsx'), 'utf8');
const devices = readFileSync(resolve(appRoot, 'src/DevicesPrintersManagement.tsx'), 'utf8');
const reports = readFileSync(resolve(appRoot, 'src/ReportCenter.tsx'), 'utf8');
const settings = readFileSync(resolve(appRoot, 'src/SettingsManagement.tsx'), 'utf8');
const vercel = readFileSync(resolve(appRoot, 'vercel.json'), 'utf8');
const failures = [];

function requireValue(condition, message) {
  if (!condition) failures.push(message);
}

const browserSource = `${supabaseClient}\n${main}\n${app}\n${management}\n${products}\n${purchasing}\n${aiBrief}\n${team}\n${whatsapp}\n${devices}\n${reports}\n${settings}`;
requireValue(
  !browserSource.includes('SERVICE_ROLE') &&
    !browserSource.includes('SUPABASE_SECRET') &&
    !browserSource.includes('platform-admin') &&
    !browserSource.includes('platform-merchant-message'),
  'Merchant Web must not contain service credentials or ProcessEdge platform-admin operations.',
);

requireValue(
  main.includes("import MerchantApp from './MerchantApp'") &&
    main.includes('<MerchantApp />'),
  'Merchant Web entrypoint must render the governed MerchantApp shell.',
);

requireValue(
  supabaseClient.includes('VITE_SUPABASE_PUBLISHABLE_KEY') &&
    supabaseClient.includes('persistSession: true') &&
    supabaseClient.includes('autoRefreshToken: true'),
  'Merchant Web must use the browser publishable key with a persisted merchant session.',
);

requireValue(
  app.includes('sellertray_list_businesses_for_current_user') &&
    app.includes("const MANAGEMENT_ROLES: MerchantRole[] = ['owner', 'manager']") &&
    app.includes('managementBusinesses.length === 0') &&
    app.includes('Use SellerTray mobile for daily operations'),
  'Merchant Web must resolve SellerTray membership and keep management access limited to Owners and Managers.',
);

requireValue(
  app.includes('get_sellertray_accessible_branches') &&
    app.includes('sellertray_report_summary') &&
    app.includes('get_sellertray_branch_stock') &&
    app.includes('get_sellertray_cash_shift_history'),
  'Merchant Web must consume shared SellerTray Branch, reporting, inventory and cashier read models.',
);

requireValue(
  management.includes('<ProductsManagement') &&
    products.includes("rpc('save_sellertray_product'") &&
    products.includes("rpc('set_sellertray_product_active'") &&
    products.includes("rpc('save_sellertray_product_uom'") &&
    products.includes("rpc('delete_sellertray_product_uom'"),
  'Products and Pricing must use the shared governed product and UOM commands.',
);

requireValue(
  !products.includes("from('catalog_item_uoms').insert") &&
    !products.includes("from('catalog_item_uoms').update") &&
    !products.includes("from('catalog_item_uoms').delete") &&
    !products.includes("from('catalog_items').insert") &&
    !products.includes("from('catalog_items').update") &&
    !products.includes("from('catalog_items').delete"),
  'Merchant Web must not bypass product and UOM command invariants with raw browser writes.',
);

requireValue(
  app.includes("{ id: 'ai', label: 'AI Brief' }") &&
    management.includes('<AiBriefManagement') &&
    aiBrief.includes("functions.invoke('ai-brief'") &&
    aiBrief.includes("rpc('get_sellertray_ai_brief_usage'"),
  'AI Brief must use the governed Edge Function and management-only usage summary.',
);

requireValue(
  !aiBrief.includes("from('orders').insert") &&
    !aiBrief.includes("from('orders').update") &&
    !aiBrief.includes("from('inventory_movements').insert") &&
    !aiBrief.includes("from('order_payments').update"),
  'AI Brief browser code must remain read-only and cannot mutate commerce, stock or payments.',
);

requireValue(
  aiFunction.includes("userRpc<J>('sellertray_report_center'") &&
    aiFunction.includes("serviceRpc<boolean>('orderdesk_subscription_can_write'") &&
    aiFunction.includes('SELLERTRAY_AI_BRIEF_DAILY_LIMIT') &&
    aiFunction.includes('topCustomers: anonymizeCustomers') &&
    aiFunction.includes('store: false') &&
    aiFunction.includes("reasoning: { effort: 'none' }") &&
    !aiFunction.includes("save_sellertray_") &&
    !aiFunction.includes("post_sellertray_purchase_receipt") &&
    !aiFunction.includes("record_sellertray_inventory_movement") &&
    !aiFunction.includes('tools:'),
  'AI Brief server boundary must be report-only, budgeted, privacy-minimized and tool-free.',
);

requireValue(
  app.includes("{ id: 'purchasing', label: 'Purchasing' }") &&
    management.includes('<PurchasingManagement') &&
    purchasing.includes("rpc('get_sellertray_suppliers'") &&
    purchasing.includes("rpc('get_sellertray_purchase_orders'") &&
    purchasing.includes("rpc('save_sellertray_supplier'") &&
    purchasing.includes("rpc('save_sellertray_purchase_order'") &&
    purchasing.includes("submit_sellertray_purchase_order") &&
    purchasing.includes("rpc('post_sellertray_purchase_receipt'"),
  'Purchasing must use the shared governed Supplier, Purchase Order and Purchase Receipt commands.',
);

requireValue(
  !purchasing.includes("from('suppliers').insert") &&
    !purchasing.includes("from('suppliers').update") &&
    !purchasing.includes("from('purchase_orders').insert") &&
    !purchasing.includes("from('purchase_orders').update") &&
    !purchasing.includes("from('purchase_receipts').insert") &&
    !purchasing.includes("from('purchase_receipts').update") &&
    !purchasing.includes("from('inventory_movements').insert"),
  'Merchant Web must not bypass purchasing or inventory commands with raw browser writes.',
);

requireValue(
  management.includes('<TeamBranchesManagement') &&
    team.includes("functions.invoke('team-management'") &&
    team.includes("rpc('get_sellertray_manageable_branches'") &&
    team.includes("rpc('get_sellertray_team_access_matrix'") &&
    team.includes("rpc('save_sellertray_branch'") &&
    team.includes("rpc('set_sellertray_member_branch_access'") &&
    team.includes("rpc('reset_sellertray_member_branch_access'") &&
    team.includes("rpc('set_sellertray_member_capability_for_current_user'"),
  'Team and Branches must use the shared team service and governed Branch/capability commands.',
);

requireValue(
  !team.includes("from('branches').insert") &&
    !team.includes("from('branches').update") &&
    !team.includes("from('branches').delete") &&
    !team.includes("from('branch_user_access').insert") &&
    !team.includes("from('branch_user_access').update") &&
    !team.includes("from('branch_user_access').delete") &&
    !team.includes("from('tenant_member_capabilities').insert") &&
    !team.includes("from('tenant_member_capabilities').update") &&
    !team.includes("from('tenant_member_capabilities').delete"),
  'Merchant Web must not bypass Team, Branch or capability command invariants with raw browser writes.',
);

requireValue(
  team.includes('Use default Branch only') &&
    team.includes('usesDefaultBranchFallback') &&
    team.includes("team.actorRole === 'owner'") &&
    team.includes("team.actorRole === 'manager'"),
  'Team and Branches must preserve default-Branch fallback and the Owner/Manager governance hierarchy.',
);

requireValue(
  app.includes('<WhatsAppManagement') &&
    whatsapp.includes("rpc('get_sellertray_whatsapp_management_route'") &&
    whatsapp.includes("functions.invoke('whatsapp-connection'") &&
    whatsapp.includes("rpc('set_sellertray_whatsapp_branch'"),
  'WhatsApp management must use the safe route read model, shared status service and governed receiving-Branch command.',
);

requireValue(
  !whatsapp.includes("from('tenant_whatsapp_connections').insert") &&
    !whatsapp.includes("from('tenant_whatsapp_connections').update") &&
    !whatsapp.includes("from('tenant_whatsapp_connections').delete") &&
    whatsapp.includes('Owner-only security action') &&
    whatsapp.includes('Managers can review status and change the receiving Branch'),
  'Merchant Web must not bypass WhatsApp connection security or expose Manager credential mutation.',
);

requireValue(
  management.includes('<DevicesPrintersManagement') &&
    management.includes("rpc('get_sellertray_accessible_branches'") &&
    devices.includes("rpc('get_sellertray_device_management_overview'") &&
    devices.includes("rpc('save_sellertray_register'") &&
    devices.includes("functions.invoke('printer'") &&
    devices.includes("action: 'save_printer'"),
  'Devices and Printers must use shared Branch reads and governed register/printer management commands.',
);

requireValue(
  !devices.includes("from('sellertray_registers').insert") &&
    !devices.includes("from('sellertray_registers').update") &&
    !devices.includes("from('sellertray_registers').delete") &&
    !devices.includes("from('sellertray_printers').insert") &&
    !devices.includes("from('sellertray_printers').update") &&
    !devices.includes("from('sellertray_printers').delete") &&
    !devices.includes("from('sellertray_print_jobs').insert") &&
    !devices.includes("from('sellertray_print_jobs').update") &&
    !devices.includes("from('sellertray_print_jobs').delete") &&
    !devices.includes("action: 'request_print'") &&
    !devices.includes("action: 'update_print'"),
  'Merchant Web must not bypass device commands or execute Bluetooth print jobs from the browser.',
);

requireValue(
  devices.includes('Bluetooth pairing and test printing remain on SellerTray mobile') &&
    devices.includes('Test prints and receipt printing run from the Android app'),
  'Devices management must keep Bluetooth discovery and print execution on mobile.',
);

requireValue(
  app.includes("import ReportCenter from './ReportCenter'") &&
    app.includes('<ReportCenter tenantId={business.id} currency={business.currency}') &&
    reports.includes("rpc('sellertray_report_center'") &&
    reports.includes('Branch comparison') &&
    reports.includes('Payment methods') &&
    reports.includes('Top customers'),
  'Report Center must use the shared server-side reporting read model for management drill-down.',
);

requireValue(
  !reports.includes("from('orders')") &&
    !reports.includes("from('order_payments')") &&
    !reports.includes("from('sellertray_cash_shifts')"),
  'Report Center must not reproduce reporting business calculations with raw browser queries.',
);

requireValue(
  management.includes('<SettingsManagement') &&
    settings.includes("from('tenants').update") &&
    settings.includes("rpc('sellertray_get_operational_policy'") &&
    settings.includes("rpc('sellertray_save_operational_policy'") &&
    settings.includes("functions.invoke('payment-settings'") &&
    settings.includes("action: 'connect_gateway'") &&
    settings.includes("action: 'disconnect_gateway'"),
  'Settings must reuse the shared business profile, operational policy and payment-settings boundaries.',
);

requireValue(
  !settings.includes("from('merchant_payment_methods').insert") &&
    !settings.includes("from('merchant_payment_methods').update") &&
    !settings.includes("from('merchant_payment_methods').delete") &&
    !settings.includes("from('merchant_operational_policies').insert") &&
    !settings.includes("from('merchant_operational_policies').update") &&
    !settings.includes("from('merchant_operational_policies').delete") &&
    !settings.includes('credentials_ciphertext') &&
    !settings.includes('credentials_iv'),
  'Merchant Web must not bypass payment/policy services or read encrypted gateway credentials.',
);

requireValue(
  settings.includes("business_email: clean(profile.businessEmail)") &&
    settings.includes("business_phone: clean(profile.businessPhone)") &&
    settings.includes("business_type: clean(profile.businessType)") &&
    settings.includes("logo_url: clean(profile.logoUrl)") &&
    settings.includes('currency,') &&
    settings.includes('timezone,'),
  'Business profile updates must remain inside the established tenant profile columns.',
);

requireValue(
  settings.includes('Secret values are encrypted by SellerTray and are never displayed again after submission.') &&
    settings.includes('secretKey: secretKey.trim()') &&
    settings.includes("? secretHash.trim() : null") &&
    !settings.includes('credentials_ciphertext') &&
    !settings.includes('credentials_iv'),
  'Gateway credentials must be write-only browser inputs sent to the encrypted payment-settings service.',
);

requireValue(
  vercel.includes('Content-Security-Policy') &&
    vercel.includes("frame-ancestors 'none'") &&
    vercel.includes('Permissions-Policy') &&
    vercel.includes('X-Frame-Options') &&
    vercel.includes('no-store'),
  'Merchant Web deployment must retain CSP, anti-framing, browser-permission and no-store headers.',
);

if (failures.length) {
  console.error('SellerTray Merchant Web security preflight failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('SellerTray Merchant Web security preflight passed.');
