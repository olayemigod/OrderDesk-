import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const supabaseClient = read('src/supabase.ts');
const main = read('src/main.tsx');
const app = read('src/MerchantApp.tsx');
const dashboard = read('src/DashboardOverview.tsx');
const cash = read('src/CashShiftsManagement.tsx');
const inventory = read('src/InventoryManagement.tsx');
const management = read('src/ManagementPage.tsx');
const products = read('src/ProductsManagement.tsx');
const team = read('src/TeamBranchesManagement.tsx');
const whatsapp = read('src/WhatsAppManagement.tsx');
const devices = read('src/DevicesPrintersManagement.tsx');
const reports = read('src/ReportCenter.tsx');
const salesReports = read('src/SalesReportCenter.tsx');
const procurementReports = read('src/ProcurementReportCenter.tsx');
const settings = read('src/SettingsManagement.tsx');
const purchasing = read('src/PurchasingManagement.tsx');
const purchasingOperations = read('src/PurchasingOperationsManagement.tsx');
const supplierPayments = read('src/SupplierPaymentManagement.tsx');
const supplierPaymentsCenter = read('src/SupplierPaymentsCenter.tsx');
const vercel = read('vercel.json');
const browserSource = [supabaseClient, main, app, dashboard, cash, inventory, management, products, team, whatsapp, devices, reports, salesReports, procurementReports, settings, purchasing, purchasingOperations, supplierPayments, supplierPaymentsCenter].join('\n');
const failures = [];
const requireValue = (condition, message) => { if (!condition) failures.push(message); };
const excludes = (source, values) => values.every((value) => !source.includes(value));

requireValue(excludes(browserSource, ['SERVICE_ROLE', 'SUPABASE_SECRET', 'platform-admin', 'platform-merchant-message']), 'Merchant Web must not contain service credentials or ProcessEdge platform-admin operations.');
requireValue(main.includes("import MerchantApp from './MerchantApp'") && main.includes('<MerchantApp />'), 'Merchant Web entrypoint must render the governed MerchantApp shell.');
requireValue(supabaseClient.includes('VITE_SUPABASE_PUBLISHABLE_KEY') && supabaseClient.includes('persistSession: true') && supabaseClient.includes('autoRefreshToken: true'), 'Merchant Web must use the browser publishable key with a persisted merchant session.');
requireValue(app.includes('sellertray_list_businesses_for_current_user') && app.includes("const MANAGEMENT_ROLES: MerchantRole[] = ['owner', 'manager']") && app.includes('managementBusinesses.length === 0') && app.includes('Use SellerTray mobile for daily operations'), 'Merchant Web management must remain Owner/Manager scoped.');
requireValue(app.includes('get_sellertray_accessible_branches') && app.includes('<InventoryManagement') && ['get_sellertray_inventory_management_stock', 'get_sellertray_inventory_management_movements', 'get_sellertray_inventory_management_transfers'].every((name) => inventory.includes(`rpc('${name}'`)) && app.includes('<CashShiftsManagement') && cash.includes("rpc('get_sellertray_cash_shift_management_list'") && cash.includes("rpc('get_sellertray_cash_shift_management_detail'") && cash.includes("functions.invoke('cash-shift'") && cash.includes("action: 'correct'") && cash.includes("action: 'review'") && app.includes('<DashboardOverview') && dashboard.includes("rpc('sellertray_report_center'"), 'Merchant Web must consume shared governed Branch, inventory, cashier and reporting read models.');
requireValue(!app.includes('get_sellertray_branch_stock') && excludes(inventory, ["rpc('get_sellertray_branch_stock'", "rpc('get_sellertray_stock_movements'", "rpc('get_sellertray_stock_transfers'", "from('inventory_movements')", "from('sellertray_inventory_valuation_entries')", "from('sellertray_inventory_valuation_state')", "from('stock_transfers')"]), 'Merchant Web Inventory must use management read RPCs rather than raw or bounded snapshot inventory reads.');
requireValue(inventory.includes('Known stock value') && inventory.includes('never treats unknown cost as zero') && inventory.includes('valuationStatus') && inventory.includes('averageUnitCost == null'), 'Merchant Web Inventory must expose governed valuation completeness and must not present unknown cost as zero.');
requireValue(excludes(cash, ["from('sellertray_cash_shifts')", "from('sellertray_shift_cash_movements')", "from('sellertray_shift_cash_movement_corrections')", "action: 'open'", "action: 'movement'", "action: 'close'"]), 'Merchant Web cash management must not bypass governed reads or perform mobile cashier operations.');

