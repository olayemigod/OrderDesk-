import { useEffect, useRef, useState, type Dispatch, type FormEvent, type ReactNode, type SetStateAction } from 'react';
import ProductActivity from './ProductActivity';
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

type ProductBranchStock = {
  branchId: string;
  branchCode: string;
  branchName: string;
  isDefault: boolean;
  isActive: boolean;
  quantityOnHand: number;
  lastMovementAt: string | null;
};

type ProductListItem = {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  stockUom: string;
  sellingPrice: number | null;
  isActive: boolean;
  unitCount: number;
  barcodeCount: number;
};

type ProductDetail = ProductListItem & {
  allowFractionalStock: boolean;
  createdAt: string;
  updatedAt: string;
  uoms: ProductUom[];
  branchStock: ProductBranchStock[];
};

type ProductPage = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  categories: string[];
  uoms: string[];
  items: ProductListItem[];
};

type CatalogueMasterOption = { id: string; name: string };
type CatalogueMasters = { categories: CatalogueMasterOption[]; uoms: CatalogueMasterOption[] };

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

type ProductStatus = 'active' | 'archived' | 'all';
type ProductTab = 'overview' | 'units' | 'pricing' | 'stock' | 'activity';

const PAGE_SIZE = 25;
const EMPTY_PAGE: ProductPage = {
  page: 1,
  pageSize: PAGE_SIZE,
  total: 0,
  totalPages: 1,
  categories: [],
  uoms: [],
  items: [],
};
const EMPTY_MASTERS: CatalogueMasters = { categories: [], uoms: [] };
const EMPTY_PRODUCT: ProductDraft = {
  name: '',
  sku: '',
  category: '',
  stockUom: 'Each',
  allowFractionalStock: true,
  sellingPrice: '',
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

export default function ProductsManagement({
  tenantId,
  currency,
}: {
  tenantId: string;
  currency: string;
}) {
  const [result, setResult] = useState<ProductPage>(EMPTY_PAGE);
  const [masters, setMasters] = useState<CatalogueMasters>(EMPTY_MASTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<ProductTab>('overview');
  const [productDraft, setProductDraft] = useState<ProductDraft>(EMPTY_PRODUCT);
  const [uomDraft, setUomDraft] = useState<UomDraft>(EMPTY_UOM);
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ProductStatus>('active');
  const [category, setCategory] = useState('');
  const [uom, setUom] = useState('');
  const [missingBarcode, setMissingBarcode] = useState(false);
  const [missingPrice, setMissingPrice] = useState(false);
  const [page, setPage] = useState(1);
  const [listLoading, setListLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [masterLoading, setMasterLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [masterSaving, setMasterSaving] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [newUom, setNewUom] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listRequest = useRef(0);
  const detailRequest = useRef(0);

  useEffect(() => {
    setSelectedId(null);
    setDetail(null);
    setCreating(false);
    setSearchDraft('');
    setSearch('');
    setStatus('active');
    setCategory('');
    setUom('');
    setMissingBarcode(false);
    setMissingPrice(false);
    setPage(1);
    setMasters(EMPTY_MASTERS);
    setNewCategory('');
    setNewUom('');
    void loadMasters();
  }, [tenantId]);

  useEffect(() => {
    void loadPage();
  }, [tenantId, search, status, category, uom, missingBarcode, missingPrice, page]);

  useEffect(() => {
    if (!selectedId || creating) {
      setDetail(null);
      return;
    }
    void loadDetail(selectedId);
  }, [tenantId, selectedId, creating]);

  async function loadMasters() {
    setMasterLoading(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_sellertray_catalogue_master_data', {
        p_tenant_id: tenantId,
      });
      if (rpcError) throw rpcError;
      setMasters(parseMasters(data));
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to load product categories and units.'));
    } finally {
      setMasterLoading(false);
    }
  }

  async function loadPage(preferredId?: string | null) {
    const requestId = ++listRequest.current;
    setListLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_sellertray_product_management_page', {
        p_tenant_id: tenantId,
        p_search: clean(search),
        p_status: status,
        p_category: clean(category),
        p_uom: clean(uom),
        p_missing_barcode: missingBarcode,
        p_missing_price: missingPrice,
        p_page: page,
        p_page_size: PAGE_SIZE,
      });
      if (rpcError) throw rpcError;
      if (requestId !== listRequest.current) return;
      const next = parsePage(data);
      setResult(next);
      if (next.page !== page) setPage(next.page);
      if (!creating) {
        const wanted = preferredId ?? selectedId;
        if (wanted && next.items.some((item) => item.id === wanted)) {
          setSelectedId(wanted);
        } else if (!wanted || selectedId !== wanted || !detail) {
          setSelectedId(next.items[0]?.id ?? null);
        }
      }
    } catch (cause) {
      if (requestId === listRequest.current) setError(errorMessage(cause, 'Unable to load products.'));
    } finally {
      if (requestId === listRequest.current) setListLoading(false);
    }
  }

  async function loadDetail(productId: string) {
    const requestId = ++detailRequest.current;
    setDetailLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_sellertray_product_management_detail', {
        p_tenant_id: tenantId,
        p_product_id: productId,
      });
      if (rpcError) throw rpcError;
      if (requestId !== detailRequest.current) return;
      const next = parseDetail(data);
      setDetail(next);
      setProductDraft({
        name: next.name,
        sku: next.sku ?? '',
        category: next.category ?? '',
        stockUom: next.stockUom,
        allowFractionalStock: next.allowFractionalStock,
        sellingPrice: next.sellingPrice == null ? '' : String(next.sellingPrice),
      });
      setUomDraft(EMPTY_UOM);
    } catch (cause) {
      if (requestId === detailRequest.current) setError(errorMessage(cause, 'Unable to load this product.'));
    } finally {
      if (requestId === detailRequest.current) setDetailLoading(false);
    }
  }

  function openProduct(productId: string) {
    setCreating(false);
    setSelectedId(productId);
    setTab('overview');
    setMessage(null);
    setError(null);
  }

  function startNewProduct() {
    detailRequest.current += 1;
    setCreating(true);
    setSelectedId(null);
    setDetail(null);
    setTab('overview');
    const defaultUom = masters.uoms.find((item) => item.name.toLowerCase() === 'each')?.name
      ?? masters.uoms[0]?.name
      ?? EMPTY_PRODUCT.stockUom;
    setProductDraft({ ...EMPTY_PRODUCT, stockUom: defaultUom });
    setUomDraft(EMPTY_UOM);
    setMessage(null);
    setError(null);
  }

  function applySearch(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setSearch(searchDraft.trim());
  }

  function resetFilters() {
    setSearchDraft('');
    setSearch('');
    setStatus('active');
    setCategory('');
    setUom('');
    setMissingBarcode(false);
    setMissingPrice(false);
    setPage(1);
  }

  async function createCategory(event: FormEvent) {
    event.preventDefault();
    const name = newCategory.trim();
    if (!name || masterSaving) return;
    setMasterSaving(true);
    setError(null);
    setMessage(null);
    try {
      const { error: rpcError } = await supabase.rpc('create_sellertray_product_category', { p_tenant_id: tenantId, p_name: name });
      if (rpcError) throw rpcError;
      setNewCategory('');
      await loadMasters();
      setMessage(`Category “${name}” is available for products.`);
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to create this product category.'));
    } finally {
      setMasterSaving(false);
    }
  }

  async function createBusinessUom(event: FormEvent) {
    event.preventDefault();
    const name = newUom.trim();
    if (!name || masterSaving) return;
    setMasterSaving(true);
    setError(null);
    setMessage(null);
    try {
      const { error: rpcError } = await supabase.rpc('create_sellertray_business_uom', { p_tenant_id: tenantId, p_name: name });
      if (rpcError) throw rpcError;
      setNewUom('');
      await loadMasters();
      setMessage(`Unit “${name}” is available for products.`);
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to create this Business unit.'));
    } finally {
      setMasterSaving(false);
    }
  }

  async function saveProduct(event: FormEvent) {
    event.preventDefault();
    const price = Number(productDraft.sellingPrice);
    if (!productDraft.name.trim() || !productDraft.stockUom.trim() || productDraft.sellingPrice.trim() === '' || !Number.isFinite(price) || price < 0) {
      setError('Enter the product name, Stock UOM and a valid selling price.');
      return;
    }

    const existingId = creating ? null : detail?.id ?? selectedId;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const { data, error: saveError } = await supabase.rpc('save_sellertray_product', {
        p_tenant_id: tenantId,
        p_product_id: existingId,
        p_name: productDraft.name,
        p_sku: clean(productDraft.sku),
        p_category: clean(productDraft.category),
        p_stock_uom: productDraft.stockUom,
        p_allow_fractional_stock: productDraft.allowFractionalStock,
        p_selling_price: price,
      });
      if (saveError) throw saveError;
      const productId = typeof data === 'string' ? data : existingId;
      if (!productId) throw new Error('SellerTray did not return the product reference.');
      setCreating(false);
      setSelectedId(productId);
      setTab('overview');
      await Promise.all([loadDetail(productId), loadPage(productId)]);
      setMessage(existingId ? 'Product updated.' : 'Product created. Stock has not been added.');
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to save this product.'));
    } finally {
      setSaving(false);
    }
  }

  async function changeProductActive() {
    if (!detail) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const nextActive = !detail.isActive;
      const { error: updateError } = await supabase.rpc('set_sellertray_product_active', {
        p_tenant_id: tenantId,
        p_product_id: detail.id,
        p_is_active: nextActive,
      });
      if (updateError) throw updateError;
      await Promise.all([loadDetail(detail.id), loadPage(detail.id)]);
      setMessage(nextActive ? 'Product restored.' : 'Product archived.');
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to change this product.'));
    } finally {
      setSaving(false);
    }
  }

  function editUom(item: ProductUom) {
    setTab('units');
    setUomDraft({
      id: item.id,
      name: item.name,
      conversionFactor: String(item.conversionFactor),
      sellingPrice: item.sellingPrice == null ? '' : String(item.sellingPrice),
      barcode: item.barcode ?? '',
      allowFractional: item.allowFractional,
      isDefaultSelling: item.isDefaultSelling,
      isDefaultPurchase: item.isDefaultPurchase,
    });
    setError(null);
    setMessage(null);
  }

  async function saveUom(event: FormEvent) {
    event.preventDefault();
    if (!detail) return;
    const factor = Number(uomDraft.conversionFactor);
    const price = uomDraft.sellingPrice.trim() === '' ? null : Number(uomDraft.sellingPrice);
    if (!uomDraft.name.trim() || !Number.isFinite(factor) || factor <= 0 || (price !== null && (!Number.isFinite(price) || price < 0))) {
      setError('Select a unit, enter a positive conversion factor and a valid selling price.');
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const { error: saveError } = await supabase.rpc('save_sellertray_product_uom', {
        p_tenant_id: tenantId,
        p_product_id: detail.id,
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
      await Promise.all([loadDetail(detail.id), loadPage(detail.id)]);
      setMessage('Product unit saved.');
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to save this product unit.'));
    } finally {
      setSaving(false);
    }
  }

  async function deleteUom() {
    if (!detail || !uomDraft.id) return;
    const current = detail.uoms.find((item) => item.id === uomDraft.id);
    if (!current || current.name.toLocaleLowerCase() === detail.stockUom.toLocaleLowerCase()) return;

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const { error: deleteError } = await supabase.rpc('delete_sellertray_product_uom', {
        p_tenant_id: tenantId,
        p_product_id: detail.id,
        p_uom_id: current.id,
      });
      if (deleteError) throw deleteError;
      setUomDraft(EMPTY_UOM);
      await Promise.all([loadDetail(detail.id), loadPage(detail.id)]);
      setMessage('Product unit removed.');
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to remove this product unit.'));
    } finally {
      setSaving(false);
    }
  }

  const hasFilters = Boolean(search || category || uom || missingBarcode || missingPrice || status !== 'active');

  return <div className="page-stack products-management">
    <div className="products-heading">
      <div>
        <p className="eyebrow">Catalogue management</p>
        <h2>Products</h2>
        <p className="muted">Manage product definitions, governed categories and units, barcodes and selling prices shared by POS and WhatsApp.</p>
      </div>
      <button className="primary-button" type="button" onClick={startNewProduct}>Add Product</button>
    </div>

    {error ? <div className="error-banner">{error}<button type="button" onClick={() => setError(null)}>Dismiss</button></div> : null}
    {message ? <div className="success-banner">{message}<button type="button" onClick={() => setMessage(null)}>Dismiss</button></div> : null}

    <section className="panel" aria-label="Catalogue masters">
      <div className="panel-head">
        <div><p className="eyebrow">Catalogue masters</p><h3>Categories & Units</h3><p className="muted">Create reusable Business values here, then select them on products. Product creation never creates master data implicitly.</p></div>
        <span className="muted">{masterLoading ? 'Refreshing…' : `${masters.categories.length} categories · ${masters.uoms.length} units`}</span>
      </div>
      <div className="form-grid">
        <form className="product-search" onSubmit={createCategory}>
          <input value={newCategory} onChange={(event) => setNewCategory(event.target.value)} placeholder="New product category" aria-label="New product category" />
          <button className="secondary-button" type="submit" disabled={masterSaving || !newCategory.trim()}>{masterSaving ? 'Saving…' : 'Add Category'}</button>
        </form>
        <form className="product-search" onSubmit={createBusinessUom}>
          <input value={newUom} onChange={(event) => setNewUom(event.target.value)} placeholder="New unit, e.g. Carton" aria-label="New Business unit" />
          <button className="secondary-button" type="submit" disabled={masterSaving || !newUom.trim()}>{masterSaving ? 'Saving…' : 'Add Unit'}</button>
        </form>
      </div>
    </section>

    <section className="panel product-filter-panel" aria-label="Product filters">
      <form className="product-search" onSubmit={applySearch}>
        <input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Search product, SKU or barcode" aria-label="Search products" />
        <button className="secondary-button" type="submit">Search</button>
      </form>
      <div className="product-filter-grid">
        <label className="select-field"><span>Status</span><select value={status} onChange={(event) => { setStatus(event.target.value as ProductStatus); setPage(1); }}>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
          <option value="all">All products</option>
        </select></label>
        <label className="select-field"><span>Category</span><select value={category} onChange={(event) => { setCategory(event.target.value); setPage(1); }}>
          <option value="">All categories</option>
          {result.categories.map((value) => <option key={value} value={value}>{value}</option>)}
        </select></label>
        <label className="select-field"><span>Unit</span><select value={uom} onChange={(event) => { setUom(event.target.value); setPage(1); }}>
          <option value="">All units</option>
          {result.uoms.map((value) => <option key={value} value={value}>{value}</option>)}
        </select></label>
        <label className="check-field product-filter-check"><input type="checkbox" checked={missingBarcode} onChange={(event) => { setMissingBarcode(event.target.checked); setPage(1); }} />Missing barcode</label>
        <label className="check-field product-filter-check"><input type="checkbox" checked={missingPrice} onChange={(event) => { setMissingPrice(event.target.checked); setPage(1); }} />Missing price</label>
        {hasFilters ? <button className="text-button product-clear-filters" type="button" onClick={resetFilters}>Clear filters</button> : null}
      </div>
    </section>

    <section className="panel product-results-panel">
      <div className="product-results-head">
        <div><p className="eyebrow">Catalogue</p><h3>{formatNumber(result.total)} {result.total === 1 ? 'product' : 'products'}</h3></div>
        <span className="muted">{listLoading ? 'Refreshing…' : `Page ${result.page} of ${result.totalPages}`}</span>
      </div>

      {listLoading && result.items.length === 0 ? <div className="product-loading">Loading products…</div> : null}
      {!listLoading && result.items.length === 0 ? <div className="empty-state product-empty"><strong>No products found</strong><p>Change the filters or add a new product.</p></div> : null}

      {result.items.length ? <>
        <div className="product-table-wrap">
          <table className="product-table">
            <thead><tr><th>Product</th><th>SKU</th><th>Category</th><th>Stock UOM</th><th>Price</th><th>Barcodes</th><th>Status</th><th /></tr></thead>
            <tbody>{result.items.map((item) => <tr key={item.id} className={selectedId === item.id && !creating ? 'selected' : ''}>
              <td><button className="product-name-button" type="button" onClick={() => openProduct(item.id)}><strong>{item.name}</strong><small>{item.unitCount} {item.unitCount === 1 ? 'unit' : 'units'}</small></button></td>
              <td>{item.sku || '—'}</td>
              <td>{item.category || '—'}</td>
              <td>{item.stockUom}</td>
              <td>{item.sellingPrice == null ? <span className="product-warning">Missing</span> : money(item.sellingPrice, currency)}</td>
              <td>{item.barcodeCount ? formatNumber(item.barcodeCount) : <span className="product-warning">None</span>}</td>
              <td><span className={item.isActive ? 'status-pill good' : 'status-pill neutral'}>{item.isActive ? 'Active' : 'Archived'}</span></td>
              <td><button className="text-button" type="button" onClick={() => openProduct(item.id)}>Open</button></td>
            </tr>)}</tbody>
          </table>
        </div>

        <div className="product-card-list" aria-label="Products">
          {result.items.map((item) => <button key={item.id} type="button" className={selectedId === item.id && !creating ? 'product-card selected' : 'product-card'} onClick={() => openProduct(item.id)}>
            <div className="product-card-title"><strong>{item.name}</strong><span className={item.isActive ? 'status-pill good' : 'status-pill neutral'}>{item.isActive ? 'Active' : 'Archived'}</span></div>
            <span>{item.sku || 'No SKU'} · {item.category || 'No category'}</span>
            <div className="product-card-meta"><b>{item.sellingPrice == null ? 'Missing price' : money(item.sellingPrice, currency)}</b><span>{item.stockUom} · {item.barcodeCount} barcode{item.barcodeCount === 1 ? '' : 's'}</span></div>
          </button>)}
        </div>

        <div className="product-pagination">
          <button className="secondary-button" type="button" disabled={listLoading || result.page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button>
          <span>Showing {(result.page - 1) * result.pageSize + 1}–{Math.min(result.page * result.pageSize, result.total)} of {formatNumber(result.total)}</span>
          <button className="secondary-button" type="button" disabled={listLoading || result.page >= result.totalPages} onClick={() => setPage((current) => current + 1)}>Next</button>
        </div>
      </> : null}
    </section>

    <section className="product-detail-area">
      {creating ? <ProductOverviewForm
        title="Add product"
        draft={productDraft}
        setDraft={setProductDraft}
        currency={currency}
        categories={masters.categories}
        uoms={masters.uoms}
        saving={saving}
        onSubmit={saveProduct}
        note="Creating a product defines the catalogue item only. It does not add opening stock or change inventory."
      /> : null}

      {!creating && selectedId && detailLoading && !detail ? <div className="panel product-loading">Loading product details…</div> : null}

      {!creating && detail ? <>
        <div className="panel product-detail-header">
          <div>
            <div className="product-detail-title"><h3>{detail.name}</h3><span className={detail.isActive ? 'status-pill good' : 'status-pill neutral'}>{detail.isActive ? 'Active' : 'Archived'}</span></div>
            <p className="muted">{[detail.sku, detail.category, detail.stockUom].filter(Boolean).join(' · ')}</p>
          </div>
          <button className="secondary-button" type="button" disabled={saving} onClick={() => void changeProductActive()}>{detail.isActive ? 'Archive product' : 'Restore product'}</button>
        </div>

        <div className="product-tabs" role="tablist" aria-label="Product management">
          <TabButton id="overview" label="Overview" active={tab} onClick={setTab} />
          <TabButton id="units" label="Units & Barcodes" active={tab} onClick={setTab} />
          <TabButton id="pricing" label="Pricing" active={tab} onClick={setTab} />
          <TabButton id="stock" label="Stock" active={tab} onClick={setTab} />
          <TabButton id="activity" label="Activity" active={tab} onClick={setTab} />
        </div>

        {tab === 'overview' ? <ProductOverviewForm
          title="Product details"
          draft={productDraft}
          setDraft={setProductDraft}
          currency={currency}
          categories={masters.categories}
          uoms={masters.uoms}
          saving={saving}
          onSubmit={saveProduct}
          detail={detail}
        /> : null}

        {tab === 'units' ? <section className="panel uom-panel">
          <div className="panel-head">
            <div><p className="eyebrow">Units & barcodes</p><h3>Product units</h3><p className="muted">Inventory remains in {detail.stockUom}. Each configured unit can carry its governed conversion, price and barcode.</p></div>
            <button className="secondary-button" type="button" onClick={() => setUomDraft(EMPTY_UOM)}>Add unit</button>
          </div>
          <div className="uom-layout">
            <div className="uom-list">
              {detail.uoms.map((item) => <button key={item.id} type="button" className={uomDraft.id === item.id ? 'uom-row active' : 'uom-row'} onClick={() => editUom(item)}>
                <span><strong>{item.name}</strong><small>1 {item.name} = {formatNumber(item.conversionFactor)} {detail.stockUom}</small></span>
                <span><b>{item.sellingPrice == null ? 'No price' : money(item.sellingPrice, currency)}</b><small>{item.barcode || 'No barcode'}</small></span>
                <span className="uom-badges">{item.name.toLocaleLowerCase() === detail.stockUom.toLocaleLowerCase() ? <em>Stock UOM</em> : null}{item.isDefaultSelling ? <em>Default selling</em> : null}{item.isDefaultPurchase ? <em>Default purchase</em> : null}</span>
              </button>)}
            </div>
            <form className="uom-editor" onSubmit={saveUom}>
              <h4>{uomDraft.id ? 'Edit unit' : 'Add alternate unit'}</h4>
              <Field label="Unit name"><select required value={uomDraft.name} onChange={(event) => setUomDraft((current) => ({ ...current, name: event.target.value }))}><option value="">Select unit</option>{masters.uoms.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select></Field>
              <Field label={`Conversion to ${detail.stockUom}`}><input required inputMode="decimal" value={uomDraft.conversionFactor} onChange={(event) => setUomDraft((current) => ({ ...current, conversionFactor: event.target.value }))} /></Field>
              <Field label={`Selling price (${currency})`}><input inputMode="decimal" value={uomDraft.sellingPrice} onChange={(event) => setUomDraft((current) => ({ ...current, sellingPrice: event.target.value }))} placeholder="Optional" /></Field>
              <Field label="Barcode"><input value={uomDraft.barcode} onChange={(event) => setUomDraft((current) => ({ ...current, barcode: event.target.value }))} placeholder="Optional" /></Field>
              <label className="check-field"><input type="checkbox" checked={uomDraft.allowFractional} onChange={(event) => setUomDraft((current) => ({ ...current, allowFractional: event.target.checked }))} />Allow fractional quantity</label>
              <label className="check-field"><input type="checkbox" checked={uomDraft.isDefaultSelling} onChange={(event) => setUomDraft((current) => ({ ...current, isDefaultSelling: event.target.checked }))} />Default selling unit</label>
              <label className="check-field"><input type="checkbox" checked={uomDraft.isDefaultPurchase} onChange={(event) => setUomDraft((current) => ({ ...current, isDefaultPurchase: event.target.checked }))} />Default purchase unit</label>
              <div className="form-actions">
                <button className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save unit'}</button>
                {uomDraft.id && uomDraft.name.toLocaleLowerCase() !== detail.stockUom.toLocaleLowerCase() ? <button type="button" className="danger-button" disabled={saving} onClick={() => void deleteUom()}>Remove unit</button> : null}
              </div>
            </form>
          </div>
        </section> : null}

        {tab === 'pricing' ? <section className="panel product-pricing-panel">
          <div className="panel-head"><div><p className="eyebrow">Pricing</p><h3>Selling prices</h3><p className="muted">Base and unit-specific prices use the same governed Product and UOM configuration.</p></div></div>
          <div className="product-price-summary"><span>Default product price</span><strong>{detail.sellingPrice == null ? 'Not set' : money(detail.sellingPrice, currency)}</strong></div>
          <div className="table-wrap"><table className="compact-table"><thead><tr><th>Unit</th><th>Conversion</th><th>Selling price</th><th>Default</th><th /></tr></thead><tbody>
            {detail.uoms.map((item) => <tr key={item.id}><td><strong>{item.name}</strong></td><td>{formatNumber(item.conversionFactor)} {detail.stockUom}</td><td>{item.sellingPrice == null ? '—' : money(item.sellingPrice, currency)}</td><td>{item.isDefaultSelling ? 'Selling' : item.isDefaultPurchase ? 'Purchase' : '—'}</td><td><button className="text-button" type="button" onClick={() => editUom(item)}>Edit unit</button></td></tr>)}
          </tbody></table></div>
        </section> : null}

        {tab === 'stock' ? <section className="panel product-stock-panel">
          <div className="panel-head"><div><p className="eyebrow">Stock</p><h3>Branch inventory</h3><p className="muted">Read-only on-hand stock from the governed inventory ledger. Product setup does not maintain a separate quantity.</p></div><div className="product-price-summary"><span>Total readable stock</span><strong>{formatNumber(detail.branchStock.reduce((sum, branch) => sum + branch.quantityOnHand, 0))} {detail.stockUom}</strong></div></div>
          {detail.branchStock.length ? <div className="table-wrap"><table className="compact-table"><thead><tr><th>Branch</th><th>Status</th><th>On hand</th><th>Last movement</th></tr></thead><tbody>
            {detail.branchStock.map((branch) => <tr key={branch.branchId}><td><strong>{branch.branchName}</strong><div className="muted">{branch.branchCode}{branch.isDefault ? ' · Default' : ''}</div></td><td><span className={branch.isActive ? 'status-pill good' : 'status-pill neutral'}>{branch.isActive ? 'Active' : 'Inactive'}</span></td><td><strong>{formatNumber(branch.quantityOnHand)} {detail.stockUom}</strong></td><td>{branch.lastMovementAt ? dateTime(branch.lastMovementAt) : 'No movement yet'}</td></tr>)}
          </tbody></table></div> : <div className="empty-state"><strong>No readable Branch stock</strong><p>No Branch inventory is available to your current management scope.</p></div>}
          <div className="product-stock-callout"><strong>No opening stock is created here.</strong><span>Use Inventory for governed receiving, transfers, counts and authorised adjustments.</span></div>
        </section> : null}

        {tab === 'activity' ? <ProductActivity tenantId={tenantId} productId={detail.id} /> : null}
      </> : null}

      {!creating && !selectedId && !listLoading ? <div className="panel empty-state"><strong>Select a product</strong><p>Open a product from the catalogue or add a new one.</p></div> : null}
    </section>
  </div>;
}

function ProductOverviewForm({
  title,
  draft,
  setDraft,
  currency,
  categories,
  uoms,
  saving,
  onSubmit,
  note,
  detail,
}: {
  title: string;
  draft: ProductDraft;
  setDraft: Dispatch<SetStateAction<ProductDraft>>;
  currency: string;
  categories: CatalogueMasterOption[];
  uoms: CatalogueMasterOption[];
  saving: boolean;
  onSubmit: (event: FormEvent) => void;
  note?: string;
  detail?: ProductDetail;
}) {
  return <form className="panel product-editor" onSubmit={onSubmit}>
    <div className="panel-head"><div><p className="eyebrow">{detail ? 'Overview' : 'New product'}</p><h3>{title}</h3>{note ? <p className="muted">{note}</p> : null}</div></div>
    <div className="form-grid">
      <Field label="Product name"><input required value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></Field>
      <Field label="SKU"><input value={draft.sku} onChange={(event) => setDraft((current) => ({ ...current, sku: event.target.value }))} placeholder="Optional" /></Field>
      <Field label="Category"><select value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))}><option value="">No category</option>{categories.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select></Field>
      <Field label="Stock UOM"><select required value={draft.stockUom} onChange={(event) => setDraft((current) => ({ ...current, stockUom: event.target.value }))}><option value="">Select unit</option>{uoms.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select></Field>
      <Field label={`Selling price (${currency})`}><input required inputMode="decimal" value={draft.sellingPrice} onChange={(event) => setDraft((current) => ({ ...current, sellingPrice: event.target.value }))} /></Field>
      <label className="check-card"><input type="checkbox" checked={draft.allowFractionalStock} onChange={(event) => setDraft((current) => ({ ...current, allowFractionalStock: event.target.checked }))} /><span><strong>Allow fractional Stock UOM</strong><small>Use when stock can be held or sold in partial base units.</small></span></label>
    </div>
    {detail ? <div className="product-audit-meta"><span>Created {dateOnly(detail.createdAt)}</span><span>Updated {dateOnly(detail.updatedAt)}</span></div> : null}
    <div className="form-actions"><button className="primary-button" disabled={saving}>{saving ? 'Saving…' : detail ? 'Save changes' : 'Save Product'}</button></div>
  </form>;
}

function TabButton({ id, label, active, onClick }: { id: ProductTab; label: string; active: ProductTab; onClick: (tab: ProductTab) => void }) {
  return <button role="tab" aria-selected={active === id} className={active === id ? 'active' : ''} type="button" onClick={() => onClick(id)}>{label}</button>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function parseMasters(value: unknown): CatalogueMasters {
  const root = object(value);
  return {
    categories: parseMasterOptions(root.categories),
    uoms: parseMasterOptions(root.uoms),
  };
}

function parseMasterOptions(value: unknown): CatalogueMasterOption[] {
  return array(value).map((entry) => {
    const row = object(entry);
    return { id: String(row.id ?? ''), name: String(row.name ?? '').trim() };
  }).filter((item) => item.id && item.name);
}

function parsePage(value: unknown): ProductPage {
  const root = object(value);
  return {
    page: Math.max(1, numberValue(root.page)),
    pageSize: Math.max(1, numberValue(root.pageSize) || PAGE_SIZE),
    total: Math.max(0, numberValue(root.total)),
    totalPages: Math.max(1, numberValue(root.totalPages)),
    categories: array(root.categories).map(String).filter(Boolean),
    uoms: array(root.uoms).map(String).filter(Boolean),
    items: array(root.items).map((value) => {
      const row = object(value);
      return {
        id: String(row.id ?? ''),
        name: String(row.name ?? 'Product'),
        sku: nullableString(row.sku),
        category: nullableString(row.category),
        stockUom: String(row.stockUom ?? 'Each'),
        sellingPrice: row.sellingPrice == null ? null : numberValue(row.sellingPrice),
        isActive: row.isActive === true,
        unitCount: numberValue(row.unitCount),
        barcodeCount: numberValue(row.barcodeCount),
      } satisfies ProductListItem;
    }).filter((item) => item.id),
  };
}

function parseDetail(value: unknown): ProductDetail {
  const row = object(value);
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? 'Product'),
    sku: nullableString(row.sku),
    category: nullableString(row.category),
    stockUom: String(row.stockUom ?? 'Each'),
    sellingPrice: row.sellingPrice == null ? null : numberValue(row.sellingPrice),
    isActive: row.isActive === true,
    unitCount: array(row.uoms).length,
    barcodeCount: array(row.uoms).filter((value) => nullableString(object(value).barcode)).length,
    allowFractionalStock: row.allowFractionalStock === true,
    createdAt: String(row.createdAt ?? ''),
    updatedAt: String(row.updatedAt ?? ''),
    uoms: array(row.uoms).map((value) => {
      const uom = object(value);
      return {
        id: String(uom.id ?? ''),
        name: String(uom.name ?? 'Unit'),
        conversionFactor: numberValue(uom.conversionFactor),
        sellingPrice: uom.sellingPrice == null ? null : numberValue(uom.sellingPrice),
        barcode: nullableString(uom.barcode),
        allowFractional: uom.allowFractional === true,
        isDefaultSelling: uom.isDefaultSelling === true,
        isDefaultPurchase: uom.isDefaultPurchase === true,
      } satisfies ProductUom;
    }).filter((item) => item.id),
    branchStock: array(row.branchStock).map((value) => {
      const branch = object(value);
      return {
        branchId: String(branch.branchId ?? ''),
        branchCode: String(branch.branchCode ?? ''),
        branchName: String(branch.branchName ?? 'Branch'),
        isDefault: branch.isDefault === true,
        isActive: branch.isActive === true,
        quantityOnHand: numberValue(branch.quantityOnHand),
        lastMovementAt: nullableString(branch.lastMovementAt),
      } satisfies ProductBranchStock;
    }).filter((item) => item.branchId),
  };
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function nullableString(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
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
function dateOnly(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium' }).format(date);
}
function dateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
