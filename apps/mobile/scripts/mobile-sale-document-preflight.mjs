import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const orders = readFileSync(resolve(root, 'src/redesign/OrdersWorkspace.tsx'), 'utf8');
const collection = readFileSync(resolve(root, 'src/redesign/OrderBalanceCollection.tsx'), 'utf8');
const documentsPanel = readFileSync(resolve(root, 'src/redesign/OrderDocumentsPanel.tsx'), 'utf8');
const printerRepository = readFileSync(resolve(root, 'src/data/printerRepository.ts'), 'utf8');
const printExecutor = readFileSync(resolve(root, 'src/printing/printExecutor.ts'), 'utf8');
const escPos = readFileSync(resolve(root, 'src/printing/escPosReceipt.ts'), 'utf8');
const offlineHook = readFileSync(resolve(root, 'src/hooks/useOfflineSalesSync.ts'), 'utf8');
const offlineRepository = readFileSync(resolve(root, 'src/data/offlineSalesRepository.ts'), 'utf8');
const receivablesRepository = readFileSync(resolve(root, 'src/data/receivablesRepository.ts'), 'utf8');
const printerFunction = readFileSync(resolve(root, '../../supabase/functions/printer/index.ts'), 'utf8');
const receivableMigration = readFileSync(resolve(root, '../../supabase/migrations/20261016234422_phase_b_receivable_collection_command.sql'), 'utf8');
const allocationMigration = readFileSync(resolve(root, '../../supabase/migrations/20261016082241_pos_payment_allocation_runtime_convergence.sql'), 'utf8');

const failures = [];
const requireValue = (condition, message) => { if (!condition) failures.push(message); };