requireValue(management.includes('<ProductsManagement') && ['save_sellertray_product', 'set_sellertray_product_active', 'save_sellertray_product_uom', 'delete_sellertray_product_uom'].every((name) => products.includes(`rpc('${name}'`)), 'Products and Pricing must use governed product and UOM commands.');
requireValue(excludes(products, ["from('catalog_item_uoms').insert", "from('catalog_item_uoms').update", "from('catalog_item_uoms').delete", "from('catalog_items').insert", "from('catalog_items').update", "from('catalog_items').delete"]), 'Merchant Web must not bypass product and UOM commands with raw writes.');

requireValue(management.includes('<TeamBranchesManagement') && team.includes("functions.invoke('team-management'") && ['get_sellertray_manageable_branches', 'get_sellertray_team_access_matrix', 'save_sellertray_branch', 'set_sellertray_member_branch_access', 'reset_sellertray_member_branch_access', 'set_sellertray_member_capability_for_current_user'].every((name) => team.includes(`rpc('${name}'`)), 'Team and Branches must use governed Branch/capability commands.');
requireValue(excludes(team, ["from('branches').insert", "from('branches').update", "from('branches').delete", "from('branch_user_access').insert", "from('branch_user_access').update", "from('branch_user_access').delete", "from('tenant_member_capabilities').insert", "from('tenant_member_capabilities').update", "from('tenant_member_capabilities').delete"]), 'Merchant Web must not bypass Team, Branch or capability commands.');
requireValue(team.includes('Use default Branch only') && team.includes('usesDefaultBranchFallback') && team.includes("team.actorRole === 'owner'") && team.includes("team.actorRole === 'manager'"), 'Team and Branches must preserve default-Branch fallback and Owner/Manager hierarchy.');

requireValue(app.includes('<WhatsAppManagement') && whatsapp.includes("rpc('get_sellertray_whatsapp_management_route'") && whatsapp.includes("functions.invoke('whatsapp-connection'") && whatsapp.includes("rpc('set_sellertray_whatsapp_branch'"), 'WhatsApp management must use governed connection and Branch routing boundaries.');
requireValue(excludes(whatsapp, ["from('tenant_whatsapp_connections').insert", "from('tenant_whatsapp_connections').update", "from('tenant_whatsapp_connections').delete"]) && whatsapp.includes('Owner-only security action') && whatsapp.includes('Managers can review status and change the receiving Branch') && whatsapp.includes('One commerce core'), 'WhatsApp must preserve connection security and one shared commerce core.');
requireValue(dashboard.includes('WhatsApp') && dashboard.includes('channels') && dashboard.includes('branchPerformance'), 'Dashboard must expose WhatsApp/channel and Branch performance from the shared reporting model.');

requireValue(management.includes('<DevicesPrintersManagement') && devices.includes("rpc('get_sellertray_device_management_overview'") && devices.includes("rpc('save_sellertray_register'") && devices.includes("functions.invoke('printer'") && devices.includes("action: 'save_printer'"), 'Devices and Printers must use governed management commands.');
requireValue(excludes(devices, ["from('sellertray_registers').insert", "from('sellertray_registers').update", "from('sellertray_registers').delete", "from('sellertray_printers').insert", "from('sellertray_printers').update", "from('sellertray_printers').delete", "from('sellertray_print_jobs').insert", "from('sellertray_print_jobs').update", "from('sellertray_print_jobs').delete", "action: 'request_print'", "action: 'update_print'"]) && devices.includes('Bluetooth pairing and test printing remain on SellerTray mobile'), 'Browser device management must not execute mobile Bluetooth print operations.');

