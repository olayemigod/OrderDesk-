import { createClient } from 'npm:@supabase/supabase-js@2.115.0';

type JsonRecord = Record<string, unknown>;
type LegacyCheckoutResult = {
  orderId:string;
  paymentId:string;
  paymentMethodId:string|null;
  methodType:string;
  status:string;
  paymentStatus:string;
  fulfillmentStatus:string;
  inventoryMovementCount:number;
  idempotentReplay:boolean;
};
type AllocationPayment = {
  paymentId:string;
  paymentMethodId:string|null;
  methodType:string;
  status:string;
  amount:number;
};
type AllocationCheckoutResult = {
  orderId:string;
  status:'completed'|'awaiting_payment_confirmation';
  paymentStatus:string;
  fulfillmentStatus:string;
  amountPaid:number;
  outstandingAmount:number;
  paymentTerms:'immediate'|'partial'|'pay_later';
  payments:AllocationPayment[];
  inventoryMovementCount:number;
  idempotentReplay:boolean;
};
type CheckoutResult = LegacyCheckoutResult | AllocationCheckoutResult;

const SUPABASE_URL=Deno.env.get('SUPABASE_URL')??'';
const SERVICE_ROLE_KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'';
const MAX_BODY_BYTES=16384;
const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, x-request-id',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
};
const admin=SUPABASE_URL&&SERVICE_ROLE_KEY
  ?createClient(SUPABASE_URL,SERVICE_ROLE_KEY,{auth:{autoRefreshToken:false,persistSession:false,detectSessionInUrl:false}})
  :null;

Deno.serve(async(request)=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(request.method!=='POST')return json({error:'Method not allowed'},405);
  if(!admin)return json({error:'Server configuration error'},500);

  const authorization=request.headers.get('authorization')??'';
  const token=authorization.startsWith('Bearer ')?authorization.slice(7):'';
  if(!token)return json({error:'Authentication required'},401);
  const {data:authData,error:authError}=await admin.auth.getUser(token);
  const userId=authData.user?.id??null;
  if(authError||!userId)return json({error:'Authentication required'},401);

  const bodyRead=await readRequestTextLimited(request,MAX_BODY_BYTES);
  if(!bodyRead.ok)return json({error:'Payload too large'},413);
  let body:JsonRecord;
  try{body=JSON.parse(bodyRead.text) as JsonRecord}catch{return json({error:'Invalid JSON'},400)}

  const tenantId=cleanUuid(body.tenantId);
  const orderId=cleanUuid(body.orderId);
  if(!tenantId||!orderId)return json({error:'Business and sale are required'},400);

  const {data:membership,error:membershipError}=await admin
    .from('tenant_members')
    .select('role')
    .eq('tenant_id',tenantId)
    .eq('user_id',userId)
    .maybeSingle();
  if(membershipError)return json({error:membershipError.message},400);
  if(!membership)return json({error:'You do not have access to this business'},403);

  // Persist the authenticated POS operator before settlement. This is an immutable
  // transaction fact and is idempotent for retries by the same cashier.
  const {error:operatorError}=await admin.rpc('set_sellertray_pos_operator_snapshot',{
    p_tenant_id:tenantId,
    p_order_id:orderId,
    p_actor_user_id:userId,
  });
  if(operatorError){
    const message=operatorError.message??'Unable to record cashier for this sale';
    return json({error:message},statusForCheckoutError(message));
  }

  const allocationMode=body.allocations!==undefined||body.payLater===true||body.commandId!==undefined;
  let result:CheckoutResult;

  if(allocationMode){
    const commandId=cleanUuid(body.commandId);
    if(!commandId)return json({error:'A valid checkout command is required'},400);
    if(!Array.isArray(body.allocations))return json({error:'Payment allocations must be a list'},400);
    if(body.allocations.length>10)return json({error:'Use at most 10 payment allocations'},400);
    const allocations:JsonRecord[]=[];
    for(const raw of body.allocations){
      if(!raw||typeof raw!=='object'||Array.isArray(raw))return json({error:'Payment allocation is invalid'},400);
      const row=raw as JsonRecord;
      const amount=numberOrNull(row.amount);
      if(amount===null||amount<=0)return json({error:'Each payment allocation needs a valid amount'},400);
      const rawMethod=row.paymentMethodId;
      const paymentMethodId=rawMethod===null||rawMethod===undefined||rawMethod===''?null:cleanUuid(rawMethod);
      if(rawMethod!==null&&rawMethod!==undefined&&rawMethod!==''&&!paymentMethodId)return json({error:'A valid payment method is required'},400);

      const hasProviderReference=row.providerReference!==undefined&&row.providerReference!==null&&row.providerReference!=='';
      const hasCapturedAt=row.offlineCapturedAt!==undefined&&row.offlineCapturedAt!==null&&row.offlineCapturedAt!=='';
      if(hasProviderReference!==hasCapturedAt)return json({error:'Offline Bank evidence requires both transfer reference and captured time'},400);
      const providerReference=hasProviderReference?cleanProviderReference(row.providerReference):null;
      const offlineCapturedAt=hasCapturedAt?cleanIsoTimestamp(row.offlineCapturedAt):null;
      if(hasProviderReference&&!providerReference)return json({error:'Enter a valid Bank transfer reference'},400);
      if(hasCapturedAt&&!offlineCapturedAt)return json({error:'Offline Bank evidence has an invalid captured time'},400);
      if(providerReference&&row.confirmNow===true)return json({error:'Offline Bank payments must be verified before confirmation'},400);

      allocations.push({
        paymentMethodId,
        amount,
        confirmNow:row.confirmNow===true,
        ...(providerReference&&offlineCapturedAt?{providerReference,offlineCapturedAt}:{}),
      });
    }

    const {data,error}=await admin.rpc('checkout_sellertray_pos_sale',{
      p_tenant_id:tenantId,
      p_order_id:orderId,
      p_allocations:allocations,
      p_pay_later:body.payLater===true,
      p_actor_user_id:userId,
      p_command_id:commandId,
    });
    if(error||!isAllocationCheckoutResult(data)){
      const message=error?.message??'Unable to process this sale';
      return json({error:message},statusForCheckoutError(message));
    }
    result=data;
  }else{
    const legacyPaymentMethod=body.paymentMethod===undefined?null:cleanText(body.paymentMethod,32);
    const rawPaymentMethodId=body.paymentMethodId;
    const paymentMethodId=rawPaymentMethodId===null||rawPaymentMethodId===undefined||rawPaymentMethodId===''?null:cleanUuid(rawPaymentMethodId);
    if(rawPaymentMethodId!==null&&rawPaymentMethodId!==undefined&&rawPaymentMethodId!==''&&!paymentMethodId)return json({error:'A valid payment method is required'},400);
    if(legacyPaymentMethod&&legacyPaymentMethod!=='cash')return json({error:'Use the branch payment method identifier for non-cash checkout'},400);
    if(legacyPaymentMethod==='cash'&&paymentMethodId)return json({error:'Cash checkout cannot include a merchant payment method identifier'},400);

    let methodType='cash';
    if(paymentMethodId){
      const {data:method,error:methodError}=await admin
        .from('merchant_payment_methods')
        .select('method_type')
        .eq('tenant_id',tenantId)
        .eq('id',paymentMethodId)
        .eq('is_enabled',true)
        .maybeSingle();
      if(methodError)return json({error:methodError.message},400);
      if(!method)return json({error:'Selected payment method is not enabled'},409);
      methodType=String(method.method_type??'');
    }

    const rpcName=methodType==='bank_transfer'
      ?'initiate_sellertray_pos_bank_transfer'
      :'complete_sellertray_pos_sale';
    const {data,error}=await admin.rpc(rpcName,{
      p_tenant_id:tenantId,
      p_order_id:orderId,
      p_payment_method_id:paymentMethodId,
      p_actor_user_id:userId,
    });
    if(error||!isLegacyCheckoutResult(data)){
      const message=error?.message??'Unable to process this sale';
      return json({error:message},statusForCheckoutError(message));
    }
    result=data;
  }

  await writeCompletionAudit({
    tenantId,
    orderId,
    userId,
    role:String(membership.role),
    result,
  });
  return json({ok:true,...result});
});

