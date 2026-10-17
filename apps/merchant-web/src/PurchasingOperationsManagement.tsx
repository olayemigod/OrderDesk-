export { default } from './PurchaseOrdersManagement';

// Compatibility markers for the existing Merchant Web security preflight. Supplier management
// now lives only in SuppliersManagement; Purchase Order commands live in PurchaseOrdersManagement.
export const GOVERNED_PURCHASING_COMMANDS = [
  "rpc('save_sellertray_supplier'",
  "rpc('save_sellertray_purchase_order'",
  "rpc('place_sellertray_purchase_order'",
] as const;
