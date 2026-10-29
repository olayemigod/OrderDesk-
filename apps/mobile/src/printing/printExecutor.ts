import { loadPrintJob, type PrintJob, type ReceiptCopyDefinition, updatePrintJob } from '../data/printerRepository';
import { sendBluetoothPrintBytes } from './bluetoothPrinter';
import { buildEscPosPrintBytes } from './escPosReceipt';

export async function executePreparedPrintJob(tenantId: string, job: PrintJob): Promise<void> {
  if (!tenantId) throw new Error('Business is required to print.');
  if (job.status !== 'requested') {
    throw new Error('This print attempt has already started. Create a new reprint if another copy is needed.');
  }

  let started = false;
  let hardwareWriteCompleted = false;
  try {
    await updatePrintJob({ tenantId, jobId: job.jobId, status: 'printing' });
    started = true;

    const copies = receiptCopies(job);
    for (const copy of copies) {
      const snapshot = job.contentSnapshot.documentType === 'receipt' || job.contentSnapshot.documentType === 'payment_receipt'
        ? { ...job.contentSnapshot, copyLabel: copy.label }
        : job.contentSnapshot;
      const bytes = buildEscPosPrintBytes(snapshot, job.paperWidthMm);
      await sendBluetoothPrintBytes(job.hardwareIdentifier, bytes);
    }
    hardwareWriteCompleted = true;

    try {
      await updatePrintJob({ tenantId, jobId: job.jobId, status: 'printed' });
    } catch (statusError) {
      const reconciled = await reconcilePrintedStatus(tenantId, job.jobId);
      if (!reconciled) throw statusError;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The document could not be printed.';

    if (hardwareWriteCompleted) {
      const reconciled = await reconcilePrintedStatus(tenantId, job.jobId);
      if (reconciled) return;
    }

    if (started) {
      try {
        await updatePrintJob({
          tenantId,
          jobId: job.jobId,
          status: 'failed',
          failureCode: classifyPrintFailure(message),
          failureMessage: message,
        });
      } catch {
        // The commercial transaction is already complete. A status-sync failure
        // must never become a reason to replay or roll back the sale/payment.
      }
    }
    throw new Error(message);
  }
}

function receiptCopies(job: PrintJob): ReceiptCopyDefinition[] {
  if (job.contentSnapshot.documentType !== 'receipt' && job.contentSnapshot.documentType !== 'payment_receipt') {
    return [{ type: 'customer', label: '', sortOrder: 1 }];
  }
  const configured = job.contentSnapshot.copyDefinitions?.filter((copy) => copy.label.trim()) ?? [];
  return configured.length > 0
    ? [...configured].sort((a, b) => a.sortOrder - b.sortOrder)
    : [{ type: 'customer', label: 'Customer Copy', sortOrder: 1 }];
}

async function reconcilePrintedStatus(tenantId: string, jobId: string): Promise<boolean> {
  try {
    const current = await loadPrintJob(tenantId, jobId);
    return current?.status === 'printed';
  } catch {
    return false;
  }
}

function classifyPrintFailure(message: string): string {
  const value = message.toLowerCase();
  if (value.includes('permission')) return 'BLUETOOTH_PERMISSION';
  if (value.includes('turn on bluetooth') || value.includes('bluetooth is unavailable')) return 'BLUETOOTH_UNAVAILABLE';
  if (value.includes('not paired')) return 'PRINTER_NOT_PAIRED';
  if (value.includes('expo go') || value.includes('installed sellertray')) return 'NATIVE_BUILD_REQUIRED';
  if (value.includes('address is invalid')) return 'PRINTER_IDENTITY_INVALID';
  return 'PRINT_FAILED';
}
