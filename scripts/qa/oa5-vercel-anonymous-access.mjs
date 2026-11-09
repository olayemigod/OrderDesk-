#!/usr/bin/env node
/**
 * OA5 pre-binding Vercel access-protection smoke.
 *
 * A deliberately anonymous, read-only GET of two protected historical
 * Preview deployment URLs and two canonical public Production domains.
 * Not run by CI; --live must be explicitly selected by an operator.
 * This does NOT prove authorized reviewer access, compiled JS identity,
 * future QA custom-domain protection or approval of the Test backend.
 *
 * Preview URLs are supplied through protected operator environment variables;
 * never log them or commit them to source control.
 */
const EXPECTED=Object.freeze({
  merchant:{
    environment:'SELLERTRAY_OA5_MERCHANT_HISTORICAL_PREVIEW_URL',
    previewPrefix:'sellertray-merchant-',
    production:'https://app.sellertray.com/',
  },
  admin:{
    environment:'SELLERTRAY_OA5_ADMIN_HISTORICAL_PREVIEW_URL',
    previewPrefix:'sellertray-admin-',
    production:'https://admin.sellertray.com/',
  },
});
const PREVIEW_SUFFIX='-olayemigods-projects.vercel.app';
const REDIRECT_CODES=new Set([301,302,303,307,308]);

export function safePreviewUrl(raw,surface){
  const expectation=EXPECTED[surface];
  if(!expectation||typeof raw!=='string'||raw.trim()!==raw)return null;
  try{
    const u=new URL(raw);
    if(u.protocol!=='https:'||u.username||u.password||u.port
      ||u.pathname!=='/'||u.search||u.hash)return null;
    const host=u.hostname;
    if(!host.startsWith(expectation.previewPrefix)||!host.endsWith(PREVIEW_SUFFIX))
      return null;
    const segment=host.slice(expectation.previewPrefix.length,-PREVIEW_SUFFIX.length);
    if(!/^[a-z0-9][a-z0-9-]*$/.test(segment))return null;
    return u.origin+'/';
  }catch{return null;}
}
export function isVercelLoginRedirect(code,rawLocation){
  if(!REDIRECT_CODES.has(code)||typeof rawLocation!=='string')return false;
  try{
    const u=new URL(rawLocation);
    if(u.protocol!=='https:'||u.username||u.password||u.port)return false;
    if(u.hostname!=='vercel.com'&&!u.hostname.endsWith('.vercel.com'))return false;
    return /(?:login|sso|auth)/i.test(u.pathname);
  }catch{return false;}
}
export function assessAnonymousResults(observations){
  const errors=[];
  if(!observations||typeof observations!=='object'||Array.isArray(observations))
    return {ok:false,errors:['Missing anonymous access observations'],hosted_acceptance:false};
  for(const surface of Object.keys(EXPECTED)){
    const obs=observations[surface];
    if(!obs||typeof obs!=='object'){errors.push(surface+': observations are missing');continue;}
    const expected=EXPECTED[surface];
    if(safePreviewUrl(obs.preview?.target,surface)===null)
      errors.push(surface+': historical Preview URL is not from the expected project');
    if(!isVercelLoginRedirect(obs.preview?.status,obs.preview?.location))
      errors.push(surface+': signed-out Preview did not prove a Vercel login redirect');
    if(obs.production?.target!==expected.production)
      errors.push(surface+': Production custom domain identity mismatch');
    if(obs.production?.status!==200
      ||!/^text\/html(?:\s*;|$)/i.test(obs.production?.contentType||''))
      errors.push(surface+': Production custom domain did not return public HTML');
    if(obs.preview?.target===obs.production?.target)
      errors.push(surface+': Preview and Production cannot be the same URL');
  }
  if(Object.keys(observations).sort().join(',')!=='admin,merchant')
    errors.push('Unexpected or incomplete surface census');
  return {ok:errors.length===0,errors,
    hosted_acceptance:false,
    manual_followup:'Authorized historical reviewer and post-binding QA custom-domain checks are still required'};
}
export async function checkAnonymousAccess(env,fetchImpl=fetch){
  const observations={};
  for(const [surface,settings] of Object.entries(EXPECTED)){
    const preview=safePreviewUrl(env?.[settings.environment],surface);
    if(!preview)return {ok:false,errors:[surface+': protected historical Preview URL unavailable or invalid'],hosted_acceptance:false};
    const inspect=async target=>{
      const response=await fetchImpl(target,{
        method:'GET',
        redirect:'manual',
        headers:{accept:'text/html'},
        signal:AbortSignal.timeout(12000),
      });
      return {
        target,status:response.status,
        location:response.headers.get('location'),
        contentType:response.headers.get('content-type'),
      };
    };
    try{
      observations[surface]={
        preview:await inspect(preview),
        production:await inspect(settings.production),
      };
    }catch{
      return {ok:false,errors:[surface+': anonymous HTTP read failed or timed out'],hosted_acceptance:false};
    }
  }
  return assessAnonymousResults(observations);
}
export async function main(args=process.argv.slice(2)){
  if(args.length!==1||args[0]!=='--live'){
    console.error('Usage: node scripts/qa/oa5-vercel-anonymous-access.mjs --live');
    console.error('Requires two protected historical Preview URLs in operator environment; never saves or prints URL/key values.');
    process.exitCode=2;return;
  }
  const result=await checkAnonymousAccess(process.env);
  if(!result.ok){
    console.error('BLOCKED: Anonymous Vercel Preview / Production scope mismatch:');
    for(const reason of result.errors)console.error(' - '+reason);
    process.exitCode=1;return;
  }
  console.log('PASS: Signed-out historical Merchant/Admin Previews redirect to Vercel authentication.');
  console.log('PASS: Both canonical Production custom domains return public HTML.');
  console.log('NOT an approval of historical reviewer continuity, future QA custom-domain protection or backend/PSP/Meta staging.');
}
if(process.argv[1]&&new URL(import.meta.url).pathname===new URL('file://'+process.argv[1]).pathname)
  await main();
