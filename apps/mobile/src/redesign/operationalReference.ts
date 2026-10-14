export type OperationalReferenceKind =
  | 'receive'
  | 'adjust'
  | 'purchase_receipt'
  | 'stock_count'
  | 'stock_transfer';

const PREFIX: Record<OperationalReferenceKind, string> = {
  receive: 'RCV',
  adjust: 'ADJ',
  purchase_receipt: 'PORCV',
  stock_count: 'COUNT',
  stock_transfer: 'TRF',
};

export function createOperationalReference(kind: OperationalReferenceKind): string {
  const now = new Date();
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('');
  const time = [
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');
  const random = Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, '0');
  return `${PREFIX[kind]}-${date}-${time}-${random}`;
}
