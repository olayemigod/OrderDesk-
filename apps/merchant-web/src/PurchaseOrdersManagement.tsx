import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { errorMessage, numberValue, supabase } from './supabase';

type Branch = { id: string; name: string; isDefault: boolean };
type Supplier = { id: string; name: string; isActive: boolean };
type Uom = { id: string; name: string; conversionFactor: number; allowFractional: boolean; isDefaultPurchase: boolean };
type Product = { id: string; name: string; uoms: Uom[] };
type OrderRow = { id: string; reference: string; status: string; branchId: string; branchName: string; supplierId: string; supplierName: string; currency: string; totalAmount: number; itemCount: number; expectedDate: string | null; createdAt: string };
type Item = { itemId: string; catalogItemId: string; uomId: string; productName: string; selectedUom: string; orderedQuantity: number; unitCost: number; lineTotal: number; receivedQuantity: number; remainingQuantity: number };
type Detail = { purchaseOrderId: string; reference: string; status: string; branchId: string; branchName: string; supplierId: string; supplierName: string; currency: string; totalAmount: number; expectedDate: string | null; notes: string | null; items: Item[]; receipts: Array<{ receiptId: string; reference: string; receivedAt: string; itemCount: number }> };
type DraftLine = { key: string; productId: string; uomId: string; quantity: string; unitCost: string };
type Draft = { reference: string; branchId: string; supplierId: string; expectedDate: string; notes: string; items: DraftLine[] };

