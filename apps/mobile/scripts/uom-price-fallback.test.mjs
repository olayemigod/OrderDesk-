import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSellerTrayUnitPrice, stockUnitSellingPrice } from '../src/domain/uomPrice.ts';

test('an omitted price derives using product-specific Stock UOM conversion', () => {
  assert.equal(resolveSellerTrayUnitPrice(null, 500, 12), 6000);
  assert.equal(resolveSellerTrayUnitPrice(null, '250.00', '6'), 1500);
  assert.equal(resolveSellerTrayUnitPrice(null, 1.25, 0.5), 0.63);
  assert.equal(resolveSellerTrayUnitPrice(null, 0.5, 0.29), 0.15);
  assert.equal(resolveSellerTrayUnitPrice(null, 1.5, 0.01), 0.02);
  assert.equal(resolveSellerTrayUnitPrice(null, 0.01, 0.5), 0.01);
});

test('an explicitly entered UOM price wins even if different from conversion', () => {
  assert.equal(resolveSellerTrayUnitPrice(5500, 500, 12), 5500);
  assert.equal(resolveSellerTrayUnitPrice('0', 500, 12), 0);
  assert.equal(resolveSellerTrayUnitPrice(200, 0, 12), 200);
});

test('a missing or invalid base/conversion never invents a sale price', () => {
  assert.equal(resolveSellerTrayUnitPrice(null, null, 12), null);
  assert.equal(resolveSellerTrayUnitPrice(null, '', 12), null);
  assert.equal(resolveSellerTrayUnitPrice(null, 500, 0), null);
  assert.equal(resolveSellerTrayUnitPrice(null, 500, -3), null);
  assert.equal(resolveSellerTrayUnitPrice(null, 500, 'not-a-unit'), null);
});

test('recalculation follows the latest base price, not a previously generated override', () => {
  assert.equal(resolveSellerTrayUnitPrice(null, 500, 12), 6000);
  assert.equal(resolveSellerTrayUnitPrice(null, 600, 12), 7200);
  assert.equal(resolveSellerTrayUnitPrice(5500, 600, 12), 5500);
});

test('product base editor never writes calculated default-selling alternate UOM price', () => {
  const stock = { isStockUom: true, isDefaultSelling: false, sellingPrice: 250 };
  const defaultPack = { isStockUom: false, isDefaultSelling: true, sellingPrice: 1500 };
  assert.equal(stockUnitSellingPrice([defaultPack, stock]), 250);
  assert.equal(stockUnitSellingPrice([stock, defaultPack]), 250);
  assert.equal(stockUnitSellingPrice([defaultPack]), null);
  assert.equal(stockUnitSellingPrice([{ ...stock, sellingPrice: 0 }, defaultPack]), 0);
});
