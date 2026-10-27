import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { invokeJson } from './supabase';

type SourceDocument = { filename:string; pdfSha256:string; byteSize:number; pageCount:number };
type AgreementVersion={id:string;versionCode:string;title:string;contentBody:string;contentSha256:string;effectiveFrom:string;publishedAt:string;publishedByUserId:string;publishReason:string;sourceDocument:SourceDocument|null};
type Acceptance={id:string;versionCode:string;acceptedAt:string;acceptedLegalName:string;acceptedRole:string;acceptedByUserId:string};
type TenantState={published:boolean;accepted:boolean;acceptanceRequired:boolean;serviceDeliveryAllowed:boolean;currentVersion:AgreementVersion|null;acceptance:Acceptance|null};
type AdminOrderForm={id:string;reference:string;commercialOrderId:string;templateVersionCode:string;confirmed:boolean;confirmedAt:string|null;packageFingerprint:string|null;issuedAt:string};
type AgreementOverview={actorRole:string;canPublish:boolean;versions:AgreementVersion[];tenantState:TenantState|null;orderForms:AdminOrderForm[]};
type AdminResponse={ok?:boolean;overview?:unknown;agreementVersionId?:string};
type PublishForm={versionCode:string;title:string;contentBody:string;effectiveFrom:string;reason:string};
type AgreementTab='list'|'add';
type PublishMethod='pdf'|'paste';
type PreparedDocument={orderFormId:string;artifactKind:'review_pdf'|'executed_pdf';signedUrl:string;fileName:string;packageFingerprint:string;pdfSha256:string};

const MAX_PDF_BYTES=8*1024*1024;
const emptyForm=():PublishForm=>({versionCode:'',title:'SellerTray Master Agreement',contentBody:'',effectiveFrom:localDateTime(new Date()),reason:''});

