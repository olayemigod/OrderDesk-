import test from 'node:test';
import assert from 'node:assert/strict';
import {safePreviewUrl,isVercelLoginRedirect,assessAnonymousResults,checkAnonymousAccess} from './oa5-vercel-anonymous-access.mjs';

const merchant='https://sellertray-merchant-git-synthetic-fixture-only-olayemigods-projects.vercel.app/';
const admin='https://sellertray-admin-git-synthetic-fixture-only-olayemigods-projects.vercel.app/';
const observation=(url,prod)=>({
 preview:{target:url,status:307,location:'https://vercel.com/login?next=private',contentType:'text/html'},
 production:{target:prod,status:200,contentType:'text/html; charset=utf-8',location:null},
});
const valid=()=>({merchant:observation(merchant,'https://app.sellertray.com/'),
 admin:observation(admin,'https://admin.sellertray.com/')});

test('recognizes only exact historical Vercel Preview hostnames per surface',()=>{
 assert.equal(safePreviewUrl(merchant,'merchant'),merchant);
 assert.equal(safePreviewUrl(admin,'admin'),admin);
 for(const bad of [
  'http://'+new URL(merchant).hostname+'/',
  'https://app.sellertray.com/',
  'https://test.sellertray.com/',
  'https://sellertray-admin-git-example-olayemigods-projects.vercel.app/',
  'https://sellertray-merchant-git-x-olayemigods-projects.vercel.app.evil.test/',
  'https://user:pass@'+new URL(merchant).hostname+'/',
  merchant+'?expose=true',
  merchant+'path',
 ])assert.equal(safePreviewUrl(bad,'merchant'),null,bad);
});
test('requires actual Vercel authentication redirect, not an arbitrary redirect',()=>{
 for(const code of [301,302,303,307,308])
  assert.equal(isVercelLoginRedirect(code,'https://vercel.com/login?next=private'),true);
 for(const [code,url] of [
  [200,'https://vercel.com/login'],[307,'https://attacker.test/login'],
  [307,'http://vercel.com/login'],[307,'https://vercel.com.evil.test/login'],
  [307,'https://vercel.com/pricing'],[401,'https://vercel.com/login'],
  [307,'//vercel.com/login'],[307,'https://user:pw@vercel.com/login'],
 ])assert.equal(isVercelLoginRedirect(code,url),false);
});
test('valid metadata only demonstrates anonymous pre-binding prerequisite',()=>{
 const result=assessAnonymousResults(valid());
 assert.equal(result.ok,true,result.errors.join('\n'));
 assert.equal(result.hosted_acceptance,false);
});
test('fails closed when historical Preview allows anonymous 200 or unrelated redirects',()=>{
 for(const change of [
  x=>x.merchant.preview.status=200,
  x=>x.admin.preview.location='https://vercel.com/pricing',
  x=>x.merchant.preview.status=401,
  x=>x.admin.preview.status=500,
 ]){
  const x=valid();change(x);
  assert.equal(assessAnonymousResults(x).ok,false);
 }
});
test('fails closed when Production is gated or returns non-HTML',()=>{
 for(const change of [
  x=>x.merchant.production.status=307,
  x=>x.admin.production.status=503,
  x=>x.merchant.production.contentType='application/json',
  x=>x.admin.production.target='https://sellertray-admin.vercel.app/'
 ]){const x=valid();change(x);assert.equal(assessAnonymousResults(x).ok,false);}
});
test('rejects missing/unknown surfaces and swapped Preview URLs',()=>{
 for(const change of [
  x=>delete x.admin,
  x=>x.extra=true,
  x=>x.merchant.preview.target=admin,
  x=>x.admin.preview.target=merchant,
 ]){const x=valid();change(x);assert.equal(assessAnonymousResults(x).ok,false);}
});
test('live reader supplies no cookies or authorization, stops at redirect, and never follows login',async()=>{
 const calls=[];
 const fetcher=async(url,options)=>{
  calls.push({url,options});
  const preview=url.includes('.vercel.app');
  return {status:preview?307:200,headers:new Map([
   ['location',preview?'https://vercel.com/login?next=private':null],
   ['content-type','text/html'],
  ])};
 };
 const env={
  SELLERTRAY_OA5_MERCHANT_HISTORICAL_PREVIEW_URL:merchant,
  SELLERTRAY_OA5_ADMIN_HISTORICAL_PREVIEW_URL:admin,
 };
 const result=await checkAnonymousAccess(env,fetcher);
 assert.equal(result.ok,true,result.errors.join('\n'));
 assert.equal(calls.length,4);
 for(const c of calls){
  assert.equal(c.options.method,'GET');
  assert.equal(c.options.redirect,'manual');
  assert.deepEqual(c.options.headers,{accept:'text/html'});
  assert.ok(!Object.hasOwn(c.options.headers,'authorization'));
  assert.ok(!Object.hasOwn(c.options.headers,'cookie'));
 }
});
test('network failure and absent operator URLs block without an automatic external request',async()=>{
 let count=0;
 const fail=async()=>{count++;throw Error('offline');};
 const missing=await checkAnonymousAccess({},fail);
 assert.equal(missing.ok,false);assert.equal(count,0);
 const env={SELLERTRAY_OA5_MERCHANT_HISTORICAL_PREVIEW_URL:merchant,
   SELLERTRAY_OA5_ADMIN_HISTORICAL_PREVIEW_URL:admin};
 const err=await checkAnonymousAccess(env,fail);
 assert.equal(err.ok,false);assert.equal(count,1);
});
