import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { errorMessage, numberValue, supabase } from './supabase';

type ProductUom = {
  id: string;
  name: string;
  conversionFactor: number;
  sellingPrice: number | null;
  barcode: string | null;
  allowFractional: boolean;
  isDefaultSelling: boolean;
  isDefaultPurchase: boolean;
};

type Product = {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  stockUom: string;
  allowFractionalStock: boolean;
  sellingPrice: number;
  isActive: boolean;
  uoms: ProductUom[];
};

type ProductRow = {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  stock_uom: string;
  allow_fractional_stock: boolean;
  price_ngn: number | string | null;
  is_active: boolean;
  catalog_item_uoms: Array<{
    id: string;
    uom_name: string;
    conversion_factor: number | string;
    selling_price: number | string | null;
    barcode: string | null;
    allow_fractional: boolean;
    is_default_selling: boolean;
    is_default_purchase: boolean;
  }> | null;
};

type ProductDraft = {
  name: string;
  sku: string;
  category: string;
  stockUom: string;
  allowFractionalStock: boolean;
  sellingPrice: string;
};

type UomDraft = {
  id: string | null;
  name: string;
  conversionFactor: string;
  sellingPrice: string;
  barcode: string;
  allowFractional: boolean;
  isDefaultSelling: boolean;
  isDefaultPurchase: boolean;
};

const EMPTY_PRODUCT: ProductDraft = {
  name: '',
  sku: '',
  category: '',
  stockUom: 'Each',
  allowFractionalStock: true,
  sellingPrice: '0',
};

const EMPTY_UOM: UomDraft = {
  id: null,
  name: '',
  conversionFactor: '1',
  sellingPrice: '',
  barcode: '',
  allowFractional: true,
  isDefaultSelling: false,
  isDefaultPurchase: false,
};

