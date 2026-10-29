export type MerchantPortalPage =
  | 'overview'
  | 'sales'
  | 'orders'
  | 'customers'
  | 'returns'
  | 'products'
  | 'categories'
  | 'units'
  | 'inventory'
  | 'purchasing'
  | 'suppliers'
  | 'payments'
  | 'sellertray_billing'
  | 'cash'
  | 'expenses'
  | 'whatsapp'
  | 'devices'
  | 'reports'
  | 'ai'
  | 'branches'
  | 'team'
  | 'agreements'
  | 'feedback'
  | 'setup_activation'
  | 'settings';

export type MerchantPortalSection =
  | 'Dashboard'
  | 'Sales'
  | 'Catalogue & Inventory'
  | 'Purchasing'
  | 'Money'
  | 'Channels'
  | 'Insights'
  | 'Business';

export type MerchantPortalNavigationItem = {
  id: MerchantPortalPage;
  label: string;
  section: MerchantPortalSection;
  available: boolean;
};

export const MERCHANT_PORTAL_NAVIGATION: MerchantPortalNavigationItem[] = [
  { id: 'overview', label: 'Dashboard', section: 'Dashboard', available: true },
  { id: 'sales', label: 'Sales', section: 'Sales', available: true },
  { id: 'orders', label: 'Orders', section: 'Sales', available: true },
  { id: 'customers', label: 'Customers', section: 'Sales', available: true },
  { id: 'returns', label: 'Returns', section: 'Sales', available: true },
  { id: 'products', label: 'Products', section: 'Catalogue & Inventory', available: true },
  { id: 'categories', label: 'Categories', section: 'Catalogue & Inventory', available: true },
  { id: 'units', label: 'Units', section: 'Catalogue & Inventory', available: true },
  { id: 'inventory', label: 'Inventory', section: 'Catalogue & Inventory', available: true },
  { id: 'purchasing', label: 'Purchase Orders & Receiving', section: 'Purchasing', available: true },
  { id: 'suppliers', label: 'Suppliers', section: 'Purchasing', available: true },
  { id: 'payments', label: 'Payments & Receivables', section: 'Money', available: true },
  { id: 'cash', label: 'Cash & Shifts', section: 'Money', available: true },
  { id: 'expenses', label: 'Business Expenses', section: 'Money', available: true },
  { id: 'whatsapp', label: 'WhatsApp', section: 'Channels', available: true },
  { id: 'devices', label: 'Devices & Printers', section: 'Channels', available: true },
  { id: 'reports', label: 'Report Center', section: 'Insights', available: true },
  { id: 'ai', label: 'Ask SellerTray', section: 'Insights', available: true },
  { id: 'branches', label: 'Branches', section: 'Business', available: true },
  { id: 'team', label: 'Team & Permissions', section: 'Business', available: true },
  { id: 'agreements', label: 'Agreements', section: 'Business', available: true },
  { id: 'feedback', label: 'Feedback', section: 'Business', available: true },
  { id: 'sellertray_billing', label: 'Billing', section: 'Business', available: true },
  { id: 'setup_activation', label: 'Setup & Activation', section: 'Business', available: true },
  { id: 'settings', label: 'Settings', section: 'Business', available: true },
];

export const MERCHANT_PORTAL_SECTIONS: MerchantPortalSection[] = [
  'Dashboard',
  'Sales',
  'Catalogue & Inventory',
  'Purchasing',
  'Money',
  'Channels',
  'Insights',
  'Business',
];

export const AVAILABLE_MERCHANT_PORTAL_NAVIGATION = MERCHANT_PORTAL_NAVIGATION.filter((item) => item.available);
export const AVAILABLE_MERCHANT_PORTAL_PAGE_IDS: MerchantPortalPage[] = AVAILABLE_MERCHANT_PORTAL_NAVIGATION.map((item) => item.id);
