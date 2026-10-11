import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const appRoot = process.cwd();
const supabaseClient = readFileSync(resolve(appRoot, 'src/supabase.ts'), 'utf8');
const main = readFileSync(resolve(appRoot, 'src/main.tsx'), 'utf8');
const app = readFileSync(resolve(appRoot, 'src/MerchantApp.tsx'), 'utf8');
const management = readFileSync(resolve(appRoot, 'src/ManagementPage.tsx'), 'utf8');
const products = readFileSync(resolve(appRoot, 'src/ProductsManagement.tsx'), 'utf8');
const team = readFileSync(resolve(appRoot, 'src/TeamBranchesManagement.tsx'), 'utf8');
const whatsapp = readFileSync(resolve(appRoot, 'src/WhatsAppManagement.tsx'), 'utf8');
const devices = readFileSync(resolve(appRoot, 'src/DevicesPrintersManagement.tsx'), 'utf8');
const reports = readFileSync(resolve(appRoot, 'src/ReportCenter.tsx'), 'utf8');
const salesReports = readFileSync(resolve(appRoot, 'src/SalesReportCenter.tsx'), 'utf8');
const procurementReports = readFileSync(resolve(appRoot, 'src/ProcurementReportCenter.tsx'), 'utf8');
const settings = readFileSync(resolve(appRoot, 'src/SettingsManagement.tsx'), 'utf8');
const purchasing = readFileSync(resolve(appRoot, 'src/PurchasingManagement.tsx'), 'utf8');
const purchasingOperations = readFileSync(resolve(appRoot, 'src/PurchasingOperationsManagement.tsx'), 'utf8');
const supplierPayments = readFileSync(resolve(appRoot, 'src/SupplierPaymentManagement.tsx'), 'utf8');
const supplierPaymentsCenter = readFileSync(resolve(appRoot, 'src/SupplierPaymentsCenter.tsx'), 'utf8');
const vercel = readFileSync(resolve(appRoot, 'vercel.json'), 'utf8');
const failures = [];

function requireValue(condition, message) {
  if (!condition) failures.push(message);
}

const browserSource = `${supabaseClient}\n${main}\n${app}\n${management}\n${products}\n${team}\n${whatsapp}\n${devices}\n${reports}\n${salesReports}\n${procurementReports}\n${settings}\n${purchasing}\n${purchasingOperations}\n${supplierPayments}\n${supplierPaymentsCenter}`;
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
    reports.includes("import SalesReportCenter from './SalesReportCenter'") &&
    reports.includes("import ProcurementReportCenter from './ProcurementReportCenter'") &&
    reports.includes('Sales & Operations') &&
    reports.includes('Purchasing'),
  'Report Center must expose separate Sales & Operations and Purchasing views through one management surface.',
);

requireValue(
  salesReports.includes("rpc('sellertray_report_center'") &&
    salesReports.includes('Branch comparison') &&
    salesReports.includes('Payment methods') &&
    salesReports.includes('Top customers') &&
    procurementReports.includes("rpc('sellertray_report_center'") &&
    procurementReports.includes('Procurement by Branch') &&
    procurementReports.includes('Supplier Outstanding') &&
    procurementReports.includes('procurementSummary') &&
    procurementReports.includes('branchProcurement') &&
    procurementReports.includes('purchaseStatus') &&
    procurementReports.includes('supplierOutstanding'),
  'Both Report Center views must consume the shared sellertray_report_center server read model.',
);

requireValue(
  !salesReports.includes("from('orders')") &&
    !salesReports.includes("from('order_payments')") &&
    !salesReports.includes("from('sellertray_cash_shifts')") &&
    !procurementReports.includes("from('sellertray_purchase_orders')") &&
    !procurementReports.includes("from('sellertray_supplier_payments')") &&
    !procurementReports.includes("from('sellertray_supplier_payment_reversals')") &&
    !procurementReports.includes("from('sellertray_purchase_receipts')"),
  'Report Center must not reproduce sales or procurement business calculations with raw browser queries.',
);

requireValue(
  procurementReports.includes('Purchase, receiving and supplier-payment activity follow the selected period.') &&
    procurementReports.includes('Supplier outstanding is the current unpaid balance across placed Purchase Orders.'),
  'Procurement reporting must distinguish period activity from current supplier outstanding state.',
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
  purchasing.includes("import PurchasingOperationsManagement from './PurchasingOperationsManagement'") &&
    purchasing.includes("import SupplierPaymentsCenter from './SupplierPaymentsCenter'") &&
    purchasingOperations.includes("rpc('save_sellertray_supplier'") &&
    purchasingOperations.includes("rpc('save_sellertray_purchase_order'") &&
    purchasingOperations.includes("rpc('place_sellertray_purchase_order'") &&
    supplierPayments.includes("rpc('get_sellertray_purchase_payment_summary'") &&
    supplierPayments.includes("rpc('record_sellertray_supplier_payment'") &&
    supplierPayments.includes("rpc('reverse_sellertray_supplier_payment'") &&
    supplierPaymentsCenter.includes("rpc('get_sellertray_supplier_outstanding_summary'"),
  'Purchasing must use governed Supplier, Purchase Order and supplier payment commands.',
);

requireValue(
  !browserSource.includes("from('sellertray_suppliers').insert") &&
    !browserSource.includes("from('sellertray_suppliers').update") &&
    !browserSource.includes("from('sellertray_suppliers').delete") &&
    !browserSource.includes("from('sellertray_purchase_orders').insert") &&
    !browserSource.includes("from('sellertray_purchase_orders').update") &&
    !browserSource.includes("from('sellertray_purchase_orders').delete") &&
    !browserSource.includes("from('sellertray_purchase_order_items').insert") &&
    !browserSource.includes("from('sellertray_purchase_order_items').update") &&
    !browserSource.includes("from('sellertray_purchase_order_items').delete") &&
    !browserSource.includes("from('sellertray_supplier_payments')") &&
    !browserSource.includes("from('sellertray_supplier_payment_reversals')"),
  'Merchant Web must not bypass purchasing or supplier-payment governance with raw browser writes/reads.',
);

requireValue(
  supplierPayments.includes('Cash entries here do not change a cashier drawer or accounting ledger.') &&
    supplierPaymentsCenter.includes('They do not create accounting entries or change cashier drawer balances.'),
  'Supplier payment surfaces must state the non-accounting and non-cash-drawer boundary.',
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