requireValue(app.includes("import ReportCenter from './ReportCenter'") && app.includes('<ReportCenter tenantId={business.id} currency={business.currency}') && reports.includes("import SalesReportCenter from './SalesReportCenter'") && reports.includes("import ProcurementReportCenter from './ProcurementReportCenter'") && reports.includes('Sales & Operations') && reports.includes('Purchasing'), 'Report Center must expose Sales & Operations and Purchasing views.');
requireValue(salesReports.includes("rpc('sellertray_report_center'") && salesReports.includes('Branch comparison') && salesReports.includes('Payment methods') && salesReports.includes('Top customers') && procurementReports.includes("rpc('sellertray_report_center'") && procurementReports.includes('Procurement by Branch') && procurementReports.includes('Supplier Outstanding'), 'Report Center views must consume the shared sellertray_report_center model.');
requireValue(excludes(salesReports, ["from('orders')", "from('order_payments')", "from('sellertray_cash_shifts')"]) && excludes(procurementReports, ["from('sellertray_purchase_orders')", "from('sellertray_supplier_payments')", "from('sellertray_supplier_payment_reversals')", "from('sellertray_purchase_receipts')"]), 'Report Center must not reproduce business calculations with raw browser queries.');
requireValue(procurementReports.includes('Purchase, receiving and supplier-payment activity follow the selected period.') && procurementReports.includes('Supplier outstanding is the current unpaid balance across placed Purchase Orders.'), 'Procurement reports must distinguish period activity from current outstanding state.');

requireValue(management.includes('<SettingsManagement') && settings.includes("rpc('sellertray_get_operational_policy'") && settings.includes("rpc('sellertray_save_operational_policy'") && settings.includes("functions.invoke('payment-settings'") && settings.includes("action: 'connect_gateway'") && settings.includes("action: 'disconnect_gateway'"), 'Settings must reuse governed policy and payment boundaries.');
requireValue(excludes(settings, ["from('merchant_payment_methods').insert", "from('merchant_payment_methods').update", "from('merchant_payment_methods').delete", "from('merchant_operational_policies').insert", "from('merchant_operational_policies').update", "from('merchant_operational_policies').delete", 'credentials_ciphertext', 'credentials_iv']) && settings.includes('Secret values are encrypted by SellerTray and are never displayed again after submission.'), 'Gateway and operational settings must not bypass governed services or expose encrypted credentials.');

requireValue(purchasing.includes("import PurchasingOperationsManagement from './PurchasingOperationsManagement'") && purchasing.includes("import SupplierPaymentsCenter from './SupplierPaymentsCenter'") && purchasingOperations.includes("rpc('save_sellertray_purchase_order'") && purchasingOperations.includes("rpc('place_sellertray_purchase_order'") && supplierPayments.includes("rpc('record_sellertray_supplier_payment'") && supplierPayments.includes("rpc('reverse_sellertray_supplier_payment'") && supplierPaymentsCenter.includes("rpc('get_sellertray_supplier_outstanding_summary'"), 'Purchasing must use governed Purchase Order and supplier payment commands.');
requireValue(excludes(browserSource, ["from('sellertray_suppliers').insert", "from('sellertray_suppliers').update", "from('sellertray_suppliers').delete", "from('sellertray_purchase_orders').insert", "from('sellertray_purchase_orders').update", "from('sellertray_purchase_orders').delete", "from('sellertray_purchase_order_items').insert", "from('sellertray_purchase_order_items').update", "from('sellertray_purchase_order_items').delete", "from('sellertray_supplier_payments')", "from('sellertray_supplier_payment_reversals')"]), 'Merchant Web must not bypass purchasing or supplier-payment governance with raw browser access.');
requireValue(supplierPayments.includes('Cash entries here do not change a cashier drawer or accounting ledger.') && supplierPaymentsCenter.includes('They do not create accounting entries or change cashier drawer balances.'), 'Supplier payment surfaces must preserve the non-accounting/non-cash-drawer boundary.');

requireValue(vercel.includes('Content-Security-Policy') && vercel.includes("frame-ancestors 'none'") && vercel.includes('Permissions-Policy') && vercel.includes('X-Frame-Options') && vercel.includes('no-store'), 'Merchant Web deployment must retain browser security and no-store headers.');

if (failures.length) { console.error('SellerTray Merchant Web security preflight failed:'); for (const failure of failures) console.error('- ' + failure); process.exit(1); }
console.log('SellerTray Merchant Web security preflight passed.');