export default function AgreementLifecycleManagement({session,tenantId}:{session:Session;tenantId:string}){
  const [state,setState]=useState<AgreementOverview|null>(null);
  const [form,setForm]=useState<PublishForm>(()=>emptyForm());
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [tab,setTab]=useState<AgreementTab>('list');
  const [publishMethod,setPublishMethod]=useState<PublishMethod>('pdf');
  const [sourceFile,setSourceFile]=useState<File|null>(null);
  const [preparedDocument,setPreparedDocument]=useState<PreparedDocument|null>(null);
  const [documentBusy,setDocumentBusy]=useState<string|null>(null);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [message,setMessage]=useState<string|null>(null);
  const requestSequence=useRef(0);
  const publicationCommandIds=useRef(new Map<string,string>());

  useEffect(()=>{setMessage(null);void load();},[tenantId,session]);

  async function load(preferredId?:string|null){
    const sequence=++requestSequence.current;setLoading(true);setError(null);
    try{
      const response=await invokeJson<AdminResponse>('master-agreements',{action:'admin_get',tenantId},session);
      if(sequence!==requestSequence.current)return;
      const next=parseOverview(response.overview);setState(next);
      const wanted=preferredId??selectedId;
      setSelectedId(wanted&&next.versions.some(v=>v.id===wanted)?wanted:next.tenantState?.currentVersion?.id??next.versions[0]?.id??null);
    }catch(cause){if(sequence!==requestSequence.current)return;setState(null);setError(messageFrom(cause,'Unable to load Master Agreement governance.'));}
    finally{if(sequence===requestSequence.current)setLoading(false);}
  }

  async function publish(event:FormEvent){
    event.preventDefault();if(!state?.canPublish||saving)return;
    const effective=new Date(form.effectiveFrom);
    if(Number.isNaN(effective.getTime())){setError('Enter a valid effective date and time.');return;}
    if(!form.versionCode.trim()||!form.title.trim()||form.reason.trim().length<6){setError('Version, title, effective date and a publication reason are required.');return;}
    if(publishMethod==='paste'&&!form.contentBody.trim()){setError('Paste the reviewed Master Agreement content or switch to Upload reviewed PDF.');return;}
    if(publishMethod==='pdf'&&!sourceFile){setError('Choose the reviewed Master Agreement PDF to publish this version.');return;}
    if(sourceFile&&(sourceFile.size<1||sourceFile.size>MAX_PDF_BYTES)){setError('Reviewed Master Agreement PDF must be 8 MB or smaller.');return;}

    setSaving(true);setError(null);setMessage(null);
    try{
      let response:AdminResponse;
      if(publishMethod==='pdf'&&sourceFile){
        const commandKey=`pdf:${form.versionCode.trim()}`;
        const commandId=publicationCommandIds.current.get(commandKey)??crypto.randomUUID();
        publicationCommandIds.current.set(commandKey,commandId);
        const sourcePdfBase64=await fileToBase64(sourceFile);
        response=await invokeJson<AdminResponse>('master-agreements',{
          action:'admin_publish_pdf',tenantId,
          versionCode:form.versionCode.trim(),title:form.title.trim(),effectiveFrom:effective.toISOString(),reason:form.reason.trim(),
          sourceFileName:sourceFile.name,sourcePdfBase64,commandId,
        },session);
        publicationCommandIds.current.delete(commandKey);
      }else{
        response=await invokeJson<AdminResponse>('master-agreements',{
          action:'admin_publish',tenantId,versionCode:form.versionCode.trim(),title:form.title.trim(),contentBody:form.contentBody.trim(),effectiveFrom:effective.toISOString(),reason:form.reason.trim(),
        },session);
      }
      const next=parseOverview(response.overview);setState(next);setSelectedId(response.agreementVersionId??next.tenantState?.currentVersion?.id??next.versions[0]?.id??null);
      setForm(emptyForm());setSourceFile(null);setPublishMethod('pdf');setTab('list');
      setMessage(publishMethod==='pdf'?'Reviewed PDF published as a new immutable universal Master Agreement version.':'Universal Master Agreement version published from reviewed legal text.');
    }catch(cause){setError(messageFrom(cause,'Unable to publish this Master Agreement version.'));}
    finally{setSaving(false);}
  }

  async function prepareAdminDocument(formRow:AdminOrderForm,artifactKind:'review_pdf'|'executed_pdf'){
    const busyKey=`${formRow.id}:${artifactKind}`;if(documentBusy)return;
    setDocumentBusy(busyKey);setError(null);setPreparedDocument(null);
    try{
      const response=await invokeJson<{document?:unknown}>('master-agreements',{action:'admin_get_document',tenantId,orderFormId:formRow.id,artifactKind},session);
      const document=parseDocument(response.document,formRow.id,artifactKind);setPreparedDocument(document);
      const popup=window.open(document.signedUrl,'_blank');if(popup)popup.opener=null;
    }catch(cause){setError(messageFrom(cause,'Unable to prepare this Agreement Package PDF.'));}
    finally{setDocumentBusy(null);}
  }

  const versions=state?.versions??[];
  const selected=versions.find(v=>v.id===selectedId)??versions[0]??null;
  const tenantState=state?.tenantState??null;
  const orderForms=state?.orderForms??[];

  return <section className="workspace-page admin-agreement-workspace">
    <header className="workspace-page-header">
      <div><p className="workspace-eyebrow">Platform legal governance</p><h1>SellerTray Master Agreement</h1><p>Publish the platform-wide immutable Master Agreement and review the selected Business acceptance evidence. Merchant-specific issuance remains retired.</p></div>
      <span className="workspace-status-pill neutral">Platform-wide authority</span>
    </header>

    <nav className="workspace-panel" aria-label="Master Agreement views" style={{padding:'8px',display:'flex',gap:'8px',flexWrap:'wrap'}}>
      <button type="button" className={`workspace-button ${tab==='list'?'primary':'secondary'}`} aria-current={tab==='list'?'page':undefined} onClick={()=>setTab('list')}>List View</button>
      <button type="button" className={`workspace-button ${tab==='add'?'primary':'secondary'}`} aria-current={tab==='add'?'page':undefined} onClick={()=>setTab('add')}>Add New</button>
    </nav>

    {error?<div className="workspace-banner error">{error}<button className="workspace-button text compact" type="button" onClick={()=>setError(null)}>Dismiss</button></div>:null}
    {message?<div className="workspace-banner success">{message}<button className="workspace-button text compact" type="button" onClick={()=>setMessage(null)}>Dismiss</button></div>:null}
    {preparedDocument?<div className="workspace-banner success"><span>{preparedDocument.fileName} is ready. Fingerprint {preparedDocument.packageFingerprint.slice(0,18)}…</span><a className="workspace-button text compact" href={preparedDocument.signedUrl} target="_blank" rel="noreferrer">Open PDF</a></div>:null}

    {tab==='list'?<>
      {tenantState?<article className="workspace-panel">
        <div className="workspace-panel-heading"><div><p className="workspace-eyebrow">Selected merchant</p><h2>Acceptance status</h2><p>Business + Master Agreement version evidence. This status is not tied to an order, installment, Branch or payment.</p></div><span className={`workspace-status-pill ${tenantState.accepted?'good':tenantState.published?'warn':'neutral'}`}>{tenantState.accepted?'Accepted':tenantState.published?'Pending':'Not published'}</span></div>
        <div className="workspace-detail-grid admin-agreement-facts"><Fact label="Current version" value={tenantState.currentVersion?.versionCode??'No effective version'}/><Fact label="Service-delivery gate" value={tenantState.serviceDeliveryAllowed?'Satisfied':'Blocked'}/><Fact label="Accepted by" value={tenantState.acceptance?.acceptedLegalName??'—'}/><Fact label="Accepted at" value={tenantState.acceptance?.acceptedAt?formatDate(tenantState.acceptance.acceptedAt):'—'}/></div>
      </article>:null}

      <div className="workspace-grid two admin-agreement-history-grid">
        <article className="workspace-panel">
          <div className="workspace-panel-heading"><div><p className="workspace-eyebrow">Version history</p><h2>Published versions</h2><p>Immutable platform legal history.</p></div></div>
          {loading&&!state?<div className="workspace-empty-state"><strong>Loading agreement versions…</strong></div>:null}
          {!loading&&!versions.length?<div className="workspace-empty-state"><strong>No Master Agreement published</strong><p>Use Add New to publish reviewed universal legal text or a reviewed PDF before new SellerTray service-delivery activation is allowed.</p></div>:null}
          <div className="admin-agreement-version-list">{versions.map(version=><button key={version.id} type="button" className={`admin-agreement-version ${selected?.id===version.id?'active':''}`} onClick={()=>setSelectedId(version.id)}><span className="admin-agreement-version-mark">V</span><span><strong>{version.title}</strong><small>Version {version.versionCode} · Effective {formatDate(version.effectiveFrom)}</small></span></button>)}</div>
        </article>
        <article className="workspace-panel admin-agreement-document-card">
          {selected?<><div className="workspace-panel-heading"><div><p className="workspace-eyebrow">Immutable published version</p><h2>{selected.title}</h2><p>Version {selected.versionCode}</p></div><span className="workspace-status-pill good">Published</span></div><div className="workspace-detail-grid admin-agreement-facts"><Fact label="Effective" value={formatDate(selected.effectiveFrom)}/><Fact label="Published" value={formatDate(selected.publishedAt)}/><Fact label="Content integrity" value={`${selected.contentSha256.slice(0,16)}…`}/><Fact label="Scope" value="All SellerTray Businesses"/></div>{selected.sourceDocument?<div className="workspace-banner success"><strong>Reviewed source PDF</strong><span>{selected.sourceDocument.filename} · {selected.sourceDocument.pageCount} page{selected.sourceDocument.pageCount===1?'':'s'} · SHA-256 {selected.sourceDocument.pdfSha256.slice(0,18)}…</span></div>:<div className="workspace-banner info"><strong>Published from legal text</strong><span>No uploaded source PDF is attached to this immutable version.</span></div>}<div className="workspace-banner info admin-agreement-reason"><strong>Publication reason</strong><span>{selected.publishReason}</span></div><details className="admin-agreement-document"><summary>View accessible legal text</summary><pre>{selected.contentBody}</pre></details></>:<div className="workspace-empty-state"><strong>No version selected</strong><p>Published versions remain available for immutable legal history.</p></div>}
        </article>
      </div>

      {tenantId&&orderForms.length?<article className="workspace-panel">
        <div className="workspace-panel-heading"><div><p className="workspace-eyebrow">Selected merchant</p><h2>Agreement Package PDFs</h2><p>Admin retrieves the same private governed review/executed documents available to the merchant. Admin cannot sign on the merchant's behalf.</p></div></div>
        <div className="workspace-table-wrap"><table className="workspace-table compact-table"><thead><tr><th>Order Form</th><th>Issued</th><th>Status</th><th>Documents</th></tr></thead><tbody>{orderForms.map(row=><tr key={row.id}><td><strong>{row.reference}</strong><small>Version {row.templateVersionCode}</small></td><td>{formatDate(row.issuedAt)}</td><td>{row.confirmed?'Confirmed':'Awaiting signature'}</td><td><div className="workspace-actions"><button type="button" className="workspace-button secondary compact" disabled={documentBusy!==null} onClick={()=>void prepareAdminDocument(row,'review_pdf')}>{documentBusy===`${row.id}:review_pdf`?'Preparing…':'Review PDF'}</button><button type="button" className="workspace-button secondary compact" disabled={!row.confirmed||documentBusy!==null} onClick={()=>void prepareAdminDocument(row,'executed_pdf')}>{documentBusy===`${row.id}:executed_pdf`?'Preparing…':'Executed PDF'}</button></div></td></tr>)}</tbody></table></div>
      </article>:null}
    </>:<article className="workspace-panel admin-agreement-publish">
      <div className="workspace-panel-heading"><div><p className="workspace-eyebrow">Add new version</p><h2>New universal Master Agreement</h2><p>Publish one reviewed immutable version for the entire SellerTray platform.</p></div>{!state?.canPublish?<span className="workspace-status-pill neutral">Review only</span>:null}</div>
      <div className="workspace-banner warning">Do not enter merchant-specific pricing, order IDs, Branch terms or bespoke merchant clauses. The exact version published here applies to every SellerTray Business.</div>
      {state?.canPublish?<form className="workspace-form-stack" onSubmit={publish}>
        <div className="workspace-field-grid two"><label><span>Version code</span><input maxLength={64} required value={form.versionCode} onChange={e=>setForm(c=>({...c,versionCode:e.target.value}))} placeholder="e.g. 2026.1"/></label><label><span>Title</span><input maxLength={200} required value={form.title} onChange={e=>setForm(c=>({...c,title:e.target.value}))}/></label><label><span>Effective from</span><input type="datetime-local" required value={form.effectiveFrom} onChange={e=>setForm(c=>({...c,effectiveFrom:e.target.value}))}/></label><label><span>Publication reason</span><input maxLength={1000} required value={form.reason} onChange={e=>setForm(c=>({...c,reason:e.target.value}))} placeholder="Reviewed legal version publication"/></label></div>

        <div className="workspace-panel" style={{boxShadow:'none'}}>
          <div className="workspace-panel-heading"><div><p className="workspace-eyebrow">Legal source</p><h3>Add the reviewed agreement</h3><p>Upload the reviewed PDF for the professional document path, or paste reviewed legal text for a text-only version.</p></div></div>
          <div className="workspace-actions" role="group" aria-label="Master Agreement publication method"><button type="button" className={`workspace-button ${publishMethod==='pdf'?'primary':'secondary'}`} onClick={()=>{setPublishMethod('pdf');setForm(c=>({...c,contentBody:''}));}}>Upload reviewed PDF</button><button type="button" className={`workspace-button ${publishMethod==='paste'?'primary':'secondary'}`} onClick={()=>{setPublishMethod('paste');setSourceFile(null);}}>Paste legal content</button></div>
          {publishMethod==='pdf'?<label style={{display:'grid',gap:'8px',marginTop:'16px'}}><span>Reviewed Master Agreement PDF</span><input type="file" accept="application/pdf,.pdf" required onChange={e=>{const file=e.currentTarget.files?.[0]??null;if(file&&file.size>MAX_PDF_BYTES){setError('Reviewed Master Agreement PDF must be 8 MB or smaller.');e.currentTarget.value='';setSourceFile(null);return;}setError(null);setSourceFile(file);}}/>{sourceFile?<small>{sourceFile.name} · {formatBytes(sourceFile.size)}. SellerTray will extract accessible text server-side, hash the exact PDF and retain it as immutable source evidence.</small>:<small>PDF only · maximum 8 MB · text-based PDFs only. Scanned-image-only PDFs fail closed.</small>}</label>:<label style={{display:'grid',gap:'8px',marginTop:'16px'}}><span>Master Agreement content</span><textarea rows={18} maxLength={200000} required value={form.contentBody} onChange={e=>setForm(c=>({...c,contentBody:e.target.value}))} placeholder="Paste the reviewed universal SellerTray Master Agreement text here."/></label>}
        </div>
        <div className="workspace-banner info">Publishing is immutable. Uploaded PDFs are private source evidence; merchant-specific execution documents are generated separately from the governed Agreement Package.</div>
        <div className="workspace-actions"><button className="workspace-button primary" disabled={saving}>{saving?'Publishing…':publishMethod==='pdf'?'Upload & publish immutable version':'Publish immutable version'}</button></div>
      </form>:<p className="workspace-muted">Your ProcessEdge access is review-only for Master Agreement publication.</p>}
    </article>}
  </section>;
}

