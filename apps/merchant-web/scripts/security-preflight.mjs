import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const appRoot = process.cwd();
const supabaseClient = readFileSync(resolve(appRoot, 'src/supabase.ts'), 'utf8');
const app = readFileSync(resolve(appRoot, 'src/App.tsx'), 'utf8');
const products = readFileSync(resolve(appRoot, 'src/ProductsManagement.tsx'), 'utf8');
const vercel = readFileSync(resolve(appRoot, 'vercel.json'), 'utf8');
const failures = [];

function requireValue(condition, message) {
  if (!condition) failures.push(message);
}

const browserSource = `${supabaseClient}\n${app}\n${products}`;
requireValue(
  !browserSource.includes('SERVICE_ROLE') &&
    !browserSource.includes('SUPABASE_SECRET') &&
    !browserSource.includes('platform-admin') &&
    !browserSource.includes('platform-merchant-message'),
  'Merchant Web must not contain service credentials or ProcessEdge platform-admin operations.',
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
  app.includes('<ProductsManagement') &&
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