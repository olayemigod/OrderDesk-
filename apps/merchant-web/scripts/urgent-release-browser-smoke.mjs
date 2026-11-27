// Real Chromium UI against a reserved .invalid API; never connect to hosted Supabase.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const root = 'http://127.0.0.1:4173';
const backend = 'https://sellertray-smoke.invalid';
const inviteId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const tenantId = '33333333-3333-4333-8333-333333333333';
const branchId = '44444444-4444-4444-8444-444444444444';
const secondId = '55555555-5555-4555-8555-555555555555';
const email = 'invitee@example.invalid';
const user = { id: userId, aud: 'authenticated', role: 'authenticated', email, email_confirmed_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const expires = Math.floor(Date.now()/1000)+3600;
const session = { access_token: b64({alg:'HS256',typ:'JWT'})+'.'+b64({sub:userId,role:'authenticated',email,exp:expires})+'.synthetic', refresh_token:'synthetic', token_type:'bearer', expires_in:3600, expires_at:expires, user };
const business = (role='owner', id=tenantId) => ({ id,name:id===tenantId?'First Business':'Inviting Business',merchant_code:'QA',role,currency:'NGN',subscription_status:'active' });
const pending = { invitationId:inviteId, tenantName:'Inviting Business', role:'manager', expiresAt:'2099-01-01T00:00:00Z' };
const require = createRequire(resolve(process.env.SELLERTRAY_BROWSER_TOOLS, 'package.json'));
const { chromium } = require('playwright');
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4173','--strictPort'],{stdio:'inherit'});
let browser;
async function scenario(label, options, test) {
  const context=await browser.newContext({viewport:{width:1280,height:900}, serviceWorkers:'block'});
  const page=await context.newPage();
  const calls=[], unexpected=[], pageErrors=[];
  let businesses=options.businesses??[], invitations=options.invitations??[];
  page.on('pageerror', e=>pageErrors.push(e.message));
  await context.addInitScript(({session, signedIn})=>{
    if(signedIn) localStorage.setItem('sb-sellertray-smoke-auth-token',JSON.stringify(session));
  },{session,signedIn:options.signedIn!==false});
  await context.routeWebSocket('**/*',ws=>ws.close());
  await context.route('**/*', async route=>{
    const req=route.request(), url=new URL(req.url());
    if(url.origin===root) return route.continue();
    if(url.origin!==backend){ unexpected.push(url.origin+url.pathname); return route.abort(); }
    const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,OPTIONS','content-type':'application/json'};
    const reply=(body,status=200)=>route.fulfill({status,headers,body:JSON.stringify(body)});
    if(req.method()==='OPTIONS')return reply({});
    const data=req.postDataJSON()??{};
    calls.push({path:url.pathname,search:url.search,data});
    if(url.pathname==='/auth/v1/token')return reply(session);
    if(url.pathname==='/auth/v1/signup')return reply(user);
    if(url.pathname==='/auth/v1/recover')return reply({});
    if(url.pathname==='/auth/v1/user')return reply(user);
    if(url.pathname==='/auth/v1/logout')return reply({});
    if(url.pathname==='/functions/v1/team-management'){
      if(data.action==='pending_invites')return reply({invitations});
      if(data.action==='accept_invite' && data.invitationId===inviteId){
        if(options.deny)return reply({error:'Invitation is not available to this account'},403);
        invitations=[]; businesses=[...businesses,business('manager',secondId)];
        return reply({result:{accepted:true}});
      }
    }
    if(url.pathname==='/rest/v1/rpc/sellertray_list_businesses_for_current_user')return reply(businesses);
    if(url.pathname==='/rest/v1/rpc/get_sellertray_business_profile')return reply({name:'First Business',logoUrl:'',currency:'NGN'});
    if(url.pathname==='/rest/v1/rpc/get_sellertray_accessible_branches')return reply([{id:branchId,name:'QA Branch',code:'QA',is_default:true}]);
    if(url.pathname==='/rest/v1/rpc/sellertray_merchant_unread_notification_count')return reply(0);
    if(url.pathname==='/rest/v1/rpc/get_sellertray_report_management')return reply({});
    if(url.pathname==='/rest/v1/rpc/get_sellertray_order_management_list')return reply({items:[],totalCount:0,limit:50,offset:0});
    if(url.pathname==='/rest/v1/rpc/get_sellertray_customer_management_list')return reply({items:[{id:userId,displayName:'Synthetic Customer',createdAt:'2026-01-01T00:00:00Z'}],totalCount:1});
    if(url.pathname==='/rest/v1/rpc/get_sellertray_customer_management_detail')return reply({customer:{id:userId,displayName:'Synthetic Customer',createdAt:'2026-01-01T00:00:00Z'},summary:{completedOrderCount:1,totalSales:400,collected:400,outstanding:0},orders:[{id:inviteId,branchId:secondId,publicOrderId:'QA/001',status:'completed',paymentStatus:'paid',source:'pos',totalAmount:400,amountPaid:400,createdAt:'2026-01-01T00:00:00Z'}]});
    if(url.pathname==='/rest/v1/rpc/get_sellertray_order_management_detail'){
      if(data.p_branch_id!==secondId||data.p_tenant_id!==tenantId||data.p_order_id!==inviteId)return reply({message:'Incorrect order scope'},403);
      return reply({id:inviteId,publicOrderId:'QA/001',status:'completed',source:'pos',paymentStatus:'paid',totalAmount:400,amountPaid:400,currency:'NGN',items:[{id:userId,itemName:'Synthetic Item',selectedUom:'Each',quantity:2,unitPrice:200}]});
    }
    if(url.pathname==='/rest/v1/rpc/get_sellertray_profitability_report'){
      const missing=data.p_source==='whatsapp';
      const summary={salesCount:1,fullyCostedSales:missing?0:1,incompleteCostSales:missing?1:0,costComplete:!missing,netRevenue:400,knownCogs:missing?0:200,grossProfit:missing?null:200,grossMarginPercent:missing?null:50};
      return reply({dateFrom:data.p_date_from,dateTo:data.p_date_to,timezone:'Africa/Lagos',currency:'NGN',summary,branches:[{...summary,branchId,branchName:'QA Branch'}]});
    }
    unexpected.push(url.pathname); return reply({error:'Unexpected smoke-test request'},500);
  });
  try{
    await page.goto(root+(options.focus===false?'/':'/?invitation='+inviteId));
    await test(page,calls);
    assert.deepEqual(unexpected,[],'unmocked requests');
    assert.deepEqual(pageErrors,[],'uncaught browser errors');
    console.log('PASS '+label);
  }catch(error){
    console.error('FAILED '+label, JSON.stringify({body:(await page.locator('body').innerText().catch(()=>'' )).slice(0,4000),calls:calls.map(x=>({path:x.path,action:x.data.action})),unexpected,pageErrors}));
    throw error;
  }finally{await context.close();}
}
const hasAction=(calls,action)=>calls.some(x=>x.path==='/functions/v1/team-management'&&x.data.action===action);
try{
  for(let n=0;n<60;n++){
    try{if((await fetch(root)).ok)break;}catch{}
    if(n===59)throw Error('Local Vite preview did not start');
    await sleep(500);
  }
  browser=await chromium.launch({headless:true});
  await scenario('existing invitee without Business accepts explicitly',{invitations:[pending]},async(p,calls)=>{
    await p.getByRole('button',{name:'Accept',exact:true}).waitFor();
    assert.equal(hasAction(calls,'accept_invite'),false);
    await p.getByRole('button',{name:'Accept',exact:true}).click();
    await p.getByRole('heading',{name:'Business overview'}).waitFor();
    assert.equal(hasAction(calls,'accept_invite'),true);
    assert.equal(new URL(p.url()).searchParams.has('invitation'),false);
  });
  await scenario('Cashier can review, existing role not promoted automatically',{businesses:[business('staff')],invitations:[pending]},async(p,calls)=>{
    await p.getByRole('heading',{name:'Use SellerTray mobile for daily operations'}).waitFor();
    await p.getByRole('button',{name:'Accept',exact:true}).waitFor();
    assert.equal(hasAction(calls,'accept_invite'),false);
  });
  await scenario('second Business invitation denial leaves membership unchanged',{businesses:[business()],invitations:[pending],deny:true},async(p,calls)=>{
    const denied=p.waitForResponse(r=>r.url().endsWith('/functions/v1/team-management')&&r.request().postDataJSON()?.action==='accept_invite');
    await p.getByRole('button',{name:'Accept',exact:true}).click();
    assert.equal((await denied).status(),403);
    const banner=p.locator('.invitation-panel .error-banner');
    await banner.waitFor();
    assert.match(await banner.innerText(),/Invitation is not available to this account|Unable to accept this Business invitation|Edge Function returned a non-2xx status code/i);
    assert.equal(hasAction(calls,'accept_invite'),true);
    await p.getByRole('button',{name:'Accept',exact:true}).waitFor();
    assert.equal(await p.getByRole('option',{name:'Inviting Business'}).count(),0);
  });
  await scenario('resolved or unavailable invitation never auto-accepts',{businesses:[business()]},async(p,calls)=>{
    await p.getByText('This invitation is no longer pending',{exact:true}).waitFor();
    assert.equal(hasAction(calls,'accept_invite'),false);
  });
  await scenario('invited registration retains locator and creates Auth identity only',{signedIn:false},async(p,calls)=>{
    await p.getByRole('button',{name:'New to SellerTray? Create an account to accept the invitation'}).click();
    await p.getByLabel('Email',{exact:true}).fill(email);
    await p.getByLabel('Password',{exact:true}).fill('synthetic-password');
    await p.getByLabel('Confirm password',{exact:true}).fill('synthetic-password');
    await p.getByRole('button',{name:'Create account',exact:true}).click();
    await p.getByText('Check your email to confirm your SellerTray account.',{exact:false}).waitFor();
    const signup=calls.find(x=>x.path==='/auth/v1/signup');
    assert.ok(signup);
    assert.equal(new URL(new URLSearchParams(signup.search).get('redirect_to')).searchParams.get('invitation'),inviteId);
    assert.equal(hasAction(calls,'accept_invite'),false);
    assert.equal(calls.some(x=>x.path.includes('provision-business')),false);
  });
  await scenario('password visibility and recovery use the active auth surface',{signedIn:false,focus:false},async(p,calls)=>{
    await p.getByLabel('Password',{exact:true}).fill('synthetic-password');
    await p.getByRole('button',{name:'Show password',exact:true}).click();
    assert.equal(await p.getByLabel('Password',{exact:true}).getAttribute('type'),'text');
    await p.getByRole('button',{name:'Hide password',exact:true}).click();
    assert.equal(await p.getByLabel('Password',{exact:true}).getAttribute('type'),'password');
    await p.getByRole('button',{name:'Forgot password?',exact:true}).click();
    await p.getByLabel('Email',{exact:true}).fill(email);
    await p.getByRole('button',{name:'Send reset instructions',exact:true}).click();
    await p.getByText('If an account exists for that email',{exact:false}).waitFor();
    assert.ok(calls.some(x=>x.path==='/auth/v1/recover'));
    assert.equal(calls.some(x=>x.path.includes('provision-business')),false);
  });
  await scenario('refresh and browser Back/Forward preserve valid merchant pages',{businesses:[business()],focus:false},async(p,calls)=>{
    await p.getByRole('heading',{name:'Business overview'}).waitFor();
    await p.getByRole('button',{name:'Orders',exact:true}).click();
    await p.getByRole('button',{name:/Search & filter orders/}).waitFor();
    assert.equal(new URL(p.url()).searchParams.get('page'),'orders');
    await p.getByRole('button',{name:'Customers',exact:true}).click();
    await p.getByRole('button',{name:'Open order QA/001'}).waitFor();
    await p.goBack();
    await p.getByRole('button',{name:/Search & filter orders/}).waitFor();
    await p.goForward();
    await p.getByRole('button',{name:'Open order QA/001'}).waitFor();
    await p.reload();
    await p.getByRole('button',{name:'Open order QA/001'}).waitFor();
    assert.equal(new URL(p.url()).searchParams.get('page'),'customers');
  });
  await scenario('ordinary login and collapsed Orders filters retain governed query',{signedIn:false,focus:false,businesses:[business()]},async(p,calls)=>{
    await p.getByLabel('Email',{exact:true}).fill(email);
    await p.getByLabel('Password',{exact:true}).fill('synthetic-password');
    await p.getByRole('button',{name:'Continue',exact:true}).click();
    await p.getByRole('heading',{name:'Business overview'}).waitFor();
    await p.getByRole('button',{name:'Orders',exact:true}).click();
    const toggle=p.getByRole('button',{name:/Search & filter orders/});
    await toggle.waitFor();
    assert.equal(await toggle.getAttribute('aria-expanded'),'false');
    assert.equal(await p.getByRole('textbox',{name:'Search orders'}).count(),0);
    await toggle.click();
    const req=p.waitForRequest(r=>r.url().endsWith('/get_sellertray_order_management_list')&&r.postDataJSON()?.p_search==='synthetic order');
    await p.getByRole('textbox',{name:'Search orders'}).fill('synthetic order');
    const request=await req;
    assert.equal(request.postDataJSON().p_tenant_id,tenantId);
    assert.equal(request.postDataJSON().p_branch_id,branchId);
    await p.getByRole('button',{name:/Hide search & filters/}).click();
    await p.getByRole('button',{name:/Search & filter orders.*Active/}).waitFor();
    assert.equal(await p.getByRole('textbox',{name:'Search orders'}).count(),0);
    assert.equal(hasAction(calls,'accept_invite'),false);
  });
  if(process.env.SELLERTRAY_REPORTING_QA==='1'){
    await scenario('customer history opens original Branch order', {businesses:[business()],focus:false},async(p,calls)=>{
      await p.getByRole('heading',{name:'Business overview'}).waitFor();
      await p.getByRole('button',{name:'Customers',exact:true}).click();
      await p.getByRole('button',{name:'Open order QA/001'}).click();
      await p.getByRole('region',{name:'Order details QA/001'}).waitFor();
      await p.getByText('Synthetic Item',{exact:true}).waitFor();
      const call=calls.find(x=>x.path.endsWith('/get_sellertray_order_management_detail'));
      assert.equal(call.data.p_branch_id,secondId);
      assert.equal(call.data.p_tenant_id,tenantId);
      assert.equal(call.data.p_order_id,inviteId);
      await p.getByRole('button',{name:'Close details'}).click();
      assert.equal(await p.getByRole('region',{name:'Order details QA/001'}).count(),0);
    });
    await scenario('profitability displays complete cost and withholds incomplete margin',{businesses:[business()],focus:false},async(p,calls)=>{
      await p.getByRole('heading',{name:'Business overview'}).waitFor();
      await p.getByRole('button',{name:'Report Center',exact:true}).click();
      await p.getByRole('tab',{name:'Profitability'}).click();
      await p.getByRole('heading',{name:'Profitability by Branch'}).waitFor();
      const margin=p.locator('.metric-card').filter({has:p.getByText('Gross margin',{exact:true})});
      assert.match(await margin.innerText(),/50%/);
      await p.getByLabel('Channel',{exact:true}).selectOption('whatsapp');
      await p.getByRole('heading',{name:'Cost records need attention'}).waitFor();
      assert.equal(await margin.locator('strong').innerText(),'—');
      const profit=p.locator('.metric-card').filter({has:p.getByText('Gross profit',{exact:true})});
      assert.equal(await profit.locator('strong').innerText(),'—');
      assert.ok(calls.some(x=>x.path.endsWith('/get_sellertray_profitability_report')&&x.data.p_tenant_id===tenantId&&x.data.p_source==='whatsapp'));
    });
    console.log('MERCHANT_REPORTING_BROWSER_ACCEPTANCE=PASS');
  }
  console.log('MERCHANT_BROWSER_MOCK_ACCEPTANCE=PASS');
}finally{await browser?.close();server.kill();}
