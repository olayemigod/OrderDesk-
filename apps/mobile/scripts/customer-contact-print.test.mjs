import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { buildEscPosPrintBytes } from '../src/printing/escPosReceipt.ts';
import {
  customerContactPhone,
  customerPublicName,
} from '../../../supabase/functions/_shared/customerContact.ts';

const reservedId = 'manual:unlinked:20f0de88-dbbb-41a5-a0dd-a96260b835fd';
const validPhone = '+2348012345678';
const backendPrinter = readFileSync(resolve(import.meta.dirname,'../../../supabase/functions/printer/index.ts'),'utf8');
const pdfDocument = readFileSync(resolve(import.meta.dirname,'../../../supabase/functions/financial-document/index.ts'),'utf8');
const mobileOrders = readFileSync(resolve(import.meta.dirname,'../src/data/ordersRepository.ts'),'utf8');

test('Phone-less customer remains a named Customer without exposing reserved identifiers',()=>{
  assert.equal(customerContactPhone(null,reservedId),null);
  assert.equal(customerContactPhone('', 'pos:walk-in'),null);
  assert.equal(customerContactPhone(null,'pos:1234567'),null);
  assert.equal(customerPublicName('Customer Without Phone',null,reservedId),'Customer Without Phone');
  assert.equal(customerPublicName(null,null,reservedId),'Customer');
  assert.equal(customerContactPhone(null,'2348012345678'),'2348012345678');
  assert.equal(customerContactPhone(validPhone,reservedId),validPhone);
  assert.equal(customerPublicName('',null,validPhone),validPhone);
  assert.equal(customerContactPhone('invalid',reservedId),null);
});

test('Every financial/printer/Order mapper consumes safe public phone and name projection',()=>{
  assert.match(backendPrinter,/import \{ customerContactPhone, customerPublicName \}/);
  assert.match(backendPrinter,/customerPhone = customerContactPhone\(customer\.phone, customer\.wa_id\)/);
  assert.match(pdfDocument,/customer_phone: customerContactPhone\(customer\.phone, customer\.wa_id\)/);
  assert.match(pdfDocument,/customer_name: customerPublicName\(customer\.display_name, customer\.phone, customer\.wa_id\)/);
  assert.match(mobileOrders,/customerContactPhone\(\{ phone: customer\.phone, whatsappId: customer\.wa_id \}\)/);
  assert.doesNotMatch(mobileOrders,/customerPhone: customer\?\.phone \|\| customer\?\.wa_id/);
});

for (const paperWidth of [58,80]) {
  for (const documentType of ['sales_invoice','payment_receipt']) {
    test(`${paperWidth}mm ${documentType} excludes reserved ID from actual ESC/POS print bytes`,()=>{
      const base = {
        formatVersion:1, documentType, businessName:'Test Merchant',
        businessPhone:null,businessEmail:null,branchName:'Main Branch',
        cashierName:'Cashier',orderReference:'ST/MER/00001',
        issuedAt:'2026-11-03T12:00:00.000Z',customerName:'Customer Without Phone',
        customerPhone:reservedId, currency:'NGN', paymentLabel:'Confirmed',
        fulfillmentLabel:'Collected',platformAttribution:'Powered by SellerTray',
      };
      const snapshot = documentType==='sales_invoice'
        ? {...base,invoiceReference:'ST-INV-0001',subtotalAmount:1500,taxApplied:false,
            taxRatePercent:0,taxAmount:0,taxDisplayBreakdown:false,grossAmount:1500,
            items:[{name:'Rice',quantity:1,uom:'bag',unitPrice:1500,lineTotal:1500}]}
        : {...base,paymentId:'20f0de88-dbbb-41a5-a0dd-a96260b835fd',
            paymentReference:'ST-PAY-0001',amountReceived:1500,
            paymentMethod:'cash',paymentProvider:'pos_cash'};
      const output=Buffer.from(buildEscPosPrintBytes(snapshot,paperWidth)).toString('latin1');
      assert.match(output,/Customer Without Phone/);
      assert.doesNotMatch(output,/manual:|unlinked:|20f0de88/);
      assert.doesNotMatch(output,/Phone:/);
      const normal = Buffer.from(buildEscPosPrintBytes({...snapshot,customerPhone:validPhone},paperWidth)).toString('latin1');
      assert.match(normal,/Phone:/);
      assert.match(normal,/2348012345678/);
      assert.doesNotMatch(normal,/manual:unlinked:/);
    });
  }
}