function Fact({label,value}:{label:string;value:string}){return <div className="workspace-detail"><span>{label}</span><strong>{value}</strong></div>;}
function record(value:unknown):Record<string,unknown>{return typeof value==='object'&&value!==null&&!Array.isArray(value)?value as Record<string,unknown>:{};}
function array(value:unknown):unknown[]{return Array.isArray(value)?value:[];}
function stringValue(value:unknown,fallback=''):string{return typeof value==='string'?value:fallback;}
function numberValue(value:unknown):number{const parsed=typeof value==='number'?value:Number(value);return Number.isFinite(parsed)?parsed:0;}
function formatDate(value:string){const date=new Date(value);return Number.isNaN(date.getTime())?'—':new Intl.DateTimeFormat('en-NG',{dateStyle:'medium',timeStyle:'short'}).format(date);}
function localDateTime(date:Date){const offset=date.getTimezoneOffset();return new Date(date.getTime()-offset*60_000).toISOString().slice(0,16);}
function messageFrom(value:unknown,fallback:string){return value instanceof Error&&value.message?value.message:fallback;}
function formatBytes(value:number){return value<1024*1024?`${Math.max(1,Math.round(value/1024))} KB`:`${(value/(1024*1024)).toFixed(1)} MB`;}
async function fileToBase64(file:File):Promise<string>{const buffer=new Uint8Array(await file.arrayBuffer());let binary='';const chunk=0x8000;for(let offset=0;offset<buffer.length;offset+=chunk)binary+=String.fromCharCode(...buffer.subarray(offset,Math.min(offset+chunk,buffer.length)));return btoa(binary);}
function parseSourceDocument(value:unknown):SourceDocument|null{const row=record(value);if(!stringValue(row.filename)||!stringValue(row.pdfSha256))return null;return{filename:stringValue(row.filename),pdfSha256:stringValue(row.pdfSha256),byteSize:numberValue(row.byteSize),pageCount:numberValue(row.pageCount)};}
function parseVersion(value:unknown):AgreementVersion|null{const row=record(value);if(typeof row.id!=='string')return null;return{id:row.id,versionCode:String(row.versionCode??''),title:String(row.title??'SellerTray Master Agreement'),contentBody:String(row.contentBody??''),contentSha256:String(row.contentSha256??''),effectiveFrom:String(row.effectiveFrom??''),publishedAt:String(row.publishedAt??''),publishedByUserId:String(row.publishedByUserId??''),publishReason:String(row.publishReason??''),sourceDocument:parseSourceDocument(row.sourceDocument)};}
function parseAcceptance(value:unknown):Acceptance|null{const row=record(value);if(typeof row.id!=='string')return null;return{id:row.id,versionCode:String(row.versionCode??''),acceptedAt:String(row.acceptedAt??''),acceptedLegalName:String(row.acceptedLegalName??''),acceptedRole:String(row.acceptedRole??''),acceptedByUserId:String(row.acceptedByUserId??'')};}
function parseTenantState(value:unknown):TenantState|null{const row=record(value);if(!Object.keys(row).length)return null;return{published:row.published===true,accepted:row.accepted===true,acceptanceRequired:row.acceptanceRequired===true,serviceDeliveryAllowed:row.serviceDeliveryAllowed===true,currentVersion:parseVersion(row.currentVersion),acceptance:parseAcceptance(row.acceptance)};}
function parseOrderForm(value:unknown):AdminOrderForm|null{const row=record(value);const id=stringValue(row.id);if(!id)return null;return{id,reference:stringValue(row.reference),commercialOrderId:stringValue(row.commercialOrderId),templateVersionCode:stringValue(row.templateVersionCode),confirmed:row.confirmed===true,confirmedAt:typeof row.confirmedAt==='string'?row.confirmedAt:null,packageFingerprint:typeof row.packageFingerprint==='string'?row.packageFingerprint:null,issuedAt:stringValue(row.issuedAt)};}
function parseOverview(value:unknown):AgreementOverview{const root=record(value);const versions=array(root.versions).flatMap(item=>{const parsed=parseVersion(item);return parsed?[parsed]:[]});const orderForms=array(root.orderForms).flatMap(item=>{const parsed=parseOrderForm(item);return parsed?[parsed]:[]});return{actorRole:String(root.actorRole??''),canPublish:root.canPublish===true,versions,tenantState:parseTenantState(root.tenantState),orderForms};}
function parseDocument(value:unknown,orderFormId:string,artifactKind:'review_pdf'|'executed_pdf'):PreparedDocument{const row=record(value);const signedUrl=stringValue(row.signedUrl);if(!signedUrl)throw new Error('Agreement Package PDF response is incomplete.');return{orderFormId,artifactKind,signedUrl,fileName:stringValue(row.fileName,'SellerTray Agreement Package.pdf'),packageFingerprint:stringValue(row.packageFingerprint),pdfSha256:stringValue(row.pdfSha256)};}