export default function PurchaseOrdersManagement({ tenantId, currency }: { tenantId: string; currency: string }) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [productsBranchId, setProductsBranchId] = useState<string | null>(null);
  const [productsLoading, setProductsLoading] = useState(false);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [receivingOpen, setReceivingOpen] = useState(false);
  const [receiptReference, setReceiptReference] = useState('');
  const [receiptNotes, setReceiptNotes] = useState('');
  const [receiptQuantities, setReceiptQuantities] = useState<Record<string, string>>({});
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const productRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const total = useMemo(() => draft.items.reduce((sum,row) => sum + positive(row.quantity) * nonNegative(row.unitCost), 0), [draft.items]);

  useEffect(() => { void load(); }, [tenantId]);
  useEffect(() => {
    setReceivingOpen(false); setReceiptReference(''); setReceiptNotes(''); setReceiptQuantities({}); setCancelOpen(false); setCancelReason('');
    if (selectedId) void loadDetail(selectedId);
  }, [selectedId]);

  async function load(preferred?: string | null) {
    setLoading(true); setError(null);
    try {
      const [branchResult,supplierResult,orderResult] = await Promise.all([
        supabase.rpc('get_sellertray_accessible_branches',{p_tenant_id:tenantId}),
        supabase.rpc('get_sellertray_suppliers',{p_tenant_id:tenantId}),
        supabase.rpc('get_sellertray_purchase_orders',{p_tenant_id:tenantId,p_branch_id:null,p_limit:200}),
      ]);
      for (const result of [branchResult,supplierResult,orderResult]) if (result.error) throw result.error;
      const nextBranches=((branchResult.data??[]) as Array<Record<string,unknown>>).map(row=>({id:String(row.id??''),name:String(row.name??'Branch'),isDefault:row.is_default===true})).filter(row=>row.id);
      const nextSuppliers=((supplierResult.data??[]) as Array<Record<string,unknown>>).map(row=>({id:String(row.id??''),name:String(row.name??'Supplier'),isActive:row.isActive===true||row.is_active===true})).filter(row=>row.id);
      const nextOrders=((orderResult.data??[]) as Array<Record<string,unknown>>).map(mapOrder);
      setBranches(nextBranches); setSuppliers(nextSuppliers); setOrders(nextOrders);
      const wanted=preferred??selectedId;
      const nextId=wanted&&nextOrders.some(row=>row.id===wanted)?wanted:nextOrders[0]?.id??null;
      setSelectedId(nextId);
      if(!nextId)startNew(nextBranches,nextSuppliers);
    } catch(cause){setError(errorMessage(cause,'Unable to load purchasing.'));}
    finally{setLoading(false);}
  }

  async function loadProductOptions(branchId:string,reconcileDraft:boolean) {
    const requestId=++productRequestRef.current;
    setProducts([]); setProductsBranchId(null);
    if(!branchId){setProductsLoading(false);return;}
    setProductsLoading(true);
    try{
      const {data,error:rpcError}=await supabase.rpc('get_sellertray_purchase_product_options',{p_tenant_id:tenantId,p_branch_id:branchId});
      if(rpcError)throw rpcError;
      if(requestId!==productRequestRef.current)return;
      const nextProducts=parseProducts(data);
      setProducts(nextProducts); setProductsBranchId(branchId);
      if(reconcileDraft){
        setDraft(current=>{
          if(current.branchId!==branchId)return current;
          return {...current,items:current.items.map(line=>reconcileLineForProducts(line,nextProducts))};
        });
      }
    }catch(cause){
      if(requestId===productRequestRef.current){
        setProducts([]); setProductsBranchId(null);
        setError(errorMessage(cause,'Unable to load products for this Branch.'));
      }
    }finally{
      if(requestId===productRequestRef.current)setProductsLoading(false);
    }
  }

  async function loadDetail(id:string){
    const requestId=++detailRequestRef.current;
    try{
      const {data,error:rpcError}=await supabase.rpc('get_sellertray_purchase_order_detail',{p_tenant_id:tenantId,p_purchase_order_id:id});
      if(rpcError)throw rpcError;
      if(requestId!==detailRequestRef.current)return;
      const next=parseDetail(data);
      setDetail(next);
      setDraft({reference:next.reference,branchId:next.branchId,supplierId:next.supplierId,expectedDate:next.expectedDate??'',notes:next.notes??'',items:next.items.map(item=>({key:item.itemId,productId:item.catalogItemId,uomId:item.uomId,quantity:String(item.orderedQuantity),unitCost:String(item.unitCost)}))});
      await loadProductOptions(next.branchId,false);
    }catch(cause){if(requestId===detailRequestRef.current)setError(errorMessage(cause,'Unable to load this Purchase Order.'));}
  }

  function startNew(branchRows=branches,supplierRows=suppliers){
    detailRequestRef.current+=1;
    setSelectedId(null); setDetail(null); setReceivingOpen(false); setCancelOpen(false);
    const branchId=branchRows.find(row=>row.isDefault)?.id??branchRows[0]?.id??'';
    setDraft({reference:reference('PO'),branchId,supplierId:supplierRows.find(row=>row.isActive)?.id??supplierRows[0]?.id??'',expectedDate:'',notes:'',items:[emptyLine()]});
    setError(null); setMessage(null);
    void loadProductOptions(branchId,false);
  }

  function changeBranch(branchId:string){
    if(branchId===draft.branchId)return;
    setDraft(current=>({...current,branchId}));
    setError(null); setMessage(null);
    void loadProductOptions(branchId,true);
  }

  function updateLine(key:string,patch:Partial<DraftLine>){setDraft(current=>({...current,items:current.items.map(line=>line.key===key?{...line,...patch}:line)}));}
  function chooseProduct(line:DraftLine,productId:string){const product=products.find(row=>row.id===productId);const uom=product?.uoms.find(row=>row.isDefaultPurchase)??product?.uoms[0];updateLine(line.key,{productId,uomId:uom?.id??''});}

  async function save(event:FormEvent){
    event.preventDefault();
    if(productsLoading||productsBranchId!==draft.branchId){setError('Wait for the governed product options for this Branch to finish loading.');return;}
    const items=draft.items.map(row=>({catalogItemId:row.productId,uomId:row.uomId,quantity:positive(row.quantity),unitCost:nonNegative(row.unitCost)}));
    if(!draft.branchId||!draft.supplierId||items.some(row=>!row.catalogItemId||!row.uomId||row.quantity<=0)){setError('Choose a Branch, Supplier and valid products, units and quantities.');return;}
    setBusy(true);setError(null);setMessage(null);
    try{
      const {data,error:rpcError}=await supabase.rpc('save_sellertray_purchase_order',{p_tenant_id:tenantId,p_purchase_order_id:selectedId,p_branch_id:draft.branchId,p_supplier_id:draft.supplierId,p_reference:draft.reference.trim()||null,p_expected_date:draft.expectedDate||null,p_notes:draft.notes.trim()||null,p_items:items});
      if(rpcError)throw rpcError;
      const id=String((data as Record<string,unknown>)?.purchaseOrderId??selectedId??'');
      if(!id)throw new Error('SellerTray did not return the Purchase Order.');
      setMessage(selectedId?'Purchase Order updated.':'Purchase Order created.');
      await load(id); await loadDetail(id);
    }catch(cause){setError(errorMessage(cause,'Unable to save this Purchase Order.'));}
    finally{setBusy(false);}
  }

  async function place(){
    if(!selectedId)return;
    setBusy(true);setError(null);setMessage(null);
    try{
      const {error:rpcError}=await supabase.rpc('place_sellertray_purchase_order',{p_tenant_id:tenantId,p_purchase_order_id:selectedId});
      if(rpcError)throw rpcError;
      setMessage('Purchase Order placed. Receive only the quantities that physically arrive.');
      await load(selectedId); await loadDetail(selectedId);
    }catch(cause){setError(errorMessage(cause,'Unable to place this Purchase Order.'));}
    finally{setBusy(false);}
  }

  function openReceiving(){
    if(!detail||!selectedId)return;
    const remaining=detail.items.filter(item=>item.remainingQuantity>0);
    if(!remaining.length)return;
    setReceiptReference(reference('RCV'));
    setReceiptNotes('');
    setReceiptQuantities(Object.fromEntries(remaining.map(item=>[item.itemId,'0'])));
    setReceivingOpen(true); setCancelOpen(false); setError(null); setMessage(null);
  }

  async function receive(event:FormEvent){
    event.preventDefault();
    if(!detail||!selectedId)return;
    const items:Array<{purchaseOrderItemId:string;quantity:number}>=[];
    for(const item of detail.items.filter(row=>row.remainingQuantity>0)){
      const raw=receiptQuantities[item.itemId]??'0';
      const quantity=Number(raw);
      if(!Number.isFinite(quantity)||quantity<0||quantity>item.remainingQuantity){setError(`Enter a quantity from 0 to ${item.remainingQuantity} for ${item.productName}.`);return;}
      if(quantity>0)items.push({purchaseOrderItemId:item.itemId,quantity});
    }
    if(!items.length){setError('Enter at least one received quantity greater than zero.');return;}
    if(!receiptReference.trim()){setError('Enter the supplier delivery or receipt reference.');return;}
    setBusy(true);setError(null);setMessage(null);
    try{
      const {error:rpcError}=await supabase.rpc('receive_sellertray_purchase_order',{p_tenant_id:tenantId,p_purchase_order_id:selectedId,p_reference:receiptReference.trim(),p_notes:receiptNotes.trim()||null,p_items:items});
      if(rpcError)throw rpcError;
      setReceivingOpen(false);setReceiptReference('');setReceiptNotes('');setReceiptQuantities({});
      setMessage('Purchase receipt posted to this Branch. Stock and cost were recorded through governed Purchase Receiving.');
      await load(selectedId); await loadDetail(selectedId);
    }catch(cause){setError(errorMessage(cause,'Unable to receive this Purchase Order.'));}
    finally{setBusy(false);}
  }

  function openCancel(){setCancelReason('');setCancelOpen(true);setReceivingOpen(false);setError(null);setMessage(null);}

  async function cancel(event:FormEvent){
    event.preventDefault();
    if(!selectedId)return;
    const reason=cancelReason.trim();
    if(!reason){setError('Enter the reason for cancelling this Purchase Order.');return;}
    setBusy(true);setError(null);setMessage(null);
    try{
      const {error:rpcError}=await supabase.rpc('cancel_sellertray_purchase_order',{p_tenant_id:tenantId,p_purchase_order_id:selectedId,p_reason:reason});
      if(rpcError)throw rpcError;
      setCancelOpen(false);setCancelReason('');setMessage('Purchase Order cancelled.');
      await load(selectedId); await loadDetail(selectedId);
    }catch(cause){setError(errorMessage(cause,'Unable to cancel this Purchase Order.'));}
    finally{setBusy(false);}
  }

  if(loading)return <article className="panel"><p className="muted">Loading purchasing…</p></article>;
  return <div className="page-stack">
    <div className="section-heading"><div><p className="eyebrow">Stock procurement</p><h2>Purchase Orders</h2></div><p className="muted">Supplier stock enters inventory only when a physical receipt is posted against a placed Purchase Order.</p></div>
    {error?<div className="error-banner">{error}<button onClick={()=>setError(null)}>Dismiss</button></div>:null}
    {message?<div className="success-banner">{message}<button onClick={()=>setMessage(null)}>Dismiss</button></div>:null}
    <div className="purchase-two-column">
      <article className="panel purchase-list-panel">
        <div className="panel-head"><div><p className="eyebrow">Purchasing</p><h3>Purchase Orders</h3></div><button className="secondary-button" onClick={()=>startNew()}>New Purchase Order</button></div>
        {orders.map(row=><button key={row.id} className={selectedId===row.id?'product-row selected':'product-row'} onClick={()=>setSelectedId(row.id)}><span><strong>{row.reference}</strong><small>{row.supplierName} · {row.branchName}</small></span><span><strong>{money(row.totalAmount,row.currency||currency)}</strong><small>{label(row.status)}</small></span></button>)}
        {!orders.length?<Empty title="No Purchase Orders" body="Create a Purchase Order when stock is being procured from a supplier."/>:null}
      </article>

      <article className="panel product-editor-stack">
        <form className="product-editor-stack" onSubmit={save}>
          <div className="panel-head"><div><p className="eyebrow">{detail?label(detail.status):'New'}</p><h3>{detail?.reference??'New Purchase Order'}</h3></div><strong>{money(total,currency)}</strong></div>
          <div className="form-grid">
            <label className="field">Reference<input value={draft.reference} disabled={!!detail&&detail.status!=='draft'} onChange={e=>setDraft(current=>({...current,reference:e.target.value}))}/></label>
            <label className="field">Branch<select value={draft.branchId} disabled={busy||(!!detail&&detail.status!=='draft')} onChange={e=>changeBranch(e.target.value)}>{branches.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
            <label className="field">Supplier<select value={draft.supplierId} disabled={!!detail&&detail.status!=='draft'} onChange={e=>setDraft(current=>({...current,supplierId:e.target.value}))}>{suppliers.filter(row=>row.isActive||row.id===draft.supplierId).map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
            <label className="field">Expected date<input type="date" value={draft.expectedDate} disabled={!!detail&&detail.status!=='draft'} onChange={e=>setDraft(current=>({...current,expectedDate:e.target.value}))}/></label>
          </div>
          {productsLoading?<p className="muted">Loading products and purchase units for this Branch…</p>:null}
          <Table headers={['Product','Unit','Quantity','Unit cost','Line total','']}>
            {draft.items.map(line=>{const product=products.find(row=>row.id===line.productId);const selectedUom=product?.uoms.find(row=>row.id===line.uomId);const snapshot=detail?.items.find(item=>item.itemId===line.key);const editable=!detail||detail.status==='draft';return <tr key={line.key}>
              <td>{editable?<select value={line.productId} disabled={productsLoading||productsBranchId!==draft.branchId} onChange={e=>chooseProduct(line,e.target.value)}><option value="">{productsLoading?'Loading products…':'Choose product'}</option>{line.productId&&!product&&snapshot?<option value={line.productId} disabled>{snapshot.productName} (unavailable)</option>:null}{products.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select>:<strong>{snapshot?.productName??product?.name??'Product'}</strong>}</td>
              <td>{editable?<select value={line.uomId} disabled={productsLoading||!product} onChange={e=>updateLine(line.key,{uomId:e.target.value})}><option value="">Choose unit</option>{product?.uoms.map(uom=><option key={uom.id} value={uom.id}>{uom.name}</option>)}</select>:snapshot?.selectedUom??selectedUom?.name??'—'}</td>
              <td>{editable?<input type="number" min="0" step={selectedUom?.allowFractional===false?'1':'any'} value={line.quantity} onChange={e=>updateLine(line.key,{quantity:e.target.value})}/>:formatNumber(snapshot?.orderedQuantity??positive(line.quantity))}</td>
              <td>{editable?<input type="number" min="0" step="any" value={line.unitCost} onChange={e=>updateLine(line.key,{unitCost:e.target.value})}/>:money(snapshot?.unitCost??nonNegative(line.unitCost),detail?.currency||currency)}</td>
              <td>{money(positive(line.quantity)*nonNegative(line.unitCost),detail?.currency||currency)}</td>
              <td>{editable&&draft.items.length>1?<button type="button" className="text-button" onClick={()=>setDraft(current=>({...current,items:current.items.filter(row=>row.key!==line.key)}))}>Remove</button>:null}</td>
            </tr>})}
          </Table>
          {!detail||detail.status==='draft'?<button type="button" className="text-button" disabled={productsLoading} onClick={()=>setDraft(current=>({...current,items:[...current.items,emptyLine()]}))}>Add product</button>:null}
          <label className="field">Notes<textarea value={draft.notes} disabled={!!detail&&detail.status!=='draft'} onChange={e=>setDraft(current=>({...current,notes:e.target.value}))}/></label>
          <div className="form-actions">
            {!detail||detail.status==='draft'?<button className="primary-button" disabled={busy||productsLoading||productsBranchId!==draft.branchId}>Save Purchase Order</button>:null}
            {detail?.status==='draft'?<button type="button" className="secondary-button" disabled={busy} onClick={()=>void place()}>Place order</button>:null}
            {detail?.status==='ordered'||detail?.status==='partially_received'?<button type="button" className="primary-button" disabled={busy} onClick={openReceiving}>Receive delivery</button>:null}
            {detail&&['draft','ordered'].includes(detail.status)?<button type="button" className="secondary-button" disabled={busy} onClick={openCancel}>Cancel</button>:null}
          </div>
        </form>

        {receivingOpen&&detail&&['ordered','partially_received'].includes(detail.status)?<form className="product-editor-stack purchase-receive-editor" onSubmit={receive}>
          <div className="panel-head"><div><p className="eyebrow">Purchase receiving</p><h3>Receive physical delivery</h3><p className="muted">Record only what physically arrived. Each receipt posts stock and preserves this Purchase Order's governed purchase cost basis.</p></div><button type="button" className="text-button" disabled={busy} onClick={()=>setReceivingOpen(false)}>Close</button></div>
          <Table headers={['Product','Ordered','Already received','Remaining','This delivery']}>
            {detail.items.filter(item=>item.remainingQuantity>0).map(item=><tr key={item.itemId}><td><strong>{item.productName}</strong><small className="report-subline">{item.selectedUom}</small></td><td>{formatNumber(item.orderedQuantity)} {item.selectedUom}</td><td>{formatNumber(item.receivedQuantity)} {item.selectedUom}</td><td><strong>{formatNumber(item.remainingQuantity)} {item.selectedUom}</strong></td><td><input aria-label={`Received quantity for ${item.productName}`} type="number" min="0" max={item.remainingQuantity} step="any" value={receiptQuantities[item.itemId]??'0'} onChange={e=>setReceiptQuantities(current=>({...current,[item.itemId]:e.target.value}))}/></td></tr>)}
          </Table>
          <div className="form-grid"><label className="field">Delivery / receipt reference<input required maxLength={120} value={receiptReference} onChange={e=>setReceiptReference(e.target.value)}/></label><label className="field">Receiving notes<textarea value={receiptNotes} onChange={e=>setReceiptNotes(e.target.value)} placeholder="Optional delivery notes"/></label></div>
          <div className="form-actions"><button className="primary-button" disabled={busy}>{busy?'Posting receipt…':'Post purchase receipt'}</button></div>
        </form>:null}

        {cancelOpen&&detail&&['draft','ordered'].includes(detail.status)?<form className="product-editor-stack purchase-cancel-editor" onSubmit={cancel}>
          <div className="panel-head"><div><p className="eyebrow">Cancel Purchase Order</p><h3>{detail.reference}</h3><p className="muted">A Purchase Order with received stock cannot be cancelled here. The reason is retained in the governed purchase history.</p></div><button type="button" className="text-button" disabled={busy} onClick={()=>setCancelOpen(false)}>Close</button></div>
          <label className="field">Cancellation reason<input required value={cancelReason} onChange={e=>setCancelReason(e.target.value)} placeholder="Why is this Purchase Order being cancelled?"/></label>
          <div className="form-actions"><button className="danger-button" disabled={busy}>{busy?'Cancelling…':'Cancel Purchase Order'}</button></div>
        </form>:null}

        {detail?<><div className="panel-head"><div><p className="eyebrow">Receiving</p><h3>Receipt history</h3></div></div>{detail.receipts.length?<Table headers={['Reference','Received','Products']}>{detail.receipts.map(row=><tr key={row.receiptId}><td>{row.reference}</td><td>{dateTime(row.receivedAt)}</td><td>{row.itemCount}</td></tr>)}</Table>:<Empty title="No receipts yet" body="On-hand stock changes only after a physical delivery is received here."/>}</>:null}
      </article>
    </div>
  </div>;
}

function reconcileLineForProducts(line:DraftLine,products:Product[]):DraftLine{
  const product=products.find(row=>row.id===line.productId);
  if(!product)return {...line,productId:'',uomId:''};
  const uom=product.uoms.find(row=>row.id===line.uomId)??product.uoms.find(row=>row.isDefaultPurchase)??product.uoms[0];
  return {...line,uomId:uom?.id??''};
}
function parseProducts(value:unknown):Product[]{return Array.isArray(value)?value.map(raw=>{const row=raw as Record<string,unknown>;const uoms=Array.isArray(row.uoms)?row.uoms.map(rawUom=>{const uom=rawUom as Record<string,unknown>;return{id:String(uom.id??''),name:String(uom.name??'Unit'),conversionFactor:numberValue(uom.conversionFactor),allowFractional:uom.allowFractional===true,isDefaultPurchase:uom.isDefaultPurchase===true};}).filter(uom=>uom.id):[];return{id:String(row.id??''),name:String(row.name??'Product'),uoms};}).filter(row=>row.id&&row.uoms.length):[];}
function mapOrder(row:Record<string,unknown>):OrderRow{return{id:String(row.id??row.purchase_order_id??''),reference:String(row.reference??'Purchase Order'),status:String(row.status??'draft'),branchId:String(row.branch_id??''),branchName:String(row.branch_name??'Branch'),supplierId:String(row.supplier_id??''),supplierName:String(row.supplier_name??'Supplier'),currency:String(row.currency??'NGN'),totalAmount:numberValue(row.total_amount),itemCount:numberValue(row.item_count),expectedDate:typeof row.expected_date==='string'?row.expected_date:null,createdAt:String(row.created_at??'')}};
function parseDetail(value:unknown):Detail{const row=(value??{}) as Record<string,unknown>;const items=Array.isArray(row.items)?row.items.map(raw=>{const item=raw as Record<string,unknown>;return{itemId:String(item.itemId??''),catalogItemId:String(item.catalogItemId??''),uomId:String(item.uomId??''),productName:String(item.productName??'Product'),selectedUom:String(item.selectedUom??''),orderedQuantity:numberValue(item.orderedQuantity),unitCost:numberValue(item.unitCost),lineTotal:numberValue(item.lineTotal),receivedQuantity:numberValue(item.receivedQuantity),remainingQuantity:numberValue(item.remainingQuantity)}}):[];const receipts=Array.isArray(row.receipts)?row.receipts.map(raw=>{const item=raw as Record<string,unknown>;return{receiptId:String(item.receiptId??''),reference:String(item.reference??'Receipt'),receivedAt:String(item.receivedAt??''),itemCount:numberValue(item.itemCount)}}):[];return{purchaseOrderId:String(row.purchaseOrderId??''),reference:String(row.reference??'Purchase Order'),status:String(row.status??'draft'),branchId:String(row.branchId??''),branchName:String(row.branchName??'Branch'),supplierId:String(row.supplierId??''),supplierName:String(row.supplierName??'Supplier'),currency:String(row.currency??'NGN'),totalAmount:numberValue(row.totalAmount),expectedDate:typeof row.expectedDate==='string'?row.expectedDate:null,notes:typeof row.notes==='string'?row.notes:null,items,receipts};}
function emptyDraft():Draft{return{reference:reference('PO'),branchId:'',supplierId:'',expectedDate:'',notes:'',items:[emptyLine()]};}
function emptyLine():DraftLine{return{key:`line-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,productId:'',uomId:'',quantity:'1',unitCost:'0'};}
function positive(value:string){const parsed=Number(value);return Number.isFinite(parsed)&&parsed>0?parsed:0;}
function nonNegative(value:string){const parsed=Number(value);return Number.isFinite(parsed)&&parsed>=0?parsed:0;}
function label(value:string){return value.replaceAll('_',' ').replace(/\b\w/g,letter=>letter.toUpperCase());}
function formatNumber(value:number){return new Intl.NumberFormat('en-NG',{maximumFractionDigits:6}).format(value);}
function money(value:number,currency:string){try{return new Intl.NumberFormat('en-NG',{style:'currency',currency:currency||'NGN',maximumFractionDigits:2}).format(value);}catch{return `${currency||'NGN'} ${value.toFixed(2)}`;}}
function dateTime(value:string){const date=new Date(value);return Number.isNaN(date.getTime())?'—':new Intl.DateTimeFormat('en-NG',{dateStyle:'medium',timeStyle:'short'}).format(date);}
function reference(prefix:string){const now=new Date();return `${prefix}-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;}
function Table({headers,children}:{headers:string[];children:React.ReactNode}){return <div className="table-wrap"><table><thead><tr>{headers.map(header=><th key={header}>{header}</th>)}</tr></thead><tbody>{children}</tbody></table></div>}
function Empty({title,body}:{title:string;body:string}){return <div className="empty-state"><strong>{title}</strong><p>{body}</p></div>}
