import fs from 'node:fs';

const path = 'apps/mobile/src/redesign/OrdersWorkspace.tsx';
let source = fs.readFileSync(path, 'utf8');

const oldBlock = `      const activeShift = await loadActiveCashShift(tenantId, order.branchId);\n      const printers = await loadPrinters(tenantId, order.branchId, activeShift?.registerId ?? null);\n      const printer = chooseReceiptPrinter(printers);\n      if (!printer) throw new Error('Choose a single default receipt printer for this branch or register before printing.');`;
const newBlock = `      const activeShift = await loadActiveCashShift(tenantId, order.branchId);\n      const printers = await loadPrinters(tenantId, order.branchId, null);\n      const printer = chooseReceiptPrinter(printers, activeShift?.registerId ?? null);\n      if (!printer) {\n        throw new Error('No active receipt printer is available for this branch. Set one printer as default in Devices & printers, then try again.');\n      }`;
if (!source.includes(oldBlock)) throw new Error('Receipt printer lookup block not found');
source = source.replace(oldBlock, newBlock);

const oldChooser = `function chooseReceiptPrinter(printers: SellerTrayPrinter[]): SellerTrayPrinter | null {\n  const active = printers.filter((printer) => printer.isActive);\n  if (active.length === 0) return null;\n  const defaults = active.filter((printer) => printer.isDefault);\n  if (defaults.length === 1) return defaults[0] ?? null;\n  if (active.length === 1) return active[0] ?? null;\n  return null;\n}`;
const newChooser = `function chooseReceiptPrinter(\n  printers: SellerTrayPrinter[],\n  preferredRegisterId: string | null,\n): SellerTrayPrinter | null {\n  const active = printers.filter((printer) => printer.isActive);\n  if (active.length === 0) return null;\n\n  if (preferredRegisterId) {\n    const registerPrinters = active.filter((printer) => printer.registerId === preferredRegisterId);\n    const registerDefaults = registerPrinters.filter((printer) => printer.isDefault);\n    if (registerDefaults.length === 1) return registerDefaults[0] ?? null;\n    if (registerPrinters.length === 1) return registerPrinters[0] ?? null;\n  }\n\n  const branchDefaults = active.filter((printer) => printer.isDefault);\n  if (branchDefaults.length === 1) return branchDefaults[0] ?? null;\n  if (active.length === 1) return active[0] ?? null;\n  return null;\n}`;
if (!source.includes(oldChooser)) throw new Error('Receipt printer chooser not found');
source = source.replace(oldChooser, newChooser);

fs.writeFileSync(path, source);