requireValue(orders.includes('OrderDocumentsPanel') && orders.includes('Payment: ${paymentLabel}') && orders.includes('Fulfilment: ${titleCase(order.fulfillmentStatus)}'), 'Orders must show explicit Payment and Fulfilment labels and expose the governed sale-document panel.');
requireValue(!orders.includes('requestPrintJob') && !orders.includes('Print payment receipt'), 'Orders must not retain the old paid-only receipt shortcut; sale documents belong to the governed Sale documents panel.');
requireValue(orders.includes('adjustsFontSizeToFit') && orders.includes('minimumFontScale={0.66}') && orders.includes("maxWidth: '48%'"), 'Order totals must adapt rather than overflow when monetary values are large.');
requireValue(collection.includes('adjustsFontSizeToFit') && collection.includes('Payment Receipt is available only after confirmation') && collection.includes('await onChanged()'), 'Balance collection must adapt large values, distinguish pending verification from confirmed receipt availability, and refresh authoritative order/payment state after collection.');
requireValue(collection.includes('collectCustomerBalance') && receivablesRepository.includes('collect_sellertray_customer_receivable') && receivablesRepository.includes('commandId'), 'Later customer collections must use the governed idempotent receivable command.');
requireValue(documentsPanel.includes('loadOrderFinancials') && documentsPanel.includes("payment.status === 'confirmed'") && documentsPanel.includes("payment.exceptionState === 'none'"), 'Payment receipt reprints must come from authoritative persisted payment history and only confirmed money.');
requireValue(documentsPanel.includes('requestBusinessDocumentPrint') && documentsPanel.includes('executePreparedPrintJob') && !documentsPanel.includes('sendBluetoothPrintBytes'), 'Sales Invoice and collection reprints must use the audited prepared/printing/printed/failed print-job lifecycle, never direct unaudited Bluetooth output.');
requireValue(documentsPanel.includes('order.amountPaid') && documentsPanel.includes('Pending bank verification never produces a receipt') && documentsPanel.includes('confirmedPayments.map') && documentsPanel.includes('unsettledPayments.map'), 'Mobile must refresh after collections, distinguish printable confirmed collections from pending bank verification and support multiple collections.');
requireValue(printerRepository.includes("documentType: 'sales_invoice'") && printerRepository.includes("documentType: 'payment_receipt'") && printerRepository.includes("action: 'request_business_document_print'"), 'Sales Invoice and Payment Receipt must be separate parsed business documents requested through the governed printer authority.');
requireValue(printExecutor.includes("job.contentSnapshot.documentType === 'payment_receipt'") && printExecutor.includes("status: 'printing'") && printExecutor.includes("status: 'printed'") && printExecutor.includes("status: 'failed'"), 'Payment-specific receipts must retain configured copies and every business print must transition through the audited print lifecycle.');
requireValue(printerFunction.includes("action === 'request_business_document_print'") && printerFunction.includes("document_type', 'invoice'") && printerFunction.includes("payment.status !== 'confirmed'") && printerFunction.includes("payment.exception_state !== 'none'"), 'Printer authority must resolve the issued invoice server-side and reject Payment Receipts without confirmed, exception-free payment evidence.');
requireValue(printerFunction.includes('branch_name_snapshot') && printerFunction.includes('pos_operator_name') && printerFunction.includes('subtotalAmount') && printerFunction.includes('taxAmount') && printerFunction.includes('grossAmount: invoiceAmount'), 'Server-authoritative Sales Invoice snapshots must preserve Branch/Cashier history, explicit tax and authoritative grand total.');
requireValue(printerFunction.includes("if (paymentTerms === 'partial') return 'Partial'") && printerFunction.includes("if (paymentTerms === 'pay_later') return 'Pay later'"), 'Original Partial/Pay Later settlement terms must remain on Sales Invoice reprints after later collection.');
requireValue(printerFunction.includes("job_type: 'receipt'") && printerFunction.includes('Business meaning is governed by content_snapshot.documentType'), 'The closed live print schema may use its legacy receipt audit class only when the immutable snapshot carries the real Sales Invoice/Payment Receipt meaning.');
requireValue(escPos.includes("appendCentered(bytes, 'SALES INVOICE'") && escPos.includes("appendCentered(bytes, 'PAYMENT RECEIPT'") && escPos.includes("appendKeyValue(bytes, 'Payment'") && escPos.includes("appendKeyValue(bytes, 'Fulfilment'"), 'Thermal output must identify document type and show explicit Payment and Fulfilment labels.');
requireValue(escPos.includes("cleanRight.length >= width || (cleanLeft && cleanLeft.length + cleanRight.length + 1 > width)") && escPos.includes('line.padStart(width)'), 'Thermal totals must wrap safely instead of truncating large monetary values.');
requireValue(escPos.includes("replace(/₦/g, 'NGN ')") && escPos.includes('/^(pos:|walk[- ]?in|anonymous|guest)/i'), 'Printer output must remain printer-safe and suppress internal customer sentinels.');
requireValue(offlineRepository.includes('checkoutCommandId') && offlineRepository.includes('const existing = rows.find((row) => row.clientReference === input.clientReference)'), 'Offline sales must retain deterministic checkout identity and local outbox deduplication.');
requireValue(offlineHook.includes('expectedAmountPaid') && offlineHook.includes('expectedOutstanding') && offlineHook.includes('duplicate payment allocations') && offlineHook.includes('result.idempotentReplay'), 'Offline replay must verify amount paid, retained outstanding balance, duplicate-payment protection and idempotent retries.');
requireValue(receivableMigration.includes('Payment exceeds the outstanding customer balance') && receivableMigration.includes("'receivable:'||p_command_id::text") && receivableMigration.includes("v_status:='confirmed'"), 'Receivable collection must reject overpayment, preserve command identity and create confirmed payment evidence where allowed.');
requireValue(allocationMigration.includes('where p.tenant_id=p_tenant_id and p.idempotency_key=v_key') && allocationMigration.includes('return v_existing.id'), 'Shared POS payment allocation must return the existing allocation for an idempotent replay rather than create a duplicate receivable payment.');

if (failures.length) {
  console.error('SellerTray Mobile sale-document convergence preflight failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}
console.log('SellerTray Mobile sale-document convergence preflight passed.');