export default function ProductsManagement({ tenantId, currency }: { tenantId: string; currency: string }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [productDraft, setProductDraft] = useState<ProductDraft>(EMPTY_PRODUCT);
  const [uomDraft, setUomDraft] = useState<UomDraft>(EMPTY_UOM);
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = products.find((product) => product.id === selectedId) ?? null;
  const visibleProducts = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return products.filter((product) => {
      if (!showInactive && !product.isActive) return false;
      if (!needle) return true;
      return [product.name, product.sku ?? '', product.category ?? '', product.stockUom]
        .some((value) => value.toLocaleLowerCase().includes(needle));
    });
  }, [products, search, showInactive]);

  useEffect(() => {
    void loadProducts();
  }, [tenantId]);

  useEffect(() => {
    if (!selected) return;
    setProductDraft({
      name: selected.name,
      sku: selected.sku ?? '',
      category: selected.category ?? '',
      stockUom: selected.stockUom,
      allowFractionalStock: selected.allowFractionalStock,
      sellingPrice: String(selected.sellingPrice),
    });
    setUomDraft(EMPTY_UOM);
    setMessage(null);
    setError(null);
  }, [selectedId]);

  async function loadProducts(preferredId?: string | null) {
    setLoading(true);
    setError(null);
    try {
      const { data, error: loadError } = await supabase
        .from('catalog_items')
        .select(`
          id,name,sku,category,stock_uom,allow_fractional_stock,price_ngn,is_active,
          catalog_item_uoms(
            id,uom_name,conversion_factor,selling_price,barcode,allow_fractional,
            is_default_selling,is_default_purchase
          )
        `)
        .eq('tenant_id', tenantId)
        .order('is_active', { ascending: false })
        .order('name', { ascending: true });
      if (loadError) throw loadError;

      const next = ((data ?? []) as unknown as ProductRow[]).map(mapProduct);
      setProducts(next);
      const wanted = preferredId ?? selectedId;
      if (wanted && next.some((product) => product.id === wanted)) {
        setSelectedId(wanted);
      } else if (next.length) {
        setSelectedId(next[0].id);
      } else {
        startNewProduct();
      }
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to load products and units.'));
    } finally {
      setLoading(false);
    }
  }

  function startNewProduct() {
    setSelectedId(null);
    setProductDraft(EMPTY_PRODUCT);
    setUomDraft(EMPTY_UOM);
    setMessage(null);
    setError(null);
  }

  async function saveProduct(event: FormEvent) {
    event.preventDefault();
    const price = Number(productDraft.sellingPrice);
    if (!productDraft.name.trim() || !productDraft.stockUom.trim() || !Number.isFinite(price) || price < 0) {
      setError('Enter the product name, Stock UOM and a valid selling price.');
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const { data, error: saveError } = await supabase.rpc('save_sellertray_product', {
        p_tenant_id: tenantId,
        p_product_id: selectedId,
        p_name: productDraft.name,
        p_sku: clean(productDraft.sku),
        p_category: clean(productDraft.category),
        p_stock_uom: productDraft.stockUom,
        p_allow_fractional_stock: productDraft.allowFractionalStock,
        p_selling_price: price,
      });
      if (saveError) throw saveError;
      const productId = typeof data === 'string' ? data : selectedId;
      if (!productId) throw new Error('SellerTray did not return the product reference.');
      setSelectedId(productId);
      await loadProducts(productId);
      setMessage(selectedId ? 'Product updated.' : 'Product created.');
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to save this product.'));
    } finally {
      setSaving(false);
    }
  }

  async function changeProductActive() {
    if (!selected) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const { error: updateError } = await supabase.rpc('set_sellertray_product_active', {
        p_tenant_id: tenantId,
        p_product_id: selected.id,
        p_is_active: !selected.isActive,
      });
      if (updateError) throw updateError;
      await loadProducts(selected.id);
      setMessage(selected.isActive ? 'Product archived.' : 'Product restored.');
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to change this product.'));
    } finally {
      setSaving(false);
    }
  }

  function editUom(uom: ProductUom) {
    setUomDraft({
      id: uom.id,
      name: uom.name,
      conversionFactor: String(uom.conversionFactor),
      sellingPrice: uom.sellingPrice == null ? '' : String(uom.sellingPrice),
      barcode: uom.barcode ?? '',
      allowFractional: uom.allowFractional,
      isDefaultSelling: uom.isDefaultSelling,
      isDefaultPurchase: uom.isDefaultPurchase,
    });
    setError(null);
    setMessage(null);
  }

  async function saveUom(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    const factor = Number(uomDraft.conversionFactor);
    const price = uomDraft.sellingPrice.trim() === '' ? null : Number(uomDraft.sellingPrice);
    if (!uomDraft.name.trim() || !Number.isFinite(factor) || factor <= 0 || (price !== null && (!Number.isFinite(price) || price < 0))) {
      setError('Enter a unit name, positive conversion factor and a valid selling price.');
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const { error: saveError } = await supabase.rpc('save_sellertray_product_uom', {
        p_tenant_id: tenantId,
        p_product_id: selected.id,
        p_uom_id: uomDraft.id,
        p_uom_name: uomDraft.name,
        p_conversion_factor: factor,
        p_selling_price: price,
        p_barcode: clean(uomDraft.barcode),
        p_allow_fractional: uomDraft.allowFractional,
        p_is_default_selling: uomDraft.isDefaultSelling,
        p_is_default_purchase: uomDraft.isDefaultPurchase,
      });
      if (saveError) throw saveError;
      setUomDraft(EMPTY_UOM);
      await loadProducts(selected.id);
      setMessage('Product unit saved.');
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to save this product unit.'));
    } finally {
      setSaving(false);
    }
  }

  async function deleteUom() {
    if (!selected || !uomDraft.id) return;
    const current = selected.uoms.find((uom) => uom.id === uomDraft.id);
    if (!current || current.name.toLocaleLowerCase() === selected.stockUom.toLocaleLowerCase()) return;

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const { error: deleteError } = await supabase.rpc('delete_sellertray_product_uom', {
        p_tenant_id: tenantId,
        p_product_id: selected.id,
        p_uom_id: current.id,
      });
      if (deleteError) throw deleteError;
      setUomDraft(EMPTY_UOM);
      await loadProducts(selected.id);
      setMessage('Product unit removed.');
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to remove this product unit.'));
    } finally {
      setSaving(false);
    }
  }

  if (loading && products.length === 0) {
    return <div className="panel product-loading">Loading products and pricing…</div>;
  }

  return <div className="page-stack">
    <div className="section-heading">
      <div><p className="eyebrow">Catalogue management</p><h2>Products & Pricing</h2></div>
      <p className="muted">Manage Stock UOM, alternate units, barcodes and selling prices used by POS, WhatsApp and future sales channels.</p>
    </div>

    {error ? <div className="error-banner">{error}<button onClick={() => setError(null)}>Dismiss</button></div> : null}
    {message ? <div className="success-banner">{message}<button onClick={() => setMessage(null)}>Dismiss</button></div> : null}

    <div className="product-toolbar panel">
      <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search product, SKU or category" aria-label="Search products" />
      <label className="check-field"><input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} />Show archived products</label>
      <button className="primary-button" onClick={startNewProduct}>New product</button>
    </div>

    <div className="product-workspace">
      <aside className="panel product-list" aria-label="Products">
        <div className="panel-head"><div><p className="eyebrow">Products</p><h3>{visibleProducts.length} shown</h3></div></div>
        {visibleProducts.length ? visibleProducts.map((product) => <button
          key={product.id}
          className={selectedId === product.id ? 'product-row active' : 'product-row'}
          onClick={() => setSelectedId(product.id)}
        >
          <span><strong>{product.name}</strong><small>{[product.sku, product.category].filter(Boolean).join(' · ') || product.stockUom}</small></span>
          <span className={product.isActive ? 'status-pill good' : 'status-pill neutral'}>{product.isActive ? 'Active' : 'Archived'}</span>
        </button>) : <div className="empty-state compact"><strong>No products found</strong><p>Change the search or create a product.</p></div>}
      </aside>

      <section className="product-editor-stack">
        <form className="panel product-editor" onSubmit={saveProduct}>
          <div className="panel-head"><div><p className="eyebrow">{selected ? 'Product details' : 'New product'}</p><h3>{selected?.name ?? 'Add product'}</h3></div>{selected ? <span className={selected.isActive ? 'status-pill good' : 'status-pill neutral'}>{selected.isActive ? 'Active' : 'Archived'}</span> : null}</div>
          <div className="form-grid">
            <Field label="Product name"><input required value={productDraft.name} onChange={(event) => setProductDraft((current) => ({ ...current, name: event.target.value }))} /></Field>
            <Field label="SKU"><input value={productDraft.sku} onChange={(event) => setProductDraft((current) => ({ ...current, sku: event.target.value }))} /></Field>
            <Field label="Category"><input value={productDraft.category} onChange={(event) => setProductDraft((current) => ({ ...current, category: event.target.value }))} /></Field>
            <Field label="Stock UOM"><input required value={productDraft.stockUom} onChange={(event) => setProductDraft((current) => ({ ...current, stockUom: event.target.value }))} /></Field>
            <Field label={`Selling price (${currency})`}><input required inputMode="decimal" value={productDraft.sellingPrice} onChange={(event) => setProductDraft((current) => ({ ...current, sellingPrice: event.target.value }))} /></Field>
            <label className="check-card"><input type="checkbox" checked={productDraft.allowFractionalStock} onChange={(event) => setProductDraft((current) => ({ ...current, allowFractionalStock: event.target.checked }))} /><span><strong>Allow fractional Stock UOM</strong><small>Use when stock can be held in partial units.</small></span></label>
          </div>
          <div className="form-actions"><button className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save product'}</button>{selected ? <button type="button" className="secondary-button" disabled={saving} onClick={() => void changeProductActive()}>{selected.isActive ? 'Archive product' : 'Restore product'}</button> : null}</div>
        </form>

        {selected ? <div className="panel uom-panel">
          <div className="panel-head"><div><p className="eyebrow">Units & prices</p><h3>Product units</h3><p className="muted">Inventory remains in {selected.stockUom}. Alternate units preserve their conversion, price and barcode.</p></div><button className="secondary-button" onClick={() => setUomDraft(EMPTY_UOM)}>Add unit</button></div>
          <div className="uom-layout">
            <div className="uom-list">
              {selected.uoms.map((uom) => <button key={uom.id} className={uomDraft.id === uom.id ? 'uom-row active' : 'uom-row'} onClick={() => editUom(uom)}>
                <span><strong>{uom.name}</strong><small>1 {uom.name} = {formatNumber(uom.conversionFactor)} {selected.stockUom}</small></span>
                <span><b>{uom.sellingPrice == null ? 'No price' : money(uom.sellingPrice, currency)}</b><small>{uom.barcode || 'No barcode'}</small></span>
                <span className="uom-badges">{uom.name.toLocaleLowerCase() === selected.stockUom.toLocaleLowerCase() ? <em>Stock UOM</em> : null}{uom.isDefaultSelling ? <em>Default selling</em> : null}{uom.isDefaultPurchase ? <em>Default purchase</em> : null}</span>
              </button>)}
            </div>

            <form className="uom-editor" onSubmit={saveUom}>
              <h4>{uomDraft.id ? 'Edit unit' : 'Add alternate unit'}</h4>
              <Field label="Unit name"><input required value={uomDraft.name} onChange={(event) => setUomDraft((current) => ({ ...current, name: event.target.value }))} /></Field>
              <Field label={`Conversion to ${selected.stockUom}`}><input required inputMode="decimal" value={uomDraft.conversionFactor} onChange={(event) => setUomDraft((current) => ({ ...current, conversionFactor: event.target.value }))} /></Field>
              <Field label={`Selling price (${currency})`}><input inputMode="decimal" value={uomDraft.sellingPrice} onChange={(event) => setUomDraft((current) => ({ ...current, sellingPrice: event.target.value }))} placeholder="Optional" /></Field>
              <Field label="Barcode"><input value={uomDraft.barcode} onChange={(event) => setUomDraft((current) => ({ ...current, barcode: event.target.value }))} placeholder="Optional" /></Field>
              <label className="check-field"><input type="checkbox" checked={uomDraft.allowFractional} onChange={(event) => setUomDraft((current) => ({ ...current, allowFractional: event.target.checked }))} />Allow fractional quantity</label>
              <label className="check-field"><input type="checkbox" checked={uomDraft.isDefaultSelling} onChange={(event) => setUomDraft((current) => ({ ...current, isDefaultSelling: event.target.checked }))} />Default selling unit</label>
              <label className="check-field"><input type="checkbox" checked={uomDraft.isDefaultPurchase} onChange={(event) => setUomDraft((current) => ({ ...current, isDefaultPurchase: event.target.checked }))} />Default purchase unit</label>
              <div className="form-actions"><button className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save unit'}</button>{uomDraft.id && uomDraft.name.toLocaleLowerCase() !== selected.stockUom.toLocaleLowerCase() ? <button type="button" className="danger-button" disabled={saving} onClick={() => void deleteUom()}>Remove unit</button> : null}</div>
            </form>
          </div>
        </div> : <div className="panel empty-state"><strong>Save the product first</strong><p>After the product is created, you can add alternate units, prices and barcodes.</p></div>}
      </section>
    </div>
  </div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function mapProduct(row: ProductRow): Product {
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    category: row.category,
    stockUom: row.stock_uom,
    allowFractionalStock: row.allow_fractional_stock,
    sellingPrice: numberValue(row.price_ngn),
    isActive: row.is_active,
    uoms: (row.catalog_item_uoms ?? []).map((uom) => ({
      id: uom.id,
      name: uom.uom_name,
      conversionFactor: numberValue(uom.conversion_factor),
      sellingPrice: uom.selling_price == null ? null : numberValue(uom.selling_price),
      barcode: uom.barcode,
      allowFractional: uom.allow_fractional,
      isDefaultSelling: uom.is_default_selling,
      isDefaultPurchase: uom.is_default_purchase,
    })).sort((left, right) => {
      const leftStock = left.name.toLocaleLowerCase() === row.stock_uom.toLocaleLowerCase();
      const rightStock = right.name.toLocaleLowerCase() === row.stock_uom.toLocaleLowerCase();
      if (leftStock !== rightStock) return leftStock ? -1 : 1;
      if (left.isDefaultSelling !== right.isDefaultSelling) return left.isDefaultSelling ? -1 : 1;
      return left.conversionFactor - right.conversionFactor || left.name.localeCompare(right.name);
    }),
  };
}

function clean(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-NG', { maximumFractionDigits: 6 }).format(value);
}

function money(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-NG', { style: 'currency', currency: currency || 'NGN', maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency || 'NGN'} ${new Intl.NumberFormat('en-NG', { maximumFractionDigits: 2 }).format(value)}`;
  }
}