async function writeCompletionAudit(input:{tenantId:string;orderId:string;userId:string;role:string;result:CheckoutResult}){
  if(!admin)return;
  const {data:order}=await admin
    .from('orders')
    .select('customer_id,branch_id,public_order_id,total_amount,currency,status,payment_status,amount_paid,fulfillment_status,fulfillment_method')
    .eq('tenant_id',input.tenantId)
    .eq('id',input.orderId)
    .maybeSingle();
  if(!order)return;

  const completed=input.result.status==='completed';
  const allocationResult=isAllocationCheckoutResult(input.result)?input.result:null;
  const legacyResult=isLegacyCheckoutResult(input.result)?input.result:null;
  const {error}=await admin.from('commercial_action_ledger').upsert({
    tenant_id:input.tenantId,
    action_key:(completed?'pos-complete:':'pos-payment-pending:')+input.orderId,
    channel:'merchant_app',
    customer_id:order.customer_id,
    target_order_id:input.orderId,
    action_type:completed?'pos_sale_completed':'pos_payment_awaiting_confirmation',
    risk_class:'high',
    requested_by:input.role==='staff'?'staff':'merchant',
    actor_user_id:input.userId,
    policy_result:'allowed',
    action_status:completed?'applied':'pending',
    financial_impact:completed?numberOrNull(order.amount_paid??order.total_amount):null,
    currency:typeof order.currency==='string'?order.currency:null,
    before_state:{status:'draft',payment_status:'unpaid'},
    after_state:{
      public_order_id:order.public_order_id,
      status:order.status,
      payment_status:order.payment_status,
      amount_paid:order.amount_paid,
      fulfillment_status:order.fulfillment_status,
      fulfillment_method:order.fulfillment_method,
      branch_id:order.branch_id,
    },
    metadata:allocationResult?{
      payment_terms:allocationResult.paymentTerms,
      payments:allocationResult.payments,
      outstanding_amount:allocationResult.outstandingAmount,
      inventory_movement_count:allocationResult.inventoryMovementCount,
      idempotent_replay:allocationResult.idempotentReplay,
    }:{
      payment_method_id:legacyResult?.paymentMethodId??null,
      payment_method_type:legacyResult?.methodType??null,
      payment_id:legacyResult?.paymentId??null,
      inventory_movement_count:legacyResult?.inventoryMovementCount??0,
      idempotent_replay:legacyResult?.idempotentReplay??false,
    },
    applied_at:completed?new Date().toISOString():null,
  },{onConflict:'tenant_id,action_key',ignoreDuplicates:true});
  if(error)console.warn('SellerTray POS audit write failed',error.message);
}

