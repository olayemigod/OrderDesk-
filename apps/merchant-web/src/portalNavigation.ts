export type MerchantPortalPage =
  | 'overview'
  | 'sales'
  | 'orders'
  | 'customers'
  | 'products'
  | 'inventory'
  | 'purchasing'
  | 'suppliers'
  | 'payments'
  | 'cash'
  | 'whatsapp'
  | 'devices'
  | 'reports'
  | 'ai'
  | 'branches'
  | 'team'
  | 'feedback'
  | 'settings';

export type MerchantPortalSection = 'Business' | 'Stock' | 'Money' | 'Channels' | 'Insights' | 'Management';

export type MerchantPortalNavigationItem = {
  id: MerchantPortalPage;
  label: string;
  section: MerchantPortalSection;
  available: boolean;
};

export const MERCHANT_PORTAL_NAVIGATION: MerchantPortalNavigationItem[] = [
  { id: 'overview', label: 'Overview', section: 'Business', available: true },
  { id: 'sales', label: 'Sales', section: 'Business', available: false },
  { id: 'orders', label: 'Orders', section: 'Business', available: true },
  { id: 'customers', label: 'Customers', section: 'Business', available: true },
  { id: 'products', label: 'Products & Pricing', section: 'Stock', available: true },
  { id: 'inventory', label: 'Inventory', section: 'Stock', available: true },
  { id: 'purchasing', label: 'Purchasing & Suppliers', section: 'Stock', available: true },
  { id: 'suppliers', label: 'Suppliers', section: 'Stock', available: false },
  { id: 'payments', label: 'Payments', section: 'Money', available: false },
  { id: 'cash', label: 'Cash & Shifts', section: 'Money', available: true },
  { id: 'whatsapp', label: 'WhatsApp', section: 'Channels', available: true },
  { id: 'devices', label: 'Devices & Printers', section: 'Channels', available: true },
  { id: 'reports', label: 'Report Center', section: 'Insights', available: true },
  { id: 'ai', label: 'Ask SellerTray', section: 'Insights', available: true },
  { id: 'branches', label: 'Branches', section: 'Management', available: false },
  { id: 'team', label: 'Team & Permissions', section: 'Management', available: true },
  { id: 'feedback', label: 'Feedback', section: 'Management', available: true },
  { id: 'settings', label: 'Settings', section: 'Management', available: true },
];

export const MERCHANT_PORTAL_SECTIONS: MerchantPortalSection[] = [
  'Business',
  'Stock',
  'Money',
  'Channels',
  'Insights',
  'Management',
];

export const AVAILABLE_MERCHANT_PORTAL_NAVIGATION = MERCHANT_PORTAL_NAVIGATION.filter((item) => item.available);
