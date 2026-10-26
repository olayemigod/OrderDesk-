export type ShellIconName = 'menu' | 'close' | 'sun' | 'moon' | 'refresh' | 'chevron' | 'bell';

const SELLERTRAY_LOGO = '/brand/sellertray-v2-mark-128.png';

export function SellerTrayMark({ large = false }: { large?: boolean }) {
  return <span className={large ? 'sellertray-mark large' : 'sellertray-mark'} aria-hidden="true"><img src={SELLERTRAY_LOGO} alt="" /><strong className="sellertray-wordmark">Seller<span>Tray</span></strong></span>;
}

export function SellerTrayBrand({ subtitle = 'Merchant Web' }: { subtitle?: string }) {
  return <div className="sellertray-brand"><SellerTrayMark /><span className="sellertray-brand-surface">{subtitle}</span></div>;
}

type NavIconName =
  | 'overview' | 'sales' | 'orders' | 'customers' | 'returns' | 'products' | 'categories' | 'units' | 'inventory'
  | 'purchasing' | 'suppliers' | 'payments' | 'sellertray_billing' | 'cash' | 'expenses' | 'whatsapp' | 'devices' | 'reports'
  | 'ai' | 'branches' | 'team' | 'agreements' | 'feedback' | 'settings';

const NAV_PATHS: Record<NavIconName, string[]> = {
  overview: ['M4 13h6V4H4v9Z', 'M14 20h6V11h-6v9Z', 'M14 7h6V4h-6v3Z', 'M4 20h6v-3H4v3Z'],
  sales: ['M4 19V9', 'M10 19V5', 'M16 19v-7', 'M22 19V3'],
  orders: ['M6 3h12l2 4-2 4H6L4 7l2-4Z', 'M7 11v10h10V11'],
  customers: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
  returns: ['M9 14 4 9l5-5', 'M4 9h10a6 6 0 0 1 0 12'],
  products: ['M20 12V5l-8-3-8 3v7c0 5 3.5 8 8 10 4.5-2 8-5 8-10Z', 'M8 10h8', 'M12 6v8'],
  categories: ['M4 5h7v6H4V5Z', 'M13 5h7v6h-7V5Z', 'M4 13h7v6H4v-6Z', 'M13 13h7v6h-7v-6Z'],
  units: ['M4 7h16', 'M7 4v6', 'M12 5v4', 'M17 4v6', 'M4 17h16', 'M7 14v6', 'M12 15v4', 'M17 14v6'],
  inventory: ['M3 7l9-4 9 4-9 4-9-4Z', 'M3 7v10l9 4 9-4V7', 'M12 11v10'],
  purchasing: ['M3 3h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L21 7H6', 'M10 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z', 'M18 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z'],
  suppliers: ['M3 21V8l9-5 9 5v13', 'M9 21v-6h6v6', 'M7 10h2', 'M15 10h2'],
  payments: ['M3 6h18v12H3V6Z', 'M3 10h18', 'M7 15h3'],
  sellertray_billing: ['M4 3h16v18H4V3Z', 'M8 7h8', 'M8 11h8', 'M8 15h5'],
  cash: ['M4 6h16v12H4V6Z', 'M8 6V4h8v2', 'M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z'],
  expenses: ['M6 3h12v18H6V3Z', 'M9 7h6', 'M9 11h6', 'M9 15h3'],
  whatsapp: ['M21 11.5a8.5 8.5 0 0 1-12.7 7.4L3 20l1.2-5.1A8.5 8.5 0 1 1 21 11.5Z', 'M8.5 8.5c1.4 3.2 3.8 5.5 7 7'],
  devices: ['M7 2h10v14H7V2Z', 'M10 20h4', 'M12 16v4', 'M4 6H2v12h5'],
  reports: ['M4 19V9', 'M10 19V5', 'M16 19v-9', 'M22 19V3'],
  ai: ['M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z', 'M5 15l.9 2.1L8 18l-2.1.9L5 21l-.9-2.1L2 18l2.1-.9L5 15Z', 'M19 14l.7 1.3L21 16l-1.3.7L19 18l-.7-1.3L17 16l1.3-.7L19 14Z'],
  branches: ['M4 21V9l8-6 8 6v12', 'M9 21v-7h6v7'],
  team: ['M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2', 'M8.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M20 8v6', 'M17 11h6'],
  agreements: ['M6 3h9l3 3v15H6V3Z', 'M15 3v4h4', 'M9 11h6', 'M9 15h6'],
  feedback: ['M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8Z', 'M8 9h8', 'M8 13h5'],
  settings: ['M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.1 3.6-.2-.1a1.7 1.7 0 0 0-1.9-.2l-.9.5a1.7 1.7 0 0 0-.9 1.5V22H9.6v-.3a1.7 1.7 0 0 0-.9-1.5l-.9-.5a1.7 1.7 0 0 0-1.9.2l-.2.1L3.6 16.4l.1-.1A1.7 1.7 0 0 0 4 14.4v-1a1.7 1.7 0 0 0-.3-1.9l-.1-.1 2.1-3.6.2.1a1.7 1.7 0 0 0 1.9.2l.9-.5a1.7 1.7 0 0 0 .9-1.5V6h4.2v.3a1.7 1.7 0 0 0 .9 1.5l.9.5a1.7 1.7 0 0 0 1.9-.2l.2-.1 2.1 3.6-.1.1a1.7 1.7 0 0 0-.3 1.9v1Z'],
};

export function NavIcon({ name }: { name: NavIconName }) {
  return <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{NAV_PATHS[name].map((d, index) => <path d={d} key={`${name}-${index}`} />)}</svg>;
}

const SHELL_PATHS: Record<ShellIconName, string[]> = {
  menu: ['M4 7h16', 'M4 12h16', 'M4 17h16'],
  close: ['M6 6l12 12', 'M18 6 6 18'],
  sun: ['M12 4V2', 'M12 22v-2', 'M4.93 4.93 3.5 3.5', 'M20.5 20.5l-1.43-1.43', 'M4 12H2', 'M22 12h-2', 'M4.93 19.07 3.5 20.5', 'M20.5 3.5l-1.43 1.43', 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z'],
  moon: ['M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 9.8Z'],
  refresh: ['M20 11a8 8 0 1 0-2.34 5.66', 'M20 4v7h-7'],
  chevron: ['m8 10 4 4 4-4'],
  bell: ['M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z', 'M10 21h4'],
};

export function ShellIcon({ name }: { name: ShellIconName }) {
  return <svg className="shell-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{SHELL_PATHS[name].map((d, index) => <path d={d} key={`${name}-${index}`} />)}</svg>;
}