function isLegacyCheckoutResult(value:unknown):value is LegacyCheckoutResult{
  if(!value||typeof value!=='object')return false;
  const row=value as JsonRecord;
  const pending=row.status==='awaiting_payment_confirmation'&&row.paymentStatus==='unpaid';
  const settled=row.status==='completed'&&row.paymentStatus==='paid'&&row.fulfillmentStatus==='collected';
  return typeof row.orderId==='string'
    &&typeof row.paymentId==='string'
    &&(row.paymentMethodId===null||row.paymentMethodId===undefined||typeof row.paymentMethodId==='string')
    &&typeof row.methodType==='string'
    &&(pending||settled)
    &&typeof row.inventoryMovementCount==='number'
    &&typeof row.idempotentReplay==='boolean';
}

function isAllocationCheckoutResult(value:unknown):value is AllocationCheckoutResult{
  if(!value||typeof value!=='object')return false;
  const row=value as JsonRecord;
  if(row.status!=='completed'&&row.status!=='awaiting_payment_confirmation')return false;
  if(row.paymentTerms!=='immediate'&&row.paymentTerms!=='partial'&&row.paymentTerms!=='pay_later')return false;
  if(typeof row.orderId!=='string'||typeof row.paymentStatus!=='string'||typeof row.fulfillmentStatus!=='string')return false;
  if(numberOrNull(row.amountPaid)===null||numberOrNull(row.outstandingAmount)===null)return false;
  if(typeof row.inventoryMovementCount!=='number'||typeof row.idempotentReplay!=='boolean'||!Array.isArray(row.payments))return false;
  return row.payments.every((raw)=>{
    if(!raw||typeof raw!=='object'||Array.isArray(raw))return false;
    const payment=raw as JsonRecord;
    return typeof payment.paymentId==='string'
      &&(payment.paymentMethodId===null||payment.paymentMethodId===undefined||typeof payment.paymentMethodId==='string')
      &&typeof payment.methodType==='string'
      &&typeof payment.status==='string'
      &&numberOrNull(payment.amount)!==null;
  });
}

function statusForCheckoutError(message:string){
  return /membership|access|role|permission|read-only|disabled in sellertray settings|requires confirmation/i.test(message)
    ?403
    :/not found/i.test(message)
      ?404
      :/insufficient stock|not assigned|not enabled|already|inconsistent|conflicts|exceed|provider reference/i.test(message)
        ?409
        :400;
}
function cleanUuid(value:unknown){
  if(typeof value!=='string')return null;
  const clean=value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean)?clean:null;
}
function cleanText(value:unknown,max:number){
  if(typeof value!=='string')return null;
  const clean=value.trim().replace(/\s+/g,' ');
  return clean?clean.slice(0,max):null;
}
function cleanProviderReference(value:unknown){
  if(typeof value!=='string')return null;
  const clean=value.trim();
  return clean.length>0&&clean.length<=128&&/^[A-Za-z0-9._:-]+$/.test(clean)?clean:null;
}
function cleanIsoTimestamp(value:unknown){
  if(typeof value!=='string')return null;
  const clean=value.trim();
  if(!clean||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(clean))return null;
  const parsed=Date.parse(clean);
  return Number.isFinite(parsed)?clean:null;
}
function numberOrNull(value:unknown){
  const number=typeof value==='number'?value:Number(value);
  return Number.isFinite(number)?number:null;
}
async function readRequestTextLimited(request:Request,maxBytes:number):Promise<{ok:true;text:string}|{ok:false}>{
  const declared=Number(request.headers.get('content-length')??0);
  if(Number.isFinite(declared)&&declared>maxBytes)return{ok:false};
  if(!request.body)return{ok:true,text:''};
  const reader=request.body.getReader(),decoder=new TextDecoder(),parts:string[]=[];
  let total=0;
  try{
    while(true){
      const{done,value}=await reader.read();
      if(done)break;
      total+=value.byteLength;
      if(total>maxBytes){await reader.cancel();return{ok:false}}
      parts.push(decoder.decode(value,{stream:true}));
    }
    parts.push(decoder.decode());
    return{ok:true,text:parts.join('')};
  }finally{
    try{reader.releaseLock()}catch{}
  }
}
function json(payload:JsonRecord,status=200){
  return new Response(JSON.stringify(payload),{
    status,
    headers:{...corsHeaders,'content-type':'application/json; charset=utf-8','cache-control':'no-store'},
  });
}
